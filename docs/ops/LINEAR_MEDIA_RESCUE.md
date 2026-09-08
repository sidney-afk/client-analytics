# Linear media rescue (LX-E)

Re-hosting `uploads.linear.app` images into the already-live
`syncview-description-images` bucket for cards someone is still working.

**Status: prepared, not run.** Nothing in this document has been executed
against live data. No object was written to Storage, no `brief` or `body` was
rewritten, no migration was applied.

---

## 0. The finding that resizes this lane

**`uploads.linear.app` images do not render in SyncView today. They have not
rendered since roughly five minutes after each one was mirrored.** This lane is
an improvement, not a rescue, and its deadline is soft.

Measured live 2026-09-07 22:36–22:42Z, read-only:

| Check | Result |
|---|---|
| Decoded the `?signature=` JWT on a live issue description | `exp - iat` = **300 seconds** exactly |
| GET with a signature 31 seconds old | **200**, `image/png`, 1,045,198 bytes |
| GET of the same URL 45 seconds after `exp` | **401** `{"error":"unauthorized"}` |
| GET of the same URL with the signature stripped | **401** |
| Read the same issue twice, five minutes apart | path **identical**, signature **completely different** |

Linear mints that JWT on every API read and gives it five minutes. The URL that
the mirror wrote into `deliverables.brief` carried a signature that died five
minutes later. So what an editor sees on an affected card today is a
broken-image icon labelled "Pasted image" — `imageTag`'s fallback alt
(`index.html:54983`), because the Linear form is `![](url)` with an **empty**
alt. There is no error banner and the surrounding text is intact, which is why
this has gone unreported.

### What 2026-09-15 actually destroys

Not the ability to fetch the bytes from a stored URL — that is already gone, and
has been for months. What ends is **the ability to mint a fresh signature by
reading the issue through the Linear API**, which is the only remaining route to
any byte the owner's private capture does not already hold.

So exactly one part of this lane is time-critical:

> **Confirm the owner's private capture covers the active set, before 2026-09-15.**

Everything else — the upload, the rewrite, the SQL — can land afterwards
without losing anything.

### The join key, which the lane brief got wrong

Because the signature is re-minted per read, **the full URL is not a stable
identity**. Two reads of one file five minutes apart produced the same path and
different signatures. Every lookup — into the capture, into the upload out-map,
and for de-duplication — keys on `mediaKey()` = origin + pathname, never the
whole URL. Keying on the full URL would report capture gaps that are not real
and would upload the same bytes once per occurrence.

### Why no manifest is committed

A stored URL carries a JWT plus the workspace and per-file UUIDs, and this repo
is public. `scripts/linear-media-rescue.mjs` refuses (`assertPrivatePath`) to
write a manifest or an out-map anywhere inside a git working tree. What is
publishable is a count and `mediaKeyHash()` — the SHA-256 of the path.

---

## 1. "Active card", as a predicate

```sql
create temporary view lxe_active as
select d.id, d.client_slug, d.team, d.status, d.brief
  from public.deliverables d
  join public.clients c on c.slug = d.client_slug
  join public.batches b on b.id   = d.batch_id
 where d.status in ('triage','backlog','todo','in_progress',
                    'smm_approval','kasper_approval','client_approval','tweak')
   and c.active
   and c.kind <> 'test'
   and c.board_status not in ('completed','canceled')
   and b.status <> 'archived';
```

The eight statuses are the non-terminal half of the `deliverables.status` check
constraint (`migrations/2026-07-06-b1-linear-data-model.sql:38-41`). Excluded on
purpose: `approved`, `scheduled`, `posted`, `canceled`, `duplicate`.

**Two things the owner should know about this predicate before ruling on it.**

1. **`c.board_status not in ('completed','canceled')` currently excludes
   nothing.** Measured live 2026-09-07: across all 49 client rows the only
   `board_status` values in existence are `in_progress` (43) and `backlog` (6).
   Neither `completed` nor `canceled` nor `paused` occurs at all. The clause is
   harmless and worth keeping as a guard, but the belief that it is what
   implements "do not rescue historical media" is wrong — **the deliverable
   `status` list is the entire lever**. It also makes the brief's open question
   about `paused` clients moot: there are none.
2. **`client_approval` is included, and it is the one status a reasonable person
   would argue about.** An editor is not working a card in client review, but it
   bounces straight to `tweak` and the brief's reference images are what the
   tweak is judged against. Kept on the permissive side per AGENTS.md
   ("prefer things to be not strict than strict"). One word from the owner
   removes it.

### The client half, measured

| | |
|---|---|
| client rows total | 49 |
| pass `active and kind <> 'test' and board_status not in (…)` | **42** |
| removed by `kind <> 'test'` | 3 |
| removed by `not active` | 4 |

### The counting queries — RUN THESE, they are the numbers this lane needs

`deliverables`, `batches`, `production_comments` and `description_images` all
return **42501** to the browser publishable key, so this session could not count
the set. CLAUDE.md's "you can READ most tables" does not extend to these four.
The numbers below are unmeasured and must not be guessed at.

```sql
-- (1) rows in the active set whose brief still carries Linear media
select count(*) as rows_to_rewrite
  from lxe_active where brief like '%uploads.linear.app%';

-- (2) occurrences (a brief may carry several)
select count(*) as occurrences
  from lxe_active d,
       lateral regexp_matches(
         d.brief, 'https?://uploads\.linear\.app/[^\s<>"''\)\]]+', 'g') m
 where d.brief like '%uploads.linear.app%';

-- (3) DISTINCT FILES — this is the upload count, and it keys on the path,
--     because the ?signature= differs per occurrence for the same file.
select count(distinct split_part(m[1], '?', 1)) as distinct_files
  from lxe_active d,
       lateral regexp_matches(
         d.brief, 'https?://uploads\.linear\.app/[^\s<>"''\)\]]+', 'g') m;

-- (4) the same, for comments on those cards
select count(*) as comment_rows, count(distinct pc.deliverable_id) as cards
  from public.production_comments pc
  join lxe_active d on d.id = pc.deliverable_id
 where pc.deleted_at is null
   and pc.body like '%uploads.linear.app%';

-- (5) THE GAP ITEM 164 NAMED AND NOBODY HAS COUNTED: comment attachments.
--     The scan predicate is body-only; a Linear comment's file metadata lands
--     in attachments jsonb (migrations/2026-07-12-production-comments.sql:53-54).
select count(*) as attachment_rows
  from public.production_comments pc
  join lxe_active d on d.id = pc.deliverable_id
 where pc.deleted_at is null
   and pc.attachments::text like '%uploads.linear.app%'
   and pc.body not like '%uploads.linear.app%';

-- (6) THE OTHER FOUR FREE-TEXT COLUMNS, also never counted. Each renders to
--     staff through _prodDescriptionHTML(..., false), so each is a link that
--     dies, not an image (images are off at those two call sites).
select
  (select count(*) from public.batches   where description like '%uploads.linear.app%') as batches_description,
  (select count(*) from public.batches   where comments    like '%uploads.linear.app%') as batches_comments,
  (select count(*) from public.clients   where board_desc  like '%uploads.linear.app%') as clients_board_desc,
  (select count(*) from public.deliverables where comments like '%uploads.linear.app%') as deliverables_comments;
```

### Over-ceiling census, which decides whether E4 is needed at all

The bucket's `file_size_limit` is 4 MiB and `policy.MAX_DIMENSION` is 8000px,
enforced independently of bytes. Sizes are not in the database — they are only
on the files themselves — so run this against the private capture directory
once the manifest exists, and do **not** raise the ceiling on a guess:

```
# in the owner's private capture directory
find . -type f -size +4M | wc -l
```

If that is 0, work item E4 never happens and this lane needs no migration, no
`policy.mjs` edit, and no Edge Function deploy. See §4.

---

## 2. Running it

Nothing here runs in CI. `scan` and `rewrite` are offline; only `upload`
touches the network.

```
# 1. Export the active set to a PRIVATE path (not in the repo).
#    rows.json = [{table, id, client_slug, status, brief|body}, ...]
#    from the queries above, via the SQL Editor's download.

# 2. Census. Refuses to write inside a git tree.
node scripts/linear-media-rescue.mjs scan \
    ~/.syncview/lxe/rows.json ~/.syncview/lxe/manifest.json

# 3. Upload. LIVE. Needs the owner's admin staff key.
SYNCVIEW_UPLOAD_URL=https://<ref>.supabase.co/functions/v1/description-image-upload \
SYNCVIEW_STAFF_KEY=… SYNCVIEW_STAFF_ACTOR='<roster name>' \
node scripts/linear-media-rescue.mjs upload \
    ~/.syncview/lxe/manifest.json ~/.syncview/lxe/files ~/.syncview/lxe/out-map.json

# 4. Generate the matched SQL pair. Offline. Verifies the inverse as it writes.
node scripts/linear-media-rescue.mjs rewrite \
    ~/.syncview/lxe/manifest.json ~/.syncview/lxe/out-map.json \
    ~/.syncview/lxe/forward.sql ~/.syncview/lxe/rollback.sql
```

`upload` is resumable: it writes `out-map.json` after every success and skips
anything already in it, so an interrupted run continues where it stopped.

### Two preconditions the lane brief did not list

1. **The kill switch must be on.** `description-image-upload` reads
   `description_image_upload_enabled` from `syncview_runtime_flags` *before* it
   authenticates anyone (`index.ts:221`, via `uploadEnabled` at `:150-160`) and
   fails closed. If it has ever been flipped off the whole run 503s with
   `upload_disabled`. Check first:
   `select value from public.syncview_runtime_flags where key = 'description_image_upload_enabled';`
2. **`qa/probes/p96_description_image_upload.js` should be green first.** It is
   the nightly proof that the upload path works end to end, and it stays red
   until the `SYNCVIEW_STAFF_ACTOR` repo secret exists
   (`docs/ops/DESCRIPTION_IMAGE_UPLOAD.md` §0). A red p96 means the path is
   unproven and the rescue run should not start.

### Pacing

`RATE_LIMIT_PER_HOUR = 120` per actor, and the deciding count *includes* the row
the caller just reserved (`index.ts:183-205`), so exactly 30s spacing refuses
itself at the boundary. The script defaults to 40s plus jitter. Do not raise the
constant — that is a code change and a deploy for nothing.

---

## 3. Reversibility, and why the rewrite cannot race

`rewrite` emits a matched pair. Both are one transaction. Every row is a
compare-and-swap on its exact pre-image:

```sql
with upd as (
  update public.deliverables
     set brief = '<new>'
   where id = '<id>'
     and brief = '<exact old literal>'
  returning 1
)
insert into lxe_applied (row_key, matched) select 'deliverables:<id>', count(*) from upd;
```

and a single guard at the foot raises if **any** row failed to match, rolling
the whole transaction back and naming the offending keys. So if an editor, a
another lane, or the inbound webhook changed a brief between the census and the
apply, the apply fails loudly and changes nothing. That is the intended outcome:
**a failed rescue that leaves every brief intact is a good result.**

`rollback.sql` is guarded on the **new** literal, so it cannot fire twice and
cannot clobber an edit made after the rescue. `scripts/linear-media-rescue.mjs`
verifies the pair is an exact inverse as it writes them, and
`test/linear-media-rescue.js` proves the property on fixtures.

### Expected side effects of the apply, so a later reader is not alarmed

- `deliverables.updated_at` moves (`track_b_deliverable_touch_timestamps_before`,
  `migrations/2026-07-06-b1-linear-data-model.sql:219-237`). An editor with the
  description panel open at that moment gets the loud refusal *"Description
  changed elsewhere. Your draft is preserved…"* and loses nothing. Run it
  outside working hours anyway. **Comments have no such trigger.**
- One `deliverable_events` row per updated deliverable, `action='update'`,
  `source='system'`, `reason='rpc_bypass_guard'`
  (`track_b_deliverable_ledger_guard_after`, same file `:239-290`). That is an
  audit trail, not damage. It does **not** enqueue `mirror_outbox`, so nothing
  is pushed back to Linear.
- Sequence the comment half **after** the inbound webhook is off. On a Linear
  comment `update` event that is neither an echo nor a tombstone, `body`
  survives into `production_comment_upsert` and can overwrite the rewrite. The
  detection is cheap: re-run count (4); anything non-zero is a clobber, and
  re-running the forward SQL for those rows fixes it.

---

## 4. What this lane does NOT do

See `docs/ops/OPEN_REPAIRS.md` item **173**, which carries the full
deliberately-not-rescued list with the owner's veto line next to each.

The headline one: **work item E4, the bucket ceiling raise, is not taken.**
Raising `file_size_limit` to 25 MiB costs a hand-applied migration, a
`policy.mjs` edit, a `test/description-image-upload.js` edit, a real Edge
Function deploy and an owner approval window. Since the render finding in §0
makes this lane an improvement with a soft deadline, spending an owner window on
it is the wrong trade. Files over 4 MiB or over 8000px are listed as not
rescued; the one-statement migration is written down in item 173 and can be
taken later as a follow-up if the census says it is worth it.
