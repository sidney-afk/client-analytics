'use strict';
/*
 * Samples native create, layer 1: the sxr lane admits intake_create.
 *
 * Owner task 2026-08-18: "samples should have their own batches" -- samples run
 * the same intake pipeline as the Calendar create flow, landing in a batch
 * whose purpose is 'samples' rather than 'calendar'.
 *
 * Two things this pins that are easy to get wrong in opposite directions:
 *
 *   1. WIDE ENOUGH. sxr + intake_create must pass the surface gate, or the
 *      whole feature 400s before it reaches any of the layers below it.
 *   2. NOT WIDER. Widening a lane is where authority leaks in. sxr must still
 *      be refused every operation it was refused before, `submission` must
 *      still be intake-only, and -- the one with teeth -- legacy parity must
 *      NOT follow intake_create onto sxr. Samples are native-born and have no
 *      Linear history to stay in step with; a parity leg would mirror them
 *      into a Linear-authoritative team that never asked for them.
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', 'supabase', 'functions', 'production-write');
const edge = fs.readFileSync(path.join(root, 'index.ts'), 'utf8');
let failures = 0;
function ok(value, label) {
  if (value) console.log('  ok  ' + label);
  else { failures++; console.error('FAIL  ' + label); }
}

function extract(source, name) {
  const marker = 'function ' + name + '(';
  let start = source.indexOf(marker);
  if (start < 0) throw new Error('missing ' + name);
  const brace = source.indexOf('{', start);
  let depth = 0, quote = '', escaped = false, line = false, block = false;
  for (let i = brace; i < source.length; i++) {
    const ch = source[i];
    if (line) { if (ch === '\n') line = false; continue; }
    if (block) { if (ch === '*' && source[i + 1] === '/') { block = false; i++; } continue; }
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '/' && source[i + 1] === '/') { line = true; i++; continue; }
    if (ch === '/' && source[i + 1] === '*') { block = true; i++; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error('unclosed ' + name);
}

// Execute the real gate rather than regex it, so this fails on behaviour.
const body = extract(edge, 'assertSurfaceOperation')
  .replace(/:\s*string/g, '')
  .replace(/:\s*void/g, '');
const gate = new Function('GatewayError', body + ' return assertSurfaceOperation;')(
  class GatewayError extends Error {
    constructor(status, code) { super(code); this.status = status; this.code = code; }
  },
);

function allowed(surface, operation) {
  try { gate(surface, operation); return true; } catch (_) { return false; }
}

// --- 1. wide enough --------------------------------------------------------
ok(allowed('sxr', 'intake_create'),
'sxr + intake_create passes the surface gate');
ok(allowed('calendar', 'intake_create') && allowed('submission', 'intake_create'),
'the two lanes that already had intake_create still do');

// --- 2. not wider ----------------------------------------------------------
ok(allowed('sxr', 'status') && allowed('sxr', 'comment'),
'sxr keeps the two operations it already had');
for (const op of ['due', 'assignee', 'attachment', 'create', 'label', 'description']) {
  ok(!allowed('sxr', op), 'sxr is still refused ' + op);
}
ok(!allowed('production', 'intake_create'),
'production is still refused intake_create');
ok(allowed('production', 'create') && !allowed('sxr', 'create'),
'plain create stays production-only');
ok(!allowed('submission', 'status') && !allowed('submission', 'comment'),
'submission is still intake-only');
ok(allowed('workload', 'due') && !allowed('workload', 'status'),
'the workload lane is untouched');

// --- 3. parity does NOT follow the widening --------------------------------
// The teeth of this suite. Read from policy.mjs, which owns the answer.
const policy = fs.readFileSync(path.join(root, 'policy.mjs'), 'utf8');
const parityBody = extract(policy, 'legacyParityAllowed');
const parity = new Function(
  'function lower(v){ return String(v == null ? "" : v).trim().toLowerCase(); }\n'
  + 'function normalizeOperation(v){ return lower(v); }\n'
  + parityBody.replace(/^export\s+/, '') + ' return legacyParityAllowed;')();

ok(parity('calendar', 'intake_create') === true,
'calendar intake still runs a legacy parity leg');
ok(parity('sxr', 'intake_create') === false,
'a samples intake writes the NATIVE leg only -- no parity mirror into a Linear-authoritative team');
ok(parity('sxr', 'status') === true && parity('sxr', 'comment') === true,
'sxr status/comment parity is unchanged by this widening');

// --- 4. the intake stamps purpose AND origin from the surface -------------
// One expression drives both columns, which is what makes "a samples row only
// lands in a samples batch" true by construction rather than by later check.
const intake = extract(edge, 'handleIntakeCreate');
ok(/const intakePurpose = surface === "sxr" \? "samples" : "calendar";/.test(intake),
'the intake derives one purpose value from the surface');
ok(/origin: intakePurpose,/.test(intake),
'every deliverable row takes its origin from that value');
ok(/purpose: intakePurpose,/.test(intake),
'the batch takes its purpose from the SAME value');
ok(!/origin: "calendar"/.test(intake),
'the hardcoded calendar origin is gone, not merely shadowed');

// The persistence trap this feature nearly shipped with: batch_write inserts
// through an EXPLICIT column list, so a key it does not name is dropped with
// no error. Proven on PostgreSQL 16 -- the pre-migration function wrote
// purpose='calendar' when handed 'samples'. Pin that the migration exists and
// names the column in both the insert and the guarded conflict branch.
const migration = fs.readFileSync(
  path.join(__dirname, '..', 'migrations', '2026-08-19-samples-batch-write-purpose.sql'), 'utf8');
ok(/insert into public\.batches[\s\S]*?\n    purpose,/.test(migration),
'batch_write names purpose in its INSERT column list');
ok(/purpose = case when v_row \? 'purpose' then excluded\.purpose else b\.purpose end/.test(migration),
'and preserves it on any update that does not mention it -- otherwise a rename or status change resets a samples batch to calendar');
ok(/coalesce\(nullif\(v_row->>'purpose', ''\), 'calendar'\)/.test(migration),
'an intake that omits purpose still lands as calendar, matching the column default');

if (failures) process.exit(1);
console.log('\nSamples intake lane checks passed');
