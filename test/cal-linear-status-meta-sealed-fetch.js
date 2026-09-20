'use strict';
/*
 * Urgent editor assignee lookup, Linear-exit slice (LINEAR_EXIT_EXECUTION_MAP.md
 * row "Urgent editor assignee lookup" / LINEAR_EXIT_PREPARATION_CHECKPOINT_20260914.md
 * "Legacy urgent editor assignee lookup"): "the lookup is the part that has to
 * be accepted or rerouted, not the link."
 *
 * `_calLinearMissingForCard` (the "incomplete sub-issue" banner, which names
 * a missing editor among project/due date) and `_calIsParentLinked` (the
 * "parent issue linked" banner) both already discard a SEALED component's
 * ident before ever reading `_calLinearMetaByIdent` / `_calParentLinks` --
 * see OPEN_REPAIRS 62 and test/cal-linear-missing-banner-seal.js. Once a
 * team is SyncView-authoritative, `_calRefreshParentLinkFlags` was still
 * asking the `linear-issue-statuses` n8n webhook for that ident's
 * project/due/editor meta anyway -- a real Linear-lookup network call whose
 * answer is GUARANTEED to be discarded by both readers.
 *
 * This proves the fetch itself now excludes a sealed team's idents (pure
 * dependency reduction: same readers, same output, fewer Linear calls),
 * while an unsealed team's idents -- and every ident before the first live
 * authority read lands -- are fetched exactly as before.
 *
 * This suite EXECUTES the shipped function (sliced out of index.html, not
 * reimplemented) against a mocked fetch, per FLIP_BUG_LEDGER 4-2 / the same
 * reasoning cal-linear-missing-banner-seal.js documents: a source-scanning
 * suite cannot tell a live gate from a dead one.
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
  const ctx = {
    console, JSON, Array, Set, Map, Date, String,
    LINEAR_STATUSES_URL: 'https://n8n.invalid/webhook/linear-issue-statuses',
    CAL_LINEAR_META_FORCE_MIN_MS: 5 * 60 * 1000,
    _calStatusMetaUnsupported: false,
    _calLinearStatusMetaSig: '',
    _calLinearStatusMetaAt: 0,
    _calLinearMetaByIdent: new Map(),
    _calParentLinks: new Set(),
    _writeUiAuthorityLive: null,
    calState: { posts: [] },
    _calLoadRunCurrent: () => true,
    _calHydrateLinearMeta: () => {},
    _calPersistLinearMeta: () => {},
    _calIsCalBusy: () => true, // keeps the render branch out of this suite's scope
    _calRenderBody: () => {},
    fetch: async (url, opts) => {
      requests.push({ url, body: JSON.parse(opts.body) });
      return { json: async () => ({ ok: true, meta: {} }) };
    },
  };
  vm.createContext(ctx);
  vm.runInContext(source, ctx);
  return { ctx, requests };
}

const VID = (n) => `https://linear.app/synchro-social/issue/VID-${n}/x`;
const GRA = (n) => `https://linear.app/synchro-social/issue/GRA-${n}/x`;

let failures = 0;
function check(label, got, want) {
  const pass = JSON.stringify(got) === JSON.stringify(want);
  if (pass) console.log('PASS ' + label);
  else { failures++; console.error('FAIL ' + label + '  got=' + JSON.stringify(got) + '  want=' + JSON.stringify(want)); }
}

(async () => {
  // 1. No live authority read has landed yet: _writeUiLinkSlotSealed fails
  //    OPEN (same as the renderer), so every linked ident is still asked
  //    about -- unchanged from today's behavior.
  {
    const w = world();
    w.ctx.calState.posts = [{ linear_issue_id: VID(1), graphic_linear_issue_id: GRA(1) }];
    await w.ctx._calRefreshParentLinkFlags({}, true);
    check('unknown authority: both idents still fetched (fail-open, unchanged behavior)',
      w.requests[0] && w.requests[0].body.issues.slice().sort(), ['GRA-1', 'VID-1']);
  }

  // 2. Video sealed (SyncView-authoritative), graphics still on Linear: the
  //    sealed ident drops out of the batch; the unsealed one is untouched.
  {
    const w = world();
    w.ctx._writeUiAuthorityLive = { video: 'syncview', graphics: 'linear' };
    w.ctx.calState.posts = [{ linear_issue_id: VID(2), graphic_linear_issue_id: GRA(2) }];
    await w.ctx._calRefreshParentLinkFlags({}, true);
    check('sealed video ident excluded, unsealed graphic ident kept',
      w.requests[0] && w.requests[0].body.issues, ['GRA-2']);
  }

  // 3. Both teams sealed: the idents set is empty and the function returns
  //    before ever calling fetch -- zero Linear requests, not merely an
  //    ignored reply.
  {
    const w = world();
    w.ctx._writeUiAuthorityLive = { video: 'syncview', graphics: 'syncview' };
    w.ctx.calState.posts = [{ linear_issue_id: VID(3), graphic_linear_issue_id: GRA(3) }];
    await w.ctx._calRefreshParentLinkFlags({}, true);
    check('both teams sealed: zero Linear requests issued', w.requests.length, 0);
  }

  // 4. Rollback: authority reverts to Linear and the ident is fetched again
  //    with no code change -- the same guarantee
  //    cal-linear-missing-banner-seal.js proves for the reader side, proved
  //    here for the fetch that feeds it.
  {
    const w = world();
    w.ctx._writeUiAuthorityLive = { video: 'linear', graphics: 'linear' };
    w.ctx.calState.posts = [{ linear_issue_id: VID(4), graphic_linear_issue_id: '' }];
    await w.ctx._calRefreshParentLinkFlags({}, true);
    check('rolled-back authority restores the fetch with no code change',
      w.requests[0] && w.requests[0].body.issues, ['VID-4']);
  }

  // 5. Mixed cards across several posts: only the sealed team's idents are
  //    dropped, batch-wide, not just for one card.
  {
    const w = world();
    w.ctx._writeUiAuthorityLive = { video: 'syncview', graphics: 'linear' };
    w.ctx.calState.posts = [
      { linear_issue_id: VID(5), graphic_linear_issue_id: GRA(5) },
      { linear_issue_id: VID(6), graphic_linear_issue_id: GRA(6) },
    ];
    await w.ctx._calRefreshParentLinkFlags({}, true);
    check('sealed team excluded across every card in the batch, not just one',
      w.requests[0] && w.requests[0].body.issues.slice().sort(), ['GRA-5', 'GRA-6']);
  }

  if (failures) { console.error(`\n${failures} check(s) failed.`); process.exit(1); }
  console.log('\ncal linear status-meta sealed-fetch checks passed');
})();
