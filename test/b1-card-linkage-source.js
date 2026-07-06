'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const INDEX = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const CAL_UPSERT = fs.readFileSync(path.join(ROOT, 'supabase/functions/calendar-upsert/index.ts'), 'utf8');
const SXR_UPSERT = fs.readFileSync(path.join(ROOT, 'supabase/functions/sample-review-upsert/index.ts'), 'utf8');
const SQL = fs.readFileSync(path.join(ROOT, 'migrations/2026-07-06-b1-linear-data-model.sql'), 'utf8');

function ok(cond, msg) {
  if (!cond) {
    console.error('FAIL b1-card-linkage-source:', msg);
    process.exit(1);
  }
}

for (const field of ['video_deliverable_id', 'graphic_deliverable_id']) {
  ok(new RegExp(`add column if not exists ${field} text`).test(SQL), `migration must add ${field}`);
  ok(CAL_UPSERT.includes(JSON.stringify(field)), `calendar upsert must allow ${field}`);
  ok(SXR_UPSERT.includes(JSON.stringify(field)), `sample upsert must allow/mirror ${field}`);
  ok(INDEX.includes(`'${field}'`), `browser save paths must carry ${field}`);
}

ok(/deliverables_card_slot_unique/.test(SQL)
  && /client_slug,\s*origin,\s*card_id,\s*kind/.test(SQL),
  'deliverables must keep the two-slot card linkage index');

[
  '_CAL_ROLLBACK_FIELDS',
  '_SXR_ROLLBACK_FIELDS',
  'KASPER_PATCH_SCALARS',
  '_calPostsEqualForRender',
  '_sxrPostsEqualForRender',
  '_calMigratePostShape',
  '_sxrMigrateShape',
].forEach(token => ok(INDEX.includes(token), `index source token missing: ${token}`));

console.log('PASS b1-card-linkage-source');
