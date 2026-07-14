# Onboarding Fallback & Backup (never lose a submission)

> **ABUSE/INTEGRITY BLOCKER (F81).** “Never lose” currently also means an unauthenticated caller can
> choose an ID, upsert arbitrary payload/note content, reset creation chronology, and trigger the
> shared alert route without nonce, rate, size/schema/kind, or ownership controls. Preserve the
> public client journey, but add bounded server-minted submission sessions and negative abuse tests.
>
> **CAPTURE IS NOT COMPLETION (F110/F111).** This safety net protects a copy of the answers. It
> does not prove credential import, Drive/CRM/Slack provisioning, Track-B enrollment, or staff
> acknowledgement. Primary duplicate handling de-duplicates the intake row but bypasses downstream
> work, so replay is not completion-safe. Use the SyncView onboarding inbox/job as the current
> operator entry; the replaced Notion workflow is not a fallback.

The goal, verbatim from the June 2 July call: **a client's submitted form must never
be lost — there must always be a copy somewhere.** This doc describes the layered
safety net added 2026-07-02 around both onboarding funnels (`/onboarding_form` +
`/ai_onboarding_form`, see ONBOARDING_FORM.md for the form itself).

## The layers

```
                    ┌──────────────── while typing ────────────────┐
                    │ localStorage draft (600ms debounce)          │
                    │ + throttled draft sync (~25s) ───────────────┼──▶ fallback store
                    │ + sendBeacon flush on tab hide/close ────────┼──▶ fallback store
                    └──────────────────────────────────────────────┘
Submit ──▶ primary n8n webhook (20s timeout, 1 auto-retry)
   │              │ insert OK ──▶ Supabase table ──▶ fail-soft alert ──▶ 200 (captured)
   │              │            ├─▶ form also parks a `submitted` copy in the fallback store
   │              │            └─▶ credentials + unawaited provisioning (no completion receipt)
   │              │ insert FAILS ─▶ dead-letter to Data Table + 🚨 Slack DM ──▶ 500
   │              │ duplicate id ─▶ 200 {ok, duplicate:true}  (row dedup only; no resume)
   │ primary unreachable / non-200
   ├──▶ Supabase Edge Function `onboarding-capture`  (different infra than n8n)
   ├──▶ n8n fallback webhook `onboarding-fallback`   (different store than Supabase)
   │        both upsert into the fallback store + 🛟 Slack DM on real captures
   └──▶ everything down: honest failure copy + “Download my answers” file
                                    (client emails it to house@synchrosocial.com)

Weekly (Sun 2AM): Drive backup now also dumps client_onboarding +
ai_client_onboarding (account-credential fields STRIPPED from answers).
```

**The fallback store** is two places with the same row shape, keyed by the client's
stable submission id:

- n8n Data Table **`onboarding_fallback`** (id `5dqP1AdgvDtvMboC`) — lives in n8n,
  NOT Supabase, so it survives Supabase-side failures.
- Supabase table **`public.onboarding_fallback`** — written by the Edge Function,
  survives n8n-side failures. (`migrations/onboarding-fallback-supabase-migration.sql`.)

Row kinds: `draft` (autosaved while typing) → `submit-fallback` (primary failed,
this IS the submission) → `submitted` (primary succeeded; kept as the second copy).
Plus `deadletter` (Data Table only): the primary webhook reached n8n but the
Supabase insert failed.

## Stable submission id

`_obSubId()` mints the id once per funnel per browser (localStorage
`syncview[_ai]_onboarding_subid_v1`, in-memory fallback) and reuses it across
retries, draft syncs and fallbacks; it clears on success. So:

- a retry after a lost success response gets `200 {ok, duplicate:true}` from the
  primary (the insert 409s on the PK and the error branch classifies it), so the
  intake row is not duplicated. That direct duplicate branch does **not** resume
  credential import or provisioning and is not a completion receipt (F110);
- draft → fallback → submitted all upsert ONE row per client in the fallback store.

## What is live right now (n8n side — no action needed)

| Piece | Where | State |
| --- | --- | --- |
| Fallback capture webhook | wf `u4ACOKArXHidVJXl`, `POST /webhook/onboarding-fallback` | ✅ active, tested (JSON + text/plain beacon + Slack alert) |
| Data Table `onboarding_fallback` | n8n project `4dvRQbC5gyJNowXX`, id `5dqP1AdgvDtvMboC` | ✅ created, taking rows |
| Dead-letter + duplicate branch | both primary submit workflows | ✅ row-level dedup live; downstream resume missing (F110) |
| Slack cred drift fix | `ljNY…` Notify Sidney → **SyncView Bot** (`qUlAcjdhd6EpKOTL`) | ✅ done (was “Slack account 2” per 06-25 snapshot) |
| Weekly backup incl. onboarding tables | wf `jlVfbg0Njxf1It7h` | ✅ live; verified run 2026-07-02 (`supabase-2026-07-02.json`, counts 2926/25/1/1, credential-strip verified) |

Pre-edit rollback snapshots: `n8n-backups/*.2026-07-02.pre-*.json`.

## Deployment status — no operator actions

Both fallback stores are deployed. The migration remains an idempotent historical definition, not
a paste-ready instruction, and live Edge deployment follows the reviewed B4 fingerprint/readback
process. F81 still blocks treating the public capture route as hardened.

## Replaying a captured submission

A capture alert means a copy exists outside the primary table. Do not manually POST its sensitive
payload from this public guide: the current duplicate branch can acknowledge an existing intake row
without healing missed downstream work. Until F110 ships, an authorized operator verifies whether
the primary row exists, records every missing side effect, and uses a private owner-reviewed recovery
runbook; the final design must resume the same server-owned job idempotently and read back completion.

## Sensitivity notes

- Fallback payloads (both stores) can carry the same plaintext account credentials
  as the onboarding tables. The Supabase fallback table has the identical
  RLS/revoke lockdown; the n8n Data Table is only reachable by n8n logins.
- The weekly Drive dump **strips** the six credential keys
  (`instagram, instagram_backup, tiktok, facebook, linkedin, youtube`) from
  `answers` before upload — passwords/2FA codes never land in Drive. They exist
  only in the live locked-down tables (clients are steered to LastPass anyway).

## Housekeeping / test data

Do not publish row identifiers or deletion recipes here. TEST cleanup requires a private exact-row
manifest, ownership/readback assertions, backup confirmation, and an owner-reviewed deletion. Draft
retention/pruning needs an explicit privacy and recovery policy; “rows are small” is not a policy.

## Loss scenarios → where the copy lives now

| Scenario | Copy |
| --- | --- |
| n8n down / webhook deactivated / adblocked | Edge Function → Supabase `onboarding_fallback` (+ optional Slack) |
| Supabase insert fails (cred/table/outage) | Data Table dead-letter + 🚨 DM; browser also falls back |
| Both n8n and Supabase down | client keeps draft + downloads answers file; drafts already synced earlier |
| Client abandons after failure, never retries | latest draft/fallback row already server-side (throttled sync + beacon) |
| Success response lost, client retries | Original intake row remains; duplicate 2xx does not prove or resume downstream completion (F110) |
| Row deleted / table dropped later | weekly Drive dump (credential-stripped) + `submitted` copy in fallback store |
| Private mode / in-app browser (no localStorage) | draft sync + beacon still fire (id held in memory for the session) |
