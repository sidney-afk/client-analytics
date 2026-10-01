'use strict';
/*
 * The roster cleanup migration (migrations/2026-10-02-roster-stale-cleanup.sql)
 * must stay a one-transaction, never-delete, rule-based script that names no
 * client, keeps the test client, keeps the reroute stamp, and refuses to run
 * when the approved counts no longer match. Source reading only: the SQL itself
 * was proved on a disposable PostgreSQL 16 (see OPEN_REPAIRS / the PR).
 */
const fs = require('fs');
const path = require('path');
const sql = fs.readFileSync(path.join(__dirname, '..', 'migrations', '2026-10-02-roster-stale-cleanup.sql'), 'utf8');
const code = sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
let passed = 0; let failed = 0;
function ok(name, cond) { if (cond) { passed++; console.log('OK  ' + name); } else { failed++; console.log('FAIL ' + name); } }

ok('one transaction (begin and commit once each)', (code.match(/^begin;/gm) || []).length === 1 && (code.match(/^commit;/gm) || []).length === 1);
ok('never deletes or truncates', !/\bdelete\s+from\b/i.test(code) && !/\btruncate\b/i.test(code) && !/\bdrop\b/i.test(code));
ok('all four routing lists are named', ['sample_review_ef_clients', 'calendar_upsert_ef_clients', 'settings_ef_clients', 'write_ui_reroute_clients'].every((k) => code.includes(k)));
ok('keeps the reroute stamp', code.includes("'owner-enrollment-wave-3-full-roster'"));
ok('keeps only active clients and the active test client', /active and kind in \('client','test'\)/.test(code));
ok('refuses without an active test client', /kind = 'test' and active/.test(code) && /no active test client/.test(code));
ok('refuses unless 7 stale slugs', /v_stale <> 7/.test(code));
ok('refuses unless 12 rows to archive', /v_archive <> 12/.test(code));
ok('archives by board_status canceled and leaves the internal row', /board_status = 'canceled'/.test(code) && /kind <> 'internal'/.test(code));
ok('checks all four lists equal the active roster before commit', /is distinct from v_expected/.test(code) && /rolling back/.test(code));
const updates = code.split(';').map((s) => s.trim()).filter((s) => /^update\s+public\./i.test(s));
ok('exactly two UPDATE statements, each with a WHERE (API connections reject a bare update)', updates.length === 2 && updates.every((s) => /\bwhere\b/i.test(s)));
ok('no long dash anywhere', !sql.includes('—'));
console.log('\nroster-stale-cleanup-migration: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
