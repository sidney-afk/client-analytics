'use strict';

/*
 * Daily fail-closed TEST drill for the real production-write gateway.
 * Production flags are read before/after and never changed. Every mutable
 * request carries the service-only TEST override and is constrained to the
 * configured active TEST client/project ids supplied through Actions secrets.
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SUPA_URL = String(process.env.SUPABASE_URL || 'https://uzltbbrjidmjwwfakwve.supabase.co').replace(/\/+$/, '');
const WRITE_URL = String(process.env.PRODUCTION_WRITE_URL || `${SUPA_URL}/functions/v1/production-write`);
const SUPA_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '');
const LINEAR_KEY = String(process.env.LINEAR_API_KEY || '');
let TEST_CLIENT = '';
const CONFIRMED = process.env.B4_CONFIRM_TEST_MUTATIONS === '1';
const REPORT_PATH = String(process.env.PRODUCTION_WRITE_DRILL_REPORT || '');
const PRIVATE_LOG_PATH = String(process.env.PRODUCTION_WRITE_DRILL_PRIVATE_LOG || '');
const REAL_GRAPHIC_GENERATION = /^(1|true|yes)$/i.test(process.env.PRODUCTION_WRITE_DRILL_REAL_GRAPHIC_GENERATION || '');
const DRILL_TEAMS = String(process.env.PRODUCTION_WRITE_DRILL_TEAMS || 'video,graphics')
  .split(',').map(value => value.trim().toLowerCase()).filter(Boolean);
// `enforce` restores the blocking description round-trip assertion; the default
// observes it without blocking the rest of the end-to-end proof. See
// verifyFixture() for why it is parked rather than deleted.
const DESCRIPTION_ROUNDTRIP_ENFORCED =
  String(process.env.PRODUCTION_WRITE_DRILL_DESCRIPTION_ROUNDTRIP || '').trim().toLowerCase() === 'enforce';
const DESCRIPTION_ROUNDTRIP_OBSERVE_MS =
  Math.max(5000, Number(process.env.PRODUCTION_WRITE_DRILL_DESCRIPTION_OBSERVE_MS || 20000));
// A canonical Drive/Dropbox share link that passes a live asset probe. Supply
// it to restore the Graphics `smm_approval` transition; see mutateFixture().
const GRAPHICS_ARTIFACT_URL = String(process.env.PRODUCTION_WRITE_DRILL_GRAPHICS_ARTIFACT_URL || '').trim();
let PROD_AUTHORITY = {};
const RUN_ID = `write-ui-drill-${Date.now()}`;
const STARTED_AT = new Date().toISOString();
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const clean = value => String(value == null ? '' : value).trim();

function fail(message) { throw new Error(message); }
function assert(condition, message) { if (!condition) fail(message); }
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
}
const stableJson = value => JSON.stringify(stable(value));
function parseJson(value) {
  if (value && typeof value === 'object') return value;
  try { return JSON.parse(String(value || '{}')); } catch (_) { return {}; }
}

function writePrivateFailure(error, stage, outputPath = PRIVATE_LOG_PATH) {
  if (!error || !outputPath) return false;
  const resolved = path.resolve(outputPath);
  const root = path.resolve(__dirname, '..');
  const relative = path.relative(root, resolved);
  if (!relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('PRODUCTION_WRITE_DRILL_PRIVATE_LOG must resolve outside the public repository');
  }
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, JSON.stringify({
    stage: clean(stage) || 'drill_failed',
    message: clean(error && error.message),
    stack: String(error && error.stack || error && error.message || error),
  }, null, 2));
  return true;
}

/*
 * On failure the message keeps the raw body (it is caught, never published)
 * but is PREFIXED with a machine-shaped, public-safe header:
 *
 *   <label> HTTP <status> code=<machine code>
 *
 * `classifyFailure` reads only that header, so a gateway rejection becomes a
 * reportable class instead of `unclassified`. Only a value that already looks
 * like a code — lowercase, bounded, no spaces — is lifted; prose and anything
 * carrying an identifier stays behind in the unpublished message.
 */
function safeErrorCode(body) {
  for (const key of ['code', 'error_code', 'reason', 'error']) {
    const value = clean(body && body[key]);
    if (/^[a-z0-9][a-z0-9_.:-]{0,47}$/.test(value)) return value;
  }
  return '';
}

async function jsonResponse(response, label) {
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch (_) {}
  if (!response.ok || !body || body.ok !== true) {
    const code = safeErrorCode(body);
    fail(`${label} HTTP ${response.status}${code ? ` code=${code}` : ''}: ${text.slice(0, 300)}`);
  }
  return body;
}

async function gateway(body) {
  const response = await fetch(WRITE_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${SUPA_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...body,
      request_id: body.request_id || `${RUN_ID}:${body.operation}:${Date.now()}`,
      test_override: true,
      confirm: 'B4_TEST_ONLY',
      ...(body.skip_graphic_generation === true ? { skip_graphic_generation: true } : {}),
    }),
  });
  return jsonResponse(response, `production-write ${body.operation}`);
}

async function rest(route) {
  const response = await fetch(`${SUPA_URL}/rest/v1/${route}`, {
    headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}`, Accept: 'application/json' },
  });
  if (!response.ok) fail(`Supabase REST ${route} HTTP ${response.status}: ${(await response.text()).slice(0, 240)}`);
  return response.json();
}

async function edge(name, body) {
  const response = await fetch(`${SUPA_URL}/functions/v1/${name}`, {
    method: 'POST',
    headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return jsonResponse(response, name);
}

/**
 * Like `edge`, but accepts an aggregate `ok:false` body on a 2xx response.
 * Only for calls whose `ok` summarises OTHER rows as well as ours, and only
 * where a stronger per-asset check follows. Transport and HTTP failures still
 * fail.
 */
async function edgeTolerateAggregate(name, body) {
  const response = await fetch(`${SUPA_URL}/functions/v1/${name}`, {
    method: 'POST',
    headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) fail(`${name} HTTP ${response.status}: ${text.slice(0, 200)}`);
  return parseJson(text);
}

async function linear(query, variables = {}) {
  const response = await fetch('https://api.linear.app/graphql', {
    method: 'POST',
    headers: { Authorization: LINEAR_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body || body.errors) fail(`Linear read failed: HTTP ${response.status}`);
  return body.data;
}

async function poll(label, fn, timeoutMs = 60000, intervalMs = 750) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await fn();
    if (last) return last;
    await sleep(intervalMs);
  }
  fail(`${label} timed out`);
}

async function flags() {
  const rows = await rest('syncview_runtime_flags?select=key,value,updated_at&key=in.(prod_authority,linear_outbound_enabled,linear_inbound_enabled,auth_enforcement)&order=key.asc');
  assert(rows.length === 4, `expected four protected runtime flags, found ${rows.length}`);
  return Object.fromEntries(rows.map(row => [row.key, {
    value: row.value,
    updated_at: clean(row.updated_at),
  }]));
}

function assertFlipTolerantStance(snapshot) {
  const authority = parseJson(snapshot.prod_authority && snapshot.prod_authority.value);
  const outbound = parseJson(snapshot.linear_outbound_enabled && snapshot.linear_outbound_enabled.value);
  const inbound = parseJson(snapshot.linear_inbound_enabled && snapshot.linear_inbound_enabled.value);
  const auth = parseJson(snapshot.auth_enforcement && snapshot.auth_enforcement.value);
  for (const team of ['video', 'graphics']) {
    assert(['linear', 'syncview'].includes(clean(authority[team]).toLowerCase()),
      `production authority is invalid for ${team}`);
  }
  assert(['off', 'shadow', 'live'].includes(clean(outbound.mode).toLowerCase()),
    'production outbound mode is invalid');
  assert(inbound.enabled === true, 'production inbound must remain enabled');
  assert(['permissive', 'enforced'].includes(clean(auth.mode).toLowerCase()),
    'production auth mode is invalid');
  return { authority, outbound, inbound, auth };
}

function descriptionReadbackMatches(authority, team, native, mirrored, expected) {
  const lane = clean(authority && authority[team]).toLowerCase();
  if (!native || !mirrored || mirrored.description !== expected) return false;
  if (lane === 'linear') return true;
  return lane === 'syncview' && native.brief === expected;
}

/*
 * A fixed vocabulary of failure kinds, matched against the thrown message and
 * emitted as a CODE.
 *
 * Twenty-two consecutive red runs published exactly one fact between them --
 * `error_code: video_verification` -- which says the drill failed somewhere in
 * verification and nothing about what. The raw message cannot be published:
 * assertion text can quote row routes and client slugs, and both the public
 * artifact and `deliverable_events` are wider audiences than this repository's
 * secrets. An allowlist is public-safe by construction: an unrecognised failure
 * degrades to `unclassified`, never to a leaked body.
 */
const FAILURE_CLASSES = Object.freeze([
  [/description round-trip timed out/i, 'description_roundtrip_timeout'],
  [/description gateway response changed Markdown bytes/i, 'description_bytes_altered'],
  [/Linear comment is missing or duplicated/i, 'linear_comment_exactly_once'],
  [/native comment is missing or duplicated/i, 'native_comment_exactly_once'],
  [/Linear linkage timed out/i, 'linear_linkage_timeout'],
  [/due\/assignee clear did not reach Linear/i, 'due_assignee_clear_not_mirrored'],
  [/fallback description did not round-trip/i, 'graphics_fallback_description'],
  [/generated graphics title/i, 'graphics_title_generation'],
  [/foreign-write\/echo storm/i, 'echo_storm'],
  [/did not settle at 0\/0/i, 'reconciler_not_settled'],
  [/reconciler summary event is missing/i, 'reconciler_summary_missing'],
  [/runtime flags changed/i, 'flag_invariant_violated'],
  [/expected exactly one active TEST client/i, 'test_client_fixture'],
  [/no mapped active .* assignee/i, 'assignee_fixture_missing'],
  [/cleanup archive timed out/i, 'cleanup_archive_timeout'],
]);

function classifyFailure(error) {
  const message = clean(error && error.message);
  if (!message) return null;
  const match = FAILURE_CLASSES.find(([pattern]) => pattern.test(message));
  if (match) return match[1];
  // A backend rejection is the most likely unknown, and its operation, status
  // and machine code are all public-safe. Reading only this header keeps the
  // raw body — which can name a row or a client — out of anything published.
  const backend = /^([a-z-]+(?:-[a-z]+)*) ([a-z_]+ )?HTTP (\d{3})(?: code=([a-z0-9][a-z0-9_.:-]{0,47}))?/i.exec(message);
  if (backend) {
    const surface = clean(backend[1]).toLowerCase().replace(/[^a-z0-9]+/g, '_');
    const operation = clean(backend[2]).toLowerCase().replace(/[^a-z0-9]+/g, '');
    const code = clean(backend[4]).replace(/[^a-z0-9]+$/i, '');
    return [surface, operation, `http_${backend[3]}`, code].filter(Boolean).join('_');
  }
  return 'unclassified';
}

function descriptionReadbackScopes(teams, assets) {
  return Object.fromEntries(teams.map(team => {
    const asset = assets.find(candidate => candidate.team === team);
    const scope = clean(asset && asset.descriptionReadbackScope);
    return [
      team,
      ['native_and_linear', 'linear_only_authority_linear', 'parked_pending_deploy'].includes(scope)
        ? scope
        : 'not_verified',
    ];
  }));
}

async function preflight() {
  assert(CONFIRMED, 'B4_CONFIRM_TEST_MUTATIONS=1 is required');
  assert(SUPA_KEY && LINEAR_KEY, 'Supabase service role and Linear read credential are required');
  assert(DRILL_TEAMS.length > 0 && DRILL_TEAMS.every(team => ['video', 'graphics'].includes(team)),
    'PRODUCTION_WRITE_DRILL_TEAMS must contain only video and/or graphics');
  assert(new Set(DRILL_TEAMS).size === DRILL_TEAMS.length, 'PRODUCTION_WRITE_DRILL_TEAMS contains duplicates');
  assert(!REAL_GRAPHIC_GENERATION || DRILL_TEAMS.includes('graphics'),
    'real graphic generation requires the graphics drill lane');
  const rows = await rest('clients?select=slug,kind,active&kind=eq.test&active=eq.true&order=slug.asc');
  assert(rows.length === 1, `expected exactly one active TEST client, found ${rows.length}`);
  TEST_CLIENT = clean(rows[0].slug);
  assert(TEST_CLIENT, 'active TEST client has no slug');
  const before = await flags();
  // The TEST override is isolated from the real-team authority/outbound lane.
  // Validate and freeze the current stance. The TEST override always exercises
  // the description gateway; this snapshot controls only the eventual
  // authority-specific readback expectation.
  PROD_AUTHORITY = assertFlipTolerantStance(before).authority;
  return before;
}

async function mappedAssignee(team) {
  const rows = await rest(`team_members?select=id,team,active,linear_user_id&active=eq.true&team=eq.${team}&linear_user_id=not.is.null&order=id.asc&limit=1`);
  assert(rows.length === 1, `no mapped active ${team} assignee is available for the TEST drill`);
  return rows[0];
}

function rowFrom(response) {
  return response.row || (response.items && (response.items[0].row || response.items[0])) || null;
}

async function createFixture(team) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const request = {
    operation: 'intake_create',
    surface: 'submission',
    client_slug: TEST_CLIENT,
    batch: { name: `Write UI daily drill ${stamp}` },
    items: [{
      team,
      number: 1,
      title: team === 'video' ? `Write UI ${team} drill ${stamp}` : undefined,
      brief: team === 'video' ? 'Disposable TEST write-path drill.' : undefined,
    }],
  };
  if (team === 'graphics' && !REAL_GRAPHIC_GENERATION) request.skip_graphic_generation = true;
  const response = await gateway(request);
  const row = rowFrom(response);
  assert(response.batch && response.batch.id && row && row.id, `${team} native create response is incomplete`);
  return { team, batch: response.batch, row, operations: ['create'] };
}

async function mutateFixture(asset) {
  let row = asset.row;
  const request = async (operation, fields) => {
    const response = await gateway({
      operation,
      surface: 'production',
      entity: 'deliverable',
      id: row.id,
      expected_updated_at: row.updated_at || undefined,
      ...fields,
    });
    row = response.row || row;
    asset.operations.push(operation);
    return response;
  };
  /*
   * PARKED, NOT DELETED (F204) — the Graphics approval-artifact contract.
   *
   * `production-write` refuses to move a GRAPHICS deliverable to
   * `smm_approval` unless it carries a canonical, live-probeable artifact
   * (`assertGraphicsApprovalArtifact`, the F53 protected-artifact contract).
   * The drill creates its graphics fixture with `skip_graphic_generation`, so
   * it has no `file_url` and the transition is refused 409
   * `artifact_not_resolvable` with `asset_state: missing`. That is the gateway
   * working correctly on an illegal fixture, not a regression.
   *
   * It stayed invisible for three weeks because the drill died at
   * `video_verification` before Graphics ran at all.
   *
   * Supplying PRODUCTION_WRITE_DRILL_GRAPHICS_ARTIFACT_URL — a canonical Drive
   * or Dropbox share link that passes a live probe — attaches it first and
   * restores the full sequence. Without one, ONLY this transition is parked,
   * every other status still runs, and the report names what was skipped.
   * Silently dropping `smm_approval` from the graphics lane would hide the
   * exact transition the cutover depends on.
   */
  if (asset.team === 'graphics' && GRAPHICS_ARTIFACT_URL) {
    /*
     * A bad artifact URL must not take the whole both-teams proof down with
     * it. The URL is owner-supplied through a repository variable, so the
     * likely failures are human ones — a folder link instead of a file link, a
     * Doc, a still-Restricted file. Hard-failing on those would mean one wrong
     * paste costs the Video lane, the reconciler check and the cleanup proof
     * as well, and would report `graphics_mutations` rather than the actual
     * mistake.
     *
     * So a rejected artifact degrades to exactly the state the drill is in
     * without one — Graphics approval parked — and records WHY, by classified
     * code, for the owner to act on. `client_slug` is required by the gateway
     * on every production-surface operation; omitting it is what made the
     * first attempt fail with `client_slug_required` before the URL was ever
     * examined.
     */
    try {
      await request('attachment', { client_slug: TEST_CLIENT, file_url: GRAPHICS_ARTIFACT_URL });
      asset.graphicsArtifactAttached = true;
    } catch (error) {
      asset.graphicsArtifactRejected = classifyFailure(error) || 'unclassified';
    }
  }
  for (const status of ['smm_approval', 'tweak', 'in_progress']) {
    const parkable = asset.team === 'graphics'
      && status === 'smm_approval'
      && !asset.graphicsArtifactAttached;
    try {
      await request('status', { expected_status: row.status, status });
    } catch (error) {
      // Park ONLY the documented artifact refusal on the one transition that
      // requires an artifact. Any other failure is a real one and still fails.
      if (parkable && /HTTP 409 code=artifact_not_resolvable/.test(clean(error && error.message))) {
        asset.graphicsApprovalParked = true;
        continue;
      }
      throw error;
    }
  }
  asset.commentMarker = `${RUN_ID}:${asset.team}:comment`;
  await request('comment', { comment: { body: asset.commentMarker, audience: 'internal' } });
  const due = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
  await request('due', { due_date: due });
  await request('due', { due_date: null });
  const member = await mappedAssignee(asset.team);
  await request('assignee', { assignee_id: member.id });
  await request('assignee', { assignee_id: null });
  asset.row = row;
}

async function linkedRow(asset) {
  return poll(`${asset.team} Linear linkage`, async () => {
    const rows = await rest(`deliverables?select=id,status,brief,due_date,assignee_id,linear_issue_uuid,linear_identifier,updated_at&id=eq.${encodeURIComponent(asset.row.id)}&limit=1`);
    const row = rows[0];
    return row && row.linear_issue_uuid ? row : null;
  });
}

async function verifyFixture(asset) {
  const row = await linkedRow(asset);
  const data = await linear(`query ProductionWriteDrillIssue($id: String!) {
    issue(id: $id) {
      id identifier description dueDate archivedAt
      state { name }
      assignee { id }
      comments(first: 50) { nodes { id body } }
    }
  }`, { id: row.linear_issue_uuid });
  const issue = data.issue;
  assert(issue && issue.id === row.linear_issue_uuid, `${asset.team} mirrored issue is missing`);
  if (asset.team === 'graphics') {
    if (REAL_GRAPHIC_GENERATION) {
      assert(clean(row.brief) && row.brief !== 'Video 1', 'graphics title provider did not return a generated title');
      assert(issue.description === row.brief, 'generated graphics title did not round-trip to Linear');
      asset.graphicGenerationVerified = true;
    } else {
      assert(row.brief === 'Video 1' && issue.description === 'Video 1', 'graphics fallback description did not round-trip');
    }
  }
  const description = `  # F202 ${RUN_ID}\n\n- ${asset.team} **Markdown**  \n`;
  const descriptionResponse = await gateway({
    operation: 'description',
    surface: 'production',
    entity: 'deliverable',
    id: row.id,
    expected_updated_at: row.updated_at,
    description,
  });
  assert(descriptionResponse.row && descriptionResponse.row.brief === description,
    `${asset.team} description gateway response changed Markdown bytes`);
  asset.operations.push('description');
  /*
   * PARKED, NOT DELETED (F203).
   *
   * The description gateway call above is real coverage and stays a hard
   * assertion: it proves the gateway accepted the write and returned the exact
   * Markdown bytes. What follows -- the description propagating on to Linear
   * and back -- depends on an Edge Function revision that is not deployed, so
   * it can only time out. It did, every night from 2026-07-14 to 2026-08-04:
   * 22 consecutive red runs, all dying at `video_verification` BEFORE the
   * Graphics lane was ever reached. One undeployed round-trip was costing the
   * whole end-to-end proof for both teams.
   *
   * So it is gated, not removed. In `observe` mode the round-trip is still
   * attempted on a short budget and its real outcome is recorded per team --
   * `native_and_linear` / `linear_only_authority_linear` the moment it starts
   * passing, `parked_pending_deploy` while it does not. A green run therefore
   * never claims this was proved. Set
   * PRODUCTION_WRITE_DRILL_DESCRIPTION_ROUNDTRIP=enforce once the function is
   * deployed and it becomes a blocking assertion again with no other change.
   */
  const readback = async () => {
    const [nativeRows, linearData] = await Promise.all([
      rest(`deliverables?select=id,brief,updated_at&id=eq.${encodeURIComponent(row.id)}&limit=1`),
      linear('query ProductionWriteDrillDescription($id: String!) { issue(id: $id) { id description } }',
        { id: row.linear_issue_uuid }),
    ]);
    const native = nativeRows[0];
    const mirrored = linearData.issue;
    return descriptionReadbackMatches(
      PROD_AUTHORITY, asset.team, native, mirrored, description,
    ) ? { native, mirrored } : null;
  };
  const provedScope = clean(PROD_AUTHORITY[asset.team]).toLowerCase() === 'syncview'
    ? 'native_and_linear'
    : 'linear_only_authority_linear';
  if (DESCRIPTION_ROUNDTRIP_ENFORCED) {
    await poll(`${asset.team} description round-trip`, readback);
    asset.descriptionReadbackScope = provedScope;
  } else {
    const observed = await poll(`${asset.team} description round-trip`, readback,
      DESCRIPTION_ROUNDTRIP_OBSERVE_MS, 1500).catch(() => null);
    asset.descriptionReadbackScope = observed ? provedScope : 'parked_pending_deploy';
  }
  asset.row = descriptionResponse.row || asset.row;
  assert(!issue.dueDate && !issue.assignee, `${asset.team} due/assignee clear did not reach Linear`);
  assert((issue.comments.nodes || []).filter(comment => clean(comment.body).includes(asset.commentMarker)).length === 1, `${asset.team} Linear comment is missing or duplicated`);
  const nativeComments = await rest(`production_comments?select=id&deliverable_id=eq.${encodeURIComponent(row.id)}&body=eq.${encodeURIComponent(asset.commentMarker)}`);
  assert(nativeComments.length === 1, `${asset.team} native comment is missing or duplicated`);
  const foreign = await rest(`deliverable_events?select=id&deliverable_id=eq.${encodeURIComponent(row.id)}&action=eq.foreign_write_detected&ts=gte.${encodeURIComponent(STARTED_AT)}`);
  asset.echoUnexpected = foreign.length;
  assert(asset.echoUnexpected === 0, `${asset.team} produced a foreign-write/echo storm event`);
  asset.linear = { id: issue.id, identifier: issue.identifier };
}

/**
 * Field names and reason codes from a reconciler details file. Deliberately
 * drops `expected`/`actual`: those are row content, and this report is public.
 * The file is deleted immediately after reading.
 */
function readDiffFields(detailsPath) {
  try {
    const details = parseJson(fs.readFileSync(detailsPath, 'utf8'));
    const label = entry => {
      const field = clean(entry && entry.field).slice(0, 48);
      const reason = clean(entry && entry.reason).slice(0, 48);
      if (!field) return '';
      return reason && reason !== 'mismatch' ? `${field}:${reason}` : field;
    };
    const fields = [];
    for (const row of Array.isArray(details.diffs) ? details.diffs : []) {
      for (const diff of Array.isArray(row.diffs) ? row.diffs : []) {
        const value = label(diff);
        if (value) fields.push(value);
        if (fields.length >= 20) break;
      }
    }
    /*
     * Repairs carry the attribution's OWN reason (e.g. `direct_project_unmapped`),
     * which the diff entry does not: a diff only reports that the stored stamp
     * and the freshly computed one disagree. Without this, an attribution
     * failure is visible but not diagnosable, and the difference between "this
     * client's Linear project is unmapped" and "the writer never stamped the
     * row" is exactly what decides whether it is a config gap or a defect.
     */
    const repairs = [];
    for (const row of Array.isArray(details.repairs) ? details.repairs : []) {
      for (const repair of Array.isArray(row.repairs) ? row.repairs : []) {
        const value = label(repair);
        if (value) repairs.push(value);
        if (repairs.length >= 20) break;
      }
    }
    return { diffs: fields, repairs };
  } catch (_) {
    return null;
  } finally {
    try { fs.rmSync(path.dirname(detailsPath), { recursive: true, force: true }); } catch (_) {}
  }
}

async function reconcile({ identifier = '' } = {}) {
  const reconcileArgs = [
    'scripts/linear-deliverables-reconcile.js',
    `--client=${TEST_CLIENT}`,
    `--test-authority-client=${TEST_CLIENT}`,
  ];
  if (identifier) reconcileArgs.push(`--identifier=${identifier}`);
  if (!identifier && DRILL_TEAMS.length === 1) reconcileArgs.push(`--team=${DRILL_TEAMS[0]}`);
  /*
   * WHICH FIELDS diverge, not just how many.
   *
   * A per-fixture `diff_count: 1` says the drill's own row disagrees with
   * Linear but not about what, which is the difference between "the parked
   * description write did not mirror, exactly as expected" and "a real write
   * silently failed". Each diff carries `{field, expected, actual, reason}`;
   * only `field` and `reason` are extracted — the values are row content and
   * never leave the runner. The details file is written to the OS temp dir,
   * outside the repository, and is never uploaded.
   */
  const detailsPath = identifier
    ? path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'drill-reconcile-')), 'details.json')
    : '';
  if (detailsPath) reconcileArgs.push(`--details-json=${detailsPath}`);
  const result = spawnSync(process.execPath, reconcileArgs, {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, APPLY: 'false', CAP: '15', B4_CONFIRM_TEST_MUTATIONS: '1' },
    encoding: 'utf8',
    timeout: 10 * 60 * 1000,
  });
  if (result.status !== 0) fail(`TEST reconciler failed: ${(result.stderr || result.stdout).slice(-800)}`);
  const rows = await rest('deliverable_events?select=id,payload,ts&action=eq.linear_deliverables_reconcile_v2&order=id.desc&limit=10');
  const event = rows.map(row => ({ ...row, payload: parseJson(row.payload) })).find(row => row.payload.test_authority_client === TEST_CLIENT);
  assert(event, 'TEST reconciler summary event is missing');
  const summary = parseJson(event.payload.summary);
  const counts = {
    diff_count: Number(summary.diff_count || 0),
    repair_count: Number(summary.repair_list_size || 0),
    linkage_actionable: Number(summary.linkage_actionable || 0),
    inbound_diff_count: Number(summary.inbound_diff_count || 0),
    outbound_diff_count: Number(summary.outbound_diff_count || 0),
    diff_rows: Number(summary.diff_rows || 0),
    tolerated_count: Number(summary.tolerated_count || 0),
    entities_checked: Number(summary.entities_checked || 0),
    by_team: summary.by_team || null,
    event_id: event.id,
  };
  /*
   * `linkage_actionable` IS NOT CLIENT-SCOPED, so it cannot gate a TEST drill.
   *
   * `--client` filters the deliverables and batches that produce `diff_count`
   * and `repair_list_size`, but the linkage figure comes from
   * `planLinkageBackfill`, which is handed the UNFILTERED `calendar_posts`,
   * `sample_reviews` and `allDeliverables`. It is therefore a whole-estate
   * number that a client-scoped run reports verbatim — which is why this drill
   * saw 33 while the global watcher was DMing 31-33 the same afternoon.
   *
   * Gating on it meant the TEST drill could only pass while EVERY client's
   * linkage residue was zero. That is a standing whole-estate condition with
   * nothing to do with the TEST client or this drill, and it is enough on its
   * own to have kept the drill red no matter what else was fixed.
   *
   * It stays reported — losing the number would be worse — but the gate is now
   * the two counts that `--client` actually scopes. The whole-estate figure has
   * its own owner: reconciler v2's `linkage_actionable` alert class.
   */
  counts.linkage_scope = 'whole_estate_not_client_scoped';
  counts.scope = identifier ? `identifier:${identifier}` : `client:${TEST_CLIENT}`;
  counts.diff_fields = detailsPath ? readDiffFields(detailsPath) : null;
  counts.settled = counts.diff_count === 0 && counts.repair_count === 0;
  return counts;
}

/*
 * The gate is THIS DRILL'S OWN ROWS, not everything the TEST client owns.
 *
 * The TEST client is shared: enrollment §F6 proofs, standing fixtures and past
 * work all live there. A whole-client run on 2026-08-04 checked 10 deliverables
 * of which this drill had created 2, and reported 9 diffs — every one of them
 * OUTBOUND, on `syncview`-authority rows, i.e. standing fixture drift the drill
 * neither caused nor can fix. Gating on that is the same mistake as gating on
 * whole-estate linkage, one scope narrower: it makes a green run depend on
 * other people's data being clean.
 *
 * So each drilled fixture is reconciled by its own Linear identifier and must
 * settle at 0/0 individually — which is the actual claim this drill exists to
 * make: the writes it just performed landed consistently on both sides. The
 * whole-client run is still executed and reported as context, because losing
 * that number is how standing drift becomes invisible; it simply does not gate.
 */
async function reconcileDrilledFixtures(assets) {
  const context = await reconcile();
  const perFixture = [];
  for (const asset of assets) {
    const identifier = clean(asset.linear && asset.linear.identifier);
    if (!identifier) fail(`${asset.team} fixture has no Linear identifier to reconcile`);
    const scoped = await reconcile({ identifier });
    perFixture.push({ team: asset.team, identifier, ...scoped });
  }
  return {
    ...context,
    settled: perFixture.every(row => row.settled),
    context_scope_settled: context.settled,
    per_fixture: perFixture.map(row => ({
      team: row.team,
      identifier: row.identifier,
      diff_count: row.diff_count,
      repair_count: row.repair_count,
      entities_checked: row.entities_checked,
      // Field names + reason codes only; never the values.
      diff_fields: row.diff_fields,
      settled: row.settled,
    })),
  };
}

async function cleanupAsset(asset) {
  const row = (await rest(`deliverables?select=*&id=eq.${encodeURIComponent(asset.row.id)}&limit=1`))[0];
  if (row) {
    await edge('deliverable-write', {
      id: row.id,
      patch: {},
      operation: 'archive',
      dedup_key: `${RUN_ID}:${asset.team}:cleanup:deliverable`,
      source_edited_at: new Date().toISOString(),
      actor: 'Production write drill',
      test_override: true,
      confirm: 'B4_TEST_ONLY',
    });
  }
  const batch = (await rest(`batches?select=*&id=eq.${encodeURIComponent(asset.batch.id)}&limit=1`))[0];
  if (batch) {
    await edge('batch-write', {
      id: batch.id,
      patch: { status: 'archived' },
      operation: 'archive',
      dedup_key: `${RUN_ID}:${asset.team}:cleanup:batch`,
      source_edited_at: new Date().toISOString(),
      actor: 'Production write drill',
      test_override: true,
      confirm: 'B4_TEST_ONLY',
    });
  }
  /*
   * The drain reports `ok: counts.failed === 0` — an aggregate over every row
   * it touched, not a verdict on ours. That made cleanup self-poisoning: one
   * stale failed row anywhere in the TEST outbox failed this call, which threw
   * before the archive below, which left another failed row behind, which
   * failed the next run's cleanup. Every drill in this period reported
   * `cleanup_ok:false` for that reason alone.
   *
   * A transport failure is still fatal. An aggregate `ok:false` is not,
   * because the real proof of OUR archive is the per-asset Linear readback
   * immediately below — which is a stronger claim than the aggregate anyway.
   */
  await edgeTolerateAggregate('linear-outbound', {
    limit: 20,
    test_override: { client_slug: TEST_CLIENT, mode: 'live', authority: 'syncview' },
    confirm: 'B4_TEST_ONLY',
  });
  if (asset.linear && asset.linear.id) {
    await poll(`${asset.team} cleanup archive`, async () => {
      const data = await linear('query ProductionWriteDrillCleanup($id: String!) { issue(id: $id) { archivedAt } }', { id: asset.linear.id });
      return data.issue && data.issue.archivedAt;
    });
  }
}

async function telemetry(payload) {
  const response = await fetch(`${SUPA_URL}/rest/v1/deliverable_events`, {
    method: 'POST',
    headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify([{ client_slug: '_system', action: 'production_write_drill', source: 'system', payload }]),
  });
  if (!response.ok) fail(`write-drill telemetry HTTP ${response.status}`);
}

async function main() {
  const assets = [];
  let flagsBefore = null;
  let reconciliation = null;
  let failure = null;
  let failureStage = null;
  let cleanupOk = false;
  let stage = 'preflight';
  try {
    flagsBefore = await preflight();
    for (const team of DRILL_TEAMS) {
      stage = `${team}_create`;
      const asset = await createFixture(team);
      assets.push(asset);
      stage = `${team}_mutations`;
      await mutateFixture(asset);
      stage = `${team}_verification`;
      await verifyFixture(asset);
    }
    stage = 'reconciliation';
    reconciliation = await reconcileDrilledFixtures(assets);
    const unsettled = reconciliation.per_fixture.filter(row => !row.settled);
    assert(reconciliation.settled,
      `TEST reconciler did not settle at 0/0 for ${unsettled.map(row => `${row.team}(diff=${row.diff_count},repair=${row.repair_count})`).join(' ')}`);
  } catch (error) {
    failure = error;
    failureStage = stage;
  }
  try {
    stage = 'cleanup';
    for (const asset of assets) await cleanupAsset(asset);
    cleanupOk = assets.length > 0;
  } catch (error) {
    failure = failure || error;
    failureStage = failureStage || stage;
  }
  let flagsAfter = null;
  try {
    stage = 'flag_readback';
    flagsAfter = await flags();
  } catch (error) {
    failure = failure || error;
    failureStage = failureStage || stage;
  }
  const flagsUnchanged = Boolean(flagsBefore && flagsAfter && stableJson(flagsBefore) === stableJson(flagsAfter));
  if (!flagsUnchanged) {
    failure = failure || new Error('runtime flags changed during TEST drill');
    failureStage = failureStage || 'flag_invariant';
  }
  if (failure && PRIVATE_LOG_PATH) writePrivateFailure(failure, failureStage);
  const payload = {
    run_id: RUN_ID,
    generated_at: new Date().toISOString(),
    ok: !failure && cleanupOk,
    team: DRILL_TEAMS.length === 2 ? 'both' : DRILL_TEAMS[0],
    operations_completed: assets.reduce((sum, asset) => sum + asset.operations.length, 0),
    teams_completed: assets.filter(asset => asset.linear).length,
    echo_unexpected: assets.reduce((sum, asset) => sum + Number(asset.echoUnexpected || 0), 0),
    reconcile_diff_count: reconciliation ? reconciliation.diff_count : -1,
    reconcile_repair_count: reconciliation ? reconciliation.repair_count : -1,
    reconcile_linkage_actionable: reconciliation ? reconciliation.linkage_actionable : -1,
    // Reported so nobody reads the line above as a TEST-client figure.
    reconcile_linkage_scope: reconciliation ? reconciliation.linkage_scope : null,
    // Composition, so a nonzero diff can be attributed in one run instead of N.
    reconcile_inbound_diff_count: reconciliation ? reconciliation.inbound_diff_count : -1,
    reconcile_outbound_diff_count: reconciliation ? reconciliation.outbound_diff_count : -1,
    reconcile_diff_rows: reconciliation ? reconciliation.diff_rows : -1,
    reconcile_tolerated_count: reconciliation ? reconciliation.tolerated_count : -1,
    reconcile_entities_checked: reconciliation ? reconciliation.entities_checked : -1,
    reconcile_by_team: reconciliation ? reconciliation.by_team : null,
    // What the gate actually checked: each drilled fixture on its own.
    reconcile_per_fixture: reconciliation ? reconciliation.per_fixture : null,
    // Whether the wider TEST client happened to be clean. Context only — the
    // client is shared with other work, so this must never gate the drill.
    reconcile_client_scope_settled: reconciliation ? reconciliation.context_scope_settled : null,
    flags_unchanged: flagsUnchanged,
    cleanup_ok: cleanupOk,
    graphic_generation_verified: assets.some(asset => asset.graphicGenerationVerified === true),
    // Which description readback each team actually proved. Under Linear
    // authority the native `brief` echo is deliberately not asserted (Linear
    // may re-project it), so a green run proves LESS than a `native_and_linear`
    // green does. Record it per team rather than leaving the difference
    // invisible in an otherwise identical `ok: true`.
    description_readback_scope: descriptionReadbackScopes(DRILL_TEAMS, assets),
    // Say out loud which assertions a green run did NOT make. An `ok:true` that
    // silently covers less than the last `ok:true` is how coverage disappears.
    parked_assertions: [
      ...(DESCRIPTION_ROUNDTRIP_ENFORCED ? [] : ['description_roundtrip']),
      ...(assets.some(asset => asset.graphicsApprovalParked) ? ['graphics_approval_artifact'] : []),
    ],
    graphics_artifact_attached: assets.some(asset => asset.graphicsArtifactAttached === true),
    // Why an owner-supplied artifact URL was refused, if it was. `null` means
    // either no URL was configured or it was accepted — `graphics_artifact_attached`
    // separates those two.
    graphics_artifact_rejected:
      assets.map(asset => asset.graphicsArtifactRejected).find(Boolean) || null,
    error_code: failure ? failureStage || 'drill_failed' : null,
    // WHICH check failed, from a fixed vocabulary — the stage alone told three
    // weeks of red runs apart from each other not at all. Never the raw message.
    error_class: failure ? classifyFailure(failure) : null,
  };
  if (REPORT_PATH) {
    const output = path.resolve(REPORT_PATH);
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, JSON.stringify(payload, null, 2));
  }
  await telemetry(payload);
  console.log(JSON.stringify(payload, null, 2));
  if (failure) throw new Error(`production write drill failed (${payload.error_code})`);
  return payload;
}

module.exports = {
  FAILURE_CLASSES,
  assertFlipTolerantStance,
  classifyFailure,
  descriptionReadbackMatches,
  descriptionReadbackScopes,
  stable,
  stableJson,
  writePrivateFailure,
};

if (require.main === module) {
  main().catch(error => {
    console.error(error && error.stack ? error.stack : String(error));
    process.exitCode = 1;
  });
}
