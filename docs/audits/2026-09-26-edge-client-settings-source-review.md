# Client settings Edge routes: source review

**Scope:** `supabase/functions/client-credentials/index.ts` and
`supabase/functions/client-profile-write/index.ts` at `origin/main`
`3f5bd46e6086911ae2a7bb0d32507f03d5a44da8` on 2026-09-26. This is a
proposal-only source review; no endpoint, database, Sheet, or browser was called
and no runtime code was changed. The existing F84 credential authorization and
secret-delivery blocker is documented in `docs/features/CLIENT_CREDENTIALS_DESIGN.md`
and is outside this slice.

The route inventory is `docs/truth/ENDPOINTS.md`. The credentials feature
contract is `docs/features/CLIENT_CREDENTIALS_DESIGN.md`; the profile authority
state is `docs/STATE_OF_THINGS.md:69-72`. Existing
`test/onboarding-credentials-import.js`, `test/staff-sensitive-surface-auth.js`,
and `test/client-profile-edit.js` cover source contracts and pure helpers, not
the request/failure branches below.

| Source finding | Exact evidence and consequence | Proposed follow-up |
|---|---|---|
| A credential save can report success without its realtime revision notice. | `client-credentials/index.ts:182-192` discards errors from both the revision read and upsert. `saveOne` awaits `touchRev` at lines 337-338, then `actionUpsert` returns `ok:true` at lines 341-345. If the revision upsert fails, the credential row and audit may be saved while the open Kasper/SMM screens receive no revision ping. The owning feature contract at `docs/features/CLIENT_CREDENTIALS_DESIGN.md:38-40,113-117` expects that ping. | Check revision results and expose an accurate partial-success outcome, or make the save and revision bump atomic. Do not invite a blind retry of a committed credential write. Add an isolated test with a failed revision upsert after a successful credential/audit write. |
| A Sheet refresh can overwrite a newer profile row or report success with no row. | `client-profile-write/index.ts:166-186` reads the current row, fetches Sheet values, then updates by `slug` only. Unlike the edit RPC at lines 209-218, this update has no `updated_at` compare and the handler does not reject `fresh === null`. A concurrent row change after the read can be overwritten; a row removed before update can yield `ok:true, row:null`. This is source reasoning, not a measured race. | Use a version-checked update or RPC for refresh, recheck archived state at write time, and require exactly one returned row. Return a distinct conflict/not-found response so the editor can reload. Add mocked interleaving and zero-row tests. |
| Valid JSON `null` misses the object-body check in both routes. | `client-credentials/index.ts:835-840` parses `null`, then reads `body.action` before its try/catch at lines 847-859, so the exception escapes the route's JSON/CORS response helper. `client-profile-write/index.ts:145-149,224-230` catches the same access as `write_failed` 500. Neither is the intended client-input error. | After authentication and parsing, require a non-array JSON object; return the route's normal JSON 400 response for `null` and arrays. Keep authentication before body parsing. Add request tests for malformed JSON, `null`, arrays, and a valid action. |

**Limits:** No hosted behavior, data loss, missed notification, or race was
observed. These paths need isolated request tests and a separate implementation
and release decision. The existing F84 blocker remains unchanged.
