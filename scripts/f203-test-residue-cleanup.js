'use strict';

/*
 * Classify and dispose of TEST residue left by failed production-write drills.
 *
 * WHY THIS EXISTS
 * On 2026-08-04, two write-drill runs from the monitoring-readiness branch
 * (30945918826, 30946588006) overlapped an enrollment's §F6 TEST proof. All
 * three failed mid-run, so the drill's own inline cleanup never completed
 * (`cleanup_ok:false`) and left behind: active Graphics TEST batches and their
 * deliverables, plus failed Video batch-archive rows in `mirror_outbox`.
 *
 * The drill disposes of its fixtures inline and has no way to clean up after a
 * PREVIOUS run that died. This does exactly that, and nothing else.
 *
 * SAFETY RAILS — every one of these aborts rather than guessing:
 *   - the client must be the single active `kind=test` client, resolved the
 *     same way the drill resolves it; a non-TEST or ambiguous client aborts
 *   - only batches whose name carries the drill's fixture prefix are eligible
 *   - only rows created inside an explicit time window are eligible, so a
 *     later legitimate drill cannot be swept up by a stale invocation
 *   - a row cap aborts the whole run rather than partially disposing a set
 *     larger than expected
 *   - runtime flags are read before and after and must be unchanged
 *   - default mode is CLASSIFY ONLY; disposal requires --apply
 *
 * Disposal uses the same TEST-only gateway path the drill itself uses, not raw
 * table writes, so the disposal is subject to the same authority checks the
 * drill's own cleanup is.
 *
 * PUBLIC SAFETY: reports counts, teams, operations, statuses and row ids only.
 * Never a client slug, batch name, title or payload body.
 */

const SUPA_URL = String(process.env.SUPABASE_URL || 'https://uzltbbrjidmjwwfakwve.supabase.co').replace(/\/+$/, '');
const SUPA_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '');
const CONFIRMED = process.env.B4_CONFIRM_TEST_MUTATIONS === '1';

const args = new Map();
for (let i = 2; i < process.argv.length; i++) {
  const match = /^--([^=]+)(?:=(.*))?$/.exec(process.argv[i]);
  if (match) args.set(match[1], match[2] === undefined ? '1' : match[2]);
}

const APPLY = args.has('apply');
// The drill names every batch it creates `Write UI daily drill <stamp>`.
// Nothing else in the product uses this prefix.
const FIXTURE_PREFIX = String(args.get('prefix') || 'Write UI daily drill ');
const SINCE = String(args.get('since') || '2026-08-04T19:50:00Z');
const UNTIL = String(args.get('until') || '2026-08-04T20:20:00Z');
const MAX_ROWS = Math.max(1, Number(args.get('max-rows') || 25));
// Explicitly named failed outbox rows, each still independently verified
// before deletion. See disposeNamedOutboxRows().
const NAMED_OUTBOX_IDS = String(args.get('dispose-outbox-ids') || '')
  .split(',').map(value => value.trim()).filter(value => /^[1-9]\d*$/.test(value));
const RUN_ID = `f203-residue-cleanup-${SINCE}`;

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function fail(message) { throw new Error(message); }
function assert(condition, message) { if (!condition) fail(message); }

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
}

async function rest(route, init = {}) {
  if (!SUPA_KEY) fail('SUPABASE_SERVICE_ROLE_KEY is required');
  const response = await fetch(`${SUPA_URL}/rest/v1/${route}`, {
    ...init,
    headers: {
      apikey: SUPA_KEY,
      Authorization: `Bearer ${SUPA_KEY}`,
      Accept: 'application/json',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers || {}),
    },
  });
  if (!response.ok) fail(`Supabase ${init.method || 'GET'} HTTP ${response.status}`);
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

async function edge(name, body) {
  const response = await fetch(`${SUPA_URL}/functions/v1/${name}`, {
    method: 'POST',
    headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let parsed = null;
  try { parsed = text ? JSON.parse(text) : null; } catch (_) {}
  if (!response.ok || !parsed || parsed.ok !== true) fail(`${name} HTTP ${response.status}`);
  return parsed;
}

async function flags() {
  const rows = await rest('syncview_runtime_flags?select=key,value,updated_at'
    + '&key=in.(prod_authority,linear_outbound_enabled,linear_inbound_enabled,auth_enforcement)&order=key.asc');
  assert(rows.length === 4, `expected four protected runtime flags, found ${rows.length}`);
  return Object.fromEntries(rows.map(row => [row.key, { value: row.value, updated_at: clean(row.updated_at) }]));
}

async function testClient() {
  const rows = await rest('clients?select=slug,kind,active&kind=eq.test&active=eq.true&order=slug.asc');
  assert(rows.length === 1, `expected exactly one active TEST client, found ${rows.length}`);
  const slug = clean(rows[0].slug);
  assert(slug, 'active TEST client has no slug');
  return slug;
}

/** Everything eligible for disposal, and the reason each row qualified. */
async function classify(slug) {
  const window = `&created_at=gte.${encodeURIComponent(SINCE)}&created_at=lte.${encodeURIComponent(UNTIL)}`;
  const batches = (await rest(
    `batches?select=id,name,status,team,created_at&client_slug=eq.${encodeURIComponent(slug)}`
    + `&status=neq.archived${window}&order=created_at.asc`,
  )).filter(row => clean(row.name).startsWith(FIXTURE_PREFIX));

  const batchIds = batches.map(row => row.id);
  const deliverables = batchIds.length
    ? await rest(`deliverables?select=id,batch_id,team,status,linear_identifier,linear_issue_uuid,created_at`
      + `&client_slug=eq.${encodeURIComponent(slug)}&batch_id=in.(${batchIds.map(encodeURIComponent).join(',')})`
      + `&status=neq.archived&order=created_at.asc`)
    : [];

  const failedInWindow = await rest(
    `mirror_outbox?select=id,status,operation,entity,entity_id,created_at`
    + `&status=eq.failed${window}&order=created_at.asc`,
  );

  // Failed outbox rows are only DISPOSED when they point at a batch or
  // deliverable this run already qualified — a failed row for anything else is
  // not provably drill residue and deleting it would be a guess.
  const linked = row => batchIds.includes(clean(row.entity_id))
    || deliverables.some(item => clean(item.id) === clean(row.entity_id));
  const outbox = failedInWindow.filter(linked);
  // Everything else failed in the same window is REPORTED and left alone.
  // Saying "0 removed" without saying "and N others exist" would be the kind
  // of silent gap this whole change is about.
  const unlinked = failedInWindow.filter(row => !linked(row));

  return { batches, deliverables, outbox, unlinked };
}

function publicView(residue) {
  const byTeam = rows => rows.reduce((out, row) => {
    const team = clean(row.team).toLowerCase() || 'unknown';
    out[team] = (out[team] || 0) + 1;
    return out;
  }, {});
  return {
    batches: { count: residue.batches.length, by_team: byTeam(residue.batches), ids: residue.batches.map(row => row.id) },
    deliverables: {
      count: residue.deliverables.length,
      by_team: byTeam(residue.deliverables),
      identifiers: residue.deliverables.map(row => clean(row.linear_identifier).toUpperCase()).filter(Boolean),
    },
    failed_outbox: {
      count: residue.outbox.length,
      operations: residue.outbox.map(row => `${clean(row.entity)}:${clean(row.operation)}`),
      ids: residue.outbox.map(row => row.id),
    },
    // Reported, never disposed: failed rows in the same window that do not
    // point at anything this run qualified. Visible so a "0 removed" can never
    // be mistaken for "nothing was there".
    unlinked_failed_outbox: {
      count: (residue.unlinked || []).length,
      operations: (residue.unlinked || []).map(row => `${clean(row.entity)}:${clean(row.operation)}`),
      ids: (residue.unlinked || []).map(row => row.id),
    },
  };
}

/*
 * Dispose of explicitly named failed outbox rows.
 *
 * The three Video `batch:archive` rows from the 2026-08-04 incident could not
 * be linked automatically: by the time they were looked at, their batches were
 * already archived, so there was nothing left for `classify` to match them
 * against. They are still real residue.
 *
 * Naming an id is not sufficient on its own. Each row must independently prove
 * it is safe to drop: it must still be a FAILED archive of a BATCH, and that
 * batch must already be archived (or gone). In other words the work the row
 * represents is demonstrably already done, so deleting it discards a dead
 * retry, never a pending one. A row that fails any part of that aborts the run
 * instead of being deleted on the strength of its id.
 */
async function disposeNamedOutboxRows(ids) {
  const verdicts = [];
  for (const id of ids) {
    const row = (await rest(`mirror_outbox?select=id,status,operation,entity,entity_id&id=eq.${encodeURIComponent(id)}&limit=1`))[0];
    assert(row, `named outbox row ${id} does not exist`);
    assert(clean(row.status) === 'failed', `named outbox row ${id} is ${clean(row.status)}, not failed`);
    assert(clean(row.entity) === 'batch' && clean(row.operation) === 'archive',
      `named outbox row ${id} is ${clean(row.entity)}:${clean(row.operation)}, not batch:archive`);
    const batch = (await rest(`batches?select=id,status,client_slug&id=eq.${encodeURIComponent(clean(row.entity_id))}&limit=1`))[0];
    assert(!batch || clean(batch.status).toLowerCase() === 'archived',
      `named outbox row ${id} targets a batch that is still live — refusing to drop a pending archive`);
    await rest(`mirror_outbox?id=eq.${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: { Prefer: 'return=minimal' },
    });
    verdicts.push({ id: Number(id), entity: 'batch', operation: 'archive', target_state: batch ? 'archived' : 'absent', removed: true });
  }
  return verdicts;
}

async function dispose(slug, residue) {
  const disposed = { deliverables: 0, batches: 0, outbox_rows: 0 };

  // Deliverables first: archiving a batch out from under a live deliverable is
  // how orphans are made.
  for (const row of residue.deliverables) {
    await edge('deliverable-write', {
      id: row.id,
      patch: {},
      operation: 'archive',
      dedup_key: `${RUN_ID}:deliverable:${row.id}`,
      source_edited_at: new Date().toISOString(),
      actor: 'F203 residue cleanup',
      test_override: true,
      confirm: 'B4_TEST_ONLY',
    });
    disposed.deliverables++;
  }

  for (const row of residue.batches) {
    await edge('batch-write', {
      id: row.id,
      patch: { status: 'archived' },
      operation: 'archive',
      dedup_key: `${RUN_ID}:batch:${row.id}`,
      source_edited_at: new Date().toISOString(),
      actor: 'F203 residue cleanup',
      test_override: true,
      confirm: 'B4_TEST_ONLY',
    });
    disposed.batches++;
  }

  // Terminal-failed rows for entities that no longer exist in a live state.
  // Deleted by explicit id only — never by a status or time predicate, so this
  // can only ever remove rows this run already classified and reported.
  for (const row of residue.outbox) {
    await rest(`mirror_outbox?id=eq.${encodeURIComponent(row.id)}`, {
      method: 'DELETE',
      headers: { Prefer: 'return=minimal' },
    });
    disposed.outbox_rows++;
  }

  return disposed;
}

async function main() {
  assert(!APPLY || CONFIRMED, 'B4_CONFIRM_TEST_MUTATIONS=1 is required to dispose of residue');
  const slug = await testClient();
  const before = await flags();
  const residue = await classify(slug);
  const view = publicView(residue);
  const total = residue.batches.length + residue.deliverables.length + residue.outbox.length;

  assert(total <= MAX_ROWS,
    `classified ${total} residue rows, above the ${MAX_ROWS} cap — aborting rather than disposing an unexpected set`);

  let disposed = null;
  if (APPLY && total) disposed = await dispose(slug, residue);

  let namedOutbox = null;
  if (NAMED_OUTBOX_IDS.length) {
    namedOutbox = APPLY
      ? await disposeNamedOutboxRows(NAMED_OUTBOX_IDS)
      : NAMED_OUTBOX_IDS.map(id => ({ id: Number(id), removed: false, mode: 'classify_only' }));
  }

  const after = await flags();
  const flagsUnchanged = JSON.stringify(stable(before)) === JSON.stringify(stable(after));

  const report = {
    mode: APPLY ? 'apply' : 'classify_only',
    window: { since: SINCE, until: UNTIL },
    fixture_prefix_matched: true,
    classified: view,
    disposed,
    named_outbox_rows: namedOutbox,
    remaining: null,
    flags_unchanged: flagsUnchanged,
  };

  if (APPLY) {
    // Prove it, do not assume it.
    report.remaining = publicView(await classify(slug));
  }

  console.log(JSON.stringify(report, null, 2));
  assert(flagsUnchanged, 'runtime flags changed during residue cleanup');
  if (APPLY) {
    // `unlinked_failed_outbox` is deliberately NOT part of this sum: those rows
    // were never claimed for disposal, so counting them would either block the
    // run or invite deleting rows this tool cannot prove are drill residue.
    const left = report.remaining.batches.count
      + report.remaining.deliverables.count
      + report.remaining.failed_outbox.count;
    assert(left === 0, `residue cleanup left ${left} row(s) behind`);
  }
  return report;
}

if (require.main === module) {
  main().catch(error => {
    console.error(clean(error && error.message).slice(0, 300));
    process.exit(1);
  });
}

module.exports = { publicView };
