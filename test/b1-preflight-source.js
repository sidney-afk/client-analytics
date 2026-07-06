'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PREFLIGHT = fs.readFileSync(path.join(ROOT, 'scripts/b1-constraint-preflight.js'), 'utf8');
const DELIVERY_SWEEP = fs.readFileSync(path.join(ROOT, 'scripts/b1-delivery-link-sweep.js'), 'utf8');
const REPLAY = fs.readFileSync(path.join(ROOT, 'scripts/b05-jesse-ef-guard-replay.js'), 'utf8');

function ok(cond, msg) {
  if (!cond) {
    console.error('FAIL b1-preflight-source:', msg);
    process.exit(1);
  }
}

[
  'Constraint preflight (MANDATORY before the first backfill write)',
  'batches',
  'deliverables',
  'deliverable_events',
  'linear_archive',
  'mirror_outbox',
  'kind classification',
  'delivery-link comment sweep',
].forEach(token => ok((PREFLIGHT + '\n' + fs.readFileSync(path.join(ROOT, 'TRACK_B_LINEAR_REPLACEMENT_SPEC.md'), 'utf8')).includes(token),
  `preflight/spec token missing: ${token}`));

[
  'SUPABASE_SERVICE_ROLE_KEY',
  'LINEAR_API_KEY',
  'issue-level Linear fields only',
  'not run in the blocking constraint gate',
  'card_client_mismatch',
  'assignee_id FK',
  'client_slug NOT NULL/FK',
  'Backfill remains stopped',
].forEach(token => ok(PREFLIGHT.includes(token), `preflight source token missing: ${token}`));

ok(!/\.insert\(|\.update\(|\.delete\(|\.rpc\(/.test(PREFLIGHT),
  'constraint preflight must not write Supabase');
ok(!/batch_write|deliverable_write/.test(PREFLIGHT), 'constraint preflight must not invoke B1 write RPCs');
ok(!/comments\s*\(/.test(PREFLIGHT), 'constraint preflight must not read Linear comments');

[
  'best-effort, non-blocking',
  'comments(first: 50)',
  'proposed_file_url',
  'needs_file_url_repair_review',
].forEach(token => ok(DELIVERY_SWEEP.includes(token), `delivery sweep source token missing: ${token}`));
ok(!/\.insert\(|\.update\(|\.delete\(|\.rpc\(/.test(DELIVERY_SWEEP),
  'delivery sweep must not write Supabase');

[
  'Validation-only replay',
  'extractArray',
  'CONTENT_FIELDS',
  'SCALAR_FIELDS',
  'ALLOWED',
  'no EF/n8n write endpoint was called',
].forEach(token => ok(REPLAY.includes(token), `guard replay source token missing: ${token}`));

ok(!/method:\s*['"]POST['"]/.test(REPLAY), 'guard replay must not POST');
const replayWithoutSourcePaths = REPLAY
  .replace(/supabase\/functions\/calendar-upsert/g, '')
  .replace(/supabase\/functions\/sample-review-upsert/g, '');
ok(!/calendar-upsert|sample-review-upsert/.test(replayWithoutSourcePaths),
  'guard replay must not call writer endpoints');

console.log('PASS b1-preflight-source');
