'use strict';
/*
 * Pasting a Linear link used to BE the write. Now, for a SyncView-authoritative
 * component, it is how a card gets permanently broken.
 *
 * `_writeUiGatewayPost` takes the legacy-parity lane while a team is
 * LINEAR-authoritative -- the URL is the write target, so pasting one connects
 * the card and the slot is correct. After that team flips to SYNCVIEW the write
 * needs `intent.nativeId`, the paste still writes only the URL column, and
 * `makePayload` throws `native_link_required` on every status change from then
 * on. Measured on 2026-08-25: of 352 graphic `link_set` events in the nine days
 * after the graphics flip, three left a real card half-linked, and one of them
 * was pasted at 23:22 by the SMM who reported the bug the next morning.
 *
 * Owner ruling, same day: "can we make it so people cannot paste a link
 * anymore? Because I don't think we would need to do that anymore."
 *
 * This suite EXECUTES the shipped seal against a stubbed authority read. What
 * it pins is the four judgements the seal has to get right, because three of
 * them are ways a well-meaning seal breaks something else:
 *   - a LINEAR-authoritative component must stay fully editable (video is, and
 *     sealing it would break the only lane that still works);
 *   - CLEARING an existing link must stay possible (it is the repair);
 *   - the render gate fails OPEN and the commit gate fails CLOSED, so a slow
 *     first paint never hides a working control and a flag outage never lets a
 *     paste through;
 *   - and the seal keys on AUTHORITY, so it needs no edit when video flips.
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

/* Slice the real declarations out of the page and run them. Not a source scan:
   the functions under test are the shipped bytes, and a rename breaks the slice
   loudly instead of passing vacuously. */
const src = fs.readFileSync(PAGE, 'utf8');
const start = src.indexOf('    let _writeUiAuthorityLive = null;');
const end = src.indexOf('    function _writeUiSourceClientSlug(', start);
if (start < 0 || end < 0) throw new Error('could not slice the write-UI authority block from index.html');

let fetchImpl = async () => { throw new Error('no stub installed'); };
const sandbox = new Function('fetchRef', `
  const WRITE_UI_AUTHORITY_URL = 'about:authority';
  const CAL_SUPABASE_ANON_KEY = 'anon';
  const fetch = (...args) => fetchRef.impl(...args);
  ${src.slice(start, end)}
  return { _writeUiAuthoritySnapshot, _writeUiRefreshAuthority, _writeUiTeam,
           _writeUiLinkSlotSealed, _writeUiLinkSlotSealedLive, _writeUiLinkSlotSealedNotice };
`)({ get impl() { return fetchImpl; } });

const ui = sandbox;
ok(typeof ui._writeUiLinkSlotSealed === 'function' && typeof ui._writeUiLinkSlotSealedLive === 'function',
  'the shipped seal loads and runs (harness is not vacuous)');

function serveAuthority(value) {
  fetchImpl = async () => ({ ok: true, json: async () => [{ value }] });
}
function failAuthority() {
  fetchImpl = async () => { throw new Error('offline'); };
}

/* The live production shape on the day this shipped. */
const LIVE = { video: 'linear', graphics: 'syncview' };

(async () => {
  /* 1. Render gate fails OPEN before any authority has been read. A control
   *    hidden during first paint is a worse lie than one the commit gate then
   *    refuses out loud. */
  ok(ui._writeUiAuthoritySnapshot() === null, 'no authority has been read yet');
  ok(ui._writeUiLinkSlotSealed('graphic') === false && ui._writeUiLinkSlotSealed('video') === false,
    'the render gate fails OPEN while authority is unknown');

  /* 2. With the live flag loaded, graphics is sealed and video is NOT. Sealing
   *    video would break the one lane where the URL really is the write
   *    target. */
  serveAuthority(LIVE);
  ok((await ui._writeUiRefreshAuthority()) !== null, 'the stubbed authority read lands');
  ok(ui._writeUiLinkSlotSealed('graphic') === true, 'a SyncView-authoritative component is sealed');
  ok(ui._writeUiLinkSlotSealed('video') === false, 'a Linear-authoritative component stays editable');

  const graphicLive = await ui._writeUiLinkSlotSealedLive('graphic');
  const videoLive = await ui._writeUiLinkSlotSealedLive('video');
  ok(graphicLive.sealed === true && graphicLive.reason === 'syncview_authoritative',
    'the live gate seals graphics and says why');
  ok(videoLive.sealed === false, 'the live gate leaves video open');

  /* 3. Keyed on AUTHORITY, not on the word "graphics". When video flips this
   *    needs no edit -- and graphics coming BACK to Linear must unseal. */
  serveAuthority({ video: 'syncview', graphics: 'syncview' });
  await ui._writeUiRefreshAuthority();
  ok(ui._writeUiLinkSlotSealed('video') === true,
    'video seals by itself the moment its own team flips, with no code change');

  serveAuthority({ video: 'linear', graphics: 'linear' });
  await ui._writeUiRefreshAuthority();
  ok(ui._writeUiLinkSlotSealed('graphic') === false && ui._writeUiLinkSlotSealed('video') === false,
    'a rollback to Linear authority unseals both, so the seal is not a one-way door');

  /* 4. Commit gate fails CLOSED on an unreadable flag -- the same answer
   *    `_writeUiGatewayPost` gives with `authority_unavailable`. Letting one
   *    paste through an outage mints a card that stays broken for weeks;
   *    refusing one is visible and recoverable in a minute. */
  failAuthority();
  const blind = await ui._writeUiLinkSlotSealedLive('video');
  ok(blind.sealed === true && blind.reason === 'authority_unavailable',
    'the live gate fails CLOSED when authority cannot be read, and names that reason');
  ok(ui._writeUiLinkSlotSealed('video') === false,
    'while the render gate still fails OPEN on the same unreadable flag');

  /* 5. The two refusals read differently, because they ask for different
   *    things: one is permanent and explains where the work lives, the other
   *    is transient and says try again. */
  const sealedText = ui._writeUiLinkSlotSealedNotice('graphic', 'syncview_authoritative');
  const outageText = ui._writeUiLinkSlotSealedNotice('graphic', 'authority_unavailable');
  ok(Array.isArray(sealedText) && sealedText.length === 2 && Array.isArray(outageText),
    'both notices are a [title, body] pair');
  ok(/SyncView/.test(sealedText[1]) && /clear a link/i.test(sealedText[1]),
    'the permanent refusal says where the work lives AND that clearing still works');
  ok(/try again/i.test(outageText[1]) && !/SyncView/.test(outageText[1]),
    'the outage refusal asks for a retry instead of explaining a rule that may not apply');
  ok(sealedText[0] !== outageText[0], 'the two refusals do not share a title');

  /* 6. Component naming matches `_writeUiTeam`, so the seal and the write agree
   *    on which team a slot belongs to. */
  ok(ui._writeUiTeam('graphic') === 'graphics' && ui._writeUiTeam('video') === 'video',
    'the seal reads the same component-to-team mapping the gateway writes with');

  if (failures) { console.error('\nwrite-UI link slot seal checks FAILED: ' + failures); process.exit(1); }
  console.log('\nwrite UI link slot seal checks passed');
})().catch(error => { console.error('write-ui-link-slot-seal threw: ' + (error && error.stack || error)); process.exit(1); });
