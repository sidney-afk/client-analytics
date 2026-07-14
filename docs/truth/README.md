# docs/truth/ — the living current-truth layer

> Last verified: 2026-07-14 @ 616ea20

**Problem this solves:** every audit written as a dated snapshot (`docs/audits/`) is stale the
moment the code changes, so each new session re-audits the same ground. These docs are the
opposite: they describe the **current** state of the system and are **updated in place**.

## The contract

1. **One doc per area**, always current. History and evidence live in `docs/audits/`
   (immutable, dated); conclusions live here.
2. **Every doc carries an exact freshness stamp** — a
   `Last verified: YYYY-MM-DD @ <7-40 character commit>` line. The commit must resolve, be an
   ancestor of the tested tree, and the verification date must be no more than 30 days old.
   Additional live-readback context may follow it, but cannot replace the source commit anchor.
   When you verify a doc's claims still hold, bump the stamp (even with no other edit).
   When you change behavior the doc describes, update the doc **in the same PR**.
3. **Reference code by symbol, not line number.** Line numbers in a ~45.8k-line single file are
   stale within days. Write `` `_calPushStatusToLinear()` ``; the drift test verifies the
   symbol still exists in `index.html` or `scripts/`.
4. **Machine-enforced where possible.** `test/truth-sync.js` (runs in `npm test` + CI) fails
   when:
   - a truth doc is missing its exact date + commit freshness stamp, the commit is not a resolvable
     ancestor, or the date is older than 30 days,
   - the read-first briefing's `through Fxx` boundary is behind/ahead of the cutover audit register,
   - an open P0/P1 cutover finding is absent from all operative control docs,
   - a simple base-plus-suffix Edge Function call or the literal/composed endpoint count drifts,
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
| `docs/truth/BRIEFING.md` | **Read first in every new session** — what this system is, where truth lives, what's enforced. |
| `docs/truth/ENDPOINTS.md` | Machine-enforced inventory: every n8n webhook + Edge Function `index.html` calls, plus Supabase tables (curated). |
| `docs/truth/LINEAR.md` | Live Linear reality: teams, states (incl. hazards), users, batch shapes, what is/isn't synced. |
| `docs/truth/SUPABASE.md` | Tables, runtime flags, event ledgers, Edge Functions, write contracts. |
| `docs/truth/N8N.md` | Workflow inventory, active/inactive state, known hardcoded-credential hazards. |
| `docs/truth/SHEETS.md` | Google Sheets tabs/columns, roster truth, client-name normalization. |
| `docs/truth/APP.md` | `index.html` logic by surface: calendar, samples/SXR, reviews, Linear sync, visible Linear mirror (internal `production`) and Submit form (internal `linear`). Phase-2 audit findings land here. |
