'use strict';
// Static rules for migrations/2026-09-26-card-journal-slim.sql (NOT APPLIED).
// The behaviour is proven on real PostgreSQL by scripts/card-journal-slim-rehearsal.js;
// this suite keeps the file's safety properties from drifting offline.
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
let passed = 0;
function ok(cond, msg) { if (!cond) { console.error('FAIL ' + msg); process.exit(1); } passed++; console.log('  ok  ' + msg); }

const mig = read('migrations/2026-09-26-card-journal-slim.sql');
const rb = read('migrations/2026-09-26-card-journal-slim.ROLLBACK.sql');
const base = read('migrations/2026-09-05-card-change-journal.sql');
const code = s => s.split('\n').filter(l => !/^\s*--/.test(l)).join('\n');

ok(/^-- NOT APPLIED/m.test(mig) && /^-- NOT APPLIED/m.test(rb), 'both files are marked NOT APPLIED');
for (const [name, s] of [['migration', code(mig)], ['rollback', code(rb)]]) {
  ok(!/(delete\s+from|truncate|update)\s+(public\.)?card_change_journal\b/i.test(s), `${name} deletes, trims or rewrites no journal row`);
  ok(!/alter\s+table\s+(public\.)?card_change_journal\b/i.test(s), `${name} does not alter the journal table`);
}
const firstBegin = mig.indexOf('\nbegin;');
ok(/create index concurrently if not exists card_change_journal_full_schema_idx/.test(mig.slice(0, firstBegin)),
  'the partial index is built concurrently, before (outside) the transaction');
ok(/01e84755d199ee82f060af0f338e55ff/.test(code(mig)) && /e14642bea1950178cce0067f3ba78fda/.test(code(mig)) && /card_journal_slim_stale/.test(mig),
  'the migration refuses to run if either replaced function changed since review');
ok(/if tg_op = 'UPDATE' and v_changed <@ array\['updated_at'\]::text\[\] then\s*return null;/.test(mig),
  'only an UPDATE whose sole change is updated_at (or nothing) is skipped');
ok(/c\.video_tweaks is distinct from cur\.v/.test(mig) && /not exists\(select 1 from upd\)/.test(mig),
  'the comment merge writes only on a real change and still returns the current row');
for (const fn of ['calendar_merge_comments\\(text,text,text,text,text,text,text\\)', 'card_change_journal_capture\\(\\)', 'card_change_journal_row_schema\\(text, text\\)']) {
  ok(new RegExp(`revoke all on function public\\.${fn}\\s*from public, anon, authenticated, service_role;`).test(mig),
    `${fn.replace(/\\/g, '')}: all four roles revoked`);
}
ok(!/grant[^;]*to[^;]*\b(anon|authenticated|public)\b/i.test(code(mig)), 'nothing is granted to anon, authenticated or public');
const cap = s => s.slice(s.indexOf('function public.card_change_journal_capture()'), s.indexOf('revoke all on function public.card_change_journal_capture()'));
ok(cap(rb) === cap(base), 'the rollback restores the capture function byte for byte as the 2026-09-05 migration defines it');
ok(/updated_at     = now\(\)/.test(rb) && !/is distinct from cur/.test(rb), 'the rollback restores the live comment merge');
ok((mig.match(/card_journal_slim_owner/g) || []).length >= 2 && /production_card_atomic_write_v1\(uuid,jsonb\)/.test(code(mig)),
  'both guards refuse unless calendar_merge_comments and production_card_atomic_write_v1 are owned by postgres');
ok(/HOW TO APPLY/.test(mig) && /-v ON_ERROR_STOP=1 -f migrations\/2026-09-26-card-journal-slim\.sql/.test(mig) && /three separate Supabase SQL/.test(mig),
  'the header gives the psql -f and three-run SQL Editor apply steps');
console.log(`card-journal-slim-migration: ${passed} checks passed`);
