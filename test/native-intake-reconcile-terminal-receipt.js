'use strict';
const fs = require('fs');
const assert = require('assert/strict');
const sql = fs.readFileSync('migrations/2026-09-05-native-intake-reconcile.sql', 'utf8');
const runner = fs.readFileSync('scripts/native-intake-reconcile/reconcile-lib.js', 'utf8');
assert.match(sql, /'terminal_ok', v_terminal_ok/);
assert.match(sql, /and \(child->>'terminal_ok'\)::boolean/);
assert.match(sql, /elsif not \(v_child->>'terminal_ok'\)::boolean[\s\S]{0,220}'child_terminal_receipt_missing'/);
assert.match(sql, /elsif not \(v_slot\.child->>'terminal_ok'\)::boolean[\s\S]{0,160}'child_terminal_receipt_missing'/);
assert.match(sql, /select \* into v_receipt from public\.mirror_outbox where dedup_key = v_item->>'child_dedup';[\s\S]{0,420}raise exception 'child_terminal_receipt_missing'/);
assert.match(runner, /'child_terminal_receipt_missing'/);
console.log('native intake reconciliation terminal-receipt checks passed');

// A planned absence is only advisory. The recovery loop must serialize on the
// same key as production_deliverable_write and read the row again before it
// constructs a replacement; the gated disposable lane races that exact writer.
const lock = sql.indexOf("pg_advisory_xact_lock(hashtextextended('production-deliverable:' || (v_row->>'id'), 0))");
const absent = sql.indexOf("select * into v_d from public.deliverables where id = v_row->>'id' for key share;", lock);
const write = sql.indexOf('v_d := public.production_deliverable_write(v_row, v_event);', absent);
assert.ok(lock >= 0 && absent > lock && write > absent);
assert.match(sql.slice(absent, write), /reconcile_child_identity_changed/);
const lane = fs.readFileSync('scripts/native-intake-reconcile/lane.mjs', 'utf8');
assert.match(lane, /S3b-concurrent-production-child-create-after-plan-is-rechecked-under-the-shared-lock/);
assert.match(lane, /production-deliverable:' \|\| \$\{q\(race3Row\.id\)\}/);
assert.match(lane, /production_deliverable_write\(\$\{j\(race3HumanRow\)\}/);
console.log('native intake reconciliation concurrent-child lock checks passed');
