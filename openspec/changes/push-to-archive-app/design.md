## Context

The archive app (Tauri, instagram-archive repo) adds an HTTP listener bound to
127.0.0.1, off until a port is set in its preferences. Its import pipeline is
generic over `Read + Seek`, so it can import a ZIP held in memory. It dates a
capture from `igexport-provenance.exported_at` and recognises a capture it already
holds, on both the push and the file routes. The extension's exports run in a
content script on `https://www.instagram.com`, in the page's tab.

## Goals / Non-Goals

**Goals:**

- A configured endpoint makes exports reach the archive without a file on disk.
- No export is ever lost to a failed push: the fallback is today's download.
- The token is never readable by Instagram's page scripts.

**Non-Goals:**

- No queue, retry-later or status polling in the extension.
- No change to the export format.
- No background service worker.

## Decisions

### Upload from the content script, with XHR

The upload runs where the ZIP is built, in the content script, with
`XMLHttpRequest` for its `upload.onprogress` events. `fetch` has no upload
progress; a `ReadableStream` body needs HTTP/2 in Chrome (the app serves HTTP/1.1),
is unsupported in Firefox and sends no `Content-Length`. A background worker would
avoid CORS but cannot receive a Blob through messaging, so a large video would be
copied or chunked across.

### The request answers only after the import

`POST /ingest` returns once the capture is in the archive's tree and its event is
appended. There is no 202, sequence number or status endpoint, so the extension
needs no queue: if the answer is not a 2xx, the ZIP downloads and the app's file
importer takes it from there. A push whose answer was lost and that was then also
downloaded is harmless, because the app recognises the capture.

### CORS: the page's origin, the token as the only authentication

A content-script request in Chrome carries `Origin: https://www.instagram.com`,
not the extension's origin, so the app allows that origin and treats the token as
the whole of the authentication. The origin header is on every response, refusals
included, or the browser hides the body. Responses are JSON, read from the body,
so no header needs exposing. The app also answers Chrome's private network
preflight.

### A budget ladder instead of a declared size

Marco's rule is that the app never reserves more memory than a ZIP needs, starting
small. The first attempt sends no budget header (the app's default, 64 MiB). A
`413` with `refusal: "too-large"` is retried with `X-Igexport-Budget` 268435456,
then 536870912: three attempts at most. The app reads a refused body to its end
before answering, so the browser sees a complete request and a readable `413`
rather than a network error. The extension skips the upload when the ZIP is larger
than the app's published ceiling.

### Token in extension storage

Endpoint and token live in `chrome.storage.local`. Upstream keeps its settings in
the page's `localStorage`, which Instagram's scripts can read; the token must not
be there.

## Risks / Trade-offs

- Closing the Instagram tab mid-upload aborts it with no fallback, so that export
  has to be redone. Accepted: the tab is open while exporting.
- Under the ladder, a ZIP between 64 and 256 MiB crosses loopback twice, one
  between 256 and 512 MiB three times. Fast over loopback; the progress ring
  restarts on each attempt rather than finishing early.
- Newer Chrome may show a one-time local network permission prompt for
  instagram.com. Unavoidable on this route.
- Large ZIPs sit whole in the app's memory during import. Bounded by the 512 MiB
  ceiling, which the app can lower.
