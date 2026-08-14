# FLIP RUNBOOK — owner-executable flag flips & emergency stops

**Who this is for.** The owner, alone, possibly in a hurry, without Codex. Every flip below is
copy-paste through the Supabase **SQL Editor** only; Table Editor is read-only for this runbook.
Created 2026-07-13 (audit F18 — the payload for "enforcing" that used to circulate silently
does nothing; the only value the code honors is `enforced`).

> **CURRENT GO-LIVE STATE: GO-CONDITIONS — forward flips stay forbidden until every open
> condition below is satisfied.** This block replaces the former "BLOCKED — DO NOT RUN ANY
> FORWARD FLIP" banner in the reviewed change that banner itself required ("remove this banner
> only in the same reviewed change that records all gate evidence" — this is that change,
> 2026-08-12). Every "blocked by the banner" / "gated by the banner" note elsewhere in this file
> now means: gated on this block.
>
> **Gates the old banner named that are now SATISFIED — evidence on record, kept, not deleted:**
>
> - **F27 per-team rollback** — installed from exact release
>   `968a895108beb2a2c41e86bb8b788115e35b14a0` on 2026-08-02; its reserved production drill
>   returned `F27_DRILL_RUNNER_OK`; the packaged verifier returned `F27_FINAL_VERIFICATION_OK`
>   with PASS across all 17 enumerated assertions. This proves the ROLLBACK; it never authorized
>   a forward flip and still does not.
> - **F50 — creative status projection** (2026-07-28 re-scope survivor, recorded here 2026-08-10
>   per OPEN_REPAIRS item 12): without it a post-F1 graphics status change reached no reviewer or
>   client surface. The fix (native status mapper + pull-only reconcile) is carried by PR #1053,
>   **MERGED 2026-08-10**.
> - **F40 — per-team workload authority** (the other re-scope survivor): the code was built and
>   shipped (the browser routes a SyncView-authoritative team's due dates to the native gateway,
>   so `workload-linear`'s `team_is_syncview_authoritative` 409 is never reached), but the DATA
>   was not ready — of the 80 active graphics sub-issues the Workload page actually loads
>   (327 minus 243 parked/terminal minus 4 off-roster, measured 2026-08-11), all 80 were
>   unprovable. **HEALED AND CLOSED AT THE OWNER FLOOR:** the B1 label fix (#1054, merged
>   2026-08-11) plus the owner's full-window refresh (run `31509332785`) restored every erased
>   label relation — the healing run the old banner demanded has already HAPPENED, pre-F1 as
>   required (B1 cannot repair graphics after the flip). The owner ruled 2026-08-11 that the 5
>   remaining unprovable rows (`GRA-4260`–`4264`, outside B1's 12-month import window, no due
>   dates set) are ACCEPTED. The gate is now: `node scripts/f40-workload-readiness.js
>   --team=graphics` must **PASS at or under the owner floor of 5** — the ruling is encoded in
>   the script itself (`ACCEPTED_FLOORS { graphics: 5 }`, PR #1061), so its exit code is the
>   gate. The old "require 0 unprovable rows" wording is superseded by that ruling.
> - **Flip staging (OPEN_REPAIRS item 9)** — the full machine chain was executed end to end on
>   2026-08-11 ~22:24Z and printed the literal `GO graphics_f2_preflight`: pre-f2 evidence run
>   `31530468004` PASS on release `7c0822cf`, scheduled drainer `31542047873`,
>   `production_residue=0` across both parity lanes and all attempts. That chain is **CONSUMED**
>   (a GO is used immediately or not at all); what carries over is the provisioned evidence role,
>   the Environment secrets, and the proof the machinery works. Completion record and flip-night
>   lessons: `docs/ops/F2_STAGING_CHECKLIST.md`.
> - **Real-client soak** — wave 1 executed 2026-08-07 15:17 UTC; **wave 2 executed 2026-08-11
>   15:56 UTC** (`updated_by=owner-enrollment-wave-2`, `flag_flips` ledger id 51; five clients on
>   the reroute). Parity clean through the soak: 35+ gateway parity writes, 0 failures. The old
>   "allowlist last verified TEST-only" line is history, not the live state; PR #850's dark
>   deploy and the wave records remain in §F6 below.
>
> **GO-CONDITIONS STILL OPEN — F2 and F1 stay forbidden until each line is satisfied:**
>
> - [ ] **A GREEN production write drill, after 2026-08-12's RED one.** The 2026-08-12 05:48:30Z
>   drill FAILED — `production_write_comment_http_409_write_conflict`, `teams_completed 0`,
>   watchdog latch `failing` (event ids 59028/59044). Do not run F2 until a subsequent drill
>   (next scheduled ~04:17Z) completes GREEN and the latch resets. A red drill on flip morning is
>   a hard stop, not a judgement call.
> - [ ] **A fresh flip-night machine chain**: fresh pre-f2 evidence + binder, fresh scheduled
>   drainer, fresh literal `GO` — per the hard pre-flight below. The 2026-08-11 staging GO does
>   not carry.
> - [x] **OWNER RULED 2026-08-13 (deferring to the recommended ruling): enrollment scope before
>   F1 — enroll the FULL roster before F1.** The accepted-darkness alternative (an unenrolled
>   client's post-F1 graphics status/comment write committing to the card but parking silently,
>   409-blocked at both n8n authority guards with no gateway leg) is REJECTED. Enrollment is
>   executed by the owner via the §F6-pattern flag update stamped
>   `owner-enrollment-wave-3-full-roster`; the roster slugs are deliberately not listed in this
>   public file — read the live flag.
>   - **2026-08-14 — this ruling's premise changed for COMMENTS one day after it was made;
>     owner re-ratification required.** The 2026-08-13 `comment_forbidden` incident fix
>     (PR #1064) routes **ALL client comments down the legacy n8n lane regardless of
>     enrollment**, because the gateway's client comment door (`clientCommentTargetAllowed`)
>     can never authorize a calendar-surface or unlinked-samples comment. Consequence:
>     enrolling the full roster no longer protects client COMMENTS — enrollment now only
>     moves client status/approval writes to the gateway. Post-F1 the legacy comment lane is
>     what the n8n authority guards block for graphics, so full-roster enrollment leaves the
>     comment question unanswered and the real pre-F1 choice for comments is:
>     **ship the gateway comment-door repair (accept client comments from the calendar
>     surface and unlinked samples threads) before F1**, or **explicitly accept
>     graphics-comment silent darkness for the FULL roster post-F1**. The full-roster ruling
>     above still stands for status/approvals; the owner must re-ratify it knowing it no
>     longer covers comments.
>   - **SEQUENCING CONSTRAINT — do NOT execute the wave-3 full-roster enrollment before the
>     fix is live.** The enrollment this ruling orders must run only AFTER PR #1064 is merged
>     AND the Pages deploy of it completes. Enrollment propagates to already-open tabs via
>     the realtime runtime-flags subscription (`_calSubscribeUpsertFlag`,
>     index.html:~23463-23478), so enrolling against the pre-fix deploy instantly flips every
>     open client tab's comments onto the always-locked gateway door — replaying the
>     2026-08-13 incident at ~7x scale (36 roster clients on that door vs the 5 whose
>     enrollment armed it). Merge + deploy first, verify the live site serves the fix, then
>     enroll.
> - [x] **OWNER RULED 2026-08-13 (deferring to the recommended ruling):
>   `docs/independence/GO_LIVE_CHECKLIST.md` scope.** The graphics flip is governed by this
>   go-conditions block plus `docs/ops/PRE_FLIP_HEALTH_CHECK.md`; GO_LIVE_CHECKLIST's remaining
>   open items bind later phases (video, full go-live), not this flip.
> - [x] **OWNER RULED 2026-08-13 (deferring to the recommended ruling): F133–F138.** These gate
>   the human handoff/retirement of Linear, not the F2/F1 authority flip; teams keep both
>   surfaces during the transition. F138's owner-ratified timing choice is history-retirement,
>   not first-flip.
> - [x] **OWNER RULED 2026-08-13 (deferring to the recommended ruling): later waves —
>   confirmed.** Video F1 and any further authority changes remain separately gated; nothing in
>   this block authorizes them.
>
> **Standing cautions that survive this rewrite:** F131/F132 — a fresh timestamp or quiet pager
> is never a healthy receipt. The historical outbound-pipe drill is not human-cutover approval.
> The only immediately usable Track-B containment is **stop affected mutations**, then disable
> the lane involved: F2 `off` stops normal SyncView-authoritative outbound; F4 `false` stops
> legacy parity. For an unknown/mixed incident, disable **both** and read both back. F1 authority
> reversal is not an emergency first step; it requires R2's completed intent accounting.

**Where:** Supabase Dashboard → project `uzltbbrjidmjwwfakwve` → **SQL Editor** (paste, Run).
Forward/kill mutations are SQL-only because the blocks below enforce expected-state CAS and exact
row count. Table Editor may be used for read-only inspection; never edit a composite flag there.
F63 remains open until CI parses every fence and each action has been transactionally exercised on
an isolated TEST flag store; syntactic plausibility in this file is not owner authorization.

F63 classifies fenced blocks as follows:

- **Forward actions** are strict: exactly one expected prior state, an affected-row assertion, and
  a proved refusal from a wrong prior state.
- **Kill / recovery actions** may CAS against an explicitly enumerated set of prior states. They
  still require an affected-row assertion and a proved refusal.
- **Read-only utilities** are gated for read-only behavior: no `INSERT`, `UPDATE`, `DELETE`, DDL,
  or transaction-mutating statement. CAS and affected-row rules do not apply.
- **Templates containing placeholders are not actions** and must not use a `sql` fence.

**Read-back (always verify after a flip; F63 read-only utility).** In SQL Editor, run this; do not
paste a browser key or secret into the runbook or incident notes:

```sql
select key, value, updated_at, updated_by
from public.syncview_runtime_flags
order by key;

select id, key, old_value, new_value, ts, actor
from public.flag_flips
order by id desc
limit 20;
```

---

## First Graphics handoff order — F2 before F1 (F98)

For the first human handoff only, execute F2 `live` while authority still reads exactly
`{"video":"linear","graphics":"linear"}`. Before and after F2, require exact zero real, non-parity
normal rows for both teams in `pending|failed|shadow_ok`; owner-classify/resolve residue and restart
the proof. Read F2 back and require correlated terminal drainer/credential receipts plus an observer
outside n8n, not a fresh/quiet pager timestamp (F131/F132), with zero normal-lane writes; any writes
must exactly equal expected, acknowledged `legacy_parity_written`.
Only then execute Graphics F1 and read back both rows. This intermediate state is fail-safe because
native normal writes remain authority-blocked, but paused nonzero can starve the global batch or be
released by F1 and is not green. **Never run Graphics F1 first:** if the later F2 action or session
fails, native commits can succeed while Linear remains stale. Video never reruns F2 and requires a
fresh Video normal-lane zero before its F1.

### Hard machine pre-flight and clear air (required immediately before F2)

The owner must receive a literal `GO graphics_f2_preflight ...` from **Graphics F2 hard pre-flight**
immediately before running F2. This is a machine gate, not an optional visual check. It uses the
existing dedicated production read-only PostgreSQL role and refuses unless all of these are true in
one run:

- the supplied `pre-f2` evidence run is a completed `PASS` on the exact binder and exact current
  `main` release. The gate downloads its exact run-named artifact, verifies `receipt.sha256`, and
  checks the receipt and GitHub observer before and after the database snapshot;
- the supplied **SyncView Linear outbound drain** run is a completed successful `schedule` run on
  that release, started after the bound pre evidence completed, and finished no more than five
  minutes before the final check;
- authenticated GitHub readback says the release is still the tip of `main` before and after the
  snapshot. The gate exhausts the workflow's base-run history and expands every latest rerun
  attempt; no other run may be active or start/finish at or after the supplied schedule's completion;
- the same read-only database snapshot says authority is still exactly Linear/Linear and F2 is
  still exactly `off`; and
- `public.mirror_outbox` contains exactly zero rows with `test_only=false` and status `pending`,
  `failed`, or `shadow_ok`, across every team and both parity values. Attempt count and retry time do
  not narrow this check.

If queue residue exists, the run is red, exits nonzero, and prints only each blocking row's
`id`, `team`, and `status`. Because this repository is public, those three failure fields are visible
in the Actions job log; no artifact or job-summary copy is created for a refusal, and no other row
field is printed. The gate never changes or retries a row. Do not run F2 from a red job.

For a non-technical operator:

1. First obtain the successful `pre-f2` receipt described below on the release and binder that will
   be used for the flip. Open that green evidence run and copy its run ID from the end of its web
   address; keep the binder available.
2. In GitHub, open **Actions** -> **SyncView Linear outbound drain**. Wait for a scheduled run on
   that same release to finish green. Open it and copy the digits at the end of its web address.
3. Return to **Actions** -> **Graphics F2 hard pre-flight** -> **Run workflow**. Choose `main`, paste
   `GRAPHICS_F2_PREFLIGHT_READ_ONLY` in **confirm**, paste the scheduled-run digits in
   **scheduled_run_id**, paste the green pre-evidence run ID in **pre_evidence_run_id**, paste the
   unchanged binder in **binder**, and click the green **Run workflow** button.
4. Open the new run. Continue only when the job is green and its summary contains exactly one line
   beginning `GO graphics_f2_preflight`. A `REFUSE` line is a hard stop.
5. Run the F2 `off` -> `live` SQL and readback immediately. If another drainer starts, `main` moves,
   or any delay/activity occurs before the SQL is run, the `GO` is stale: wait for the next successful
   scheduled run and repeat this machine gate.

**Clear air needs the n8n drainer dispatch OFF — learned during staging 2026-08-11.** The n8n
workflow *SyncView Monitoring Pager + Reconciler V2 Trigger* (`qllIDZPkdNAPRj0b`) node **Trigger
Outbound Drainer** dispatches this same drainer every ~15 minutes (about
`:00:35 / :15:35 / :30:35 / :45:35`) and during staging it ate two of every three pre-flight
windows. With explicit owner approval — the n8n workflows are production automation and are never
edited without it — temporarily disable that single node and publish BEFORE starting the clear-air
wait. **Timing rule: keep the node disabled until the post-f2 evidence receipt PASSes, not merely
until the F2 SQL has run.** Between F2 and the owner-attested manual drain, an n8n dispatch is
still an ordinary `workflow_dispatch` without the attestation: it can never serve as evidence, but
with F2 `live` it CAN perform real drains inside the evidence window, so the counts and
first-eligible-run correlation the post-f2 receipt must bind can no longer be attributed to the
attested run. Disabling is verified zero-cost while `linear_outbound_enabled` is `off` (every drain
all-zero, backlog static), and the post-F2 steps use the owner-attested MANUAL dispatch, which this
node does not provide. Re-enable the node and publish only after the post-f2 `PASS` (or after the
F2 kill/readback if the attempt is rolled back).

The same gate can be dispatched from PowerShell. Note the dispatch API returns `204 No Content` —
no run URL and no run ID come back — so after this bare dispatch, find the new run in the Actions
tab (or `gh run list --workflow graphics-f2-preflight.yml`); the recovery helper further below
resolves the exact run automatically:

```powershell
$scheduledRunId = Read-Host 'Paste the just-completed scheduled drainer run ID'
$preEvidenceRunId = Read-Host 'Paste the successful pre-f2 evidence run ID'
$binder = Read-Host 'Paste the unchanged pre-f2 binder'
@{
  confirm = 'GRAPHICS_F2_PREFLIGHT_READ_ONLY'
  scheduled_run_id = $scheduledRunId
  pre_evidence_run_id = $preEvidenceRunId
  binder = $binder
} | ConvertTo-Json -Compress |
  gh workflow run graphics-f2-preflight.yml --repo sidney-afk/client-analytics --ref main --json
```

`GO` proves only that bounded moment. A new intent, a newly queued drainer, or a provider failure can
still occur immediately afterward. This gate reduces the chance of a failed first post-F2 run; it
does **not** guarantee that run will pass, and it never overrides the go-conditions block at the
top of this runbook.

### One-time F2 evidence-role ACL prerequisite

Run this owner-gated action once, from the reviewed `main` release, before the first `pre-f2`
receipt. It revokes only the pre-existing `PUBLIC EXECUTE` grant on
`public.track_b_enqueue_outbound_intent()`. PostgreSQL checks function `EXECUTE` when a trigger is
created; the action requires the existing enabled `deliverable_events` binding before and after the
revoke. The final bounded receipt also inventories every other `public` `SECURITY DEFINER` routine
still executable by `PUBLIC`; any nonempty `other_public_security_definer` array is a stop for owner
classification, not permission to widen the revoke.

<!-- GRAPHICS_F2_TRIGGER_EXECUTE_REVOKE_SQL_BEGIN -->
```sql
begin;

do $graphics_f2_preflight$
declare
  v_function_oid oid;
begin
  select p.oid
    into v_function_oid
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'track_b_enqueue_outbound_intent'
    and p.pronargs = 0
    and p.prokind = 'f'
    and p.prosecdef
    and p.prorettype = 'pg_catalog.trigger'::regtype;

  if v_function_oid is null then
    raise exception 'graphics_f2_target_function_boundary_invalid';
  end if;

  if not exists (
    select 1
    from pg_proc p
    cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
    where p.oid = v_function_oid
      and acl.grantee = 0::oid
      and acl.privilege_type = 'EXECUTE'
  ) then
    raise exception 'graphics_f2_target_public_execute_missing';
  end if;

  if 1 <> (
    select count(*)
    from pg_trigger t
    where t.tgrelid = 'public.deliverable_events'::regclass
      and t.tgfoid = v_function_oid
      and t.tgname = 'track_b_outbound_intent_after'
      and not t.tgisinternal
      and t.tgenabled = 'O'
  ) then
    raise exception 'graphics_f2_existing_trigger_boundary_invalid';
  end if;
end;
$graphics_f2_preflight$;

revoke execute on function public.track_b_enqueue_outbound_intent() from public;

do $graphics_f2_readback$
declare
  v_function_oid oid := 'public.track_b_enqueue_outbound_intent()'::regprocedure::oid;
begin
  if exists (
    select 1
    from pg_proc p
    cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
    where p.oid = v_function_oid
      and acl.grantee = 0::oid
      and acl.privilege_type = 'EXECUTE'
  ) then
    raise exception 'graphics_f2_target_public_execute_still_present';
  end if;

  if 1 <> (
    select count(*)
    from pg_trigger t
    where t.tgrelid = 'public.deliverable_events'::regclass
      and t.tgfoid = v_function_oid
      and t.tgname = 'track_b_outbound_intent_after'
      and not t.tgisinternal
      and t.tgenabled = 'O'
  ) then
    raise exception 'graphics_f2_existing_trigger_changed_by_revoke';
  end if;
end;
$graphics_f2_readback$;

select jsonb_build_object(
  'schema_version', 1,
  'target', 'public.track_b_enqueue_outbound_intent()',
  'target_public_execute', false,
  'existing_trigger_binding', 'PASS',
  'other_public_security_definer', coalesce((
    select jsonb_agg(
      format('%I.%I(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid))
      order by n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)
    )
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind in ('f', 'p', 'w')
      and p.prosecdef
      and p.oid <> 'public.track_b_enqueue_outbound_intent()'::regprocedure::oid
      and exists (
        select 1
        from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
        where acl.grantee = 0::oid
          and acl.privilege_type = 'EXECUTE'
      )
  ), '[]'::jsonb)
) as graphics_f2_trigger_execute_revoke_receipt;

commit;
```
<!-- GRAPHICS_F2_TRIGGER_EXECUTE_REVOKE_SQL_END -->

Require `target_public_execute=false`, `existing_trigger_binding=PASS`, and an empty
`other_public_security_definer` array. Then run `pre-f2`; do not substitute a failed receipt.

Owner-only rollback if this ACL change and the rejecting checker are both abandoned before F2:

<!-- GRAPHICS_F2_TRIGGER_EXECUTE_ROLLBACK_SQL_BEGIN -->
```sql
begin;
do $graphics_f2_rollback_preflight$
declare
  v_function_oid oid;
  v_function_sha256 text;
  v_trigger_sha256 text;
begin
  select p.oid,
         encode(extensions.digest(convert_to(pg_get_functiondef(p.oid), 'UTF8'), 'sha256'), 'hex')
    into v_function_oid, v_function_sha256
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'track_b_enqueue_outbound_intent'
    and p.pronargs = 0
    and p.prokind = 'f'
    and p.prosecdef
    and p.prorettype = 'pg_catalog.trigger'::regtype
    and p.proowner = 'postgres'::regrole
    and p.proconfig is not distinct from array['search_path=public']::text[];

  if v_function_oid is null
     or v_function_sha256 <> '7a28c4675cbdeee06539d1c5115fc08f46ba5ba6e6a5d84bc12ab654a4d5381e' then
    raise exception 'graphics_f2_public_execute_rollback_function_drift';
  end if;

  if exists (
    select 1
    from pg_proc p
    cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
    where p.oid = v_function_oid
      and acl.grantee = 0::oid
      and acl.privilege_type = 'EXECUTE'
  ) then
    raise exception 'graphics_f2_public_execute_rollback_boundary_invalid';
  end if;

  select encode(
           extensions.digest(convert_to(pg_get_triggerdef(t.oid, true), 'UTF8'), 'sha256'),
           'hex'
         )
    into v_trigger_sha256
  from pg_trigger t
  where t.tgrelid = 'public.deliverable_events'::regclass
    and t.tgfoid = v_function_oid
    and t.tgname = 'track_b_outbound_intent_after'
    and not t.tgisinternal
    and t.tgenabled = 'O';

  if v_trigger_sha256 is distinct from
       'd5561965a9a8a7ef60103f165678cbda532e1cd064bdbc831a68fdafbbcebe1e' then
    raise exception 'graphics_f2_public_execute_rollback_trigger_drift';
  end if;
end;
$graphics_f2_rollback_preflight$;

grant execute on function public.track_b_enqueue_outbound_intent() to public;

do $graphics_f2_rollback_readback$
declare
  v_function_oid oid := 'public.track_b_enqueue_outbound_intent()'::regprocedure::oid;
begin
  if encode(
       extensions.digest(convert_to(pg_get_functiondef(v_function_oid), 'UTF8'), 'sha256'),
       'hex'
     ) <> '7a28c4675cbdeee06539d1c5115fc08f46ba5ba6e6a5d84bc12ab654a4d5381e'
     or not exists (
       select 1
       from pg_proc p
       where p.oid = v_function_oid
         and p.prokind = 'f'
         and p.prosecdef
         and p.prorettype = 'pg_catalog.trigger'::regtype
         and p.proowner = 'postgres'::regrole
         and p.proconfig is not distinct from array['search_path=public']::text[]
     )
     or not exists (
       select 1
       from pg_proc p
       cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
       where p.oid = v_function_oid
         and acl.grantee = 0::oid
         and acl.privilege_type = 'EXECUTE'
     )
     or 1 <> (
       select count(*)
       from pg_trigger t
       where t.tgrelid = 'public.deliverable_events'::regclass
         and t.tgfoid = v_function_oid
         and t.tgname = 'track_b_outbound_intent_after'
         and not t.tgisinternal
         and t.tgenabled = 'O'
         and encode(
           extensions.digest(convert_to(pg_get_triggerdef(t.oid, true), 'UTF8'), 'sha256'),
           'hex'
         ) = 'd5561965a9a8a7ef60103f165678cbda532e1cd064bdbc831a68fdafbbcebe1e'
     ) then
    raise exception 'graphics_f2_public_execute_rollback_readback_invalid';
  end if;
end;
$graphics_f2_rollback_readback$;
commit;
```
<!-- GRAPHICS_F2_TRIGGER_EXECUTE_ROLLBACK_SQL_END -->

The two SHA-256 values above are the reviewed production function and trigger definitions captured on
2026-08-03. Any body, owner, security-mode, search-path, binding, enablement, or definition drift blocks
the re-grant. That inverse deliberately restores the pre-existing exposure and makes the updated
evidence gate red. Never use it as a way to make a pre-F2 receipt pass.

### Packaged Graphics F2 evidence lane (read-only; owner still runs F2)

Use the GitHub Actions workflow **Graphics F2 evidence** in exactly two modes. The workflow never
changes a runtime flag, invokes a writer, dispatches the drainer, or performs F1. It observes one
already-completed eligible `linear-outbound-drain` run and opens the database in one
`REPEATABLE READ, READ ONLY` transaction. Its only Linear request is the service-role-protected
typed viewer query made with the step-scoped production Environment `LINEAR_MIRROR_API_KEY`; it
returns only a correlation-bound hashed acceptance receipt, and every counted writer receipt must
match that viewer hash.

Before the window, the production Actions environment must contain a direct or pooled PostgreSQL
connection as `GRAPHICS_F2_READONLY_DATABASE_URL` using a dedicated non-owner role with only the
four required table `SELECT` grants, no effective/direct `SELECT` on any other `public` application
relation, and one direct permissive `FOR SELECT USING (true)` RLS policy targeting only the evidence role
on each table. The role must have no direct role memberships (including non-inherited memberships
that permit `SET ROLE`), application-table or column write grant, application-sequence privilege,
PostgreSQL `MAINTAIN`, executable application `SECURITY DEFINER` routine, application schema
`CREATE`, reserved `pg_*` identity, or elevated PostgreSQL role attribute. The verifier binds the project
host and `postgres` database separately from that login and fails closed unless PostgreSQL confirms
the login neither owns the database nor has database-level `CREATE`, the exact four-relation
allowlist, all four role-targeted all-rows policies, and every restriction. This provisioning is an owner
precondition; neither evidence mode creates a role, grant, or policy.
The Environment must also contain the same protected Linear mirror credential as
`LINEAR_MIRROR_API_KEY`, and the existing read-only Supabase source-fingerprint material. The
Environment must contain a fresh 32-128 character base64url-style value as
`GRAPHICS_F2_OWNER_DISPATCH_ATTESTATION`. Keep that exact value outside n8n and reuse it only for the
owner's pre/post manual drainer dispatches in this F2 window; rotate it after the window. An older
value becomes stale and fails closed as soon as the Environment secret changes. A scheduled drainer
does not need this value.

The isolated proof lane uses PostgreSQL 17. The workflow independently fingerprints the deployed
`linear-outbound` closure and fails if it differs from the selected release. No additional Edge
Function deploy is required or performed.

1. Choose one opaque 16-128 character binder and do not change it. Select an eligible completed
   **SyncView Linear outbound drain** run on the release: either a `schedule` run, or an
   owner-started `workflow_dispatch` whose `f2_owner_attestation` input exactly equals the current
   production Environment secret. Run **Graphics F2 evidence** with
   `mode=pre-f2`, that drainer run ID, the binder, the exact expected
   `legacy_parity_written` count, and an acknowledgement SHA-256 when that count is nonzero.
2. Require the one public-safe JSON receipt to say `PASS`, `authority=linear/linear`,
   `outbound_mode=off`, exact residue count `0`, correlation `PASS`, typed Linear credential
   `PASS`, dedicated PostgreSQL role `PASS`, GitHub Actions observer `PASS`, and normal-lane writes
   `0`. Also require `dispatch_eligibility.route` to be `github_schedule` or
   `owner_attested_workflow_dispatch` and inspect its actor fields. A workflow dispatch without the
   exact current attestation is ineligible; this includes every ordinary n8n dispatch. Any residue receipt includes
   its exact count, full-inventory SHA-256, and bounded team/status/operation classification; stop
   for owner classification and restart from a fresh pre receipt.
3. Wait for the next successful same-release scheduled drainer, then run the hard machine
   pre-flight above. Require its literal `GO` and execute F2 immediately; otherwise stop.
4. The owner alone runs F2 and its SQL readback from this runbook. The evidence workflow and
   pre-flight workflow do not perform or retry this action.
5. Without changing the release or binder, use the first completed eligible drainer run after
   the F2 readback. Run `mode=post-f2` with that drainer run ID and the successful pre-f2 evidence
   run ID. Supply the exact expected/acknowledged parity count for the complete durable
   F2-flip-to-selected-terminal window. The verifier exhausts the bounded schedule/workflow-dispatch
   history for
   the exact release and requires the
   selected run/attempt to be the first eligible one created or started after F2, including a queued run
   created before F2 and even when that earlier run or attempt failed. Every rerun is expanded from
   attempt 1 through its current attempt, and database evidence covers every written row from F2
   through the selected terminal, so even an older cross-release retry cannot hide a write. Dispatch
   eligibility ordering comes from the durable GitHub Actions upload-step execution marker for each
   attempt, not artifact presence; deleting or expiring an earlier attested artifact cannot make that
   attempt ineligible. A missing or ambiguous marker is red. It also
   requires the durable `linear_outbound_enabled` `flag_flips` event to be newer than the
   completed pre evidence run and the post drainer run/start to be newer than that F2 event; an older
   `live` drainer from the same release is red. Exactly one outbound transition may exist after the
   bound pre receipt, and it must be the qualifying `off→live`; any later toggle is red rather than a
   new write-window anchor.
6. Require `PASS`, `authority=linear/linear`, `outbound_mode=live`, exact residue count `0`, the
   exact pre-receipt hash, the same binder/release/function-source hashes, zero normal-lane writes,
   `handoff_order.status=PASS`, and `written == legacy_parity_written == expected`. Every counted write must have a typed Linear
   mutation/readback acceptance bound to the same hashed viewer identity. Missing, local-noop, or
   unbound provider evidence is red.

**Measuring `expected_legacy_parity_written`, and deriving the acknowledgement.** The expected
parity count is never guessed and never taken from a pager; it is measured from the anon-readable
event stream (publishable key, read-only, ~real-time):

- **Pre-f2 (per drainer run):** read the bound drainer run's own `linear_outbound_summary` event
  in `deliverable_events` and use its `counts.legacy_parity_written` exactly. With wave-2 clients
  writing, a nonzero count is normal — read it per run, never assume 0.
- **Post-f2 (complete window):** **sum `legacy_parity_written` across ALL
  `linear_outbound_summary` events whose `ts` falls inside the window from the F2 `off`→`live`
  `flag_flips` event through the selected drainer run's terminal** — every summary event in the
  window, not only the selected run's, because the verifier accounts for every durable write in
  that whole span.

When the count is nonzero, `legacy_parity_ack_sha256` is derived like this: the owner writes a
one-line classification note for the parity writes (private, kept outside this repo), and passes
that note's SHA-256 as the 64-hex acknowledgement. The lane verifies FORM, not provenance — **any
deliberately produced 64-hex value passes** — so the field's entire worth is the deliberateness it
proves: producing it means a human read the exact count and classified it before arming the
evidence run. Do not shortcut it by hashing an empty string out of habit; the note is the record
you will want during an incident.

The receipt is intentionally bounded to enums, counts, GitHub/event IDs, the GitHub actor and
triggering actor for the eligibility claim, and SHA-256 values. It contains no client slug, outbox ID,
payload, Linear ID, attestation value, credential, database address, or row body. A fresh timestamp,
a quiet interval, an n8n execution, or an uncorrelated successful
HTTP request cannot substitute for either mode.

### If the first eligible post-F2 drainer fails

This is **not a catastrophe and the flip is not ruined**. Graphics F1 has not happened, so both
teams are still Linear-authoritative. A transient failure normally costs roughly 30 minutes: put F2
back to `off`, create a fresh pre-F2 proof, find clear air, and try the F2 step again. Do not select a
later successful drainer for the failed proof chain; the evidence correctly refuses that substitution.

Use this exact order so nobody improvises at 2am:

1. Stop. Do not run Graphics F1, post-F2 against a later drainer, F4, R2, or any queue edit.
2. In Supabase SQL Editor, run the exact **EMERGENCY NORMAL-LANE KILL** block under **F2** below.
   Then run the top-of-file **Read-back** block. Require `linear_outbound_enabled={"mode":"off"}`
   and authority still exactly `{"video":"linear","graphics":"linear"}`.
3. Discard the failed binder and pre-evidence run ID. Keep `main` frozen on the same release and
   generate a fresh 16-128 character binder.
4. Wait for a same-release scheduled drainer to complete successfully. If production residue remains
   or drains keep failing, remain at F2 `off` and stop for owner classification; never edit or broaden
   the checker or database role. Otherwise run a fresh **Graphics F2 evidence** `pre-f2` with that
   scheduled run ID, the fresh binder, blank `pre_evidence_run_id`, and the exact parity expectation.
   Require the full pre-F2 `PASS`.
5. After that fresh pre receipt completes, wait for the next successful same-release scheduled
   drainer. Run **Graphics F2 hard pre-flight** exactly as above and require literal `GO`.
6. Immediately run the existing F2 **Forward to live directly from off** block below, then the
   top-of-file **Read-back** block. Require the one `off` -> `live` transition and authority still
   Linear/Linear.
7. Immediately dispatch **SyncView Linear outbound drain** from `main`, with `limit=15` and
   `f2_owner_attestation` equal to the current production Environment attestation. Wait for that
   exact run. Do not rerun or replace it if it fails.
8. If it succeeds, run **Graphics F2 evidence** `post-f2` with that exact drainer run ID, the fresh
   pre-evidence run ID, the same release and binder, and the exact parity expectation/acknowledgement.
   Only its `PASS` permits Graphics F1. If the drainer or receipt fails again, return to step 1.

Recovery has four manual workflow dispatches: fresh pre evidence, the hard pre-flight, the first
post-F2 attested drainer, and post evidence. After step 2's SQL readback, open PowerShell, paste the
following helper block once, and stop on any red error. It captures each exact run ID, watches that
run, and re-reads its release, workflow, owner, and conclusion instead of guessing from a run list:

```powershell
$Repo = 'sidney-afk/client-analytics'
$ReleaseSha = ((& gh api "repos/$Repo/git/ref/heads/main" --jq '.object.sha').Trim()).ToLowerInvariant()
if ($LASTEXITCODE -ne 0 -or $ReleaseSha -notmatch '^[0-9a-f]{40}$') {
  throw 'Could not bind current main. Stop.'
}

function Assert-CurrentMain {
  $text = @(& gh api "repos/$Repo/git/ref/heads/main" 2>&1)
  if ($LASTEXITCODE -ne 0) { throw 'Could not re-read current main. Stop.' }
  try { $ref = (($text -join "`n") | ConvertFrom-Json) }
  catch { throw 'Current-main readback was invalid. Stop.' }
  if ([string]$ref.ref -ne 'refs/heads/main' -or
      [string]$ref.object.type -ne 'commit' -or
      ([string]$ref.object.sha).ToLowerInvariant() -ne $ReleaseSha) {
    throw 'Main moved. Stop before dispatching anything else.'
  }
}

function Get-ExactRun {
  param([string]$RunId)
  if ($RunId -notmatch '^[1-9][0-9]{0,19}$') { throw 'Invalid run ID. Stop.' }
  $text = @(& gh api "repos/$Repo/actions/runs/$RunId" 2>&1)
  if ($LASTEXITCODE -ne 0) { throw "Could not read run $RunId. Stop." }
  try { return (($text -join "`n") | ConvertFrom-Json) }
  catch { throw "Run $RunId returned invalid metadata. Stop." }
}

function Assert-ExactSchedule {
  param([string]$RunId)
  $run = Get-ExactRun $RunId
  $path = ([string]$run.path -split '@')[0]
  if ([string]$run.id -ne $RunId -or
      [string]$run.repository.full_name -ne $Repo -or
      $path -ne '.github/workflows/linear-outbound-drain.yml' -or
      [string]$run.event -ne 'schedule' -or
      [string]$run.status -ne 'completed' -or
      [string]$run.conclusion -ne 'success' -or
      ([string]$run.head_sha).ToLowerInvariant() -ne $ReleaseSha) {
    throw "Scheduled run $RunId is not an exact successful release run. Stop."
  }
}

function Invoke-ExactWorkflow {
  param(
    [string]$WorkflowFile,
    [string]$ExpectedPath,
    [System.Collections.IDictionary]$Inputs
  )
  $script:LastWorkflowRunId = $null
  Assert-CurrentMain
  # The workflow-dispatch API returns 204 No Content: gh prints NO run URL and
  # NO run ID, so parsing dispatch output can never resolve the run (the first
  # version of this helper did exactly that and always threw). Instead: record
  # the dispatch instant, dispatch, then resolve the single new run from this
  # workflow's own run list. The exact-metadata re-read below still verifies
  # path/event/actor/sha, so a wrong candidate cannot slip through.
  $dispatchedAt = [DateTime]::UtcNow.AddSeconds(-30).ToString('yyyy-MM-ddTHH:mm:ssZ')
  $Inputs | ConvertTo-Json -Compress |
    & gh workflow run $WorkflowFile --repo $Repo --ref main --json | Out-Host
  if ($LASTEXITCODE -ne 0) { throw "Dispatch of $WorkflowFile failed. Stop." }
  $runId = $null
  for ($attempt = 0; $attempt -lt 12 -and -not $runId; $attempt++) {
    Start-Sleep -Seconds 5
    $text = @(& gh run list --repo $Repo --workflow $WorkflowFile `
        --event workflow_dispatch --branch main --created ">=$dispatchedAt" `
        --limit 10 --json databaseId,headSha 2>&1)
    if ($LASTEXITCODE -ne 0) { continue }
    try { $candidates = @((($text -join "`n") | ConvertFrom-Json)) } catch { continue }
    $mine = @($candidates | Where-Object {
      ([string]$_.headSha).ToLowerInvariant() -eq $ReleaseSha
    })
    if ($mine.Count -gt 1) {
      throw 'More than one new dispatch run appeared in the window. Stop; do not guess.'
    }
    if ($mine.Count -eq 1) { $runId = [string]$mine[0].databaseId }
  }
  if (-not $runId) {
    throw 'Dispatch accepted but no run appeared within ~60s. Stop; find the run in Actions by hand.'
  }
  $script:LastWorkflowRunId = $runId
  Write-Host "Run ID $runId - https://github.com/$Repo/actions/runs/$runId"
  & gh run watch $runId --repo $Repo --exit-status --interval 5 | Out-Host
  $watchExit = $LASTEXITCODE
  $run = Get-ExactRun $runId
  Assert-CurrentMain
  $path = ([string]$run.path -split '@')[0]
  if ($watchExit -ne 0 -or
      [string]$run.status -ne 'completed' -or
      [string]$run.conclusion -ne 'success' -or
      [string]$run.event -ne 'workflow_dispatch' -or
      $path -ne $ExpectedPath -or
      ([string]$run.head_sha).ToLowerInvariant() -ne $ReleaseSha -or
      [string]$run.actor.login -ne 'sidney-afk' -or
      [string]$run.triggering_actor.login -ne 'sidney-afk') {
    throw "Run $runId failed or mismatched. Stop; do not rerun or substitute."
  }
  return $runId
}

function Read-ParityInput {
  param([string]$Label)
  $count = (Read-Host "$Label exact legacy-parity write count").Trim()
  if ($count -notmatch '^(0|[1-9][0-9]?)$' -or [int]$count -gt 50) {
    throw 'Invalid parity count. Stop.'
  }
  $ack = ''
  if ($count -ne '0') {
    $ack = (Read-Host "$Label 64-character acknowledgement SHA-256").Trim().ToLowerInvariant()
    if ($ack -notmatch '^[0-9a-f]{64}$') { throw 'Invalid acknowledgement. Stop.' }
  }
  return [pscustomobject]@{ Count = $count; Ack = $ack }
}
```

Then paste this block. It creates a fresh binder, dispatches the fresh `pre-f2`, waits for a later
successful schedule, and dispatches the machine gate bound to that exact pre receipt and binder:

```powershell
$Binder = 'graphics-f2-' + [guid]::NewGuid().ToString('N')
Write-Host "Fresh binder: $Binder"

$PreScheduleRunId = (Read-Host 'Paste the successful scheduled drainer run ID after rollback').Trim()
Assert-ExactSchedule $PreScheduleRunId
$PreParity = Read-ParityInput 'Pre-F2'
$PreEvidenceRunId = Invoke-ExactWorkflow `
  'graphics-f2-evidence.yml' `
  '.github/workflows/graphics-f2-evidence.yml' `
  ([ordered]@{
    mode = 'pre-f2'
    confirm = 'GRAPHICS_F2_READ_ONLY'
    binder = $Binder
    drainer_run_id = $PreScheduleRunId
    pre_evidence_run_id = ''
    expected_legacy_parity_written = $PreParity.Count
    legacy_parity_ack_sha256 = $PreParity.Ack
  })

$ClearAirScheduleRunId = (Read-Host 'After pre-F2 passes, paste the NEXT successful scheduled drainer run ID').Trim()
if ($ClearAirScheduleRunId -eq $PreScheduleRunId) { throw 'This must be the later schedule. Stop.' }
Assert-ExactSchedule $ClearAirScheduleRunId
$PreflightRunId = Invoke-ExactWorkflow `
  'graphics-f2-preflight.yml' `
  '.github/workflows/graphics-f2-preflight.yml' `
  ([ordered]@{
    confirm = 'GRAPHICS_F2_PREFLIGHT_READ_ONLY'
    scheduled_run_id = $ClearAirScheduleRunId
    pre_evidence_run_id = $PreEvidenceRunId
    binder = $Binder
  })
```

Only after that command returns green, immediately run step 6's existing **Forward to live directly
from off** SQL and the top readback. Then paste this final block. It dispatches exactly one attested
drainer, never substitutes a later success, and binds `post-f2` to the fresh pre run and same binder:

```powershell
$AttestationSecure = Read-Host 'Paste the private owner attestation' -AsSecureString
$Attestation = $null
try {
  $Attestation = [System.Net.NetworkCredential]::new('', $AttestationSecure).Password
  if ($Attestation -notmatch '^[A-Za-z0-9_-]{32,128}$') {
    throw 'Invalid attestation format. Stop.'
  }
  $PostDrainerRunId = Invoke-ExactWorkflow `
    'linear-outbound-drain.yml' `
    '.github/workflows/linear-outbound-drain.yml' `
    ([ordered]@{
      limit = '15'
      f2_owner_attestation = $Attestation
    })
} finally {
  $Attestation = $null
  if ($null -ne $AttestationSecure) { $AttestationSecure.Dispose() }
}

$PostParity = Read-ParityInput 'Post-F2 complete flip-to-terminal window'
$PostEvidenceRunId = Invoke-ExactWorkflow `
  'graphics-f2-evidence.yml' `
  '.github/workflows/graphics-f2-evidence.yml' `
  ([ordered]@{
    mode = 'post-f2'
    confirm = 'GRAPHICS_F2_READ_ONLY'
    binder = $Binder
    drainer_run_id = $PostDrainerRunId
    pre_evidence_run_id = $PreEvidenceRunId
    expected_legacy_parity_written = $PostParity.Count
    legacy_parity_ack_sha256 = $PostParity.Ack
  })

Write-Host "PASS chain: pre=$PreEvidenceRunId gate=$PreflightRunId drainer=$PostDrainerRunId post=$PostEvidenceRunId"
```

If either final command fails and `$LastWorkflowRunId` is populated, it is the exact failed or
mismatched run ID. If it is blank, no exact run ID was resolved from the workflow's run list
(dispatch returns `204 No Content`, so there is no output to mine): stop and find the run in the
Actions tab by hand; do not guess. In either case, return directly to recovery step 1 and the
existing F2 kill/readback; do not rerun or replace a failed run.

## F1 — Team authority (who is the boss for a team)

Row: `prod_authority`. Valid sides: `"linear"` or `"syncview"` per team. NEVER any other word.
F55 removed the legacy `"supabase"` backend alias from every source consumer (browser, edge
functions, reconcilers, the n8n guard, and both F27 SQL copies) — every path now rejects it
exactly like any other malformed/legacy value, and an all-consumer contract test pins this. Never
reintroduce it as a compatibility shortcut. The live half is done too:
`2026-07-28-f27-write-authorization-only.sql` had been applied to production on 2026-07-28, so the
repo edit alone left the deployed `track_b_f27_write_authorization` still accepting `supabase`;
that block was re-pasted and the function read back on 2026-07-28. Any FUTURE edit to a
live-applied migration needs the same re-apply — the repo is not the database.
The first human authority flip is Graphics only. Do not run either forward statement while any
go-condition in the top-of-file block remains open; Video's statement is a later, separately
approved gate after Graphics.
For Graphics, the readback and correlated-terminal-receipt prerequisites in “First Graphics handoff order”
must already be current. A standalone valid F1 paste is not authorization.

**Run exactly one fenced action below, then run the read-back at the top. Never paste two actions
together.** Each block validates the exact two-key expected state, changes only the named team, and
raises an error unless exactly one row matched; an error means stop and diagnose, not loosen the
predicate.

Flip Graphics forward (expected state: both teams Linear):

```sql
do $$ declare n integer; begin
  update public.syncview_runtime_flags
  set value = jsonb_set(value, '{graphics}', '"syncview"'::jsonb, false),
      updated_by = 'owner-runbook'
  where key = 'prod_authority'
    and value = '{"video":"linear","graphics":"linear"}'::jsonb;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'graphics flip refused: expected exact linear/linear authority'; end if;
end $$;
```

Flip Video forward (expected state: Graphics SyncView, Video Linear):

```sql
do $$ declare n integer; begin
  update public.syncview_runtime_flags
  set value = jsonb_set(value, '{video}', '"syncview"'::jsonb, false),
      updated_by = 'owner-runbook'
  where key = 'prod_authority'
    and value = '{"video":"linear","graphics":"syncview"}'::jsonb;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'video flip refused: expected linear/syncview authority'; end if;
end $$;
```

POST-R2 Graphics reversal during the Graphics-only phase (expected Video Linear):

```sql
do $$ declare n integer; begin
  update public.syncview_runtime_flags
  set value = jsonb_set(value, '{graphics}', '"linear"'::jsonb, false),
      updated_by = 'owner-runbook'
  where key = 'prod_authority'
    and value = '{"video":"linear","graphics":"syncview"}'::jsonb;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'graphics reversal refused: expected linear/syncview authority'; end if;
end $$;
```

POST-R2 Graphics reversal while Video remains SyncView-authoritative:

```sql
do $$ declare n integer; begin
  update public.syncview_runtime_flags
  set value = jsonb_set(value, '{graphics}', '"linear"'::jsonb, false),
      updated_by = 'owner-runbook'
  where key = 'prod_authority'
    and value = '{"video":"syncview","graphics":"syncview"}'::jsonb;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'graphics reversal refused: expected syncview/syncview authority'; end if;
end $$;
```

POST-R2 Video reversal while Graphics remains SyncView-authoritative (normal Video rollback):

```sql
do $$ declare n integer; begin
  update public.syncview_runtime_flags
  set value = jsonb_set(value, '{video}', '"linear"'::jsonb, false),
      updated_by = 'owner-runbook'
  where key = 'prod_authority'
    and value = '{"video":"syncview","graphics":"syncview"}'::jsonb;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'video reversal refused: expected syncview/syncview authority'; end if;
end $$;
```

POST-R2 Video reversal after Graphics is already Linear-authoritative:

```sql
do $$ declare n integer; begin
  update public.syncview_runtime_flags
  set value = jsonb_set(value, '{video}', '"linear"'::jsonb, false),
      updated_by = 'owner-runbook'
  where key = 'prod_authority'
    and value = '{"video":"syncview","graphics":"linear"}'::jsonb;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'video reversal refused: expected syncview/linear authority'; end if;
end $$;
```

## F2 — Outbound mirror (SyncView → Linear writer)

Row: `linear_outbound_enabled`. Valid: `"off"`, `"shadow"` (log, don't write), `"live"`.
`off` safely stops the **normal SyncView-authoritative lane only**. It does not stop rows marked
`legacy_parity`; F4 is that independent lane's kill. `shadow` and `live` are forward changes and
are forbidden while any top-of-file go-condition remains open.

**EMERGENCY NORMAL-LANE KILL — use this block, not a forward block.** If it refuses because the row
is already `off`, read back and leave it off. F4 must be killed separately for parity.

```sql
do $$ declare n integer; begin
  update public.syncview_runtime_flags
  set value = '{"mode":"off"}'::jsonb, updated_by = 'owner-runbook'
  where key = 'linear_outbound_enabled'
    and value in ('{"mode":"shadow"}'::jsonb, '{"mode":"live"}'::jsonb);
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'normal outbound kill refused: expected shadow or live; read back'; end if;
end $$;
```

Forward to shadow (expected current state: off; gated by the top-of-file go-conditions):

```sql
do $$ declare n integer; begin
  update public.syncview_runtime_flags
  set value = '{"mode":"shadow"}'::jsonb, updated_by = 'owner-runbook'
  where key = 'linear_outbound_enabled' and value = '{"mode":"off"}'::jsonb;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'shadow arm refused: expected off'; end if;
end $$;
```

Forward to live directly from off (expected current state: off; gated by the top-of-file
go-conditions):

Choosing off → live deliberately skips the shadow dry-run; do so only as an explicit owner choice.

For the first Graphics handoff, this is deliberately executed and proved **before** F1 while both
teams remain Linear-authoritative. Do not continue to F1 if the CAS, readback, correlated terminal
drainer/credential receipts, or outside-n8n observer fails.

```sql
do $$ declare n integer; begin
  update public.syncview_runtime_flags
  set value = '{"mode":"live"}'::jsonb, updated_by = 'owner-runbook'
  where key = 'linear_outbound_enabled'
    and value = '{"mode":"off"}'::jsonb;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'live arm refused: expected off'; end if;
end $$;
```

Forward to live after the shadow dry-run (expected current state: shadow; gated by the
top-of-file go-conditions):

```sql
do $$ declare n integer; begin
  update public.syncview_runtime_flags
  set value = '{"mode":"live"}'::jsonb, updated_by = 'owner-runbook'
  where key = 'linear_outbound_enabled'
    and value = '{"mode":"shadow"}'::jsonb;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'live arm refused: expected shadow'; end if;
end $$;
```

## F3 — Inbound mirror (Linear → SyncView copier)

Row: `linear_inbound_enabled`. Keep `true` until B5. Kill only if inbound is actively
corrupting data:

Inbound corruption kill (expected current state: enabled):

```sql
do $$ declare n integer; begin
  update public.syncview_runtime_flags
  set value = '{"enabled":false}'::jsonb, updated_by = 'owner-runbook'
  where key = 'linear_inbound_enabled' and value = '{"enabled":true}'::jsonb;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'inbound kill refused: expected enabled; read back'; end if;
end $$;
```

Re-enable inbound only after the owner-approved recovery (expected current state: disabled):

```sql
do $$ declare n integer; begin
  update public.syncview_runtime_flags
  set value = '{"enabled":true}'::jsonb, updated_by = 'owner-runbook'
  where key = 'linear_inbound_enabled' and value = '{"enabled":false}'::jsonb;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'inbound enable refused: expected disabled'; end if;
end $$;
```

## F4 — Parity lane (transition writes to Linear while a team is still Linear-boss)

Row: `linear_legacy_parity_enabled`. Armed at Phase 1 of the checklist; kill switch for the
whole transition lane. The `false` kill is safe; do not arm `true` until the cohort flag and every
caller are deployed/read back and the checklist authorizes Phase 1. This flag is intentionally
independent of F2: parity rows can scan/write while normal outbound is `off`.

**EMERGENCY PARITY KILL — use this block, not the forward block.** If it refuses because the row is
already disabled, read back and leave it disabled.

```sql
do $$ declare n integer; begin
  update public.syncview_runtime_flags
  set value = '{"enabled":false}'::jsonb, updated_by = 'owner-runbook'
  where key = 'linear_legacy_parity_enabled' and value = '{"enabled":true}'::jsonb;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'parity kill refused: expected enabled; read back'; end if;
end $$;
```

Forward arm (expected current state: disabled; gated by the top-of-file go-conditions):

```sql
do $$ declare n integer; begin
  update public.syncview_runtime_flags
  set value = '{"enabled":true}'::jsonb, updated_by = 'owner-runbook'
  where key = 'linear_legacy_parity_enabled' and value = '{"enabled":false}'::jsonb;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'parity arm refused: expected disabled'; end if;
end $$;
```

## F5 — Sign-in enforcement (global permissive rollback is blocked)

Row: `auth_enforcement`. **The only enforcing value the code accepts is `enforced`** —
anything else (including `enforcing`) silently behaves as permissive.
The forward `enforced` change is separately blocked by the auth findings in the audit register;
do not run it merely because the syntax below is correct.

**Canonical place:** GO_LIVE Phase 0.75, after the TEST-only dark merge and before Phase 1 enrolls
any real client (F97). The same unexpired preflight must prove every Phase-0 auth/read/write gate,
an exact active-client/current-token-revision roster, the fixed fail-closed verifier, and stale
verdict/session invalidation. A correct paste without those handles is not authorization.

> **There is intentionally no global `enforced` → `permissive` paste block (F70).** Permissive is
> not a harmless UI rollback: it reopens invalid/stale staff and client access. During an auth
> incident, stop affected protected mutations/reads, preserve enforcement, and revert/fix the
> broken caller or verifier through the pinned release path. A global permissive change requires an
> explicit owner security-incident decision, a documented exposure window, compensating server
> containment for every protected surface, forced cache/session invalidation, monitoring, expiry,
> and a separately reviewed CAS action. None of that control plane exists today.

Forward enforce (expected current state: permissive; gated by the top-of-file go-conditions and
the auth gates):

```sql
do $$ declare n integer; begin
  update public.syncview_runtime_flags
  set value = '{"mode":"enforced"}'::jsonb, updated_by = 'owner-runbook'
  where key = 'auth_enforcement' and value = '{"mode":"permissive"}'::jsonb;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'auth enforcement refused: expected permissive'; end if;
end $$;
```

Immediately read back this row and require exactly `{"mode":"enforced"}`. Record the readback,
`flag_flips` event, cache/session epoch, and preflight handle in `EXECUTION_LOG.md` and ROLLBACK Live
State. Then pass the Phase-0.75 missing/invalid/expired/rotated/inactive/verifier-failure TEST matrix.
Do not enroll a real cohort on any other value or after proof expiry.

## F6 — Reroute allowlist (which clients' buttons use the new pipes)

> **LIVE — WAVE 2 ENROLLED, OWNER-GATED.** PR #850 superseded closed-unmerged #813 and deployed the
> allowlisted callers plus `production-write` gateway. **The owner executed enrollment wave 1 on
> 2026-08-07 15:17:24 UTC**: the allowlist is `{"clients":["sidneylaruel","roccopiazza","edwardmannix"]}`
> (ledger `flag_flips` id 44; captured rollback value `{"clients":["sidneylaruel"]}`). The first
> real-client gateway write completed end-to-end the same hour (see `EXECUTION_LOG.md` 2026-08-07).
> **The owner executed enrollment wave 2 on 2026-08-11 15:56 UTC**
> (`updated_by=owner-enrollment-wave-2`, ledger `flag_flips` id 51): five clients on the reroute —
> TEST plus the wave-1 two plus the two most active roster clients (the new pair is deliberately
> not named in this public file; read the live flag). Parity clean through the wave-2 soak: 35+
> writes, 0 failures. **The captured rollback value for wave 2 is the exact wave-1 three-client
> allowlist recorded above (id 44's new value)** — a wave-2 soak rollback restores THAT value and
> reads it back; restoring the TEST-only allowlist is a separate, announced decision, not the
> wave-2 rollback. Any FURTHER change remains owner-gated exactly as below. There is intentionally no
> copy-paste mutation payload here. Before **every** flag change, read back and retain the exact
> current row, bring the owner the exact proposed JSON/client-set change and a rollback that
> restores that captured value, and obtain explicit approval. After an approved edit, require
> expected-state CAS, one-row write/readback, TEST plus stale-tab/failure proof, and unchanged
> unrelated flags. A missing or unreadable flag fails to the LEGACY lane; it must never mean “all
> clients” or “safe to advance.” Before team authority changes, removing a proved cohort is the
> caller-routing rollback; after authority changes, follow R2 and use F1 only after its accounting
> gate completes.

---

## R1 — "Something's wrong, make it stop" (global order)

1. Stop affected users from making new mutations.
2. If wrong or unexplained data is being WRITTEN TO LINEAR, set **both** F2 → `off` and F4 →
   `false`, then read back both rows. If the incident is conclusively isolated to one lane, its own
   kill is sufficient; when uncertain, never assume F2 also stopped parity. Queued rows remain for
   classification; **do not run the default drainer after turning normal outbound off**.
3. If a flipped team is affected, begin its installed F27 per-team rollback and follow R2. Do not
   flip authority blindly.
4. Tell the team which system is authoritative and which mutations are stopped. Then diagnose.

## R2 — Pause a flipped team back to Linear (F27 installed and reserved-drill-proved)

**The old “run the default drainer and require green/pending 0” instruction was unsafe.** The
worker's normal summary does not provide an auditable per-team zero for this rollback, and stopping
outbound first prevents a normal drain. Blindly flipping authority can strand newer SyncView work;
blindly draining can send the very writes that triggered the incident.

The unsafe #894 design remains historical evidence, and the 2026-08-01 failed
attempt plus its Section 7 rollback remain recorded in `EXECUTION_LOG.md`;
neither describes the current production boundary. The corrective F27
migration was installed on 2026-08-02. Its reserved production drill proved
the real finalizer's required authority-CAS refusal while leaving real outbox,
fence, flag, and flag-flip state unchanged. The final production verifier then
returned `F27_FINAL_VERIFICATION_OK` with PASS across all 17 enumerated
assertions. The installed control binds every real-team insert to a server
generation, requires an exact open rollback for the preflight echo exception,
and permanently retains its audit. Use this incident sequence; the final
authority reversal is one guarded statement, but classification and any replay
remain deliberate owner work:

1. Stop new mutations for the affected team and disable/read back the involved outbound lane(s) if
   Linear writes may be wrong: F2 `off` for normal rows, F4 `false` for parity rows, **both** when
   the source is unknown or mixed. A conclusively isolated single-lane kill is containment only;
   before step 2, engage and read back **both** F2 `off` and F4 `false`, because the installed begin
   call requires both emergency stops. Record the exact flag-flip ids and incident start time.
2. Re-read and record that the affected team is `syncview`-authoritative, F2 is exactly
   `{"mode":"off"}`, F4 is exactly `{"enabled":false}`, and no active affected row is already
   locked. Pass that exact authority readback to the installed atomic begin call:

   ```text
   select public.track_b_f27_begin(
     '<video|graphics>',
     '<EXACT_AUTHORITY_READBACK>'::jsonb,
     'owner-runbook'
   );
   ```

   Store the returned `rollback_id`, `correlation_id`, `fence_generation`, `snapshot_count`, and
   `snapshot_sha256`. The call immutably snapshots the team's active
   `pending|failed|shadow_ok` intents and holds only that team. If it refuses with
   `f27_inflight_rows:<n>`, stop: wait for the worker to checkpoint and release its lease, or
   investigate an expired lease. Never clear a lease to force the rollback. If the response is
   lost, stop and recover the single correlated open rollback; do not retry blindly. Never publish
   row contents in the public repo.
3. Have the owner classify every intent as **replay**, **quarantine**, **discard with reason**, or
   **already reflected**, preserving actor/time and a durable decision record. An already-reflected
   decision must carry its exact correlated `f27_already_reflected_terminal` receipt; the label or a
   reason alone is not evidence. A generic green workflow summary is not evidence.
4. Replay only owner-approved intents through the audited path; verify their Linear receipts and
   exact values, then bind each exact provider receipt into the rollback intent ledger with
   `track_b_f27_record_terminal(rollback_id, outbox_id, receipt)`. Before finalizing, require the
   machine-read, team-scoped result `active_team_rows=0`, `unclassified=0`, and
   `unreceipted_replays=0`.
5. Only then use the installed finalizer below as the authority-reversal action. Supply the exact
   authority JSON passed to `track_b_f27_begin`, after confirming that it equals the correlated open
   rollback record's `expected_authority`. Read back the authority flag, `flag_flips`, completed
   rollback, and advanced team fence; then tell the team to work in Linear. Keep inbound warm and
   re-soak before any later re-flip.

If the tooling in steps 2–4 is unavailable, keep the team stopped and SyncView-authoritative with
F2 `off` and F4 `false`. Escalate; do not improvise a database delete or default drain.

Step 5 is exactly one statement. The finalizer refuses stale authority or
generation, nonzero/unclassified team residue, missing replay receipts, F2
not-off, or F4 not-false, and advances the requested team's generation in the
same transaction as its authority CAS:

```text
select public.track_b_f27_finalize(
  '<ROLLBACK_ID>'::uuid,
  '<EXACT_AUTHORITY_FROM_BEGIN_RECEIPT>'::jsonb,
  'owner-runbook'
);
```

This finalizer is installed, but it is usable only with the exact open-rollback
values produced by steps 2–4; it is never a blind flip-back. The 2026-08-02
reserved drill proved that this real finalizer refuses with
`f27_drill_authority_cas_refused`; drill completion uses its separate finalizer
and permanently retains the audit. Never replace either placeholder from
memory, substitute the drill finalizer, or loosen the function's checks.

## R3 — If Supabase itself is down

**Do not tell every team to use Linear.** Authority is per team, and no flag can be changed while
its database is unavailable. Use the last successful read-back captured in the incident/flip notes:

- A team last verified as **`linear`** may keep working in Linear.
- A team last verified as **`syncview`** must stop production mutations. Record each required
  change in a private incident log (time, person, target, field/action, intended value); do not make
  it in Linear. Tell the team plainly that the change is recorded but not saved yet.
- If authority is unknown, use the safer `syncview` instruction: stop and log; never guess Linear.
- After B5/Linear freeze, no team has a Linear fallback.

When Supabase returns, keep affected teams paused and **do not dispatch the reconciler yet**:

1. Read back every flag and confirm the database recovery point. If the restored data predates the
   outage, enter the restore/PITR procedure before accepting writes.
2. Snapshot Linear changes/comments made during the outage window and collect detect-only/failed
   automation evidence. Preserve this before an authority-directed reconcile can overwrite it.
3. For Linear-authoritative teams, pull their legitimate Linear work. For SyncView-authoritative
   teams, classify any accidental Linear edits as foreign and manually apply each intended change
   to SyncView with the original person/time recorded; then apply every private incident-log item.
4. Account for every logged/foreign intent as applied, rejected with owner reason, or duplicate.
   Only then run the reconciler in the authoritative direction, require zero unexplained diffs,
   terminal outbox and inbound receipts plus the outside-n8n observer, and tell each team where to resume.

**Before the first flip:** rehearse this mixed-authority branch and build an owner-approved way to
hold automatic reconciliation during recovery. Without that hold, R3 is not executable (F41).

---

*The runbook's canonical values were verified on 2026-07-13: auth enforcement uses `enforced`,
outbound uses `off`/`shadow`/`live`, and authority uses `linear`/`syncview`. F55 (closed
2026-07-28, source and live) removed the legacy `supabase` backend alias from every consumer and
shipped an all-consumer contract test. Never reintroduce that alias. If a permitted flip does not take effect within ~30 s,
hard-refresh; the mirror tab re-reads authority every 30 s.*
