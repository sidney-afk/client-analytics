#!/usr/bin/env node
// studio_action "trial_reels" (trialreels.mjs). Offline: the table is an array; every name is made up.
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', 'supabase', 'functions', 'higgsfield-mcp');

(async () => {
  const sa = await import(path.join(dir, 'studioaction.mjs'));
  let table = [];
  let n = 0;
  const deps = (missing) => () => ({
    author: 'Ana',
    insert: async (rows) => {
      if (missing) return { missing: true };
      if (rows.some((r) => table.some((t) => t.client === r.client && t.video === r.video && t.letter === r.letter))) return { duplicate: true };
      rows.forEach((r) => table.push({ ...r, id: `00000000-0000-0000-0000-${String(++n).padStart(12, '0')}`, created_at: 'now' }));
      return {};
    },
    list: async (q) => (missing ? { missing: true } : table.filter((r) => r.client.toLowerCase() === q.client.toLowerCase() && (!q.video || r.video === q.video))),
    update: async (id, patch) => { const r = table.find((t) => t.id === id); if (!r) return null; Object.assign(r, patch); return r; },
  });
  const run = (args, missing) => sa.studioAction({ trials: deps(missing) }, 'trial reels', args);

  assert.ok(sa.ACTION_NAMES.includes('trial_reels'), 'listed as an action');
  assert.ok(!/name: "trial_reels"/.test(fs.readFileSync(path.join(dir, 'index.ts'), 'utf8')), 'no new top-level tool');
  assert.ok(/SAMPLES FIRST/.test(await run({})), 'guide by default');

  const rows = [
    { client: 'Test Co', video: '1', letter: 'A', hook: null, hook_type: 'original' },
    { client: 'Test Co', video: '1', letter: 'b', hook: 'A made-up hook', hook_type: 'Situation call-out', other_change: 'music: x.mp3' },
  ];
  assert.ok(/not switched on/.test(await run({ step: 'log', rows }, true)), 'copes without the table');
  assert.ok(/^Logged 2 versions/.test(await run({ step: 'log', rows })));
  assert.strictEqual(table[1].letter, 'B');
  assert.strictEqual(table[1].member, 'Ana');
  assert.ok(/already logged/.test(await run({ step: 'log', rows })), 'no double log');
  assert.ok(/needs its hook/.test(await run({ step: 'log', rows: [{ client: 'Test Co', video: '2', letter: 'C' }] })));
  assert.ok(/A to G/.test(await run({ step: 'log', rows: [{ client: 'Test Co', video: '2', letter: 'Z', hook: 'x' }] })));
  assert.ok(/same letter twice/.test(await run({ step: 'log', rows: [{ client: 'T', video: '3', letter: 'A' }, { client: 'T', video: '3', letter: 'A' }] })));
  assert.strictEqual(table.length, 2, 'refusals write nothing');

  const listed = await run({ step: 'list', client: 'test co' });
  assert.ok(listed.includes('1B [waiting] "A made-up hook" + music: x.mp3'));
  const id = table[1].id;
  assert.ok(/on trial/.test(await run({ step: 'update', id, status: 'on trial' })));
  assert.ok(table[1].posted_at, 'posted time set');
  assert.ok(/views 1200/.test(await run({ step: 'update', id, views: '1200', saves: 4, status: 'winner' })));
  assert.ok(/whole number/.test(await run({ step: 'update', id, views: -3 })));
  assert.ok(/must be one of/.test(await run({ step: 'update', id, status: 'great' })));
  assert.ok(/Give id/.test(await run({ step: 'update', id: 'x', status: 'lost' })));
  assert.ok(/Unknown step/.test(await run({ step: 'post' })), 'never posts');
  console.log('higgsfield-trial-reels: ok');
})().catch((e) => { console.error(e); process.exit(1); });
