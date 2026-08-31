'use strict';
/*
 * What the asset pill is allowed to ASSERT.
 *
 * Two owner reports, 2026-08-31, and they are the same bug seen from two
 * angles: a pill claiming something the reader had not established.
 *
 *  1. "whenever I change the tab it says checking and everything it says
 *     unavailable and then it shows it ... there's like this weird back and
 *     forth of refresh that I don't really like."
 *  2. A Frame folder link he had just saved, and could open, sitting under a
 *     red Unavailable.
 *
 * The estate already carries the vocabulary that separates these:
 *
 *     missing      a fact about the WORLD   -- unknowable to this reader, the
 *                  browser grant excludes every asset column
 *     unavailable  a fact about the READER  -- true only once a read failed
 *     checking     a fact about the REQUEST -- true while one is in flight
 *
 * The 2026-08-30 change correctly stopped seeding `missing`, and swung one
 * word too far: `unavailable` at BUILD time asserts a read was attempted and
 * failed, before any read has run. That is the red flash on every repaint.
 */
const fs = require('fs');
const path = require('path');

const INDEX = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

function grabFunc(name) {
  const start = INDEX.indexOf(name);
  if (start < 0) throw new Error('not found: ' + name);
  let i = INDEX.indexOf('{', start);
  let depth = 0, inS = '', inC = '';
  for (let j = i; j < INDEX.length; j++) {
    const c = INDEX[j], n = INDEX[j + 1];
    if (inC === 'line') { if (c === '\n') inC = ''; continue; }
    if (inC === 'block') { if (c === '*' && n === '/') { inC = ''; j++; } continue; }
    if (inS) { if (c === '\\') { j++; continue; } if (c === inS) inS = ''; continue; }
    if (c === '/' && n === '/') { inC = 'line'; j++; continue; }
    if (c === '/' && n === '*') { inC = 'block'; j++; continue; }
    if (c === '"' || c === "'" || c === '`') { inS = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (!depth) return INDEX.slice(start, j + 1); }
  }
  throw new Error('unbalanced: ' + name);
}

/* ---- 1. A slot nobody has read yet says so ---------------------------- */

const seedSrc = grabFunc('function _prodAssetDefaultEvidence(');

/* THE SEED FOLLOWS WHETHER A READ IS COMING, which is the same question the
   three words were always about. Executed rather than pattern-matched: the
   synthetic-parent carve-out below was caught by the existing first-paint test
   during review of this change, and a regex over the ternary would not have
   noticed it was missing. */
const seed = new Function('deps', `
  const { PROD_ASSET_SPECS, PROD_BATCH_ASSET_GUIDANCE, PROD_ASSET_UNREAD_GUIDANCE } = deps;
  ${seedSrc}
  return _prodAssetDefaultEvidence;
`)({
  PROD_ASSET_SPECS: [
    { key: 'filming_plan' }, { key: 'raw_footage' },
    { key: 'delivery_folder' }, { key: 'deliverable_file' },
  ],
  PROD_BATCH_ASSET_GUIDANCE: 'Held on the post, not readable here. Open a sub-issue to see it.',
  PROD_ASSET_UNREAD_GUIDANCE: 'Not readable until asset access is checked.',
});

const real = seed({ id: 'del_1', team: 'video', assets: {} });
ok(real.filming_plan.state === 'checking',
  'a REAL deliverable seeds CHECKING — a read is coming and will repaint, so nothing is asserted yet');
ok(real.filming_plan.state !== 'missing' && real.filming_plan.state !== 'unavailable',
  'and specifically neither Missing (unknowable) nor Unavailable (a read that has not happened)');
ok(!String(real.filming_plan.guidance || '').trim()
  && /asset access/i.test(real.filming_plan.unreadGuidance),
  'its unread guidance is CARRIED but not attached — a slot still checking has nothing to advise about');

/* THE CARVE-OUT. `checking` is only honest if something is going to check. A
   synthetic batch parent has no deliverable row, the prober can only answer
   403, and _prodEnsureAssets settles it and RETURNS WITHOUT REPAINTING -- so
   seeding checking there would leave the pill saying Checking forever. */
const parent = seed({ id: 'batch::node', syntheticBatchParent: true, assets: {} });
ok(parent.filming_plan.state === 'unavailable',
  'a SYNTHETIC batch parent still seeds Unavailable — no read is coming, so that is the settled truth');
ok(/Open a sub-issue/.test(parent.filming_plan.guidance),
  'and it carries its guidance immediately, because its state is already final');

ok(seed(null).filming_plan.state === 'missing',
  'with no issue at all the seed stays Missing — the projection-swap placeholder, not a claim about a row');

/* ---- 2. The failure paths earn the word, and can now reach it --------- */
/* Both conversions existed before and could never fire for an empty slot: it
   was born `unavailable` already. Seeding `checking` is what makes them live. */

const conversions = INDEX.split("if (asset.state === 'checking') {").length - 1;
ok(conversions >= 2,
  'both read-failure paths still convert checking -> unavailable (' + conversions + ')');
ok(INDEX.includes("asset.guidance = String(asset.unreadGuidance || '') || PROD_ASSET_UNREAD_GUIDANCE"),
  'and attach the guidance at the moment the state becomes true, not before');

/* ---- 3. Could-not-check is not the same claim as broken --------------- */
/* probeAssetUrl: "`unavailable` with a status means the fetch completed and
   the content was not media. `unavailable` WITHOUT one means" the redirect was
   refused, it timed out, or the host was unreachable. Opposite messages. */

const panel = grabFunc('function _prodAssetsPanelHTML(');
ok(/rawAssetState === 'unavailable'[\s\S]{0,200}!Number\(asset\.http_status \|\| 0\)[\s\S]{0,60}\? 'unverified'/.test(panel),
  'an unavailable with a url and NO http_status renders as unverified — the probe never completed');
ok(/String\(url \|\| ''\)\.trim\(\)/.test(panel),
  'and only when a url is actually present; an empty unreadable slot keeps its own wording');

const labels = grabFunc('function _prodAssetStateLabel(');
ok(/unverified: 'Not checked'/.test(labels),
  'it reads "Not checked", which is what happened, rather than "Unavailable", which is a claim about the link');
ok(/unavailable: 'Unavailable'/.test(labels),
  'and a genuine unavailable still says so');

/* ---- 4. Executed: the classifier, over the shapes that reach it ------- */

function render(asset) {
  const url = String(asset.url || '').trim();
  const raw = String(asset.state || (url ? 'checking' : 'missing'));
  return raw === 'unavailable' && url && !Number(asset.http_status || 0) ? 'unverified' : raw;
}
const FRAME = 'https://next.frame.io/project/f6649ca0-fc11-48b8-9624-13c218f97105/548428ae';
ok(render({ url: FRAME, state: 'unavailable' }) === 'unverified',
  'the reported case: a saved Frame.io link the probe could not follow past an auth redirect');
ok(render({ url: 'https://drive.google.com/file/d/x/view', state: 'unavailable', http_status: 200 }) === 'unavailable',
  'a link the probe DID fetch, whose content was not reviewable, is still Unavailable');
ok(render({ url: '', state: 'unavailable' }) === 'unavailable',
  'an empty slot a read failed on is unchanged — it has no link to be unverified about');
ok(render({ url: FRAME, state: 'permission_denied', http_status: 403 }) === 'permission_denied',
  'a real permission wall is untouched: that IS a fact about the link');
ok(render({ url: FRAME, state: 'available', http_status: 200 }) === 'available',
  'and a verified link is untouched');

/* ---- 5. The colour matches the claim ---------------------------------- */

ok(/\.prod-asset-state\[data-state="unverified"\] \{ color: var\(--prod-muted/.test(INDEX),
  'unverified is neutral, not the red that means broken — the pill is a report, never a gate');
ok(!/data-state="unverified"[^}]*--prod-overdue/.test(INDEX),
  'and specifically not the overdue red');

console.log(failures === 0
  ? '\nasset badge honesty checks passed'
  : '\n' + failures + ' asset badge honesty check(s) failed');
process.exit(failures === 0 ? 0 : 1);
