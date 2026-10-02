# Site assurance, 2026-10-02 — Proof

**Incomplete:** the owner requested the four OPEN_REPAIRS 205a priority rows
first, then fresh Tier 0/1 proof and two dry cycles. Priority checks ran first.
Available checks ended with two dry cycles; missing private inputs and the
TEST-client-only mutation boundary prevent the full stop condition. The
[coverage ledger](../testing/ASSURANCE_LEDGER.md) preserves the unproven halves.

Windows owner machine, Chromium, local repository frontend against the real
backend. Initial source baseline: `20bfe14b1b7fa11cda0d1f71b63701f217548236`.
The repaired frontend is a candidate. No deploy or merge was performed. Service
and Management credentials stayed in memory; Chromium received no private
credential environment. Only disposable TEST-client cards were changed; each
was archived and read back, including failed attempts. Archive history remains.
No real HR record, other client's data, roster, credential, runtime flag or n8n
workflow changed. External action routes were blocked and diagnostics captured
locally; no notification was sent by this run. Private logs and a diagnostic
screenshot stay outside the public repository.

## Priority rows: positive evidence and limits

| Surface | Existing prover and observation | Limit |
|---|---|---|
| docs accuracy | Split-source preload: truth-sync 503/0, system-map-sync 17/0; repo-map-sync 1062/0 after documentation/integration. | Source consistency does not establish every live semantic assertion. |
| Monitors/logs | Watchdog/lane contract tests pass. Maintained live watchdog `--check`, dry-run enabled: all nine active lanes healthy at 20:12Z and 20:56Z. Existing [scheduled incident 37022806794](https://github.com/sidney-afk/client-analytics/actions/runs/37022806794): stale intake at 14:51Z, relay HTTP 200, confirmed delivery. | Existing delivery was inspected; no synthetic alert dispatched. Historical F09 gap remains. |
| Admin/ops | Track-B and streaming tests pass (16 streaming checks). Six latest hosted backups successful; latest [37009430350](https://github.com/sidney-afk/client-analytics/actions/runs/37009430350), created 12:53Z: history-v11, 122955263 bytes, HMAC/readback/parent verified, freshness passed at 13:08Z. | This receipt does not prove current Drive freshness. Fresh authenticated download, scratch restore and credential recovery need unavailable private inputs/target. |
| Deploy workflows | Existing provenance/Section-4 guards and manifest check pass. [36785832200](https://github.com/sidney-afk/client-analytics/actions/runs/36785832200) receipt inspected; Management catalog confirms required functions ACTIVE; frozen writers retain tokenless posture. | ACTIVE/version is not every serving source fingerprint. Nothing deployed. |

## Reproduced application finding and proof

The new live probe reuses maintained TEST fixture/click/readback/archive helpers
and loads the **existing** token in memory. It never mints or rotates a link.
Calendar and Samples independently persisted plain comments but left the visible
Approve control disabled: `saving:false`, `draft:false`, `approveDisabled:true`.
Calendar remained disabled through a bounded readiness wait. Both source success
handlers cleared the saving flag without repainting controls.

The candidate repaints after successful comments on both surfaces. The new
deferred-save regression executes both real source handlers: pending controls
stay busy, success releases visible controls, refusal stays visible, and plain
comments preserve status. It fails against the old handler. The repaired
live-backend browser probe passes **25 checks**, then a second full 25-check pass:
comments, Calendar caption approve/timestamp and request-change text/status,
Samples graphic request-change, reload persistence, real thumbnail image bytes,
zero page exceptions, prohibited-action guard and cleanup. Fresh link issuance,
native video/graphic approval and published frontend proof remain separate.

The native TEST read probe matches all **444/444** canonical/projection IDs and
statuses, verifies both teams' native authority, outbound off and absent active
inbound endpoint. It does not certify browser-role reads, assignment or writes.

Existing client-entry matrix: **23 mocked scenario groups**. Corrected B4 browser
matrix: **9 mocked key-verifier calls**, preserved denials, cache purges and mobile
gates. Native intake editor: **56 mocked/source checks**. PTO: **35 mocked lifecycle
gates / 101 action-result screenshots**; visual review is pending. No real HR
lifecycle was mutated under the client-only mandate.

## Reproduced tool fixes and refuted signals

1. Raw Windows drive paths failed dynamic ESM imports. Tests now use
   `pathToFileURL`, including the analytics `--import` hook; its fixture resolves a
   relative module URL. Existing behavior assertions execute on this machine.
2. The route-stub checker called CRLF generated routes stale. It accepts equivalent
   line endings; its guard executes the actual checker with CRLF, then deliberately
   breaks a route and requires refusal, restoring exact original bytes afterward.
3. B4 asserted retired copy, fixed menu order, unloaded globals and unsigned
   direct-preview entry. It follows current copy/actions/lazy loading and signs
   in for that preview. Authorization and secret-purge assertions remain.

No application finding was filed for missing split-source preload, Node 22's
missing TypeScript API, default WSL launcher, deliberate mock-server refusals,
the removed inbound-switch row, or the probe's initially incomplete endpoint
allowlist. Correct invocation/current-contract checks refuted those signals.
Full suite before main integration: **3 of 668 failed**, retained honestly: snapshot POSIX-0600 assertion
and two local SQL launchers. Both SQL rehearsals subsequently passed against
isolated loopback PostgreSQL **17.11**, with hosted credentials removed and the
server stopped. Their legacy output says PostgreSQL 16; this run used 17.11.
The POSIX mode assertion stays red on Windows; an ACL exposure was not reproduced. Main integration adds three unit suites (671 classified total), each run separately; the Top Videos function had the same Windows import-hook defect and passes after the same URL conversion. Alert fixture absence-of-key proof passes when inherited private n8n credentials are removed. No production notification occurred.

## Cycle accounting

| Cycle | Self-supervision, picks and yield |
|---|---|
| 1 | Goal: honor priority before workflow drills. Pick docs, monitors and backup with existing cheap provers: positive source/log receipts; fresh restore inputs unavailable. |
| 2 | Last yield: partial ops evidence, no app defect. Prune dispatch; prove the fourth priority row with provenance guards/live catalog. No deployment or new finding. |
| 3 | Highest scores: churned Tier 0 links/media/issuance. Existing link and image bytes work; issuance needs real role key/actor. Initial client pass 16 checks; comment expansion exposes a repeatable failure. Process critique: use current native lanes rather than retired Linear probes. |
| 4 | Pick Calendar staff writes, intake and identity. Source/mock guards and B4 repairs; real authenticated writes blocked. Preserve expired status rather than retrying without credentials. |
| 5 | Prune real HR mutation and retired mirror parity. Pick native data correctness/PTO: 444-row equality and 35 mock lifecycle gates. Missing live promised halves remain open. |
| 6 | Independently reproduce both comment handlers, make minimal browser repair plus deferred-save guard. Candidate 25-check pass and cleanup. Process critique: do not expand mutation population or invent credential access to improve scores. |
| 7 | First dry cycle: Calendar/Samples 25/25 and native projection 444/444. No new confirmed finding. |
| 8 | Second dry cycle: mocked B4 identity, live watchdog dry-run and current-source mocked PTO lifecycle. No new confirmed finding. These available checks are dry; all Tier 0/1 freshness is not established. |

Resume with a private role-key/actor file and backup restore inputs, after
Lighthouse merges/publishes the reviewed candidate. Fresh HR mutation also needs
a scope compatible with the TEST-client rule. Every command's final output lines,
attempts and exits are retained in the owner's private check report; no raw data,
tokens or screenshots are included here.

## Current-main monitoring follow-up, 21:03–21:05Z

Current main adds the digest lane. The watchdog now reads ten lanes; no stale
lane but `failing:["alert_digest"]`. Its zero exit is not a healthy result.
Hosted [37062027005](https://github.com/sidney-afk/client-analytics/actions/runs/37062027005)
failed with Supabase HTTP 500 / statement timeout `57014`. A real local
`node scripts/alert-digest.js --dry-run` succeeds in seven seconds, without any
post/state write, and reports five incidents: backup older than seven hours,
expired assurance ledger and failed scheduled Calendar, card/calendar drift and
Samples runs. Those receipts are unresolved incidents; their underlying app
conditions were not locally reproduced, so no speculative fix was filed.
The monitors row reflects the failing lane. The two earlier scoped dry cycles
do not hide this later observation or establish the full stop condition.
