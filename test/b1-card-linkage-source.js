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

function clean(v) {
  return String(v == null ? '' : v).trim();
}

function extractStringArray(src, name) {
  const re = new RegExp(`const\\s+${name}\\s*=\\s*(?:new\\s+Set(?:<[^>]+>)?\\()?\\s*\\[([^\\]]+)\\]`);
  const m = src.match(re);
  ok(m, `${name} must be declared as a string array`);
  return [...m[1].matchAll(/"([^"]+)"|'([^']+)'/g)].map(x => x[1] || x[2]);
}

function efLinkBehavior(src, incoming, existing) {
  const linkColumns = extractStringArray(src, 'LINK_COLUMNS');
  const nullable = new Set(extractStringArray(src, 'NULLABLE_LINK_COLUMNS'));
  const row = { ...incoming };
  const cleared = {};
  for (const col of linkColumns) {
    if (Object.prototype.hasOwnProperty.call(incoming, col) && clean(incoming[col]) === '__CLEAR_LINK__') {
      row[col] = '';
      cleared[col] = true;
    }
  }
  for (const col of linkColumns) {
    if (cleared[col]) continue;
    if (Object.prototype.hasOwnProperty.call(incoming, col) && clean(incoming[col]) === '' && clean(existing[col]) !== '') {
      row[col] = String(existing[col] == null ? '' : existing[col]);
    }
  }
  for (const col of nullable) {
    if (Object.prototype.hasOwnProperty.call(row, col) && clean(row[col]) === '') row[col] = null;
  }
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    if (k[0] === '_') continue;
    out[k] = nullable.has(k) && clean(v) === '' ? null : String(v == null ? '' : v);
  }
  return out;
}

function assertEfLinkBehavior(label, src) {
  const linkColumns = extractStringArray(src, 'LINK_COLUMNS');
  const nullable = extractStringArray(src, 'NULLABLE_LINK_COLUMNS');
  for (const col of ['linear_issue_id', 'graphic_linear_issue_id', 'video_deliverable_id', 'graphic_deliverable_id']) {
    ok(linkColumns.includes(col), `${label} LINK_COLUMNS must include ${col}`);
  }
  ok(nullable.join(',') === 'video_deliverable_id,graphic_deliverable_id',
    `${label} only deliverable ids are nullable FK link columns`);

  const blankWholeRow = efLinkBehavior(src, {
    id: 'row_1',
    video_deliverable_id: '',
    graphic_deliverable_id: '',
  }, {});
  ok(blankWholeRow.video_deliverable_id === null && blankWholeRow.graphic_deliverable_id === null,
    `${label} Kasper-fallback-shaped whole-row blanks must store NULL, not empty string`);

  const sentinelClear = efLinkBehavior(src, {
    id: 'row_2',
    video_deliverable_id: '__CLEAR_LINK__',
    graphic_deliverable_id: '__CLEAR_LINK__',
  }, {
    video_deliverable_id: 'video-deliverable-existing',
    graphic_deliverable_id: 'graphic-deliverable-existing',
  });
  ok(sentinelClear.video_deliverable_id === null && sentinelClear.graphic_deliverable_id === null,
    `${label} __CLEAR_LINK__ must clear deliverable FK columns to NULL`);

  const blankEcho = efLinkBehavior(src, {
    id: 'row_3',
    video_deliverable_id: '',
    graphic_deliverable_id: '',
    linear_issue_id: '',
  }, {
    video_deliverable_id: 'video-deliverable-existing',
    graphic_deliverable_id: 'graphic-deliverable-existing',
    linear_issue_id: 'https://linear.app/synchro-social/issue/VID-1/example',
  });
  ok(blankEcho.video_deliverable_id === 'video-deliverable-existing'
    && blankEcho.graphic_deliverable_id === 'graphic-deliverable-existing'
    && blankEcho.linear_issue_id === 'https://linear.app/synchro-social/issue/VID-1/example',
    `${label} blank echoes must carry stored link values forward`);
}

function browserSentinelBehavior(prefix, wirePost, touched) {
  const fields = extractStringArray(INDEX, `${prefix}_LINK_CLEAR_FIELDS`);
  const sentinel = prefix === 'CAL' ? 'CAL_CLEAR_LINK_SENTINEL' : 'SXR_CLEAR_LINK_SENTINEL';
  ok(INDEX.includes(`function _${prefix === 'CAL' ? 'cal' : 'sxr'}ApplyClearSentinels`),
    `${prefix} clear-sentinel helper missing`);
  ok(INDEX.includes(sentinel), `${prefix} sentinel constant missing`);
  const out = { ...wirePost };
  for (const col of fields) {
    if (!Object.prototype.hasOwnProperty.call(out, col)) continue;
    if (touched && !Object.prototype.hasOwnProperty.call(touched, col)) continue;
    if (clean(out[col]) === '') out[col] = '__CLEAR_LINK__';
  }
  return out;
}

function assertBrowserBehavior(prefix) {
  const touchedWholeRow = browserSentinelBehavior(prefix, {
    id: 'row_4',
    video_deliverable_id: '',
    graphic_deliverable_id: '',
  }, {
    video_deliverable_id: '',
    graphic_deliverable_id: '',
  });
  ok(touchedWholeRow.video_deliverable_id === '__CLEAR_LINK__'
    && touchedWholeRow.graphic_deliverable_id === '__CLEAR_LINK__',
    `${prefix} whole-row touched deliverable blanks must become clear sentinels`);

  const untouchedWholeRow = browserSentinelBehavior(prefix, {
    id: 'row_5',
    video_deliverable_id: '',
    graphic_deliverable_id: '',
  }, {
    name: 'only title changed',
  });
  ok(untouchedWholeRow.video_deliverable_id === '' && untouchedWholeRow.graphic_deliverable_id === '',
    `${prefix} untouched whole-row blank echoes must remain blank for EF carry-forward`);
}

for (const field of ['video_deliverable_id', 'graphic_deliverable_id']) {
  ok(new RegExp(`add column if not exists ${field} text`).test(SQL), `migration must add ${field}`);
}

ok(/deliverables_card_slot_unique/.test(SQL)
  && /client_slug,\s*origin,\s*card_id,\s*kind/.test(SQL),
  'deliverables must keep the two-slot card linkage index');

assertEfLinkBehavior('calendar-upsert', CAL_UPSERT);
assertEfLinkBehavior('sample-review-upsert', SXR_UPSERT);
assertBrowserBehavior('CAL');
assertBrowserBehavior('SXR');

[
  '_CAL_ROLLBACK_FIELDS',
  '_SXR_ROLLBACK_FIELDS',
  'KASPER_PATCH_SCALARS',
  '_calPostsEqualForRender',
  '_sxrPostsEqualForRender',
  '_calMigratePostShape',
  '_sxrMigrateShape',
].forEach(token => ok(INDEX.includes(token), `index source token missing: ${token}`));

console.log('PASS b1-card-linkage-source behavioral checks');
