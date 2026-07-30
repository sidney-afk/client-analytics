# Flip status review — 2026-07-30

**What this is.** A step-back review after the F27 Window P work: where the Graphics flip actually
stands, what was verified live rather than assumed, and what is genuinely left. Every number below
was measured on 2026-07-30 with the anonymous key (read-only) or by running the suite locally.
**Nothing was changed by this review.**

---

## 1. Verified working, live

| Check | Result | How |
|---|---|---|
| Client roster integrity | **33** active clients, **0** would fail a native create, **0** roster orphans | anon read of `clients` + the three `*_ef_clients` flags |
| Runtime flags | authority `linear/linear` · inbound `true` · outbound `off` · **parity `true`** · auth `permissive` | anon read of `syncview_runtime_flags` |
| Inbound mirror (post-P.3) | **alive** — `mirror_in_*` events arriving continuously, newest 0 min old | anon read of `deliverable_events` |
| Event ledgers | **zero** failure-like events across the P.3 deploy window (197 events) | anon scan of all three ledgers |
| Unit suite | **184/184 pass** on current `main` | `node test/run-all.js` |
| Flip-runbook SQL | **16/16 fences proven** on PostgreSQL 16 — and the gate proven able to go red | `F63_REQUIRE_POSTGRES=1 node test/f63-flip-runbook-sql-gate.js` |
| Weekly Track-B backup | last 4 scheduled runs **all successful** | GitHub Actions |
| Webhooks | 2/2 enabled, 0 disabled, every reconcile summary | reconciler payloads |

## 2. Closed since the 2026-07-28 audit

- **F55 authority vocabulary** — source *and* live. The live database function needed a separate
  re-apply because editing an already-applied migration does not change the database.
- **`linear_project_ids` team-keyed shape** — the "7 bare-string rows" figure was a whole-table
  count; scoped correctly it was **one** row holding **two** ids, resolved against live Linear.
- **F63 paste-ready flag actions** — see §1; two real runbook defects fixed in passing.
- **The mark-done regression** — fixed and owner-tested.
- **Luke Cutting's missing client row** — see §4.
- **F27 Window P (P.2 + P.3)** — capture, sealed Drive backup with verified round-trip, rehearsed
  restore, and the first live deploy. Recorded in `EXECUTION_LOG.md`.

## 3. The B3 "zero gate" — measuring the wrong thing

The scheduled health check demands `diff_count / repair_list_size / linkage_actionable = 0/0/0`.
It has never read that, and **as written it cannot**:

- **`diff_count` ≈ 4,530 is a stamp-age counter, not damage.** PR #920 (2026-07-23) added
  `compareAttribution`, which flags any row whose stored attribution stamp differs from a freshly
  computed one — `mapping_revision` included. Proven twice: (a) `entities_checked`, `issue_count`
  and `resolved` stayed flat while the counter moved; (b) **adding one correct client row raised
  it**, which real damage could not do. 4,567 of 4,602 issues resolve to the correct client.
- **`repair_list_size` = 27 is the real, bounded debt** — 18 `direct_project_unmapped` (Linear
  projects mapping to no roster client) plus a few orphans. It rose to 35 when Luke's project
  appeared and **fell back to 27 within an hour of his client row being created**, which is the
  cleanest possible confirmation that this counter tracks something real.
- **`outbound_diff_count` = 0** throughout.

`B4_READINESS.md` row 1 already gates on `repair_list_size` and `outbound_diff_count` — **not** on
`inbound_diff_count`. The health-check prompt is stricter than the repo's own gate. Draining the 27
is the only work between today and a truthful seven-day clock.

## 4. What today proved about the guardrails

Three separate stops, none of them the gate anyone expected:

1. **P.3 dispatch 1** refused to deploy because it could not first prove the rollback bundle was
   retrievable. A configuration error became a no-op instead of an outage.
2. **The F27 preinstall gate** caught its own proof fixture — a temp table named
   `f27_preinstall_production_authority` — because the gate scans every schema for F27-named
   objects. The fixture was renamed; the predicate was **not** weakened.
3. **The F63 gate**, sabotaged deliberately, went red both times.

Two claims were also disproven by measurement rather than accepted:

- A report that `ef-deploy-provenance` and `f42-card-comment-apply` failed on `origin/main`.
  They pass — main was 180/180. Root cause was **Windows CRLF**: `.gitattributes` pinned JS to LF
  but not YAML, so workflow fixtures materialized with CRLF against LF-literal regexes. Fixed by
  pinning `*.yml`/`*.yaml`.
- A cloud-review claim that `production_assert_authority` was **absent** from production. It is
  present, and has been since 2026-07-12 via the applied write-UI parity migration — the probe had
  used the wrong signature and returned a false negative. **An anon RPC probe can prove a function
  exists; it cannot prove one absent unless the exact signature is used, and never for a trigger
  function.**

## 5. Open, ranked by what actually blocks the flip

1. **F27 migration + rollback drill.** The remaining install. The drill requires
   `linear_legacy_parity_enabled` **false**, but parity being **true** is what keeps mark-done
   working for ~24 clients. This must be a short scheduled window — parity off → drill → parity on
   — chosen by the owner. **Nobody may disarm parity silently.**
2. **The reconciler's unbounded read.** 6 of 30 runs failed on 2026-07-30 with a statement timeout,
   reading the entire `deliverable_events` history (27,043 rows) with payloads, unsorted-bounded.
   This is the only thing measurably **getting worse**, and the reconciler *is* the B3 monitoring.
3. **The 27 attribution repairs.** Bounded and nameable; needs owner answers about which Linear
   projects map to which clients, or that they are dead.
4. **Parity soak — armed 2026-07-28, still never observably exercised.** `mirror_outbox` is
   service-role-only, so this cannot be confirmed with the anon key. **A parity write draining to
   Linear has not been witnessed.** Treat the lane as armed-but-unproven until one is.
5. **Auth enforcement** — `permissive → enforced`, with the TEST denial matrix.
6. **Flip Graphics.**

## 6. Honest limits of this review

- `mirror_outbox`, `deliverables`, and the F27 fence table are service-role-only. Queue depth,
  parity drains, and the installed-object inventory rest on Codex's reports, not on my own reads.
- The P.3 provider readback has since completed: active version **40**, `ACTIVE`,
  `verify_jwt=false`, source closure matching the candidate 5/5 files, new sealed baseline
  `eaa57fb2…` (67,830 bytes) uploaded with an independent byte/hash readback. Those figures come
  from the operator session; what I verified directly is the behaviour — inbound handling
  `status_change`, `delete` and `restore` events with zero failures 77 minutes after the deploy.
- Row counts and timings are point-in-time on 2026-07-30 and will drift.
