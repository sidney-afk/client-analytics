'use strict';
/*
 * Today and Clients: four defects found by site assurance on 2026-10-08.
 *
 * 1. Today reads its work items 1,000 rows at a time with no sort order. The
 *    database may then hand a row out on two pages or on none, so past 1,000
 *    open items an approval can be missing on one load and back on the next
 *    (945 open rows that day). Every paged Today read must sort, and the head
 *    script, which starts the same reads early and is matched by exact address,
 *    must ask for exactly the same thing.
 * 2. A lane set to N/A with no link was still "missing media": the warning
 *    stayed on the Calendar card and the post stayed in Today's "Missing
 *    links", although the warning itself says to set N/A when the post will
 *    never have that part.
 * 3. Clients: with the history open, saving an edit or changing the manager
 *    left "Loading the history…" on screen for good.
 * 4. Clients, Resources: "Open" on a YouTube @handle or a value saved as a full
 *    address went to an address that does not exist.
 *
 * The real functions are lifted out of the app and run against stand-ins.
 */
const fs = require('fs');
const path = require('path');
const { extractFunction, stripNonCode } = require('./helpers/extract-function.js');

let failures = 0;
function ok(cond, label) {
  if (cond) console.log('  ok  ' + label);
  else { console.log('FAIL  ' + label); failures++; }
}
const ROOT = path.resolve(__dirname, '..');
const INDEX = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const lift = name => extractFunction(INDEX, name);
const tick = () => new Promise(r => setImmediate(r));

let finished = false;
process.on('exit', code => { if (!finished && code === 0) { console.log('FAIL  the suite stopped before its last check'); process.exitCode = 1; } });

(async () => {
  // --- 1. paged Today reads sort, and both copies ask for the same thing -------
  {
    const head = fs.readFileSync(path.join(ROOT, 'src/index/005-head-boot.html.part'), 'utf8');
    const rawToday = fs.readFileSync(path.join(ROOT, 'src/index/097-today.js.part'), 'utf8');
    const dsel = (rawToday.match(/const DSEL = '([^']+)'/) || [])[1] || '';
    const tdSel = (head.match(/var tdSel = '([^']+)'/) || [])[1] || '';
    ok(/(^|&)order=id\.asc($|&)/.test(dsel), 'Today\'s work-item reads sort by id (' + dsel.slice(-24) + ')');
    ok(dsel && dsel === tdSel, 'the head script asks for the same work-item columns and order, character for character');
    const postsTail = s => (s.match(/status=not\.in\.\(Archived,Posted\)([^']*)'/) || [])[1];
    ok(postsTail(rawToday) === '&order=client.asc,id.asc', 'Today\'s posts read sorts by client and id');
    ok(postsTail(head) === postsTail(rawToday), 'and the head script asks for the same order');
    ok(/limit=1000&offset=/.test(rawToday), 'the reads are still paged 1,000 at a time (the reason an order is needed)');

    // What the order is for: page two of an unsorted read is not a defined set.
    const calls = [];
    const rest = new Function('calls', `
      const CAL_SUPABASE_URL = 'https://example.invalid', CAL_SUPABASE_ANON_KEY = 'k';
      const _tdyTakeEarly = () => null;
      const setTimeout = fn => fn();
      const fetch = async url => { calls.push(url); const page = +new URL(url).searchParams.get('offset') / 1000;
        return { ok: true, json: async () => Array.from({ length: page === 0 ? 1000 : 7 }, (_, i) => ({ id: page * 1000 + i })) }; };
      async ${lift('_tdyRest')}
      return _tdyRest;
    `)(calls);
    const rows = await rest('production_deliverables_browser_v1', dsel + '&status=in.(todo)');
    ok(rows.length === 1007 && calls.length === 2, 'a read past 1,000 rows fetches a second page');
    ok(calls.every(u => /[?&]order=id\.asc(&|$)/.test(u)), 'and every page carries the sort order');
  }

  // --- 2. N/A is not "missing media" ---------------------------------------------
  {
    const gap = new Function(`
      const _calNormStatus = s => String(s || '').trim() || 'In Progress';
      ${lift('_calSmmMediaGap')}
      return _calSmmMediaGap;
    `)();
    ok(gap({ video_status: 'N/A', graphic_status: 'N/A', asset_url: '', thumbnail_url: '' }) === null,
      'a post whose video and thumbnail are both N/A has nothing missing');
    const one = gap({ video_status: 'N/A', graphic_status: 'For SMM Approval', asset_url: '', thumbnail_url: '' });
    ok(one && one.video === false && one.thumb === true, 'an N/A video lane is not flagged; a thumbnail sent for approval with no link still is');
    ok(gap({ video_status: 'In Progress', graphic_status: 'In Progress', asset_url: '', thumbnail_url: '' }) === null, 'In Progress lanes are still not flagged');
    const both = gap({ video_status: 'Client Approval', graphic_status: 'Approved', asset_url: '', thumbnail_url: '' });
    ok(both && both.video && both.thumb, 'lanes past In Progress with no link are still flagged');
  }

  // --- 3. Clients history reloads after a save -----------------------------------
  {
    const env = { posts: [], paints: 0, answer: [] };
    const api = new Function('env', `
      const _caState = { historyOpen: false, history: null, selected: 'fixtureclient' };
      let _caGeneration = 1;
      const _caPaint = () => { env.paints++; };
      const _caEditPost = (action, body) => { env.posts.push(action); return new Promise(resolve => env.answer.push(resolve)); };
      async ${lift('_caLoadHistory')}
      async ${lift('_caToggleHistory')}
      ${lift('_caHistoryHtml').replace(/const mgr[\s\S]*$/, 'return "loaded"; }')}
      return { state: _caState, toggle: _caToggleHistory, load: _caLoadHistory, html: _caHistoryHtml };
    `)(env);
    const answer = () => env.answer.splice(0).forEach(done => done({ resp: { status: 200 }, json: { ok: true, edits: [], manager_moves: [] } }));
    const opening = api.toggle(); await tick(); answer(); await opening;
    ok(env.posts.length === 1 && api.html() === 'loaded', 'opening the history reads it');
    // a save clears the loaded copy, as _caEditSave and _caMgrPick do, then asks for it again
    api.state.history = null;
    ok(/Loading the history/.test(api.html()), 'right after a save the panel shows it is loading');
    const reloading = api.load(); await tick(); answer(); await reloading;
    ok(env.posts.length === 2 && api.html() === 'loaded', 'and the history is read again, so it does not stay on "Loading"');
    await api.load();
    ok(env.posts.length === 2, 'a loaded history is not read twice');
    const save = stripNonCode(lift('_caEditSave'));
    const pick = stripNonCode(lift('_caMgrPick'));
    ok(/_caState\.history = null;[\s\S]{0,80}_caLoadHistory\(\)/.test(save), 'a saved edit reloads the open history');
    ok(/_caState\.history = null;[\s\S]{0,80}_caLoadHistory\(\)/.test(pick), 'a manager change reloads the open history');
  }

  // --- 4. Resources "Open" links --------------------------------------------------
  {
    const link = new Function(`${lift('_cbLinkFor')}\nreturn _cbLinkFor;`)();
    const href = (key, row) => { const l = link(key, row); return l && l.href; };
    ok(href('youtube_present', { youtube_channel_id: '@fixturechannel' }) === 'https://www.youtube.com/@fixturechannel',
      'a YouTube @handle opens youtube.com/@handle');
    ok(href('youtube_present', { youtube_channel_id: 'UC0000000000000000000000' }) === 'https://www.youtube.com/channel/UC0000000000000000000000',
      'a YouTube channel id still opens /channel/<id>');
    ok(href('youtube_present', { youtube_channel_id: 'https://www.youtube.com/@fixturechannel' }) === 'https://www.youtube.com/@fixturechannel',
      'a YouTube value saved as a full address opens that address');
    ok(href('instagram_present', { instagram_handle: 'https://www.instagram.com/fixture/' }) === 'https://www.instagram.com/fixture/',
      'an Instagram value saved as a full address opens that address');
    ok(href('instagram_present', { instagram_handle: '@fixture' }) === 'https://www.instagram.com/fixture/', 'an Instagram handle still opens its profile');
    ok(href('tiktok_present', { tiktok_handle: 'fixture' }) === 'https://www.tiktok.com/@fixture', 'a TikTok handle still opens its profile');
    ok(href('email_present', { email: 'someone@example.invalid' }) === 'mailto:someone@example.invalid', 'email is unchanged');
  }

  finished = true;
  if (failures) { console.log('\n' + failures + ' check(s) failed'); process.exit(1); }
  console.log('\ntoday-clients-assurance: all checks passed');
})().catch(e => { console.error(e); process.exit(1); });
