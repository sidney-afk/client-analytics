'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'supabase/functions/sample-review-upsert/index.ts'), 'utf8');

function ok(cond, msg) {
  if (!cond) {
    console.error('FAIL sample-review-upsert-twins-guard:', msg);
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

const duplicateColumns = extractStringArray(SRC, 'DUPLICATE_LINK_COLUMNS');
ok(duplicateColumns.join(',') === 'linear_issue_id,graphic_linear_issue_id',
  'Samples duplicate guard must cover both video and graphic Linear link columns');
ok(/function applyGuards\(incoming: JsonMap, existing: ExistingRow, twins: ExistingRow\[\], readFailed: boolean/.test(SRC),
  'applyGuards must accept twins before readFailed');
ok(/async function readLinkTwins\(supabase: SupabaseClient, client: string, incoming: JsonMap\)/.test(SRC),
  'sample-review-upsert must read duplicate-link twins');
ok(/from\("sample_reviews"\)[\s\S]*\.eq\("client", client\)[\s\S]*\.eq\(linkCol, link\)/.test(SRC),
  'readLinkTwins must query sample_reviews by client and current link column');
ok(/const twins = await readLinkTwins\(supabase, client, built\.row\);[\s\S]*applyGuards\(built\.row, existingRead\.row, twins, existingRead\.failed/.test(SRC),
  'handler must pass read twins into applyGuards');

function applyDuplicateGuard(incoming, existing, twins) {
  const existsAlready = !!(existing && existing.id);
  const row = { ...incoming };
  const cleared = {};
  for (const linkCol of extractStringArray(SRC, 'LINK_COLUMNS')) {
    if (Object.prototype.hasOwnProperty.call(incoming, linkCol) && clean(incoming[linkCol]) === '__CLEAR_LINK__') {
      row[linkCol] = '';
      cleared[linkCol] = true;
    }
  }
  for (const linkCol of duplicateColumns) {
    if (cleared[linkCol]) continue;
    const incomingLink = Object.prototype.hasOwnProperty.call(incoming, linkCol) ? clean(incoming[linkCol]) : '';
    if (!incomingLink) continue;
    const twin = twins.find(t => t && t.id && clean(t.id) !== clean(incoming.id) &&
      clean(t.status).toLowerCase() !== 'archived' && clean(t[linkCol]) === incomingLink);
    if (twin) {
      if (!existsAlready) {
        row[linkCol] = '';
      } else if (clean(existing[linkCol]) !== incomingLink) {
        row[linkCol] = String(existing[linkCol] == null ? '' : existing[linkCol]);
      }
    }
  }
  return row;
}

const vid = 'https://linear.app/synchro-social/issue/VID-100/twin';
const vidOld = 'https://linear.app/synchro-social/issue/VID-099/stored';
const gra = 'https://linear.app/synchro-social/issue/GRA-100/twin';

let out = applyDuplicateGuard(
  { id: 'new-video', linear_issue_id: vid, graphic_linear_issue_id: '' },
  {},
  [{ id: 'other-video', status: 'In Progress', linear_issue_id: vid }],
);
ok(out.linear_issue_id === '', 'new sample row reusing a live video Linear link must blank the incoming link');

out = applyDuplicateGuard(
  { id: 'existing-video', linear_issue_id: vid },
  { id: 'existing-video', linear_issue_id: vid },
  [{ id: 'other-video', status: 'In Progress', linear_issue_id: vid }],
);
ok(out.linear_issue_id === vid, 'existing row keeping its own video Linear link must be untouched');

out = applyDuplicateGuard(
  { id: 'existing-video', linear_issue_id: vid },
  { id: 'existing-video', linear_issue_id: vidOld },
  [{ id: 'other-video', status: 'In Progress', linear_issue_id: vid }],
);
ok(out.linear_issue_id === vidOld, 'existing row changed to a twin video link must revert to the stored link');

out = applyDuplicateGuard(
  { id: 'new-graphic', graphic_linear_issue_id: gra, linear_issue_id: '' },
  {},
  [{ id: 'other-graphic', status: 'For SMM Approval', graphic_linear_issue_id: gra }],
);
ok(out.graphic_linear_issue_id === '', 'new sample row reusing a live graphic Linear link must blank the incoming link');

out = applyDuplicateGuard(
  { id: 'new-archived-ok', graphic_linear_issue_id: gra },
  {},
  [{ id: 'archived-graphic', status: 'Archived', graphic_linear_issue_id: gra }],
);
ok(out.graphic_linear_issue_id === gra, 'archived sample-review twins must not block link reuse');

console.log('PASS sample-review-upsert duplicate-link guard checks');
