'use strict';
/*
 * Urgent editor assignee lookup, Linear-exit slice (LINEAR_EXIT_EXECUTION_MAP.md
 * row "Urgent editor assignee lookup" / LINEAR_EXIT_PREPARATION_CHECKPOINT_20260914.md
 * "the lookup is the part that has to be accepted or rerouted, not the link").
 *
 * HISTORY. `_calRefreshParentLinkFlags` used to fetch the "incomplete
 * sub-issue" banner's project/due/editor meta from the `linear-issue-statuses`
 * n8n webhook on every foreground and tab-return calendar load. An earlier
 * version of this suite proved the batch EXCLUDED a SyncView-authoritative
 * (sealed) team's idents, because both readers -- `_calLinearMissingForCard`
 * and `_calIsParentLinked` -- discard a sealed component's ident anyway
 * (OPEN_REPAIRS 62, test/cal-linear-missing-banner-seal.js).
 *
 * WHAT IT PROVES NOW. That webhook is revoked on 2026-09-27 and the fetch was
 * removed outright on 2026-09-22 (OPEN_REPAIRS 236). The exclusion this suite
 * used to prove is therefore subsumed by a stronger property, and that is what
 * is asserted here: the shipped function issues ZERO network requests in EVERY
 * authority world -- both lanes sealed, one sealed, none sealed, and the
 * rollback world where authority reverts to Linear -- while still hydrating
 * the persisted banner meta so the banners keep rendering from localStorage.
 *
 * The suite deliberately still EXECUTES the shipped function (sliced out of
 * index.html, not reimplemented), per FLIP_BUG_LEDGER 4-2: a source-scanning
 * suite cannot tell a live gate from a dead one, and cannot tell a removed
 * fetch from one that merely moved.
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { extractFunction } = require('./helpers/extract-function');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

const source = [
  extractFunction(html, '_writeUiTeam'),
  extractFunction(html, '_writeUiAuthoritySnapshot'),
  extractFunction(html, '_writeUiLinkSlotSealed'),
  extractFunction(html, '_calIdentFromUrl'),
  'async ' + extractFunction(html, '_calRefreshParentLinkFlags'),
].join('\n');

function world() {
  const requests = [];
  let hydrated = 0;
  const ctx = {
    console, JSON, Array, Set, Map, Date, String,
    _calLinearMetaByIdent: new Map(),
    _calParentLinks: new Set(),
    _writeUiAuthorityLive: null,
    calState: { posts: [] },
    _calLoadRunCurrent: () => true,
    _calHydrateLinearMeta: () => { hydrated++; },
    _calPersistLinearMeta: () => {},
    _calIsCalBusy: () => true, // keeps the render branch out of this suite's scope
    _calRenderBody: () => {},
    // Any call at all is a failure now: there is no endpoint left to ask.
    fetch: async (url, opts) => {
      requests.push({ url, body: opts && opts.body ? JSON.parse(opts.body) : null });
      return { json: async () => ({ ok: true, meta: {} }) };
    },
  };
  vm.createContext(ctx);
  vm.runInContext(source, ctx);
  return { ctx, requests, hydratedCount: () => hydrated };
}

const VID = (n) => `https://linear.app/synchro-social/issue/VID-${n}/x`;
const GRA = (n) => `https://linear.app/synchro-social/issue/GRA-${n}/x`;

let failures = 0;
function check(label, got, want) {
  const pass = JSON.stringify(got) === JSON.stringify(want);
  if (pass) console.log('PASS ' + label);
  else { failures++; console.error('FAIL ' + label + '  got=' + JSON.stringify(got) + '  want=' + JSON.stringify(want)); }
}

/* Each case is one of the authority worlds the removed fetch used to branch
   on. The expectation is now identical in all of them, which is the point:
   there is no authority state, and no rollback, that brings the Linear call
   back -- only restoring the endpoint and the code would. */
const WORLDS = [
  { label: 'no live authority read yet (the old fail-open case)', authority: null,
    posts: [{ linear_issue_id: VID(1), graphic_linear_issue_id: GRA(1) }] },
  { label: 'video sealed, graphics still on Linear', authority: { video: 'syncview', graphics: 'linear' },
    posts: [{ linear_issue_id: VID(2), graphic_linear_issue_id: GRA(2) }] },
  { label: 'both lanes sealed (today’s production state)', authority: { video: 'syncview', graphics: 'syncview' },
    posts: [{ linear_issue_id: VID(3), graphic_linear_issue_id: GRA(3) }] },
  { label: 'rolled back: both lanes on Linear again', authority: { video: 'linear', graphics: 'linear' },
    posts: [{ linear_issue_id: VID(4), graphic_linear_issue_id: '' }] },
  { label: 'several cards, mixed authority', authority: { video: 'syncview', graphics: 'linear' },
    posts: [
      { linear_issue_id: VID(5), graphic_linear_issue_id: GRA(5) },
      { linear_issue_id: VID(6), graphic_linear_issue_id: GRA(6) },
    ] },
];

(async () => {
  for (const { label, authority, posts } of WORLDS) {
    // force=true is the tab-return path -- the one that used to bypass the
    // signature throttle and guarantee a request. It must be silent too.
    const w = world();
    w.ctx._writeUiAuthorityLive = authority;
    w.ctx.calState.posts = posts;
    await w.ctx._calRefreshParentLinkFlags({}, true);
    check('zero network requests — ' + label, w.requests.length, 0);
    check('persisted banner meta still hydrated — ' + label, w.hydratedCount(), 1);
  }

  // The endpoint must be gone from the shipped bundle, not merely unreachable
  // from this one function: a second caller would put the executions straight
  // back on the bill.
  check('no linear-issue-statuses request URL survives anywhere in index.html',
    /['"`][^'"`]*webhook\/linear-issue-statuses/.test(html), false);

  if (failures) { console.error(`\n${failures} check(s) failed.`); process.exit(1); }
  console.log('\ncal linear status-meta fetch-removal checks passed');
})();
