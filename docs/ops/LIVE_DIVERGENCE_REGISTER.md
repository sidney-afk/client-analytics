# Live divergence register

**Every artifact in this repository where the committed source is NOT what is
running in production.** If a path is listed here, reading the file tells you
what SHOULD be true, not what IS true, and deploying it from the repo is a
production change with consequences the file itself does not state.

This exists because the repo reads as authoritative everywhere, which is exactly
what makes the exceptions dangerous — they look identical to the 99% of files
where repo *is* live. Three separate sessions have now re-derived "deploy this
by hand" for the frozen writers from `EF_DEPLOY_MANIFEST.md` and been wrong
(most recently PR 1370, caught in review before it reached the owner's hands).

`test/live-divergence-register.js` fails when a change touches a registered path
without this file being updated in the same change. That is the whole mechanism:
it does not judge the change, it forces the register into your diff so the
divergence cannot be discovered afterwards.

---

## Registered paths

### `supabase/functions/calendar-upsert/index.ts`
### `supabase/functions/sample-review-upsert/index.ts`

| | |
|---|---|
| **Live** | `calendar-upsert` v43 / `sample-review-upsert` v44 — the pre-#836 **un-gated, tokenless** source |
| **Repo** | still calls `authorizeBrowserWrite` (the F35 gate) |
| **Since** | 2026-07-15 |
| **Why** | Re-gating `401`s every client approval and comment on a link issued before the gate. It broke clients **twice** in one day. |
| **Deploying the repo source** | Re-applies the gate. Silent client outage. `--no-verify-jwt` does not help — the refusal is application-level. |
| **To ship a change** | Capture the exact live source, apply the delta to *that*, deploy it, with the owner's explicit approval. Never a bare `supabase functions deploy`. |
| **To close the divergence** | Re-issue every active client link, then re-gate. Owner has declined this for now, so the divergence is permanent until they say otherwise. |
| **Sources** | `AGENTS.md` freeze banner · F35 row of `ROLLBACK.md` · `EXECUTION_LOG.md` 2026-07-15 |

---

## What this register is not

**It does not list every manually-deployed function.** `NO CI DEPLOY PATH` in
`docs/ops/EF_DEPLOY_MANIFEST.md` means "no workflow deploys this", and for most
such functions the repo source *is* live and deploying it by hand is correct.
Those are not divergences and do not belong here. The distinction is the whole
point, and it is the one the manifest does not draw:

- **`NO CI DEPLOY PATH`** — nobody automated the deploy. Deploy by hand.
- **Registered here** — there is a live divergence CI is *deliberately not
  allowed* to overwrite. Do not deploy by hand either.

**It does not track drift you have not verified.** A file is registered when
someone has established the divergence against the live system, not when they
suspect one. On 2026-09-09 the `calendar_posts_stamp_status_at` trigger was
suspected of drifting and checked with
`select pg_get_functiondef('public.calendar_posts_stamp_status_at'::regproc);` —
it matched, so it is not registered. Checking and finding no divergence is the
expected outcome; that is what makes registered entries worth reading.

## Adding an entry

Register a path the moment you establish that live differs from the repo. Include
what is live, what the repo says, why the divergence exists, what deploying the
repo source would do, and what would close it. An entry with no "what would close
it" is an entry nobody can ever retire.
