#!/usr/bin/env node
// The Synchro connector's "guide" tool: the team's playbooks live in the
// hf_guides table (newest row per topic is live), so a change reaches every
// teammate on their next call with no skill reinstall and no deploy.
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const dir = path.join(root, 'supabase', 'functions', 'higgsfield-mcp');
const read = (f) => fs.readFileSync(path.join(dir, f), 'utf8');

(async () => {
  const g = await import(path.join(dir, 'guides.mjs'));

  // Topics: lowercase with dashes, nothing else.
  assert.strictEqual(g.cleanTopic('Thumbnails'), 'thumbnails');
  assert.strictEqual(g.cleanTopic('  b roll '), 'b-roll');
  assert.strictEqual(g.cleanTopic('images_and_videos'), 'images-and-videos');
  assert.strictEqual(g.cleanTopic('../etc'), '');
  assert.strictEqual(g.cleanTopic('a'.repeat(41)), '');
  assert.strictEqual(g.cleanTopic(7), '');

  const rows = [
    { topic: 'brain', body: '# Client brain\nOld text', created_at: '2026-10-14T10:00:00Z' },
    { topic: 'brain', body: '# Client brain\nNew text', created_at: '2026-10-15T10:00:00Z' },
    { topic: 'thumbnails', body: 'Thumbnails from screenshots\nSteps...', created_at: '2026-10-15T09:00:00Z' },
    { topic: 'start', body: 'How the team works with this connector.', created_at: '2026-10-15T08:00:00Z' },
    { topic: 'BAD TOPIC!', body: 'ignored', created_at: '2026-10-15T08:00:00Z' },
    { topic: 'empty', body: '   ', created_at: '2026-10-15T08:00:00Z' },
  ];

  // The newest version wins; older rows are history.
  const latest = g.latestGuides(rows);
  assert.strictEqual(latest.get('brain').body, '# Client brain\nNew text');
  assert.ok(!latest.has('empty') && latest.size === 3, 'blank and malformed rows are skipped');

  // A topic: its newest body, dated.
  const brain = g.guideReply(rows, 'Brain');
  assert.ok(brain.startsWith('# Client brain\nNew text'), brain);
  assert.ok(brain.includes('updated 2026-10-15'));

  // No topic: the starting guide, then the list (without "start" itself).
  const all = g.guideReply(rows, undefined);
  assert.ok(all.startsWith('How the team works with this connector.'), all);
  assert.ok(all.includes('- brain: Client brain') && all.includes('- thumbnails: Thumbnails from screenshots'));
  assert.ok(!/- start:/.test(all));

  // Unknown topic: says so and lists them, and the activity log reads it as a failure.
  const missing = g.guideReply(rows, 'nope');
  assert.ok(missing.startsWith('No guide called "nope"') && missing.includes('- brain'));
  const who = await import(path.join(dir, 'who.mjs'));
  assert.strictEqual(who.outcomeOf('guide', missing).ok, false);
  assert.strictEqual(who.outcomeOf('guide', brain).ok, true);

  // Nothing written yet: a plain fallback, never an error.
  assert.ok(g.guideReply([], 'brain').startsWith('No team guides are written yet'));

  // Wiring: the tool, the read, start_here's list, and the instruction to use it.
  const idx = read('index.ts');
  assert.ok(/import \{ guideIndex, guideReply, latestGuides \} from "\.\/guides\.mjs";/.test(idx));
  assert.ok(/name: "guide",/.test(idx), 'the guide tool is offered');
  assert.ok(/if \(name === "guide"\) \{\n\s*try \{\n\s*return guideReply\(await readGuides\(\), args\.topic\);/.test(idx), 'the tool answers from the table');
  assert.ok(/from\("hf_guides"\)\.select\("topic,body,created_at"\)/.test(idx), 'reads hf_guides');
  assert.ok(!/from\("hf_guides"\)\.(insert|update|upsert|delete)/.test(idx), 'the connector never writes guides');
  assert.ok(/\$\{await guideList\(\)\}/.test(idx), 'start_here lists the guides');
  assert.ok(/Before any task, call guide with that task's topic and follow it/.test(idx), 'the instructions send Claude to the guide');

  // The migration: read-only for the function, nothing for browser roles.
  const mig = fs.readFileSync(path.join(root, 'supabase', 'migrations', '20261015200000_hf_guides.sql'), 'utf8');
  assert.ok(/revoke all on table public\.hf_guides from public, anon, authenticated, service_role;/.test(mig));
  assert.ok(/grant select on table public\.hf_guides to service_role;/.test(mig));
  assert.ok(!/grant [^;]*(insert|update|delete)[^;]*hf_guides/i.test(mig), 'the function cannot change guides');
  assert.ok(/enable row level security/.test(mig));
  assert.ok(/topic ~ '\^\[a-z0-9\]\[a-z0-9-\]\{0,39\}\$'/.test(mig), 'the table enforces the same topic shape');

  // thumbnail_workflow serves the live thumbnails guide, so a guide change reaches it too,
  // and the built-in fallback never tells the team to make loose copies.
  const idx = fs.readFileSync(path.join(dir, 'index.ts'), 'utf8');
  assert.ok(/name === "thumbnail_workflow"\) \{[\s\S]{0,400}guideReply\(rows, "thumbnails"\)/.test(idx), 'thumbnail_workflow reads the live guide');
  const fb = idx.slice(idx.indexOf('const THUMBNAIL_WORKFLOW'), idx.indexOf('const INSTRUCTIONS'));
  assert.ok(!/copy-design\\` with/.test(fb) && /original editable file/.test(fb), 'fallback works in the original file');

  console.log('higgsfield-guides: newest version wins, list and fallbacks, read-only table ✅');
})().catch((e) => { console.error(e); process.exit(1); });
