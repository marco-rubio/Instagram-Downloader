## Why

Every export is downloaded to disk, then picked up again by the instagram-archive
app's importer. The app is gaining a local HTTP server, so the extension can hand
it the ZIP directly: the container never touches disk, and the import happens the
moment the export does. The protocol was agreed with the instagram-archive project
and Marco on 2026-10-31 (`docs/V5-PLAN.md` there, "The extension pushes the zip").

## What Changes

- When an endpoint is configured, a finished export ZIP is sent to the app with
  `POST /ingest` instead of being downloaded. With no endpoint configured, exports
  download exactly as today.
- Any failure (app unreachable, refusal, timeout) downloads the ZIP as today and
  shows an on-page notice with the reason. The download is the durable copy; the
  extension keeps no queue.
- A size budget ladder (64, 256, 512 MiB) lets the app reserve only the memory a
  ZIP needs; ZIPs above the app's ceiling go straight to a download.
- New settings item in Instagram's sidebar, beside upstream's, to set the endpoint
  URL (default `http://127.0.0.1:47821`) and the pairing token, with a "Test
  connection" check.
- The token is kept in extension storage, out of reach of Instagram's page scripts.
- The export format does not change: the app dates and identifies the capture from
  the ZIP's own entries.

## Capabilities

### New Capabilities

- `archive-push`: sending export ZIPs to the instagram-archive app's local server,
  the budget ladder, the fallback to a download, the push settings and pairing
  token, and the connection check.

### Modified Capabilities

- `export-controls`: a finished export is pushed to the app when an endpoint is
  configured, instead of always being saved as a download.

## Impact

- `src/js/igexport.js`: upload in place of `saveFile` on the success path, the
  fallback, and the progress ring across attempts.
- New settings UI in this fork's own files, styled in `src/style/igexport.css`.
  Upstream's `settings-ui.js` is not changed.
- `manifest.json`: `storage` permission; `http://127.0.0.1/*` host permission for
  Firefox.
- Depends on the instagram-archive app's server (off until a port is set there).
  Chrome may ask once to let instagram.com reach the local network.
