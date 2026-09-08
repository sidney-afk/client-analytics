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

if (failures) { console.error(`\n${failures} check(s) failed.`); process.exit(1); }
console.log('\nAll tiktok-carousel-transport checks passed.');
