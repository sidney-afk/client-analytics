'use strict';
// The "Notify client" server half (supabase/functions/_shared/client-review-alert.mjs and its Slack
// adapter), run for real in Node against a fake database and a fake Slack. Proves: staff keys only
// (admin, smm; never a client token), the channel and link are looked up on the server and never taken
// from the caller, the private channel is the only one ever read, every send is recorded BEFORE Slack is
// called, the six-hour rule, the bot-not-in-channel error, the owner-only preview going to a DM and never
// a channel, and that no token is ever returned or stored. Also the tag: a linked Slack person is
// at-mentioned at the very start, an unlinked client gets the old message byte for byte, and a database
// without the new column still sends.
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
let passed = 0; let failed = 0;
function ok(cond, msg) { if (cond) { passed++; console.log('  ok  ' + msg); } else { failed++; console.error('FAIL  ' + msg); } }

const SLACK_SECRET = 'xoxb-test-bot-secret-0000';
const REVIEW_TOKEN = 'AbCdEfGhIjKlMnOpQrStUvWxYz012345';
const PRIVATE = 'C0PRIVATE01';
const CREATIVE = 'C0CREATIVE1';
const OWNER_DM = 'U0OWNER0001';
const CLIENT_PERSON = 'U0CLIENTP01';
const NOW = Date.parse('2026-10-14T12:00:00Z');

// The message's one section: "*headline*\n<url|Review now>". Returns the unescaped url and the pieces.
function parseMessage(m) {
  const t = m.blocks[0].text.text;
  const hit = /^(\*[^*\n]+\*)\n<([^|>]+)\|([^>]+)>$/.exec(t);
  return hit ? { bold: hit[1], url: hit[2].replace(/&amp;/g, '&'), label: hit[3] } : null;
}

function fakeDb(state) {
  const calls = { selects: [], inserts: [], updates: [] };
  function query(table) {
    const q = { table, filters: [], cols: '' };
    const api = {
      select(cols) { q.cols = cols; return api; },
      eq(col, val) { q.filters.push([col, val]); return api; },
      order() { return api; }, limit() { return api; },
      maybeSingle() { q.single = true; return api; },
      insert(row) {
        calls.inserts.push({ table, row });
        const res = state.failInsert === table ? { error: { message: 'boom' } } : { error: null };
        if (!res.error) (state.tables[table] = state.tables[table] || []).push(row);
        return Promise.resolve(res);
      },
      update(patch) { q.patch = patch; return { eq(col, val) { calls.updates.push({ table, patch, col, val }); return Promise.resolve({ error: null }); } }; },
      then(resolve, reject) {
        calls.selects.push({ table, cols: q.cols, filters: q.filters });
        let rows = (state.tables[table] || []).slice();
        for (const [c, v] of q.filters) rows = rows.filter((r) => r[c] === v);
        rows.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
        const colMissing = state.failCols && state.failCols.test(q.cols);
        const res = state.failTable === table || colMissing ? { data: null, error: { message: colMissing ? 'column does not exist' : 'boom secret detail' } } : { data: q.single ? (rows[0] || null) : rows, error: null };
        return Promise.resolve(res).then(resolve, reject);
      },
    };
    return api;
  }
  return { calls, from: query };
}

function fakeSlack(state) {
  const log = { channel: [], direct: [], info: [], users: [], members: [] };
  return {
    log,
    async channelInfo(token, id) { log.info.push(id); return state.info || { ok: true, name: 'acme-private', member: true }; },
    async postChannel(token, id, message, msgId) { log.channel.push({ token, id, message, msgId }); return state.channelOut || { kind: 'sent', messageId: '1788800000.123456' }; },
    async userInfo(token, id) { log.users.push(id); return state.user || { ok: true, name: 'Client Person' }; },
    async channelHasMember(token, channel, id) { log.members.push([channel, id]); return state.has || { ok: true, member: true }; },
    async postDirect(token, id, message) { log.direct.push({ token, id, message }); return state.directOut || { kind: 'sent', messageId: '1788800000.123456' }; },
  };
}

function setup(over = {}) {
  const state = {
    ...over,
    tables: {
      clients: [{ slug: 'fixtureclient', display_name: 'Fixture Client', active: true, kind: 'client' }, { slug: 'oldclient', display_name: 'Old Client', active: false, kind: 'client' }],
      client_profiles: [{ slug: 'fixtureclient', slack_channel_id: PRIVATE, creative_channel_id: CREATIVE, archived_at: null }],
      client_access: [{ slug: 'fixtureclient', review_token: REVIEW_TOKEN }],
      client_review_alerts: [],
      ...(over.tables || {}),
    },
  };
  const db = fakeDb(state); const slack = fakeSlack(over.slackState || {});
  const keys = { 'admin-key': 'admin', 'smm-key': 'smm', 'creative-key': 'creative' };
  return { state, db, slack, deps: {
    authorize: (key, roles) => { const role = keys[key] || null; return role ? { ok: roles.includes(role), role } : { ok: false, role: null }; },
    makeClient: () => db, slack, slackToken: () => (over.noSlack ? '' : SLACK_SECRET),
    previewUserId: () => (over.previewId === undefined ? OWNER_DM : over.previewId), sendingEnabled: () => over.live !== false,
    origin: () => 'https://app.example.test', newId: (() => { let n = 0; return () => '00000000-0000-4000-8000-00000000000' + (n++); })(),
    now: () => NOW,
  } };
}

async function call(mod, deps, body, headers = { 'x-syncview-key': 'smm-key', 'x-syncview-actor': 'Test SMM' }, method = 'POST') {
  const res = await mod.buildHandler(deps)(new Request('https://x.test/f', { method, headers: { 'content-type': 'application/json', ...headers }, body: method === 'POST' ? JSON.stringify(body) : undefined }));
  let json = null; try { json = await res.json(); } catch (_e) {}
  return { status: res.status, json };
}

(async () => {
  const mod = await import(path.join(ROOT, 'supabase/functions/_shared/client-review-alert.mjs'));
  const slackMod = await import(path.join(ROOT, 'supabase/functions/_shared/client-review-alert-slack.mjs'));
  const SEND = { action: 'send', client: 'Fixture Client', surface: 'calendar' };

  // ── Auth: staff keys only, and before anything is read.
  for (const [label, headers, want] of [
    ['no key', {}, 401], ['unknown key', { 'x-syncview-key': 'nope' }, 401],
    ['creative key', { 'x-syncview-key': 'creative-key' }, 403],
    ['a client review token alone', { 'x-syncview-client-token': REVIEW_TOKEN }, 401],
    ['a client token beside a bad key', { 'x-syncview-client-token': REVIEW_TOKEN, 'x-syncview-key': 'nope' }, 401],
  ]) {
    const s = setup(); const r = await call(mod, s.deps, SEND, headers);
    ok(r.status === want && r.json.error === 'unauthorized', label + ' is refused with ' + want);
    ok(s.db.calls.selects.length === 0 && s.slack.log.channel.length === 0, label + ': nothing was read and nothing was posted');
  }
  ok((await call(mod, setup().deps, SEND, undefined, 'GET')).status === 405, 'GET is refused');
  {
    const s = setup(); const r = await call(mod, s.deps, { action: 'status', client: 'Fixture Client', surface: 'calendar' }, { 'x-syncview-key': 'admin-key' });
    ok(r.status === 200 && r.json.ok, 'the admin key is accepted');
  }
  for (const action of ['preview', 'audit']) {
    const s = setup(); const r = await call(mod, s.deps, { ...SEND, action });
    ok(r.status === 403 && s.slack.log.direct.length === 0 && s.slack.log.info.length === 0, 'an smm cannot ' + action);
  }

  // ── The lookup: channel and link come from the server, from the private channel only.
  {
    const s = setup();
    const r = await call(mod, s.deps, { ...SEND, channel: 'C0ATTACKER1', channel_id: 'C0ATTACKER1', url: 'https://evil.test/', link: 'https://evil.test/' });
    ok(r.status === 200 && r.json.sent === true, 'a send succeeds');
    ok(s.slack.log.channel.length === 1 && s.slack.log.channel[0].id === PRIVATE, 'the post goes to the roster private channel');
    ok(s.slack.log.channel[0].id !== CREATIVE && s.slack.log.channel[0].id !== 'C0ATTACKER1', 'never the creative channel, never a caller-supplied channel');
    const reads = s.db.calls.selects.filter((c) => c.table === 'client_profiles');
    ok(reads.length === 2 && reads.every((c) => !/creative/.test(c.cols)) && reads.filter((c) => /slack_channel_id/.test(c.cols)).length === 1 && reads.filter((c) => /slack_mention_user_id/.test(c.cols)).length === 1, 'the creative channel column is never even selected (one read for the channel, one for the person to tag)');
    const m = s.slack.log.channel[0].message;
    const parsed = parseMessage(m);
    const url = new URL(parsed.url);
    ok(url.origin === 'https://app.example.test' && url.searchParams.get('c') === 'Fixture Client' && url.searchParams.get('v') === 'calendar' && url.searchParams.get('tab') === 'review' && [...url.searchParams.keys()].join() === 'c,v,tab,t' && url.searchParams.get('t') === REVIEW_TOKEN && !url.searchParams.has('sxr'), 'the calendar link is built on the server like the Copy link button builds it, plus tab=review');
    ok(!JSON.stringify(m).includes('evil.test'), 'a caller-supplied address never reaches the message');
    ok(parsed && m.blocks.length === 1 && m.blocks[0].type === 'section' && parsed.bold === '*New content is ready for your review.*', 'one section: the bold line is exact, and the link is on the next line');
    ok(parsed.label === 'Review now' && !JSON.stringify(m).includes('"actions"') && !JSON.stringify(m).includes('"button"'), 'the link is plain text "Review now": no button, no actions block, nothing interactive');
    ok(m.text === 'New content is ready for your review. Review now: ' + parsed.url, 'the plain-text fallback carries the link');
    ok(!/&(?!amp;)/.test(m.blocks[0].text.text), 'ampersands in the address are escaped for Slack');
    const words = JSON.stringify(m).replace(/https?:\/\/[^"]+/g, '');
    ok(!/Test SMM|Fixture Client/.test(words) && !/\d/.test(words.replace(/[a-z]+0[a-z0-9]*/gi, '')) && !/[\u{1F300}-\u{1FAFF}☀-➿]/u.test(words), 'no SMM name, no count, no emoji in the wording');
  }
  {
    const s = setup(); const r = await call(mod, s.deps, { ...SEND, surface: 'samples' });
    const m = s.slack.log.channel[0].message; const parsed = parseMessage(m); const url = new URL(parsed.url);
    ok(r.json.sent && parsed.bold === '*New samples are ready for your review.*', 'samples say new samples');
    ok(url.searchParams.get('sxr') === '1' && url.searchParams.get('v') === 'sample-reviews' && [...url.searchParams.keys()].join() === 'sxr,c,v,tab,t' && url.searchParams.get('tab') === 'review', 'the samples link carries sxr=1, then c, v, tab=review and t');
  }
  { const s = setup(); const r = await call(mod, s.deps, { ...SEND, client: 'Old Client' }); ok(r.status === 410 && !s.slack.log.channel.length, 'an inactive client is refused'); }
  { const s = setup(); const r = await call(mod, s.deps, { ...SEND, client: 'Nobody' }); ok(r.status === 404 && !s.slack.log.channel.length, 'an unknown client is refused'); }
  { const s = setup(); const r = await call(mod, s.deps, { ...SEND, surface: 'month' }); ok(r.status === 400 && r.json.error === 'invalid_surface', 'an unknown surface is refused'); }
  { const s = setup({ tables: { client_profiles: [{ slug: 'fixtureclient', slack_channel_id: '', creative_channel_id: CREATIVE }] } }); const r = await call(mod, s.deps, SEND); ok(r.status === 409 && r.json.error === 'no_slack_channel' && !s.slack.log.channel.length, 'no private channel: refused, and the creative channel is NOT used instead'); }
  { const s = setup({ tables: { client_access: [] } }); const r = await call(mod, s.deps, SEND); ok(r.status === 409 && r.json.error === 'review_token_missing' && !s.slack.log.channel.length, 'no review link yet: refused'); }

  // ── Every send is recorded, and recorded first.
  {
    const s = setup(); await call(mod, s.deps, SEND);
    const ins = s.db.calls.inserts.filter((c) => c.table === 'client_review_alerts');
    ok(ins.length === 1 && ins[0].row.status === 'pending' && ins[0].row.client_slug === 'fixtureclient' && ins[0].row.surface === 'calendar' && ins[0].row.actor === 'Test SMM' && ins[0].row.role === 'smm' && ins[0].row.mode === 'send', 'a pending row is written with who, client, surface and time');
    const up = s.db.calls.updates[0];
    ok(up && up.patch.status === 'sent' && up.patch.slack_ts === '1788800000.123456' && up.val === ins[0].row.id, 'the same row is closed with the Slack result');
    const stored = JSON.stringify([ins, s.db.calls.updates]);
    ok(!stored.includes(SLACK_SECRET) && !stored.includes(REVIEW_TOKEN), 'no token is stored in the log');
  }
  { const s = setup({ failInsert: 'client_review_alerts' }); const r = await call(mod, s.deps, SEND); ok(r.status === 503 && r.json.error === 'log_unavailable' && s.slack.log.channel.length === 0, 'if the record cannot be written nothing is posted'); }
  { const s = setup({ failTable: 'client_review_alerts' }); const r = await call(mod, s.deps, SEND); ok(r.status === 503 && r.json.error === 'log_unavailable' && s.slack.log.channel.length === 0, 'if the history cannot be read nothing is posted'); }
  { const s = setup({ live: false }); const r = await call(mod, s.deps, SEND); ok(r.status === 403 && r.json.error === 'sending_not_enabled' && s.slack.log.channel.length === 0 && s.db.calls.inserts.length === 0, 'with sending switched off, nothing is posted or recorded'); }
  { const s = setup({ noSlack: true }); const r = await call(mod, s.deps, SEND); ok(r.status === 503 && r.json.error === 'slack_not_configured' && s.db.calls.inserts.length === 0, 'no bot token configured: refused cleanly'); }

  // ── Six hours.
  const at = (hoursAgo, status = 'sent') => ({ client_slug: 'fixtureclient', surface: 'calendar', mode: 'send', actor: 'Earlier SMM', status, created_at: new Date(NOW - hoursAgo * 3600000).toISOString() });
  {
    const s = setup({ tables: { client_review_alerts: [at(2)] } });
    const r = await call(mod, s.deps, SEND);
    ok(r.status === 409 && r.json.error === 'recently_sent' && r.json.last.by === 'Earlier SMM' && s.slack.log.channel.length === 0, 'an alert from 2 hours ago: refused until confirmed, nothing posted');
    const r2 = await call(mod, s.deps, { ...SEND, confirm_recent: true });
    ok(r2.status === 200 && r2.json.sent && s.slack.log.channel.length === 1, 'confirmed, the same send goes through');
    const st = await call(mod, setup({ tables: { client_review_alerts: [at(2)] } }).deps, { action: 'status', client: 'Fixture Client', surface: 'calendar' });
    ok(st.json.recent === true && st.json.last.by === 'Earlier SMM' && st.json.recent_hours === 6, 'status says recent, who and when');
  }
  { const s = setup({ tables: { client_review_alerts: [at(7)] } }); const r = await call(mod, s.deps, SEND); ok(r.status === 200 && r.json.sent, '7 hours ago is not recent'); }
  { const s = setup({ tables: { client_review_alerts: [at(1, 'failed')] } }); const r = await call(mod, s.deps, SEND); ok(r.status === 200, 'a failed attempt does not count'); }
  { const s = setup({ tables: { client_review_alerts: [at(0.01, 'pending')] } }); const r = await call(mod, s.deps, SEND); ok(r.status === 409, 'a send still waiting on Slack counts (a double click cannot post twice)'); }
  { const s = setup({ tables: { client_review_alerts: [{ ...at(1), surface: 'samples' }] } }); const r = await call(mod, s.deps, SEND); ok(r.status === 200, 'a samples alert does not block a calendar alert'); }
  { const s = setup({ tables: { client_review_alerts: [{ ...at(1), mode: 'preview' }] } }); const r = await call(mod, s.deps, SEND); ok(r.status === 200, 'an owner preview does not count as sent to the client'); }

  // ── Slack errors.
  for (const [out, code, status] of [
    [{ kind: 'failed', code: 'bot_not_in_channel' }, 'bot_not_in_channel', 502],
    [{ kind: 'failed', code: 'channel_archived' }, 'channel_archived', 502],
    [{ kind: 'unknown', code: 'slack_unconfirmed' }, 'slack_unconfirmed', 502],
  ]) {
    const s = setup({ slackState: { channelOut: out } }); const r = await call(mod, s.deps, SEND);
    ok(r.status === status && r.json.error === code && r.json.ok === false, code + ' is returned to the page');
    ok(s.db.calls.updates[0].patch.status === (out.kind === 'unknown' ? 'unknown' : 'failed') && s.db.calls.updates[0].patch.slack_error === code, code + ' is recorded');
  }
  { const s = setup({ slackState: { channelOut: { kind: 'unknown', code: 'slack_unconfirmed' } } }); await call(mod, s.deps, SEND); s.state.tables.client_review_alerts.forEach((r) => { r.created_at = new Date(NOW - 60000).toISOString(); r.status = 'unknown'; }); const r2 = await call(mod, s.deps, SEND); ok(r2.status === 409, 'an unconfirmed post counts as sent, so it is not repeated blindly'); }

  // ── Status: what the confirm box shows.
  {
    const s = setup(); const r = await call(mod, s.deps, { action: 'status', client: 'Fixture Client', surface: 'samples' });
    ok(r.json.headline === 'New samples are ready for your review.' && r.json.link_label === 'Review now' && r.json.button === 'Review now' && r.json.channel.name === 'acme-private' && r.json.channel.bot_member === true && r.json.has_channel && r.json.last === null && r.json.recent === false, 'status: exact words, channel name, no earlier alert');
    ok(!JSON.stringify(r.json).includes(REVIEW_TOKEN) && !JSON.stringify(r.json).includes(PRIVATE) && !JSON.stringify(r.json).includes(SLACK_SECRET), 'status never returns the review token, a channel id or the bot token');
    ok(s.slack.log.channel.length === 0 && s.db.calls.inserts.length === 0, 'status posts and records nothing');
  }
  { const s = setup({ slackState: { info: { ok: false, code: 'bot_not_in_channel' } } }); const r = await call(mod, s.deps, { action: 'status', client: 'Fixture Client', surface: 'calendar' }); ok(r.json.channel.bot_member === false && r.json.has_channel, 'status says when the bot is not in the channel'); }
  { const s = setup({ live: false }); const r = await call(mod, s.deps, { action: 'status', client: 'Fixture Client', surface: 'calendar' }); ok(r.json.sending_enabled === false, 'status says when sending is not switched on'); }

  // ── Preview: owner's DM only, admin only, exact same message.
  {
    const s = setup(); const r = await call(mod, s.deps, { ...SEND, action: 'preview' }, { 'x-syncview-key': 'admin-key', 'x-syncview-actor': 'Owner' });
    ok(r.status === 200 && r.json.previewed && s.slack.log.direct.length === 1 && s.slack.log.direct[0].id === OWNER_DM && s.slack.log.channel.length === 0, 'the preview goes to the owner DM and to no channel');
    const s2 = setup(); await call(mod, s2.deps, SEND);
    ok(JSON.stringify(s.slack.log.direct[0].message) === JSON.stringify(s2.slack.log.channel[0].message), 'the preview is byte for byte the message a client would get');
    ok(s.db.calls.inserts[0].row.mode === 'preview' && s.db.calls.inserts[0].row.channel_id === null, 'the preview is recorded as a preview, with no channel');
  }
  { const s = setup({ live: false }); const r = await call(mod, s.deps, { ...SEND, action: 'preview' }, { 'x-syncview-key': 'admin-key' }); ok(r.status === 200 && s.slack.log.direct.length === 1, 'the preview works while client sending is off'); }
  for (const bad of ['', 'C0NOTAUSER1', 'not-an-id']) { const s = setup({ previewId: bad }); const r = await call(mod, s.deps, { ...SEND, action: 'preview' }, { 'x-syncview-key': 'admin-key' }); ok(r.status === 400 && r.json.error === 'preview_target' && !s.slack.log.direct.length && !s.slack.log.channel.length, 'a preview target of "' + bad + '" is refused'); }
  { const s = setup({ previewId: OWNER_DM }); const r = await call(mod, s.deps, { action: 'status', client: 'Fixture Client', surface: 'calendar' }, { 'x-syncview-key': 'smm-key' }); ok(r.json.can_preview === false, 'an smm is not offered the preview'); }

  // ── Audit: admin only, counts.
  {
    const tables = {
      clients: [1, 2, 3, 4].map((n) => ({ slug: 'c' + n, active: true, kind: 'client' })).concat([{ slug: 'testc', active: true, kind: 'test' }]),
      client_profiles: [{ slug: 'c1', slack_channel_id: 'C0AAAAAAA1' }, { slug: 'c2', slack_channel_id: 'C0AAAAAAA2' }, { slug: 'c3', slack_channel_id: '' }],
    };
    const s = setup({ tables });
    s.slack.channelInfo = async (t, id) => id === 'C0AAAAAAA2' ? { ok: true, member: false, name: 'x' } : { ok: true, member: true, name: 'y' };
    const r = await call(mod, s.deps, { action: 'audit' }, { 'x-syncview-key': 'admin-key' });
    ok(r.json.active_clients === 4 && r.json.without_channel === 2 && r.json.bot_not_member === 1 && r.json.detail === undefined, 'audit: counts only unless detail is asked for');
    const d = await call(mod, s.deps, { action: 'audit', detail: true }, { 'x-syncview-key': 'admin-key' });
    ok([...d.json.detail.without_channel].sort().join() === 'c3,c4' && d.json.detail.bot_not_member.join() === 'c2', 'audit: detail names the clients for the admin who asked');
  }
  {
    const tables = {
      clients: [1, 2, 3, 4].map((n) => ({ slug: 'c' + n, active: true, kind: 'client' })).concat([{ slug: 'testc', active: true, kind: 'test' }]),
      client_profiles: [
        { slug: 'c1', slack_channel_id: 'C0AAAAAAA1', slack_mention_user_id: 'U0AAAAAAAA1' },
        { slug: 'c2', slack_channel_id: 'C0AAAAAAA2', slack_mention_user_id: 'not-an-id' },
        { slug: 'c3', slack_channel_id: 'C0AAAAAAA3', slack_mention_user_id: 'U0AAAAAAAA3', archived_at: '2026-10-01T00:00:00Z' },
        { slug: 'testc', slack_channel_id: 'C0AAAAAAA9', slack_mention_user_id: 'U0AAAAAAAA9' },
      ],
    };
    const s = setup({ tables });
    const r = await call(mod, s.deps, { action: 'audit' }, { 'x-syncview-key': 'admin-key' });
    ok(r.json.mention_available === true && r.json.without_slack_person === 3, 'audit: counts active clients with no linked Slack person (a bad id and an archived profile count as not linked; the test client is not counted)');
    const d = await call(mod, s.deps, { action: 'audit', detail: true }, { 'x-syncview-key': 'admin-key' });
    ok([...d.json.detail.without_slack_person].sort().join() === 'c2,c3,c4', 'audit: detail names them for the admin who asked');
    const pre = await call(mod, setup({ tables, failCols: /slack_mention_user_id/ }).deps, { action: 'audit' }, { 'x-syncview-key': 'admin-key' });
    ok(pre.json.ok && pre.json.without_slack_person === null && pre.json.mention_available === false && pre.json.without_channel === 2, 'audit before the migration: the count is null (unknown), never 0, and the rest still works');
  }

  // ── The tag: a linked Slack person is at-mentioned first; no person, no change.
  const linked = (id, extra = {}) => ({ tables: { client_profiles: [{ slug: 'fixtureclient', slack_channel_id: PRIVATE, creative_channel_id: CREATIVE, archived_at: null, slack_mention_user_id: id, ...extra }] } });
  {
    const plain = mod.buildMessage('calendar', 'https://app.example.test/?c=A&t=x');
    const tagged = mod.buildMessage('calendar', 'https://app.example.test/?c=A&t=x', CLIENT_PERSON);
    ok(tagged.blocks[0].text.text.startsWith('<@' + CLIENT_PERSON + '> *New content is ready for your review.*\n<'), 'unit: with an id the block starts with the Slack mention, then the bold line');
    ok(tagged.text.startsWith('<@' + CLIENT_PERSON + '> New content is ready for your review.'), 'unit: the notification text starts with the mention too (that is what the phone shows)');
    ok(tagged.blocks[0].text.text === '<@' + CLIENT_PERSON + '> ' + plain.blocks[0].text.text && tagged.text === '<@' + CLIENT_PERSON + '> ' + plain.text, 'unit: the rest of the message is exactly the untagged one');
    ok(JSON.stringify(mod.buildMessage('samples', 'https://a.test/?a=1&b=2', '')) === JSON.stringify(mod.buildMessage('samples', 'https://a.test/?a=1&b=2')), 'unit: no id gives the old message byte for byte');
    for (const bad of ['C0CHANNEL01', 'u0lowercase', '<!channel>', '<@U0CLIENTP01>', 'U0CL|ENT01', '@here', 'U123', 'U0CLIENTP01 ', ' x']) {
      const m = mod.buildMessage('calendar', 'https://a.test/', bad);
      ok(!/<@|<!/.test(JSON.stringify(m)) || (bad.trim() === CLIENT_PERSON), 'unit: "' + bad + '" is not a member id, so no mention markup is written');
    }
    ok(mod.mentionIdOf(' U0CLIENTP01 ') === CLIENT_PERSON && mod.mentionIdOf('W0GRIDUSER1') === 'W0GRIDUSER1' && mod.mentionIdOf('<!here>') === '', 'unit: member ids (U or W) are accepted, everything else is dropped');
    ok(mod.buildMessage('calendar', 'https://a.test/?q=<b>&r=1', CLIENT_PERSON).blocks[0].text.text.endsWith('<https://a.test/?q=&lt;b&gt;&amp;r=1|Review now>'), 'unit: the link is still escaped as before with a tag in front');
  }
  {
    const s = setup(linked(CLIENT_PERSON)); const r = await call(mod, s.deps, SEND);
    const m = s.slack.log.channel[0].message;
    ok(r.json.sent && r.json.tagged === true && m.blocks[0].text.text.startsWith('<@' + CLIENT_PERSON + '> *New content') && m.text.startsWith('<@' + CLIENT_PERSON + '> '), 'send: a linked client is tagged at the start of the message');
    ok(s.slack.log.channel[0].id === PRIVATE, 'send: still the private channel');
    const stored = JSON.stringify([s.db.calls.inserts, s.db.calls.updates]);
    ok(!stored.includes(CLIENT_PERSON), 'send: the tagged person is not written to the alert log');
  }
  {
    const s = setup(linked(CLIENT_PERSON)); await call(mod, s.deps, { ...SEND, action: 'preview' }, { 'x-syncview-key': 'admin-key' });
    const s2 = setup(linked(CLIENT_PERSON)); await call(mod, s2.deps, SEND);
    ok(s.slack.log.direct[0].id === OWNER_DM && s.slack.log.channel.length === 0 && JSON.stringify(s.slack.log.direct[0].message) === JSON.stringify(s2.slack.log.channel[0].message), 'preview: the tagged message goes, byte for byte, to the owner DM only');
  }
  {
    const s = setup(linked('<!channel>')); const r = await call(mod, s.deps, SEND);
    ok(r.json.sent && r.json.tagged === false && !/<!|<@/.test(JSON.stringify(s.slack.log.channel[0].message)), 'send: a stored value that is not a member id posts the untagged message, never @channel');
  }
  {
    const s = setup(linked(CLIENT_PERSON, { archived_at: '2026-10-01T00:00:00Z' })); const r = await call(mod, s.deps, { action: 'status', client: 'Fixture Client', surface: 'calendar' });
    ok(r.json.mention.linked === false && r.json.has_channel === false, 'an archived profile has no channel and no tag');
  }
  {
    const s = setup({ failCols: /slack_mention_user_id/ }); const r = await call(mod, s.deps, SEND);
    ok(r.status === 200 && r.json.sent && r.json.tagged === false && !/<@/.test(JSON.stringify(s.slack.log.channel[0].message)), 'before the migration (no column): the untagged message still sends');
    const st = await call(mod, setup({ failCols: /slack_mention_user_id/ }).deps, { action: 'status', client: 'Fixture Client', surface: 'calendar' });
    ok(st.json.ok && st.json.mention.available === false && st.json.mention.linked === false, 'before the migration: status says tagging is not available yet');
  }
  {
    const s = setup(linked(CLIENT_PERSON)); const r = await call(mod, s.deps, { action: 'status', client: 'Fixture Client', surface: 'calendar' });
    ok(r.json.mention.available === true && r.json.mention.linked === true && r.json.mention.name === 'Client Person' && r.json.mention.in_channel === true, 'status: who will be tagged, and that they are in the channel');
    ok(!JSON.stringify(r.json).includes(CLIENT_PERSON), 'status: the member id itself is not returned to the page');
    ok(s.slack.log.users[0] === CLIENT_PERSON && s.slack.log.members[0][0] === PRIVATE, 'status: the name and membership are read from Slack for the private channel');
    ok(s.slack.log.channel.length === 0 && s.db.calls.inserts.length === 0, 'status: still posts and records nothing');
  }
  {
    const s = setup({ ...linked(CLIENT_PERSON), slackState: { user: { ok: false, code: 'slack_not_authorised' }, has: { ok: true, member: false } } });
    const r = await call(mod, s.deps, { action: 'status', client: 'Fixture Client', surface: 'calendar' });
    ok(r.json.mention.linked === true && r.json.mention.name === null && r.json.mention.in_channel === false, 'status: an unreadable name is null (never blocks); a person outside the channel is reported');
  }
  {
    const s = setup(); const r = await call(mod, s.deps, { action: 'status', client: 'Fixture Client', surface: 'calendar' });
    ok(r.json.mention.available === true && r.json.mention.linked === false && s.slack.log.users.length === 0, 'status: not linked, and Slack is not asked about anybody');
  }

  // ── The Slack adapter.
  {
    const calls = [];
    const fx = (out, status = 200) => async (url, init) => { calls.push({ url, init }); return new Response(JSON.stringify(out), { status }); };
    let a = slackMod.makeSlack(fx({ ok: true, channel: { name: 'acme-private', is_member: false } }));
    const info = await a.channelInfo(SLACK_SECRET, PRIVATE);
    ok(info.ok && info.name === 'acme-private' && info.member === false, 'adapter: channel name and membership');
    ok(!calls[0].url.includes(SLACK_SECRET) && calls[0].init.headers.authorization === 'Bearer ' + SLACK_SECRET, 'adapter: the bot token travels only in the Authorization header');
    ok((await slackMod.makeSlack(fx({ ok: false, error: 'channel_not_found' })).channelInfo('t', PRIVATE)).code === 'bot_not_in_channel', 'adapter: an unseen private channel reads as bot-not-in-channel');
    const post = (out, status) => slackMod.makeSlack(fx(out, status)).postChannel('t', PRIVATE, { text: 't', blocks: [] }, 'id');
    ok((await post({ ok: true, channel: PRIVATE, ts: '1788800000.123456' })).kind === 'sent', 'adapter: a good post is sent');
    ok((await post({ ok: true, channel: 'C0OTHER0001', ts: '1788800000.123456' })).kind === 'failed', 'adapter: a receipt from another channel is not accepted');
    ok((await post({ ok: false, error: 'not_in_channel' })).code === 'bot_not_in_channel', 'adapter: not_in_channel');
    ok((await post({ ok: false, error: 'is_archived' })).code === 'channel_archived', 'adapter: is_archived');
    ok((await post({ ok: false, error: 'ratelimited' }, 429)).code === 'slack_rate_limited', 'adapter: rate limited');
    ok((await post({ ok: false, error: 'invalid_auth' })).code === 'slack_not_authorised', 'adapter: bad bot token');
    ok((await post({ x: 1 }, 502)).kind === 'unknown', 'adapter: a 5xx may have posted, so it is unknown');
    ok((await slackMod.makeSlack(async () => { throw new Error('net'); }).postChannel('t', PRIVATE, { text: 't', blocks: [] }, 'id')).kind === 'unknown', 'adapter: a dropped connection is unknown');
    const sent = JSON.parse(calls.find((c) => c.url.endsWith('chat.postMessage')).init.body);
    ok(sent.parse === 'none' && sent.unfurl_links === false && sent.client_msg_id === 'id', 'adapter: nothing is guessed into a mention or a link, and the post is idempotent');
    const dm = (channel, userId = OWNER_DM) => slackMod.makeSlack(fx({ ok: true, channel, ts: '1788800000.123456' })).postDirect('t', userId, { text: 't', blocks: [] });
    ok((await dm('D0DIRECT001')).kind === 'sent', 'adapter: a direct message is sent');
    ok((await dm(PRIVATE)).kind === 'failed', 'adapter: an answer from a channel is refused as a preview');
    const before = calls.length; ok((await dm('D0DIRECT001', PRIVATE)).code === 'preview_target' && calls.length === before, 'adapter: a channel id is never accepted as the preview target, and nothing is sent');
    const who = await slackMod.makeSlack(fx({ ok: true, user: { name: 'handle', real_name: 'Real Name', profile: { display_name: '', real_name: 'Real Name' } } })).userInfo('t', CLIENT_PERSON);
    ok(who.ok && who.name === 'Real Name', 'adapter: users.info gives the name to show (display name, else real name)');
    ok((await slackMod.makeSlack(fx({ ok: false, error: 'missing_scope' })).userInfo('t', CLIENT_PERSON)).code === 'slack_not_authorised', 'adapter: a missing users:read scope reads as not authorised, not a crash');
    const n = calls.length; ok((await slackMod.makeSlack(fx({ ok: true })).userInfo('t', PRIVATE)).ok === false && calls.length === n, 'adapter: a channel id is never looked up as a person');
    const mem = (out) => slackMod.makeSlack(fx(out)).channelHasMember('t', PRIVATE, CLIENT_PERSON);
    ok((await mem({ ok: true, members: ['U0OTHER0001', CLIENT_PERSON] })).member === true, 'adapter: a member is found');
    ok((await mem({ ok: true, members: ['U0OTHER0001'] })).member === false, 'adapter: a non-member is reported');
    ok((await mem({ ok: true, members: ['U0OTHER0001'], response_metadata: { next_cursor: 'abc' } })).ok === false, 'adapter: past one page the answer is unknown, never "not a member"');
  }

  // ── Browser preflight: the staff identity triple the page attaches is allowed.
  {
    const res = await mod.buildHandler(setup().deps)(new Request('https://x.test/f', { method: 'OPTIONS' }));
    const allowed = (res.headers.get('access-control-allow-headers') || '').split(',').map((h) => h.trim());
    ok(res.status === 204 && ['x-syncview-key', 'x-syncview-actor', 'x-syncview-role', 'content-type'].every((h) => allowed.includes(h)), 'the preflight allows the staff key, actor and role headers');
  }

  // ── Source and migration facts.
  const index = fs.readFileSync(path.join(ROOT, 'supabase/functions/client-review-alert/index.ts'), 'utf8');
  const handler = fs.readFileSync(path.join(ROOT, 'supabase/functions/_shared/client-review-alert.mjs'), 'utf8');
  const sql = fs.readFileSync(path.join(ROOT, 'supabase/migrations/20261014120000_client_review_alerts.sql'), 'utf8');
  ok(/authorizeStaffKey\(key, roles/.test(index) && /deps\.authorize\(staffKey, \['admin', 'smm'\]\)/.test(handler), 'the gate is authorizeStaffKey with admin and smm');
  ok(!/authorizeBrowserWrite|get\('x-syncview-client-token'\)/.test(index + handler), 'a client token header is never read and the browser-write principal is not used');
  ok(handler.indexOf("deps.authorize(staffKey") < handler.indexOf('req.text()') && handler.indexOf('req.text()') < handler.indexOf('deps.makeClient()'), 'the key is checked before the body is read or a database client is made');
  ok(!/creative_channel_id/.test(handler.replace(/^\/\/.*$/gm, '').replace(/\/\/ Only the private channel[^\n]*\n[^\n]*\n/, '')), 'the handler never names the creative channel column outside comments');
  ok(!/console\.(log|error|warn)/.test(handler + index + fs.readFileSync(path.join(ROOT, 'supabase/functions/_shared/client-review-alert-slack.mjs'), 'utf8')), 'nothing is logged, so no token can be');
  ok(/revoke all on table public\.client_review_alerts from public, anon, authenticated, service_role/.test(sql) && /enable row level security/.test(sql) && /grant select, insert, update on table public\.client_review_alerts to service_role/.test(sql), 'the log table is closed to every role but the service role');
  ok(/^CLIENT_REVIEW_ALERT_LIVE|CLIENT_REVIEW_ALERT_LIVE/.test(index), 'sending to clients is behind an off-by-default switch');

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed) process.exit(1);
  console.log('Client review alert handler checks passed');
})().catch((e) => { console.error(e); process.exit(1); });
