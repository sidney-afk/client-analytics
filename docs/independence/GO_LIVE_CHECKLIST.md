# SyncView Go-Live Checklist — Linear → SyncView cutover

**Purpose.** The single canonical, owner-facing sequence for cutting production over from
Linear to SyncView. Rewritten 2026-07-13 after the full cutover audit
(`CUTOVER_AUDIT_2026-07-13.md`) — that register is the authority on WHY each gate exists.
Exact flag payloads and emergency procedures live in **`docs/ops/FLIP_RUNBOOK.md`** (owner-
executable, paste-able; no Codex required). If anything here disagrees with the live runtime
flags, trust the live flags and stop.

_This sequence supersedes all earlier flip orderings (audit F17). D-28's shadow-week soak is
satisfied by the staged parity enrollment below plus the nightly shadow audit — ratified by the
owner merging this file (see D-32)._

---

## Golden rules

1. **The owner holds every switch.** Nothing flips without a deliberate owner action.
2. **One team at a time.** Graphics (one person) first, then Video (D-28).
3. **One-click team rollback is BLOCKED (F05/F27).** Immediate containment is stop that team's new
   mutations. F2 `off` stops normal outbound only; F4 `false` stops independent parity, so disable
   both for an unknown/mixed Linear-write incident (F58). Authority returns to Linear only after an immutable team
   snapshot, owner-audited classify/replay/quarantine/discard decisions, and a machine-read team
   zero. The default drainer and a global green summary do not prove this. Use FLIP_RUNBOOK §R2.
4. **Cosmetic vs. data (D-29).** Looks-wrong → fix in place, keep going. Wrong-data-written →
   contain that team immediately, then complete §R2's evidence-bearing recovery before any
   authority reversal or re-flip.
5. **Green before you move — with real eyes.** A quiet alarm channel only counts once the
   non-n8n inbound pager (F09) is live; until then, silence can mean "the alarms are dead".

## Current state (update when flags move)

| Flag | Value today | Meaning |
|---|---|---|
| `prod_authority` | `{video: linear, graphics: linear}` | Both teams still run on Linear |
| `linear_outbound_enabled` | `off` | No mirroring back to Linear |
| `linear_inbound_enabled` | `enabled` | Linear → SyncView copy (always on until B5) |
| `linear_legacy_parity_enabled` | `disabled` | Transition write-lane off (armed at Phase 1) |
| `auth_enforcement` | `permissive` | Client-link verifier permits missing/invalid tokens; this is not a staff-write gate |
| `write_ui_reroute_clients` | **NOT DEPLOYED** (absent from #813 head `885026a`) | Required D-32 allowlist; no merge until it exists, defaults to TEST-only, and reads back |

Merged & live: #810 gateway (deployed), #811 guards + daily TEST drill + nightly shadow audit,
#812 mirror write-UI (locked for real teams), 62/62 client→project mappings, Samples retirement
+ rename. Parked: **#813** (reroutes + native Create-Post/Submit intake) — merges only at
Phase 0.5 below, after the fix-pack.

> **IMMEDIATE PRIVACY CONTAINMENT — do not wait for Phase 0 (F64):** a data-free replacement is
> prepared locally but intentionally excluded from this docs PR. Do **not** combine the first
> `-diff` rule and text deletion. Draft guard-only PR #829 changes only `.gitattributes` and is
> verified but unmerged. Merge it first; then scrub from a base that already has the
> guard and verify Files changed plus `.patch`/`.diff`; then immediately restore normal diff review.
> Retain evidence privately; review and
> revoke/restrict exposed private share links; and record the owner/GitHub decision for history,
> raw/cache, clone, and fork exposure. Ordinary cutover work does not downgrade this incident.

---

## Phase 0 — Preconditions (ALL boxes before #813 merges)

**Build/fix gates (Codex):**
- [ ] **One machine-generated current-state manifest is fresh** (F56/F59): fail unless it records
      the exact Pages/main commit, all runtime flag values and update times, all 24 Edge Function
      states/JWT settings/source-closure and server fingerprints, every load-bearing n8n active
      version/node hash/trigger/last-green execution, deployed migration/schema contract, and
      timestamped evidence handles. The owner flag action must consume the same unexpired preflight
      token; prose checkmarks cannot authorize a flip.
- [ ] **Every paste-ready flag action is executable and single-purpose** (F63): CI parses each SQL
      fence; every forward/kill/recovery action passes an isolated TEST flag-store transaction,
      exact expected-state CAS, affected-row assertion, and readback. Never paste a multi-action
      sequence or an unconditional whole-row replacement.
- [ ] **The complete Production browser gate is green before merge/flip** (F105): do not accept the
      fast PR subset alone. Locked live-read/zero-mutation and fully intercepted writable states are
      explicit; interaction/behavior/pixel lanes are authority-aware; unsupported operations remain
      guarded; no suite sends a live mutation; current review-packet/Argos artifacts exist. Require
      aggregate `npm run test:prod-polish` plus the long lanes on the exact candidate commit.
- [ ] **Public-repo hygiene is enforced** (F64): no new client identity, slug, account address,
      secret, or private fixture enters a commit. Remove the plaintext onboarding records from the
      current tree immediately without losing required schema; privately preserve evidence and
      complete the owner/GitHub exposure, cache/fork, token-link, and history-rewrite assessment.
      A private tracked-exposure inventory and owner disposition exist for the wider repository;
      CI rejects new exposures.
- [ ] **P0 weekly-report exposure is contained** (F76): unauthenticated report/roster reads and
      writes are unavailable; anon table SELECT is revoked; individual SMM submit, Kasper/admin
      view/options, and signed service roster sync are enforced and negatively tested. Access logs
      are reviewed, integrity is reconciled, and the owner records immediate-disable versus
      time-boxed incident-containment disposition before any other go-live action.
- [ ] **P0 onboarding-reader exposure is contained** (F77): all three onboarding list EFs deny
      anonymous/cross-role requests, CORS is constrained, background discovery uses a minimal
      authorized/opaque projection, logs are reviewed, embedded private links/credentials are
      dispositioned, and the owner records disable-now versus expiring incident containment.
- [ ] **P0 public Linear mutation routes are contained** (F91): status/comment bridges require an
      active immutable principal; video/graphics intake requires staff auth or an owner-ratified,
      server-minted short-lived exact-client capability; target/client/team are resolved server-side;
      audit, request limits, idempotency, and deployed anonymous/expired/cross-client negative tests
      are green. Owner explicitly answers whether `?intake=1` remains shareable and under what
      mint/expiry/revocation contract.
- [ ] **Unknown client links fail closed before loading data** (F102): `?c=` alone grants no bypass;
      an allowed client and current token are resolved before data/cache/route entry. Unknown,
      malformed, unsupported-view, invalid-token, and every `c`+hash/`prod` combination show only
      the invalid-link surface and purge client/staff state. Production/staff routes require an
      individually verified staff session. Owner records the exact supported client-view allowlist,
      and fictional desktop/mobile/second-device/cache/history tests prove no staff fallthrough.
- [ ] **Drive-backed thumbnail jobs enforce auth and CAS** (F78–F80): the scanner fails closed on
      missing/wrong scheduler identity; the resolver enforces originating principal/client scope;
      both are bounded/rate-audited; and the resolver's final write CASes exact URL/version with
      reversed-completion TEST proof. No anonymous Drive/Storage/service-role work remains.
- [ ] **Public onboarding capture is abuse-bounded** (F81): server-minted short-lived submission
      ownership, rate/CAPTCHA, strict byte/schema/kind limits, conditional/versioned updates,
      immutable creation time, sanitized final-only alerts, and spam/replay/oversize/foreign-ID/
      beacon-race/alert-failure TEST cases are green.
- [ ] **Filming-plan roster/document links are private** (F82): unauthenticated EF GET and anon
      table SELECT are removed together; the public seed is handled under F64; least-field,
      principal/client/role-scoped SMM/Kasper/Admin reads pass anonymous/cross-client/mobile/
      second-device tests; Google-document sharing and access logs are privately reviewed.
- [ ] **Thumbnail revision metadata is private** (F83): anon SELECT and realtime exposure are
      revoked, the table stays service-role-only unless a least-field role-scoped projection ships,
      object-policy reachability is reviewed, and anonymous/cross-client negative tests pass.
- [ ] **Credential vault uses least-secret, auditable delivery** (F84): list is metadata-only;
      individually revocable active-member sessions bind immutable actors; one-secret reveal audits
      synchronously/fail-closed; old plaintext passwords never enter history; shared/legacy keys are
      retired; direct API/DevTools/copy/offboard/cross-client/first-edit tests pass.
- [ ] **Full onboarding reads bind an active admin** (F85): shared/legacy secret possession alone
      cannot read the corpus; every minimized/paginated access has immutable member attribution and
      a durable synchronous audit; holder inventory, key/session rotation, and credential-array
      retention disposition are complete. The owner answers the two F85 questions explicitly.
- [ ] **Raw staff/client directories are minimized** (F86): anonymous raw-table reads are revoked;
      purpose-specific active projections expose only fields each surface needs; inactive rows and
      email/Slack/Linear/project mappings are protected; direct omitted-column tests deny.
- [ ] **Verification services are resilient** (F87): denials are uniform, request controls/alerts
      and bounded audit retention are deployed, verifier/audit outages fail closed, and TEST-only
      burst/quota/timeout/recovery exercises are green without real secrets.
- [ ] **Owner decides the operational read-confidentiality model** (F88): either legal/client review
      explicitly accepts every currently exposed field as public and tokens as UI/write-only, or raw
      anon policies are revoked behind principal/client/role-scoped projections and direct REST,
      cross-client, inactive, cache/stale-tab/mobile/second-device denial passes. Until then token
      enforcement is not a read-confidentiality gate.
- [ ] **Token validation evidence cannot false-green** (F89): telemetry separates credential-valid
      from access-allowed, binds active client/current token revision, and a machine report requires
      a fresh exact valid event for every active client. The present seven-day window has zero valid
      events and is not go-live evidence.
- [ ] **Fix-pack landed in #813** (audit B-section): per-client allowlist gate (F02/F23),
      Kasper linkage predicate (F04), 401→sign-in dialog (F10), quarantine notice (F21),
      batch-picker team-filter + duplicate disambiguation (F19), +2d overdue bump ported per
      D-30 (F20), sync-drain lane for flipped teams (F07), oldest-pending-age pager (F16),
      monitors made flip-tolerant (F08).
- [ ] **Production-write TEST contract resolved** (F06): owner/implementation chooses the
      service-only spec contract or a newly justified browser-safe alternative; SPA, gateway, and
      one cross-boundary test agree. F51 additionally requires exact-pinned dependencies/CLI,
      lock/integrity data, a complete all-24 source-closure/JWT/release manifest, and independent
      downloaded server fingerprints. Discover and drill a supported exact-artifact restore route;
      until then, never call a same-SHA rebuild an exact rollback.
- [ ] **Authority vocabulary is singular** (F55): every browser, EF, reconciler, n8n guard, flag
      writer, and runbook accepts exactly `linear|syncview`. Remove/migrate the backend-only
      `supabase` alias, reject missing/malformed/legacy values consistently, and pass one
      all-consumer TEST contract/readback drill before changing `prod_authority`.
- [ ] **Intake migration applied** (`production_intake_append` RPC) and pilot-verified on the
      TEST client.
- [ ] **Intake cannot acknowledge work it has not durably accepted** (F44): every legacy/native
      submit returns an idempotent receipt only after durable persistence, the browser awaits it
      and preserves the draft, and missing mapping/credential/plan/roster plus partial-create,
      timeout, retry, duplicate-click, dead-letter, alert, and replay drills pass on TEST.
- [ ] **Intake never invents an unfinishable component** (F101): owner either enforces the locked
      paired Video+Graphics model by removing/rejecting single-team intake, or ratifies explicit
      active-component semantics end to end. Classify and repair/migrate every existing single-link
      row; absent legs are N/A rather than `In Progress`. Overall/client-ready status, Calendar,
      Samples, queues, bulk actions, comments/alerts, artifacts, and every persona pass all-mode TEST
      coverage before #813 merges or either team becomes writable.
- [ ] **Project selection is complete** (F45): every paginated source reaches
      `hasNextPage=false`, exposes a completeness/version readback, and exactly matches the
      canonical client/team mapping in an anonymized set report; a partial read cannot populate
      the dropdown or clear a draft.
- [ ] **Card resolvability sweep = 0 failures**: every active Linear-linked calendar slot
      resolves to exactly one mirror row; the ~60 missing rows backfilled (F11).
- [ ] **Client-token distribution rebuilt safely** (F03/F33): the public Clients Info sheet
      contains **no** review-token column; a staff-authenticated exact-client endpoint powers all
      four copy-link builders; then every SMM re-shares their clients' links. D-31's sheet
      mechanism is blocked pending the explicit owner decision in F33.
- [ ] **Track-A writers actually enforce auth** (F35): all six Calendar/Samples/settings write
      functions authenticate and authorize the exact client/operation, derive actor server-side,
      and emit real write-attempt telemetry; anonymous negative probes are green and the 72-hour
      zero-unkeyed-write gate is measured from those attempts, not sign-in events.
- [ ] **Rollback cannot reopen anonymous writers** (F67): authenticate/scope every reachable n8n
      Calendar/Samples/settings fallback or retire it; enumerate direct callers and stale tabs; run
      positive/negative TEST probes against every live fallback and prove per-client rollback,
      routing-flag read failure, and EF 4xx/5xx/network failure keep the same authorization boundary.
      Dependency failure must fail visibly/retry authenticated work, never silently downgrade.
- [ ] **Client onboarding/offboarding is atomic and authenticated** (F69): one idempotent server
      receipt creates/reads back the active client, exact team/project mapping, protected token
      mint/revision/revocation, and every required Track-A routing/policy enrollment—or static
      allowlists are replaced. A fake TEST client proves first authenticated writes and teardown
      immediately denies its token with no fallback.
- [ ] **Native concurrency is fail-safe** (F36): every Calendar/Samples/Production mutation sends
      an expected canonical version; stale requests create neither state nor outbox intent, return
      409 with the current row, and the browser offers compare/reapply instead of silent overwrite.
- [ ] **Production identity is real** (F37): “My issues,” “Assigned to me,” own-team scope, comment
      scope, and actor attribution use the server-verified immutable member ID; the TEST matrix is
      green for every active creative and unsigned/revoked sessions show no personal queue.
- [ ] **Foreground Production converges** (F95): an all-day-open creative tab receives bounded
      assignment/status/due/artifact/comment changes from another device without requiring blur,
      backgrounding, or reload. Realtime/poll fallback, last-success age, stale UX, manual refresh,
      backoff, and focus/scroll/draft preservation pass two-tab TEST drills.
- [ ] **Personal work is touch-mobile discoverable** (F96): below/at/above the 900px breakpoint, a
      fresh creative can switch between team Issues and My issues without a crafted URL or hardware
      keyboard. Deep link, back, reload, account switch, zero-row, portrait, and landscape tests pass.
- [ ] **Client links fail closed and revoke reads** (F38): enforced-mode verifier errors cannot
      load/cache client access; the verifier requires an active client/current revision; verdicts
      are short-lived; same-tab reload, focus, second-device, offline-return, offboarding, and
      token-rotation drills purge all client state. F88's direct-read decision is separately closed.
- [ ] **Auth rollback preserves the security boundary** (F70): after enforcement, there is no
      routine global return to permissive. Fix/revert the failed verifier/caller while auth stays
      enforced; any emergency bypass is scoped, owner-approved as a security incident, monitored,
      expires automatically, purges caches/sessions, and has compensating server containment.
- [ ] **Creative comment reads are team-scoped** (F39): the protected reader resolves the target
      server-side, returns a non-enumerating denial cross-team, records non-secret principal/target
      allow-deny audit, applies request controls, and passes own-team/cross-team tests for both roles.
- [ ] **Existing card threads are migrated and replyable** (F42): every active linked
      Calendar/Samples root and reply has one composite-scoped normalized identity; unresolved and
      duplicate-ID cases are classified; an existing-root TEST reply survives projection/reload.
- [ ] **Comments have one truth across every persona** (F43): plain comment, tweak, reply, edit,
      resolve, reopen, delete, and Production-origin Client-visible paths use one canonical
      lifecycle, with exact audience enforcement on real tokened TEST client links.
- [ ] **Samples Finish history is durable** (F65): `kasper_finish_log` exists in schema, every EF/
      fallback allowlist and mirror preserves it, and Finish/re-finish/undo/retry survives refresh
      and a second TEST device with exact append-only equality.
- [ ] **Samples GA boot semantics are one truth** (F73): prepaint, staff deep-link, client portal,
      ordinary navigation, and `_sxrEnabled()` all default on unless the explicit sticky opt-out is
      set. Fresh/returning desktop, mobile, card links, reload, second device, and token failures pass;
      CI asserts behavior rather than copying a stale expression.
- [ ] **Only current Samples/reconcile procedure is executable** (F75): historical rebuild/go-live/
      parity guides remain clearly non-operative, the current generated topology owns every action,
      and a stale-epoch check rejects default-OFF, inactive-graph-as-live, anonymous-fallback-as-safe,
      or obsolete cadence instructions in operator docs.
- [ ] **Workload follows per-team authority** (F40): flipped teams read the reconciled native
      adapter with native links/realtime/catch-up and no Linear fallback; the parity report resolves
      stale ghosts, top-level visibility, CON/STR, parents, clients, assignees, and mixed authority.
- [ ] **Legacy multi-source reads fail closed** (F29): rotate/remove failed sources, page every
      source, require expected/successful-source and visibility-set completeness, skip destructive
      Workload mark-and-sweep on degradation, and preserve stale UI data with a visible warning.
- [ ] **Video assignment policy is owner-ratified and atomic** (F30): use a fully paged current
      nonterminal workload for active eligible editors (or the explicitly chosen alternative),
      deterministic ties/leave rules, and concurrency-safe allocation; prove >50, >1,000, batch,
      simultaneous-intake, and live anonymized ranking parity.
- [ ] **Manual assignment uses one server-authoritative eligible roster** (F94): picker and gateway
      require active compatible creative role/team and, until retired mode, an active Linear mapping.
      Ineligible, unmapped, provider-inactive, cross-team, or stale-picker targets fail before native
      state/outbox writes. Owner explicitly decides whether admin/SMM may ever own creative work.
- [ ] **Production calendar-day semantics are stable** (F99): owner ratifies one business-zone or
      explicitly viewer-local contract; one on-demand clock powers relative parsing, quick choices,
      today highlighting, overdue display, and writes. Long-open tabs re-render at the next midnight
      and on return. UTC±, DST, midnight, leap-day, and mouse/keyboard/bulk TEST cases pass.
- [ ] **Due picker preserves the exact selected year** (F100): quick options and calendar cells carry
      ISO values, existing rows seed/select from `dueRaw`, mouse/keyboard/bulk paths agree, and
      Dec→Jan, leap day, explicit-year input, far-future navigation, and multi-select tests pass.
- [ ] **Staff credentials are individually revocable and attribution is immutable** (F31): remove
      inactive roster access, rotate the shared creative credential, invalidate old devices, and
      bind each accepted write to a server-resolved member/session ID. If the owner accepts any
      temporary shared-key residual, record the exact risk, controls, expiry, and offboarding proof.
- [ ] **First-flip mutations survive Linear unavailability** (F32): native intake/status/comment/
      due/assignee operations use reviewed native mappings and commit while Linear reads/writes are
      unavailable; mirror work may queue, but no synchronous Linear dependency may block the user.
- [ ] **Legacy inbound topology is deliberate and machine-proved** (F46): do not count
      `MJbMZ789B5ExZz9x` as active/realtime merely because its saved graph is authority-gated. Owner
      chooses repaired/published fast path versus reconciler-only SLA; the chosen path passes TEST
      drills and a preflight records active state, active-version/node fingerprint, and last-green
      execution. Never blind-publish the current unexplained post-crash saved graph.
- [ ] **Current Editors reader contained immediately** (F48): authenticate it, restrict the allowed
      audience/range, remove embedded credentials into managed storage, and prove denial/error
      behavior before go-live. Its eventual B5 replacement separately needs exact load,
      finish/open, timeline, event-time-assignee, paging, cache, and full-week parity.
- [ ] **Creative status reaches every reviewer from one authority** (F50): implement a
      transactional deliverable→card projection with CAS/idempotency or make every downstream
      Calendar/Samples/SMM/Kasper/client reader use deliverable status. Both-team TEST walks across
      refresh, realtime loss, second device, concurrency, retry, and rollback are green.
- [ ] **Graphics can deliver canonical media** (F53): protected file/link write or first-class
      picker updates `deliverables.file_url`, preserves actor/time/replacement history, and projects
      the correct card asset. SMM Approval rejects media-less work; a fresh TEST intake completes
      every review/tweak surface.
- [ ] **Inactive-client work is quarantined server-side** (F54): ordinary queues exclude it and
      status/comment/due/assignee mutations reject it unless audited recovery mode is active.
      Reconcile the current private cohort and prove zero unreviewed inactive-client work.
- [ ] **Title-provider credential incident closed** (F52): move the replacement to managed n8n
      credentials, inventory the complete workflow/version/export/
      backup population and access, review provider usage privately, and pass TEST title success +
      failure drills. Order: restrict access immediately; stage/prove the managed replacement on
      TEST; owner revoke/rotate; then finish the broader census while monitoring unknown consumers.
      No value enters this repository.
- [ ] **Submit graphics path drilled live on the private TEST fixture only** against the deployed
      EF, including real GRAPHIC_TITLE_* generation (F12). No real-client write is induced.
- [ ] **Every load-bearing n8n workflow has proved error delivery** (F09): a generated live-settings
      census shows the intended handler on every active graph, and one sanitized TEST-only failure
      receipt per workflow reaches the owner. The handler's existence is not evidence of wiring.
- [ ] **Non-n8n inbound-divergence pager live + pager last-mile proven** with a synthetic DM
      (F09/B6), including proof it still fires while n8n execution is unavailable.
- [ ] **Alert rollback is lane-scoped** (F66): stopping Linear-inbound anomaly delivery cannot
      disable onboarding fallback alerts or any unrelated consumer of a shared project secret;
      both routes pass independent TEST sends and kill/readback drills.
- [ ] **Backup package built per D-1** (F13/F49): live Pro truth is recorded (2026-07-13: seven
      completed daily physical backups / seven-day retention, PITR off, database disk 0.45 GiB
      used); 6-hourly independent export + freshness alarm are live; PITR is enabled/read back for
      the risky window; and one timed scratch restore + replay verification succeeds. Owner answers
      from Dashboard Usage/Billing: **what is current egress, and is the spend cap on or off?**
- [ ] **n8n quota fire resolved** (F01): burner identified/killed, hard-stop vs overage known,
      headroom projected past the flip window.

**People gates (owner/Kasper):**
- [ ] **100% of the owner-approved active roster can sign in** — reconcile HR/current staffing,
      deactivate departed or duplicate rows, invalidate their credentials/devices, and then record
      only anonymized active/verified counts from server evidence. A stale denominator or a sign-in
      attributed to a departed row is not readiness (F31/F64).
- [ ] **Exact-recipient notifications proven** (F15/F47): active members have immutable native
      notification mappings; assignment, tweak, and URGENT TEST sends return/persist the intended
      member plus destination/message receipt before the UI says “Sent.” Missing, inactive,
      ambiguous, wrong-team, and provider-failure cases remain visibly pending/retryable and alert.
      (The retained legacy sample was mapped; this gate does not claim a historical missed mention.)
- [ ] **D-9 nightly roller** neutralized per the touchpoint-inventory owner actions, OR
      owner-signed detect-only risk acceptance; the shared `Form` API key consumer-mapped
      before any rotation (F14).
- [ ] **D-8/D-30 confirmed in code**: the +2d overdue bump behavior exists in the native path
      (owner chose KEEP, 2026-07-13).
- [ ] **Comms drafted** for parity-arm day (F24): "SyncView-relayed comments in Linear show
      author 'SyncView Mirror' with the real name in the body; if a tweak seems missing in
      Linear, check SyncView."
- [ ] **Supabase-outage table-top passed** (F41): last-known authority is available offline, the
      automation hold/manual-merge path is executable, and every Linear-authoritative versus
      SyncView-authoritative team receives the correct instruction from FLIP_RUNBOOK R3.

## Phase 0.5 — Merge #813 DARK

- [ ] Create/deploy/read back `write_ui_reroute_clients`, prove its absent/malformed state fails
      safely, then merge #813 with the value = TEST only. **Nothing changes for real
      clients or staff** — their buttons still use the legacy paths.
- [ ] Same window: redeploy production-write from the merge commit; run the TEST drill; walk
      the TEST client through Create-Post (latest batch + new batch), Submit, approve, tweak,
      comment end-to-end.
- [ ] Passively observe one organic real-client save/approval through the legacy path, or prove
      the dark behavior with a non-enrolled TEST fixture. Do not induce a production write.

## Phase 0.75 — Enforce client-link auth before real traffic (F97)

- [ ] **All Phase-0 auth/read/write gates remain green on one unexpired preflight**: especially
      F31/F35/F38/F67/F69/F70/F76–F89/F91. Phase 0.5 remains TEST-only and is not evidence that a
      real client can be enrolled safely.
- [ ] **Exact current-token roster proof is green** (F89): every active client has one fresh
      `credential_valid=true` event bound to its current token revision; missing, extra, stale,
      inactive, or ambiguous rows fail the gate. No token or client identity enters public output.
- [ ] Deploy/read back F38's fail-closed verifier and browser changes, rotate the verdict/cache
      epoch, and purge stale permissive verdicts, client DOM/data, channels, and write state.
- [ ] The owner executes FLIP_RUNBOOK §F5's single CAS from exactly `permissive` to `enforced`,
      reads back exactly `{"mode":"enforced"}`, and records the flag event plus the same preflight
      evidence handle in `EXECUTION_LOG.md` and ROLLBACK Live State.
- [ ] On TEST, missing/invalid/expired/rotated/inactive credentials and verifier 5xx/timeout/offline
      all deny reads and writes across reload, foreground return, second device, mobile, and stale
      tab; a current exact-client credential still works. If any case fails, **do not enter Phase 1**.
      Preserve enforcement and contain/fix the specific caller or verifier per F70.

## Phase 1 — Staged parity soak (real traffic, Linear still boss)

- [ ] Read back `auth_enforcement={"mode":"enforced"}` and the still-current Phase-0.75 proof.
      A permissive, missing, malformed, stale, or unproved value blocks every real cohort (F97).
- [ ] **TEST and real-client divergence are separate signals** (F90): TEST-only churn remains visible
      in a diagnostic but cannot increment the real-client soak/pager criteria; mixed, TEST-only,
      and real-only fixtures pass and all public output uses private TEST notation.
- [ ] Arm the parity lane: `linear_legacy_parity_enabled` → enabled (FLIP_RUNBOOK §F4).
- [ ] Enroll a first small cohort (2-3 real clients) in `write_ui_reroute_clients`. Their
      staff/client/Kasper writes now flow through the gateway and land in Linear via the
      parity drain — same outcome as before, new pipes.
- [ ] Watch 2-3 days: reconciler 0-diffs, drill green, no oldest-pending-age alerts, no
      quarantine/409 noise, spot-check tweak comments arriving in Linear.
- [ ] Enroll the rest of the roster in cohorts. Full-roster clean for **~1 week** = D-28's
      soak satisfied.
- [ ] **Parity incident rehearsal (F58):** for a cohort fault, stop cohort mutations and remove the
      affected cohort from `write_ui_reroute_clients`; for systemic/unknown bad Linear writes, set
      F4 `false` and F2 `off`, read both back, preserve/classify queued intents, and follow FLIP
      RUNBOOK R1. Prove F2 alone does not masquerade as a parity kill.
- [ ] During the soak: after F37 is fixed, complete Rocio's full day-one desk walk (B3). F36's
      initial collision already failed; run its remaining mutation/409 recovery matrix rather than
      repeating only the same status collision. The walk starts with a newly-created TEST graphic,
      attaches/replaces its real delivery link, and proves it appears through SMM, Kasper/client,
      tweak, refresh, and second-device review (F50/F53).
- [ ] **Inactive-client work is quarantined** (F54): ordinary personal/team queues exclude inactive
      clients; an explicit role-gated recovery view owns any retained rows; writes cannot silently
      advance them. Privately reconcile the current cohort and record
      `zero_unreviewed_inactive_client_work` before Graphics flips.

## Phase 2 — Flip Graphics (Rocio)

Pick a low-activity window.
1. [ ] Toggle PITR ON for the flip week (D-1; owner dashboard).
2. [ ] Tell Rocio: work in SyncView only; problems → tell Sidney, never fall back to Linear
       silently.
3. [ ] **Arm the mirror before authority (F98):** while both teams still read back `linear`, set
       `linear_outbound_enabled` → `live` (FLIP_RUNBOOK §F2), read it back, and require one fresh
       healthy drainer/credential/pager heartbeat. Immediately before and after it, prove exact
       zero **both-team** real, non-parity rows in `pending|failed|shadow_ok`; owner-classify/resolve
       any residue and restart the proof. The heartbeat must show zero normal-lane writes; any write
       must equal expected, acknowledged `legacy_parity_written` from the still-armed parity cohort.
       Authority-paused nonzero is not green: it can starve the global batch or be released by F1.
       Any failure stops here with both teams still Linear-authoritative.
4. [ ] Only after step 3 is current, set `prod_authority.graphics` → `syncview` (FLIP_RUNBOOK §F1)
       and read back **both** flags. Never open authority first and hope F2 succeeds afterward.
5. [ ] Verify the first real intake has a canonical, visible artifact before SMM Approval and the
       deliverable status reaches the linked Calendar/Samples card and every reviewer (F50/F53).
6. [ ] Verify her first real write lands in Linear via the F07 sync-drain lane within the approved
       seconds-scale SLO. **Hard stop:** do not enter this phase unless F07 is shipped and proven;
       a 10–60 minute legacy-poll delay is not an acceptable fallback.

## Phase 3 — Watch the Graphics window

- [ ] Reconciler 0-diffs; oldest-pending-age quiet; drill/audit lanes green (flip-tolerant
      per F08).
- [ ] Kasper's queue shows her natively-created thumbnails (F04 fix proven live).
- [ ] Apply D-29 on anything found. Team rollback remains blocked until F27's audited per-team
      quarantine/classify/replay/discard tooling exists. Follow FLIP_RUNBOOK §R2: stop new writes,
      snapshot and classify every team intent, replay only owner-approved rows, prove a machine-read
      team zero, and only then change authority. Never use the default drainer as rollback proof.

## Phase 4 — Flip Video

Repeat the Phase 2 human/readiness gates and F1 authority action for `prod_authority.video` once
Graphics is boring, but **do not rerun F2**: normal outbound was enabled globally during the
Graphics flip and must already be live/read back. Re-prove both F2 and F4 current state, **exact
zero real non-parity Video rows in `pending|failed|shadow_ok`**, and a fresh healthy heartbeat before
Video F1; classify/resolve residue instead of releasing it. Re-prove all four editors signed in,
tweak-delivery comms sent (F24), and exact-recipient assignment/tweak/URGENT receipts proven.

## Phase 5 — B5: retire Linear (its own project)

Follow **TRACK_B_LINEAR_REPLACEMENT_SPEC.md §13** (D-22's roughly one-week dual-ready fallback,
archive-completeness + full private export, then the owner-gated retirement order with a proved
inverse per action — Workload feeder,
tweak-comments, editors-week, inbound, readers). This post-flip fallback is separate from D-28's
pre-flip parity-soak week. Assign an owner + ticket per replacement before starting.
Before retiring `editors-week`, require full §9.11 UI/semantic parity: load/error/empty states,
finished versus still-open work, timelines/week navigation, production scope, event-time assignee,
complete issue/history paging, historical-roster behavior, cache, and failure UX. Matching delivery
totals alone is not a retirement gate. Verify the already-inactive `MJbMZ789B5ExZz9x` topology from
live readback; do not list “deactivate it” as newly completed teardown work.
- [ ] **Linear-free retired epoch built but not prematurely activated (F32/F61):** an isolated
      service-only TEST override removes Linear validation, eligibility, IDs, and new outbox
      enqueues transactionally; full TEST mutations pass with Linear unavailable and create zero
      intents. Keep the real retired-epoch flag disabled throughout the dual-ready grace.
- [ ] **End-of-grace activation order proven (F58/F61/F92):** freeze human/app/service writes;
      set/read F4
      parity false; classify/replay/disposition final intents and prove both teams zero; set/read F2
      normal outbound off; run only a dry-run/detect-only final reconcile. Any diff/would-enqueue
      aborts and returns under the freeze to F2 live plus classify/drain/disposition and a fresh
      per-team zero proof. Only a final dry-run zero may proceed to archive/export and atomic
      retired-mode activation/readback. Prove a private TEST mutation creates zero outbox rows before
      teardown/resume.
- [ ] **The end-of-grace freeze is server-enforced** (F61): a team-scoped maintenance/cutoff state
      or atomic high-water protocol rejects every browser, stale-tab, retry, service, and automation
      mutation with explicit UX while the final zero/export/epoch transaction runs. TEST races prove
      no accepted write can cross the boundary; a human instruction to stop is insufficient.
- [ ] **No destructive import rollback is represented as ready** (F62/F68): preserve both imports
      by default. Any removal requires a fresh dependency/version graph, owner-approved disposition,
      assertion-bearing transaction, and full TEST/scratch restore rehearsal.
- [ ] **Completed migration IDs cannot be reused** (F103): the executed comment-import record stays
      non-runnable; a server-side completion ledger/CAS rejects consumed IDs before the first RPC.
      Any future migration has a fresh owner-approved ID, immutable source checkpoint, exact current
      dry run, script/schema commit, expiry, TEST rehearsal, and dependency-safe recovery. CI finds
      no active apply/delete/recovery recipe in any executed or historical playbook.
- [ ] **Calendar-v1 cleanup uses a new owner-approved plan** (F104): the old Phase-4 deletion recipe
      remains quarantined. Before removing any flag/fallback/symbol, measure opt-out and caller use,
      ratify replacement outage recovery, scan whole-repo consumers, update README/System Map/
      ROLLBACK together, and pass v2-on/off, Supabase/n8n failure, metadata/banner, save-concurrency,
      Calendar/client/Kasper/Films, focus/mobile/second-device tests. Every object also passes F60.
- [ ] **Archive is usable and assets are rescued (F34):** a role/audience-scoped archive reader is
      live; issue/comment counts and hashes match the private export; every Linear-hosted image/
      attachment is rescued/relinked or explicitly owner-dispositioned; retrieval/restore drills
      pass with `zero_unreviewed_image_gaps`.
- [ ] **Each teardown action has a proved inverse (F60):** exact private restore object, documented
      recreate/restore command, machine readback, owner, and drill. Prefer deactivate/archive;
      never delete a webhook/workflow graph or rotate a credential under a generic reversibility claim.
Note (F26): retiring Linear does NOT retire n8n — ~20 non-Linear webhooks (templates, briefs,
filming plans, TikTok, hook library, weekly Slack, content-ready…) remain until their own
migrations complete. New-client onboarding must atomically mint mapping + token + authenticated
Track-A routing/policy enrollment and prove its first EF write (B2/F69) before B5 makes Linear-side
creation impossible.

---

## Rollback — always through FLIP_RUNBOOK §R2

Short version: **stop new writes + disable/read back the involved F2/F4 lane(s), both if unknown/mixed → immutable team snapshot → classify every intent →
replay/quarantine/discard with owner reason → machine-read team zero → flip authority back → tell
the team → fix → re-soak → re-flip.** This is not yet one-click; the authority reversal is blocked
until F27's tooling exists. Never substitute the default drainer or a global green summary.
