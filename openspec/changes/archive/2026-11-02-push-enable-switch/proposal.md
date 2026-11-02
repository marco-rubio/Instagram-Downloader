## Why

Turning the direct upload off currently means clearing the token, which then has
to be pasted again. Marco wants a switch that goes between uploading and
downloading while keeping the endpoint and token.

## What Changes

- New switch in the "Archive export" dialog: "Send exports to the archive app".
- Off: exports download as files, with no request to the app. The endpoint and
  token stay saved.
- The switch applies immediately, without Save.
- Settings saved before the switch existed stay on.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `archive-push`: a push also requires the switch to be on.

## Impact

- `src/js/igexport-push.js`, `src/style/igexport.css`. No protocol change.
