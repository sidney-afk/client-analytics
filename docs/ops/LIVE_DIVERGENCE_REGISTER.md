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
| **Live** | `calendar-upsert` v49 / `sample-review-upsert` v50 (2026-09-10) — still the **un-gated, tokenless** lineage, with the additive Kasper marker patch applied to it |
| **Repo** | still calls `authorizeBrowserWrite` (the F35 gate) |
| **Since** | 2026-07-15 |
| **Why** | Re-gating `401`s every client approval and comment on a link issued before the gate. It broke clients **twice** in one day. |
| **Deploying the repo source** | Re-applies the gate. Silent client outage. `--no-verify-jwt` does not help — the refusal is application-level. |
| **To ship a change** | Capture the exact live source, apply the delta to *that*, deploy it, with the owner's explicit approval. Never a bare `supabase functions deploy`. |
| **To close the divergence** | Re-issue every active client link, then re-gate. Owner has declined this for now, so the divergence is permanent until they say otherwise. |
| **Sources** | `AGENTS.md` freeze banner · F35 row of `ROLLBACK.md` · `EXECUTION_LOG.md` 2026-07-15 |

---

## Verified live capability

The repo copy is not deployable, so **nothing in it is evidence of what
production does**. These rows record what the DEPLOYED function was observed to
contain, read straight off the deployed source on the date given. They exist so
that a capability the repo copy claims can be checked against one production
actually has.

This section is machine-read by `test/live-divergence-register.js`. The `events:`
list is every literal `ev("…")` action the live function can emit. A repo copy
that gains an action missing from its live row fails the gate, which forces the
divergence to be either deployed or declared instead of quietly believed.

- `calendar-upsert` live v49 verified 2026-09-10 events: approve_, archive, comment_add, comment_delete, create, kasper_approve, kasper_close, kasper_finish, link_clear, link_set, status_change, urgent_ping
- `sample-review-upsert` live v50 verified 2026-09-10 events: approve_graphic, approve_video, archive, comment_add, create, kasper_approve, kasper_close, kasper_finish, link_clear, link_set, status_change, urgent_ping

**Why this section exists.** On 2026-09-09 the Kasper urgent ping shipped with an
`ev("kasper_urgent_ping")` branch in both repo copies, and a test asserting it was
there. It was never in the deployed functions: the branch was not carried across
when the marker patch was ported onto the live source. The result was a feature
whose paper trail existed only in a file that does not run, and nothing noticed,
because every guard we had pointed at the repo. The first real ping wrote its
marker and produced no ledger row at all (OPEN_REPAIRS 195).

The ledger for that ping is now written by a database trigger
(`migrations/2026-09-10-kasper-urgent-ping-ledger.sql`) rather than by the
writers, so the repo copies no longer carry the branch and the two sides agree
again. The trigger cannot drift from the live functions, because it is not in
them.

**Refreshing a row.** Read the deployed source (Supabase → Edge Functions, or
`get_edge_function`), list its `ev("…")` actions, and update the row with the new
version and today's date. Never copy the list out of the repo file — that is the
exact mistake this section exists to catch.

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
