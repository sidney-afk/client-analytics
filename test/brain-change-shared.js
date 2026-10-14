'use strict';
// The connector's brain_change and SyncView's "Send a change" button file the
// same change file, through one shared module (supabase/functions/brain/change.mjs).
// Fictional client and text only; GitHub is faked.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

(async () => {
  const { recordChange, MAX_CHANGE_CHARS } = await import(path.join(ROOT, 'supabase/functions/brain/change.mjs'));
  const calls = [];
  const gh = async (p, init) => { calls.push({ p, init }); return { ok: true, status: 201 }; };

  const out = await recordChange({
    slug: 'alphabeta', text: 'Prefers calm openings.\r\nNo music.', factId: 'client.fixture.voice.tone', heading: '',
    from: 'Test Person via Claude connector', role: 'Claude connector', folders: ['alpha-beta', 'gamma'], gh, branch: 'main',
  });
  assert.strictEqual(out.ok, true);
  assert.ok(/^inputs\/syncview-changes\/\d{4}-\d{2}-\d{2}-alpha-beta-[0-9a-f]{8}\.md$/.test(out.path), 'file goes under inputs/syncview-changes/ named for the folder');
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].p, `contents/${out.path}`);
  assert.strictEqual(calls[0].init.method, 'PUT');
  const sent = JSON.parse(calls[0].init.body);
  assert.strictEqual(sent.branch, 'main');
  assert.strictEqual(sent.message, 'SyncView change for alpha-beta (client.fixture.voice.tone)');
  const md = Buffer.from(sent.content, 'base64').toString('utf8');
  for (const line of ['# SyncView change for alpha-beta', '- client slug: alphabeta', '- brain folder: alpha-beta',
    '- fact id: client.fixture.voice.tone', '- fact heading: none', '- sent by (as typed): Test Person via Claude connector',
    '- SyncView role: Claude connector', '## What they sent, word for word', 'Prefers calm openings.\nNo music.']) {
    assert.ok(md.includes(line), `change file has: ${line}`);
  }

  const unmatched = await recordChange({ slug: 'nobody', text: 'x', folders: ['gamma'], gh, role: 'r' });
  assert.ok(unmatched.path.includes('-unmatched-nobody-'), 'an unknown client is still filed, for a person to place');
  assert.deepStrictEqual(await recordChange({ slug: 'a', text: '  ', folders: [], gh, role: 'r' }), { ok: false, error: 'text_required' });
  assert.deepStrictEqual(await recordChange({ slug: 'a', text: 'y'.repeat(MAX_CHANGE_CHARS + 1), folders: [], gh, role: 'r' }), { ok: false, error: 'text_too_long' });
  await assert.rejects(recordChange({ slug: 'a', text: 'z', folders: [], role: 'r', gh: async () => ({ ok: false, status: 409 }) }), /brain_write_409/);

  // Both functions use the shared module; neither keeps its own copy.
  const brain = read('supabase/functions/brain/index.ts');
  const info = read('supabase/functions/higgsfield-mcp/clientinfo.ts');
  assert.ok(/from "\.\/change\.mjs"/.test(brain), 'brain imports change.mjs');
  assert.ok(/from "\.\.\/brain\/change\.mjs"/.test(info), 'the connector imports change.mjs');
  for (const src of [brain, info]) assert.ok(!/## What they sent, word for word/.test(src), 'no copied change format');
  assert.ok(/via Claude connector/.test(info), 'connector changes say who sent them and how');

  // client_brain reads only the five fact files plus brief.md: never money.md or inputs/.
  const brainPart = info.slice(info.indexOf('const BRAIN_FILES'));
  assert.ok(/const BRAIN_FILES = \["identity", "voice", "editing", "relationship"\];/.test(brainPart));
  assert.ok(!/money/.test(brainPart.replace(/\/\/.*$/gm, '')), 'money.md is never read');
  assert.ok(!/contents\/inputs/.test(info), 'nothing under inputs/ is read by the connector');

  assert.ok(/if \(r\.status === 404\) return "";\s*if \(!r\.ok\) throw/.test(brainPart), 'a failed read is reported, only a 404 reads as empty');
  assert.ok(/has no Synchro Brain folder yet, so a person has to place it/.test(brainPart), 'an unmatched change is not reported as filed');

  const idx = read('supabase/functions/higgsfield-mcp/index.ts');
  assert.ok(/name: "client_brain"[\s\S]*?automatically, without being asked, whenever a client is named/.test(idx));
  assert.ok(/name: "brain_change"[\s\S]*?Never use it for notes about one video/.test(idx));
  assert.ok(/name === "brain_change"\) return await brainChange\(.*, author\);/.test(idx), 'the connector member (or team "who") is passed as sender');
  assert.ok(/call client_brain first/.test(idx), 'start_here tells Claude when to use the brain tools');

  console.log('brain-change-shared: the connector and SyncView file brain changes through one shared module, same format ✅');
})().catch((e) => { console.error(e); process.exit(1); });
