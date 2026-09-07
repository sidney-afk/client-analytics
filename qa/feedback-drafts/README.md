# Review composer conservation

Finite browser-only regression lane. All identities, cards and text are fictional.
No production credentials, workflow dispatch or live writes are required or allowed.

Run with the repository's Playwright dependency and Chromium installed:

```sh
node test/review-draft-ownership.js
node qa/feedback-drafts/run.js
node qa/feedback-drafts/behavior.js
node qa/feedback-drafts/bfcache.js
node qa/feedback-drafts/recovery.js
node qa/feedback-drafts/calendar-recovery-access.js
```

`run.js` loads the complete current document and executes real composer inputs,
comment/tweak handlers, storage, save queues and renderers. Its 18 cells cover
three surfaces, plain notes/tweaks and refusal/accepted-but-lost/held-refusal.
Conservation requires visibly recoverable text after a new browser context;
payload bytes alone cannot make a cell pass. Held cases also preserve newer
typing wherever the actual pending UI leaves the composer available.

`behavior.js` adds 15 groups: explicit stable-ID retries, storage denial and
restoration, mobile/theme warning bounds, same-ID client replacement, same-role
actor replacement, actual storage-event verification with held refusal/success,
and same-ID changed-body acknowledgements. Existing source/native transports are
intercepted; fixture idempotency is a declared assumption, not live server proof.

`bfcache.js` uses full Chromium, real navigation and `pageshow.persisted`, with
no request routing. A loopback fetch bridge handles all app HTTP requests;
third-party library/resource tags are replaced but every application inline
script is byte-identical. Remote DNS is refused, workers blocked, and escaping
requests fail. Each surface must return without an HTML refetch, retain exact
owned storage and visible text, and issue zero writes. Synthetic event dispatch
cannot satisfy this test.

`recovery.js` exercises nine forward/recovery/forward groups with pending,
refused and ambiguously accepted notes plus newer unsent revisions. It serves
the exact generated Samples inverse while retaining the composer compatibility
bridge, verifies both bodies remain visible and owned, and forbids submitting
the newer unsent text during navigation. Client links remain byte-for-byte
unchanged; adding an arbitrary query parameter is correctly refused by the
existing capability parser and is not a valid recovery fixture.

Reports/screenshots remain under ignored `.codex-tmp/`. They are private local
diagnostics, never attachments for a public PR. `FEEDBACK_SOURCE` can select a
separate exact checkout for negative controls; normal runs use this checkout.
See `docs/ops/REVIEW_FEEDBACK_DRAFTS.md` for proof limits and recovery constraints.

Calendar's bounded recovery and its old-attempt limitations are documented in
`docs/ops/CALENDAR_FEEDBACK_RECONCILIATION.md` and the contract in
`docs/ops/CALENDAR_FEEDBACK_RECOVERY_CONTRACT.md`. The 16-group
`calendar-recovery-access.js` runner models the additive `recover_source`
gateway contract over its intercepted native/source stores (a declared fixture
contract, never server proof); `calendar-recovery-races.js` proves valid empty
cells receive the exact copy, divergent video aliases are preserved and refused,
and native edit/delete/resolve racing the retry hold under the same modelled
lock; `calendar-recovery-contract.js` checks five visible holds (missing receipt
metadata, missing original context, unreserved or unproven companion status,
changed source row). The decisive proof, with the actual handlers, the frozen
writer and a disposable PostgreSQL, lives in `qa/calendar-feedback-recovery/`.
