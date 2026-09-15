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
 * The same crossed pair existed a THIRD time, in the Linear "pile" icons
 * stacked at the bottom-right corner of the thumbnail (`.cal-linear-pile`,
 * video on top, graphic/thumbnail below) -- fixed same day, same report:
 * `.cal-linear-btn.is-linked` (video) carried Linear's own generic indigo,
 * `.cal-linear-btn-graphic.is-linked` (thumbnail) carried a fuchsia, and
 * neither was the vibrant pink/blue pair, so the corner of the card still
 * disagreed with the fields even after the dot fix above. That indigo stays
 * correct everywhere else Linear appears (Workload's plan-origin badge, the
 * review panel's Linear link) -- only these two component-scoped rules move.
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

// The Linear pile icons (bottom-right of the thumbnail): same pairing,
// checked directly against the rule text rather than a combined regex, since
// the two rules live far apart in the stylesheet (one is a component-scoped
// override of the other).
const LINEAR_VIDEO_RULE = /\.cal-linear-btn\.is-linked\s*\{\s*background:\s*([^;]+);\s*color:\s*([^;]+);\s*\}/;
const LINEAR_GRAPHIC_RULE = /\.cal-linear-btn-graphic\.is-linked\s*\{\s*color:\s*([^;]+);\s*background:\s*([^;]+);\s*\}/;

const linearVideo = source.match(LINEAR_VIDEO_RULE);
ok(!!linearVideo, '.cal-linear-btn.is-linked (the video Linear-pile icon) rule is found');
if (linearVideo) {
  ok(linearVideo[1].trim() === 'var(--sv-slot-video-bg)' && linearVideo[2].trim() === 'var(--sv-slot-video-fg)',
    `.cal-linear-btn.is-linked resolves through the video slot tokens, got background:"${linearVideo[1].trim()}" color:"${linearVideo[2].trim()}"`);
}

const linearGraphic = source.match(LINEAR_GRAPHIC_RULE);
ok(!!linearGraphic, '.cal-linear-btn-graphic.is-linked (the thumbnail Linear-pile icon) rule is found');
if (linearGraphic) {
  ok(linearGraphic[1].trim() === 'var(--sv-slot-thumb-fg)' && linearGraphic[2].trim() === 'var(--sv-slot-thumb-bg)',
    `.cal-linear-btn-graphic.is-linked resolves through the thumbnail slot tokens, got color:"${linearGraphic[1].trim()}" background:"${linearGraphic[2].trim()}"`);
}

ok(!/\.cal-linear-btn\.is-linked\s*\{\s*background:\s*var\(--sv-bg-ecedfb\)/.test(source),
  '.cal-linear-btn.is-linked never reverts to the old generic-indigo background');
ok(!/\.cal-linear-btn-graphic\.is-linked\s*\{\s*color:\s*var\(--sv-fg-d946ef\)/.test(source),
  '.cal-linear-btn-graphic.is-linked never reverts to its old standalone fuchsia');

if (failures) { console.error('\ncal-comp-dot-matches-slot-colors FAILED: ' + failures); process.exit(1); }
console.log('\ncal-comp-dot-matches-slot-colors passed');
