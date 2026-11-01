## 1. Settings

- [ ] 1.1 Add `storage` and, for Firefox, `http://127.0.0.1/*` to `manifest.json`
- [ ] 1.2 Sidebar settings item beside upstream's, in this fork's own files
- [ ] 1.3 Dialog with endpoint (default `http://127.0.0.1:47821`), masked token, save
      to `chrome.storage.local`
- [ ] 1.4 "Test connection" via `GET /health`, reporting unreachable, refused
      token, no library, or working

## 2. Push

- [ ] 2.1 Health cache per page session, refreshed by a `413`'s `max`
- [ ] 2.2 XHR `POST /ingest` with bearer token, `application/zip` and
      percent-encoded `X-Igexport-Filename`
- [ ] 2.3 Budget ladder: no header, 268435456, 536870912; skip when above `max`
- [ ] 2.4 Progress ring up to 95% per attempt, reset on a refusal, complete on 2xx
- [ ] 2.5 Fallback download with a notice for every non-2xx, unreachable app,
      timeout or unparseable body; own wording for `unauthorized`
- [ ] 2.6 Notice for `duplicate: true`

## 3. Verify

- [ ] 3.1 No endpoint: exports download exactly as before
- [ ] 3.2 Against the app: fresh import, duplicate, wrong token, no library, app
      closed, a ZIP over 64 MiB
- [ ] 3.3 `openspec validate --strict`, then archive this change
