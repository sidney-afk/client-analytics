'use strict';
/*
 * Folder-link thumbnails — regression harness.
 *
 * Run:  node test/calendar-folder-thumb.js   (exit 0 = all good)
 *
 * What it guards: social media managers sometimes paste a FOLDER of images into
 * the thumbnail field (e.g. a Story whose frames live in one Drive/Dropbox
 * folder) instead of a single image. There's no one image to preview, so —
 * exactly like a Frame.io share link — the app must surface a click-to-open
 * card ("Open folder", opens in a new tab) everywhere a thumbnail renders
 * (calendar cards, client review, Kasper's queue), instead of a broken <img>
 * or the generic "no media" icon.
 *
 * The classification rules under test:
 *   - a Drive/Dropbox FOLDER link → frameKind 'folder' (no derived <img>),
 *   - a Drive FILE link is NEVER mistaken for a folder (it derives an <img>),
 *   - a Frame.io link still wins as frameKind 'frame',
 *   - only the THUMBNAIL field qualifies — a folder in asset_url does not
 *     spawn an "open" card (mirrors the existing Frame.io video guard).
 *
 * It EXTRACTS the real functions from ../index.html (by name, brace-balanced)
 * so it tests the ACTUAL shipping code, not a paraphrase, and pins the wiring
 * that threads the link KIND through every render site with regex assertions.
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
function grabConst(name) {
  const re = new RegExp('^\\s*const ' + name + '\\s*=.*;\\s*$', 'm');
  const m = INDEX.match(re);
  if (!m) throw new Error('const not found: ' + name);
  return m[0];
}

// ---- Real code extracted verbatim from index.html (by name) ----
const REAL = [
  grabConst('_calThumbRev'),
  grabFunc('_calCacheBustThumb'),
  grabFunc('_calLinkHost'),
  grabFunc('_calIsFrameLink'),
  grabFunc('_calFrameOpenUrl'),
  grabFunc('_calIsFolderLink'),
  grabFunc('_calFolderOpenUrl'),
  grabFunc('_calDriveFileId'),
  grabFunc('_calDriveImageUrl'),
  grabFunc('_calDeriveThumb'),
  grabFunc('_calDeriveThumbInfo'),
  grabFunc('_calFrameMarkSvg'),
  grabFunc('_calFolderMarkSvg'),
  grabFunc('_calOpenCardMeta'),
].join('\n\n');

const mod = new Function(REAL + `
;return { _calIsFolderLink, _calIsFrameLink, _calDeriveThumb, _calDeriveThumbInfo, _calOpenCardMeta };`)();
const { _calIsFolderLink, _calIsFrameLink, _calDeriveThumb, _calDeriveThumbInfo, _calOpenCardMeta } = mod;

let failures = 0;
function check(label, cond) {
  if (cond) { console.log('  ok  ' + label); }
  else { console.log('FAIL  ' + label); failures++; }
}
const infoFor = (thumbnail_url, asset_url) => _calDeriveThumbInfo({ thumbnail_url, asset_url: asset_url || '' });

const DRIVE_FOLDER     = 'https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnO';
const DRIVE_FOLDER_U   = 'https://drive.google.com/drive/u/0/folders/1AbCdEfGhIjKlMnO';
const DRIVE_FOLDERVIEW = 'https://drive.google.com/folderview?id=1AbCdEfGhIjKlMnO';
const DRIVE_FILE       = 'https://drive.google.com/file/d/ABC123/view?usp=sharing';
const DROPBOX_FOLDER   = 'https://www.dropbox.com/scl/fo/abc123def/AABBCC?dl=0';
const DROPBOX_SH       = 'https://www.dropbox.com/sh/abc123def/AABBCC';
const DROPBOX_FILE     = 'https://www.dropbox.com/scl/fi/abc123/clip';
const FRAME            = 'https://f.io/abc123';
const FRAME_APP        = 'https://app.frame.io/reviews/xyz789';
const DIRECT           = 'https://cdn.example.com/pic.jpg';
const NOSCHEME_FOLDER  = 'drive.google.com/drive/folders/zzz999';

// ── 1. Drive folder shapes are all classified as folders ───────────────────
(() => {
  check('Drive /drive/folders/ is a folder link', _calIsFolderLink(DRIVE_FOLDER) === true);
  check('Drive /drive/u/0/folders/ is a folder link', _calIsFolderLink(DRIVE_FOLDER_U) === true);
  check('Drive legacy /folderview?id= is a folder link', _calIsFolderLink(DRIVE_FOLDERVIEW) === true);
})();

// ── 2. A folder thumbnail derives NO <img> and surfaces a folder card ──────
(() => {
  const info = infoFor(DRIVE_FOLDER);
  check('folder thumb derives no inline image', info.url === '');
  check('folder thumb sets a click-to-open url', info.frame === DRIVE_FOLDER);
  check("folder thumb kind is 'folder'", info.frameKind === 'folder');
})();

// ── 3. A Drive FILE link is NEVER mistaken for a folder ────────────────────
(() => {
  check('Drive file link is not a folder', _calIsFolderLink(DRIVE_FILE) === false);
  const info = infoFor(DRIVE_FILE);
  check('Drive file derives a real final-host <img>',
        /lh3\.googleusercontent\.com\/d\/ABC123=w640/.test(info.url));
  check('Drive file is not a folder/frame card', info.frame === '' && info.frameKind === '');
})();

// ── 4. Dropbox: folders open a card, file links do not ─────────────────────
(() => {
  check('Dropbox /scl/fo/ is a folder link', _calIsFolderLink(DROPBOX_FOLDER) === true);
  check('Dropbox /sh/ is a folder link', _calIsFolderLink(DROPBOX_SH) === true);
  check('Dropbox /scl/fi/ FILE link is NOT a folder', _calIsFolderLink(DROPBOX_FILE) === false);
  check("Dropbox folder thumb kind is 'folder'", infoFor(DROPBOX_FOLDER).frameKind === 'folder');
})();

// ── 5. Frame.io still wins as 'frame' (not folder) ─────────────────────────
(() => {
  check('f.io link is not a folder', _calIsFolderLink(FRAME) === false);
  check("f.io thumb kind is 'frame'", infoFor(FRAME).frameKind === 'frame');
  check("app.frame.io thumb kind is 'frame'", infoFor(FRAME_APP).frameKind === 'frame');
})();

// ── 6. A direct image link is an image, not a folder/frame card ────────────
(() => {
  const info = infoFor(DIRECT);
  check('direct image derives an <img>', info.url.indexOf(DIRECT) === 0);
  check('direct image is not a folder/frame card', info.frame === '' && info.frameKind === '');
})();

// ── 7. Scheme-less folder links still resolve + open with https ────────────
(() => {
  check('scheme-less folder is a folder link', _calIsFolderLink(NOSCHEME_FOLDER) === true);
  check('folder open url gets an https scheme', infoFor(NOSCHEME_FOLDER).frame === 'https://' + NOSCHEME_FOLDER);
})();

// ── 8. Only the THUMBNAIL field qualifies — a folder in asset_url is inert ──
//    Mirrors the existing Frame.io guard: a card with a folder/Frame VIDEO in
//    asset_url and no thumbnail must NOT show an "open thumbnail/folder" card.
(() => {
  const info = infoFor('', DRIVE_FOLDER);
  check('folder in asset_url does not derive an image', info.url === '');
  check('folder in asset_url does NOT spawn an open card', info.frame === '' && info.frameKind === '');
})();

// ── 9. Card meta: the label / hover text / tip follow the kind ─────────────
(() => {
  const folder = _calOpenCardMeta('folder');
  const frame = _calOpenCardMeta('frame');
  const dflt = _calOpenCardMeta(undefined);
  check("folder meta cta is 'Open folder'", folder.cta === 'Open folder');
  check('folder meta title mentions opening in a new tab', /folder/i.test(folder.title) && /new tab/i.test(folder.title));
  check("folder meta tip is 'Folder of images'", folder.tip === 'Folder of images');
  check("frame meta cta is 'Open thumbnail'", frame.cta === 'Open thumbnail');
  check('unknown kind defaults to the frame card', dflt.cta === frame.cta && dflt.tip === frame.tip);
  check('folder + frame badges differ', folder.badge !== frame.badge);
})();

// ── 10. Wiring: every render site threads the link KIND through ─────────────
//   The extraction above proves the classifier; these pin that the shipping
//   HTML templates actually pass frameKind on, on every surface the user named.
(() => {
  // Calendar card media + the three in-place thumb refreshers.
  check('card thumb media passes frameKind to the open card',
        /_calThumbFrameHtml\(info\.frame, info\.frameKind\)/.test(INDEX));
  // Compact surfaces: month pill, week card, collapsed review/Kasper strips.
  check('month pill mini badge is kind-aware',
        /_calMiniLinkBadgeHtml\('cal-month-pill-thumb', info\.frameKind\)/.test(INDEX));
  check('week card mini badge is kind-aware',
        /_calMiniLinkBadgeHtml\('cal-week-card-thumb', info\.frameKind\)/.test(INDEX));
  check('review/Kasper strip mini badge is kind-aware',
        /_calMiniLinkBadgeHtml\('kcard-thumb-fallback', info\.frameKind\)/.test(INDEX) &&
        /_calMiniLinkBadgeHtml\('kcard-thumb-fallback', thumbInfo\.frameKind\)/.test(INDEX));
  // Expanded review + Kasper hero detect folder links directly off the raw url.
  check('client review graphic preview detects folder links',
        /linkKind = _calIsFrameLink\(raw\) \? 'frame' : \(_calIsFolderLink\(raw\) \? 'folder' : ''\)/.test(INDEX));
  check('expanded previews pass the kind into the review card',
        /_calReviewFrameHtml\(openUrl, undefined, linkKind\)/.test(INDEX) &&
        /_calReviewFrameHtml\(openUrl, 'hero', linkKind\)/.test(INDEX));
  // Kasper queue zoom anchor opens in a new tab with a kind-aware title.
  check('Kasper zoom anchor title is kind-aware',
        /title="\$\{_calEscAttr\(_calOpenCardMeta\(thumbInfo\.frameKind\)\.title\)\}"/.test(INDEX));
})();

console.log(failures === 0
  ? '\nAll folder-thumbnail checks passed.'
  : '\n' + failures + ' check(s) FAILED.');
process.exit(failures === 0 ? 0 : 1);
