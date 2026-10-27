#!/usr/bin/env node
// studio_action "trial_reels" (trialreels.mjs). Offline: the table is an array. The test client is spelled
// with an underscore here; any other client is made up.
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', 'supabase', 'functions', 'higgsfield-mcp');

(async () => {
  const sa = await import(path.join(dir, 'studioaction.mjs'));
  const T = 'Sidney_Laruel';
  let table = [];
  let n = 0;
  const key = (r) => [r.client, r.batch, r.video, r.letter].join('|');
  const deps = (missing) => () => ({
    author: 'Ana',
    insert: async (rows) => {
      if (missing) return { missing: true };
      if (rows.some((r) => table.some((t) => key(t) === key(r)))) return { duplicate: true };
      rows.forEach((r) => table.push({ ...r, id: `00000000-0000-0000-0000-${String(++n).padStart(12, '0')}`, created_at: 'now' }));
      return {};
    },
    list: async (q) => (missing ? { missing: true } : table.filter((r) => r.client.toLowerCase() === q.client.toLowerCase() && (!q.video || r.video === q.video))),
    get: async (id) => (missing ? { missing: true } : table.find((t) => t.id === id) || null),
    find: async (q) => (missing ? { missing: true } : table.find((t) => key(t) === key(q)) || null),
    update: async (id, patch) => { const r = table.find((t) => t.id === id); if (!r) return null; Object.assign(r, patch); return r; },
  });
  const run = (args, missing) => sa.studioAction({ trials: deps(missing) }, 'trial reels', args);

  assert.ok(sa.ACTION_NAMES.includes('trial_reels'), 'listed as an action');
  assert.ok(!/name: "trial_reels"/.test(fs.readFileSync(path.join(dir, 'index.ts'), 'utf8')), 'no new top-level tool');
  const guide = await run({});
  assert.ok(/SAMPLES FIRST/.test(guide), 'guide by default');
  assert.ok(!/views|no clear winner|watch_time/.test(guide), 'guide asks for no numbers (Sidney: the SMM just picks)');

  const rows = [
    { client: T, batch: 'B1', video: '1', letter: 'A', hook: null, hook_type: 'original' },
    { client: T, batch: 'B1', video: '1', letter: 'b', hook: 'A made-up hook', hook_type: 'Situation call-out', other_change: 'music: x.mp3' },
  ];
  assert.ok(/not switched on/.test(await run({ step: 'log', rows }, true)), 'copes without the table');
  assert.ok(/test client/.test(await run({ step: 'log', rows: [{ client: 'Other Co', batch: 'B1', video: '1', letter: 'A' }] })), 'any other client refused');
  assert.ok(/test client/.test(await run({ step: 'list', client: 'Other Co' })));
  assert.ok(/^Logged 2 versions/.test(await run({ step: 'log', rows })));
  assert.strictEqual(table[1].letter, 'B');
  assert.strictEqual(table[1].member, 'Ana');
  assert.ok(/already logged/.test(await run({ step: 'log', rows })), 'no double log');
  assert.ok(/needs its hook/.test(await run({ step: 'log', rows: [{ client: T, batch: 'B1', video: '2', letter: 'C' }] })));
  assert.ok(/A to G/.test(await run({ step: 'log', rows: [{ client: T, batch: 'B1', video: '2', letter: 'Z', hook: 'x' }] })));
  assert.ok(/same letter twice/.test(await run({ step: 'log', rows: [{ client: T, batch: 'B1', video: '3', letter: 'A' }, { client: T, batch: 'B1', video: '3', letter: 'A' }] })));
  assert.ok(/needs batch/.test(await run({ step: 'log', rows: [{ client: T, video: '3', letter: 'A' }] })));
  assert.ok(/not an id/.test(await run({ step: 'log', rows: [{ client: T, batch: 'B1', video: '3', letter: 'A', deliverable_id: 'x' }] })));
  assert.strictEqual(table.length, 2, 'refusals write nothing');
  assert.ok(/^Logged 1 version/.test(await run({ step: 'log', rows: [{ client: T, batch: 'B2', video: '1', letter: 'A', post_id: 'p_1', deliverable_id: '11111111-1111-4111-8111-111111111111' }] })), 'same video number in a later batch is a new version');
  assert.strictEqual(table[2].post_id, 'p_1', 'post_id kept');
  assert.strictEqual(table[2].deliverable_id, '11111111-1111-4111-8111-111111111111');

  // Replace a cut only after a change was asked.
  const swap = [{ ...rows[1], hook: 'A second made-up hook', replace: true }];
  assert.ok(/only after a change was asked/.test(await run({ step: 'log', rows: swap })));
  table[1].status = 'change asked';
  assert.ok(/^Replaced 1 version/.test(await run({ step: 'log', rows: swap })));
  assert.strictEqual(table[1].hook, 'A second made-up hook');
  assert.ok(/not logged yet/.test(await run({ step: 'log', rows: [{ ...swap[0], video: '9' }] })));

  const listed = await run({ step: 'list', client: T.toLowerCase() });
  assert.ok(listed.includes('B1 1B [change asked] "A second made-up hook" + music: x.mp3'));
  const id = table[1].id;
  assert.ok(/on trial/.test(await run({ step: 'update', id, status: 'on trial' })));
  assert.ok(table[1].posted_at, 'posted time set');
  assert.ok(/winner/.test(await run({ step: 'update', id, status: 'winner' })));
  assert.ok(/must be one of/.test(await run({ step: 'update', id, status: 'great' })));
  assert.ok(/Give id/.test(await run({ step: 'update', id: 'x', status: 'lost' })));
  assert.ok(/No trial version/.test(await run({ step: 'update', id: '00000000-0000-0000-0000-000000000099', status: 'lost' })));

  // On a card, approvals and change requests belong to SyncView.
  const carded = table[2].id;
  for (const s of ['approved', 'change asked', 'dropped', 'waiting', 'no clear winner']) {
    assert.ok(/on a SyncView card/.test(await run({ step: 'update', id: carded, status: s })), s + ' refused on a card');
  }
  assert.ok(/on trial/.test(await run({ step: 'update', id: carded, status: 'on trial' })));
  table.push({ id: '00000000-0000-0000-0000-000000000077', client: 'Other Co', letter: 'A', status: 'waiting' });
  assert.ok(/test client/.test(await run({ step: 'update', id: '00000000-0000-0000-0000-000000000077', status: 'lost' })), 'update refuses other clients');
  assert.ok(/Unknown step/.test(await run({ step: 'post' })), 'never posts');

  // index.ts drops post_id and deliverable_id when SyncView's columns are not there yet.
  const index = fs.readFileSync(path.join(dir, 'index.ts'), 'utf8');
  assert.ok(/post_id: _p, deliverable_id: _d, \.\.\.r/.test(index), 'insert retries without the card ids');
  console.log('higgsfield-trial-reels: ok');
})().catch((e) => { console.error(e); process.exit(1); });
