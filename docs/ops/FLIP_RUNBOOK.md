# FLIP RUNBOOK — owner-executable flag flips & emergency stops

**Who this is for.** The owner, alone, possibly in a hurry, without Codex. Every flip below is
copy-paste through the Supabase **SQL Editor** only; Table Editor is read-only for this runbook.
Created 2026-07-13 (audit F18 — the payload for "enforcing" that used to circulate silently
does nothing; the only value the code honors is `enforced`).

> **CURRENT GO-LIVE STATE: BLOCKED — DO NOT RUN ANY FORWARD FLIP.** The historical outbound-pipe
> drill is not human-cutover approval. PR #901 records the correctly aborted F27 install: #894's
> source had a late-writer authority-handoff race, an actorless replay-echo race, and no safe
> real-row-isolated drill. The corrective generation fence, exact preflight echo proof, reserved
> no-provider drill, and per-team outbox quarantine/classification remain source-only. The
> remaining `write_ui_reroute_clients` enrollment gates, and the open gates in
> `docs/independence/GO_LIVE_CHECKLIST.md` must close first. PR #850 deployed the allowlisted
> callers and gateway dark; the allowlist was last verified TEST-only, which is not real-client
> enrollment authorization. The only immediately usable Track-B
> containment is **stop affected mutations**, then disable the lane involved: F2 `off` stops normal
> SyncView-authoritative outbound; F4 `false` stops legacy parity. For an unknown/mixed incident,
> disable **both** and read both back. F1 authority reversal is not an emergency first step; it
> requires R2's completed intent accounting. Remove this banner only in the same reviewed change
> that records all gate evidence.
> F131/F132 mean a fresh timestamp or quiet pager is not a healthy receipt. F133–F137 mean the
> bounded SMM/editor source walks are not human handoff approval: canonical title/materialization,
> accessible reorder, creative transition policy, and all Video assets must pass their explicit
> TEST/device gates before the applicable team flips. F138 native Activity must pass by the
> owner-ratified first-flip-or-history-retirement gate; no document may silently choose that timing.

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

```sql
begin;
do $$
begin
  if exists (
    select 1
    from pg_proc p
    cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
    where p.oid = 'public.track_b_enqueue_outbound_intent()'::regprocedure
      and acl.grantee = 0::oid
      and acl.privilege_type = 'EXECUTE'
  ) then
    raise exception 'graphics_f2_public_execute_rollback_boundary_invalid';
  end if;
end;
$$;
grant execute on function public.track_b_enqueue_outbound_intent() to public;
commit;
```

That inverse deliberately restores the pre-existing exposure and makes the updated evidence gate
red. Never use it as a way to make a pre-F2 receipt pass.

### Packaged Graphics F2 evidence lane (read-only; owner still runs F2)

Use the GitHub Actions workflow **Graphics F2 evidence** in exactly two modes. The workflow never
changes a runtime flag, invokes a writer, dispatches the drainer, or performs F1. It observes one
already-completed scheduled `linear-outbound-drain` run and opens the database in one
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
isolated proof lane uses PostgreSQL 17. The workflow independently fingerprints the deployed
`linear-outbound` closure and fails if it differs from the selected release. No additional Edge
Function deploy is required or performed.

1. Choose one opaque 16-128 character binder and do not change it. Wait for a completed scheduled
   **SyncView Linear outbound drain** run on the release. Run **Graphics F2 evidence** with
   `mode=pre-f2`, that drainer run ID, the binder, the exact expected
   `legacy_parity_written` count, and an acknowledgement SHA-256 when that count is nonzero.
2. Require the one public-safe JSON receipt to say `PASS`, `authority=linear/linear`,
   `outbound_mode=off`, exact residue count `0`, correlation `PASS`, typed Linear credential
   `PASS`, dedicated PostgreSQL role `PASS`, GitHub Actions observer `PASS`, and normal-lane writes
   `0`. A manual or repository-dispatched drainer is ineligible. Any residue receipt includes
   its exact count, full-inventory SHA-256, and bounded team/status/operation classification; stop
   for owner classification and restart from a fresh pre receipt.
3. The owner alone runs F2 and its SQL readback from this runbook. The evidence workflow does not
   perform or retry this action.
4. Without changing the release or binder, wait for the first completed scheduled drainer run after
   the F2 readback. Run `mode=post-f2` with that drainer run ID and the successful pre-f2 evidence
   run ID. Supply the exact expected/acknowledged parity count for the complete durable
   F2-flip-to-selected-terminal window. The verifier exhausts the bounded scheduled-run history for
   the exact release and requires the
   selected run/attempt to be the first one created or started after F2, including a queued run
   created before F2 and even when that earlier run or attempt failed. Every rerun is expanded from
   attempt 1 through its current attempt, and database evidence covers every written row from F2
   through the selected terminal, so even an older cross-release retry cannot hide a write. It also
   requires the durable `linear_outbound_enabled` `flag_flips` event to be newer than the
   completed pre evidence run and the post drainer run/start to be newer than that F2 event; an older
   `live` drainer from the same release is red. Exactly one outbound transition may exist after the
   bound pre receipt, and it must be the qualifying `off→live`; any later toggle is red rather than a
   new write-window anchor.
5. Require `PASS`, `authority=linear/linear`, `outbound_mode=live`, exact residue count `0`, the
   exact pre-receipt hash, the same binder/release/function-source hashes, zero normal-lane writes,
   `handoff_order.status=PASS`, and `written == legacy_parity_written == expected`. Every counted write must have a typed Linear
   mutation/readback acceptance bound to the same hashed viewer identity. Missing, local-noop, or
   unbound provider evidence is red.

The receipt is intentionally bounded to enums, counts, GitHub/event IDs, and SHA-256 values. It
contains no client slug, outbox ID, payload, Linear ID, actor value, credential, database address,
or row body. A fresh timestamp, a quiet interval, an n8n execution, or an uncorrelated successful
HTTP request cannot substitute for either mode.

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
The first human authority flip is Graphics only. Do not run either forward statement while the
block banner is present; Video's statement is a later, separately approved gate after Graphics.
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
are forbidden while the block banner is present.

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

Forward to shadow (expected current state: off; blocked by the banner):

```sql
do $$ declare n integer; begin
  update public.syncview_runtime_flags
  set value = '{"mode":"shadow"}'::jsonb, updated_by = 'owner-runbook'
  where key = 'linear_outbound_enabled' and value = '{"mode":"off"}'::jsonb;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'shadow arm refused: expected off'; end if;
end $$;
```

Forward to live directly from off (expected current state: off; blocked by the banner):

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

Forward to live after the shadow dry-run (expected current state: shadow; blocked by the banner):

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

Forward arm (expected current state: disabled; blocked by the banner):

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

Forward enforce (expected current state: permissive; blocked by the banner and auth gates):

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

> **DEPLOYED DARK — OWNER-GATED.** PR #850 superseded closed-unmerged #813 and deployed the
> allowlisted callers plus `production-write` gateway. The allowlist was last verified with the
> private TEST client only; no real-client enrollment is authorized. There is intentionally no
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
3. If a flipped team is affected, snapshot its outbox and follow R2. Do not flip authority blindly.
4. Tell the team which system is authoritative and which mutations are stopped. Then diagnose.

## R2 — Pause a flipped team back to Linear (corrective source only; live use blocked)

**The old “run the default drainer and require green/pending 0” instruction was unsafe.** The
worker's normal summary does not provide an auditable per-team zero for this rollback, and stopping
outbound first prevents a normal drain. Blindly flipping authority can strand newer SyncView work;
blindly draining can send the very writes that triggered the incident.

PR #894 is not installable: its proof did not close the late pre-authorized
insert or actorless replay-echo races, and its real-team-only contract could not
be drilled safely. PR #901 records that the install stopped before DDL or
deploy. Corrective source now binds every real-team insert to a server
generation, requires an exact open rollback for the preflight echo exception,
and provides a reserved no-provider drill whose audit is retained. It is still
not live-applied. Until the corrective draft is cloud-reviewed and
owner-merged, then the separate snapshot-first install/readback/drill in
`docs/ops/F27_INSTALL_RUNBOOK.md` is owner-approved and complete, there is no
live one-click team rollback. Use this incident containment sequence:

1. Stop new mutations for the affected team and disable/read back the involved outbound lane(s) if
   Linear writes may be wrong: F2 `off` for normal rows, F4 `false` for parity rows, **both** when
   the source is unknown or mixed. Record the exact flag-flip ids and incident start time.
2. Capture an immutable count/list of that team's pending/retry/failed outbox intents and its latest
   authoritative row versions. Do not publish row contents in the public repo.
3. Have the owner classify every intent as **replay**, **quarantine**, **discard with reason**, or
   **already reflected**, preserving actor/time and a durable decision record. A generic green
   workflow summary is not evidence.
4. Replay only owner-approved intents through the audited path; verify their Linear receipts and
   exact values. Require a machine-read, team-scoped zero with no unclassified rows.
5. Only then change that team's F1 authority to `linear`, read back the flag and `flag_flips`, and
   tell the team to work in Linear. Keep inbound warm; re-soak before any later re-flip.

If the tooling in steps 2–4 is unavailable, keep the team stopped and SyncView-authoritative with
outbound off. Escalate; do not improvise a database delete or default drain.

Once the corrective F27 release is explicitly proved live, step 5 is exactly
one statement. The values are copied from the correlated open rollback receipt;
the function refuses stale authority or generation, nonzero/unclassified team
residue, missing replay receipts, F2 not-off, or F4 not-false, and advances the
requested team's generation in the same transaction as its authority CAS:

The template below becomes executable only under a separate full-F27 integration gate after the
F27 install is owner-approved.

```text
select public.track_b_f27_finalize(
  '<ROLLBACK_ID>'::uuid,
  '<EXACT_AUTHORITY_FROM_BEGIN_RECEIPT>'::jsonb,
  'owner-runbook'
);
```

This block is not usable while the corrective source remains unapplied. The
reserved drill must prove this real finalizer refuses with
`f27_drill_authority_cas_refused`; drill completion uses its separate finalizer
and permanently retains the audit. Never replace either placeholder from
memory or loosen the function's checks.

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
