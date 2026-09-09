'use strict';
/*
 * OWNER REQUEST 2026-09-07, with a screenshot of the workload calendar's two
 * loose strips: "Needs assignment" was a flat wall of ~30 chips and "Needs a
 * work day or deadline" another ~25, each chip opening linear.app one
 * sub-issue at a time.
 *
 *   "if different sub-issues are below the same parent issue, then we should
 *    be able to open that parent issue. And it shouldn't open linear, it
 *    should open the sync linear one... it should be sorted by clients and
 *    then by parent issue and if not just the sub issues and people should
 *    click a button to open in sync linear so they can assign them"
 *
 * So both strips group CLIENT then PARENT ISSUE, every group carries one
 * "Open in SyncLinear" button at the parent, and the chips themselves point
 * at ?prod=1&d=<identifier> rather than Linear.
 *
 * This suite EXECUTES the renderer against a stub DOM rather than reading its
 * source, because the three things that can silently regress here -- the
 * grouping keys, the sort order, and which href each control gets -- are all
 * runtime results a source regex cannot see.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}
function extractFn(name) {
  const start = source.indexOf(`    function ${name}(`);
  if (start < 0) throw new Error('missing function: ' + name);
  let depth = 0, seen = false;
  for (let i = start; i < source.length; i++) {
    const ch = source[i];
    if (ch === '{') { depth++; seen = true; }
    else if (ch === '}') { depth--; if (seen && depth === 0) return source.slice(start, i + 1); }
  }
  throw new Error('unbalanced: ' + name);
}

/* The smallest DOM the renderer touches: two strip elements with a classList
   it toggles `empty` on, and two chip containers it writes innerHTML into. */
function makeDom() {
  const nodes = {};
  const mk = id => {
    const set = new Set();
    return (nodes[id] = {
      id, innerHTML: '',
      classList: {
        add: c => set.add(c), remove: c => set.delete(c),
        contains: c => set.has(c),
      },
      _classes: set,
    });
  };
  ['wlUnassigned', 'wlUnassignedChips', 'wlUndated', 'wlUndatedChips'].forEach(mk);
  nodes.wlUnassigned.classList.add('empty');
  nodes.wlUndated.classList.add('empty');
  return { nodes, document: { getElementById: id => nodes[id] || null } };
}

const dom = makeDom();
const sandbox = {
  document: dom.document,
  location: { pathname: '/index.html' },
  console,
  wlState: { team: 'all', editor: 'all', client: 'all', parentById: new Map() },
  wlEscape: null,
  wlTeamBucket: null,
};
vm.createContext(sandbox);
vm.runInContext(`
  function wlEscape(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function wlTeamBucket(key, name) {
    return /graph/i.test(String(key || '') + String(name || '')) ? 'graphics' : 'video';
  }
`, sandbox);
vm.runInContext([
  extractFn('wlSyncLinearUrl'),
  extractFn('wlLooseParentInfo'),
  extractFn('wlSortSubIssues'),
  extractFn('renderLooseIssueStrip'),
  'this.render = renderLooseIssueStrip; this.syncUrl = wlSyncLinearUrl;',
].join('\n'), sandbox);

ok(typeof sandbox.render === 'function', 'the renderer extracts and executes (harness is not vacuous)');

let n = 0;
const sub = extra => Object.assign({
  id: 'id' + (++n), identifier: 'VID-' + (1000 + n), title: 'Video ' + n,
  url: 'https://linear.app/synchro/issue/VID-' + (1000 + n),
  teamKey: 'VID', teamName: 'Video', assigneeId: 'a1', assigneeName: 'Editor One',
  sortOrder: n,
}, extra);

// Two clients, deliberately fed in reverse alphabetical order so a missing
// sort shows up. "zebra" carries a parent that is NOT in parentById -- the
// snapshot-absent case the identifier fallback exists for.
sandbox.wlState.parentById.set('p1', { id: 'p1', identifier: 'VID-900', title: 'January cycle', url: 'https://linear.app/synchro/issue/VID-900' });
sandbox.wlState.parentById.set('p2', { id: 'p2', identifier: 'GRA-410', title: 'Thumbnail batch', url: 'https://linear.app/synchro/issue/GRA-410' });

const ROWS = [
  sub({ clientName: 'zebra-slug', title: 'Z orphan' }),
  sub({ clientName: 'zebra-slug', parentId: 'p9', parentIdentifier: 'VID-812', title: 'Z one' }),
  sub({ clientName: 'zebra-slug', parentId: 'p9', parentIdentifier: 'VID-812', title: 'Z two' }),
  sub({ clientName: 'alpha-slug', parentId: 'p1', parentIdentifier: 'VID-900', title: 'A one' }),
  sub({ clientName: 'alpha-slug', parentId: 'p1', parentIdentifier: 'VID-900', title: 'A two' }),
  sub({ clientName: 'alpha-slug', parentId: 'p2', parentIdentifier: 'GRA-410', title: 'A thumb', teamKey: 'GRA', teamName: 'Graphics' }),
];

sandbox.render('wlUnassigned', 'wlUnassignedChips', ROWS, false);
sandbox.render('wlUndated', 'wlUndatedChips', ROWS, true);
const unassigned = dom.nodes.wlUnassignedChips.innerHTML;
const undated = dom.nodes.wlUndatedChips.innerHTML;

/* Reads the CURRENT innerHTML, not a snapshot: the filter checks below
   re-render into the same node and a captured string would quietly assert
   against the previous pass. */
const all = re => [...dom.nodes.wlUnassignedChips.innerHTML.matchAll(re)].map(m => m[1]);

ok(!dom.nodes.wlUnassigned.classList.contains('empty')
  && !dom.nodes.wlUndated.classList.contains('empty'),
'a non-empty source unhides both strips');

// ---- grouping: client, then parent -----------------------------------------
ok(JSON.stringify(all(/wl-loose-client-name">([^<]*)</g)) === JSON.stringify(['alpha-slug', 'zebra-slug']),
  'clients group into one card each, alphabetically -- not in arrival order');
ok(JSON.stringify(all(/wl-loose-client-count">(\d+)</g)) === JSON.stringify(['3', '3']),
  'each client card counts its own sub-issues');
ok(JSON.stringify(all(/wl-loose-parent-ident">([^<]*)</g)) === JSON.stringify(['GRA-410', 'VID-900', 'VID-812']),
  'inside a client the sub-issues group by parent issue, ordered by identifier');
ok((unassigned.match(/No parent issue/g) || []).length === 1,
  'sub-issues with no parent still render, in one bucket of their own');
ok(unassigned.indexOf('VID-812') < unassigned.indexOf('No parent issue'),
  'and that bucket sinks below the real parents of the same client');
ok(JSON.stringify(all(/wl-loose-parent-count">(\d+)</g)) === JSON.stringify(['1', '2', '2', '1']),
  'every group states how many sub-issues it holds');

// ---- the button the owner asked for ----------------------------------------
const openHrefs = all(/class="wl-loose-open" href="([^"]*)"/g);
ok(JSON.stringify(openHrefs) === JSON.stringify([
  '/index.html?prod=1&amp;d=GRA-410',
  '/index.html?prod=1&amp;d=VID-900',
  '/index.html?prod=1&amp;d=VID-812',
]), 'each parent group carries ONE Open-in-SyncLinear button, at ?prod=1&d=<parent identifier>');
ok((unassigned.match(/>Open in SyncLinear</g) || []).length === 3,
  'the button says where it goes');
ok(sandbox.syncUrl('') === '' && sandbox.syncUrl('  ') === '',
  'no identifier means no button rather than a link to nowhere');

// A parent absent from parentById still deep-links, because the sub-issue
// carries parentIdentifier of its own. Only the title and the Linear escape
// hatch degrade.
ok(openHrefs.includes('/index.html?prod=1&amp;d=VID-812'),
  'a parent missing from this snapshot is still openable via the sub-issue own parentIdentifier');
ok(!/wl-loose-open-linear[^>]*VID-812/.test(unassigned),
  'and it honestly offers no Linear link, having no parent URL to offer');
ok((unassigned.match(/wl-loose-open-linear/g) || []).length === 2,
  'the parents we do hold keep Linear one small click away as a secondary link');

// ---- chips point at SyncLinear, not Linear ---------------------------------
const chipHrefs = all(/class="workload-chip" href="([^"]*)"/g);
ok(chipHrefs.length === 6 && chipHrefs.every(h => h.startsWith('/index.html?prod=1&amp;d=VID-')),
  'every chip opens its own SyncLinear row');
ok(!chipHrefs.some(h => h.includes('linear.app')),
  'no chip opens linear.app as its main click -- the whole point of the request');
ok((unassigned.match(/class="workload-chip-linear"/g) || []).length === 6,
  'a per-chip Linear icon keeps the source of truth reachable');

// ---- the strips carry chips and nothing else -------------------------------
/* The undated strip used to pair every chip with a "Set work day" button.
   Owner pulled it on 2026-09-07, and ~25 buttons is most of what made the
   block compact -- so this is asserted, not merely absent by accident. */
ok(!/workload-loose-plan/.test(unassigned) && !/workload-loose-plan/.test(undated),
  'neither strip renders a "Set work day" button any more');
ok(!/data-wl-issue-open/.test(unassigned) && !/data-wl-issue-open/.test(undated),
  'and neither opens the plan popover from a chip row, which is what that button did');
ok(source.includes("data-wl-issue-open") && source.includes('function wlSetPlanDate('),
  'the popover path itself is untouched and still reached from the calendar -- restoring the button is a render, not a rebuild');
ok(JSON.stringify([...undated.matchAll(/wl-loose-client-name">([^<]*)</g)].map(m => m[1]))
  === JSON.stringify(['alpha-slug', 'zebra-slug']),
'the undated strip groups identically to the unassigned one');

// ---- filters still apply BEFORE grouping -----------------------------------
sandbox.wlState.client = 'alpha-slug';
sandbox.render('wlUnassigned', 'wlUnassignedChips', ROWS, false);
ok(JSON.stringify(all(/wl-loose-client-name">([^<]*)</g)) === JSON.stringify(['alpha-slug']),
  'the client filter narrows the strip to one card');
sandbox.wlState.client = 'all';
sandbox.wlState.team = 'graphics';
sandbox.render('wlUnassigned', 'wlUnassignedChips', ROWS, false);
ok(JSON.stringify(all(/wl-loose-parent-ident">([^<]*)</g)) === JSON.stringify(['GRA-410']),
  'the team filter drops whole groups rather than leaving an empty header');
sandbox.wlState.team = 'all';
sandbox.wlState.editor = 'nobody';
sandbox.render('wlUndated', 'wlUndatedChips', ROWS, true);
ok(dom.nodes.wlUndated.classList.contains('empty') && dom.nodes.wlUndatedChips.innerHTML === '',
  'an editor filter that matches nothing re-hides the undated strip, which applies that filter');
sandbox.render('wlUnassigned', 'wlUnassignedChips', ROWS, false);
ok(!dom.nodes.wlUnassigned.classList.contains('empty'),
  'while the unassigned strip ignores the editor filter -- these rows have no editor yet');

// ---- escaping survived the restructure -------------------------------------
sandbox.wlState.editor = 'all';
sandbox.render('wlUnassigned', 'wlUnassignedChips', [
  sub({ clientName: '<img src=x>', title: '"><script>alert(1)</script>' }),
], false);
ok(!/<script>/.test(dom.nodes.wlUnassignedChips.innerHTML)
  && !/<img src=x>/.test(dom.nodes.wlUnassignedChips.innerHTML),
'client names and titles are still escaped in the new group headers and chips');

sandbox.render('wlUnassigned', 'wlUnassignedChips', [
  sub({id:'native-video-1', nativeId:'native-video-1', workloadSource:'native',
    parentId:'native-batch-1', parentIdentifier:'Repeated name', identifier:'Repeated name', url:''}),
], false);
const nativeMarkup = dom.nodes.wlUnassignedChips.innerHTML;
ok(nativeMarkup.includes('/index.html?prod=1&amp;batch=native-batch-1'),
  'native loose-group parent uses the batch identity and batch route, not its display name');
ok(nativeMarkup.includes('/index.html?prod=1&amp;d=native-video-1'),
  'native loose-strip chip uses its exact deliverable identity');

if (failures) { console.error(`\n${failures} check(s) failed.`); process.exit(1); }
console.log('\nWorkload loose-strip client/parent grouping checks passed.');
