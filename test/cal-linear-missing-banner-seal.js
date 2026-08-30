'use strict';
/*
 * OPEN_REPAIRS item 62 — the missing-metadata banner outlived its own premise.
 *
 * A calendar card whose linked Linear sub-issue lacks a project, due date or
 * editor shows an orange banner, and clicking it opens that Linear issue "so
 * the SMM can fill the gap". That instruction was true while the team was
 * LINEAR-authoritative. After the team flips it is worse than useless: the edit
 * it asks for is detect-only on a SyncView-authoritative team and is silently
 * discarded, and the due date it names is read natively now, so a blank on the
 * Linear side is not even the field that matters.
 *
 * The banner rendered one line BELOW the parent-linked banner, which was
 * correctly gated on the seal in the same change. This one was not -- the same
 * render block, written at the same time, treated the two cases differently.
 * Measured 2026-08-30, hours after F1(video): of the live non-TEST cards
 * carrying a link, three video sub-issues reported a missing due date and would
 * have shown this banner to whoever opened the calendar.
 *
 * This suite SLICES AND EXECUTES the shipped functions rather than scanning for
 * the gate, because the failure this file exists to catch is a gate that is
 * present in source and not reached at runtime (FLIP_BUG_LEDGER 4-2: three bugs
 * in four days passed a source-scanning suite while the code was dead).
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PAGE = path.join(ROOT, 'index.html');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

const src = fs.readFileSync(PAGE, 'utf8');

/* Two real slices, in dependency order: the authority block defines the seal
   and the identifier filter the calendar block calls. A rename breaks the slice
   loudly instead of letting this suite pass vacuously. */
const aStart = src.indexOf('    let _writeUiAuthorityLive = null;');
const aEnd = src.indexOf('    function _writeUiSourceClientSlug(', aStart);
const cStart = src.indexOf('    const _calParentLinks = new Set();');
const cEnd = src.indexOf('    async function _calFetchDeliverableLinkRows(', cStart);
if (aStart < 0 || aEnd < 0 || cStart < 0 || cEnd < 0) {
  throw new Error('could not slice the authority + calendar-meta blocks from index.html');
}

let fetchImpl = async () => { throw new Error('no stub installed'); };
const store = new Map();
const sandbox = new Function('fetchRef', 'lsRef', `
  const WRITE_UI_AUTHORITY_URL = 'about:authority';
  const CAL_SUPABASE_ANON_KEY = 'anon';
  const fetch = (...args) => fetchRef.impl(...args);
  const localStorage = lsRef;
  ${src.slice(aStart, aEnd)}
  ${src.slice(cStart, cEnd)}
  return { _writeUiRefreshAuthority, _writeUiLinkSlotSealed,
           _calLinearMissingForCard, _calIsParentLinked, _calIdentFromUrl,
           _calParentLinks, _calLinearMetaByIdent };
`)(
  { get impl() { return fetchImpl; } },
  { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, v) }
);

const ui = sandbox;
ok(typeof ui._calLinearMissingForCard === 'function' && typeof ui._writeUiLinkSlotSealed === 'function',
  'the shipped banner + seal load and run (harness is not vacuous)');

function serveAuthority(value) {
  fetchImpl = async () => ({ ok: true, json: async () => [{ value }] });
}

const VID = 'https://linear.app/synchro-social/issue/VID-99001/x';
const GRA = 'https://linear.app/synchro-social/issue/GRA-99001/x';
const INCOMPLETE = { hasProject: false, hasDue: false, hasEditor: false };

function seedMeta() {
  ui._calLinearMetaByIdent.set('VID-99001', { ...INCOMPLETE });
  ui._calLinearMetaByIdent.set('GRA-99001', { ...INCOMPLETE });
}

(async () => {
  /* 1. The MIXED world this banner was written for. Video on Linear: pasting or
   *    filling the gap in Linear really is the write, so the banner is correct
   *    and must still appear. Sealing it here would remove a working nudge. */
  serveAuthority({ video: 'linear', graphics: 'syncview' });
  await ui._writeUiRefreshAuthority();
  seedMeta();
  const mixedVideo = ui._calLinearMissingForCard({ linear_issue_id: VID, graphic_linear_issue_id: '' });
  ok(mixedVideo && mixedVideo.comp === 'video' && mixedVideo.missing.length === 3,
    'a LINEAR-authoritative component still shows the banner, with every missing field named');

  const mixedGraphic = ui._calLinearMissingForCard({ linear_issue_id: '', graphic_linear_issue_id: GRA });
  ok(mixedGraphic === null,
    'a SyncView-authoritative component drops out, even while the other team is still on Linear');

  /* 2. TODAY. Both teams flipped: neither half may ask anyone to go and edit
   *    Linear, because that edit is detect-only and lands nowhere. */
  serveAuthority({ video: 'syncview', graphics: 'syncview' });
  await ui._writeUiRefreshAuthority();
  seedMeta();
  ok(ui._writeUiLinkSlotSealed('video') === true && ui._writeUiLinkSlotSealed('graphic') === true,
    'both components are sealed once both teams are SyncView-authoritative');
  ok(ui._calLinearMissingForCard({ linear_issue_id: VID, graphic_linear_issue_id: '' }) === null,
    'the video half shows NO banner post-flip');
  ok(ui._calLinearMissingForCard({ linear_issue_id: '', graphic_linear_issue_id: GRA }) === null,
    'the graphic half shows NO banner post-flip');
  ok(ui._calLinearMissingForCard({ linear_issue_id: VID, graphic_linear_issue_id: GRA }) === null,
    'a card carrying BOTH links shows nothing -- video precedence does not smuggle one back in');

  /* 3. The gate keys on AUTHORITY, not on the word video. A rollback has to
   *    restore the banner with no code edit, or the rollback is not a rollback.
   *    This is the assertion that fails if someone "simplifies" the gate into a
   *    team-name check. */
  serveAuthority({ video: 'linear', graphics: 'linear' });
  await ui._writeUiRefreshAuthority();
  seedMeta();
  const rolledBack = ui._calLinearMissingForCard({ linear_issue_id: VID, graphic_linear_issue_id: '' });
  ok(rolledBack && rolledBack.comp === 'video',
    'rolling authority back to Linear restores the banner with no code change');

  /* 4. The banner must not swallow the case it was actually built for. With
   *    complete metadata there is nothing to report, flipped or not -- so a
   *    passing suite above cannot be explained by the function simply always
   *    returning null. */
  serveAuthority({ video: 'linear', graphics: 'linear' });
  await ui._writeUiRefreshAuthority();
  ui._calLinearMetaByIdent.set('VID-99001', { hasProject: true, hasDue: true, hasEditor: true });
  ok(ui._calLinearMissingForCard({ linear_issue_id: VID, graphic_linear_issue_id: '' }) === null,
    'a complete sub-issue reports nothing, so the checks above are not vacuously null');

  if (failures) { console.error(`\n${failures} check(s) failed.`); process.exit(1); }
  console.log('\ncal linear missing-banner seal checks passed');
})();
