'use strict';
// Static contract for migrations/2026-09-24-workload-native-snapshot-board-builder*.sql
// (NOT APPLIED). The PG lane (workload-native-postgres.js) proves behaviour;
// this keeps the three files and the Edge filter from drifting apart.
const fs = require('fs'), path = require('path'), assert = require('assert');
const root = path.resolve(__dirname, '..'), read = f => fs.readFileSync(path.join(root, f), 'utf8');
const base = 'migrations/2026-09-24-workload-native-snapshot-board-builder';
const mig = read(base + '.sql'), verify = read(base + '.VERIFY.sql'), rollback = read(base + '.ROLLBACK.sql');
const builder = s => s.match(/create or replace function public\.workload_native_snapshot_board_v1\(\)[\s\S]*?\n\$fn\$;\n/)[0];
let checks = 0; const ok = (v, m) => { assert.ok(v, m); checks++; };
ok(/NOT APPLIED/.test(mig.slice(0, 300)) && /NOT APPLIED/.test(rollback.slice(0, 300)), 'migration and rollback are marked NOT APPLIED');
ok(builder(mig) === builder(verify), 'VERIFY carries the migration builder byte-for-byte');
ok(/\nbegin;\n/.test(verify) && /\nrollback;\n$/.test(verify) && !/\ncommit;/.test(verify), 'VERIFY ends in rollback and never commits');
const edge = read('supabase/functions/workload-plan/native-snapshot.mjs');
const edgeSet = edge.match(/WL_CLOSED_STATUS_TYPES = new Set\(\[([^\]]*)\]\)/)[1].replace(/\s/g, '');
const sqlSets = [...(builder(mig) + verify).matchAll(/not in \(('completed'[^)]*)\)/g)].map(m => m[1].replace(/\s/g, ''));
ok(sqlSets.length >= 2 && sqlSets.every(s => s === edgeSet), 'SQL keep-rule and VERIFY use exactly boardSnapshot\'s closed status types');
for (const [name, text] of [['migration', mig], ['rollback', rollback]]) {
  const revokes = text.match(/^revoke [^;]*;/gm) || [];
  ok(revokes.length >= 2 && revokes.every(r => /from public, anon, authenticated, service_role;$/.test(r)), name + ': every revoke names all four roles');
  ok((text.match(/^grant [^;]*;/gm) || []).every(g => /to service_role;$/.test(g)), name + ': grants go to service_role only');
}
ok(!/grant [^;]*workload_native_snapshot_board_v1/.test(mig), 'nothing is granted on the builder itself');
const call = 'workload_native_snapshot_slim_v1(public.workload_native_snapshot_board_v1())';
ok(mig.split(call).length === 3 && !/slim_v1\(public\.workload_native_snapshot_v1\(\)\)/.test(mig), 'exactly cached_v1 and warm_v1 switch to the builder');
ok(!/function public\.workload_native_snapshot_v1\(/.test(mig) && !/function public\.workload_native_snapshot_slim_v1\(/.test(mig), 'v1 and slim_v1 are left in place');
const fnBody = (s, n) => s.match(new RegExp('create or replace function public\\.' + n + '\\([\\s\\S]*?\\n\\$fn\\$;\\n'))[0];
const warmOrig = fnBody(read('migrations/2026-09-23-workload-native-snapshot-warm.sql'), 'workload_native_snapshot_warm_v1');
ok(fnBody(rollback, 'workload_native_snapshot_warm_v1') === warmOrig, 'rollback restores warm_v1 exactly as its migration wrote it');
ok(/slim_v1\(public\.workload_native_snapshot_v1\(\)\)/.test(fnBody(rollback, 'workload_native_snapshot_cached_v1')) && /drop function if exists public\.workload_native_snapshot_board_v1\(\);/.test(rollback), 'rollback rebuilds from v1 and drops the builder');
ok(/raise exception 'workload_board_verify_failed/.test(verify) && /v\.id_differences <> 0 or v\.row_content_differences <> 0 or v\.envelope_differences <> 0/.test(verify), 'VERIFY raises unless all three counts are zero');
console.log('workload-board-builder-files: ' + checks + ' checks ok');
