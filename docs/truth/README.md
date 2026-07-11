# docs/truth/ — the living current-truth layer

> Last verified: 2026-07-11 @ cf2234f

**New session? Start with `docs/ops/SESSION_BOOTSTRAP.md`** — the canonical 5-minute grounding
pack (the cast and rules, standing rails, verification recipes, current phase). This layer is
the *per-area current state* it points into; read it after bootstrap.

**Problem this solves:** every audit written as a dated snapshot (`docs/audits/`) is stale the
moment the code changes, so each new session re-audits the same ground. These docs are the
opposite: they describe the **current** state of the system and are **updated in place**.

**The don't-re-audit rule:** before exploring the codebase or live systems to answer a
question, check whether the matching truth doc already answers it. If it does and the freshness
stamp is recent, **trust it**. If the stamp is old and the claim is load-bearing for your task,
verify **that one claim**, correct the doc, bump the stamp. Full re-audits are a last resort.

## The contract

1. **One doc per area**, always current. History and evidence live in `docs/audits/`
   (immutable, dated); conclusions live here.
2. **Every doc carries a freshness stamp** — a `Last verified: YYYY-MM-DD @ <commit>` line.
   When you verify a doc's claims still hold, bump the stamp (even with no other edit).
   When you change behavior the doc describes, update the doc **in the same PR**.
3. **Reference code by symbol, not line number.** Line numbers in a 44k-line single file are
   stale within days. Write `` `_calPushStatusToLinear()` ``; the drift test verifies the
   symbol still exists in `index.html` or `scripts/`.
4. **Machine-enforced where possible.** `test/truth-sync.js` (runs in `npm test` + CI) fails
   when:
   - a truth doc is missing its freshness stamp,
   - the endpoint inventory in `ENDPOINTS.md` no longer matches what `index.html` actually
     calls (n8n webhooks + Edge Functions, derived by grep),
   - a truth doc references a repo path that doesn't exist,
   - a truth doc references a backticked function (the `_calPushStatusToLinear()` form)
     that no longer exists in `index.html`/`scripts/`.
5. **Claims that can't be machine-checked carry provenance.** Live-system facts (Linear
   counts, sheet columns, n8n workflow state) can't be CI-verified; tag them with the audit
   they came from, e.g. *(per `docs/audits/2026-07-05-linear.md`)*. If such a claim matters
   to your task and the stamp is old, spot-verify **that claim**, fix or confirm it, and bump
   the stamp — do not re-run a full audit.

## The docs

| Doc | Covers |
|---|---|
| `docs/truth/ENDPOINTS.md` | Machine-enforced inventory: every n8n webhook + Edge Function `index.html` calls, plus Supabase tables (curated). |
| `docs/truth/LINEAR.md` | Live Linear reality: teams, states (incl. hazards), users, batch shapes, what is/isn't synced. |
| `docs/truth/SUPABASE.md` | Tables, runtime flags, event ledgers, Edge Functions, write contracts. |
| `docs/truth/N8N.md` | Workflow inventory, active/inactive state, known hardcoded-credential hazards. |
| `docs/truth/SHEETS.md` | Google Sheets tabs/columns, roster truth, client-name normalization. |
| `docs/truth/APP.md` | `index.html` logic by surface: calendar, samples/SXR, reviews, Linear sync, Production tab. Phase-2 audit findings land here. |
