## Why

The archive app reserves no memory ahead of a push: it reads the body into a buffer
sized by the request, so a small default limit saved nothing and the budget ladder
only bought extra uploads. Marco dropped it on 2026-11-01 for a single limit of
348 MiB (364904448 bytes), about four times the largest export in his corpus
(82.46 MiB of 3,205 ZIPs).

## What Changes

- One upload per export, no retries. The `X-Igexport-Budget` header is no longer
  sent (the app ignores it and still allows it in the preflight).
- A `413` is final: its `max` corrects the cached one and the ZIP is downloaded.
- `/health` no longer returns `default`; only `max` and `library` are read.
- A ZIP larger than the cached `max` is still downloaded without an upload.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `archive-push`: the budget ladder is replaced by a single upload under the
  app's `max`; the health check and the progress ring lose their ladder parts.

## Impact

- `src/js/igexport-push.js`: the ladder loop and its steps are removed.
- No change to the protocol's routes, headers otherwise, auth or answer shapes.
