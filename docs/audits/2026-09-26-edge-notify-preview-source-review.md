# Notify preview Edge route: source review

**Scope:** `supabase/functions/notify/index.ts` and `slack-api.ts` at
`origin/main` `3f5bd46e6086911ae2a7bb0d32507f03d5a44da8` on 2026-09-26.
This is a proposal-only source review of the owner-only direct-message preview,
not the durable channel outbox. `docs/STATE_OF_THINGS.md:83-84` says the native
notification sender is not switched on. No hosted request, database read,
provider post, or function-code change was made.

| Source finding | Exact evidence and consequence | Proposed follow-up |
|---|---|---|
| An uncertain preview post is labelled as refused. | `notify/slack-api.ts:55-65` distinguishes a channel-post 429 (`retryable`) from a 5xx or malformed response (`unknown`), because the latter may have been accepted without a receipt. The direct-message adapter at `notify/slack-api.ts:93-97` returns `blocked` for *every* non-verified HTTP response, including 5xx and malformed JSON; only a transport exception becomes `unknown` at lines 89-91. `notify/index.ts:231-242` returns only aggregate `sent` and `attempted` counts, so the preview caller cannot distinguish an uncertain post from a definite refusal. The preview has no durable outbox or receipt (`notify/index.ts:202-204`); repeating it after an accepted but unconfirmed post could duplicate the direct message. This is a possible source path, not an observed duplicate. | Preserve the pinned direct-message recipient and verified-receipt checks. Classify 5xx/malformed preview responses as `unknown`, keep 429 as a known rate refusal, and expose the outcome category to the caller so an operator can inspect the direct message before any manual repeat. Do not add automatic retry. Mock accepted-but-unconfirmed, 429, malformed, and wrong-conversation responses. |
| A failed comment read can look like a normal sample. | `notify/index.ts:214-218` checks errors for client and deliverable reads, but the subsequent `production_comments` read at lines 219-225 uses only `comment.data`. When that query resolves with an error and no row, preview substitutes `Sample comment text.` and proceeds to send at lines 226-242. A successful empty result may intentionally use the sample; a failed query should not be indistinguishable from it. | Check `comment.error` before constructing or sending samples and return an explicit data-unavailable response. Retain the placeholder only for a successful empty read. Add isolated handler cases for both query outcomes with mocked database and direct-message adapters. |

**Evidence limit:** Existing offline `test/native-notification-slack-adapter.js`
checks the channel adapter's 429/5xx/malformed classifications, and
`test/native-notification-format.js` checks the preview recipient guard,
wrong-conversation refusal, and successful direct message. Neither exercises
these preview failure paths. The outbox's `unknown` recovery rule in
`docs/ops/NATIVE_NOTIFICATIONS.md:30-35` does not give this outbox-free preview
a durable receipt; an implementation needs its own operator-facing result.
