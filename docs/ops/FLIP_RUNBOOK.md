# FLIP RUNBOOK — owner-executable flag flips & emergency stops

**Who this is for.** The owner, alone, possibly in a hurry, without Codex. Every flip below is
copy-paste through the Supabase **SQL Editor** only; Table Editor is read-only for this runbook.
Created 2026-07-13 (audit F18 — the payload for "enforcing" that used to circulate silently
does nothing; the only value the code honors is `enforced`).

> **CURRENT GO-LIVE STATE: BLOCKED — DO NOT RUN ANY FORWARD FLIP.** The historical outbound-pipe
> drill is not human-cutover approval. F27's per-team outbox quarantine/classification, the
> `write_ui_reroute_clients` flag and caller code, and the open gates in
> `docs/independence/GO_LIVE_CHECKLIST.md` must close first. The only immediately usable Track-B
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

**Read-back (always verify after a flip).** In SQL Editor, run this; do not paste a browser key or
secret into the runbook or incident notes:

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

## F1 — Team authority (who is the boss for a team)

Row: `prod_authority`. Valid sides: `"linear"` or `"syncview"` per team. NEVER any other word.
Some backends still accept legacy `"supabase"` while the browser rejects it (F55); that split-brain
alias must be removed before any drill. Never use it as a compatibility shortcut.
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

Forward to live (expected current state: off or shadow; blocked by the banner):

For the first Graphics handoff, this is deliberately executed and proved **before** F1 while both
teams remain Linear-authoritative. Do not continue to F1 if the CAS, readback, correlated terminal
drainer/credential receipts, or outside-n8n observer fails.

```sql
do $$ declare n integer; begin
  update public.syncview_runtime_flags
  set value = '{"mode":"live"}'::jsonb, updated_by = 'owner-runbook'
  where key = 'linear_outbound_enabled'
    and value in ('{"mode":"off"}'::jsonb, '{"mode":"shadow"}'::jsonb);
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'live arm refused: expected off or shadow'; end if;
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

> **NOT DEPLOYED.** As of the 2026-07-13 second pass, neither current `main` nor the inspected PR
> #813 head creates or reads `write_ui_reroute_clients`. There is intentionally no copy-paste
> payload here. Phase 0.5 must first ship the row and every intended caller, read back the exact
> deployed behavior, and pass TEST plus stale-tab/failure drills. Only then may this runbook gain a
> cohort-edit statement. An absent flag must never be interpreted as “all clients” or “safe to
> advance.” Before team authority changes, removing a proved cohort is the parity-lane rollback;
> after authority changes, follow R2 and use F1 only after its accounting gate completes.

---

## R1 — "Something's wrong, make it stop" (global order)

1. Stop affected users from making new mutations.
2. If wrong or unexplained data is being WRITTEN TO LINEAR, set **both** F2 → `off` and F4 →
   `false`, then read back both rows. If the incident is conclusively isolated to one lane, its own
   kill is sufficient; when uncertain, never assume F2 also stopped parity. Queued rows remain for
   classification; **do not run the default drainer after turning normal outbound off**.
3. If a flipped team is affected, snapshot its outbox and follow R2. Do not flip authority blindly.
4. Tell the team which system is authoritative and which mutations are stopped. Then diagnose.

## R2 — Pause a flipped team back to Linear (blocked until F27 is implemented)

**The old “run the default drainer and require green/pending 0” instruction was unsafe.** The
worker's normal summary does not provide an auditable per-team zero for this rollback, and stopping
outbound first prevents a normal drain. Blindly flipping authority can strand newer SyncView work;
blindly draining can send the very writes that triggered the incident.

Until F27 ships an owner/Codex-assisted, audited per-team quarantine/classify/replay/discard tool,
there is no safe one-click team rollback. Use this incident containment sequence:

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
outbound uses `off`/`shadow`/`live`, and authority uses `linear`/`syncview`. F55 remains open because
some backends also accept legacy `supabase` while the browser rejects it; never use that alias. If a
permitted flip does not take effect within ~30 s, hard-refresh; the mirror tab re-reads authority
every 30 s.*
