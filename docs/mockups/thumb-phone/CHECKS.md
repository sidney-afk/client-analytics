# Thumb mockup check receipts

2026-10-14. Local Chromium / fictional intercepted fixtures. This is design
evidence; product code is unchanged. The initial Messages test failure below
is retained separately from the successful documentation renderer.

`node --require ./test/helpers/single-file-index.js docs/mockups/thumb-phone/capture.cjs --before --messages-before`
completed with exit 0 for the before/after capture; final proposal re-render
after interaction assertions were added also completed with exit 0:

```text
PROTOTYPE FLOWS: grid/list/card/back, More, creative queue, filters, unread list, docked composer, retained draft and labelled Messages tab passed
MOCKUP: 28 phone screenshots; 14 screens checked at 390/430; 8 before/after comparisons; 0 page errors
```

`npm run check:index` — exit 0:

```text
check-index: working-tree index.html — sha256=3ae6de295841a657d577b63e387fee454b80b15782a36c3b69ce48d1eac9f51f bytes=1397775
check-index: committed index.html (HEAD) — sha256=3ae6de295841a657d577b63e387fee454b80b15782a36c3b69ce48d1eac9f51f bytes=1397775

check-index: OK — assembled == working tree == committed (HEAD)
```

`node docs/syncview-design/tests/prod-write-gateway-browser.js` — exit 0:

```text
--- phase: calendar_native_intake ---
--- phase: archive_park_sub_issues ---
prod-write-gateway-browser: mirror operations plus Submit and Calendar native intake passed
```

`node test/repo-map-sync.js` — exit 0 (before staging):

```text
repo-map-sync: 1180 passed, 0 failed
```

`git diff --check` — exit 0, no output. The product path diff against
`origin/main` for `src/index` and `index.html` is empty. No application edits
required a generated-index rebuild. No phone test changed and no skip or
exception was added to a CI check.

## Retained failed supplemental attempt

`node --require ./test/helpers/single-file-index.js docs/syncview-design/tests/messages-inbox-browser.js`
— exit 1 before its browser assertions. Its pre-existing dynamic import passes
a Windows path directly to Node's ESM loader:

```text
    at async onImport.tracePromise.__proto__ (node:internal/modules/esm/loader:546:25) {
  code: 'ERR_UNSUPPORTED_ESM_URL_SCHEME'
}

Node.js v22.12.0
```

The mockup renderer captures Messages with the existing `lost-work-lib` isolated
fixture and literal fictional inbox responses, avoiding that runner's ESM
import. It does **not** establish that the Messages regression suite passed.
No runner was changed or given an exception. Identity exposure is run after
committing; its result and hosted status are recorded in the draft PR.
