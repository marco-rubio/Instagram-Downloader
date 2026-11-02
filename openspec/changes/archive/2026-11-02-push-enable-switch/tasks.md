## 1. Switch

- [x] 1.1 Store `enabled` with the push settings, on unless switched off
- [x] 1.2 `getSettings()` returns nothing when switched off
- [x] 1.3 Switch in the dialog, applied immediately on its own

## 2. Verify

- [x] 2.1 Off: an export downloads and the app receives nothing; the token is kept
- [x] 2.2 On again: an export uploads with no token re-entry
- [x] 2.3 `openspec validate --strict`, then archive this change
