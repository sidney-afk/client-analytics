'use strict';
/* analytics-weekly-slack-post: the switch, the Slack message and the migration's promises, read offline. */
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

(async () => {
  const m = await import(path.join(ROOT, 'supabase/functions/_shared/analytics-weekly-slack.mjs'));
  const notify = await import(path.join(ROOT, 'supabase/functions/_shared/client-review-alert.mjs'));

  // the switch: only an exact mode turns it on
  assert.equal(m.FLAG_KEY, 'analytics_weekly_slack_post');
  assert.equal(m.modeOf({ mode: 'allow_list' }), 'allow_list');
  assert.equal(m.modeOf({ mode: 'all' }), 'all');
  for (const v of [undefined, null, {}, { mode: 'off' }, { mode: 'ALL' }, { mode: true }, { enabled: true }, 'all', 1, []]) assert.equal(m.modeOf(v), 'off', JSON.stringify(v));

  // tagging is the Notify client button's: same id check, same placement (the message STARTS with <@id>)
  const t = "Dana, here's your week on social (Oct 26 to Nov 1)\nViews: 5";
  const tagged = m.buildSlackMessage(t, 'U0ABCDEFG');
  const theirs = notify.buildMessage('calendar', 'https://x/', 'U0ABCDEFG');
  assert(tagged.text.startsWith('<@U0ABCDEFG> ') && theirs.text.startsWith('<@U0ABCDEFG> '), 'both start with the mention');
  assert.equal(tagged.blocks[0].text.text.slice(0, 13), theirs.blocks[0].text.text.slice(0, 13), 'the block starts with the same mention');
  for (const bad of [null, undefined, '', 'abc', '<!channel>', 'U1', 'u0abcdefg', 'U0ABC DEFG', '<@U0ABCDEFG>']) {
    assert.equal(m.buildSlackMessage(t, bad).text, t, 'no valid id: untagged, ' + String(bad));
    assert.equal(notify.mentionIdOf(bad), '');
  }
  assert.equal(m.buildSlackMessage(t, 'W0ABCDEFG').text.slice(0, 13), '<@W0ABCDEFG> ', 'W... ids (Enterprise Grid) too, as in Notify client');
  // escaping: caption-derived text cannot notify anyone; only the tag we add is raw
  const evil = m.buildSlackMessage('Top post: "<!channel> <@U0EVIL1234> a&b"', 'U0ABCDEFG');
  assert.equal(evil.blocks[0].text.text, '<@U0ABCDEFG> Top post: "&lt;!channel&gt; &lt;@U0EVIL1234&gt; a&amp;b"');
  assert.equal(evil.text, '<@U0ABCDEFG> Top post: "&lt;!channel&gt; &lt;@U0EVIL1234&gt; a&amp;b"', 'the notification fallback is escaped too');
  for (const f of [evil.text, evil.blocks[0].text.text]) assert.deepEqual(f.match(/<[^>]*>/g), ['<@U0ABCDEFG>'], 'the only raw < > in either field is our own tag');
  assert.equal(m.buildSlackMessage('a<!here>b').text, 'a&lt;!here&gt;b', 'untagged: escaped as well');
  assert.equal(m.escapeSlack('a&b<c>'), 'a&amp;b&lt;c&gt;');

  // the migration's promises
  const sql = fs.readFileSync(path.join(ROOT, 'migrations/2026-11-04-analytics-weekly-slack-post.sql'), 'utf8');
  const code = sql.replace(/^--.*$/gm, '');
  assert.equal((sql.match(/^-- ef-auto-deploy-applied-when:/gm) || []).length, 1);
  assert(/^-- ef-auto-deploy-applied-when: select .*analytics_weekly_slack_posts.*analytics_weekly_slack_claim\(date,text,text\[\],boolean\).*analytics_weekly_slack_post'/m.test(sql), 'says how to tell it is applied');
  assert(/insert into public\.syncview_runtime_flags[^;]*'analytics_weekly_slack_post', '\{"mode":"off"\}'::jsonb[^;]*on conflict \(key\) do nothing/.test(code), 'the switch is inserted OFF and never overwritten');
  assert(!/"mode":"(all|allow_list)"[^;]*on conflict/.test(code), 'nothing here turns it on');
  assert(code.includes("revoke all on table public.%I from public, anon, authenticated, service_role"), 'tables revoked from all four');
  assert.equal((code.match(/from public, anon, authenticated, service_role/g) || []).length, 2, 'tables and functions both name all four roles');
  assert(!/grant [^;]*\b(anon|authenticated)\b/i.test(code.replace(/revoke[^;]*;/gi, '')), 'no grant to a browser role');
  assert(!/grant [^;]*\b(insert|update|delete)\b[^;]*analytics_weekly_slack/i.test(code), 'posts are written only through claim and finish');
  assert(code.includes("'* 15-16 * * 1'"), 'Mondays only, after the messages are built at 08:00-09:59');
  assert(code.includes('step 2 is not applied'), 'refuses to run before step 2');
  assert(/primary key \(client_slug, week_of\)/.test(code), 'one post row per client and week');
  assert(/check \(\(status = 'sent'\) = \(slack_ts is not null\)\)/.test(code), 'a sent post always has its ts');
  assert(!/slack_channel_id|creative_channel_id/.test(code), 'the database file never touches a channel id');

  // the function: private channel only, never the creative channel; the switch is read; no n8n
  const fn = fs.readFileSync(path.join(ROOT, 'supabase/functions/analytics-weekly-slack-post/index.ts'), 'utf8');
  assert(fn.includes('slack_channel_id') && !/creative_channel_id["'`,\s]/.test(fn.replace(/^\s*\/\/.*$/gm, '')), 'private channel only');
  assert(fn.includes('analytics_weekly_slack_claim') && fn.includes('FLAG_KEY'));
  assert(!/n8n/i.test(fn));
  console.log('analytics-weekly-slack-post rules and migration: all checks passed ✅');
})().catch(e => { console.error(e); process.exit(1); });
