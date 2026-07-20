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
3. **One-click team rollback remains live-BLOCKED (F05/F27).** PR #894's candidate passed an
   isolated TEST transaction, but is not applied to the live project. Immediate containment is stop that team's new
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
| `write_ui_reroute_clients` | last verified live TEST-only allowlist (`clients:[<TEST_CLIENT>]`) | Required D-32 boundary; #850 merged the reroute code carried from `e3aa028`. Read the value fresh before any action; this dated row authorizes no flag change or real enrollment. |

Merged & live: #810 gateway (deployed), #811 guards + daily TEST drill + nightly shadow audit,
#812 mirror write-UI (locked for real teams), #850's dark Calendar/Samples/Submit reroutes,
62/62 client→project mappings, and Samples retirement + rename. The reroute cohort was last
verified TEST-only; no real-client enrollment is authorized by the merge or deployment.

> **IMMEDIATE PRIVACY CONTAINMENT — do not wait for Phase 0 (F64):** reviewed schema-only
> replacements pass the private count-only census but are deliberately excluded from this public
> candidate. GitHub expanded the historical row deletions even behind the attempted diff guard, so
> an ordinary scrub PR is unsafe. Use the owner-scheduled freeze and final-GO rewrite procedure in
> `docs/ops/GIT_HISTORY_PII_PURGE_2026-07-14.md`; restore the hash-matched clean files only inside
> the rewritten history. Public current files/history/PR refs/caches/forks/clones remain open.

---

## Phase 0 — Preconditions (ALL boxes before first real-client enrollment)

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
      **F27 evidence:** post-review-fix head `afee809`, run `29764430971`, artifact
      `8470167032` proved the per-team recovery statement, in-flight and unbound-receipt refusal, and F2/F4 behavior in a
      disposable PostgreSQL store. This is one action's evidence, not closure of
      the every-fence checklist item and not live-application authorization.
- [ ] **The complete Production browser gate is green before merge/flip** (F105): do not accept the
      fast PR subset alone. Locked live-read/zero-mutation and fully intercepted writable states are
      explicit; interaction/behavior/pixel lanes are authority-aware; unsupported operations remain
      guarded; no suite sends a live mutation. Require aggregate `npm run test:prod-polish` plus the
      long lanes on the exact candidate commit and review any visual packet locally in an
      access-controlled workspace. Public review-packet/Argos artifacts are forbidden under F122.
- [ ] **Public-repo hygiene is enforced** (F64): no new client identity, slug, account address,
      secret, or private fixture enters a commit. Keep the three reviewed schema-only replacements
      private until the coordinated rewrite; do not expose their row deletions in an ordinary PR.
      Privately preserve evidence and complete the owner/GitHub exposure, cache/fork, token-link,
      Support, force-push, reclone/fork, and anonymous post-rewrite assessment.
      A private tracked-exposure inventory and owner disposition exist for the wider repository;
      CI rejects new exposures.
- [ ] **Public Actions publish aggregates only** (F122): stop B1 row-plan JSON, live Production
      screenshots/review/Argos bundles, and reconciler roster/identifier logs/job summaries. The two
      artifact producers are temporarily disabled and all 414 named bundles are deleted; keep them
      disabled until the aggregate-only/no-upload PR merges, then prove the first post-merge run and
      re-enable deliberately. Sanitize the still-open reconciler logs, audit historical Argos builds,
      and record privacy/legal disposition. Recursive exact-schema canaries inspect archives/stdout;
      private generators refuse tracked worktree output. Retention is after—not instead of—sanitization.
- [ ] **Every public onboarding-media asset has proved publication rights** (F118): privacy/legal
      records source, people/voice/brand releases, licence, intended audience, retention and deletion
      duty for every tracked file. Replace uncertain media with fictional/commissioned/licensed
      examples; coordinate removals with F64 history/cache/fork handling; CI rejects any unclassified
      asset. Owner explicitly answers which existing files may remain publicly hosted.
- [ ] **P0 weekly-report exposure is contained** (F76): unauthenticated report/roster reads and
      writes now deny `401`, both raw-table reads deny `401`, and the signed service roster caller
      reaches its authenticated branch. The staged Admin/SMM caller merged with #836 and was
      browser-walked 2026-07-15 (Admin/SMM allow, creative/client deny; staff screens restored).
      Individual SMM scope, access-log review, integrity reconciliation,
      per-human sessions and the owner incident disposition remain required.
- [ ] **P0 onboarding-reader exposure is contained** (F77): all three onboarding list EFs deny
      anonymous/wrong-key requests with `401`; the staged Admin caller merged with #836 and passed the full
      browser/standalone walk 2026-07-15. CORS is still unconstrained,
      background discovery still needs a minimal opaque projection, and logs/private links/
      credentials plus the owner/legal notification disposition remain open.
- [ ] **P0 public Linear mutation routes are contained** (F91): status/comment bridges require an
      active immutable principal; video/graphics intake requires staff auth or an owner-ratified,
      server-minted short-lived exact-client capability; target/client/team are resolved server-side;
      audit, request limits, idempotency, and deployed anonymous/expired/cross-client negative tests
      are green. Owner explicitly answers whether `?intake=1` remains shareable and under what
      mint/expiry/revocation contract.
- [ ] **P0 Sales Intake caller authorization is contained** (F106): the owner ratifies Kasper-only,
      Admin-only, or both; an individually revocable active-member session binds the server-derived
      actor/role before any ledger, agreement, email, or notification side effect; exact action/scope,
      bounds, immutable audit, idempotency, and deployed no-key/expired/wrong-role/replay denials pass.
      Deactivate and use the manual process if this cannot be proved before go-live.
- [ ] **Project Central cannot clear live state from an unverified/partial save** (F123): active
      role/scope auth and audit protect load/save; source failures are explicit; complete input and
      relationships/counts/hashes validate before mutation; staged copy-on-write + revision/CAS +
      idempotency atomically promotes one version with an immutable backup/restore receipt. TEST
      empty/malformed/partial/stale/concurrent/lost-response and every clear/append failure.
- [ ] **Sales Intake completion and replay are truthful** (F107): one server-minted receipt owns the
      preview and request state; the server reads/CASes that state rather than trusting returned row,
      contract, or link values; duplicate/lost-response retries resume instead of recreating work;
      and the UI shows accepted/processing until required email/audit completion is durable. TEST
      provider failure, email failure, stale/wrong preview, partial commit, duplicate click, and retry.
- [ ] **Contract/payment callbacks verify native provider events** (F115): both routes validate the
      provider-native signature over the raw body, bounded timestamp, unique event ID, exact type/
      status/mode/account, and a server-owned agreement/payment correlation; persist the unique
      inbox event before 2xx. Prove stale/replay/wrong-account/wrong-sale/downstream-failure retries.
- [ ] **The two-of-two sales gate is atomic and exactly-once** (F116): one unique durable job owns
      “both verified gates → onboarding email,” with pending/sent/failed step receipts and a
      reconciler. A synchronized two-callback race, duplicates, lost response, child/email/HubSpot/
      stage failures and retries cannot lose or duplicate the communication.
- [ ] **Approved YouTube title text remains the text actually approved** (F109): owner ratifies
      material-edit semantics; an SMM or Collaborative client edit atomically invalidates/re-enters
      review and/or records an immutable server-generated old/new event tied to actor and row
      revision, with approval age visible. Test no-op/whitespace edits, both roles, concurrency,
      offline retry, undo, timestamp behavior, and second device.
- [ ] **Every media/caption approval is bound to the exact reviewed revision** (F113): Calendar and
      Samples record a server-owned per-component revision/hash at approval. Any material URL/text
      edit or same-link provider revision atomically invalidates/reopens review (or visibly ages the
      sign-off under an owner-ratified policy), emits an immutable actor/revision event, and returns
      the component to the right queue. Pass both surfaces, all reviewed components, exact role
      permissions, no-op normalization, concurrent approval/edit, offline retry/undo, refresh, and
      second-device tests before treating a green approval as release evidence.
- [ ] **Unknown client links fail closed before loading data** (F102): `?c=` alone grants no bypass;
      an allowed client and current token are resolved before data/cache/route entry. Unknown,
      malformed, unsupported-view, invalid-token, and every `c`+hash/`prod` combination show only
      the invalid-link surface and purge client/staff state. Production/staff routes require an
      individually verified staff session. Owner records the exact supported client-view allowlist,
      and fictional desktop/mobile/second-device/cache/history tests prove no staff fallthrough.
- [ ] **Legacy Samples client links preserve exact-client scope or fail closed** (F117): a verified
      `v=samples` client/token never enters generic SXR pins/preferences or Add-client switching.
      Bind the server capability to the dedicated client mount and every read/write, or show an
      explicit retired-link state. Pass old-data parity, cross-client denial, fresh/residual cache,
      invalid/rotated token, deep-link, refresh/back, mobile and second-device tests.
- [ ] **Samples Old read fallback is not used as writable recovery** (F57): `?sv2=0` and automatic
      REST→Sheet fallback belong to the dormant renderer. Its legacy writers may return success
      after Supabase updates while the Sheet branch failed. Any temporary old-code restoration is
      read-only or has one atomic read/write authority; prove stale-build/direct-caller zero and
      both-store parity before Phase 2 deletion.
- [x] **Thumbnail revision scanner is fail-closed and bounded** (F78): a mandatory dedicated
      scheduler signature is deployed; absent server credential returns `503`, wrong caller
      credential returns `401`, and successful calls expose aggregate counts only. TEST-only
      same-link/no-write/change proof passed, the initial all-active scan checked 239 with 0 failed,
      and [the first scheduled run](https://github.com/sidney-afk/client-analytics/actions/runs/29370658087)
      completed green with all 239 unchanged.
- [ ] **Thumbnail folder resolver enforces originating scope** (F79): require an authenticated
      principal or signed internal job bound to the exact client/row, bounded and audited Drive work,
      least-field responses, and deployed missing/malformed/cross-client/correct-scope proof.
- [ ] **Thumbnail folder resolver writes use atomic CAS** (F80): the final write must compare exact
      normalized thumbnail URL plus row version/timestamp, treat zero affected rows as stale, and
      pass reversed-completion, retry, clear/archive, and Calendar/Samples concurrency tests.
- [ ] **Public onboarding capture is abuse-bounded** (F81): server-minted short-lived submission
      ownership, rate/CAPTCHA, strict byte/schema/kind limits, conditional/versioned updates,
      immutable creation time, sanitized final-only alerts, and spam/replay/oversize/foreign-ID/
      beacon-race/alert-failure TEST cases are green.
- [ ] **Filming-plan roster/document links are private** (F82): unauthenticated EF GET now denies
      `401`. Merge the protected Pages caller before revoking anon table SELECT; then prove both
      paths are closed together. The public row-bearing seed remains F64 rewrite work. Least-field,
      principal/client/role-scoped SMM/Kasper/Admin reads pass anonymous/cross-client/mobile/
      second-device tests; Google-document sharing and access logs are privately reviewed.
- [x] **Thumbnail revision metadata is private** (F83): raw browser table access returns `401` and
      unsigned private-object access returns `400`; the least-field exact role/card projection
      succeeds while cross-client scope returns `403`; only short-lived signed image URLs leave the
      backend. Desktop/mobile Previous/Current comparison passed on an owner-selected real card.
- [ ] **Credential vault uses least-secret, auditable delivery** (F84): list is metadata-only;
      individually revocable active-member sessions bind immutable actors; one-secret reveal audits
      synchronously/fail-closed; old plaintext passwords never enter history; shared/legacy keys are
      retired; direct API/DevTools/copy/offboard/cross-client/first-edit tests pass.
- [ ] **Full onboarding reads bind an active admin** (F85): shared/legacy secret possession alone
      cannot read the corpus; every minimized/paginated access has immutable member attribution and
      a durable synchronous audit; holder inventory, key/session rotation, and credential-array
      retention disposition are complete. The owner answers the two F85 questions explicitly.
- [ ] **TikTok Pilot is compliant and eligible before review/posting** (F119): keep it disabled until
      privacy has no default and requires an explicit provider-returned choice, the exact music-use
      acknowledgement/commercial controls are present, source and sandbox tests agree, and product/
      legal records provider-backed eligibility for agency staff posting to client accounts.
- [ ] **Client analytics distinguish empty from failure** (F124): CLIENTS METRICS implementation is
      live-proved at version `b92fb693-1dd4-4ce2-a60e-98a1701c369d`; scheduled execution `287059`
      emitted 29/29 unique typed terminal receipts, completed 29 writes with zero write failures,
      preserved last-good on provider failure, and kept legitimate numeric zeros fresh. For each new
      client, require inclusion in that terminal receipt and retain roster/quota monitoring. The
      remaining blocker is TOP VIDEOS: publish per-client/platform
      expected/attempted/succeeded/count/freshness/error receipts, distinguish valid empty from
      provider failure, preserve visible last-good staleness, and alert on partial coverage. Its
      seven-day browser cache must show source age/degradation and cannot replace last-good from a
      bad HTTP response. Test every provider/state/partial/retry/cache-recovery case.
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
      enforcement is not a read-confidentiality gate. The thumbnail and two weekly-report tables now
      deny raw anon reads; filming_plans anon SELECT was revoked 2026-07-15 (post-#836); raw `clients` and the seven named direct-use tables
      remain intentionally unchanged until their minimum projections exist.
- [ ] **Token validation evidence cannot false-green** (F89): telemetry separates credential-valid
      from access-allowed, binds active client/current token revision, and a machine report requires
      a fresh exact valid event for every active client. The present seven-day window has zero valid
      events and is not go-live evidence.
- [x] **Fix-pack source landed via superseding PR #850 / `9968bd9`** (#813 closed unmerged;
      implementation commit `e3aa028`): per-client allowlist gate (F02/F23),
      Kasper linkage predicate (F04), protected-write 401 session invalidation/reverification with
      draft/action-intent preservation and retry only after fresh sign-in (F10),
      batch-picker team-filter + duplicate disambiguation (F19), +2d overdue bump ported per
      D-30 (F20), sync-drain lane for flipped teams (F07), oldest-pending-age pager (F16),
      monitors made flip-tolerant (F08).
- [x] **F21 startup popup removed by owner decision (2026-07-16):** stale pre-upgrade leftovers
      remain parked, silently and without auto-send; agents/ops can inspect the queue if ever needed,
      while scheduled reconcilers remain the Linear/SyncView drift-healing mechanism.
- [ ] **Production-write TEST contract resolved** (F06): owner/implementation chooses the
      service-only spec contract or a newly justified browser-safe alternative; SPA, gateway, and
      one cross-boundary test agree. F51 additionally requires exact-pinned dependencies/CLI,
      lock/integrity data, tracked config/deploy commands for all 24 slugs, a complete all-function
      source-closure/JWT/release manifest, and independent downloaded server fingerprints. Discover
      and drill a supported exact-artifact restore route; until then, never call a same-SHA rebuild
      an exact rollback.
- [ ] **Authority vocabulary is singular** (F55): every browser, EF, reconciler, n8n guard, flag
      writer, and runbook accepts exactly `linear|syncview`. Remove/migrate the backend-only
      `supabase` alias, reject missing/malformed/legacy values consistently, and pass one
      all-consumer TEST contract/readback drill before changing `prod_authority`.
- [ ] **Intake migration applied** (`production_intake_append` RPC) and pilot-verified on the
      TEST client.
- [ ] **Intake cannot acknowledge work it has not durably accepted** (F44): every legacy/native
      submit returns an idempotent receipt only after durable persistence, the browser awaits it
      and preserves the draft, and missing mapping/credential/plan/roster plus partial-create,
      timeout, retry, duplicate-click, dead-letter, alert, and replay drills pass on TEST. Server +
      browser fix merged & live with #836 (`c7b325e`, 2026-07-15); the failure/double-click/timeout
      drills against the deployed build are the remaining step.
- [ ] **Intake never invents an unfinishable component** (F101): owner either enforces the locked
      paired Video+Graphics model by removing/rejecting single-team intake, or ratifies explicit
      active-component semantics end to end. Classify and repair/migrate every existing single-link
      row; absent legs are N/A rather than `In Progress`. Overall/client-ready status, Calendar,
      Samples, queues, bulk actions, comments/alerts, artifacts, and every persona pass all-mode TEST
      coverage before any real-client enrollment or either team becomes writable.
- [ ] **Project selection is complete** (F45): every paginated source reaches
      `hasNextPage=false`, exposes a completeness/version readback, and exactly matches the
      canonical client/team mapping in an anonymized set report; a partial read cannot populate
      the dropdown or clear a draft.
- [ ] **Card resolvability sweep = 0 failures**: every active Linear-linked calendar slot
      resolves to exactly one mirror row; the ~60 missing rows backfilled (F11).
- [ ] **Cards expose native ownership and navigation** (F112): for each flipped component on both
      Calendar and Samples, the card joins its native deliverable to the current active assignee
      (or an explicit unassigned/inactive/degraded state) and **View sub-issue** opens the stable
      Production detail in a new tab. No flipped-team card opens/edits Linear. Mixed authority,
      reassignment, stale/missing linkage, mobile, return refresh, second device, and Linear-down
      cases pass; the candidate suite asserts the card surfaces themselves, not only Production.
- [ ] **Client-token distribution rebuilt safely** (F03/F33): the public Clients Info sheet
      contains **no** review-token column; a staff-authenticated exact-client endpoint powers all
      four copy-link builders; then every SMM re-shares their clients' links. D-31's sheet
      mechanism is blocked pending the explicit owner decision in F33.
- [ ] **Track-A writers actually enforce auth** (F35): all six Calendar/Samples/settings write
      functions (live post-#836, 2026-07-15; calendar-upsert v38 + sample-review-upsert v39 from the
      merge SHA) authenticate and authorize the exact client/operation, derive actor server-side,
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
- [ ] **Public onboarding cannot launch privileged provisioning** (F128): anonymous capture is
      separated from Drive/CRM/Slack/vault side effects. Owner ratifies invitation-only versus
      public-capture-plus-staff-approval; one server-correlated sale/capability and immutable staff
      decision create a bounded idempotent job. Provider sandboxes/intercepts, canonical TEST
      identity, captured inverses and exact readback make the fake-client drill non-production and
      fully reversible. Anonymous/replay/wrong-sale/forged-client/duplicate/failure tests create no
      real provider object.
- [ ] **No account-access value enters Slack, logs, alerts or exports** (F129): server-side allowlist
      projection structurally excludes login/recovery fields and future secret-class fields from the
      channel brief and fallback DM; only a vault receipt/count/status may leave the protected store.
      Privately inventory/delete/contain prior copies and rotate/revoke as incident review requires.
      Canary tests cover normal channel, fallback DM, retries, logs and future unknown fields; UI,
      workflow description and lifecycle docs state the verified boundary.
- [ ] **Onboarding acknowledgement is truthful and resumable** (F110): persist a server-owned job
      before returning success; distinguish `captured`, `processing`, `complete`, and `failed` in
      the client/staff UX. Duplicate clicks, lost responses, capture-only replay, and a failure at
      every credential/provisioning/enrollment step resume the same job to verified completion;
      they never take a duplicate-success shortcut or clear the only recovery handle. The Kasper
      inbox includes fallback/dead-letter work, exposes status and step age, pages/freshens safely,
      and provides audited acknowledge/retry/resume actions rather than an unbounded snapshot.
- [ ] **Operators start from the current intake** (F111): the SyncView standard/AI inbox plus its
      durable job/alert is the sole documented handoff. Do not wait for the replaced Notion form or
      its active-labelled but non-production-triggered legacy workflow; archive that object only
      through F60's restore-proof process after identifier-free zero-use evidence. Independently
      page on captured work without a staff acknowledgement so a failed notification or stale
      open tab cannot strand a client.
- [ ] **Native concurrency is fail-safe** (F36): every Calendar/Samples/Production mutation sends
      an expected canonical version; stale requests create neither state nor outbox intent, return
      409 with the current row, and the browser offers compare/reapply instead of silent overwrite.
- [ ] **Production identity is real** (F37): “My issues,” “Assigned to me,” owner-ratified team/
      assignment scope, comment scope, and actor attribution use the server-verified immutable member
      ID. The TEST matrix covers every active creative plus peer-assigned, unassigned, direct-link,
      account-switch and zero-row cases; unsigned/revoked sessions show no personal queue.
- [ ] **Foreground Production converges** (F95): an all-day-open creative tab receives bounded
      assignment/status/due/artifact/comment changes from another device without requiring blur,
      backgrounding, or reload. Realtime/poll fallback, last-success age, stale UX, manual refresh,
      backoff, and focus/scroll/draft preservation pass two-tab TEST drills.
- [ ] **Personal work is touch-mobile discoverable** (F96): below/at/above the 900px breakpoint, a
      fresh creative can switch between team Issues and My issues without a crafted URL or hardware
      keyboard. Deep link, back, reload, account switch, zero-row, portrait, and landscape tests pass.
- [ ] **Every Kasper subtab is touch-mobile discoverable** (F121): the tab row scrolls within the
      viewport, the active tab is revealed without page-wide overflow, and semantic tablist/tab/
      selected/controls plus roving arrow/Home/End keyboard focus remain visible. Owner ratifies Back
      history behavior. Test all eight keys at 390/768 and surrounding widths, real touch swipe,
      direct deep link/back/reload, 200% zoom/text scaling, portrait/landscape, populated layouts and
      second device—especially Onboarding, Sales Intake and Client Credentials. A denied tab must
      atomically canonicalize the active tab, URL hash, and saved subtab so reload cannot recur into
      an inaccessible surface.
- [ ] **Kasper Review/Messages failures are recoverable** (F130): cold and cached refresh failures
      render in the active tab, preserve any cache under an honest stale banner, and expose a visible
      keyboard/touch Retry. Pass Review and Messages cold failure, cached failure, retry success/
      repeat failure, tab-switch/abort race, mobile and keyboard tests; no indefinite skeleton.
- [ ] **B1 has a success-only durable checkpoint and typed terminal heartbeat** (F131): per-row
      writes, successful summaries, and failed summaries use distinct event types; only a complete
      write/readback advances the stored high-water. Failure at every write stage retries from the
      previous success and converges without skipping a planned issue. Monitoring requires the
      exact terminal type, `ok === true`, and matching expected/attempted/written counts.
- [ ] **Pager health is correlated, terminal, and lane-isolated** (F132/F09): every dispatch has a
      correlation ID and terminal receipt; one lane's failure cannot prevent another lane's dispatch
      or observation. Missing, failed, malformed, over-age pending, queue-depth, and mode-mismatch
      states page independently. An observer outside n8n proves the pager itself is executing.
- [ ] **Alert relay proves delivery and authenticates its source** (F09/F66/F81): HTTP acceptance
      is not Slack-delivery proof. Every caller uses authenticated source identity, a versioned typed
      schema, correlation/dedupe, and a terminal receipt. The onboarding fallback produces an
      actionable privacy-safe alert with no raw contact or notes.
- [ ] **Samples retains an independent cadence until pager isolation is proved** (F01/F132): if
      execution burn must be reduced before F132 closes, remove the pager's Samples dispatch rather
      than the independent GitHub schedule.
- [ ] **Repair-list and linkage alert policy is explicit** (F132): both page immediately with
      distinct state and throttle keys unless the owner records and tests another approved policy.
- [ ] **Client links fail closed and revoke reads** (F38): enforced-mode verifier errors cannot
      load/cache client access; the verifier requires an active client/current revision; verdicts
      are short-lived; same-tab reload, focus, second-device, offline-return, offboarding, and
      token-rotation drills purge all client state. F88's direct-read decision is separately closed.
- [ ] **Old builds are identified and rejected before mutation** (F127): embed the running build
      plus auth/authority/cache epoch, compare against a fixed same-origin manifest on root/index,
      direct/in-app Production and every onboarding alias, and send that identity on every protected
      read/write. Servers return `upgrade_required` before accepting a below-minimum caller. Owner
      defines the optional stale window and mandatory-release classes; mandatory updates cannot be
      dismissed, safely checkpoint drafts/queues, reload, and reverify identity. Pass cached-v1-first-
      check, deploy/revert, BFCache, offline-return, second-device, dirty-draft, queued-write and
      session-rotation tests; privacy-safe build/epoch telemetry proves population rather than
      treating the current banner as expiry evidence.
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
      lifecycle, with exact audience enforcement on real tokened TEST client links. Canonical
      persistence must succeed before any Linear/mirror side effect; failure retains the draft and
      queue with visible retry. Retry produces exactly one canonical mutation and, while mirroring is
      enabled, exactly one applicable mirror intent; retired mode produces zero mirror/outbox intents.
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
      Linear status metadata distinguishes true not-found from source failure, never returns
      full-success for a subset, and does not advance the five-minute success throttle on degraded
      fetches; retry only failed IDs while retaining last-good values.
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
- [ ] **Native Create Post keeps one canonical title** (F133): the SMM enters/accepts the title
      before commit; deliverable and card are transactionally equal; later rename CASes both and
      records one `title_change`. Pass latest/new batch, multi-post, retry/lost-response, pre/post-
      review edit, two-tab, offline/reload and exact Calendar/Samples/Production/mirror equality.
- [ ] **Native intake recovery is server-owned and reassignable** (F134): committed-but-unmaterialized
      work lives in one durable idempotent job/reconciler, not one actor's localStorage. A protected
      recovery inbox can resume or auditably reassign it after sign-out/offboarding/device loss without
      losing original attribution or blocking unrelated intake. Prove exact-once cards and zero orphans.
- [ ] **Calendar and Samples reorder works without a mouse** (F135): touch and keyboard users have
      explicit accessible move/position controls through the same CAS reorder. Pass physical iOS/
      Android, keyboard/screen reader, scroll arbitration, filters, concurrency, offline and second device.
- [ ] **Creative status transitions are server-authorized from current state** (F136): owner ratifies
      one role/current/next/team/assignee matrix; the server and picker enforce it. Reviewer/terminal
      regression, cancel, duplicate and peer-work actions require only the explicitly approved role.
      Pass the full 13×13 TEST matrix across list/All/My/direct-link, stale CAS, retry and two devices.
- [ ] **Video editors retain every distinct work asset** (F137): Production shows separately labelled
      Filming plan, Raw footage, Delivery/Frame folder and deliverable file with missing/invalid/
      expired/permission states; no priority fallback hides or mislabels another asset. Pass all 16
      presence combinations, native/backfill, reassignment, mobile, refresh and second device.
- [ ] **Native activity history is protected and visible** (F138): a team/role-scoped paginated
      reader renders stable actor/time/action/from→to history with loading/empty/stale/retry states and
      redaction. Pass event completeness/order/paging, denial, comments coexistence, mobile and second
      device before Linear history/Inbox retirement; `WIRED-PARITY.md` matches runtime truth.
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
      EF, including real `GRAPHIC_TITLE_*` generation (F12). The routine drill's explicit
      generation skip is not real-generation evidence. Retain `graphic_generation_verified:true`,
      `0/0/0`, unchanged-flags and cleanup receipts plus a provider-failure zero-write/recovery
      receipt. No real-client write is induced. **This checklist item is a closure requirement, not
      authorization:** before either run, bring the owner the exact TEST-only change and rollback.
      This docs reconciliation authorizes no drill, provider/secret change, runtime-flag change,
      or client write.
- [ ] **Every load-bearing n8n workflow has proved error delivery** (F09): a generated live-settings
      census shows the intended handler on every active graph, and one sanitized TEST-only failure
      receipt per workflow reaches the owner. The handler's existence is not evidence of wiring.
- [ ] **Non-n8n inbound-divergence pager live + terminal delivery proved** (F09/B6/F132): retain
      B6's sampled synthetic-DM success as happy-path evidence, then correlate acceptance through
      terminal owner delivery and prove the independent observer still fires while n8n is unavailable.
- [ ] **Alert rollback is lane-scoped** (F66): stopping Linear-inbound anomaly delivery cannot
      disable onboarding fallback alerts or any unrelated consumer of a shared project secret;
      both routes pass independent TEST sends and kill/readback drills.
- [x] **Independent backup package + timed scratch restore built per D-1** (F13): **DONE 2026-07-15
      (PR #840, merge `4f9d919`).** A 6-hourly export independent of n8n now runs on `main` with a
      versioned expected-corpus/schema/count/byte/hash manifest, fails closed, independently reads
      back every object from a private Google Shared Drive, never advances last-known-good on partial
      output, and alerts via the GitHub failed-run email to the owner (`sidney.laruel@gmail.com`).
      Proof run `29444939853` plus a 229 s scratch restore (exact counts, zero orphans) confirm it.
      The current weekly n8n run remains non-evidence and is superseded. PITR is owner-declined
      (accepted residual), so the flip-week PITR readback is intentionally skipped.
- [ ] **Capacity/egress evidence recorded** (F49): live Pro truth is recorded (2026-07-13: seven
      completed daily physical backups / seven-day retention, PITR off, database disk 0.45 GiB used).
      Owner still answers from Dashboard Usage/Billing: **what is current egress, and is the spend cap
      on or off?** Then run post-#850 bootstrap/mobile/cache load tests and set thresholds.
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

## Phase 0.5 — Dark merge/deploy checkpoint (#850 merged; remaining TEST proof open)

- [x] `write_ui_reroute_clients` was created/read back in the TEST-only posture, its guarded
      reroute source landed via #850, and real clients remain on legacy paths unless separately
      enrolled. Read the flag fresh before relying on this dated checkpoint.
- [x] Pinned manual run `29601466479` accepted exact `main@9d76df6`, deployed
      `linear-outbound` v33 before `production-write` v24, and passed all ten function
      fingerprints; an ordinary merge/push deploys neither Track-B writer.
- [ ] With separate owner approval for any live TEST/provider action, complete the remaining TEST
      drill and walk the TEST client through
      Create-Post (latest batch + new batch), Submit, approve, tweak, and comment end-to-end.
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
       `linear_outbound_enabled` → `live` (FLIP_RUNBOOK §F2), read it back, and require correlated
       terminal drainer/credential receipts plus an observer outside n8n (F131/F132), not a fresh
       pager timestamp. Immediately before and after it, prove exact
       zero **both-team** real, non-parity rows in `pending|failed|shadow_ok`; owner-classify/resolve
       any residue and restart the proof. The terminal receipt must show zero normal-lane writes; any write
       must equal expected, acknowledged `legacy_parity_written` from the still-armed parity cohort.
       Authority-paused nonzero is not green: it can starve the global batch or be released by F1.
       Any failure stops here with both teams still Linear-authoritative.
4. [ ] Only after step 3 is current, set `prod_authority.graphics` → `syncview` (FLIP_RUNBOOK §F1)
       and read back **both** flags. Never open authority first and hope F2 succeeds afterward.
5. [ ] Verify the first real intake has a canonical, visible artifact before SMM Approval and the
       deliverable status reaches the linked Calendar/Samples card and every reviewer (F50/F53).
6. [ ] Verify her first real write lands in Linear via the F07 sync-drain lane within the approved
       seconds-scale SLO. F07's implementation is deployed; this non-TEST timing receipt remains
       the proof. **Hard stop:** do not proceed to Phase 3 until it passes;
       a 10–60 minute legacy-poll delay is not an acceptable fallback.

## Phase 3 — Watch the Graphics window

- [ ] Reconciler 0-diffs; oldest-pending-age quiet; drill/audit lanes green. F08's monitors are
      flip-tolerant in source, but the latest inspected scheduled runs as of 2026-07-19 are red for
      distinct reconciliation/data-integrity signals; investigate those signals and require a
      fresh green window.
- [ ] Kasper's queue shows her natively-created thumbnails. F04's native-link predicate is merged;
      this checkbox is the required first-real-Graphics observation, not a source-completeness check.
- [ ] Apply D-29 on anything found. Team rollback remains live-blocked until PR #894's
      isolated-proved F27 quarantine/classify/replay/discard tooling is reviewed, applied, read back,
      and TEST-client drilled. Follow FLIP_RUNBOOK §R2: stop new writes,
      snapshot and classify every team intent, replay only owner-approved rows, prove a machine-read
      team zero, and only then change authority. Never use the default drainer as rollback proof.

## Phase 4 — Flip Video

Repeat the Phase 2 human/readiness gates and F1 authority action for `prod_authority.video` once
Graphics is boring, but **do not rerun F2**: normal outbound was enabled globally during the
Graphics flip and must already be live/read back. Re-prove both F2 and F4 current state, **exact
zero real non-parity Video rows in `pending|failed|shadow_ok`**, correlated terminal drainer/
credential receipts, and an observer outside n8n before
Video F1; classify/resolve residue instead of releasing it. Re-prove all four editors signed in,
tweak-delivery comms sent (F24), exact-recipient assignment/tweak/URGENT receipts proven, current-state
transition authorization green (F136), all four Video assets visible (F137), and activity-history
replacement agreed/proved to the gate chosen for F138.

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
- [ ] **Calendar recovery never splits read and write authority** (F125): withdraw `?v2=0` as
      writable rollback and treat automatic REST→Sheet fallback the same way. Sticky-off/fallback
      plus an EF-enrolled client is explicitly read-only until one atomic recovery mode couples its
      reader/writer (or journals/reconciles writes). Add server CAS
      for every mutable whole-card field and pass v2 on/off × EF enrolled/unenrolled/flag failure ×
      REST/fallback × edit/create/archive/reorder/import × cache/second-device/two-tab tests.
- [ ] **Sub-issue expansion is complete before any Calendar mutation** (F126): page children and
      required comments to exhaustion, reject partial GraphQL envelopes, and require an explicit
      complete receipt. Import, bulk-link and status adoption preserve prior state and write nothing
      on incomplete data; a parent is a leaf only after a complete zero-child result. Retire the
      legacy `/add-to-calendar` branch after zero-caller proof or give it the same durable contract.
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
