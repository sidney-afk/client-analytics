'use strict';
/*
 * Owner observations from live testing, 2026-08-30 (SyncLinear / ?prod=1).
 *
 * 1. A batch parent showed "Filming Plan: https://docs.google.com/..." as a live
 *    link in its Description while its own Assets grid called all four rows
 *    "Not provided / Missing", and its child resolved the same plan correctly.
 *
 *    VID-13663 is not a real issue: it is a SYNTHETIC node minted from the
 *    `batches` row. Its grid is populated from batches.filming_doc_url /
 *    footage_folder_url / delivery_folder_url -- three columns the f34/f53
 *    migration deliberately revoked from the browser grant, and which
 *    PROD_BATCH_SELECT therefore never asks for. They arrive undefined on every
 *    synthetic parent, so `String(undefined || '')` makes them '' and the panel
 *    prints Missing. The child is right because it reads the SAME batch row
 *    through a service-role edge function. Nothing is missing in the data; two
 *    readers with different privileges look at one field. Measured live: 220 of
 *    292 batch parents printed Missing on every row while carrying the link in
 *    their own description.
 *
 *    Widening the browser select is NOT the fix -- it returns 42501 and takes
 *    the whole Production tab down. So the panel stops asserting a fact about
 *    the world it cannot know, and asserts one about the reader instead.
 *
 * 2. The parent also carried a "Deliverable file" row, which cannot ever be
 *    populated there: the projection hardcodes it to ''. A batch parent is a
 *    container; the artifact belongs to a sub-issue (measured: file_url proxies
 *    point at a child 483 times vs a parent 8).
 *
 * 3. The Description panel carried a Refresh button whose premise -- Linear
 *    changing a description underneath the page -- the flip retired.
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
  const at = INDEX.indexOf('function ' + name + '(');
  if (at < 0) throw new Error('function not found: ' + name);
  let depth = 0, quote = '', escaped = false, comment = '';
  for (let j = INDEX.indexOf('{', at); j < INDEX.length; j++) {
    const c = INDEX[j], next = INDEX[j + 1];
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
    else if (c === '}') {
      depth--;
      if (depth === 0) {
        // Keep the `async` prefix: slicing from the `function` keyword alone
        // strips it, and every await in the body then fails to parse.
        const prefix = INDEX.slice(Math.max(0, at - 6), at) === 'async ' ? 'async ' : '';
        return prefix + INDEX.slice(at, j + 1);
      }
    }
  }
  throw new Error('unbalanced braces: ' + name);
}

/* ---- 1. The synthetic parent's asset states, executed ------------------- */

const ensureSrc = grabFunc('_prodEnsureAssets');
/* Only the synthetic short-circuit is under test; it returns before any
 * network path, so the rest of the function never runs in this harness. */
const runSynthetic = new Function('deps', `
  const { _prodIssue, _prodAssetState, _prodWriteTeam, _prodState, PROD_BATCH_ASSET_GUIDANCE } = deps;
  ${ensureSrc}
  return _prodEnsureAssets;
`);

function syntheticState(assetValues) {
  const assets = {};
  for (const key of ['filming_plan', 'raw_footage', 'delivery_folder', 'deliverable_file']) {
    const url = String(assetValues[key] || '').trim();
    assets[key] = { slot: key, url, state: url ? 'checking' : 'missing', checked_at: '', guidance: '' };
  }
  const state = { status: 'idle', complete: false, assets, error: '' };
  return {
    _prodIssue: () => ({ id: 'batch::node', syntheticBatchParent: true, team: 'video' }),
    _prodAssetState: () => state,
    _prodWriteTeam: t => t,
    _prodState: { assets: new Map(), writes: new Map() },
    PROD_BATCH_ASSET_GUIDANCE: 'Held on the post, not readable here. Open a sub-issue to see it.',
    state,
  };
}

/* ---- 0. The FIRST PAINT, which is what the reader actually sees ---------
 * _prodRender seeds state from _prodAssetDefaultEvidence and paints, THEN
 * calls _prodEnsureAssets -- whose synthetic branch returns without repainting.
 * So a correction made only in ensure never reaches the screen until some
 * unrelated re-render. Caught in review of this very change; the honesty has
 * to be decided at seed time, and this is the check that proves it is. */
const seedSrc = grabFunc('_prodAssetDefaultEvidence');
const seed = new Function('deps', `
  const { PROD_ASSET_SPECS, PROD_BATCH_ASSET_GUIDANCE } = deps;
  ${seedSrc}
  return _prodAssetDefaultEvidence;
`)({
  PROD_ASSET_SPECS: [
    { key: 'filming_plan', label: 'Filming plan' },
    { key: 'raw_footage', label: 'Raw footage' },
    { key: 'delivery_folder', label: 'Frame folder' },
    { key: 'deliverable_file', label: 'Deliverable file', graphicsLabel: 'Thumbnail file' },
  ],
  PROD_BATCH_ASSET_GUIDANCE: 'Held on the post, not readable here. Open a sub-issue to see it.',
});

{
  const parent = seed({ id: 'batch::node', syntheticBatchParent: true, assets: {} });
  ok(parent.filming_plan.state === 'unavailable' && parent.raw_footage.state === 'unavailable',
    'FIRST PAINT: a batch parent seeds Unavailable, so the honest state is on screen immediately');
  ok(/Open a sub-issue/.test(parent.filming_plan.guidance),
    'and the seeded guidance says where to look');
  const child = seed({ id: 'del_1', team: 'video', assets: {} });
  ok(child.filming_plan.state === 'missing' && child.filming_plan.guidance === '',
    'a REAL deliverable still seeds Missing -- empty there genuinely means absent, and the EF will resolve it');
  const withUrl = seed({ id: 'batch::node', syntheticBatchParent: true, assets: { filming_plan: 'https://docs.google.com/document/d/a/edit' } });
  ok(withUrl.filming_plan.state === 'checking',
    'a parent that CAN see a URL still seeds checking, so a future grant needs no second change');
}

(async () => {
  {
    // The shape every synthetic parent actually has: nothing readable.
    const d = syntheticState({});
    await runSynthetic(d)('batch::node');
    for (const key of ['filming_plan', 'raw_footage', 'delivery_folder']) {
      ok(d.state.assets[key].state === 'unavailable',
        `${key} on a batch parent reads Unavailable, not Missing -- the browser cannot see the column`);
      ok(/Open a sub-issue/.test(d.state.assets[key].guidance),
        `${key} says where the value can actually be seen`);
    }
    ok(d.state.status === 'ready' && d.state.complete === true,
      'the panel still settles, so nothing spins forever');
  }
  {
    // If the columns ever DO arrive (a widened grant, a real parent row), a
    // present URL must still resolve to Available -- the honesty fix must not
    // swallow a real value.
    const d = syntheticState({ filming_plan: 'https://docs.google.com/document/d/abc/edit' });
    await runSynthetic(d)('batch::node');
    ok(d.state.assets.filming_plan.state === 'available',
      'a batch parent that CAN see a link still shows it as Available');
    ok(d.state.assets.raw_footage.state === 'unavailable',
      'while its unreadable siblings stay Unavailable');
  }

  /* ---- 2. The parent drops the row it can never fill -------------------- */

  const detail = grabFunc('_prodDetail');
  ok(/_prodAssetsPanelHTML\(d, d\.syntheticBatchParent === true/.test(detail),
    'the detail view passes a slot list for a synthetic batch parent');
  const slotList = (detail.match(/slots: \[([^\]]*)\]/) || [])[1] || '';
  ok(/filming_plan/.test(slotList) && /raw_footage/.test(slotList) && /delivery_folder/.test(slotList),
    'the three post-level slots survive on the parent');
  ok(!/deliverable_file/.test(slotList),
    'and deliverable_file does NOT -- a container has no canonical artifact');
  ok(/readOnly: true/.test(detail.slice(detail.indexOf('syntheticBatchParent === true'))),
    'the parent panel is read-only, so no write control is offered against a row the gateway cannot authorize');
  ok(/_prodAssetsPanelHTML\(d, d\.syntheticBatchParent === true[\s\S]{0,200}: undefined\)/.test(detail),
    'a REAL deliverable still gets the full four-row panel (only the synthetic parent is narrowed)');

  /* ---- 3. The description Refresh button is gone, the handler is not ---- */

  ok(!/data-prod-description-control="refresh"/.test(INDEX),
    'neither description header renders a Refresh button any more');
  ok(/function _prodRefreshDescription\(/.test(INDEX),
    'but the handler survives');
  ok((INDEX.match(/onclick="return _prodRefreshDescription\(/g) || []).length === 2,
    'because the two error-banner Retry buttons are its real callers -- a failed read must stay recoverable');
  ok(/function _prodEnsureDescription\(/.test(INDEX)
    && /description_read/.test(INDEX),
    'and the read itself is untouched: brief is not in the browser grant, so this is the only way a description reaches the page');

  /* ---- 4. The invalid-link copy must name the rule the code enforces ----
   * The shipped sentence refused folders and never mentioned Frame.io, which
   * is exactly backwards: the 2026-08-16 owner ruling widened deliverable_file
   * to accept a file OR a folder, and Frame.io links resolve as folders. A
   * designer pasting the shape the team actually ships was told to go and fix
   * a link that was already valid. */
  const policy = fs.readFileSync(path.resolve(__dirname, '..', 'supabase', 'functions', 'production-write', 'policy.mjs'), 'utf8');
  const allowed = policy.slice(policy.indexOf('export function assetTypeAllowed'));
  ok(/deliverable_file"\) return kind === "file" \|\| kind === "folder"/.test(allowed)
     || /key === 'deliverable_file'\) return kind === 'file' \|\| kind === 'folder'/.test(allowed),
    'the policy really does accept a folder for deliverable_file (the rule the copy must match)');
  const copy = (INDEX.match(/if \(code === 'invalid_artifact_url'\) return '([^']*)'/) || [])[1] || '';
  ok(copy, 'the invalid_artifact_url message exists');
  ok(!/folders are not canonical/.test(copy),
    'it no longer claims folders are refused, which the policy contradicts');
  ok(/Frame\.io/.test(copy),
    'it names Frame.io, the host the team actually ships deliverables on');
  ok(/folder/.test(copy) && /Doc/.test(copy),
    'and it states the real rule: file or folder yes, a Doc no');

  /* ---- 5. A video deliverable explains itself instead of going silent ---
   * `graphics && …` suppressed the gate SENTENCE as well as the control, so a
   * video issue rendered four rows and no reason at all. That is what "I have
   * no way of editing the assets" looked like from the inside. */
  const panel = grabFunc('_prodAssetsPanelHTML');
  ok(/Attaching is available on Graphics deliverables/.test(panel),
    'a non-graphics deliverable states why the attach control is absent');
  ok(/Set the video link on the calendar card/.test(panel),
    'and names the control that does work today, so the screen is a boundary rather than a dead end');
  ok(/options\.readOnly \? '' :/.test(panel),
    'the read-only parent panel stays silent -- that sentence is about a video sub-issue, not a container');
  ok(/graphics\s*\n?\s*\? \(!writable \? _prodWriteGateText/.test(panel.replace(/\s+/g, m => m.includes('\n') ? '\n' : ' ')) || /graphics$/m.test(panel),
    'graphics deliverables keep the real per-person gate text');

  if (failures) { console.error(`\n${failures} check(s) failed.`); process.exit(1); }
  console.log('\nProduction batch-parent panel checks passed');
})();
