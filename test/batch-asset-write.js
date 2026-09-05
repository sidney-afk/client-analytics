'use strict';
/*
 * Raw footage and the frame folder become editable — and the filming plan does
 * not.
 *
 * OWNER, 2026-08-30: "anyone should be able to change the link of the raw
 * footage, or the frame folder, or the deliverable file, just not the filming
 * plan for a video sub-issue... on the parent issue we should see the filming
 * plan assets which is the only one that is not editable because it is from the
 * supabase database and no one should be able to touch that."
 *
 * Two rules, and the second is the one that needs guarding, because it is a
 * rule about something NOT existing. A slot becomes writable by acquiring a
 * `write` operation in PROD_ASSET_SPECS, a branch in staffOperationAllowed and
 * a column in the database whitelist. The filming plan must acquire none of
 * them, and the failure mode is somebody adding one in good faith years from
 * now. So this suite asserts its absence at all three layers by name.
 *
 * The first rule needs guarding differently: "anyone" means the team match that
 * confines a creative to their own team must NOT apply here, while continuing
 * to apply to everything else. A batch is one shoot with one set of files,
 * worked by the editor who cuts it and the designer who pulls a frame from it,
 * and it carries a single `team` value — so matching on it would hand the
 * shared folder to whichever team happened to be recorded and lock the other
 * one out of a link it uses daily.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const GATEWAY = fs.readFileSync(
  path.join(ROOT, 'supabase', 'functions', 'production-write', 'index.ts'), 'utf8');
const MIGRATION = fs.readFileSync(
  path.join(ROOT, 'migrations', '2026-08-31-batch-asset-write.sql'), 'utf8');
const UI = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

function grabFunc(source, name) {
  const at = source.indexOf('function ' + name + '(');
  if (at < 0) throw new Error('function not found: ' + name);
  let depth = 0, quote = '', escaped = false, comment = '';
  for (let j = source.indexOf('{', at); j < source.length; j++) {
    const c = source[j], next = source[j + 1];
    if (comment) {
      if (comment === 'line' && c === '\n') comment = '';
      else if (comment === 'block' && c === '*' && next === '/') { comment = ''; j++; }
      continue;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === quote) quote = '';
      continue;
    }
    if (c === '/' && next === '/') { comment = 'line'; j++; continue; }
    if (c === '/' && next === '*') { comment = 'block'; j++; continue; }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return source.slice(at, j + 1); }
  }
  throw new Error('unclosed ' + name);
}

(async () => {
  const policy = await import(
    '../supabase/functions/production-write/policy.mjs');

  /* ---- 1. THE FILMING PLAN IS NOT WRITABLE, at every layer ---------------- */

  ok(policy.batchAssetColumn('filming_plan') === '',
    'policy names no column for filming_plan, so the gateway cannot write it');
  ok(!Object.prototype.hasOwnProperty.call(policy.BATCH_ASSET_SLOTS, 'filming_plan'),
    'and the slot table does not carry it even as a disabled entry');
  ok(!/filming_doc_url/.test(MIGRATION.slice(MIGRATION.indexOf('v_column := case'))),
    'the database whitelist does not mention filming_doc_url anywhere in its body');
  ok(/when 'raw_footage' then 'footage_folder_url'/.test(MIGRATION)
    && /when 'delivery_folder' then 'delivery_folder_url'/.test(MIGRATION)
    && /raise exception 'production batch asset slot unsupported'/.test(MIGRATION),
    'it accepts exactly the two folder slots and raises on anything else');
  const specs = UI.slice(UI.indexOf('const PROD_ASSET_SPECS = Object.freeze(['));
  const specBlock = specs.slice(0, specs.indexOf(']);') + 3);
  ok(/\{ key: 'filming_plan', label: 'Filming plan' \}/.test(specBlock),
    'the browser spec for filming_plan carries no write operation, so no control renders for it');
  ok(/key: 'raw_footage'[^}]*write: 'batch_asset'/.test(specBlock)
    && /key: 'delivery_folder'[^}]*write: 'batch_asset'/.test(specBlock)
    && /key: 'deliverable_file'[^}]*write: 'attachment'/.test(specBlock),
    'and the three writable slots each name the operation that actually carries them');

  /* ---- 2. "ANYONE" MEANS ANY STAFF, and not a client --------------------- */

  const S = policy.staffOperationAllowed;
  ok(S('admin', 'batch_asset', '', 'video') && S('smm', 'batch_asset', '', 'graphics'),
    'admin and SMM may edit a batch folder on either team');
  ok(S('creative', 'batch_asset', 'graphics', 'video'),
    'a DESIGNER may edit the folders of a video batch -- the frame folder is where their source frames live');
  ok(S('creative', 'batch_asset', 'video', 'graphics'),
    'and an EDITOR may edit them on a graphics batch, for the same reason in reverse');
  ok(!S('creative', 'batch_asset', '', 'video'),
    'a creative with no team of their own is still refused: the role is unresolved, not universal');
  ok(!S('viewer', 'batch_asset', 'video', 'video') && !S('', 'batch_asset', 'video', 'video'),
    'and an unrecognised role is refused, as it is for every other operation');

  /* SUPERSEDED 2026-09-01 by a second owner ruling, and kept here rewritten
     rather than deleted so the boundary stays asserted where it moved to.

     This originally read "the team match still confines a creative on every
     OTHER operation", with `attachment` named among them: a designer could not
     attach a canonical file to a video deliverable. That confinement is gone by
     the owner's instruction of 2026-09-01 -- "I want anyone, graphic, video,
     social media manager, or admin to be able to edit assets ... on any parent
     issue or sub-issue" -- issued after his only graphics designer could read
     neither the description nor the assets of a video-team post parent, which
     is where the brief for her own work lives.

     So `attachment` now sits ABOVE the team match beside `batch_asset`. What
     must NOT have moved with it is everything the ruling did not name, and that
     is what this now asserts. `status` additionally stays assignee-bound. */
  ok(S('creative', 'attachment', 'graphics', 'video')
    && S('creative', 'attachment', 'video', 'graphics'),
    'a creative may now edit a deliverable asset on EITHER team -- the 2026-09-01 ruling, the same shape as batch_asset');
  ok(!S('creative', 'attachment', '', 'video'),
    'but a creative with no team of their own is still refused, exactly as batch_asset refuses them');
  ok(!S('creative', 'status', 'graphics', 'video')
    && !S('creative', 'due', 'graphics', 'video')
    && !S('creative', 'comment', 'graphics', 'video'),
    'and the team match still confines every operation the ruling did NOT name -- status, due and comment did not move');
  ok(!S('creative', 'description', 'graphics', 'graphics')
    && !S('creative', 'batch_description', 'graphics', 'graphics'),
    'descriptions stay admin/SMM on both the deliverable and the post -- widening ASSET access says nothing about who may rewrite the brief');
  ok(S('creative', 'attachment', 'video', 'video'),
    'and a creative attaching on their own team is unchanged');

  /* ---- 3. The gateway refuses a client outright -------------------------- */

  const handler = grabFunc(GATEWAY, 'handleBatchAssetWrite');
  ok(/if \(principal\.kind === "client"\) throw new GatewayError\(403, "operation_forbidden"\)/.test(handler),
    'a client principal is refused before anything is read');
  ok(handler.indexOf('authenticate(') < handler.indexOf('.from("batches")'),
    'the declared scope is authenticated BEFORE the id is resolved, so this cannot enumerate batch ids');
  ok(/\.eq\("client_slug", requestedClientSlug\)/.test(handler),
    'and the lookup is scoped to the declared client, so a cross-client id is a miss, not a leak');
  ok(/if \(!data\) throw new GatewayError\(403, "operation_forbidden"\)/.test(handler),
    'a missing batch and a forbidden batch are the same answer');

  /* ---- 4. Shape is checked; reachability is reported, not enforced ------- */

  ok(/assetUrlType\(url\) === "invalid" \|\| !assetTypeAllowed\(slot, url\)/.test(handler),
    'a URL must be a supported HTTPS host of the right kind for the slot');
  ok(!/artifact_not_resolvable/.test(handler),
    'but a live probe does NOT gate the write: a frame folder created a minute ago is not shared yet, '
    + 'and refusing it would rebuild the dead end this change removes');
  ok(/if \(url && \(assetUrlType/.test(handler),
    'and an EMPTY value is allowed through, because clearing a wrong folder link has to be possible');

  /* ---- 5. Concurrency is against the BATCH clock ------------------------- */

  ok(/body\.expected_updated_at !== undefined[\s\S]{0,120}clean\(existing\.updated_at\)/.test(handler),
    'the CAS compares the batch updated_at, not a deliverable one');
  const write = grabFunc(UI, '_prodGatewayWrite');
  ok(/payload\.entity = 'batch';/.test(write)
    && /payload\.id = String\(issue\.batchId \|\| ''\);/.test(write)
    && /_prodBatch\(payload\.id\)/.test(write),
    'and the browser sends the batch id and the batch clock, never the deliverable ones');

  /* THE TARGET IS PER SLOT (2026-09-05). A post's slots can sit on different
     batch rows -- on the post the owner reported, the raw footage is on the
     native batch and the frame folder on the mirror -- so a panel-wide target
     would aim the Frame folder editor at a row whose column is empty. Clearing
     the link on screen would then write a blank over a blank and the value
     would simply reappear; replacing it would leave a stale duplicate that
     resurfaces the moment the new one is cleared. Raised by review on #1287. */
  ok(/const writeSlot = String\(fields && fields\.slot \|\| ''\);/.test(write)
    && /assetState\.assets\[writeSlot\]/.test(write),
    'a batch-asset write reads the target for the SLOT being saved, not one target for the whole panel');
  ok(/if \(target\) \{\s*\n\s*payload\.id = target;\s*\n\s*batchClock = String\(evidence\.writeBatchUpdatedAt \|\| ''\)\.trim\(\);/.test(write),
    'and takes the CAS clock from the same slot, since comparing one row\'s updated_at against another row\'s fails its CAS forever');
  ok(/payload\.expected_updated_at = batchClock\s*\n\s*\|\| \(batch \? String\(batch\.updated_at \|\| ''\) : ''\);/.test(write),
    'with no target -- an older gateway, an unread panel, or a gateway with nothing safe to offer -- it writes the row it is already on, exactly what shipped before');

  /* A deliverable-shaped CAS against a batch row can never match, so it would
     refuse the write forever rather than occasionally. */
  ok(!/payload\.expected_updated_at = issue\.updatedRaw;[\s\S]{0,80}batch_asset/.test(write),
    'the deliverable CAS branch does not also run for a batch write');

  /* ---- 6. One row, many panels ------------------------------------------ */

  /* The invalidation follows the POST, not the batch id (2026-09-05). Matching
     on batchId dropped exactly the set that does not need it on a split post --
     rows sharing the written row's batch -- while the parent on another batch
     row kept painting its stale cached read after a sub-issue write, and every
     sub-issue kept painting theirs after a write from the parent. A sibling on
     the shared row is still covered, because it is also a row of this post. */
  const invalidate = grabFunc(UI, '_prodInvalidateBatchAssetReads');
  ok(/const rows = _prodPostRows\(issue\);/.test(invalidate),
    'after a batch write, the cached reads of every row of the POST are marked stale -- the parent and every sub-issue, whatever batch row each of them names');
  ok(!/_prodState\.assets\.delete\(/.test(invalidate)
    && /state\.assets\[writtenSlot\] = Object\.assign\(\{\}, state\.assets\[writtenSlot\], \{[\s\S]{0,80}url: writtenUrl,[\s\S]{0,40}state: 'checking'/.test(invalidate),
    'stale, not gone (2026-09-05): the written value is put into each cached slot as `checking` and the state goes idle, so the next open shows the new link at once instead of a skeleton and re-reads underneath');
  ok(/String\(row\.id\) === keep\) return;/.test(invalidate),
    'except the row that was just written, whose caller re-reads it immediately');
  ok(/if \(!state \|\| state\.editing \|\| state\.saving\) return;/.test(invalidate),
    'and except any row someone is mid-edit on, whose draft must not be thrown away');

  const postRows = grabFunc(UI, '_prodPostRows');
  ok(/_prodChildrenOf\(root\.id\)/.test(postRows)
    && /issue\.parent \? _prodIssue\(issue\.parent\) : issue/.test(postRows),
    'and the post is the row\'s parent (or itself) plus that row\'s children, so a write from either end reaches the other');
  ok(/String\(row\.batchId \|\| ''\) === batchId/.test(postRows),
    "with every sibling on the same batch row still included, since one batch row can carry work the projection does not draw under this post");

  const save = grabFunc(UI, '_prodSaveAsset');
  ok(/operation === 'batch_asset' \? \{ slot, url: value \} : \{ file_url: value \}/.test(save),
    'the save sends the slot and url for a batch asset, and file_url for the canonical deliverable');
  ok(/if \(!value && operation !== 'batch_asset'\)/.test(save),
    'an empty value is refused for the canonical deliverable and allowed for a batch folder');
  ok(/_prodInvalidateBatchAssetReads\(issue, id, slot, value\)/.test(save),
    'and a successful batch write invalidates the rest of the post -- carrying the slot and value it just wrote -- before re-reading this row');

  console.log(failures === 0
    ? '\nBatch asset write checks passed'
    : '\n' + failures + ' batch asset write check(s) failed');
  process.exit(failures === 0 ? 0 : 1);
})();
