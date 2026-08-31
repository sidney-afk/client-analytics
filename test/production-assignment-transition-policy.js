'use strict';
/*
 * Slice 5 — blocker #8 (F37 + F94 + F136).
 *
 * One suite for the three contracts that have to agree with each other:
 *
 *   F37  "My issues" and "Assigned to me" resolve from the member id staff
 *        sign-in verified, and nothing else.
 *   F94  One server-authoritative eligible-assignee projection backs the
 *        picker, the create form, and the commit.
 *   F136 One server-owned role x current x next x team x assignee state
 *        machine, mirrored byte-for-byte by the picker.
 *
 * Everything here is offline: the policy module is imported directly and the
 * browser halves are extracted from index.html. No network, no credentials.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const edge = fs.readFileSync(path.join(ROOT, 'supabase/functions/production-write/index.ts'), 'utf8');
const POLICY_PATH = path.join(ROOT, 'supabase/functions/production-write/policy.mjs');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

function extract(name) {
  const match = new RegExp(`function\\s+${name}\\s*\\(`).exec(source);
  if (!match) throw new Error(`missing ${name}`);
  const start = match.index;
  const brace = source.indexOf('{', start);
    /* Comments are SKIPPED, not parsed. index.html comments are prose and
       contain apostrophes -- "the row's scope" -- which a quote-only scanner
       reads as an unterminated string, swallowing every brace after it and
       throwing `unclosed` for a function that balances perfectly. That error
       names the wrong thing and sends the reader hunting a syntax error that
       is not there. A brace or quote inside a comment is not code. */
  let depth = 0, quote = '', escaped = false, lineComment = false, blockComment = false;
  for (let i = brace; i < source.length; i++) {
    const ch = source[i];
    const next = source[i + 1];
    if (lineComment) { if (ch === '\n') lineComment = false; continue; }
    if (blockComment) { if (ch === '*' && next === '/') { blockComment = false; i++; } continue; }
    if (!quote && ch === '/' && next === '/') { lineComment = true; i++; continue; }
    if (!quote && ch === '/' && next === '*') { blockComment = true; i++; continue; }
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`unclosed ${name}`);
}

function extractConst(name) {
  const match = new RegExp(`const\\s+${name}\\s*=\\s*`).exec(source);
  if (!match) throw new Error(`missing const ${name}`);
  const start = match.index + match[0].length;
  const open = source[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  for (let i = start; i < source.length; i++) {
    if (source[i] === open) depth++;
    else if (source[i] === close && --depth === 0) {
      // Assign onto the sandbox global so the value is readable from Node:
      // a bare `const` inside vm.runInContext stays lexically scoped.
      return `globalThis.${name} = ${source.slice(start, i + 1)};`;
    }
  }
  throw new Error(`unclosed const ${name}`);
}

(async () => {
  const policy = await import(pathToFileURL(POLICY_PATH).href + '?slice5');

  // ---- F136: browser table must equal the server table -------------------
  const browser = vm.createContext({});
  vm.runInContext([
    extractConst('PROD_CREATIVE_STATUS_TRANSITIONS'),
    extractConst('PROD_CREATIVE_ASSIGNEE_BOUND_OPERATIONS'),
  ].join('\n'), browser);

  const serverTable = JSON.parse(JSON.stringify(policy.CREATIVE_STATUS_TRANSITIONS));
  const browserTable = JSON.parse(JSON.stringify(browser.PROD_CREATIVE_STATUS_TRANSITIONS));
  ok(JSON.stringify(serverTable) === JSON.stringify(browserTable),
    'the browser creative transition table is identical to the gateway policy table');
  // OWNER RULING 2026-08-18: attachment left the assignee-bound set, so a
  // graphics creative can fix a mis-attached canonical file on any graphics
  // row. Status stays assignee-bound; attachment stays team- and
  // graphics-bound (proved behaviorally below).
  ok(JSON.stringify(browser.PROD_CREATIVE_ASSIGNEE_BOUND_OPERATIONS) === JSON.stringify(['status']),
    'the browser assignee-bound operation list matches the gateway (status only)');
  ok(policy.staffOperationAllowed('creative', 'attachment', 'graphics', 'graphics', '',
    { currentStatus: 'todo', targetAssigneeId: 'someone-else', actorMemberId: 'me' }) === true,
    'a graphics creative may replace the canonical file on a row assigned to someone else');
  /* 2026-08-30: a creative attaches on their OWN team, video included -- an
     editor could not put the finished video anywhere in SyncLinear. What must
     NOT change is the team confinement, which is the next two checks. */
  ok(policy.staffOperationAllowed('creative', 'attachment', 'video', 'video', '',
    { currentStatus: 'todo', targetAssigneeId: 'me', actorMemberId: 'me' }) === true,
    'a video creative may attach the canonical file on their own team');
  ok(policy.staffOperationAllowed('creative', 'attachment', 'video', 'graphics', '',
    { currentStatus: 'todo', targetAssigneeId: 'me', actorMemberId: 'me' }) === false,
    'but a video creative may NOT attach on a graphics row');
  ok(policy.staffOperationAllowed('creative', 'attachment', 'graphics', 'video', '',
    { currentStatus: 'todo', targetAssigneeId: 'me', actorMemberId: 'me' }) === false,
    'and a graphics creative may NOT attach on a video row');
  ok(policy.staffOperationAllowed('creative', 'attachment', 'graphics', 'video', '',
    { currentStatus: 'todo', targetAssigneeId: 'me', actorMemberId: 'me' }) === false,
    'attachment stays team-bound: a graphics creative cannot touch a video row');
  ok(policy.staffOperationAllowed('creative', 'status', 'graphics', 'graphics', 'tweak',
    { currentStatus: 'todo', targetAssigneeId: 'someone-else', actorMemberId: 'me' }) === false,
    'status remains assignee-bound after the attachment widening');

  const nextValues = new Set(Object.values(serverTable).flat());
  ok([...nextValues].every(status => policy.DELIVERABLE_STATUSES.includes(status)),
    'every declared next status is a real deliverable status');
  /*
   * OWNER RULING 2026-08-17. F136's state machine is retired: the three pins
   * that stood here demanded the opposite of what the owner asked for --
   * reviewer/terminal targets unreachable, reviewer/terminal current states
   * dead ends, and the table a strict subset of the pre-F136 allowlist. All
   * three are now false BY DECISION, so they are replaced rather than relaxed.
   *
   * What replaces them is the ruling stated positively and completely: every
   * status is reachable, from every status. If a future change narrows the
   * table again, these fail -- which is the same protection the old pins gave,
   * pointed at the current rule.
   */
  ok(policy.DELIVERABLE_STATUSES.every(status => nextValues.has(status)),
    'every deliverable status is reachable by a creative, reviewer verdicts and terminal stages included');
  ok(policy.DELIVERABLE_STATUSES.every(status => Array.isArray(serverTable[status])),
    'every current status, reviewer and terminal ones included, offers a creative exit');
  ok(policy.DELIVERABLE_STATUSES.every(current =>
    policy.DELIVERABLE_STATUSES.every(next => (serverTable[current] || []).includes(next))),
    'the table is the complete status x status product — no transition is withheld');

  for (const current of policy.DELIVERABLE_STATUSES) {
    for (const next of policy.DELIVERABLE_STATUSES) {
      const allowed = policy.staffOperationAllowed('creative', 'status', 'graphics', 'graphics', next,
        { currentStatus: current, targetAssigneeId: 'self', actorMemberId: 'self' });
      const expected = (serverTable[current] || []).includes(next);
      if (allowed !== expected) {
        ok(false, `13x13 matrix disagrees at ${current} -> ${next} (got ${allowed})`);
      }
    }
  }
  ok(true, 'the full 13x13 current x next matrix matches the declared table for an owning creative');

  // ---- F136: the gateway feeds current state into the one guard ----------
  ok(/currentStatus: lower\(existing\.status\)/.test(edge)
    && /targetAssigneeId: clean\(existing\.assignee_id\)/.test(edge)
    && /actorMemberId: clean\(principal\.memberId\)/.test(edge),
  'the gateway passes current status, current assignee, and the verified actor into staffOperationAllowed');

  // ---- F94: eligibility projection ---------------------------------------
  const member = extra => Object.assign({
    id: 'm1', name: 'Editor One', role: 'editor', team: 'video', active: true, linear_user_id: 'lu-1',
  }, extra || {});
  const verified = { providerMappingRequired: true, providerActive: true };
  const cases = [
    [member(), 'video', verified, true, ''],
    [null, 'video', verified, false, 'assignee_not_found'],
    [member({ active: false }), 'video', verified, false, 'assignee_inactive'],
    [member({ team: 'graphics' }), 'video', verified, false, 'assignee_out_of_scope'],
    [member({ role: 'admin' }), 'video', verified, false, 'assignee_role_incompatible'],
    [member({ role: 'smm' }), 'video', verified, false, 'assignee_role_incompatible'],
    [member({ role: 'designer' }), 'video', verified, false, 'assignee_role_incompatible'],
    [member({ role: 'designer', team: 'graphics' }), 'graphics', verified, true, ''],
    [member({ linear_user_id: '' }), 'video', verified, false, 'assignee_mapping_unavailable'],
    [member({ linear_user_id: 'bad id!' }), 'video', verified, false, 'assignee_mapping_unavailable'],
    [member(), 'video', { providerMappingRequired: true, providerActive: false }, false, 'assignee_provider_inactive'],
    [member(), 'video', { providerMappingRequired: true, providerActive: null }, false, 'assignee_provider_unverified'],
    [member(), 'video', { providerMappingRequired: true }, false, 'assignee_provider_unverified'],
    [member(), '', verified, false, 'assignee_out_of_scope'],
    [member({ linear_user_id: '' }), 'video', { providerMappingRequired: false }, true, ''],
  ];
  let matrixOk = true;
  for (const [row, team, options, expectEligible, expectReason] of cases) {
    const verdict = policy.assigneeEligibility(row, team, options);
    if (verdict.eligible !== expectEligible || verdict.reason !== expectReason) {
      matrixOk = false;
      ok(false, `eligibility matrix disagrees for ${JSON.stringify(row && row.role)}/${team}/${JSON.stringify(options)} (got ${JSON.stringify(verdict)})`);
    }
  }
  ok(matrixOk, 'eligibility rejects missing, inactive, cross-team, role-incompatible, unmapped, provider-inactive, and unverified targets');
  ok(policy.assigneeEligibility(member(), 'video', verified).linear_user_id === 'lu-1'
    && policy.assigneeEligibility(member({ role: 'admin' }), 'video', verified).linear_user_id === '',
  'a denied verdict never returns a provider mapping');

  ok(JSON.stringify(policy.CREATIVE_ROLE_BY_TEAM) === JSON.stringify({ video: 'editor', graphics: 'designer' }),
    'the owner-ratifiable role map is exact per team');
  ok(policy.assigneeEligibilityPolicy(undefined).providerMappingRequired === true
    && policy.assigneeEligibilityPolicy(null).providerMappingRequired === true
    && policy.assigneeEligibilityPolicy('garbage').providerMappingRequired === true
    && policy.assigneeEligibilityPolicy([]).providerMappingRequired === true
    && policy.assigneeEligibilityPolicy({ provider_mapping_required: 'false' }).providerMappingRequired === true
    && policy.assigneeEligibilityPolicy({ provider_mapping_required: false }).providerMappingRequired === false
    && policy.assigneeEligibilityPolicy('{"provider_mapping_required":false}').providerMappingRequired === false,
  'only the exact retirement value drops the provider requirement; missing and malformed stay strict');

  const roster = [
    member({ id: 'b', name: 'Bea Editor' }),
    member({ id: 'a', name: 'Ana Editor' }),
    member({ id: 'c', name: 'Cy Admin', role: 'admin' }),
    member({ id: 'd', name: 'Dee Inactive', active: false }),
    member({ id: 'e', name: 'Eve Unmapped', linear_user_id: '' }),
    member({ id: 'f', name: 'Fay Archived', linear_user_id: 'lu-archived' }),
  ];
  const projection = policy.eligibleAssigneeProjection(roster, 'video', {
    providerMappingRequired: true,
    providerActiveFor: id => (id === 'lu-archived' ? false : id === 'lu-1' ? true : null),
  });
  ok(JSON.stringify(projection.map(entry => entry.id)) === JSON.stringify(['a', 'b']),
    'the projection returns only eligible members, name-sorted, and drops admin/inactive/unmapped/archived rows');
  ok(projection.every(entry => !('linear_user_id' in entry) && !('email' in entry)),
    'the projection exposes no provider mapping or contact field');

  // ---- F94: the gateway wires one projection into every lane -------------
  ok(/async function assertEligibleAssignee\(/.test(edge)
    && /async function validateAssignee\([\s\S]{0,220}assertEligibleAssignee\(supabase, assigneeId, team\)/.test(edge)
    && /async function validateCreateAssignee\([\s\S]{0,260}assertEligibleAssignee\(supabase, assigneeId, team\)/.test(edge)
    && /async function mappedCreateAssignees\([\s\S]{0,700}eligibleAssigneeProjection\(/.test(edge),
  'the manual lane, the create lane, and the option projection all resolve through one enforcement point');
  ok(/lower\(body\.action\) === "assignee_options"[\s\S]{0,120}handleAssigneeOptions/.test(edge)
    && /async function handleAssigneeOptions\([\s\S]{0,1800}staffOperationAllowed\(principal\.keyRole, "assignee"/.test(edge)
    && /assignee_scope_forbidden/.test(edge),
  'the picker read is a protected Production action gated by the same assignee authority as the write');
  ok(/users\(first: \$first, includeArchived: true\)[\s\S]{0,80}nodes \{ id active \}[\s\S]{0,60}pageInfo \{ hasNextPage \}/.test(edge)
    && /page\.hasNextPage !== false[\s\S]{0,120}assignee_provider_unavailable/.test(edge),
  'the provider probe requests only id + active and fails closed on a truncated pool');
  ok(/if \(error \|\| !data\) return \{ providerMappingRequired: true \}/.test(edge),
    'an absent eligibility flag row means strictest, not unavailable');

  // ---- F37: identity-bound personal queue ---------------------------------
  const queue = vm.createContext({
    identity: null,
    _prodState: { loaded: true },
    _prodEditors: () => queue.editors,
    editors: {},
  });
  queue._syncviewStaffIdentityForHeaders = () => queue.identity;
  vm.runInContext([extract('_prodMyMemberId'), extract('_prodMyQueueUnavailableText')].join('\n'), queue);

  const myMemberSource = extract('_prodMyMemberId');
  ok(!/sidney/i.test(myMemberSource) && !/withRows/.test(myMemberSource),
    'the personal-queue projection no longer contains a name heuristic or a first-active-assignee fallback');

  queue.editors = { 'member-1': { id: 'member-1', active: true }, 'member-2': { id: 'member-2', active: true } };
  ok(queue._prodMyMemberId() === '' && /Sign in/.test(queue._prodMyQueueUnavailableText()),
    'a signed-out session resolves to no personal identity and says so');
  queue.identity = { role: 'creative', member: { id: 'member-2' } };
  ok(queue._prodMyMemberId() === 'member-2',
    'a verified session resolves to its own verified member id');
  queue.identity = { role: 'creative', member: { id: 'member-gone' } };
  ok(queue._prodMyMemberId() === '' && /not an active member/.test(queue._prodMyQueueUnavailableText()),
    'an off-roster verified identity resolves to no personal queue');
  queue.editors['member-2'].active = false;
  queue.identity = { role: 'creative', member: { id: 'member-2' } };
  ok(queue._prodMyMemberId() === '',
    'a deactivated roster row revokes the personal queue');
  queue._prodState.loaded = false;
  ok(queue._prodMyMemberId() === 'member-2',
    'before the roster loads the verified identity stands, because nothing has contradicted it yet');
  queue.identity = { role: 'creative', member: {} };
  ok(queue._prodMyMemberId() === '',
    'a verified session with no member id resolves to no personal queue');

  ok(/const myGate = _prodState\.view === 'my' \? _prodMyQueueUnavailableText\(\) : ''/.test(source),
    'the personal-queue empty state distinguishes "not signed in / off roster" from "no work"');

  if (failures) {
    console.error(`\nproduction-assignment-transition-policy: ${failures} check(s) failed`);
    process.exit(1);
  }
  console.log('\nproduction-assignment-transition-policy: F37/F94/F136 contracts passed');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
