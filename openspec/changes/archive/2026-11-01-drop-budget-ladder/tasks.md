## 1. Single upload

- [x] 1.1 Remove the budget steps and the retry loop from `push()`
- [x] 1.2 Stop reading `default` from `/health`
- [x] 1.3 Treat any `413` as final, updating the cached `max` from its body

## 2. Verify

- [x] 2.1 Export a post against the app: one `POST /ingest`, no budget header
- [x] 2.2 `openspec validate --strict`, then archive this change
