'use strict';
/*
 * Calendar thumbnail cache-busting — regression harness.
 *
 * Run:  node test/calendar-thumb-cache-bust.js   (exit 0 = all good)
 *
 * Bug it guards: changing a post's thumbnail link (or replacing the file behind
 * an unchanged Drive link) didn't update the picture in-app — it took a hard
 * refresh. Thumbnails are cache-busted with a _cb token (the post's updated_at),
 * but the strip's harvest (_calHarvestThumbs/_calRestoreThumbs) reuses the
 * already-decoded <img> whenever the key — _calThumbSrcBase(src) — is unchanged,
 * and that key strips _cb. So a re-render restored the STALE decoded image.
 *
 * Fix: a per-card thumbnail rev (_calThumbRev), appended as _r and bumped when
 * a media link is written or a graphic leaves Tweaks Needed. _r is KEPT in the
 * harvest key, so:
 *   - unrelated save (caption/status/date): updated_at → new _cb, rev unchanged →
 *     SAME key → image reused → NO flicker.
 *   - link edit / graphic resolved: rev bumped -> new _r -> DIFFERENT key ->
 *     image reloaded -> auto-update.
 *
 * It EXTRACTS the real functions from ../index.html (by name, brace-balanced) so
 * it tests the ACTUAL shipping code, not a paraphrase. The harvest's reuse
 * decision is `_calThumbSrcBase(oldSrc) === _calThumbSrcBase(newSrc)` — exactly
 * what _calHarvestThumbs keys on — so testing that equality faithfully models
 * "would the strip reuse the old decoded <img> (no flicker) or load the new one?"
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
  grabFunc('_calBumpThumbRev'),
  grabFunc('_calCacheBustThumb'),
  grabFunc('_calThumbSrcBase'),
  grabFunc('_calDeriveThumb'),
].join('\n\n');

const mod = new Function(REAL + `
;return { _calThumbRev, _calBumpThumbRev, _calCacheBustThumb, _calThumbSrcBase, _calDeriveThumb };`)();
const { _calBumpThumbRev, _calThumbSrcBase, _calDeriveThumb } = mod;

// The strip reuses the previously-decoded <img> (no flicker) iff the harvest key
// is unchanged. The key is `pid + '|' + _calThumbSrcBase(src)`; for one card pid
// is constant, so the src-base equality IS the reuse decision.
const wouldReuse = (a, b) => _calThumbSrcBase(a) === _calThumbSrcBase(b);

let failures = 0;
function check(label, cond) {
  if (cond) { console.log('  ok  ' + label); }
  else { console.log('FAIL  ' + label); failures++; }
}

const DRIVE = 'https://drive.google.com/file/d/ABC123/view?usp=sharing';
const DRIVE2 = 'https://drive.google.com/file/d/XYZ789/view?usp=sharing';
const DIRECT = 'https://cdn.example.com/pic.jpg';
const YT = 'https://youtu.be/dQw4w9WgXcQ';

// ── 1. No flicker across an unrelated save (Drive link) ────────────────────
(() => {
  const p = { id: 'p1', thumbnail_url: DRIVE, asset_url: '', updated_at: 't0' };
  const s0 = _calDeriveThumb(p);
  p.updated_at = 't1';                 // a caption/status/date save bumps updated_at only
  const s1 = _calDeriveThumb(p);
  check('unrelated save changes _cb', s0 !== s1 && /_cb=/.test(s1));
  check('unrelated save → strip REUSES image (no flicker)', wouldReuse(s0, s1) === true);
})();

// ── 2. Same-link re-confirm / file swap → rev bump forces a reload ─────────
(() => {
  const p = { id: 'p2', thumbnail_url: DRIVE, asset_url: '', updated_at: 'u0' };
  const before = _calDeriveThumb(p);
  _calBumpThumbRev('p2');              // what a thumbnail/asset link WRITE does
  p.updated_at = 'u1';
  const after = _calDeriveThumb(p);
  check('link write appends _r', /_r=/.test(after) && !/_r=/.test(before));
  check('same-link re-write → strip RELOADS image (auto-update)', wouldReuse(before, after) === false);
})();

// ── 3. Link text change → different base → reload ──────────────────────────
(() => {
  const p = { id: 'p3', thumbnail_url: DRIVE, asset_url: '', updated_at: 'v0' };
  const a = _calDeriveThumb(p);
  p.thumbnail_url = DRIVE2; _calBumpThumbRev('p3'); p.updated_at = 'v1';
  const b = _calDeriveThumb(p);
  check('different Drive file id in src', /id=ABC123/.test(a) && /id=XYZ789/.test(b));
  check('link text change → strip RELOADS image', wouldReuse(a, b) === false);
})();

// ── 4. A second unrelated save AFTER a link edit still reuses (no flicker) ──
(() => {
  const p = { id: 'p4', thumbnail_url: DRIVE, asset_url: '', updated_at: 'w0' };
  _calBumpThumbRev('p4');             // link edited at some point this session
  p.updated_at = 'w1';
  const s0 = _calDeriveThumb(p);       // carries _r=rev
  p.updated_at = 'w2';                 // later unrelated save — rev NOT bumped
  const s1 = _calDeriveThumb(p);
  check('post-edit unrelated save keeps same _r', wouldReuse(s0, s1) === true);
})();

// ── 5. Direct image URL: separator stays canonical with/without _cb ────────
(() => {
  _calBumpThumbRev('p5');
  const rev = mod._calThumbRev['p5'];
  const withCb = _calDeriveThumb({ id: 'p5', thumbnail_url: DIRECT, asset_url: '', updated_at: 'x0' });
  const noCb   = _calDeriveThumb({ id: 'p5', thumbnail_url: DIRECT, asset_url: '' }); // probe, no updated_at
  check('direct url with _cb has _r=' + rev, withCb.includes('_cb=x0') && withCb.includes('_r=' + rev));
  check('direct url _cb/no-_cb normalize to the SAME base key',
        _calThumbSrcBase(withCb) === _calThumbSrcBase(noCb));
  check('normalized base key is a valid single-? query',
        _calThumbSrcBase(withCb) === DIRECT + '?_r=' + rev);
})();

// ── 6. Direct image URL: no flicker on unrelated save (no rev) ─────────────
(() => {
  const p = { id: 'p6', thumbnail_url: 'https://cdn.example.com/z.png', asset_url: '', updated_at: 'a0' };
  const s0 = _calDeriveThumb(p);
  p.updated_at = 'a1';
  const s1 = _calDeriveThumb(p);
  check('direct url unrelated save → reuses image', wouldReuse(s0, s1) === true);
})();

// ── 7. YouTube thumbnails are immutable per id → never cache-busted ────────
(() => {
  _calBumpThumbRev('p7');
  const s = _calDeriveThumb({ id: 'p7', thumbnail_url: YT, asset_url: '', updated_at: 'y0' });
  check('youtube thumb carries no _cb/_r', !/[?&]_cb=/.test(s) && !/[?&]_r=/.test(s));
  check('youtube thumb resolves to the video id', s === 'https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg');
})();

// ── 8. Remote viewer (client/Kasper): persisted thumb_rev drives the reload ─
// A viewer that didn't make the edit has NO session _calThumbRev entry — it
// relies on post.thumb_rev arriving via the Supabase row / realtime.
(() => {
  const p = { id: 'remote1', thumbnail_url: DRIVE, asset_url: '', updated_at: 'r0', thumb_rev: 'aaa' };
  const s0 = _calDeriveThumb(p);
  check('viewer src uses persisted thumb_rev as _r', /_r=aaa/.test(s0));
  // unrelated remote save: updated_at moves, thumb_rev unchanged
  p.updated_at = 'r1';
  const s1 = _calDeriveThumb(p);
  check('viewer: unrelated remote save → reuses image (no flicker)', wouldReuse(s0, s1) === true);
  // thumbnail remote save: thumb_rev bumps (the SMM wrote a link)
  p.thumb_rev = 'bbb'; p.updated_at = 'r2';
  const s2 = _calDeriveThumb(p);
  check('viewer: thumb_rev change → RELOADS image (live, no hard refresh)', wouldReuse(s1, s2) === false);
})();

// ── 9. Editing browser: session rev takes priority over persisted ──────────
(() => {
  _calBumpThumbRev('edit1');
  const sessionRev = mod._calThumbRev['edit1'];
  const p = { id: 'edit1', thumbnail_url: DRIVE, asset_url: '', updated_at: 'e0', thumb_rev: 'persisted-yyy' };
  const s = _calDeriveThumb(p);
  check('editor uses session rev (instant), not the persisted echo',
        s.includes('_r=' + sessionRev) && !s.includes('persisted-yyy'));
})();

// ── 10. Wiring: the shipped index.html persists + patches thumb_rev ─────────
(() => {
  check('graphic status helper bumps only when leaving Tweaks Needed',
        /function _calShouldBumpThumbRevForGraphicStatus[\s\S]*before === 'Tweaks Needed' && after !== 'Tweaks Needed'/.test(INDEX));
  check('calendar flush bumps thumb_rev from a link write or graphic resolution',
        /const bumpThumbRev = \('thumbnail_url' in edits \|\| 'asset_url' in edits\)[\s\S]*_calShouldBumpThumbRevForGraphicStatus\(edits, prevSnapshot, post\);[\s\S]*if \(bumpThumbRev\) post\.thumb_rev = _calBumpThumbRev\(realId\);/.test(INDEX));
  check('calendar v2 field-patch sends thumb_rev when the bump condition fired',
        /if \(bumpThumbRev\) wirePost\.thumb_rev = post\.thumb_rev;/.test(INDEX));
  check('calendar refreshes the visible card when the bump condition fired',
        /if \(bumpThumbRev\) _calRefreshCardThumb\(realId\);/.test(INDEX));
  check('samples also bump and refresh on the same condition',
        /const bumpThumbRev = \('thumbnail_url' in edits \|\| 'asset_url' in edits\)[\s\S]*_calShouldBumpThumbRevForGraphicStatus\(edits, prevSnapshot, post\);[\s\S]*if \(bumpThumbRev\) post\.thumb_rev = _sxrBumpThumbRev\(realId\);[\s\S]*if \(bumpThumbRev\) _sxrForceThumbRefresh\(realId\);/.test(INDEX));
  check('cache-bust prefers session _calThumbRev, falls back to post.thumb_rev',
        /\(p && p\.id && _calThumbRev\[p\.id\]\) \|\| \(p && p\.thumb_rev\)/.test(INDEX));
})();

console.log(failures === 0
  ? '\nAll thumbnail cache-bust checks passed.'
  : '\n' + failures + ' check(s) FAILED.');
process.exit(failures === 0 ? 0 : 1);
