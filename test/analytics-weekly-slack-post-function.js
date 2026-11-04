'use strict';
/*
 * analytics-weekly-slack-post: the Edge Function run offline against an in-memory database and a mocked Slack.
 * Proves: auth; OFF by default (a missing, bad or unreadable switch posts nothing and calls nothing); the test
 * client first through the allow-list; tagging like the Notify client button (a valid member id starts the message
 * with <@id>, none or a bad one leaves it untagged, a database without the column still posts untagged); clients
 * with no channel, no message or not active are skipped and recorded; never twice for the same week (a re-run,
 * the next tick, a manual run); an unconfirmed Slack answer is never retried; a failure is retried at most 3
 * times, spaced; caption text cannot notify anyone; mode all; status counts only; and no token, channel id,
 * name or message text in any output or log.
 */
const { spawnSync } = require('child_process');
const path = require('path');

if (process.argv[2] !== 'child') {
  const hook = path.join(__dirname, 'fixtures/weekly-slack-register.mjs');
  const r = spawnSync(process.execPath, ['--no-warnings', '--experimental-strip-types', '--import', hook, __filename, 'child'], { stdio: 'inherit' });
  process.exit(r.status === null ? 1 : r.status);
}

const assert = require('assert/strict');
const { pathToFileURL } = require('url');
const ROOT = path.resolve(__dirname, '..');
const KEY = 'k'.repeat(40), BOT = 'xoxb-test-secret-token';
const env = { ANALYTICS_COLLECT_KEY: KEY, SLACK_BOT_TOKEN: BOT, SUPABASE_URL: 'https://example.invalid', SUPABASE_SERVICE_ROLE_KEY: 'service-test' };
globalThis.Deno = { env: { get: k => env[k] }, serve: h => { globalThis.__handler = h; } };

const WEEK = (() => { const d = new Date(); d.setUTCHours(0, 0, 0, 0); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10); })();
let clock = Date.now(); globalThis.__NOW = () => clock;

const clients = [
  { slug: 'sidneylaruel', kind: 'test', active: true }, { slug: 'aaa', kind: 'client', active: true },
  { slug: 'bbb', kind: 'client', active: true }, { slug: 'ccc', kind: 'client', active: true },
  { slug: 'ddd', kind: 'client', active: true }, { slug: 'eee', kind: 'client', active: false },
  { slug: 'fff', kind: 'client', active: true }, { slug: 'ggg', kind: 'client', active: true },
];
const profiles = [
  { slug: 'sidneylaruel', slack_channel_id: 'C0TESTCHAN', slack_mention_user_id: 'U0TESTPERSON', archived_at: null },
  { slug: 'aaa', slack_channel_id: 'C0AAACHAN', slack_mention_user_id: 'U0AAAPERSON', archived_at: null },
  { slug: 'bbb', slack_channel_id: 'C0BBBCHAN', slack_mention_user_id: null, archived_at: null },
  { slug: 'ccc', slack_channel_id: '', slack_mention_user_id: 'U0CCCPERSON', archived_at: null },
  { slug: 'ddd', slack_channel_id: 'C0DDDCHAN', slack_mention_user_id: '<!channel>', archived_at: null },
  { slug: 'eee', slack_channel_id: 'C0EEECHAN', slack_mention_user_id: null, archived_at: null },
  { slug: 'fff', slack_channel_id: 'C0FFFCHAN', slack_mention_user_id: null, archived_at: null },
  { slug: 'ggg', slack_channel_id: 'C0GGGCHAN', slack_mention_user_id: null, archived_at: '2026-01-01T00:00:00Z' },
];
const text = (first, extra = '') => `${first}, here's your week on social (Oct 26 to Nov 1)\nViews: 10\nTop post: "${extra || 'hook'}" 10 views · 1 comment\nhttps://example.invalid/p/1?a=1&b=2`;
const messages = [
  { client_slug: 'sidneylaruel', week_of: WEEK, text: text('Sidney') }, { client_slug: 'aaa', week_of: WEEK, text: text('Dana') },
  { client_slug: 'bbb', week_of: WEEK, text: text('Bo', 'Hey <!channel> <@U0EVIL12345> & friends') }, { client_slug: 'ccc', week_of: WEEK, text: text('Cy') },
  { client_slug: 'ddd', week_of: WEEK, text: text('Di') }, { client_slug: 'eee', week_of: WEEK, text: text('Ed') },
  { client_slug: 'fff', week_of: WEEK, text: null }, { client_slug: 'ggg', week_of: WEEK, text: text('Gil') },
];
const reset = (mode, allow = []) => {
  globalThis.__DB = {
    clients: JSON.parse(JSON.stringify(clients)), client_profiles: JSON.parse(JSON.stringify(profiles)), analytics_weekly_messages: JSON.parse(JSON.stringify(messages)),
    syncview_runtime_flags: mode === undefined ? [] : [{ key: 'analytics_weekly_slack_post', value: mode }],
    analytics_weekly_slack_allow: allow.map(client_slug => ({ client_slug })), analytics_weekly_slack_posts: [],
  };
  globalThis.__DB_FAIL = {}; globalThis.__DB_MISSING_COLUMN = false;
  sent.length = 0; slackMode = 'ok';
};

const sent = []; let slackMode = 'ok', tsN = 0;
const origFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  assert.equal(String(url), 'https://slack.com/api/chat.postMessage', 'the only host this function may call, and only to post');
  const body = JSON.parse(init.body);
  assert.equal(init.headers.authorization, 'Bearer ' + BOT);
  sent.push(body);
  if (slackMode === 'timeout') throw new Error('network down');
  if (slackMode === '5xx') return new Response('oops', { status: 502 });
  if (slackMode === 'rejected') return new Response(JSON.stringify({ ok: false, error: 'channel_not_found' }), { status: 200 });
  return new Response(JSON.stringify({ ok: true, channel: body.channel, ts: `17830000${String(++tsN).padStart(2, '0')}.000100` }), { status: 200 });
};

const logged = [], outputs = [];
const origErr = console.error; console.error = (...a) => { logged.push(a.join(' ')); };
const call = async (body, key = KEY) => {
  const r = await globalThis.__handler(new Request('https://example.invalid/fn', { method: 'POST', headers: { 'x-analytics-collect-key': key }, body: JSON.stringify(body) }));
  const b = await r.json(); outputs.push(JSON.stringify(b)); return { status: r.status, body: b };
};
const post = slug => globalThis.__DB.analytics_weekly_slack_posts.find(p => p.client_slug === slug);
const bySlug = slug => sent.filter(s => s.channel === 'C0' + slug.toUpperCase() + 'CHAN' || (slug === 'sidneylaruel' && s.channel === 'C0TESTCHAN'));

(async () => {
  await import(pathToFileURL(path.join(ROOT, 'supabase/functions/analytics-weekly-slack-post/index.ts')).href);

  // auth
  reset({ mode: 'all' });
  assert.equal((await globalThis.__handler(new Request('https://x/fn', { method: 'GET' }))).status, 405);
  assert.equal((await call({ action: 'tick' }, 'wrong')).status, 401);
  env.ANALYTICS_COLLECT_KEY = 'short';
  assert.equal((await call({ action: 'tick' }, 'short')).status, 401, 'a key under 32 characters refuses everything');
  env.ANALYTICS_COLLECT_KEY = KEY;
  assert.equal(sent.length, 0, 'a refused call posts nothing');
  assert.equal((await call({ action: 'nope' })).status, 400);
  assert.equal((await call({ action: 'run', slugs: [] })).status, 400);
  assert.equal((await call({ action: 'run', slugs: ['a', 'b', 'c', 'd'] })).status, 400);

  // OFF by default: no row, mode off, a bad mode, an unreadable switch
  for (const [label, mode] of [['no row', undefined], ['off', { mode: 'off' }], ['bad mode', { mode: 'yes' }], ['truthy but wrong', { enabled: true }], ['uppercase', { mode: 'ALL' }]]) {
    reset(mode, ['sidneylaruel']);
    const r = await call({ action: 'tick' });
    assert.deepEqual([r.body.mode, sent.length, globalThis.__DB.analytics_weekly_slack_posts.length], ['off', 0, 0], label + ': nothing posts, nothing is recorded');
    assert.equal((await call({ action: 'run', slugs: ['sidneylaruel'] })).body.mode, 'off');
    assert.equal(sent.length, 0, label + ': a manual run obeys the switch');
  }
  reset({ mode: 'all' }); globalThis.__DB_FAIL = { table: 'syncview_runtime_flags' };
  assert.equal((await call({ action: 'tick' })).body.mode, 'off', 'an unreadable switch is off');
  assert.equal(sent.length, 0);

  // allow_list, the test client first: only it posts, tagged, with the ts recorded
  reset({ mode: 'allow_list' }, ['sidneylaruel']);
  let r = await call({ action: 'tick' });
  assert.deepEqual(r.body, { ok: true, mode: 'allow_list', week_of: WEEK, results: { sent: 1 } });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].channel, 'C0TESTCHAN');
  assert(sent[0].text.startsWith('<@U0TESTPERSON> Sidney, here'), 'starts with the mention, like Notify client');
  assert(sent[0].blocks[0].text.text.startsWith('<@U0TESTPERSON> '));
  assert.equal(post('sidneylaruel').status, 'sent');
  assert(/^\d{10,}\.\d{6}$/.test(post('sidneylaruel').slack_ts), 'the message ts is recorded');
  assert(sent[0].blocks[0].text.text.includes('a=1&amp;b=2'), '& is escaped for Slack');
  assert.equal(sent[0].unfurl_links, false);
  // the next ticks: nobody else is on the list, and the test client is never posted twice
  assert.deepEqual((await call({ action: 'tick' })).body.results, {});
  assert.deepEqual((await call({ action: 'run', slugs: ['sidneylaruel'] })).body.results, {}, 'a manual run does not re-post a sent week');
  assert.equal(sent.length, 1, 'never twice for the same week');
  assert.equal(globalThis.__DB.analytics_weekly_slack_posts.length, 1, 'a client outside the allow-list is not even recorded');

  // mode all: every client with a built message, one per tick, in order; tagging rules; skips recorded
  reset({ mode: 'all' });
  for (let i = 0; i < 9; i++) await call({ action: 'tick' });
  const posted = sent.map(s => s.channel).sort();
  assert.deepEqual(posted, ['C0AAACHAN', 'C0BBBCHAN', 'C0DDDCHAN', 'C0TESTCHAN'], 'only active clients with a channel and a message post');
  assert(bySlug('aaa')[0].text.startsWith('<@U0AAAPERSON> Dana, here'), 'a linked person is tagged');
  assert(bySlug('bbb')[0].text.startsWith('Bo, here'), 'no linked person: untagged, the text as built');
  assert(bySlug('ddd')[0].text.startsWith('Di, here'), 'a value that is not a member id is never written inside < >');
  assert.deepEqual(['ccc', 'eee', 'ggg'].map(s => [post(s).status, post(s).error_class]), [['skipped', 'no_channel'], ['skipped', 'inactive_client'], ['skipped', 'no_channel']], 'no channel (also an archived profile) or not active: skipped and recorded')
  assert.equal(post('fff'), undefined, 'a client with no built message is never claimed');
  assert.equal(globalThis.__DB.analytics_weekly_slack_posts.filter(p => p.status === 'sent').length, 4);
  // caption text cannot notify anyone
  const bb = bySlug('bbb')[0].blocks[0].text.text;
  assert(bb.includes('&lt;!channel&gt;') && bb.includes('&lt;@U0EVIL12345&gt;') && !bb.includes('<!channel>') && !bb.includes('<@U0EVIL'), 'caption mentions are escaped');
  assert(bb.includes('&amp; friends'));
  // skipped rows are retried at most 3 times, 5 minutes apart; then they stop
  const n = sent.length;
  assert.deepEqual((await call({ action: 'tick' })).body.results, {}, 'inside the 5 minutes nothing is retried');
  for (let i = 0; i < 6; i++) { clock += 6 * 60000; await call({ action: 'tick' }); }
  assert.equal(post('ccc').attempts, 3, 'three attempts, then it stops');
  assert.equal(sent.length, n, 'a skip posts nothing');
  // ... until the channel is set and a person runs it by name
  globalThis.__DB.client_profiles.find(p => p.slug === 'ccc').slack_channel_id = 'C0CCCCHAN';
  assert.deepEqual((await call({ action: 'run', slugs: ['ccc'] })).body.results, { sent: 1 });
  assert.equal(post('ccc').attempts, 1);

  // a database without the mention column still posts, untagged
  reset({ mode: 'allow_list' }, ['aaa']); globalThis.__DB_MISSING_COLUMN = true;
  await call({ action: 'tick' });
  assert(bySlug('aaa')[0].text.startsWith('Dana, here'));

  // Slack answers: unconfirmed is never retried; a refusal is retried at most 3 times, spaced
  reset({ mode: 'allow_list' }, ['aaa']); slackMode = '5xx';
  assert.deepEqual((await call({ action: 'tick' })).body.results, { unknown: 1 });
  clock += 3600000;
  for (let i = 0; i < 3; i++) await call({ action: 'tick' });
  await call({ action: 'run', slugs: ['aaa'] });
  assert.equal(sent.length, 1, 'an unconfirmed post may be in the channel: never posted again');
  assert.deepEqual([post('aaa').status, post('aaa').error_class], ['unknown', 'slack_unconfirmed']);
  reset({ mode: 'allow_list' }, ['aaa']); slackMode = 'timeout';
  assert.deepEqual((await call({ action: 'tick' })).body.results, { unknown: 1 });
  reset({ mode: 'allow_list' }, ['aaa']); slackMode = 'rejected';
  assert.deepEqual((await call({ action: 'tick' })).body.results, { failed: 1 });
  assert.deepEqual([post('aaa').status, post('aaa').error_class, post('aaa').attempts], ['failed', 'bot_not_in_channel', 1]);
  assert.deepEqual((await call({ action: 'tick' })).body.results, {}, 'a failure waits 5 minutes');
  for (let i = 0; i < 4; i++) { clock += 6 * 60000; await call({ action: 'tick' }); }
  assert.equal(post('aaa').attempts, 3);
  assert.equal(sent.length, 3, 'three attempts at most');
  slackMode = 'ok'; clock += 6 * 60000;
  await call({ action: 'tick' });
  assert.equal(sent.length, 3, 'the timer gives up; a person runs it by name');
  assert.deepEqual((await call({ action: 'run', slugs: ['aaa'] })).body.results, { sent: 1 });
  assert.equal(post('aaa').status, 'sent');
  // one named client is handled once per call, even when it fails
  reset({ mode: 'allow_list' }, ['aaa']); slackMode = 'rejected';
  await call({ action: 'run', slugs: ['aaa'] });
  assert.equal(sent.length, 1);
  assert.equal(post('aaa').attempts, 1);

  // a receipt that will not save: the row stays pending and then unknown; never re-posted
  reset({ mode: 'allow_list' }, ['aaa']); globalThis.__DB_FAIL = { finish: true };
  assert.deepEqual((await call({ action: 'tick' })).body.results, { error: 1 });
  globalThis.__DB_FAIL = {};
  assert.equal(post('aaa').status, 'pending');
  clock += 11 * 60000;
  assert.deepEqual((await call({ action: 'tick' })).body.results, {});
  assert.equal(post('aaa').status, 'unknown');
  assert.equal(post('aaa').error_class, 'stuck_pending');
  assert.equal(sent.length, 1, 'never twice');

  // missing Slack secret: nothing recorded, nothing posted
  reset({ mode: 'all' }); delete env.SLACK_BOT_TOKEN;
  assert.equal((await call({ action: 'tick' })).body.error, 'slack_not_configured');
  assert.equal(globalThis.__DB.analytics_weekly_slack_posts.length, 0);
  env.SLACK_BOT_TOKEN = BOT;

  // status: counts only
  reset({ mode: 'all' });
  for (let i = 0; i < 4; i++) await call({ action: 'tick' });
  const st = await call({ action: 'status' });
  assert.equal(st.body.mode, 'all');
  assert.deepEqual(st.body.posts, { sent: 3, 'skipped:no_channel': 1 }, 'counts by status and class, no names');

  // no token, channel id, name or text anywhere in what the function says
  const everything = outputs.join('\n') + '\n' + logged.join('\n');
  for (const s of [BOT, KEY, 'C0AAACHAN', 'C0TESTCHAN', 'U0AAAPERSON', 'Dana', 'here\'s your week']) assert(!everything.includes(s), 'leaked: ' + s.slice(0, 4));
  console.error = origErr; globalThis.fetch = origFetch;
  console.log('analytics-weekly-slack-post function: all checks passed ✅');
})().catch(e => { console.error = origErr; console.error(e); process.exit(1); });
