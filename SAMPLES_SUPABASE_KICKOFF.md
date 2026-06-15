# Content Samples → Supabase — Migration Kickoff (paste into a fresh session)

> **How to use:** open a fresh Claude Code session on this repo (`sidney-afk/client-analytics`)
> with the same MCP access (n8n, Supabase via the committed publishable key, GitHub) and paste
> everything below the line as the task. This migrates the **Content Samples** feature's storage
> from Google Sheets → Supabase (live reads + realtime), mirroring the **content-calendar
> migration that just shipped** (see `CALENDAR_REALTIME_MIGRATION.md`). After Samples lands, the
> Google Sheet is fully retired. **Be empirical** (verify against live Supabase + n8n; reproduce;
> don't guess). **Branch + open PRs; never push to `main`.**

---

You are migrating **Content Samples** (Sheets → Supabase). It is an **architectural twin of the
calendar but simpler** — the calendar migration is your template. Reuse its proven shape:
**Phase 1 dual-write → Phase 2 hidden `?sv2=1` read+realtime → Phase 3 flip the default**.

## 0. Read first
1. `CALENDAR_REALTIME_MIGRATION.md` — the full calendar playbook you are copying (phases, the
   native-Supabase-node dual-write pattern, RLS/realtime SQL, the `_calV2*` runtime).
2. `PHASE4_CLEANUP_CHECKLIST.md` — note which calendar v1 machinery is being retired (don't copy
   dead patterns into Samples).
3. This doc.

## Ground rules (same as the calendar)
- **Use a SEPARATE flag `?sv2=1` / `CAL`-style `SM_V2_*` keys — NOT `?v2=1`.** The calendar's flip
  must never toggle a half-built Samples path, and vice-versa.
- **Branch, don't push to main.** v1 (default) stays byte-identical until a deliberate flip.
- **Snapshot every n8n workflow before editing** into `n8n-backups/<name>.<date>.<reason>.json`
  (redact any secret). n8n's own version history is the real rollback.
- **No secrets in the repo** — only the browser publishable key (already committed for the
  calendar; the same Supabase project/key is reused).
- **Verify with real data:** read Supabase REST with the publishable key; exercise the webhooks
  against a test client; cross-check the Sheet; parity-check before/after.
- **No polling / no idle load.** Reads under v2 come from Supabase; realtime is push. An idle open
  tab makes zero calls.

## Key facts (verify they're still true)
- **Same Supabase project** as the calendar: ref `uzltbbrjidmjwwfakwve`, publishable key already in
  `index.html` (`CAL_SUPABASE_ANON_KEY`). You'll add **one new table** (suggest `content_samples`).
- **Same Google Sheet** (doc `1Gsn5xLImJyMhBMCNjK_tigpoUfcSFnvxTQLkk-A9Yps`), one **`Samples_<slug>`**
  tab per client. **Slug parity with the calendar is exact** — `smClientSlug` and `calClientSlug`
  both call `wlNormalizeClient` (`index.html` ~7995). IDs are minted client-side `s_<ts36>_<rand>`
  (calendar uses `p_`).
- **n8n (`synchrosocial.app.n8n.cloud`), Supabase credential `XdBpJ6Xk8PMpZXXT` (reuse it).**
  Samples has **only 3 active webhooks + 1 provisioner** (calendar had ~7):

  | Workflow (id) | Webhook | Role |
  |---|---|---|
  | Samples — Get (`HyrucW0X8ckJogip`) | `GET samples-get?client=<slug>` | reads `Samples_<slug>`, returns `{ok, samples[]}` sorted by `order_index` |
  | Samples — Upsert (`23jv00ihCX75TjaB`) | `POST samples-upsert {client, sample}` | create-or-update by `id`; phantom-row guard; 3-way comment merge; **soft-delete = `status:'Archived'`** (no delete webhook) |
  | Samples — Reorder (`3WDxAYW23RBJTuFW`) | `POST samples-reorder {client, items[{id,order_index}]}` | per-row Sheets `update` (unknown ids skipped) |
  | Samples — Provision Missing Tabs (`7Pdp6qnkBzwXP3YG`) | manual, inactive | creates missing tabs; unneeded post-migration |

  Both writers have **`versionId === activeVersionId`** (no divergent-draft trap like the calendar
  reorder had — confirm before editing).

## Schema (authoritative — from `samples-upsert` Build Row From Patch `ALLOWED`)
A sample row = `id` + `updated_at` + these columns (all text in Sheets; mirror them as `text`,
`comments` as text-JSON or `jsonb`):

```
kind, order_index, label, media_url, creative_direction, hide_creative_direction,
comments, status, created_at, approval,
kasper_approved_at, kasper_approved_by, client_approved_at, client_approved_by
```
- `kind` ∈ `reel|thumb`; `status` default `Active`, `Archived` = soft-deleted (filtered on load);
  `approval` workflow `draft→kasper→client→approved` (+ `changes`); `comments` = JSON array of
  `{id,parent_id,author,role,body,created_at,updated_at,audience,deleted}` (tombstone-aware).
- **Target table:** `content_samples`, PK `(client, id)`, all `text`, server-set `updated_at`.

## Front-end map (`index.html`, one inline `<script>`)
- **Module: lines ~10055–10960.** State `smState` (~10077): `{client, kind, mode, samples[], loading,
  error, embedded, focusCard}`. Slug `smClientSlug` (~10086). Webhook consts ~10065–10067
  (`SAMPLES_GET_URL`/`SAMPLES_UPSERT_URL`/`SAMPLES_REORDER_URL`).
- **Load:** `loadSamples(opts)` (~10303) — cache-first (`localStorage` key
  `syncview_samplesCache_v1:<slug>`) then revalidate over `samples-get`; **on mount + client-switch
  only** (no focus refetch, no poller).
- **Save:** `_smScheduleSave`→`_smFlushCardSave` (~10657–10681) — optimistic, debounced 700ms,
  **whole-row** POST to `samples-upsert` (`wire` built ~10675). No field patch, no `comments_base_at`,
  no conflict guard.
- **Delete:** `_smDeleteCard` (~10616) — soft-delete upsert `{id, status:'Archived'}`.
- **Reorder:** `_smReorder`/`_smPersistReorder` (~10638/10650) — local splice + POST all
  `{id,order_index}` to `samples-reorder`.
- **Nav/teardown hook:** `navTo('samples')` branch ~10900; add the realtime teardown on the
  leave-samples path (~10869), mirroring the calendar's `_calV2Teardown` in `navTo` (~10864).
- **Client-share view** (`?c=…&v=samples&t=<token>`) and `#samples/<slug>/<id>` deep links exist and
  carry over unchanged.

## Migration plan (mirror the calendar)
**Phase 1 — Dual-write (zero user-facing change).**
- Create `content_samples` (PK `(client,id)`, columns above, all text). Enable RLS, **anon SELECT
  policy `using(true)`**, add to `supabase_realtime` publication, `replica identity full` (copy the
  SQL from `CALENDAR_REALTIME_MIGRATION.md` → "To ACTIVATE", swapping the table name).
- **Backfill** every `Samples_<slug>` tab into the table (re-runnable; a one-off n8n workflow that
  reads `samples-get` per client and inserts — clone the calendar's `Backfill (ALL clients)`).
- **Add a Supabase mirror to the 2 writers** (`samples-upsert`, `samples-reorder`) using the **native
  Supabase node** (credential `XdBpJ6Xk8PMpZXXT`, `onError: continueRegularOutput` so a Supabase
  failure never breaks the Sheet write). Upsert = create-or-update keyed on its `Read Existing Row`;
  soft-delete rides the upsert (`status=Archived`); reorder = per-row `update`. **Snapshot each
  first.** Use the **same `updated_at`** the Sheet write uses (so parity is exact). Verify on a test
  client: create + edit + archive + reorder all land in Supabase.

**Phase 2 — Hidden `?sv2=1` read + realtime.**
- Add config near the calendar's (`SM_SUPABASE` can reuse `CAL_SUPABASE_URL`/`_ANON_KEY`/`_LIB_URL`);
  new `SM_V2_LS_KEY`/`SM_V2_KILL_KEY`.
- `_smV2Enabled()`/`_smV2Ready()` gates mirroring `_calV2Enabled`/`_calV2Ready` (~14231–14250).
- `_smV2FetchSamples(slug)` mirroring `_calV2FetchPosts` (~14286): `GET {SUPABASE}/rest/v1/
  content_samples?select=*&client=eq.<slug>` with `apikey`/`Bearer`, mapped through `_smNormalize`,
  **falling back to `samples-get` on any error**. Swap it into `loadSamples` behind `_smV2Ready()`.
- Realtime channel `sm-<slug>` on table `content_samples`, filtered `client=eq.<slug>`, debounced
  coalesced reload + self-echo suppression + reconnect catch-up — clone `_calV2EnsureSubscribed`/
  `_calV2OnRealtimeChange`/`_calV2Teardown` (~14304–14385). **Reuse the calendar's generic
  `_calV2LoadLib`/`_calV2Client` (supabase-js loader + client singleton) as-is.** Teardown on
  leaving the samples view.
- Gate everything on `_smV2Ready()` so v1 is byte-identical with the flag off.

**Phase 3 — Flip `?sv2=1` to the default** (sticky `?sv2=0` kill-switch), exactly like the calendar
flip (`_calV2Enabled`, now default-on). Writes keep dual-writing to the Sheet → reversible.

## The one real decision: writes — whole-row vs field-patch
Samples currently sends the **whole row** on every save and **tracks no dirty fields** (the calendar
threads an `edits` set and sends field patches). Two implications:
- **Good news:** the calendar's nastiest v2 bug (the *partial-echo* status-revert) **cannot occur**
  here — a whole-row echo has every column. So you can ship Phase 2/3 keeping **whole-row writes**.
- **Trade-off:** whole-row writes mean two people editing the same sample card are last-writer-wins
  (one clobbers the other). Samples are edited far less concurrently than calendars, and realtime
  surfaces the other editor within ~1s, so this is **probably acceptable for v1 of the flip** — but
  decide explicitly. If clobber-free concurrent editing is wanted, the **single biggest net-new FE
  task** is adding dirty-field tracking to `_smFlushCardSave` so it can send `{id, ...changed}`
  patches (the `samples-upsert` Build-Row-From-Patch + autoMapInputData already accept partials).
  Recommendation: **ship whole-row first, add patches later if needed.**

## Deltas vs the calendar (so you don't over-build)
- **No Linear** (no `linear_issue_id`, no banners, no caption automation). **No Kasper review page**
  — Samples approval is just the `approval` column + stamps (no separate poller/teardown).
- **Single `status`** (Active/Archived) + a single `comments` thread — **not** the calendar's three
  sub-statuses / per-component tweak columns / recomputed overall. Flatter schema.
- **No conflict machinery, no settings row, no batched-reorder variant, no delete webhook.** Fewer
  things to model and mirror.
- **No existing Supabase wiring in Samples** (grep `sv2|_smV2|SM_SUPABASE` → none). Greenfield.

## Verify (live, before flipping)
- **Parity:** for several clients incl. a test one, compare `samples-get` id-set + a sample of fields
  against `content_samples` (REST `select=*&client=eq.<slug>`). 0 diffs.
- **Security:** anon SELECT works; **anon INSERT → 401** (RLS `new row violates…`). Realtime: a
  `postgres_changes` subscription on `content_samples` is accepted.
- **v1 byte-identical** with `?sv2=0`: zero Supabase calls, supabase-js never loads.
- **End-to-end:** a save on one tab shows on a second tab in <~1s via realtime.

## Required output
1. Confirmed schema + the `content_samples` table created (SQL run).
2. Dual-write live on both writers (snapshots committed) + a parity verdict (numbers).
3. The `?sv2=1` FE path (gated; v1 untouched) with live realtime verification.
4. A go/no-go on flipping `?sv2=1` to default, and the whole-row-vs-patch decision recorded.
5. After the flip proves out: **retire the Google Sheet** (it's now only a mirror) — decide keep as
   a human-readable export or drop, and update `CALENDAR_REALTIME_MIGRATION.md`/this doc.
