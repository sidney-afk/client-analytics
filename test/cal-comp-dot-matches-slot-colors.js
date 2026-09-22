'use strict';
/*
 * The "VIDEO"/"THUMBNAIL" status-dot pills in a calendar card's substatus row
 * (`.cal-fld-substatus-dot`, painted from COMP_PILL_COLORS) used to carry
 * their own independent cyan/fuchsia pair (`--cal-comp-video-dot` /
 * `--cal-comp-graphic-dot`) instead of the vibrant blue/pink the Thumbnail and
 * Video LINK fields use (`--sv-slot-thumb-fg` / `--sv-slot-video-fg`,
 * 2026-09-14). Worse than a mismatch: the two pairs were crossed. Video's dot
 * read blue-ish (cyan) and Thumbnail's dot read pink-ish (fuchsia) --
 * backwards from the fields sitting right below them on the same card, where
 * Thumbnail is blue and Video is pink. The owner saw this directly: "I don't
 * see the change in colors... there are still different colors" (2026-09-15),
 * after the field colors HAD shipped correctly -- the dots were the part left
 * behind.
 *
 * This pins the fix at the token level, in both themes: the dot tokens must
 * resolve THROUGH the same slot tokens the fields use, not carry their own
 * hex (or a differently-named token that merely happens to match today and
 * can drift tomorrow).
 *
 * The Production pile repeated the mismatch. Its two buttons were
 * both teal -- one colour, one glyph, nothing at all to say which was which
 * (owner, 2026-09-15, having asked three times: "both of them look the same").
 * Teal encoded the system and discarded the component. Now colour carries the
 * component on both (pink Video / blue Thumbnail).
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

// One line per theme carries both dot tokens (see the diff this test guards).
const DOT_LINE = /--cal-comp-video-dot:\s*([^;]+);\s*--cal-comp-graphic-dot:\s*([^;]+);/g;
const matches = [...source.matchAll(DOT_LINE)];

ok(matches.length === 2, 'exactly one light and one dark definition of the comp dot tokens exist, found ' + matches.length);

matches.forEach((m, i) => {
  const theme = i === 0 ? 'light (:root)' : 'dark (html[data-theme="dark"])';
  const videoVal = m[1].trim();
  const graphicVal = m[2].trim();
  ok(videoVal === 'var(--sv-slot-video-fg)',
    `${theme}: --cal-comp-video-dot resolves through --sv-slot-video-fg (the Video field's own token), got "${videoVal}"`);
  ok(graphicVal === 'var(--sv-slot-thumb-fg)',
    `${theme}: --cal-comp-graphic-dot (labelled "Thumbnail") resolves through --sv-slot-thumb-fg (the Thumbnail field's own token), got "${graphicVal}"`);
});

// Guard against a future edit reintroducing a bespoke hex/legacy-token pair
// for these two dots specifically (the caption/title dots are untouched and
// deliberately excluded from this check).
ok(!/--cal-comp-video-dot:\s*#[0-9a-fA-F]/.test(source),
  'no hardcoded hex ever backs --cal-comp-video-dot again');
ok(!/--cal-comp-graphic-dot:\s*#[0-9a-fA-F]/.test(source),
  'no hardcoded hex ever backs --cal-comp-graphic-dot again');
ok(!/--cal-comp-video-dot:\s*var\(--sv-misc-/.test(source),
  '--cal-comp-video-dot never reverts to the old standalone sv-misc token');
ok(!/--cal-comp-graphic-dot:\s*var\(--sv-misc-/.test(source),
  '--cal-comp-graphic-dot never reverts to the old standalone sv-misc token');

/* THE PRODUCTION PILE. Video and Thumbnail must resolve to their own
   component colour token. */
const PROD_VIDEO_RULE = /\.cal-linear-btn-video\.cal-prod-btn\s*\{\s*color:\s*([^;]+);\s*\}/;
const PROD_GRAPHIC_RULE = /\.cal-linear-btn-graphic\.cal-prod-btn\s*\{\s*color:\s*([^;]+);\s*\}/;

const prodVideo = source.match(PROD_VIDEO_RULE);
const prodGraphic = source.match(PROD_GRAPHIC_RULE);
ok(!!prodVideo, '.cal-linear-btn-video.cal-prod-btn (the Video Production pile button) is component-scoped');
ok(!!prodGraphic, '.cal-linear-btn-graphic.cal-prod-btn (the Thumbnail Production pile button) is component-scoped');
if (prodVideo) {
  ok(prodVideo[1].trim() === 'var(--sv-slot-video-fg)',
    `the Video Production button takes the video slot colour, got "${prodVideo[1].trim()}"`);
}
if (prodGraphic) {
  ok(prodGraphic[1].trim() === 'var(--sv-slot-thumb-fg)',
    `the Thumbnail Production button takes the thumbnail slot colour, got "${prodGraphic[1].trim()}"`);
}
if (prodVideo && prodGraphic) {
  ok(prodVideo[1].trim() !== prodGraphic[1].trim(),
    'the two Production buttons never resolve to the SAME colour again (the 2026-09-15 "both of them look the same" report)');
}

// Production remains the ringed chip so it stays legible over thumbnail art.
const prodChip = source.match(/\.cal-linear-btn\.cal-prod-btn\s*\{([^}]*)\}/);
ok(!!prodChip, '.cal-linear-btn.cal-prod-btn base chip rule is found');
if (prodChip) {
  ok(/border:\s*[^;]*solid/.test(prodChip[1]),
    'Production buttons stay visibly ringed rather than plain-filled');
  /* OPAQUE, and this is a legibility requirement rather than taste (Codex,
     #1403). The pile is absolutely positioned over .cal-card-thumb, so a
     transparent centre paints the ring and glyph onto user-supplied photo
     pixels; measured against a pink/white/lavender thumbnail both Production
     buttons washed out while the filled Linear chips stayed crisp. */
  ok(!/background:\s*(transparent|none)\b/.test(prodChip[1]),
    'Production buttons never go transparent over the thumbnail art they sit on (the #1403 legibility finding)');
  ok(/background:\s*var\(--/.test(prodChip[1]),
    'Production buttons keep an opaque themed surface behind the ring and glyph');
}

if (failures) { console.error('\ncal-comp-dot-matches-slot-colors FAILED: ' + failures); process.exit(1); }
console.log('\ncal-comp-dot-matches-slot-colors passed');
