# archive-push Specification

## Purpose

Sending export ZIPs straight to the instagram-archive app's local HTTP server
instead of downloading them, so the container never touches disk. The protocol
was agreed with the instagram-archive project (`docs/V5-PLAN.md` there, "The
extension pushes the zip"); the design and its reasons are in
`openspec/changes/archive/2026-11-01-push-to-archive-app/design.md`. Code:
`src/js/igexport-push.js`.
## Requirements
### Requirement: An export is pushed only when an endpoint is configured

A finished export ZIP SHALL be sent, when the push settings hold an endpoint URL
and a token, to the app instead of being downloaded. With no endpoint configured,
the export SHALL be downloaded exactly as before, with no request to any endpoint.
The default endpoint offered is `http://127.0.0.1:47821`.

#### Scenario: No endpoint configured

- **WHEN** an export finishes and no endpoint is set
- **THEN** the ZIP is downloaded and no push is attempted

#### Scenario: Endpoint configured

- **WHEN** an export finishes and an endpoint and token are set
- **THEN** the ZIP is sent to `<endpoint>/ingest` and not downloaded

### Requirement: The push request carries the ZIP and its credentials

The push SHALL be an `XMLHttpRequest` `POST <endpoint>/ingest` from the content
script whose body is the ZIP Blob, with the headers `Authorization: Bearer
<token>`, `Content-Type: application/zip` and `X-Igexport-Filename` set to the
archive file name, percent-encoded UTF-8. `Content-Length` is set by the browser.
The capture time SHALL NOT be sent: the app reads it from the ZIP's
`igexport-provenance`.

#### Scenario: A post is pushed

- **WHEN** a post ZIP is pushed
- **THEN** the request carries the bearer token, `application/zip` and the
  percent-encoded archive name, and nothing about the capture time

### Requirement: Any failed push falls back to a download

Unless the app answers 2xx, the export SHALL be downloaded as before and an
on-page notice SHALL say why: the response's JSON `message`, word for word, when
there is one; the extension's own wording for `refusal: "unauthorized"` ("The
archive app refused the token; check it in the export settings."), for an
unreachable app, a timeout, and a body that is not JSON or an unknown `refusal`.
The extension SHALL NOT queue, retry later or poll: the download is the durable
copy. A `503` (`busy` or `no-library`) SHALL fall back the same way, without retry.

#### Scenario: The app is not running

- **WHEN** the push cannot connect
- **THEN** the ZIP is downloaded and the notice says the archive app could not
  be reached

#### Scenario: No library is open

- **WHEN** the app answers `503` with `refusal: "no-library"`
- **THEN** the ZIP is downloaded and the notice shows the app's message

### Requirement: Success completes the button, a duplicate is reported

A 2xx answer SHALL complete the progress ring, and no file SHALL be saved. Every
successful export, sent or downloaded, SHALL leave its button green with a full
ring and the tooltip "Exported: sent to the archive app" or "Exported:
downloaded", until the button is re-rendered or exported again; nothing is stored,
so a re-rendered post starts plain. When
its JSON says `duplicate: true`, the notice SHALL show its `message` (the archive
already held the capture); otherwise no notice is shown.

#### Scenario: The capture was already archived

- **WHEN** the app answers 200 with `duplicate: true`
- **THEN** nothing is downloaded and the notice shows the app's message

### Requirement: The progress ring tracks the upload and never finishes early

During a push the ring SHALL follow building the ZIP, then restart at 0 and
follow the upload's sent bytes up to 95%, and SHALL complete only on a 2xx.

#### Scenario: The upload is refused

- **WHEN** the app refuses the upload
- **THEN** the ring does not complete on the refusal; the ZIP is downloaded and
  only then does the ring complete

### Requirement: The health check is cached for the session

`GET <endpoint>/health`, with the token, SHALL be called at most once per page
session before the first push, and by "Test connection". Its JSON `max` and
`library` SHALL be cached; a `413` body's `max` SHALL replace the cached `max`.

#### Scenario: The limit was lowered

- **WHEN** a push is refused with a `max` lower than the cached one
- **THEN** the cached `max` takes the new value, and that export is downloaded

### Requirement: Push settings live in extension storage

A settings item of this fork SHALL be added to Instagram's sidebar beside
upstream's, without changing upstream's code, opening a dialog with the endpoint
URL, the token (masked) and a "Test connection" button. The endpoint and token
SHALL be stored in `chrome.storage.local`, never in the page's `localStorage`.
"Test connection" SHALL report one of: the app is unreachable, the token is
refused, the app is running with no library open (`library: false`), or the
connection works.

#### Scenario: Testing with a wrong token

- **WHEN** "Test connection" gets a `401`
- **THEN** the dialog says the token was refused

#### Scenario: Instagram's scripts look for the token

- **WHEN** the token is saved
- **THEN** it is not in the page's `localStorage` or any page-visible storage

### Requirement: One upload per export, within the app's limit

Each push SHALL be a single `POST /ingest`, without `X-Igexport-Budget` and
without retries. When the ZIP is larger than the cached `max` from `/health`, the
upload SHALL be skipped and the ZIP downloaded with a notice that it is too large
for the app. A `413` SHALL be final: the ZIP is downloaded with the app's message.

#### Scenario: A 100 MiB ZIP

- **WHEN** a 100 MiB ZIP is pushed and the app's `max` is 364904448
- **THEN** one request is sent, with no budget header, and it is accepted

#### Scenario: A ZIP above the limit

- **WHEN** the ZIP is larger than the cached `max`
- **THEN** no upload is attempted and the ZIP is downloaded with a notice

