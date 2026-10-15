'use strict';
/*
 * The Synchro connector's activity log (hf_activity): one row per tools/call,
 * success or failure, written fire and forget. A log that cannot be written
 * must never break the tool. The logic lives in who.mjs (run here for real);
 * index.ts and the migration are checked for the wiring.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const dir = path.join(root, 'supabase', 'functions', 'higgsfield-mcp');
const read = (f) => fs.readFileSync(path.join(dir, f), 'utf8');

(async () => {
  const who = await import(path.join(dir, 'who.mjs'));

  // cleanSummary: one plain line, at most 200 characters.
  assert.strictEqual(who.cleanSummary('  make a b-roll   of a beach  '), 'make a b-roll of a beach');
  assert.strictEqual(who.cleanSummary('line one\nline two\r\n\tthree'), 'line one line two three');
  assert.strictEqual(who.cleanSummary('a\u0000b\u0007c\u001bd\u007fe\u2028f'), 'a b c d e f');
  assert.strictEqual(who.cleanSummary(42), '');
  assert.strictEqual(who.cleanSummary(undefined), '');
  assert.strictEqual(who.cleanSummary('   '), '');
  assert.strictEqual(who.cleanSummary('x'.repeat(500)).length, 200);
  assert.strictEqual(who.cleanSummary('Café ü 日本 ok'), 'Café ü 日本 ok', 'letters in any language stay');

  // activityRow: team link keeps a cleaned "who"; personal links never do.
  const team = who.activityRow({ member: 'Team', tool: 'client_brain', args: { who: ' Ana\n<script>', client: 'Fixture  Client', summary: 'what does the\nclient want' }, ok: true });
  assert.deepStrictEqual(team, { member_name: 'Team', who: 'Anascript', tool: 'client_brain', client: 'Fixture Client', summary: 'what does the client want', ok: true, error: null });
  const personal = who.activityRow({ member: 'Pat', tool: 'create', args: { who: 'Maria', summary: 'a photo' }, ok: true });
  assert.strictEqual(personal.who, null, 'a personal link ignores "who"');
  assert.strictEqual(personal.summary, 'a photo', 'a personal link still keeps "summary"');
  assert.strictEqual(personal.client, null);
  const failed = who.activityRow({ member: 'Team', tool: 'create', args: {}, ok: false, error: 'boom\nstack' });
  assert.strictEqual(failed.ok, false);
  assert.strictEqual(failed.error, 'boom stack');
  assert.strictEqual(who.activityRow({ member: 'Team', tool: 'x', args: null, ok: false }).error, 'error', 'a failure always has an error text');
  assert.strictEqual(who.activityRow({ member: 'Team', tool: 'x', args: ['a'], ok: true }).summary, null, 'non-object args are ignored');
  assert.ok(who.activityRow({ member: 'Team', tool: 'x', args: {}, ok: false, error: 'e'.repeat(900) }).error.length <= 300);
  assert.ok(who.activityRow({ member: 'Team', tool: 'x', args: { client: 'c'.repeat(900) }, ok: true }).client.length <= 120);

  // logActivity never throws or rejects, whatever the write does.
  let wrote = null;
  await who.logActivity(async (row) => { wrote = row; }, { tool: 't' });
  assert.deepStrictEqual(wrote, { tool: 't' });
  await who.logActivity(() => { throw new Error('sync throw'); }, {});
  await who.logActivity(async () => { throw new Error('async throw'); }, {});
  await who.logActivity(() => Promise.reject(new Error('rejected')), {});
  await who.logActivity(null, {});
  // A log write that throws does not break the tool: the tool's own result still comes back.
  const tool = async () => { const result = 'tool result'; await who.logActivity(() => { throw new Error('db down'); }, {}); return result; };
  assert.strictEqual(await tool(), 'tool result');

  // The notes: the team link asks the first name and passes who + summary on every call;
  // every link is told to pass summary.
  assert.ok(/first name once/.test(who.TEAM_START_NOTE) && /"who"/.test(who.TEAM_START_NOTE) && /"summary"/.test(who.TEAM_START_NOTE) && /every tool call/.test(who.TEAM_START_NOTE));
  assert.ok(/"summary"/.test(who.SUMMARY_NOTE) && /200/.test(who.SUMMARY_NOTE) && !/team link/i.test(who.SUMMARY_NOTE));

  // Wiring in index.ts: the summary note reaches every link, each call is logged
  // once on success and once on failure, after the reply (background), never awaited.
  const idx = read('index.ts');
  assert.ok(/\n  SUMMARY_NOTE,\n\]\.join\(" "\);/.test(idx), 'the summary note is in the instructions every link gets');
  const call = idx.slice(idx.indexOf('if (method === "tools/call")'), idx.indexOf('return rpcError(id, -32601'));
  assert.ok(/background\(logActivity\(writeActivity, activityRow\(\{ member, tool: toolName, args: callArgs, ok, error \}\)\)\)/.test(call), 'the row goes out in the background');
  assert.ok(/const text = await callTool\(toolName, callArgs, member\);\n\s*log\(true\);/.test(call), 'success is logged');
  assert.ok(/catch \(e\) \{\n\s*log\(false, \(e as Error\)\.message\);/.test(call), 'failure is logged');
  assert.ok(!/await logActivity|await log\(/.test(call), 'the reply never waits for the log');
  assert.ok(/if \(logged\) return;/.test(call), 'one row per call');
  assert.ok(/from\("hf_activity"\)\.insert\(row\)/.test(idx), 'the row goes to hf_activity');

  // The migration: the table, and the revoke names all four roles.
  const mig = fs.readFileSync(path.join(root, 'supabase', 'migrations', '20261015180000_hf_activity.sql'), 'utf8');
  for (const col of ['id uuid', 'created_at timestamptz', 'member_name text', 'who text', 'tool text', 'client text', 'summary text', 'ok boolean', 'error text']) assert.ok(mig.includes(col), 'column ' + col);
  assert.ok(/length\(summary\) between 1 and 200/.test(mig));
  assert.ok(/revoke all on table public\.hf_activity from public, anon, authenticated, service_role;/.test(mig));
  assert.ok(/grant select, insert on table public\.hf_activity to service_role;/.test(mig));
  assert.ok(/enable row level security/.test(mig));

  console.log('higgsfield-activity-log: summary cleaning, one row per call, a failing log never breaks the tool ✅');
})().catch((e) => { console.error(e); process.exit(1); });
