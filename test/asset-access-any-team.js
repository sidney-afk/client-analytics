'use strict';
/*
 * A designer can read and edit the assets of a post her work hangs off.
 *
 * OWNER REPORT, 2026-09-01. His only graphics designer opened VID-13513 -- the
 * PARENT post of a batch she has thumbnail work in -- and got "Description
 * could not load" over four Unavailable asset rows, plus "This staff account
 * cannot read assets for this issue." He opened the same screen and saw
 * everything. His ruling: "I want anyone, graphic, video, social media manager,
 * or admin to be able to edit assets, except for the filming plan ... on any
 * parent issue or sub-issue or whatever."
 *
 * WHY IT WAS STRUCTURAL RATHER THAN HER ACCOUNT. `staffAssetReadAllowed` let a
 * `creative` read only their OWN team, and he is `admin`, which the same
 * function exempts. A post's parent row is a VIDEO deliverable on 105 of the
 * batches that carry graphics work, and the brief a designer actually needs --
 * the filming plan link, the general drive, the client's photos -- lives in
 * that parent's DESCRIPTION, which is guarded by the same gate. So the one
 * active designer on the roster could not read the brief for her own work on
 * any video-parented post, and had been unable to since 2026-07-24.
 *
 * WHAT THE TEAM MATCH WAS NOT PROTECTING. The caller is authenticated against a
 * declared client scope and the row lookup is pinned to that client, so a
 * cross-CLIENT read was never reachable here. The match only separated two
 * people working the same post.
 *
 * THE FILMING PLAN IS THE NAMED EXCEPTION, and it needs no new rule -- it is
 * refused in three independent places, none of which this change touches. This
 * file asserts all three, because "we did not widen it" is the kind of claim
 * that is true when written and false a release later.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const INDEX = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const POLICY_SRC = fs.readFileSync(path.join(ROOT, 'supabase/functions/production-write/policy.mjs'), 'utf8');
const GATEWAY_SRC = fs.readFileSync(path.join(ROOT, 'supabase/functions/production-write/index.ts'), 'utf8');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

(async () => {
  const policy = await import(path.join(ROOT, 'supabase/functions/production-write/policy.mjs'));
  const R = policy.staffAssetReadAllowed;
  const S = policy.staffOperationAllowed;

  /* ---- 1. THE REPORTED FAILURE, as the shipped function decides it -------- */

  ok(R('creative', 'graphics', 'video'),
    'THE REPORT: a graphics designer may READ the assets of a VIDEO row -- the post parent her thumbnail work hangs off');
  ok(R('creative', 'video', 'graphics'),
    'and an editor may read a graphics row, the same rule in reverse rather than a graphics-only exception');
  ok(R('admin', null, 'video') && R('smm', null, 'graphics'),
    'admin and SMM are unchanged -- they always could, which is why the owner saw a screen his designer did not');
  ok(R('creative', null, 'video') && R('creative', '', 'video'),
    'a creative with no roster team still reads: the gate is about the ROLE, and the client scope is enforced before it');

  /* The description read shares this exact gate, which is why one bug produced
     two symptoms on her screen. If they ever diverge, the brief goes dark again
     while the asset grid looks fine. */
  ok(/description_scope_forbidden/.test(GATEWAY_SRC)
    && (GATEWAY_SRC.match(/staffAssetReadAllowed/g) || []).length >= 3,
    'the DESCRIPTION read is guarded by the same function as the asset read, so unblocking one unblocks the other');

  /* ---- 2. Only the named role may read at all ---------------------------- */

  ok(!R('viewer', 'graphics', 'graphics') && !R('', 'graphics', 'graphics') && !R(null, null, null),
    'an unrecognised role is still refused -- this widened WHICH TEAM a staff member may read, not who counts as staff');
  ok(/principal\.kind === "client"/.test(GATEWAY_SRC),
    'and a client principal is refused by the handler before this function is consulted');

  /* ---- 3. Editing assets, on either team --------------------------------- */

  ok(S('creative', 'attachment', 'graphics', 'video') && S('creative', 'attachment', 'video', 'graphics'),
    'a creative may EDIT a deliverable asset on either team, which is the second half of the ruling');
  ok(S('creative', 'batch_asset', 'graphics', 'video'),
    'the post-level folders were already cross-team from the 2026-08-30 ruling and stay that way');
  ok(!S('creative', 'attachment', '', 'video'),
    'a creative with no team is refused the WRITE even though they may read -- an unresolved role does not get to change files');
  ok(S('admin', 'attachment', '', 'video') && S('smm', 'attachment', '', 'graphics'),
    'admin and SMM edit assets on either team, completing the four roles the owner named');

  /* ---- 4. THE NAMED EXCEPTION: the filming plan ------------------------- */

  ok(!/filming_plan/.test(String(policy.BATCH_ASSET_SLOTS && Object.keys(policy.BATCH_ASSET_SLOTS).join(','))),
    'THE EXCEPTION: filming_plan is absent from BATCH_ASSET_SLOTS, so the batch asset writer has no column to write');
  ok(policy.batchAssetColumn('filming_plan') === '',
    'and batchAssetColumn resolves it to nothing, so a hand-crafted request naming the slot writes no column');
  const specs = INDEX.slice(INDEX.indexOf('const PROD_ASSET_SPECS'), INDEX.indexOf('function _prodAssetSpec'));
  ok(/key: 'filming_plan', label: 'Filming plan' \}/.test(specs),
    'and the browser spec gives it NO write operation, so no Edit control is ever rendered beside it');
  ok(/key: 'deliverable_file'[^}]*write: 'attachment'/.test(specs)
    && /key: 'raw_footage'[^}]*write: 'batch_asset'/.test(specs),
    'while the slots that ARE editable each name the operation carrying them -- the exception is a gap, not a special case');

  /* ---- 5. The widening stops where the ruling stopped -------------------- */
  /* The ruling named assets. Everything it did not name must still be confined,
     or this becomes a general permission change nobody asked for. */

  ok(!S('creative', 'status', 'graphics', 'video')
    && !S('creative', 'due', 'graphics', 'video')
    && !S('creative', 'comment', 'graphics', 'video'),
    'status, due and comment keep the team match -- the ruling was about assets and did not touch them');
  ok(!S('creative', 'description', 'graphics', 'graphics')
    && !S('creative', 'batch_description', 'graphics', 'graphics'),
    'and descriptions stay admin/SMM on both the deliverable and the post: reading the brief is not rewriting it');

  /* ---- 6. The browser must decide `attachment` where the gateway does ---- */
  /* A mismatch here is the failure #1203 shipped and review caught: the browser
     hiding a control the gateway would accept, or offering one it will refuse. */

  const gate = INDEX.slice(INDEX.indexOf('function _prodRoleCanWrite'), INDEX.indexOf('function _prodRoleGateText'));
  const iBatchAsset = gate.indexOf("operation === 'batch_asset'");
  const iAttachment = gate.indexOf("operation === 'attachment'");
  const iTeamMatch = gate.indexOf("memberTeam !== _prodWriteTeam(issue.team)");
  ok(iBatchAsset > -1 && iAttachment > -1 && iTeamMatch > -1,
    'the browser gate decides batch_asset, attachment and the team match');
  ok(iAttachment < iTeamMatch,
    'and it decides `attachment` BEFORE the team match, mirroring the gateway -- below it, a designer would see no Edit control the gateway would have honoured');
  ok(!/\/\/ A creative attaches on their OWN team/.test(INDEX),
    'the superseded own-team comment is gone rather than left contradicting the line under it');

  console.log(failures === 0
    ? '\nasset access any-team checks passed'
    : '\n' + failures + ' asset access check(s) failed');
  process.exit(failures === 0 ? 0 : 1);
})();
