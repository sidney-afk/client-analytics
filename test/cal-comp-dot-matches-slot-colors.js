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
 *
 * And a FOURTH time, which is why this file now guards the shape of the rule
 * rather than just its colour. A full pile is four buttons: Linear + SyncView
 * Production, for each of Video and Thumbnail. The two PRODUCTION buttons were
 * both teal -- one colour, one glyph, nothing at all to say which was which
 * (owner, 2026-09-15, having asked three times: "both of them look the same").
 * Teal encoded the system and discarded the component. Now colour carries the
 * component on all four (pink Video / blue Thumbnail) and the system moves to
 * fill-vs-outline, so the invariant worth pinning is not "this rule is pink"
 * but "no two buttons in a pile resolve to the same colour token".
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
// Codex caught (#1401): this selector is equal specificity to, and sits
// AFTER, .cal-linear-btn.cal-prod-btn in the stylesheet, so without
// :not(.cal-prod-btn) it would win on source order and repaint the SyncView
// Production graphic link (teal, deliberately distinct from Linear) the same
// blue as the Linear one. The exclusion is load-bearing, not decorative --
// pin it so it can't be "simplified" away later.
const LINEAR_GRAPHIC_RULE = /\.cal-linear-btn-graphic\.is-linked:not\(\.cal-prod-btn\)\s*\{\s*color:\s*([^;]+);\s*background:\s*([^;]+);\s*\}/;

const linearVideo = source.match(LINEAR_VIDEO_RULE);
ok(!!linearVideo, '.cal-linear-btn.is-linked (the video Linear-pile icon) rule is found');
if (linearVideo) {
  ok(linearVideo[1].trim() === 'var(--sv-slot-video-bg)' && linearVideo[2].trim() === 'var(--sv-slot-video-fg)',
    `.cal-linear-btn.is-linked resolves through the video slot tokens, got background:"${linearVideo[1].trim()}" color:"${linearVideo[2].trim()}"`);
}

const linearGraphic = source.match(LINEAR_GRAPHIC_RULE);
ok(!!linearGraphic, '.cal-linear-btn-graphic.is-linked:not(.cal-prod-btn) (the thumbnail Linear-pile icon, scoped away from the teal Production variant) rule is found');
if (linearGraphic) {
  ok(linearGraphic[1].trim() === 'var(--sv-slot-thumb-fg)' && linearGraphic[2].trim() === 'var(--sv-slot-thumb-bg)',
    `.cal-linear-btn-graphic.is-linked:not(.cal-prod-btn) resolves through the thumbnail slot tokens, got color:"${linearGraphic[1].trim()}" background:"${linearGraphic[2].trim()}"`);
}

ok(!/\.cal-linear-btn\.is-linked\s*\{\s*background:\s*var\(--sv-bg-ecedfb\)/.test(source),
  '.cal-linear-btn.is-linked never reverts to the old generic-indigo background');
ok(!/\.cal-linear-btn-graphic\.is-linked[^:]*\{\s*color:\s*var\(--sv-fg-d946ef\)/.test(source),
  '.cal-linear-btn-graphic.is-linked never reverts to its old standalone fuchsia');
ok(!/\.cal-linear-btn-graphic\.is-linked\s*\{/.test(source),
  '.cal-linear-btn-graphic.is-linked never appears WITHOUT the :not(.cal-prod-btn) guard (the Codex #1401 finding)');

/* THE FOUR-BUTTON PILE. Video and Thumbnail each get a Linear button and a
   SyncView Production button, and all four can stack at once. Every one of
   them must resolve to its OWN component's colour token -- the failure this
   guards is two of them landing on the same colour, which is what shipped
   when both Production buttons were teal. */
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

// The four colours a full pile can show, as the stylesheet resolves them.
// Four buttons, four distinct tokens -- no pair may collide.
const pileColours = [
  ['Video Linear', linearVideo && linearVideo[2].trim()],
  ['Video Production', prodVideo && prodVideo[1].trim()],
  ['Thumbnail Linear', linearGraphic && linearGraphic[1].trim()],
  ['Thumbnail Production', prodGraphic && prodGraphic[1].trim()],
].filter(entry => entry[1]);
ok(pileColours.length === 4, 'all four pile buttons have a resolvable colour rule, found ' + pileColours.length);
// Video's two share pink and Thumbnail's two share blue BY DESIGN -- the
// system axis is fill-vs-outline, not hue. What must never collide is the two
// halves of the pile, i.e. Video's colour against Thumbnail's.
const videoTokens = pileColours.filter(e => e[0].startsWith('Video')).map(e => e[1]);
const thumbTokens = pileColours.filter(e => e[0].startsWith('Thumbnail')).map(e => e[1]);
ok(videoTokens.length === 2 && new Set(videoTokens).size === 1,
  "Video's Linear and Production buttons share one component colour");
ok(thumbTokens.length === 2 && new Set(thumbTokens).size === 1,
  "Thumbnail's Linear and Production buttons share one component colour");
ok(videoTokens[0] !== thumbTokens[0],
  'the Video half and the Thumbnail half of the pile never share a colour');

// The system axis has to stay somewhere, now that it is not hue: Production is
// the OUTLINED chip. Without this the two halves would be four identical-looking
// chips in two colours, which is the same complaint one level down.
ok(/\.cal-linear-btn\.cal-prod-btn\s*\{[^}]*background:\s*transparent[^}]*border:\s*[^;]*solid/.test(source),
  'Production buttons stay visually distinct from Linear ones by being outlined rather than filled');

if (failures) { console.error('\ncal-comp-dot-matches-slot-colors FAILED: ' + failures); process.exit(1); }
console.log('\ncal-comp-dot-matches-slot-colors passed');
