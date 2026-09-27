# Brain Edge route: source review

**Scope:** `supabase/functions/brain/index.ts` at `origin/main`
`3f5bd46e6086911ae2a7bb0d32507f03d5a44da8` on 2026-09-26. This is a
proposal-only source review. No Edge request, private-repository API call,
database query, or browser run was made; no runtime code changed.
`docs/independence/SYSTEM_MAP.md:1215-1234` owns the Templates route and its
read/"Send a change" contract. `docs/STATE_OF_THINGS.md:108-110` lists a brain
deployment, but this review did not compare hosted bytes or verify its secret.
The existing `test/brain-parse.js` checks the pure parser and source boundaries;
it does not drive the request and provider-failure paths below.

| Source finding | Exact evidence and consequence | Proposed follow-up |
|---|---|---|
| Request parsing lacks a bounded object check. | `brain/index.ts:193-202` calls `req.json()` before staff authorization and converts malformed JSON to `{}`. There is no application byte limit before parsing; the 8,000-character check at lines 118-121 applies only to change text afterward. Valid JSON `null` reaches `body.clientName`, throws a `TypeError`, and becomes `brain_unavailable` 502 at lines 209-213 instead of a 400 input error. This is a source path, not a measured resource attack. | Bound request bytes before parsing, reject malformed/non-object JSON with a consistent 400, then perform the existing exact-client staff authorization before any provider read/write. Add isolated malformed, `null`, oversized, and valid-request cases. |
| A retry after an uncertain change write can create a duplicate file. | `recordChange` makes a new timestamp/random-ID path for each call at `brain/index.ts:123-127`, then sends one GitHub `PUT` at lines 147-156. If GitHub commits the file but the response is lost, the handler returns `brain_unavailable` 502 at lines 209-213. The Templates caller preserves the text and explicitly offers "try again" at `src/index/060-templates-filming.js.part:1296-1319`; a retry takes a new path. This is a possible ambiguous-result sequence, not an observed duplicate. | Give each logical submission a bounded stable request ID and deterministic file path; on an uncertain result, read back that path before creating another file. Keep the staff gate and word-for-word text. Test a committed PUT with a lost response followed by retry using a mocked provider. |
| An unknown action can be reported as missing configuration. | `brain/index.ts:204-208` checks `BRAIN_GITHUB_TOKEN` before rejecting an action other than `folders`, `read`, or `change`. If the secret is absent, a typo action receives `brain_not_configured` 503 instead of `unknown_action` 400. The `folders` action is intentionally independent of that secret. | Validate the action allowlist before action-specific configuration checks, while preserving the token-free `folders` path and staff authorization. Test unknown actions with and without the secret. |

**Limits:** No hosted request, GitHub write, data inspection, duplicate, or
resource failure was observed. Any fix needs offline request/provider tests and
a separate release decision. This report changes no route behavior.
