'use strict';
/*
 * TikTok Upload — Photo carousel transport (harness for the change that added it).
 *
 * Run:  node test/tiktok-carousel-transport.js   (exit 0 = all good)
 *
 * Two things this guards, statically (no live backend, no browser):
 *
 * 1. Frontend (index.html): the carousel submit path snapshots client/profile/
 *    title/options/timezone into a `target` object BEFORE the async mint+PUT
 *    loop, and _tkFinish*Submit read that snapshot rather than live tkState.
 *    Without this, editing the client/caption/options while a multi-image (or
 *    large-video) upload is in flight hands the already-uploading media to
 *    the WRONG Post For Me account — the client select and caption field are
 *    not disabled while `tkState.submitting` is true. Found by Codex review
 *    on PR #1355 against _tkFinishPhotoSubmit; _tkFinishDirectSubmit (the
 *    pre-existing >100MB video path) had the identical bug, discovered while
 *    fixing the carousel one, and is guarded here too.
 * 2. n8n (`tiktok-upload-direct`, workflow id qGJ7mUjml98DSiGo): reads the
 *    Code node source straight out of the committed, dated backup in
 *    n8n-backups/ (the point-in-time record ROLLBACK.md rule 2 requires) and
 *    executes it, proving an old-style single-mediaUrl payload still builds
 *    the exact single-item Post For Me media[] array it always has, and a new
 *    mediaUrls-array payload builds a correct multi-item array. This is a
 *    regression guard on the LAST BACKED-UP graph, not the live one — if n8n
 *    is edited again without updating both the backup and this test, this
 *    suite will not see the new live behavior. It is not a substitute for
 *    re-running test_workflow against the live graph after any further edit.
 *
 * Neither check above ever runs the browser transport itself — both extract
 * and exercise source, but never call _tkSubmitPhotoCarousel against a real
 * page. docs/syncview-design/tests/tiktok-carousel-browser-journey.js is the
 * sibling suite that does: a real headless browser against a fully mocked
 * network, proving mint/PUT ordering, the emitted FormData, cancellation and
 * a storage-failure path. Run it directly:
 * node docs/syncview-design/tests/tiktok-carousel-browser-journey.js
 */
const fs = require('fs');
const path = require('path');
const INDEX = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');

function grabFunc(name) {
  const at = INDEX.indexOf('function ' + name + '(');
  if (at < 0) throw new Error('function not found: ' + name);
  let depth = 0;
  for (let j = INDEX.indexOf('{', at); j < INDEX.length; j++) {
    const c = INDEX[j];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return INDEX.slice(at, j + 1); }
  }
  throw new Error('unbalanced braces: ' + name);
}

let failures = 0;
function check(label, got, want) {
  const ok = got === want; if (!ok) failures++;
  console.log(`${ok ? '✓' : '✗ FAIL'}  ${label}  (got ${got}, want ${want})`);
}

/* ---------------------------------------------------------------------- */
/* 1. Frontend: submission target is snapshotted before async work        */
/* ---------------------------------------------------------------------- */

const tkSubmit = grabFunc('_tkSubmit');
check("_tkSubmit branches to _tkSubmitPhotoCarousel before building the video FormData",
  tkSubmit.indexOf("_tkSubmitPhotoCarousel(") < tkSubmit.indexOf("fd.append('media', tkState.file"),
  true);

const submitCarousel = grabFunc('_tkSubmitPhotoCarousel');
check('_tkSubmitPhotoCarousel snapshots client/profile/title/options into `target`',
  /const target\s*=\s*\{\s*client:\s*tkState\.client,\s*profile:\s*tkState\.profile,\s*title:\s*tkState\.title,\s*options:\s*\{\s*\.\.\.tkState\.options\s*\}/.test(submitCarousel), true);
check('...and that snapshot happens before the per-image mint+PUT loop',
  submitCarousel.indexOf('const target =') < submitCarousel.indexOf('for (let i = 0; i < photos.length'), true);
check('_tkFinishPhotoSubmit is called with the snapshot, not re-read from tkState',
  /_tkFinishPhotoSubmit\(mediaUrls, idempotencyKey, scheduledAtWall, scheduledAtUTC, target\)/.test(submitCarousel), true);

const finishPhoto = grabFunc('_tkFinishPhotoSubmit');
check('_tkFinishPhotoSubmit reads clientName from the snapshot (target.client)',
  finishPhoto.includes("fd.append('clientName', target.client)"), true);
check('_tkFinishPhotoSubmit reads socialAccountId from the snapshot (target.profile)',
  finishPhoto.includes("fd.append('socialAccountId', target.profile)"), true);
check('_tkFinishPhotoSubmit reads title from the snapshot (target.title)',
  finishPhoto.includes("fd.append('title', target.title)"), true);
check('_tkFinishPhotoSubmit reads options from the snapshot (target.options)',
  finishPhoto.includes("fd.append('options', JSON.stringify(target.options))"), true);
check('_tkFinishPhotoSubmit no longer reads tkState.client/profile/title live',
  /tkState\.(client|profile|title)\b/.test(finishPhoto), false);

const submitDirect = grabFunc('_tkSubmitDirect');
check('_tkSubmitDirect (pre-existing >100MB video path) also snapshots into `target`',
  /const target\s*=\s*\{\s*client:\s*tkState\.client,\s*profile:\s*tkState\.profile,\s*title:\s*tkState\.title,\s*options:\s*\{\s*\.\.\.tkState\.options\s*\}/.test(submitDirect), true);

const finishDirect = grabFunc('_tkFinishDirectSubmit');
check('_tkFinishDirectSubmit reads clientName from the snapshot (target.client)',
  finishDirect.includes("fd.append('clientName', target.client)"), true);
check('_tkFinishDirectSubmit no longer reads tkState.client/profile/title live',
  /tkState\.(client|profile|title)\b/.test(finishDirect), false);

/* ---------------------------------------------------------------------- */
/* 1b. Frontend: the target snapshot also freezes schedule mode (round 3) */
/* ---------------------------------------------------------------------- */
// Codex round 3: client/title/options/tz were frozen into `target`, but
// schedule.postNow/schedule.at were still read live in _tkOnSubmitSuccess —
// the schedule controls aren't disabled during upload, so toggling "Post
// immediately" mid-upload could mislabel the optimistic queue row (the real
// POST body was already unaffected, since scheduledAtWall/UTC are computed
// before the async work and passed as plain parameters, not re-read).

for (const [label, fn] of [['_tkSubmitPhotoCarousel', submitCarousel], ['_tkSubmitDirect', submitDirect]]) {
  check(`${label} freezes schedule.postNow/schedule.at into the target snapshot`,
    /schedule:\s*\{\s*postNow:\s*tkState\.schedule\.postNow,\s*at:\s*tkState\.schedule\.at\s*\}/.test(fn), true);
}

const onSubmitSuccess = grabFunc('_tkOnSubmitSuccess');
check('_tkOnSubmitSuccess reads the optimistic row\'s status from the frozen schedule',
  onSubmitSuccess.includes('target.schedule.postNow ? \'uploading\' : \'scheduled\''), true);
check('_tkOnSubmitSuccess reads scheduled_for from the frozen schedule',
  onSubmitSuccess.includes('target.schedule.postNow ? null : (scheduledAtUTC || target.schedule.at)'), true);
check('_tkOnSubmitSuccess no longer reads tkState.schedule live at all',
  /tkState\.schedule\b/.test(onSubmitSuccess), false);

/* ---------------------------------------------------------------------- */
/* 1c. Frontend: a 200 response can still be a logical failure (round 3)  */
/* ---------------------------------------------------------------------- */
// n8n's Wrap Response node (see the n8n-backups check below) sets
// ok:false/status:'failed' WITHOUT a non-2xx HTTP status — Respond JSON never
// sets one. All three submit completions used to treat any 2xx as success.

for (const [label, fn] of [
  ['_tkSubmit (legacy in-band video)', tkSubmit],
  ['_tkFinishDirectSubmit (>100MB video)', finishDirect],
  ['_tkFinishPhotoSubmit (carousel)', finishPhoto],
]) {
  check(`${label} treats a 200 response with ok:false as a failure, not success`,
    /if \(resp\.ok === false\) \{[\s\S]*?_tkRenderForm\(\);\s*return;\s*\}/.test(fn), true);
}

/* ---------------------------------------------------------------------- */
/* 2. Frontend: the existing ≤100MB in-band video path is untouched       */
/* ---------------------------------------------------------------------- */

check('the legacy in-band video submit still sends a single binary "media" field',
  tkSubmit.includes("fd.append('media', tkState.file, tkState.file.name)"), true);
check('TIKTOK_MAX_PHOTOS is the documented TikTok photo/carousel limit',
  /const TIKTOK_MAX_PHOTOS\s*=\s*35;/.test(INDEX), true);

/* ---------------------------------------------------------------------- */
/* 3. Frontend: accessibility fixes from the Codex review are in place    */
/* ---------------------------------------------------------------------- */

check('.tk-radio input is visually hidden, not display:none (keeps it tabbable)',
  /\.tk-radio input \{ position: absolute; width: 1px; height: 1px;/.test(INDEX), true);
check('display:none is no longer used for .tk-radio input',
  /\.tk-radio input \{ display: none; \}/.test(INDEX), false);
check('.tk-radio shows a visible focus ring for keyboard users',
  /\.tk-radio:focus-within \{ outline:/.test(INDEX), true);
check('photo carousel reorder/remove controls stay visible with no hover capability (touch)',
  /@media \(hover: none\) \{ \.tk-photo-actions \{ opacity: 1; \} \}/.test(INDEX), true);

// Round 3: _tkRenderForm() rebuilds the whole form on every reorder/remove,
// which used to drop keyboard focus to <body>. docs/syncview-design/tests/
// tiktok-carousel-browser-journey.js proves focus actually lands correctly
// in a real browser; these are the lightweight source-shape backstop.
const movePhoto = grabFunc('_tkMovePhoto');
const removePhoto = grabFunc('_tkRemovePhoto');
check('photo grid buttons carry data-photo-idx/data-action for focus lookup after re-render',
  INDEX.includes('data-photo-idx="${i}" data-action="move-earlier"'), true);
check('_tkMovePhoto restores focus to the moved image\'s control at its new index',
  movePhoto.includes("_tkFocusPhotoControl(j, dir < 0 ? 'move-earlier' : 'move-later')"), true);
check('_tkRemovePhoto restores focus to a neighboring image (or the file input if none remain)',
  removePhoto.includes("_tkFocusPhotoControl(Math.min(i, tkState.photos.length - 1), 'remove')"), true);

/* ---------------------------------------------------------------------- */
/* 4. n8n (tiktok-upload-direct): exercise the last backed-up Code nodes  */
/* ---------------------------------------------------------------------- */

const BACKUP_PATH = path.resolve(__dirname, '..', 'n8n-backups', 'tiktok-upload-direct.2026-09-08.json');
const backup = JSON.parse(fs.readFileSync(BACKUP_PATH, 'utf8'));
function nodeCode(name) {
  const node = backup.nodes.find(n => n.name === name);
  if (!node) throw new Error('n8n node not found in backup: ' + name);
  return node.parameters.jsCode;
}

function runBuildUploadRow(body) {
  const fn = new Function('$input', nodeCode('Build Upload Row'));
  return fn({ first: () => ({ json: { body } }) })[0].json;
}
function runBuildPostBody(prevJson) {
  const fn = new Function('$', nodeCode('Build Post Body'));
  return fn((name) => ({ first: () => ({ json: prevJson }) }))[0].json;
}

const oldBody = {
  clientName: 'sidneylaruel', socialAccountId: 'spc_test', title: 'a video post',
  mediaUrl: 'https://data.postforme.dev/media/video.mp4',
  options: JSON.stringify({ cover_timestamp_ms: 1500 }),
  scheduledAt: '', scheduledAtUTC: '', timezone: 'America/New_York', idempotencyKey: 'tk_a',
};
const oldRow = runBuildUploadRow(oldBody);
const oldPost = runBuildPostBody(oldRow);
check('old-style single mediaUrl still builds a single-item media[] array',
  oldPost.postBody.media.length, 1);
check('...with the video-only thumbnail_timestamp_ms preserved',
  oldPost.postBody.media[0].thumbnail_timestamp_ms, 1500);
// Full-object comparison, not just presence checks: a field like auto_add_music
// added unconditionally would pass every check above while still changing the
// exact configuration object Post For Me receives for a plain video post. This
// is the "compare the complete old postBody" guard Codex asked for after that
// exact bug (2026-09-08, second review round).
check('...and the video configuration object is exactly the pre-carousel shape (no auto_add_music)',
  JSON.stringify(oldPost.postBody.account_configurations[0].configuration),
  JSON.stringify({ privacy_status: 'public', allow_comment: true, allow_duet: true, allow_stitch: true, disclose_your_brand: false, disclose_branded_content: false, is_ai_generated: false, is_draft: false, localizations: null }));

const newBody = {
  clientName: 'sidneylaruel', socialAccountId: 'spc_test', title: 'a carousel post',
  mediaUrls: JSON.stringify(['https://data.postforme.dev/media/1.jpg', 'https://data.postforme.dev/media/2.jpg', 'https://data.postforme.dev/media/3.jpg']),
  options: JSON.stringify({}),
  scheduledAt: '', scheduledAtUTC: '', timezone: 'America/New_York', idempotencyKey: 'tk_b',
};
const newRow = runBuildUploadRow(newBody);
const newPost = runBuildPostBody(newRow);
check('new-style mediaUrls array builds a matching multi-item media[] array',
  newPost.postBody.media.length, 3);
check('...with no thumbnail_timestamp_ms attached to photo media',
  newPost.postBody.media.some(m => 'thumbnail_timestamp_ms' in m), false);
check('...and auto_add_music IS present for the carousel branch (defaults true)',
  newPost.postBody.account_configurations[0].configuration.auto_add_music, true);

if (failures) { console.error(`\n${failures} check(s) failed.`); process.exit(1); }
console.log('\nAll tiktok-carousel-transport checks passed.');
