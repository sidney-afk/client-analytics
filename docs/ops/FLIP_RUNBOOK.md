# FLIP RUNBOOK — owner-executable flag flips & emergency stops

**Who this is for.** The owner, alone, possibly in a hurry, without Codex. Every flip below is
copy-paste: either the Supabase **SQL Editor** statement, or the **Table Editor** click-path.
Created 2026-07-13 (audit F18 — the payload for "enforcing" that used to circulate silently
does nothing; the only value the code honors is `enforced`).

**Where:** Supabase Dashboard → project `uzltbbrjidmjwwfakwve` → **SQL Editor** (paste, Run)
or **Table Editor → `syncview_runtime_flags`** (edit the `value` cell of the row named below).

**Read-back (always verify after a flip).** Open this in any browser tab — it is the public
read-only key the app itself uses:

```
https://uzltbbrjidmjwwfakwve.supabase.co/rest/v1/syncview_runtime_flags?select=key,value&apikey=sb_publishable_P4-NdUWJqjtACWZOB6LPEA_8GANHAUA
```

---

## F1 — Team authority (who is the boss for a team)

Row: `prod_authority`. Valid sides: `"linear"` or `"syncview"` per team. NEVER any other word.

```sql
-- Flip GRAPHICS to SyncView (video stays on Linear):
update public.syncview_runtime_flags
set value = '{"video":"linear","graphics":"syncview"}'::jsonb, updated_by = 'owner-runbook'
where key = 'prod_authority';

-- Flip VIDEO to SyncView too (both live):
update public.syncview_runtime_flags
set value = '{"video":"syncview","graphics":"syncview"}'::jsonb, updated_by = 'owner-runbook'
where key = 'prod_authority';

-- EVERYDAY PAUSE (D-26) — both teams back to Linear:
update public.syncview_runtime_flags
set value = '{"video":"linear","graphics":"linear"}'::jsonb, updated_by = 'owner-runbook'
where key = 'prod_authority';
```

## F2 — Outbound mirror (SyncView → Linear writer)

Row: `linear_outbound_enabled`. Valid: `"off"`, `"shadow"` (log, don't write), `"live"`.

```sql
update public.syncview_runtime_flags
set value = '{"mode":"live"}'::jsonb, updated_by = 'owner-runbook'
where key = 'linear_outbound_enabled';
-- ...or '{"mode":"off"}' / '{"mode":"shadow"}'
```

## F3 — Inbound mirror (Linear → SyncView copier)

Row: `linear_inbound_enabled`. Keep `true` until B5. Kill only if inbound is actively
corrupting data:

```sql
update public.syncview_runtime_flags
set value = '{"enabled":false}'::jsonb, updated_by = 'owner-runbook'
where key = 'linear_inbound_enabled';
```

## F4 — Parity lane (transition writes to Linear while a team is still Linear-boss)

Row: `linear_legacy_parity_enabled`. Armed at Phase 1 of the checklist; kill switch for the
whole transition lane:

```sql
update public.syncview_runtime_flags
set value = '{"enabled":true}'::jsonb, updated_by = 'owner-runbook'
where key = 'linear_legacy_parity_enabled';
-- kill: '{"enabled":false}'
```

## F5 — Sign-in enforcement

Row: `auth_enforcement`. **The only enforcing value the code accepts is `enforced`** —
anything else (including `enforcing`) silently behaves as permissive.

```sql
update public.syncview_runtime_flags
set value = '{"mode":"enforced"}'::jsonb, updated_by = 'owner-runbook'
where key = 'auth_enforcement';
-- back: '{"mode":"permissive"}'
```

## F6 — Reroute allowlist (which clients' buttons use the new pipes; ships with the fix-pack)

Row: `write_ui_reroute_clients` (same pattern as `calendar_upsert_ef_clients`). TEST-only =
dark. Enroll cohorts by adding slugs. Emptying the list sends everyone back to legacy paths
instantly (pre-Phase-2 only; after a team flips, do NOT empty it — pause via F1 instead).

---

## R1 — "Something's wrong, make it stop" (global order)

1. If wrong data is being WRITTEN TO LINEAR: F2 → `off`. (Queued rows keep, nothing lost.)
2. If a flipped team is affected: R2 below for that team.
3. If the transition lane misbehaves pre-flip: F4 → `false`.
4. Read back the flags URL. Tell the team which system to work in. Then diagnose calmly.

## R2 — Pause a flipped team back to Linear (THE rollback; drain first — audit F05)

**Never skip step 1: flipping authority back with a pending backlog strands up to ~an hour of
the team's SyncView work, and inbound then overwrites it.**

1. **Drain:** GitHub → repo `sidney-afk/client-analytics` → Actions → workflow
   **"linear-outbound drain"** → *Run workflow* (button, default inputs) → wait for green.
2. **Confirm backlog 0** for that team: check the run summary (or the latest
   `linear_outbound_summary` event shows `pending: 0` for the team).
3. **Flip authority back** (F1, that team → `"linear"`).
4. Tell the team: "Work in Linear for now; don't use SyncView for status/comments until I
   say."
5. Nothing else — inbound keeps copying Linear → SyncView, so the mirror stays warm. Fix,
   re-soak, re-flip when clean.

## R3 — If Supabase itself is down

The team keeps working in real Linear (it is unaffected pre-B5). No flag can be flipped while
Supabase is down — that is fine: with Supabase down, SyncView is down, so nothing is writing.
When it returns: read back the flags URL, run one reconcile (Actions → "Linear ⇄ deliverables
reconcile v2" → Run workflow), and check diffs = 0 before telling anyone anything.

---

*Every statement above was verified against the code's accepted values on 2026-07-13
(`key-verify`/`client-token-verify` accept only `enforced`; `linear-outbound` accepts only
`off|shadow|live`; authority sides only `linear|syncview`). If a flip doesn't take effect
within ~30 s in the app, hard-refresh; the mirror tab re-reads authority every 30 s.*
