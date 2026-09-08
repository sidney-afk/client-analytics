⚠️ ⚠️  READ THIS BEFORE EXECUTING ANYTHING FROM THIS FILE  ⚠️ ⚠️

**333 lines across the six briefs are TRUNCATED MID-SENTENCE, and some of them are
owner-executable migration and rollback steps.** This is a defect in how the briefs
were generated: the scoping workflow that produced them capped each field at a fixed
character budget (clusters at 254, 264, 315, 329, 331 and 705 characters), and the
clipped text was never restored. Codex found it on 2026-09-08; nobody had noticed.

Real examples from this set: a prohibition that ends at `Never apply
2026-09-05-native-only-intake.sql ` without saying what to do instead, and a rollback
that ends at the incomplete identifier `dropping production_`.

**The rule, and it is not optional: if a line stops mid-sentence, DO NOT EXECUTE IT
and do not guess the rest.** Go to the source it names — the migration file, the
workflow, `docs/ops/`, `EXECUTION_LOG.md`, `ROLLBACK.md` — and re-derive the full
instruction there. A truncated `undo:` is the worst case, because it reads like a
complete recovery procedure and is not one.

These briefs remain useful as a map of what each lane covers and where to look. They
are NOT safe as a runbook until the clipped fields are restored.

### RESTORATION PASS, 2026-09-08 (lane LX-RESTORE) — read this before you trust a line below

The **executable** clipped lines in this file have been restored: the
`- [migration]`, `- [edge-function-deploy]`, `- [runtime-flag]`, `- [other]`,
`- [n8n-edit]`, `undo:` and `mitigate:` lines inside LIVE ACTIONS and RISKS.
Nothing else has been. The other clipped fields (`why:`, `confirmed:`,
`where:`, `lift:`, evidence, and the `[A1]`/`[B1]`-style work-item lines) are still
truncated, so the warning above stands and this file is still NOT a runbook.

**How to tell a restored line from an original one.** Every restored line ends
with a bracketed marker naming the date and the primary source it was
re-derived from:

> `**[RESTORED 2026-09-08 · source: …]**`

A line with that marker has been checked against the source it names. A line
without one has not been checked by this pass at all — it is either untouched
original text or one of the ~284 clipped fields still owed.

**Restored does not mean the original text was right.** The generating
workflow's output is gone, so nothing here is a recovery of what was written;
each line was re-derived from the repository. Where a source CONTRADICTED the
surviving fragment, the restored line says so in bold and does not smoothly
continue the false sentence. Where a procedure could not be established from
any primary source, the line says that too, in those words, instead of
supplying a plausible one — an honest gap is safe and a guess is not.

**This file: 7 executable lines restored, 0 left unrestored.** One carries the
most dangerous correction in this whole pass, found by Codex review on #1352 and
not by me: the storage-rollback `undo:` inherited the selector
`where deliverable_id is not null`, which does NOT isolate rescue uploads. Every
ordinary paste-into-description upload carries the same `deliverable_id`, so
deleting what that query returns would delete live images out of real
descriptions. The line now says so in bold and enumerates from the rescue
out-map instead. An earlier version of this restoration extended that selector
without checking what it selects.


---

SESSION NAME: LX-E Media rescue
KEEP THIS EXACT SESSION TITLE. Do not rename it. The owner tracks six parallel sessions by title.

SESSION NAME: LX-E Media rescue
Keep this exact session title. Do not rename it. The owner tracks parallel sessions by title.

You are ONE of six parallel sessions removing Linear from SyncView before Linear
access ends on 2026-09-15. Today is 2026-09-07. A coordinator session owns merge
order and the ledger; you own exactly one lane and nothing else.

YOUR BRANCH: claude/lx-e-media   (create it from origin/main, push there, never elsewhere)

READ FIRST, IN THIS ORDER:
1. AGENTS.md (house standard, outranks CLAUDE.md)
2. CLAUDE.md
3. docs/independence/LINEAR_EXIT_LANES.md  <-- the lane map. Your lane, your files, your boundaries.
4. The lane brief below.

THE OWNER'S ONE RULE, above everything: do not break the client lifecycle.
Clients approve posts and request changes through anonymous tokenless links.
Those must keep working, unchanged, at every point in your work.

HARD BOUNDARIES
- Touch ONLY the files listed as yours in LINEAR_EXIT_LANES.md. If you need a file
  another lane owns, STOP and write the need into the ledger instead of editing it.
- index.html is one 79k-line file that every lane touches. Stay inside your named
  functions. Never reformat, never reflow, never "clean up while you are here".
- Merging to main deploys the live site instantly. You do not merge. You open a PR
  and stop. The coordinator merges.
- calendar-upsert and sample-review-upsert must stay tokenless. Never deploy the
  repository copies of those writers as-is.
- Never edit an n8n workflow unless your brief explicitly authorizes that specific
  workflow. Export its JSON to the private Drive backup first and commit only a
  public-safe status stub to n8n-backups/.
- The repo is PUBLIC. No secrets, tokens, client display names, share-link tokens,
  or private file URLs in code, comments, commits, tests or CI output. Client slugs
  are fine. Prefer counts over names.
- Mutate only the test client `sidneylaruel` unless the owner names another.
- Additive-only SQL. No DROP, no RENAME, no type changes.

THE LEDGER IS NOT OPTIONAL
docs/ops/OPEN_REPAIRS.md is the ledger. Append, never rewrite. Before you push,
add an entry for anything you learned, deferred, or deliberately did not do,
including work you decided was out of scope. The owner reads this file. A thing
that is not in the ledger did not happen. Check for duplicate `## N.` headers
after any merge; concurrent branches routinely claim the same number, so take the
next free number at the moment you write, and if you collide, renumber yours.

PROOF BAR
- `npm test` is the full offline suite and takes several minutes. Run it before you push.
- `npm run test:prod-polish` CANNOT pass in this sandbox (no route to the live
  backend); all 8 lanes fail identically on origin/main. Verify against main before
  calling anything a regression.
- Add a test for every behavior you change. A change with no test does not land.
- Do not claim a live system state you did not read. If you could not verify it,
  say so in the PR body.

WHEN YOU FINISH, OR WHEN YOU ARE BLOCKED
Push, open a DRAFT PR titled `LX-E: <what it does>`, and in the body state:
  - what is done and proven, with the test names
  - what is NOT done
  - every live action the owner must take (migration, deploy, flag, n8n edit),
    each with its exact undo
  - anything you found that belongs to another lane
Then stop. Do not merge. Do not start another lane's work.


=== YOUR LANE: E ===
BRANCH: claude/lx-e-media
MERGE POSITION: 6th. Last among anything that rewrites deliverables.brief so your compare-and-swap fails loudly rather than overwriting another lane.

GOAL
Every `uploads.linear.app` file referenced from a brief or comment on a card someone is still working is re-hosted in the ALREADY-LIVE `syncview-description-images` bucket and the stored text is rewritten to that URL — with zero new buckets, zero new tables, zero Edge Function code changes, and zero Section 4 deploys.

DONE WHEN
  - `select count(*) from public.deliverables d join public.clients c on c.slug=d.client_slug join public.batches b on b.id=d.batch_id where d.brief like '%uploads.linear.app%' and d.status in ('triage','backlog','todo','in_progress','smm_approval','kasper_approval','client_approval','tweak') and c.active and c.kind<>'test' and c.board_status not in ('completed','canceled') and b.status<>'archived'` returns 0.
  - The same predicate joined to `public.production_comments pc on pc.deliverable_id = d.id and pc.deleted_at is null and pc.body like '%uploads.linear.app%'` returns 0.
  - Every rescued object has a row in `public.description_images` carrying its `deliverable_id` and `client_slug` (the attribution headers `x-syncview-image-issue` / `x-syncview-image-client` are populated by the rescue script), so the rescue set is enumerable server-side after the fact with no new table.
  - A generated `linear-media-rescue-rollback.sql` exists, is byte-checked against the forward file, and restores every original `brief`/`body` literal; running it returns each row to its pre-rescue text.
  - Opening one rescued card in SyncView Production shows the image inline in the read view AND round-trips byte-for-byte through the visual editor (Edit -> no Markdown-fallback banner -> Save with no change) — proving no `index.html` change was needed.
  - `node test/linear-media-rescue.js` passes: the occurrence scanner reproduces exact offsets/lengths for the angle-bracket form, the bare form and repeated occurrences; the rewriter is a pure offset splice that preserves `![alt](...)` vs bare form; the generated rollback is the exact inverse.
  - `node test/description-image-upload.js` and `node test/prod-description-image-paste.js` still pass (they are the guard on anything the ceiling change touches).
  - A hand-off list names every occurrence NOT rescued (over ceiling, non-raster MIME, outside the predicate) with its deliverable id and original URL, appended to `docs/ops/OPEN_REPAIRS.md`.

ALREADY BUILT — LIFT THESE, DO NOT REBUILD
  * Public Storage bucket `syncview-description-images` (public=true, file_size_limit=4194304, allowed_mime_types = png/jpeg/webp/gif) plus the service-role-only `description_images` ledger and the `description_image_upload_enabled` kill-switch flag. APPLIED LIVE by the owner 2026-09-05.
    where: origin/main — migrations/2026-09-05-description-images.sql lines 19-30 (bucket), 36-50 (ledger), 73-76 (flag)
    confirmed: Read the file; `ROLLBACK.md:106` records `migrations/2026-09-05-description-images.sql (applied by the owner 2026-09-05)` and `docs/ops/DESCRIPTION_IMAGE_UPLOAD.md` §0 lists it as shipped.
    lift: Nothing to lift — it is already live. Lane E writes into it. This is the whole corner-cut.
  * Edge Function `description-image-upload`: takes raw bytes in the POST body with `content-type`, `x-syncview-key`, `x-syncview-actor`; binds to exactly one active admin/SMM roster row; verifies declared MIME against magic bytes and full structural parse; mints `<uuid>.<verified-ext>`; reserves a ledger row; uploads; returns a durable public https URL. Accepts optional `x-syncview-image-client` / `x-syncview-image-issue` attribution headers.
    where: origin/main — supabase/functions/description-image-upload/index.ts:225-298 (handler), :106-148 (authorize), :112-116 (attributionHeader); policy.mjs:12-50 (BUCKET/MAX_BYTES/ALLOWED_TYPES/EXTENSION)
    confirmed: Read index.ts:225-298 and policy.mjs:1-50. The success return at index.ts:293-300 is `{ok:true,url:publicUrl,...}` — a plain public https URL, exactly what the rescue needs.
    lift: Call it, unchanged, from a local operator script on the owner's machine with his admin `x-syncview-key` and roster name. No deploy, no edit — UNLESS the ceiling has to be raised (see work item E4).
  * The read renderer already draws `![alt](https://…)` as an inline `<img>` for deliverable descriptions, with a 360px cap and click-to-open — and the visual editor already round-trips a Supabase public image URL byte-for-byte (that is the shipped item 157/158 paste path).
    where: origin/main — index.html:55948-55951 (`_prodDescriptionHTML` passes `{images:true}` only when `rich`), index.html:54985-54991 (`imageTag`, https-only), index.html:58258 (the one rich call site)
    confirmed: Read all three spans. `_prodLinkifyInline` matches BOTH `![alt](<https://…>)` and `![alt](https://…)`, so both wrapper forms in the captured corpus survive a URL-for-URL splice.
    lift: Nothing to lift. This is the reason lane E needs ZERO index.html change — a rescued URL is shape-identical to a pasted one. The candidate's ~700 lines of `_prodBriefMediaReadHTML` / `_prodBriefMediaPreviews` / `_prodBriefMediaImageError` / `_prodCommentMediaHTML` exist only because it chose a PRIVATE bucket with 5-minute signed URLs. Choosing the public bucket deletes all of it.
  * `briefMediaOccurrences(text)` — a 6-line exact-offset scanner for `uploads.linear.app` URLs that handles the angle-bracket form `<url>`, the bare form, and repeated occurrences, returning `{offset,length,url}` in UTF-16 code units.
    where: candidate 5bcc03bd — supabase/functions/_shared/native-brief-media.mjs lines 7-13
    confirmed: `git show 5bcc03bd…:supabase/functions/_shared/native-brief-media.mjs` — read the regex: `/<(https?:\/\/uploads\.linear\.app\/[^<>]+)>|(https?:\/\/uploads\.linear\.app\/[^\s<>"'\])]+)/gi` with `m.index + (m[1] ? 1 : 0)`. It does what the name says.
    lift: Copy the 6 lines verbatim into `scripts/linear-media-rescue.mjs`. Do NOT import the module — importing drags in `projectBriefMedia`, `signNativeMedia` and the whole private-bucket contract, and creates a shared file another lane may also claim.
  * A Python offline byte validator for the exact corpus MIME set (Pillow full-frame decode, PyMuPDF, defusedxml, PyAV), with socket/subprocess audit hooks.
    where: candidate 5bcc03bd — scripts/native-brief-media-validate.py (92 lines)
    confirmed: Read the whole file. It is real and it works, but it requires Pillow 12.3.0 / PyMuPDF 1.28.0 / defusedxml 0.7.1 / PyAV 16.1.0 on the owner's machine.
    lift: DO NOT LIFT. `description-image-upload/policy.mjs` already performs a full structural walk of PNG/GIF/JPEG/WebP server-side (chunk CRCs, inflated IDAT stream, EOI/IEND/trailer framing — docs/ops/DESCRIPTION_IMAGE_UPLOAD.md documents it), and it runs on every upload with no local dependency. Lane E gets its byte validation for free by going through the function. Lifting the Python adds four native 
  * The 1166 in-cap brief files and 75 comment files are ALREADY DOWNLOADED and hash-verified in the owner's private custody, with a pinned aggregate receipt.
    where: candidate 5bcc03bd — docs/ops/NATIVE_BRIEF_MEDIA.md ("Final local corpus check: all 1166 already acquired in-cap URL files passed…", aggregate SHA-256 883ce0bdce33ae492e92a2a290d519e5319230e706bc3e94b95bdeae1399f752) and docs/ops/NATIVE_COMMENT_MEDIA.md ("All 75 originals are privately preserved")
    confirmed: Read both docs on the candidate. NOT INDEPENDENTLY VERIFIED — the files are outside git by design (`privateFile()` in scripts/native-brief-media-package.mjs refuses any path under a `.git` ancestor). I am asserting what the doc claims, not what I saw.
    lift: If true, the Linear-side capture race is ALREADY WON and lane E never has to touch Linear at all — it only has to upload a subset of files the owner already holds. Confirm this in the first five minutes; it changes the whole shape of the lane (see open_questions).
  * `isDetectOnlyTeam` — with both teams SyncView-authoritative, the linear-inbound webhook cannot overwrite `deliverables.brief`.
    where: origin/main — supabase/functions/linear-inbound/index.ts:678-684 (the gate), :751 (the early return), :813-819 (the `row.brief = issue.description` write that is now unreachable)
    confirmed: Read all three spans. `isDetectOnlyTeam` returns true when `prod_authority[team]==='syncview'`; the branch at :751 returns before the field-copy block at :813.
    lift: Nothing to lift — it is a fact that de-risks the brief rewrite. It does NOT protect comments: `persistProductionComment` runs at linear-inbound/index.ts:1245, BEFORE the detect-only gate at :1247, and its field list includes `body` (:1168, :1179). See risks.

WORK ITEMS
  [E1] (low risk, new) Count the rescue set and freeze it
     Run the two counting queries (in `done_when` and below) against live with the browser publishable key — CLAUDE.md states it can READ most tables. Write the result into `docs/ops/LINEAR_MEDIA_RESCUE.md` as the frozen manifest: deliverable id, client_slug, team, status, exact offset, length, original URL, for every occurrence. Also emit the comment manifest (comment id, deliverable_id, audience, version, offset, length, URL). This manifest, not a live re-scan, is what every later step consumes, so the set cannot silently grow while the work is in flight. Cross-check the URL list against the owner's private capture receipt (883ce0bd…) to confirm every rescued file is already on disk; any URL NO
     files: docs/ops/LINEAR_MEDIA_RESCUE.md, scripts/linear-media-rescue.mjs
  [E2] (medium risk, new) Re-host the bytes through the LIVE description-image-upload function
     `scripts/linear-media-rescue.mjs upload <manifest.json> <private-files-dir> <out-map.json>`: for each DISTINCT original URL in the manifest, read the already-captured local file, POST its raw bytes to `description-image-upload` with `content-type` = the file's verified MIME, `x-syncview-key` = the owner's admin key (read from an env var, never a literal), `x-syncview-actor` = the owner's roster name, `x-syncview-image-client` = client_slug, `x-syncview-image-issue` = deliverable id. Record `{original_url, new_url, mime_type, byte_length, sha256}` in the out-map. Deduplicate by original URL so a URL repeated across occurrences uploads once. PACE AT ONE UPLOAD PER 30 SECONDS: `RATE_LIMIT_PER_H
     files: scripts/linear-media-rescue.mjs
  [E3] (medium risk, new) Generate the forward and rollback SQL as a matched pair
     `scripts/linear-media-rescue.mjs rewrite <manifest.json> <out-map.json> <forward.sql> <rollback.sql>`. For each deliverable: take the exact `brief` string from the manifest, splice each occurrence in DESCENDING offset order (so earlier offsets stay valid), replacing exactly `[offset, offset+length)` with the new URL — a pure URL-for-URL substitution that preserves whatever wrapper the original had (`![alt](URL)` stays image syntax; `![alt](<URL>)` stays the angle form, which index.html:54987 also renders; a bare URL stays a bare link). Emit one `begin; … commit;` containing, per row, `update public.deliverables set brief = $new$…$new$ where id = '…' and client_slug = '…' and brief = $old$…$o
     files: scripts/linear-media-rescue.mjs
  [E4] (medium risk, new) CONDITIONAL — raise the bucket ceiling only if the predicate leaves files over 4 MiB
     Run only if E1 shows rescue-set files above 4 MiB. `migrations/2026-09-08-description-images-ceiling.sql` = one statement, `update storage.buckets set file_size_limit = 26214400 where id = 'syncview-description-images';` (25 MiB — comfortably under the 50 MiB GLOBAL Storage ceiling that docs/ops/NATIVE_COMMENT_MEDIA.md names, so no global change and no owner approval for a platform setting). Then `supabase/functions/description-image-upload/policy.mjs:17` `MAX_BYTES` 4*1024*1024 -> 25*1024*1024 (three refusals must agree: bucket limit, MAX_BYTES, and the content-length pre-check at index.ts:233), and `test/description-image-upload.js:169-171` which asserts both numbers. Deploy is `.github/wo
     files: migrations/2026-09-08-description-images-ceiling.sql, supabase/functions/description-image-upload/policy.mjs, test/description-image-upload.js
  [E5] (low risk, new) Prove it with a pure-function test, then in the real app
     `test/linear-media-rescue.js`: feed the scanner the angle form, the bare form, a URL repeated three times in one brief, a URL immediately followed by `)` and by `.`, and a brief with 0 occurrences; assert offsets/lengths match a hand-computed table. Feed the rewriter a synthetic brief plus a fake out-map and assert (a) the output contains no `uploads.linear.app`, (b) every non-URL character is byte-identical, (c) applying the generated rollback string-substitution returns the exact original. No network, no Deno, no live backend — it must run in the sandbox. Then the human half: open one rescued card in Production, confirm the image draws, click Edit, confirm the visual editor opens (not the 
     files: test/linear-media-rescue.js
  [E6] (low risk, new) Record the decision and the rollback
     Append `## 163.` to `docs/ops/OPEN_REPAIRS.md` (append, never rewrite — and check for a duplicate `## 163.` after merge, since concurrent lanes routinely claim the same number). It must carry the deliberate NOT-rescued list verbatim from `not_rescued` below, with counts, so the decision is on the record rather than a silence. Append one row to `ROLLBACK.md` naming the rollback SQL file, the fact that objects in `syncview-description-images` are durable and public and that deleting them is a Storage action rather than a rollback (mirroring the existing item-157 row at ROLLBACK.md:106), and the `description_images` ledger query that enumerates every rescued object: `select deliverable_id, clie
     files: docs/ops/OPEN_REPAIRS.md, ROLLBACK.md, docs/ops/LINEAR_MEDIA_RESCUE.md

FILES YOU OWN (touch nothing else)
  scripts/linear-media-rescue.mjs
  test/linear-media-rescue.js
  docs/ops/LINEAR_MEDIA_RESCUE.md
  docs/ops/OPEN_REPAIRS.md
  ROLLBACK.md
  migrations/2026-09-08-description-images-ceiling.sql
  supabase/functions/description-image-upload/policy.mjs
  test/description-image-upload.js

LIVE ACTIONS THE OWNER MUST TAKE (prepare them exactly; never execute them)
  - [storage] Run `scripts/linear-media-rescue.mjs upload` — it POSTs the already-captured file bytes to the LIVE `description-image-upload` Edge Function with the owner's admin staff key, creating durable public objects in `syncview-description-images` and rows in `public.description_images`. **ORDERING: IF E4 IS BEING TAKEN, ITS THREE PARTS GO FIRST — bucket `file_size_limit`, `policy.MAX_BYTES`, and the function redeploy — ALL BEFORE THIS STEP, not after it as they appear below.** The deployed handler refuses an oversize file at `MAX_BYTES` and the bucket refuses it independently, so an upload run before the raise simply never creates those objects. **IF E4 IS NOT BEING TAKEN — which is item 173's standing ruling, files over 4 MiB or over 8000px are NOT rescued — then expect a partial result and read it as intended rather than as breakage.** Each oversize file prints `REFUSED 413 image_too_large` and the run exits non-zero (`if (failed) process.exitCode = 1`), which is loud. The quiet part is downstream: `rewriteText` SKIPS an occurrence it cannot resolve rather than failing (scripts/linear-media-rescue.mjs:146-149), so the forward SQL still applies and a brief containing one rescued and one oversize image is rewritten for the first and left pointing at the dead `uploads.linear.app` URL for the second. **COUNT OCCURRENCES, NOT REFUSAL LINES — they are different numbers and only one of them is the exposure.** `cmdUpload` iterates a `byKey` map built one entry per distinct file (`if (!byKey.has(occ.key)) byKey.set(occ.key, occ)`, scripts/linear-media-rescue.mjs:326-328), so it prints ONE `REFUSED` line per distinct file; `cmdRewrite` then skips EVERY occurrence of that key. A file referenced in six briefs is one refusal line and six surviving dead links. So join each refused key back to all matching `manifest.occurrences` and record BOTH numbers — distinct files refused, and occurrences left pointing at `uploads.linear.app` — in the OPEN_REPAIRS entry, with the occurrence count as the headline. This is AGENTS.md's own "measure with the key the shipped code uses" rule: the refusal loop keys on the file and the damage keys on the occurrence. **[RESTORED 2026-09-08 · sources: scripts/linear-media-rescue.mjs lines 136-152, 357-386; supabase/functions/description-image-upload/index.ts (MAX_BYTES refusal) and policy.mjs:17,20; migrations/2026-09-05-description-images.sql:19-30; docs/ops/OPEN_REPAIRS.md item 173 point 2. Ordering and the partial-rewrite consequence added after Codex round nine (P1).]**
    undo: **DO NOT USE `where deliverable_id is not null` TO ENUMERATE WHAT TO DELETE. IT SELECTS ORDINARY STAFF UPLOADS TOO, AND DELETING THEM BREAKS LIVE DESCRIPTIONS.** The surviving fragment carried that predicate and an earlier pass of this restoration extended it without checking what it selects; it is wrong. Every ordinary paste-into-description upload sends `X-Syncview-Image-Issue: <issue.id>` (`_prodDescriptionPostImage`, index.html:58008-58018) and `description-image-upload` stores that header as `description_images.deliverable_id` (index.ts:257-271). The rescue script sends the SAME header (`'x-syncview-image-issue': occ.id`, scripts/linear-media-rescue.mjs:365), so a rescue row and a staff row are indistinguishable by that column. The rescue-specific set is the **out-map** the upload step writes as it goes (`linear-media-rescue.mjs upload <manifest.json> <files-dir> <out-map.json>`): one entry per rescued file, each `{new_url, mime_type, byte_length, sha256}`, written after every successful upload so it survives an interrupted run. Enumerate from it — `select public_url, storage_path from public.description_images where public_url = any($1)` with the out-map's `new_url` values — and delete only those Storage objects. If the out-map is lost, do not fall back to a `deliverable_id` predicate: re-derive from the manifest's `key_sha256`/content hashes instead, or do not delete. **AND DELETE THE MATCHING OUT-MAP ENTRIES IN THE SAME BREATH, OR THE UNDO BOOBY-TRAPS THE NEXT ATTEMPT.** `cmdUpload` skips every key already present in the map (`linear-media-rescue.mjs:339`, `if (out[k]) { done += 1; continue; }`) and `cmdRewrite` resolves each occurrence through `map[mediaKey(url)]?.new_url` (`:404`). So an out-map left intact after the objects are gone makes a retry upload nothing and then generate forward SQL pointing every description and comment at deleted objects — worse than the state the undo was reversing. Remove the deleted keys from the map, or move the map aside and start from a fresh one; a retry must re-upload, not re-point. Timing, unchanged and still true: until the rewrite in the next step lands, nothing in the product points at these objects, so deleting the out-map's set then is clean. AFTER the rewrite lands, run `linear-media-rescue-rollback.sql` FIRST and delete the objects second, or a rewritten brief or comment is left pointing at a deleted file. `public.description_images` is service-role only (`revoke all … from anon, authenticated`), so run the select with the service key. **[RESTORED 2026-09-08 · sources: index.html:58005-58022; supabase/functions/description-image-upload/index.ts:250-271; scripts/linear-media-rescue.mjs:309-386 (skip at :339, write at :373-379) and :402-405 (`resolve`); migrations/2026-09-05-description-images.sql:36-64. Selector corrected and out-map invalidation added after two Codex P1s on #1352.]**
  - [migration] Apply the generated `linear-media-rescue-forward.sql` in the Supabase SQL Editor: one transaction of `update public.deliverables set brief = … where id = … and brief = <exact old literal>` plus the same shape against `public.production_comments`.
    undo: Run the matched `linear-media-rescue-rollback.sql`, generated in the same pass and guarded by the NEW literal, which restores every original string exactly. Both files are committed alongside the manifest. The forward file is all-or-nothing: any row whose stored text no longer matches its captured old literal simply does not update, a single guard at the foot of the transaction raises when ANY row failed to match, and the whole transaction rolls back naming the offending keys — so an editor, another lane or the inbound webhook changing a brief between census and apply makes the apply fail loudly and change nothing. That is the intended outcome, and the doc says so in as many words: "a failed rescue that leaves every brief intact is a good result." Two properties of the pair worth knowing before you rely on it: the rollback is guarded on the NEW literal, so it cannot fire twice and cannot clobber an edit made after the rescue; and `scripts/linear-media-rescue.mjs` verifies the two files are an exact inverse as it writes them, with `test/linear-media-rescue.js` proving that property on fixtures. Never widen either WHERE to `where id = …` alone. **[RESTORED 2026-09-08 · source: docs/ops/LINEAR_MEDIA_RESCUE.md lines 240-262]**
  - [storage] CONDITIONAL (E4 only): `update storage.buckets set file_size_limit = 26214400 where id = 'syncview-description-images';` **— AND IF TAKEN AT ALL, TAKE IT BEFORE THE UPLOAD STEP ABOVE, together with the `MAX_BYTES` edit and the redeploy below.** It is listed here because it is conditional, not because it comes late: an upload run against the 4 MiB bucket refuses every oversize file, and re-running the upload after a later raise is an extra pass rather than a repair. Item 173's ruling is that E4 is NOT taken and those files are simply not rescued; this step exists for the case where a census overturns that. **[RESTORED 2026-09-08 · source: docs/ops/OPEN_REPAIRS.md item 173 point 2; migrations/2026-09-05-description-images.sql:19-30. The ordering note was added after Codex round nine (P1) pointed out the published sequence puts E4 after the upload it has to precede.]**
    undo: `update storage.buckets set file_size_limit = 4194304 where id = 'syncview-description-images';` — objects already stored above the old limit stay readable; the limit only gates new writes. That property is not mine to assert and is not platform folklore here: it is stated in `docs/ops/OPEN_REPAIRS.md` item 173 point 2, in the same parenthetical that supplies this undo. This is a BUCKET setting, not the project-wide Storage ceiling: the two are separate controls, this statement touches only the one row in `storage.buckets`, and it neither raises nor lowers the project-level ceiling. **SCOPE OF E4, STATED SO THE FORWARD PATH IS NOT HALF-BUILT: E4 RAISES THE BYTE CEILING ONLY. Files over 8000px REMAIN OUT OF SCOPE and are not rescued by it.** `verifyImage` refuses on `MAX_DIMENSION = 8000` (`policy.mjs:20`, enforced at :381/:476/:521) independently of any byte limit, so a 25 MiB bucket admits nothing extra in that dimension. Item 173 says the same from the other side — it lists files "over 4 MiB **or over 8000px**" as not rescued, and notes `MAX_DIMENSION` "would have to move with it or large captures still refuse". **No forward value for `MAX_DIMENSION` is proposed here and none is invented: nobody has chosen one, and the census that would justify it has not been run.** If over-dimension files must be rescued, that is a separate change needing its own value, its own `test/description-image-upload.js` update and its own owner window. So the reversal is: the bucket row above, and `MAX_BYTES` (`policy.mjs:17`), plus the function redeploy in the step below. `test/description-image-upload.js` pins both of those (`policy.MAX_BYTES === 4*1024*1024` at :169, the migration's `file_size_limit` 4194304 at :170), so CI catches a half-reversal of the pair. It does NOT pin `MAX_DIMENSION`, which is why a future forward change to it needs a test added in the same commit rather than assumed. **[RESTORED 2026-09-08 · sources: docs/ops/OPEN_REPAIRS.md item 173 point 2; docs/ops/LINEAR_MEDIA_RESCUE.md:169 and §4; supabase/functions/description-image-upload/policy.mjs:17,20,381,476,521; test/description-image-upload.js:169-171; migrations/2026-09-05-description-images.sql:19-30. Scope of E4 stated explicitly after Codex round four (P2) noted the forward path changed only the byte limit.]**
  - [edge-function-deploy] CONDITIONAL (E4 only): redeploy `description-image-upload` after the `MAX_BYTES` change.
    undo: Auto-triggers on merge to main via `.github/workflows/deploy-description-image-upload.yml`. NOT an F27 Section 4 closure (the workflow's own header says so), so NO sealed four-function capture bundle and NO Drive upload are owed. Rollback is reverting the `MAX_BYTES` change in `supabase/functions/description-image-upload/policy.mjs` on main and letting the same workflow redeploy on that merge — there is no separate rollback dispatch and no prior-closure restore in this lane. The workflow fires on push to main for `supabase/functions/description-image-upload/**`, `_shared/staff-role-auth.ts`, `supabase/config.toml` or the workflow file itself, and also accepts `workflow_dispatch`; its `concurrency` group is `deploy-description-image-upload` with `cancel-in-progress: false`, so an older run cannot finish after and overwrite a newer deploy. Revert the bucket `file_size_limit` in the same window (see the step above) — code and bucket must not be left disagreeing. **[RESTORED 2026-09-08 · source: .github/workflows/deploy-description-image-upload.yml lines 1-28]**

RISKS
  - A card is edited between the E1 manifest snapshot and the E3 apply, so the stored brief no longer matches the captured literal.
    mitigate: That is exactly what the `and brief = $old$…$old$` clause is for: the row does not update, `not found` raises, and the whole transaction aborts. Re-run E1 for the failed rows only and re-generate. Never widen the WHERE to `where id = …` alone.
  - The rewrite bumps `deliverables.updated_at` (the `track_b_deliverable_touch_timestamps_before` trigger sets `new.updated_at := now()` unconditionally, migrations/2026-07-06-b1-linear-data-model.sql:219-237), so an editor with the description panel op
    mitigate: Run the apply outside working hours and announce it. The refusal is loud and preserves the draft ('Description changed elsewhere. Your draft is preserved…', index.html) — it loses nothing. Comments have NO such trigger, so their rewrite is invisible.
  - Every UPDATE on `deliverables` fires `track_b_deliverable_ledger_guard_after` (migrations/2026-07-06-b1-linear-data-model.sql:239-290), writing a `deliverable_events` row with `action='update'`, `source='system'`, `payload={"op":"UPDATE","reason":"rp
    mitigate: Accept it — it is an audit trail, not damage, and it is the trigger's designed behavior for a direct write. It does NOT enqueue `mirror_outbox`, so nothing is pushed to Linear. State the expected row count in the OPEN_REPAIRS entry so a later reader finds the number already explained instead of reading a burst of `source='system'` / `reason='rpc_bypass_guard'` events as an incident. The count is exactly one `deliverable_events` row per updated deliverable (`track_b_deliverable_ledger_guard_after`, migrations/2026-07-06-b1-linear-data-model.sql:239-290), so it is knowable before the run: write the number down from the manifest, then check the two agree afterwards. Comments produce no such rows — `production_comments` has no equivalent trigger — so the deliverables count is the whole of it. **[RESTORED 2026-09-08 · sources: docs/ops/LINEAR_MEDIA_RESCUE.md §3 "Expected side effects of the apply"; migrations/2026-07-06-b1-linear-data-model.sql:219-237 and :239-290]**
  - The rescued objects land in a PUBLIC bucket. A client-audience comment rewritten to a public URL moves that file from 'dead link the client cannot open' to 'working link the client can open', and anyone holding the URL can fetch it.
    mitigate: This is the one genuine widening and it needs a one-line owner ruling, not a silent choice. The estate already accepts exactly this property for every Drive and Frame.io link in the same fields, and the path is an unguessable UUID in a bucket that does not list its contents publicly — the migration says it outright: "the URL cannot be enumerated or guessed. A public bucket does not list its objects publicly; only a direct object GET is open." So the honest framing for the ruling is: the exposure is not "the bucket is browsable", it is "anyone who is given one of these URLs can fetch that one file, forever, without signing in" — the same bargain the fields already make for Drive and Frame.io. Put THAT sentence to the owner and record his answer in `docs/ops/OPEN_REPAIRS.md`; do not proceed on the reasoning above as if it were the decision. Attribution is retained either way: `public.description_images` records actor key and role per object. **[RESTORED 2026-09-08 · source: migrations/2026-09-05-description-images.sql lines 11-12, 35-59]**
  - A Linear-side comment edit between the rewrite and the webhook shutdown overwrites `production_comments.body` back to the Linear URL.
    mitigate: Sequence comments after the inbound webhook is off. If that is not possible, the detection is trivial and cheap: re-run the E1 comment count after the rewrite; any non-zero result is a clobber, and re-running the forward SQL for those rows fixes it (**for THOSE ROWS ONLY — re-running the whole forward file will abort**, because every row that was not clobbered no longer matches its old literal and the all-or-nothing guard at the foot raises on it). So the repair is: identify the clobbered ids from the re-run count, regenerate a forward file scoped to exactly those, and apply that. The mechanism being defended against, stated so it is recognisable: on a Linear comment `update` event that is neither an echo nor a tombstone, `body` survives into `production_comment_upsert` and overwrites the rewritten text back to the dead `uploads.linear.app` URL. **[RESTORED 2026-09-08 · source: docs/ops/LINEAR_MEDIA_RESCUE.md lines 240-262 and the comment-sequencing bullet in §3]**
  - `RATE_LIMIT_PER_HOUR = 120` per actor with a reserve-then-count design means a burst upload refuses ITSELF at the boundary (policy.mjs:24, index.ts:257-277).
    mitigate: Pace the script at one upload per 30 seconds. For a rescue set of ~150 files that is ~75 minutes, unattended. Do not raise the constant — that is a code change and a deploy for no benefit.
  - The lane assumes the owner's private capture actually holds the bytes. If it does not, the files must come out of Linear before 2026-09-15 and the lane becomes time-critical.
    mitigate: E1 cross-checks the manifest URL list against the capture receipt as its FIRST action, before any upload. Any gap is reported the same day, while Linear is still reachable.

TESTS
  test/description-image-upload.js — EXISTING on main. Asserts `policy.MAX_BYTES === 4*1024*1024` (line 169) AND that the migration's `file_size_limit` is 4194304 (line 170). Lane E only touches it under work item E4, and both numbers must move together.
  test/prod-description-image-paste.js — EXISTING on main. Line 189 pins the exact rendered-URL shape `https://x.supabase.co/storage/v1/object/public/syncview-description-images/abc.png`; it is the guard that a rescued URL is shape-identical to a pasted one. Lane E does not edit it; it must keep passing.
  qa/probes/p96_description_image_upload.js — EXISTING nightly probe against the deployed function (preflight, refusal order, 1x1 PNG round trip through the public URL, three byte refusals). It REQUIRES the `SYNCVIEW_STAFF_ACTOR` repo secret and is red until the owner adds it (docs/ops/DESCRIPTION_IMAGE_UPLOAD.md §0). Lane E should check whether it is currently green BEFORE the rescue run — a red p96 means the upload path is unproven.
  test/linear-media-rescue.js — NEW. Pure functions only (scanner offsets, splice fidelity, rollback inverse). Must run with no network so it passes in the sandbox and in CI.
  NOT USED: test/native-brief-media.js (338 lines), test/native-brief-media-sql.js, test/native-brief-media-browser.js, test/native-comment-media.js, test/native-comment-media-sql.js on the candidate. They prove the private-bucket/signed-URL projection lane E is deliberately not building; they also require Playwright/Chromium plus Pillow, PyMuPDF, defusedxml, PyAV and fontTools (see the CI paragraph in docs/ops/NATIVE_BRIEF_MEDIA.md). Lifting them would import the whole apparatus back.
  `npm test` is the full suite and takes several minutes. `npm run test:prod-polish` cannot pass in a sandbox with no route to the live backend — all 8 lanes fail identically on origin/main, so verify against main before calling anything a regression.


=== ADVERSARIAL REVIEW OF YOUR OWN BRIEF — READ THIS TWICE ===
A second agent tried to prove the brief above wrong. It found the following. Where the review disagrees with the brief, THE REVIEW WINS.

CLAIMS THAT ARE WRONG:
  ! done_when #3 + E6 rollback query: 'Every rescued object has a row in public.description_images carrying its deliverable_id and client_slug (the attribution headers x-syncview-image-issue / x-syncview-image-client are populated by the rescue script), so the res
    why: The ORDINARY browser paste path already sets both headers. /home/user/client-analytics index.html:57950-57963 (`_prodDescriptionImageHeaderValue`, then `headers['X-Syncview-Image-Client']` and `headers['X-Syncview-Image-Issue']` from `issue.authorityProject||issue.storedClientSlug||issue.project` and `issue.id`) is on 
    truth: The attribution headers are NOT a rescue marker. Enumerate the rescue set from a distinguishing column the function actually derives server-side — `actor_key`/`actor_name`/`actor_role` for the one operator identity plus a `created_at` window — and treat `scripts/linear-media-rescue.mjs`'s committed out-map (`{original_
  ! E4 is CONDITIONAL — 'Run only if E1 shows rescue-set files above 4 MiB' — and open_question 2's inference that '1154 rasters near 0.8 MB average … would make work item E4 unnecessary.'
    why: Two problems. (a) Arithmetic: the doc the brief itself cites says 2,463,560,336 bytes over 1141 content hashes (docs/ops/NATIVE_BRIEF_MEDIA.md:246-253 on 5bcc03bd). Even charging all 12 non-raster files the full 50 MiB in-cap ceiling (12 x 52,428,800 = 629,145,600) leaves 1,834,414,736 bytes over ~1129 raster hashes = 
    truth: Treat E4 as LIKELY REQUIRED, not conditional, and size the lane accordingly: it carries a hand-applied migration, a policy.mjs edit, a test/description-image-upload.js edit and a real Edge Function deploy plus owner approval. Also, 25 MiB does not cover 'existing raster bytes up to 50 MiB' — the number needs to come fr
  ! Goal: '… with zero new buckets, zero new tables, zero Edge Function code changes, and zero Section 4 deploys.'
    why: Internally inconsistent with the lane's own work item E4, which changes supabase/functions/description-image-upload/policy.mjs:17 (MAX_BYTES) and triggers .github/workflows/deploy-description-image-upload.yml (its `paths:` filter includes `supabase/functions/description-image-upload/**`, verified on origin/main). Given
    truth: Rewrite the goal as 'zero new buckets, zero new tables, zero index.html change, and zero F27 Section 4 deploys' — the Section 4 exemption IS real (the workflow header on origin/main says 'a brand-new function outside the F27 Section 4 closure set, so no sealed capture is owed'), but 'zero Edge Function code changes' is
  ! risks §4: '`_prodDescriptionHTML(...,rich)` has exactly two call sites, both inside `_prodDescriptionPanelHTML`.'
    why: There are THREE call sites on origin/main: index.html:58258 (inside `_prodDescriptionPanelHTML`, which begins at :58195, rich=true), :62097 (inside `_prodProjectDetail`, begins :62072, rich=FALSE) and :62108 (inside `_prodBatchDetail`, begins :62101, rich=FALSE). The already_built section of the same brief correctly sa
    truth: One rich (images-on) call site at :58258; two non-rich call sites at :62097 and :62108 in project/batch detail. The public-bucket safety conclusion survives (both extra sites pass rich=false, so images never render there, and the client share link is confined to `['analytics','brief']` — verified at index.html:10073 an
  ! depends_on §1 and already_built §7: 'persistProductionComment runs at linear-inbound/index.ts:1245 BEFORE the detect-only gate at :1247, and its writable field list includes `body` (:1168, :1179).'
    why: The ordering and line numbers are right (persist at :1245, `isDetectOnlyTeam` gate at :1247, both verified). But :1167-1172 and :1178-1182 are `for (const field of [...]) delete normalized[field]` blocks — they REMOVE `body` from the payload in the echo and lifecycle-only cases. They are protections, not a writable fie
    truth: Conclusion holds but by different evidence: on a Linear comment `update` event that is neither an echo nor a tombstone, `body` survives into `normalized` and reaches `production_comment_upsert`, whose UPDATE branch sets `body` (migrations/2026-07-12-production-comments.sql:~604 region, guarded by `v_input ? 'body'`). C
  ! corrections_to_context: 'The highest existing item is `## 162.`, so lane E claims `## 163.`' — stated about docs/ops/OPEN_REPAIRS.md on origin/main.
    why: `git show origin/main:docs/ops/OPEN_REPAIRS.md | grep -o '^## [0-9]*\.'` tops out at **161**. `## 162.` exists only on the current working branch HEAD (8483498 'Ledger 162'), which has not merged. origin/main is d2495eb.
    truth: origin/main's highest is `## 161.`; `## 162.` is unmerged on claude/linear-removal-audit-s6iwvy. Lane E should claim its number against whatever main's tip is at merge time and re-run the duplicate check — which matters more than usual here because the brief's own duplicate finding (`## 13.`, `## 14.`, `## 22.`, `## 23
  ! E2 + risks §6: 'PACE AT ONE UPLOAD PER 30 SECONDS: RATE_LIMIT_PER_HOUR = 120 per actor (policy.mjs:24)… For a rescue set of ~150 files that is ~75 minutes.'
    why: Off by one, and it self-refuses. In supabase/functions/description-image-upload/index.ts:183 the window is `since = now - 3600000` and both counts use `.gte('created_at', since)`; the refusal at :205 is `(actorCount.count||0) > RATE_LIMIT_PER_HOUR`, and the count INCLUDES the row just reserved. At exactly 30s spacing t
    truth: Pace at >= 35 seconds with jitter, or have the script read back its own 429 and back off. Separately, '~150 files' is asserted with no basis — the captured corpus is 1141 distinct brief content hashes plus 75 comment URLs; at a safe pace the upload run is hours, not 75 minutes, and E1 must produce the real count before
  ! done_when #5: 'Opening one rescued card in SyncView Production shows the image inline in the read view AND round-trips byte-for-byte through the visual editor.'
    why: Only true for the `![alt](…)` forms. The read renderer draws an `<img>` only from `!\[…\]\(&lt;https…&gt;\)` and `!\[…\]\(https…\)` (index.html:54988-54989 inside `_prodLinkifyInline`, defined :54924); a BARE URL falls to the generic linkifier at :54993-54996 and becomes an anchor. E3 itself says 'a bare URL stays a ba
    truth: State honestly that the URL-for-URL splice restores a WORKING LINK for bare occurrences and comments, and an INLINE IMAGE only where the source already used `![alt](…)`. The candidate solved this by synthesising a `render_brief` (supabase/functions/_shared/native-brief-media.mjs `projectBriefMedia`, consumed by `_prodB
  ! already_built §4: `briefMediaOccurrences` 'does what the name says' and E5 will assert hand-computed offsets for 'a URL immediately followed by `)` and by `.`'.
    why: The bare-form branch is `(https?:\/\/uploads\.linear\.app\/[^\s<>"'\])]+)` — it excludes `)` and `]` but NOT `.`, `,`, `!`, `?`, `;` or a trailing `*`. A URL ending a sentence captures the period into `url`, so the offset/length pair spans one character too many and the captured-file lookup key is wrong. index.html car
    truth: Either lift `trimLinkTail`'s tail rule alongside the scanner so the rescue's notion of a URL matches the renderer's, or make E5's `.`-suffix case assert the trailing-period behaviour explicitly and reconcile it against the capture manifest. Confirmed verbatim otherwise: `git show 5bcc03bd…:supabase/functions/_shared/na
  ! Cited line spans in already_built §2 and §3.
    why: Drift, all verified against origin/main: `authorize` is index.ts:120-148 (not 106-148); the success return is :292-299 (not :293-300, the file is 300 lines); `attributionHeader` is :115-118 (not :112-116; :112-114 is its comment); `MAX_DIMENSION` is policy.mjs:20 (not :19); `imageTag` starts at index.html:54983 (not 54
    truth: Substance is right in every case — the handler, the raw-bytes body, the `{ok:true,url:publicUrl,…}` return, the `x-syncview-image-client`/`x-syncview-image-issue` reads at :269-270, and the reserve-before-object ordering (:257-277, upload at :279) are all real. Only the citations need fixing before a session navigates 
  ! corrections_to_context, final item: 'mirror_outbox is only ever populated by mirror_outbox_enqueue from the RPC write path (migrations/2026-07-23-f201-production-labels.sql:30 and the F203 file).'
    why: That line is `create or replace function public.mirror_outbox_enqueue(` — a definition, not a call site, so it does not evidence the claim.
    truth: The conclusion is CONFIRMED by better evidence: `public.track_b_deliverable_ledger_guard()` (migrations/2026-07-06-b1-linear-data-model.sql:239-285) inserts one `deliverable_events` row with `'system'` / `jsonb_build_object('op', tg_op, 'reason', 'rpc_bypass_guard')` and `return null` — no enqueue anywhere in it. Every

WORK THE BRIEF MISSED:
  + Four other free-text columns render in Production and are outside the predicate
    why: `batches.description` and `batches.comments`, `clients.board_desc`, and `deliverables.comments` all exist on origin/main (migrations/2026-07-06-b1-linear-data-model.sql:11 and :17 for batches, :47 for deliverables.comments; migrations/2026-07-05-b0-linear-auth-scaffold.sql:51 for clients.board_desc). Batch and project 
    files: /home/user/client-analytics/migrations/2026-07-06-b1-linear-data-model.sql, /home/user/client-analytics/migrations/2026-07-05-b0-linear-auth-scaffold.sql, /home/user/client-analytics/index.html
  + `production_comments.attachments` jsonb is never scanned
    why: `attachments jsonb not null default '[]'::jsonb` (migrations/2026-07-12-production-comments.sql:53-54) is written by the Linear mirror and is where a Linear comment's file metadata lands. Lane E's comment predicate is `pc.body like '%uploads.linear.app%'` only. A comment whose file lives in `attachments` rather than in
    files: /home/user/client-analytics/migrations/2026-07-12-production-comments.sql
  + Two live preconditions for the E2 upload run are not in live_actions_needed
    why: The Edge Function checks `description_image_upload_enabled` BEFORE it authenticates anyone (index.ts:221, via `uploadEnabled` at :150-160, fails closed on a missing/malformed row) — if the owner has ever flipped the kill switch, the whole rescue run 503s with `upload_disabled` and the script must not be started. Separa
    files: /home/user/client-analytics/supabase/functions/description-image-upload/index.ts
  + E4 raises MAX_BYTES but leaves MAX_DIMENSION, so large captures still refuse
    why: policy.mjs:20 sets `MAX_DIMENSION = 8000` and index.ts's verdict refuses on it independently of bytes (test/description-image-upload.js:175-176 pins that behaviour: 'a header claiming more pixels than the dimension ceiling is refused'). E4 explicitly leaves it unchanged as a mitigation, but the rescue corpus is uncontr
    files: /home/user/client-analytics/supabase/functions/description-image-upload/policy.mjs, /home/user/client-analytics/test/description-image-upload.js
  + No decision on bare-URL occurrences, which the candidate solved and lane E drops
    why: See wrong_claims #8. If the editor-facing point of the lane is 'the reference screenshot is visible in the brief', a bare-URL occurrence rescued URL-for-URL does not achieve it, and lane E has explicitly ruled out the index.html change that would. The owner needs a one-liner: accept a working link for bare occurrences,
    files: /home/user/client-analytics/index.html

OPEN QUESTIONS — answer from the code if you can; escalate to the coordinator only if a wrong guess is expensive
  ? THE ONE THAT SIZES THE LANE: do `uploads.linear.app` images render TODAY in SyncView, or are they already broken? `docs/ops/DESCRIPTION_IMAGE_UPLOAD.md:112-114` says they need Linear's own auth and render broken. I could not test this — no route to the live ba
  ? How many rescue-set files exceed 4 MiB? I cannot query live and the per-file sizes are not in git. Across the FULL historical corpus: 1141 distinct content hashes totalling 2,463,560,336 bytes (avg 2.16 MB) and only 12 of 1166 files are non-raster (docs/ops/NA
  ? Is `client_approval` in the active set? An editor is not working a card in client review, but it can bounce straight to `tweak`, and the brief's reference images are what the tweak is judged against. I included it. If the owner wants the set smaller, this and 
  ? Are `paused` clients in scope? I excluded `board_status in ('completed','canceled')` but KEPT `paused`, because a paused client resumes and its cards are not abandoned. Owner one-liner.
  ? Client-audience comment files in a public bucket — ruling needed (see risks). Default if no answer: rescue internal-audience only.
  ? Do any of the 2 OpenType fonts in the comment capture sit on an active card? `font/otf` is not in the existing bucket's allowlist and adding it means widening `ALLOWED_TYPES` in policy.mjs, which is a real code change for at most two files. Recommendation: put


IF THIS LANE IS NOT FINISHED BY 2026-09-15, THIS BREAKS:
On 2026-09-15 every `uploads.linear.app` reference in a live card's brief or comment becomes permanently unresolvable. The editor working that card sees the alt text with a broken-image icon where the reference screenshot was (for `![alt](url)` in a brief) or a blue link that 404s in a new tab (for a bare URL, and for every comment attachment, because comments are images-off by construction). The description TEXT is never lost and no error banner appears — the failure is silent and per-image, which is the worst version: an editor reads a brief that says 'match the reference below', sees nothing, and either guesses or has to interrupt the owner. The bytes themselves survive only inside the owner's private capture directory with no path back into the product; nobody but him can reach them, and there is no in-app way to ask for one.

The honest caveat that changes the urgency: `docs/ops/DESCRIPTION_IMAGE_UPLOAD.md:112-114` states these are Linear-signed URLs needing Linear's own auth and that they ALREADY render broken in SyncView today. If that is right, lane E is not preventing a regression on the SyncView surface — it is closing a hole that is already open, and the thing Sept 15 actually kills is the editor's fallback of opening the Linear card itself. Verify this in one click before sizing the lane (see open_questions).


START BY: reading docs/independence/LINEAR_EXIT_LANES.md on origin/main (the lane map and the index.html region ownership table), then OPEN_REPAIRS items 162-168. Then confirm for yourself that the 'already built' artifacts above really exist before you plan anything around them.
