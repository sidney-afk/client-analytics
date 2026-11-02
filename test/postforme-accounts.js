'use strict';
// L1 of docs/plans/2026-11-trial-and-posting/combined.md (Sidney's D4, as relayed on 2 Nov: automatic link with a
// human backstop; OPEN_REPAIRS 666). Checks the pure planner in supabase/functions/_shared/postforme-accounts.mjs:
// which Post for Me accounts link to which client, which need a person, and that no token ever leaves.
// Invented handles and ids only (the repository is public).
const path = require('path');
const { pathToFileURL } = require('url');
const ROOT = path.resolve(__dirname, '..');
let passed = 0;
function ok(cond, msg) { if (!cond) { console.error('FAIL ' + msg); process.exit(1); } passed++; console.log('  ok  ' + msg); }
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

(async () => {
  const m = await import(pathToFileURL(path.join(ROOT, 'supabase/functions/_shared/postforme-accounts.mjs')).href);

  // A raw Post for Me account, as GET /v1/social-accounts returns it, with the secrets it carries.
  const raw = (id, platform, username, extra) => Object.assign({
    id, platform, username, user_id: 'net_' + id, status: 'connected', external_id: null,
    profile_photo_url: 'https://example.invalid/p.png', metadata: { display_name: 'Name ' + id, access_token: 'nested-secret' },
    access_token: 'tok-' + id, refresh_token: 'ref-' + id, access_token_expires_at: '2026-12-01T00:00:00Z',
  }, extra || {});
  const prof = (slug, f) => Object.assign({ slug, instagram_handle: null, tiktok_handle: null, youtube_channel_id: null,
    postforme_account_id: null, extra: {}, archived_at: null, updated_at: '2026-11-01T00:00:00Z' }, f || {});

  // --- safe fields: a whitelist, never a blacklist ---
  const s = m.safeAccount(raw('spc_FixtureIg0001', 'instagram', '@Fixture.One'));
  ok(same(Object.keys(s).sort(), ['display_name', 'id', 'platform', 'status', 'user_id', 'username']), 'only the whitelisted fields are kept');
  const walk = (v, out = []) => { if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { out.push(k); walk(x, out); } return out; };
  const tokenish = k => /token|secret|refresh|password|expires/i.test(k);
  ok(!walk(s).some(tokenish) && !JSON.stringify(s).includes('tok-') && !JSON.stringify(s).includes('nested-secret'), 'no token field or value at any depth');
  ok(m.safeAccount(raw('spc_FixtureTt0001', 'TikTok_Business', 'x')).platform === 'tiktok_business', 'the platform is lower case');
  ok(m.safeAccount(null) === null && m.safeAccount({ platform: 'instagram' }) === null && m.safeAccount({ id: 'not-spc', platform: 'instagram' }) === null, 'an account without a spc_ id is dropped');
  ok(m.normalizeHandle(' @Fixture.One ') === 'fixture.one' && m.normalizeHandle('') === '' && m.normalizeHandle(null) === '', 'handles: trimmed, no @, lower case');
  ok(m.normalizeHandle('https://www.instagram.com/fixture.one/') === 'https://www.instagram.com/fixture.one/', 'a saved link is not guessed into a handle (no fuzzy match)');

  // --- the plan ---
  const accounts = [
    raw('spc_FixtureIg0001', 'instagram', 'fixture.one'),        // exact, unique, slot empty -> link
    raw('spc_FixtureTt0001', 'tiktok_business', 'FixtureOneTT'),  // TikTok Business, case differs -> link to the column
    raw('spc_FixtureYt0001', 'youtube', 'Fixture One Channel', { user_id: 'UCfixtureOne000000000001' }), // channel id -> link
    raw('spc_FixtureIg0002', 'instagram', 'shared.handle'),       // two clients have this handle -> person
    raw('spc_FixtureIg0003', 'instagram', 'fixture.three'),       // slot already holds another id -> person
    raw('spc_FixtureIg0004', 'instagram', 'nobody.has.this'),     // no match -> person
    raw('spc_FixtureFb0001', 'facebook', 'Fixture Page'),         // no saved handle for Facebook -> person
    raw('spc_FixtureLi0001', 'linkedin', 'fixture-co'),           // no saved handle for LinkedIn -> person
    raw('spc_FixtureIg0005', 'instagram', 'fixture.five', { status: 'disconnected' }), // disconnected -> person
    raw('spc_FixtureIg0006', 'instagram', 'fixture.old'),         // matches only an archived client -> person
    raw('spc_FixtureIg0007', 'instagram', 'fixture.seven'),       // two accounts want the same slot -> both person
    raw('spc_FixtureIg0008', 'instagram', 'Fixture.Seven'),
    raw('spc_FixtureIg0009', 'instagram', 'fixture.nine'),        // already on a client -> already linked
    raw('spc_FixtureTt0009', 'tiktok', 'fixturenine'),            // already on a client (column) -> already linked
    raw('spc_FixtureSn0001', 'snapchat', 'fixture.one'),          // a network SyncView has no slot for -> person
    { id: 'spc_FixtureBad001', platform: 'instagram' },           // no username -> person (no match possible)
  ];
  const profiles = [
    prof('fixtureone', { instagram_handle: '@Fixture.One', tiktok_handle: 'fixtureonett', youtube_channel_id: 'UCfixtureOne000000000001' }),
    prof('fixturetwo', { instagram_handle: 'shared.handle' }),
    prof('fixturetwob', { instagram_handle: '@SHARED.handle' }),
    prof('fixturethree', { instagram_handle: 'fixture.three', extra: { postforme_instagram_account_id: 'spc_FixtureOther01' } }),
    prof('fixtureold', { instagram_handle: 'fixture.old', archived_at: '2026-10-01T00:00:00Z' }),
    prof('fixtureseven', { instagram_handle: 'fixture.seven' }),
    prof('fixturenine', { instagram_handle: 'fixture.nine', postforme_account_id: 'spc_FixtureTt0009', extra: { postforme_instagram_account_id: 'spc_FixtureIg0009' } }),
    prof('fixturefb', { instagram_handle: 'fixture page' }),
  ];
  const plan = m.planLinks(accounts.map(m.safeAccount).filter(Boolean), profiles);
  const links = plan.links.map(l => `${l.slug}:${l.field}=${l.account_id}`).sort();
  ok(same(links, [
    'fixtureone:postforme_account_id=spc_FixtureTt0001',
    'fixtureone:postforme_instagram_account_id=spc_FixtureIg0001',
    'fixtureone:postforme_youtube_account_id=spc_FixtureYt0001',
  ]), 'exact unique matches link: Instagram handle, TikTok Business handle to the column, YouTube channel id');
  const why = Object.fromEntries(plan.needs_person.map(n => [n.account_id, n.reason]));
  ok(why.spc_FixtureIg0002 === 'several_clients_match', 'a handle two clients share does not link');
  ok(why.spc_FixtureIg0003 === 'slot_holds_another_account', 'a filled slot is never overwritten');
  ok(why.spc_FixtureIg0004 === 'no_client_matches', 'no match does not link');
  ok(why.spc_FixtureFb0001 === 'no_saved_handle_for_network' && why.spc_FixtureLi0001 === 'no_saved_handle_for_network', 'Facebook and LinkedIn need a person (no saved handle to match)');
  ok(why.spc_FixtureIg0005 === 'not_connected', 'a disconnected account does not link');
  ok(why.spc_FixtureIg0006 === 'only_an_archived_client_matches', 'a match with an archived client only does not link');
  ok(why.spc_FixtureIg0007 === 'several_accounts_match' && why.spc_FixtureIg0008 === 'several_accounts_match', 'two accounts for one slot: neither links');
  ok(why.spc_FixtureSn0001 === 'network_not_supported' && why.spc_FixtureBad001 === 'not_connected', 'an unknown network, or an account with no status, does not link');
  ok(!('spc_FixtureIg0009' in why) && !('spc_FixtureTt0009' in why) && plan.already_linked === 2, 'accounts already on a client are counted, not touched');
  ok(plan.needs_person.every(n => n.network && 'username' in n) && plan.needs_person.find(n => n.account_id === 'spc_FixtureIg0002').candidates.join() === 'fixturetwo,fixturetwob',
    'each "needs a person" names the network, the username and the clients it could be');
  ok(plan.links.every(l => l.network && l.match), 'each link says why it matched');
  ok(plan.accounts === accounts.length, 'the count covers every account Post for Me returned with a valid id');

  // A YouTube handle saved as @name also matches the username (exact, no @, case).
  const yt = m.planLinks([m.safeAccount(raw('spc_FixtureYt0002', 'youtube', 'FixtureTube'))], [prof('fixturetube', { youtube_channel_id: '@fixturetube' })]);
  ok(yt.links.length === 1 && yt.links[0].field === 'postforme_youtube_account_id', 'YouTube: a saved @handle equal to the username links');
  // A channel id is compared exactly (UC ids are case-sensitive).
  const ytCase = m.planLinks([m.safeAccount(raw('spc_FixtureYt0003', 'youtube', 'Other', { user_id: 'UCabc000000000000000000X' }))], [prof('fixturecase', { youtube_channel_id: 'ucabc000000000000000000x' })]);
  ok(ytCase.links.length === 0, 'a channel id that differs only in case does not link');

  // --- idempotent: after the links are saved, the same plan changes nothing ---
  const after = profiles.map(p => {
    const mine = plan.links.filter(l => l.slug === p.slug);
    const q = JSON.parse(JSON.stringify(p));
    for (const l of mine) { if (l.field === 'postforme_account_id') q.postforme_account_id = l.account_id; else q.extra[l.field] = l.account_id; }
    return q;
  });
  const again = m.planLinks(accounts.map(m.safeAccount).filter(Boolean), after);
  ok(again.links.length === 0 && again.already_linked === 5, 'a second run is a no-op (the three links read as already linked)');
  ok(same(again.needs_person.map(n => n.account_id + n.reason).sort(), plan.needs_person.map(n => n.account_id + n.reason).sort()), 'and lists the same "needs a person" rows');

  // The plan's answer carries no token, whatever the input carried.
  ok(!walk(plan).some(tokenish) && !/tok-|ref-|nested-secret/.test(JSON.stringify(plan)), 'the plan carries no token at any depth');
  // Changes for one client are grouped into one save.
  const changes = m.changesByClient(plan.links);
  ok(same(Object.keys(changes), ['fixtureone']) && same(changes.fixtureone, {
    postforme_instagram_account_id: 'spc_FixtureIg0001', postforme_account_id: 'spc_FixtureTt0001', postforme_youtube_account_id: 'spc_FixtureYt0001' }), 'links are grouped into one save per client');

  // --- the run: fetch (paged), plan, save once per client, one Sheet copy; dry_run writes nothing ---
  const page = (all, size) => async (offset, limit) => all.slice(offset, offset + Math.min(limit, size));
  const fake = (profilesIn, opts = {}) => {
    const state = { profiles: JSON.parse(JSON.stringify(profilesIn)), saves: [], copies: 0, fetched: [] };
    state.deps = {
      fetchPage: async (offset, limit) => { state.fetched.push(offset); return opts.fetchFail ? null : page(accounts, 50)(offset, limit); },
      readProfiles: async () => JSON.parse(JSON.stringify(state.profiles)),
      saveClient: async (row, changes) => {
        state.saves.push({ slug: row.slug, changes, at: row.updated_at });
        if (opts.refuse && opts.refuse[row.slug]) return { ok: false, error: opts.refuse[row.slug] };
        const p = state.profiles.find(x => x.slug === row.slug);
        for (const [f, v] of Object.entries(changes)) { if (f === 'postforme_account_id') p.postforme_account_id = v; else p.extra[f] = v; }
        p.updated_at = '2026-11-02T12:00:00Z';
        return { ok: true };
      },
      copySheet: async () => { state.copies++; return { ok: true }; },
    };
    return state;
  };
  const st = fake(profiles);
  const r1 = await m.runAccountSync(st.deps, { dryRun: false });
  ok(r1.ok && r1.linked.length === 3 && st.saves.length === 1 && st.saves[0].slug === 'fixtureone' && st.saves[0].at === '2026-11-01T00:00:00Z',
    'a run saves each client once, with the version it read');
  ok(st.copies === 1, 'one Sheet copy after the saves (a direct save only queues it)');
  ok(r1.needs_person.length === plan.needs_person.length && r1.already_linked === 2, 'the answer lists what needs a person');
  const r2 = await m.runAccountSync(st.deps, { dryRun: false });
  ok(r2.ok && r2.linked.length === 0 && st.saves.length === 1 && st.copies === 1 && r2.already_linked === 5, 'a second run changes nothing and copies nothing');
  ok(!walk(r1).some(tokenish) && !/tok-|ref-|nested-secret/.test(JSON.stringify(r1)), 'the run\'s answer carries no token at any depth');

  const dry = fake(profiles);
  const rd = await m.runAccountSync(dry.deps, { dryRun: true });
  ok(rd.ok && rd.dry_run === true && rd.linked.length === 3 && dry.saves.length === 0 && dry.copies === 0, 'dry_run plans the links and writes nothing');

  // A save the database refuses (someone edited the client, or the slot was taken meanwhile) is never retried
  // with an overwrite: it becomes "needs a person".
  const ref = fake(profiles, { refuse: { fixtureone: 'client_profile_version_conflict' } });
  const rr = await m.runAccountSync(ref.deps, { dryRun: false });
  ok(rr.ok && rr.linked.length === 0 && ref.saves.length === 1 && ref.copies === 0, 'a refused save links nothing and is not retried');
  ok(rr.needs_person.filter(n => n.reason === 'save_refused:client_profile_version_conflict').length === 3, 'each of its accounts needs a person, with the refusal');

  // Paging: every page is read until a short one; a failed read stops with no write.
  const many = Array.from({ length: 120 }, (_, i) => raw('spc_FixturePage' + String(i).padStart(3, '0'), 'instagram', 'page.' + i));
  const pg = fake([prof('pageclient', { instagram_handle: 'page.117' })]);
  pg.deps.fetchPage = async (offset, limit) => { pg.fetched.push(offset); return many.slice(offset, offset + limit); };
  const rp = await m.runAccountSync(pg.deps, { dryRun: true });
  ok(rp.accounts === 120 && same(pg.fetched, [0, 50, 100]) && rp.linked.length === 1 && rp.linked[0].account_id === 'spc_FixturePage117', 'every page of 50 is read (an account on page 3 links)');
  const bad = fake(profiles, { fetchFail: true });
  const rb = await m.runAccountSync(bad.deps, { dryRun: false });
  ok(!rb.ok && rb.error === 'postforme_unreachable' && bad.saves.length === 0, 'a failed list read writes nothing');

  // --- wiring in client-profile-write (source checks; the function itself runs under Deno) ---
  const fn = require('fs').readFileSync(path.join(ROOT, 'supabase/functions/client-profile-write/index.ts'), 'utf8');
  const serve = fn.slice(fn.indexOf('Deno.serve('));
  const timerBranch = serve.slice(serve.indexOf('if (scheduled && !(auth.ok'), serve.indexOf('const sa = serviceAccount();'));
  ok(/action !== "pfm_accounts_sync"\) return json\(\{ ok: false, error: "unauthorized" \}, 403\)/.test(timerBranch) && /pfmAccountsSync\(supabase, body, null\)/.test(timerBranch),
    'the timer key reaches pfm_accounts_sync and nothing else');
  ok(/secret\.length >= 32 && timingSafeEqual\(given, secret\)/.test(fn) && /Deno\.env\.get\("PFM_ACCOUNT_LINK_KEY"\)/.test(fn), 'the timer key is a 32+ character secret compared in constant time');
  ok(serve.indexOf('adminMember(') < serve.indexOf('action === "pfm_accounts_sync") return await pfmAccountsSync(supabase, body, member)'), 'from the page, the action needs an active admin member');
  const fetcher = fn.slice(fn.indexOf('async function fetchAccountPage'), fn.indexOf('async function pfmAccountsSync'));
  ok(!/console\./.test(fetcher) && !/JSON\.stringify/.test(fetcher), 'the raw account list is never logged or re-serialised');
  const sync = fn.slice(fn.indexOf('async function pfmAccountsSync'), fn.indexOf('const MANAGER_SLUG'));
  ok(sync.indexOf('checkAccounts(changes)') < sync.indexOf('rpc("client_profile_admin_edit"') && /p_actor: AUTO_LINK_ACTOR/.test(sync) && /p_expected_updated_at: clean\(row\.updated_at\)/.test(sync),
    'each link: the network check, then the same save with the version read and the automatic link as the actor');
  ok(/runAccountSync\(/.test(sync) && /copyToSheet\(/.test(sync) && /authority_not_syncview/.test(sync), 'only while SyncView is the main copy; the Sheet copy is sent');
  ok(/AUTO_LINK_ACTOR = "Post for Me auto-link"/.test(fn), 'the history names the automatic link');
  ok(/rpc\("pfm_account_link_run_record"/.test(sync) && /trigger: member \? "admin" : "timer"/.test(sync) && !/console\.error\([^)]*logErr\.message/.test(sync),
    'every run is recorded for the watcher (best effort; a failure logs only its code)');

  console.log(`postforme-accounts: ${passed} checks passed`);
})().catch(e => { console.error(e); process.exit(1); });
