# Onboarding Fallback & Backup (never lose a submission)

> **ABUSE/INTEGRITY BLOCKER (F81).** “Never lose” currently also means an unauthenticated caller can
> choose an ID, upsert arbitrary payload/note content, reset creation chronology, and trigger the
> shared alert route without nonce, rate, size/schema/kind, or ownership controls. Preserve the
> public client journey, but add bounded server-minted submission sessions and negative abuse tests.

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
   │              │ insert OK ──▶ Supabase table ──▶ Slack DM ──▶ 200
   │              │            └─▶ form also parks a `submitted` copy in the fallback store
   │              │ insert FAILS ─▶ dead-letter to Data Table + 🚨 Slack DM ──▶ 500
   │              │ duplicate id ─▶ 200 {ok, duplicate:true}  (retries never poison)
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
  primary (the insert 409s on the PK and the error branch classifies it) — no
  duplicate rows, no stuck retry loop;
- draft → fallback → submitted all upsert ONE row per client in the fallback store.

## What is live right now (n8n side — no action needed)

| Piece | Where | State |
| --- | --- | --- |
| Fallback capture webhook | wf `u4ACOKArXHidVJXl`, `POST /webhook/onboarding-fallback` | ✅ active, tested (JSON + text/plain beacon + Slack alert) |
| Data Table `onboarding_fallback` | n8n project `4dvRQbC5gyJNowXX`, id `5dqP1AdgvDtvMboC` | ✅ created, taking rows |
| Dead-letter + duplicate branch | submit wfs `ljNY7CKYLKzMOACZ` + `hxLFIdKG9hUIzukO` | ✅ live, duplicate path tested on both funnels |
| Slack cred drift fix | `ljNY…` Notify Sidney → **SyncView Bot** (`qUlAcjdhd6EpKOTL`) | ✅ done (was “Slack account 2” per 06-25 snapshot) |
| Weekly backup incl. onboarding tables | wf `jlVfbg0Njxf1It7h` | ✅ live; verified run 2026-07-02 (`supabase-2026-07-02.json`, counts 2926/25/1/1, credential-strip verified) |

Pre-edit rollback snapshots: `n8n-backups/*.2026-07-02.pre-*.json`.

## Finish steps (Supabase side — two commands, then the Edge layer is live too)

The form already tries the Edge URL first and falls through cleanly while it 404s,
so nothing breaks before these run — the n8n fallback carries the load alone.

1. Run `migrations/onboarding-fallback-supabase-migration.sql` in the SQL editor
   (project `uzltbbrjidmjwwfakwve`).
2. `supabase functions deploy onboarding-capture --project-ref uzltbbrjidmjwwfakwve --no-verify-jwt`
   (CLI: `supabase login` first; `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` are
   auto-injected, no secrets required). Optional: `supabase secrets set
   SLACK_ALERT_WEBHOOK=<incoming-webhook-url>` to get pinged on Edge captures.

## Replaying a captured submission

A 🛟/🚨 DM means a submission is sitting in the fallback store instead of the real
table. To replay: open the row (n8n → Data Tables → onboarding_fallback, or the
Supabase table), copy `payload`, and POST it to the primary webhook once the fault
is fixed:

```
curl -X POST https://synchrosocial.app.n8n.cloud/webhook/{onboarding-submit|ai-onboarding-submit} \
  -H 'Content-Type: application/json' -d '{"submission": <payload>}'
```

Same id → if it somehow already landed, you just get `{ok, duplicate:true}` —
replays are always safe. The dashboard inbox reads the real tables only, so a
replayed submission shows up there like any other.

## Sensitivity notes

- Fallback payloads (both stores) can carry the same plaintext account credentials
  as the onboarding tables. The Supabase fallback table has the identical
  RLS/revoke lockdown; the n8n Data Table is only reachable by n8n logins.
- The weekly Drive dump **strips** the six credential keys
  (`instagram, instagram_backup, tiktok, facebook, linkedin, youtube`) from
  `answers` before upload — passwords/2FA codes never land in Drive. They exist
  only in the live locked-down tables (clients are steered to LastPass anyway).

## Housekeeping / test data

Safe to delete whenever (they're clearly marked):

- Data Table rows `o_fallback_probe_001` / `o_fallback_probe_002` (today's fallback tests).
- Supabase `ai_client_onboarding` row `o_test_delete_me_001` and
  `client_onboarding` row `o_livetest_1782428655` (earlier live tests) — these two
  also sit in the dashboard inbox. **Careful with the DELETE — scope it by id**;
  as of the 2026-07-02 backup run these tables are in the weekly Drive dump, so
  there's finally a copy to fall back on.
- Drafts accumulate one Data Table/Supabase row per browser that typed a name or
  email; prune occasionally if it bothers anyone (rows are tiny text).

## Loss scenarios → where the copy lives now

| Scenario | Copy |
| --- | --- |
| n8n down / webhook deactivated / adblocked | Edge Function → Supabase `onboarding_fallback` (+ optional Slack) |
| Supabase insert fails (cred/table/outage) | Data Table dead-letter + 🚨 DM; browser also falls back |
| Both n8n and Supabase down | client keeps draft + downloads answers file; drafts already synced earlier |
| Client abandons after failure, never retries | latest draft/fallback row already server-side (throttled sync + beacon) |
| Success response lost, client retries | `{ok, duplicate:true}` — original row intact |
| Row deleted / table dropped later | weekly Drive dump (credential-stripped) + `submitted` copy in fallback store |
| Private mode / in-app browser (no localStorage) | draft sync + beacon still fire (id held in memory for the session) |
