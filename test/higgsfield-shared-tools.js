#!/usr/bin/env node
// The connector's shared tools: studio_action actions tool_save, tool_list,
// tool_get (sharedtools.mjs). Offline, the table is a Map; every name is made up.
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', 'supabase', 'functions', 'higgsfield-mcp');
const read = (f) => fs.readFileSync(path.join(dir, f), 'utf8');

(async () => {
  const st = await import(path.join(dir, 'sharedtools.mjs'));
  const sa = await import(path.join(dir, 'studioaction.mjs'));

  const table = new Map();
  const depsFor = (author) => () => ({
    author,
    get: async (n) => table.get(n) || null,
    insert: async (r) => { table.set(r.name, { ...r, status: 'new', created_at: '2026-10-21T10:00:00Z', updated_at: '2026-10-21T10:00:00Z' }); },
    update: async (n, patch) => { table.set(n, { ...table.get(n), ...patch }); },
    list: async (client) => [...table.values()].filter((r) => !client || String(r.client).toLowerCase() === client.toLowerCase()),
  });
  const run = (author, action, args) => sa.studioAction({ tools: depsFor(author) }, action, args);
  const good = { name: 'Kit Example', what: 'Example kit', use: 'Run before editing', client: 'Example Co', bundle: 'print("hello")' };

  // Listed as actions, not as a tool.
  for (const a of ['tool_save', 'tool_list', 'tool_get']) assert.ok(sa.ACTION_NAMES.includes(a), a + ' listed');
  assert.ok(!/name: "tool_(save|list|get)"/.test(read('index.ts')), 'no new top-level tool');

  // Save, list, get.
  assert.ok(/^Saved the shared tool "kit-example"/.test(await run('Ana', 'tool_save', good)));
  assert.strictEqual(table.get('kit-example').member, 'Ana');
  const listed = await run('Bo', 'tool_list', {});
  assert.ok(listed.includes('kit-example') && listed.includes('Example kit') && !listed.includes('hello'), 'list is short, no bundle');
  assert.ok((await run('Bo', 'tool_list', { client: 'example co' })).includes('kit-example'));
  assert.ok(/No shared tools for/.test(await run('Bo', 'tool_list', { client: 'Other' })));
  const got = await run('Bo', 'tool_get', { name: 'kit-example' });
  assert.ok(got.includes('print("hello")') && got.includes('made by Ana'));
  assert.ok(/^Could not find a shared tool called/.test(await run('Bo', 'tool_get', { name: 'nope' })));

  // Same member replaces; another member is refused.
  assert.ok(/^Updated/.test(await run('Ana', 'tool_save', { ...good, bundle: 'print("v2")' })));
  assert.ok((await run('Bo', 'tool_get', { name: 'kit-example' })).includes('v2'));
  assert.ok(/^Refused: the name .* already used by Ana/.test(await run('Bo', 'tool_save', good)));

  // Limits and key screening.
  assert.ok(/^Give a name/.test(await run('Ana', 'tool_save', { ...good, name: '!!' })));
  assert.ok(/^Give what/.test(await run('Ana', 'tool_save', { ...good, what: '' })));
  assert.ok(/^Give bundle/.test(await run('Ana', 'tool_save', { ...good, bundle: '  ' })));
  assert.ok(/^Refused: the bundle is 20001 characters; the limit is 20000/.test(await run('Ana', 'tool_save', { ...good, name: 'big', bundle: 'x'.repeat(20001) })));
  assert.strictEqual((await run('Ana', 'tool_save', { ...good, name: 'edge', bundle: 'x'.repeat(20000) })).slice(0, 5), 'Saved');
  const fakeKeys = [
    'const api_key = "abcdefghijklmnop1234"',
    'token: "zzzzzzzzzzzzzzzzzz"',
    'sk-' + 'a'.repeat(30),
    'ghp_' + 'b'.repeat(30),
    'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc',
    '-----BEGIN RSA PRIVATE KEY-----',
    'Authorization: Bearer ' + 'c'.repeat(40),
    'API_KEY=abcdefghijklmnop1234',
    'HIGGSFIELD_KEY=abcdefghijklmnop1234',
    'GOOGLE_AI_KEY=abcdefghijklmnop1234',
    'AWS_SECRET_ACCESS_KEY=abcdefghijklmnop1234',
    'MY_API_KEY: "abcdefghijklmnop1234"',
    'export SECRET_TOKEN=abcdefghijklmnop1234',
  ];
  for (const k of fakeKeys) {
    assert.ok(/^Refused/.test(await run('Ana', 'tool_save', { ...good, name: 'leak', bundle: 'x\n' + k })), 'refused: ' + k.slice(0, 12));
  }
  assert.ok(!table.has('leak'));
  // Ordinary code is not mistaken for a key.
  assert.strictEqual((await run('Ana', 'tool_save', { ...good, name: 'plain', bundle: 'token = next_token(line)\nkey_count = 3' })).slice(0, 5), 'Saved');

  // Paging: nothing past the first 60 is hidden.
  for (let n = 0; n < 70; n++) table.set('page-' + String(n).padStart(2, '0'), { name: 'page-' + n, what: 'w', use: 'u', client: null, member: 'Ana', status: 'new', updated_at: '2026-10-21T10:00:00Z' });
  const p1 = await run('Bo', 'tool_list', {});
  assert.ok(/offset 60/.test(p1) && !p1.includes('page-69'));
  const p2 = await run('Bo', 'tool_list', { offset: 60 });
  assert.ok(p2.includes('page-69') && !/more: call/.test(p2));
  assert.ok(/^No shared tools from number/.test(await run('Bo', 'tool_list', { offset: 500 })));
  for (let n = 0; n < 70; n++) table.delete('page-' + String(n).padStart(2, '0'));

  // Every refusal counts as a failure in the activity log; the team link must name who saves.
  const who = await import(path.join(dir, 'who.mjs'));
  for (const bad of [
    await run('Ana', 'tool_save', { ...good, what: 'w'.repeat(301) }),
    await run('Ana', 'tool_save', { ...good, use: 'u'.repeat(601) }),
    await run('Ana', 'tool_save', { ...good, client: 'c'.repeat(81) }),
    await run('Ana', 'tool_save', { ...good, bundle: 'x'.repeat(20001) }),
    await run('Bo', 'tool_save', good),
    await run('Bo', 'tool_get', { name: 'nope' }),
    await run('Ana', 'tool_save', { ...good, name: '!!' }),
  ]) assert.strictEqual(who.outcomeOf('studio_action', bad).ok, false, bad.slice(0, 40));
  assert.strictEqual(who.outcomeOf('studio_action', await run('Ana', 'tool_save', good)).ok, true);
  const team = 'Team';
  assert.ok(who.isTeamLink(team), 'Team is the shared link name');
  assert.strictEqual(who.whoRefusal(team, 'studio_action', '', { action: 'tool_save' }), who.WHO_REQUIRED_REPLY);
  assert.strictEqual(who.whoRefusal(team, 'studio_action', 'Cam', { action: 'tool_save' }), '');
  assert.strictEqual(who.whoRefusal(team, 'studio_action', '', { action: 'tool_list' }), '');
  assert.strictEqual(who.whoRefusal('Ana', 'studio_action', '', { action: 'tool_save' }), '', 'personal links never need who');
  assert.ok(/whoRefusal\(member, name, args\.who, args\)/.test(read('index.ts')));

  // Wiring and privilege.
  assert.ok(/tools: \(\) => sharedToolDeps\(author\)/.test(read('index.ts')));
  const mig = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '20261021180000_hf_tools.sql'), 'utf8');
  assert.ok(/revoke all on table public\.hf_tools from public, anon, authenticated, service_role/.test(mig));
  assert.ok(/ef-auto-deploy-applied-when/.test(mig));

  console.log('higgsfield-shared-tools: ok');
})().catch((e) => { console.error(e); process.exit(1); });
