'use strict';
/*
 * Site assurance, cycle 2 (2026-10-08), second half: the candidates batch 4
 * left unverified, each checked in the code (and against live counts where
 * that settled it) before it was fixed. OPEN_REPAIRS 383 has the stories.
 * Each block lifts the real function and runs it against stand-ins; where a
 * function needs half the page to run, the block reads its code and says so.
 */
const fs = require('fs');
const path = require('path');
const { extractFunction, stripNonCode } = require('./helpers/extract-function.js');

let failures = 0;
function ok(cond, label) {
  if (cond) console.log('  ok  ' + label);
  else { console.log('FAIL  ' + label); failures++; }
}
const INDEX = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
const lift = name => extractFunction(INDEX, name);
const liftAsync = name => 'async ' + lift(name);
const code = name => stripNonCode(lift(name));

let finished = false;
process.on('exit', c => { if (!finished && c === 0) { console.log('FAIL  the suite stopped before its last check'); process.exitCode = 1; } });

(async () => {
  // --- 1. Kasper urgent ping: the "sent" marker goes to the card's own client -------
  try {
    for (const [surface, fn, stateName, persistName] of [
      ['Calendar', '_calSendKasperUrgentSlack', 'calState', '_calPersistKasperUrgentForPost'],
      ['Samples', '_sxrSendKasperUrgentSlack', 'sxrState', '_sxrPersistKasperUrgentForPost']]) {
      const env = { persistedFor: [], preflightFor: [], opts: null };
      const state = { client: 'Alpha', posts: [{ id: 'p1', name: 'Card', linear_issue_id: '' }] };
      await new Function('env', 'state', `
        const ${stateName} = state;
        const _kasperUrgentPingOnLive = async () => true;
        const showNotify = () => {};
        const _urgentKind = () => ({ alreadySent: '' });
        const _calKasperUrgentPingComp = () => 'video', _sxrKasperUrgentPingComp = () => 'video';
        const _calKasperReviewUrl = () => 'https://example.invalid/';
        const ${persistName} = (client, post, comp, ping) => { env.persistedFor.push(client); };
        const _calAssertSavingOn = client => { env.preflightFor.push(client); }, _sxrAssertSavingOn = client => { env.preflightFor.push(client); };
        const _calUrgentSlackDispatch = (btn, issue, client, name, opts) => { env.opts = opts; env.dispatchClient = client; };
        ${liftAsync(fn)}
        return ${fn}(null, 'p1');
      `)(env, state);
      state.client = 'Beta';                       // the person switches client while the ping is out
      env.opts.preflight(); env.opts.persist({});
      ok(env.dispatchClient === 'Alpha' && env.persistedFor.join() === 'Alpha' && env.preflightFor.join() === 'Alpha',
        surface + ': a Kasper urgent ping saves its "sent" marker under the card\'s own client after a client switch');
    }
  } catch (e) { ok(false, 'this block could not run: ' + String(e && e.message || e).slice(0, 120)); }

  // --- 2. Today: "Open card" on a work-item row asks for the card by id ----------------
  try {
    const run = row => {
      const env = { focus: [], nav: [], address: [], viaWorkItem: [] };
      new Function('env', 'row', `
        const tdyState = { data: { posts: [], open: [row], names: { fixtureclient: 'Fixture Client' } } };
        const svSharedClientNote = () => {};
        const _calSetFocusRequest = req => env.focus.push(req);
        const navTo = where => env.nav.push(where);
        const _tdyCardInAddress = (slug, id) => env.address.push(slug + '/' + id);
        const wlOpenInContentCalendar = (name, x, id) => env.viaWorkItem.push(id);
        ${lift('_tdyOpenCard')}
        _tdyOpenCard('del', row.id);
      `)(env, row);
      return env;
    };
    const withCard = run({ id: 'd1', client_slug: 'fixtureclient', card_id: 'p_card_1' });
    ok(withCard.focus.length === 1 && withCard.focus[0].cardId === 'p_card_1' && withCard.focus[0].client === 'Fixture Client',
      'Today: a work item that knows its card opens it by card id (which gets it past a saved filter)');
    ok(withCard.address.join() === 'fixtureclient/p_card_1' && withCard.viaWorkItem.length === 0, 'Today: and the address carries the card');
    const without = run({ id: 'd2', client_slug: 'fixtureclient', card_id: null });
    ok(without.viaWorkItem.join() === 'd2' && without.focus.length === 0, 'Today: a work item with no card still opens the old way');
  } catch (e) { ok(false, 'this block could not run: ' + String(e && e.message || e).slice(0, 120)); }

  // --- 3. Today Walk-through keeps its place by post (read from the code) -------------
  try {
    const smm = code('_tdySmmHtml');
    ok(/list\.findIndex\(x => x\.id === tdyState\.walkId\)/.test(smm) && /tdyState\.walkId = list\[i\]\.id/.test(smm),
      'Today: the Walk-through finds its post by id on every render');
    const next = new Function(`
      const tdyState = { walk: 2, walkId: 'p3' }; const _tdyPaint = () => {};
      ${lift('_tdyWalkNext')}
      _tdyWalkNext(); return tdyState;
    `)();
    ok(next.walk === 3 && next.walkId === '', 'Today: Skip moves on by position and lets the next render name the new post');
  } catch (e) { ok(false, 'this block could not run: ' + String(e && e.message || e).slice(0, 120)); }

  // --- 4. "Open in Sheet" and "Edit in Organizer" take the normal road to the Sheet ---
  try {
    const run = (fn, view) => {
      const env = { changed: [], renders: 0 };
      const state = { view, focusPid: null };
      new Function('env', 'calState', `
        const onCalViewChange = v => { env.changed.push(v); calState.view = v; };
        const _calRenderBody = () => { env.renders++; };
        const closeCalPreview = () => {};
        const setTimeout = () => 0;
        const document = { querySelector: () => null, querySelectorAll: () => [], getElementById: () => null };
        ${lift(fn)}
        ${fn}('p9');
      `)(env, state);
      return { env, state };
    };
    for (const fn of ['_calReviewOpenInSheet', 'editInOrganizerFromPreview']) {
      const away = run(fn, 'month');
      ok(away.env.changed.join() === 'organizer', fn + ': from another view it switches through onCalViewChange (Organize menu, Select and zoom come back)');
      ok(away.state.focusPid === 'p9', fn + ': and focuses the card, so a saved filter cannot hide it');
      const there = run(fn, 'organizer');
      ok(there.env.changed.length === 0 && there.env.renders === 1 && there.state.focusPid === 'p9', fn + ': already on the Sheet it just re-renders with the card focused');
    }
  } catch (e) { ok(false, 'this block could not run: ' + String(e && e.message || e).slice(0, 120)); }

  // --- 5. A cancelled drag puts the strip back (read from the code) -------------------
  try {
    for (const [surface, fn, render] of [['Calendar', '_calWireDragOnCard', '_calRenderBody'], ['Samples', '_sxrWireDragOnCard', '_sxrRenderBody']]) {
      ok(new RegExp("addEventListener\\('dragend', \\(e\\) => \\{[\\s\\S]*?dropEffect === 'none'[\\s\\S]*?" + render + '\\(').test(lift(fn)),
        surface + ': a drag that ends with no drop redraws the stored order');
    }
  } catch (e) { ok(false, 'this block could not run: ' + String(e && e.message || e).slice(0, 120)); }

  // --- 6. SyncLinear description on a card opened by its identifier --------------------
  try {
    const ensure = code('_prodEnsureDescription');
    ok(!/_prodState\.openId === id/.test(ensure) && (ensure.match(/_prodOpenRowId\(\) === id/g) || []).length >= 5,
      'SyncLinear: the description repaints by row id, so a card opened by identifier is not left on the loading bar');
    ok(/const id = _prodOpenRowId\(\);/.test(code('_prodCaptureDescriptionFocus')) && !/_prodState\.openId/.test(code('_prodCaptureDescriptionFocus')),
      'SyncLinear: the editor\'s caret is looked up under the row id too');
  } catch (e) { ok(false, 'this block could not run: ' + String(e && e.message || e).slice(0, 120)); }

  // --- 7. Clients search: a handle typed the way it is shown --------------------------
  try {
    const found = q => new Function('q', `
      const _caState = { search: '', showArchived: false, rows: [
        { slug: 'one', display_name: 'One', instagram_handle: 'fixturehandle', tiktok_handle: 'tikfixture' },
        { slug: 'two', display_name: 'Two', email: 'person@example.invalid', youtube_channel_id: '@tubefixture' } ] };
      const _caRecentMap = () => ({});
      const _caByName = (a, b) => a.slug.localeCompare(b.slug);
      ${lift('_caFiltered')}
      return _caFiltered(q).map(r => r.slug).join();
    `)(q);
    ok(found('@fixturehandle') === 'one', 'Clients: "@name" finds a handle stored without the "@"');
    ok(found('@TikFix') === 'one', 'Clients: for TikTok as well, whatever the capitals');
    ok(found('@tubefixture') === 'two' && found('tubefixture') === 'two', 'Clients: a handle stored with "@" is found with or without it');
    ok(found('person@example') === 'two', 'Clients: an email is still found by its middle "@"');
    ok(found('@nobody') === '' && found('@') === 'two', 'Clients: an unknown handle finds nobody, and a bare "@" still only matches what really contains one');
  } catch (e) { ok(false, 'this block could not run: ' + String(e && e.message || e).slice(0, 120)); }

  // --- 8. Restore: "its date has passed" compares days, not instants (read from the code)
  try {
    const restore = lift('_arxRestore');
    ok(/String\(fresh\.scheduled_date\)\.slice\(0, 10\) < todayIso/.test(restore) && !/Date\.parse\(String\(fresh\.scheduled_date\)/.test(stripNonCode(restore)),
      'Restore: a card scheduled today is not told its date has passed that evening');
  } catch (e) { ok(false, 'this block could not run: ' + String(e && e.message || e).slice(0, 120)); }

  // --- 9. Instagram follows the client picked in the top bar --------------------------
  try {
    const mount = (state, shared) => new Function('igState', 'shared', `
      let _igDeps = null, _igMounted = false;
      const WL_CLIENT_NAMES = ['Alpha', 'Beta'];
      const svSharedClientFor = () => shared;
      const _igCoverClear = () => { igState.coverCleared = true; };
      const document = { getElementById: () => null };
      const _igRenderForm = () => {}, _igRenderPreview = () => {}, _igRenderQueue = () => {}, _igFetchQueue = () => {}, _igSchedulePoll = () => {};
      ${lift('_igLeaveClient')}
      ${lift('mountInstagramPanel')}
      mountInstagramPanel({});
      return igState;
    `)(state, shared);
    const idle = () => ({ client: 'Alpha', file: null, title: '', submitting: false, cover: { source: 'calendar', cardId: 'c1', note: 'n' } });
    const moved = mount(idle(), 'Beta');
    ok(moved.client === 'Beta', 'Instagram: an empty form follows the client picked in the top bar');
    ok(moved.coverCleared === true && moved.cover.cardId === '', 'Instagram: and drops the cover it had taken from the old client\'s Calendar');
    ok(mount(Object.assign(idle(), { title: 'A caption in progress' }), 'Beta').client === 'Alpha', 'Instagram: a post already being written keeps its client');
    ok(mount(Object.assign(idle(), { file: { size: 1 } }), 'Beta').client === 'Alpha', 'Instagram: so does one with a video attached');
    ok(mount(Object.assign(idle(), { client: null }), 'Beta').client === 'Beta', 'Instagram: a form with no client takes the top-bar client, as before');
    const carded = mount(Object.assign(idle(), { title: 'From the card', titleFromCard: 'From the card' }), 'Beta');
    ok(carded.client === 'Beta' && carded.title === '', 'Instagram: a caption only a Calendar card filled in does not hold the form, and leaves with the old client (OPEN_REPAIRS 397)');
  } catch (e) { ok(false, 'this block could not run: ' + String(e && e.message || e).slice(0, 120)); }

  finished = true;
  if (failures) { console.log('\n' + failures + ' check(s) failed'); process.exit(1); }
  console.log('\nassurance-cycle2-remaining: all checks passed');
})().catch(e => { console.error(e); process.exit(1); });
