// LOCAL DISPOSABLE ONLY. Actual handler/RPC with the existing combined native,
// journal and provenance fixture. Not a deployed-schema reconstruction.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const pg = require('./pg.js');
const { PgSupabase } = require('./seam.js');
const { setup } = require('../../scripts/card-history-integrated-rehearsal.js');
const { INTEGRATED_HISTORY_TABLES } = require('../../scripts/track-b-backup.js');
const edge = await import('./edge.mjs');
if (process.env.CALENDAR_RECOVERY_INTEGRATED !== 'LOCAL_DISPOSABLE_ONLY') throw new Error('explicit_integrated_fixture_confirmation_required');
const cluster = pg.Cluster.fromEnv();
if (!cluster) throw new Error('explicit_owned_local_server_required');
const report = { status: 'INCOMPLETE', groups: [], checks: 0, table_count: INTEGRATED_HISTORY_TABLES.length };
const check = (value, label) => { assert.ok(value, label); report.checks++; };
const eq = (a, b, label) => { assert.deepEqual(a, b, label); report.checks++; };
const sha = value => createHash('sha256').update(value).digest('hex');
const pins = ['qa/calendar-feedback-recovery/integrated.mjs', 'qa/calendar-feedback-recovery/pg.js',
  'qa/calendar-feedback-recovery/seam.js', 'qa/calendar-feedback-recovery/edge.mjs',
  'scripts/card-history-integrated-rehearsal.js', 'scripts/card-history-backup-rehearsal.js',
  'scripts/card-history-closed-corpus-rehearsal.js', 'scripts/card-change-journal-rehearsal.js',
  'supabase/functions/production-write/index.ts', 'supabase/functions/production-write/policy.mjs',
  'supabase/functions/production-write/selected-label-pages.mjs', 'supabase/functions/_shared/staff-role-auth.ts',
  'supabase/functions/_shared/linear-create-id.mjs', 'supabase/functions/calendar-upsert/index.ts',
  'supabase/functions/_shared/browser-write-auth.ts', 'supabase/functions/_shared/browser-write-auth-policy.mjs',
  'supabase/functions/_shared/thumbnail-revisions.ts', 'supabase/functions/_shared/native-card-materialization.mjs',
  'migrations/2026-07-04-a2-writer-edge-functions.sql', 'migrations/2026-07-10-urgent-tweak-pings.sql',
  'migrations/2026-07-13-write-ui-fix-pack-flags.sql', 'migrations/2026-07-13-write-ui-reroute-allowlist.sql',
  'migrations/2026-08-04-client-access-auto-provision.sql',
  'migrations/2026-09-05-card-change-journal.sql', 'migrations/2026-09-05-native-intake-root-manifest.sql',
  'migrations/2026-09-05-native-only-intake.sql', 'migrations/2026-09-05-native-intake-reconcile.sql',
  'migrations/2026-09-05-calendar-feedback-recovery.sql'];
const hashes = () => Object.fromEntries(pins.map(file => [file, sha(fs.readFileSync(path.join(pg.ROOT, file)))]));
report.source_sha256 = hashes();
report.schema_statement_sha256 = [];
const db = pg.createDatabase(cluster, 'cfr_integrated_' + process.pid);
// Match the existing history/native fixture's extensions schema placement.
db.run('alter extension pgcrypto set schema extensions');
const adapter = { query: sql => {
  // Keep UTF-8 migration bytes out of Windows' ANSI command-line conversion.
  const file = path.join(os.tmpdir(), 'cfr-integrated-schema-' + process.pid + '.sql');
  try { fs.writeFileSync(file, '\\pset tuples_only on\n\\pset format unaligned\n' + sql); const result = db.file(file).stdout.trim(); report.schema_statement_sha256.push(sha(sql)); return result; }
  finally { fs.rmSync(file, { force: true }); }
}, rows: sql => db.rows(sql) };
setup(adapter, fs.readFileSync(path.join(pg.ROOT, 'migrations/2026-09-05-calendar-feedback-recovery.sql'), 'utf8'));
// The combined backup fixture deliberately has only its historical dependency
// closure. Add the real client-review access/attribution dependencies needed by
// this handler lane; no installed-schema or effective production grant claim.
for (const file of ['2026-07-04-a2-writer-edge-functions.sql', '2026-07-10-urgent-tweak-pings.sql',
  '2026-07-13-write-ui-fix-pack-flags.sql', '2026-07-13-write-ui-reroute-allowlist.sql',
  '2026-08-04-client-access-auto-provision.sql']) db.file(path.join(pg.ROOT, 'migrations', file));
const seam = new PgSupabase(db);
edge.useSeam(() => seam);
const candidate = await edge.loadProductionWrite();
const frozen = await edge.loadCalendarUpsert();
const headers = token => ({ 'x-syncview-client-token': token, 'x-syncview-source': 'calendar' });
const staff = { 'x-syncview-key': 'synthetic-admin', 'x-syncview-actor': 'Fixture admin', 'x-syncview-source': 'calendar' };
const allRows = () => Object.fromEntries(INTEGRATED_HISTORY_TABLES.map(({ name }) => [name,
  db.rows(`select to_jsonb(t) image from public.${pg.ident(name)} t order by to_jsonb(t)::text`).map(row => row.image)]));
const image = table => allRows()[table];
const SOURCE_AT = '2026-09-05T12:00:00.000Z';
function fixture(component, kind, suffix) {
  const f = pg.seedFixture(db), id = component === 'graphic' ? f.graphic : f.video;
  const native = `c_integrated_${suffix}`;
  const add = { operation: 'comment', surface: 'calendar', entity: 'deliverable', request_id: `calendar:comment:${native}`,
    source_edited_at: SOURCE_AT, id, comment: { body: 'Synthetic combined feedback', native_comment_id: native,
      parent_id: '', audience: 'client', component, is_tweak: kind === 'tweak', round: kind === 'tweak' ? 1 : null, card_id: f.card } };
  const status = kind === 'tweak' ? { operation: 'status', surface: 'calendar', entity: 'deliverable',
    request_id: 'calendar:feedback-status:' + sha(`calendar-feedback-status-v1\n${id}\n${native}`), source_edited_at: SOURCE_AT, id, status: 'tweak' } : null;
  const recovery = { ...add, recover_source: { card_id: f.card, component, kind, expected_updated_at: f.clock,
    fields: status ? { [`${component}_status`]: 'Tweaks Needed', status: 'Tweaks Needed' } : {},
    previous: status ? { [`${component}_status`]: 'Client Approval', status: 'Client Approval' } : {},
    status: status ? { payload: JSON.stringify(status), result: 'accepted' } : null } };
  return { f, id, native, add, status, recovery, component };
}
async function accept(c) {
  const response = await edge.invoke(candidate.handler, c.add, headers(c.f.client.token));
  eq(response.status, 200, 'actual comment acceptance'); eq(response.body.native_committed, true);
  if (c.status) { const status = await edge.invoke(candidate.handler, c.status, headers(c.f.client.token)); eq(status.status, 200); eq(status.body.native_committed, true); }
  await edge.drainBackground();
  return response.body.comment;
}
const recover = c => edge.invoke(candidate.handler, c.recovery, headers(c.f.client.token));
async function group(name, fn) {
  await fn(); report.groups.push(name); console.log('PASS ' + name);
}
function fault(table) {
  db.run(`create function public.cfr_integrated_fault() returns trigger language plpgsql as $$begin raise exception 'synthetic_integrated_capture_failure';end;$$;
    create trigger cfr_integrated_fault before insert on public.${pg.ident(table)} for each row execute function public.cfr_integrated_fault();`);
  return () => db.run(`drop trigger cfr_integrated_fault on public.${pg.ident(table)};drop function public.cfr_integrated_fault();`);
}
try {
  await group('combined native schema and three evidence stores are installed in the disposable fixture', async () => {
    eq(INTEGRATED_HISTORY_TABLES.length, 35);
    eq(db.count('production_card_provenance', "kind='installed'"), 2);
    eq(db.scalar("select count(*) from pg_proc where pronamespace='public'::regnamespace and proname in ('production_intake_root_begin','production_intake_reconcile_children','calendar_feedback_recovery_apply_v1')"), 3);
    eq(db.scalar('select count(*) from pg_foreign_server'), 0);
    eq(db.scalar("select count(*) from pg_trigger where not tgisinternal and tgenabled='O' and tgname in ('card_change_journal_after','zz_production_card_provenance')"), 8);
  });
  for (const [component, kind] of [['video', 'note'], ['graphic', 'tweak']]) await group(`${component} ${kind}: recovery and lost-response replay conserve accepted receipts and provenance`, async () => {
    const c = fixture(component, kind, component); await accept(c);
    const before = allRows();
    eq(before.production_comments.length, 1); eq(before.production_comment_mutation_receipts.length, 1);
    check(before.card_change_journal.some(row => row.relation_name === 'production_comments' && row.row_after?.body === c.add.comment.body));
    const response = await recover(c); eq(response.status, 200); eq(response.body.outcome, 'materialized');
    const after = allRows();
    eq(after.calendar_feedback_materializations.length, 1);
    const card = after.calendar_posts.find(row => row.id === c.f.card);
    const cell = JSON.parse(card[component + '_tweaks']); eq(cell.length, 1); eq(cell[0].id, c.native);
    eq(card[component + '_status'], kind === 'tweak' ? 'Tweaks Needed' : 'Client Approval');
    for (const table of ['production_comments', 'production_comment_mutation_receipts', 'mirror_outbox', 'deliverable_events', 'production_card_provenance']) eq(after[table], before[table], table + ' remains exact');
    const journal = after.card_change_journal.filter(row => !before.card_change_journal.some(old => old.id === row.id));
    eq(journal.length, 1); eq(journal[0].relation_name, 'calendar_posts'); eq(journal[0].row_after, card);
    // Ignore the successful response as a browser would on response loss, then
    // replay exactly the original owned request. No synthetic receipt insert.
    const replay = await recover(c); eq(replay.status, 200); eq(replay.body.outcome, 'already_materialized');
    eq(allRows(), after, 'all35 rows unchanged on replay');
  });
  await group('native lifecycle change remains held and changes no recovery evidence', async () => {
    const c = fixture('video', 'tweak', 'lifecycle'), accepted = await accept(c);
    const lifecycle = { ...c.add, request_id: c.add.request_id + ':resolve', source_edited_at: '2026-09-05T12:05:00.000Z',
      comment: { ...c.add.comment, action: 'resolve', id: accepted.id, expected_version: accepted.version, expected_updated_at: accepted.updated_at } };
    const changed = await edge.invoke(candidate.handler, lifecycle, staff); eq(changed.status, 200); await edge.drainBackground();
    const before = allRows(), held = await recover(c); eq(held.status, 409); eq(held.body.reason, 'native_lifecycle_changed');
    eq(allRows(), before, 'all35 rows conserved by lifecycle hold');
  });
  await group('journal failure rolls back source update and recovery receipt while preserving accepted work', async () => {
    const c = fixture('video', 'tweak', 'journal'); await accept(c);
    const remove = fault('card_change_journal'), before = allRows();
    try { const failed = await recover(c); check(failed.status >= 400); eq(allRows(), before, 'no partial source, journal or receipt commit'); }
    finally { remove(); }
    const retry = await recover(c); eq(retry.status, 200); eq(retry.body.outcome, 'materialized');
    eq(db.count('calendar_feedback_materializations'), 1);
  });
  await group('provenance insertion failure cannot roll back unrelated feedback because no slots change', async () => {
    const c = fixture('video', 'note', 'provenance'); await accept(c);
    const remove = fault('production_card_provenance'), before = image('production_card_provenance');
    try { const done = await recover(c); eq(done.status, 200); eq(done.body.outcome, 'materialized'); eq(image('production_card_provenance'), before); }
    finally { remove(); }
  });
  await group('actual frozen slot writer conserves all35 rows when required provenance insertion fails', async () => {
    const remove = fault('production_card_provenance'), before = allRows();
    try {
      const saved = await edge.invoke(frozen.handler, { client: pg.FIXTURE.client.slug,
        post: { id: pg.FIXTURE.card, graphic_deliverable_id: '__CLEAR_LINK__', name: 'Must roll back with failed provenance' }, comments_base_at: '' },
      { ...headers(pg.FIXTURE.client.token), 'x-syncview-role': 'client' });
      check(saved.status >= 400); await edge.drainBackground(); eq(allRows(), before, 'all35 rows conserved after real trigger refusal');
    } finally { remove(); }
    const saved = await edge.invoke(frozen.handler, { client: pg.FIXTURE.client.slug,
      post: { id: pg.FIXTURE.card, graphic_deliverable_id: '__CLEAR_LINK__', name: 'Successful controlled slot clear' }, comments_base_at: '' },
    { ...headers(pg.FIXTURE.client.token), 'x-syncview-role': 'client' });
    eq(saved.status, 200); await edge.drainBackground();
    eq(db.count('production_card_provenance', "kind='slots_changed'"), 1);
    const after = allRows(); eq(after.calendar_feedback_materializations, before.calendar_feedback_materializations);
    eq(after.production_comment_mutation_receipts, before.production_comment_mutation_receipts);
  });
  check(edge.externalRequests() === 0, 'no provider/network transport');
  eq(hashes(), report.source_sha256, 'tested sources unchanged');
  report.status = 'PASS'; report.final_rows_sha256 = sha(JSON.stringify(allRows()));
  report.limits = 'Synthetic migration-shaped schema, actual handlers/RPCs through synchronous psql seam. No overlapping transactions, real browser, deployed privileges/schema, live journey, restore rehearsal or provider proof. Missing source save is represented by absent source content; the prior browser refusal/refresh proof is separate. Normal feedback has no provenance insertion; its failure control uses the actual frozen slot writer. Faults may consume sequence values despite rollback; full row equality is not sequence equality.';
} catch (error) { report.error = String(error.stack); throw error; }
finally {
  if (process.env.CALENDAR_RECOVERY_INTEGRATED_REPORT) fs.writeFileSync(process.env.CALENDAR_RECOVERY_INTEGRATED_REPORT, JSON.stringify(report, null, 2) + '\n');
  edge.cleanup();
  console.log(JSON.stringify({ status: report.status, groups: report.groups.length, checks: report.checks, table_count: report.table_count }));
}
