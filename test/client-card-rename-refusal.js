'use strict';
/*
 * client-card-rename-refusal.js — clients may not rename cards (owner decision
 * 2026-09-23), and the server refuses ONLY the name: the rest of a client's
 * save, which is how approvals and requests for changes arrive, still lands.
 */
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..');

(async () => {
  const { clientCardNameDecision: decide } = await import(
    pathToFileURL(path.join(ROOT, 'supabase/functions/_shared/client-card-rename-policy.mjs')).href);
  let n = 0;
  const eq = (a, b, m) => { assert.deepEqual(a, b, m); n++; };
  const card = { id: 'k1', name: 'Stored' };

  eq(decide('admin', { name: 'New' }, card), { keep: true, refused: false }, 'staff renames');
  eq(decide('smm', { name: 'New' }, card), { keep: true, refused: false }, 'smm renames');
  eq(decide('creative', { name: 'New' }, card), { keep: true, refused: false }, 'creative renames');
  eq(decide('client', { name: 'New', video_status: 'Approved' }, card),
    { keep: false, name: 'Stored', refused: true }, 'client rename refused, name restored');
  eq(decide('client', { name: 'Stored', video_status: 'Approved' }, card), { keep: true, refused: false },
    'client save that resends the stored name is untouched');
  eq(decide('client', { video_status: 'Approved' }, card), { keep: true, refused: false },
    'client save without a name is untouched');
  eq(decide('client', { name: 'Fresh' }, {}), { keep: true, refused: false }, 'client-created card keeps its name');
  eq(decide('client', { name: 'x' }, { id: 'k1', name: null }), { keep: false, name: null, refused: true },
    'unnamed card stays unnamed');
  eq(decide('client', { name: 'Stored ' }, card), { keep: false, name: 'Stored', refused: true },
    'even a whitespace change is refused');

  for (const fn of ['calendar-upsert', 'sample-review-upsert']) {
    const src = fs.readFileSync(path.join(ROOT, 'supabase/functions', fn, 'index.ts'), 'utf8');
    const conflict = src.indexOf('if (guarded._conflict === true)');
    const decision = src.indexOf('clientCardNameDecision(actor.role, built.row, existingRead.row)');
    const write = src.search(/await write(CalendarRow|SampleRow)\(|\.upsert\(/);
    assert.ok(conflict > 0 && decision > conflict, fn + ': decided after the conflict guard'); n++;
    assert.ok(write < 0 || src.indexOf('await write', decision) > decision, fn + ': decided before the write'); n++;
    assert.ok(/guarded\.name = nameDecision\.name/.test(src), fn + ': stored name restored on the row'); n++;
    assert.ok(/name_refused: true/.test(src), fn + ': browser is told'); n++;
    assert.ok(!/throw[^;]*client_rename/.test(src), fn + ': a client rename never fails the save'); n++;
  }
  console.log('client-card-rename-refusal: ' + n + ' checks passed ✅');
})().catch((e) => { console.error(e); process.exit(1); });
