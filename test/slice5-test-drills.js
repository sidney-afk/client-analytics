'use strict';
/*
 * Slice 5 TEST-drill lane contract.
 *
 * Offline only: this suite imports pure runner seams and inspects source/YAML.
 * It never supplies credentials, starts a browser, calls a backend, or invokes
 * main(). The live proof remains an owner-dispatched, main-ancestor-only lane.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..');
const SCRIPT_PATH = path.join(ROOT, 'scripts', 'slice5-test-drills.js');
const WORKFLOW_PATH = path.join(ROOT, '.github', 'workflows', 'slice5-test-drills.yml');
const POLICY_PATH = path.join(
  ROOT,
  'supabase',
  'functions',
  'production-write',
  'policy.mjs',
);

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else {
    failures++;
    console.error('FAIL  ' + message);
  }
}

function occurrences(source, needle) {
  return source.split(needle).length - 1;
}

// Position of the public failure code in each refusal constructor's argument
// list. poll() is included because its code is what a timed-out wait reports.
const REFUSAL_CODE_ARG = { assert: 4, fail: 3, DrillError: 3, poll: 3 };

// Split one call's top-level arguments. Aware of strings, template literals
// with interpolation, regex literals and both comment forms, because the
// runner uses all of them inside refusal calls.
function splitCallArgs(source, openIdx) {
  let depth = 0;
  const args = [];
  let argStart = openIdx + 1;
  for (let i = openIdx; i < source.length; i++) {
    const c = source[i];
    if (c === '/' && source[i + 1] === '/') { i = source.indexOf('\n', i); if (i < 0) return null; continue; }
    if (c === '/' && source[i + 1] === '*') { i = source.indexOf('*/', i); if (i < 0) return null; i += 1; continue; }
    if (c === '/' && depth > 0) {
      let prev = i - 1;
      while (prev >= 0 && /\s/.test(source[prev])) prev--;
      if (prev < 0 || '(,=:[!&|?{;+*%~^<>'.includes(source[prev])) {
        let k = i + 1, inClass = false, esc = false, closed = false;
        for (; k < source.length; k++) {
          const d = source[k];
          if (esc) { esc = false; continue; }
          if (d === '\\') { esc = true; continue; }
          if (d === '[') inClass = true;
          else if (d === ']') inClass = false;
          else if (d === '/' && !inClass) { closed = true; break; }
          else if (d === '\n') break;
        }
        if (closed) { i = k; continue; }
      }
    }
    if (c === '"' || c === "'") { i = skipQuoted(source, i, c); if (i < 0) return null; continue; }
    if (c === '`') { i = skipTemplate(source, i); if (i < 0) return null; continue; }
    if (c === '(' || c === '[' || c === '{') { depth++; continue; }
    if (c === ')' || c === ']' || c === '}') {
      depth--;
      if (depth === 0) { args.push(source.slice(argStart, i).trim()); return args; }
      continue;
    }
    if (c === ',' && depth === 1) { args.push(source.slice(argStart, i).trim()); argStart = i + 1; }
  }
  return null;
}

function skipQuoted(source, i, quote) {
  let esc = false;
  for (let k = i + 1; k < source.length; k++) {
    if (esc) { esc = false; continue; }
    if (source[k] === '\\') { esc = true; continue; }
    if (source[k] === quote) return k;
  }
  return -1;
}

function skipTemplate(source, i) {
  let esc = false;
  for (let k = i + 1; k < source.length; k++) {
    const c = source[k];
    if (esc) { esc = false; continue; }
    if (c === '\\') { esc = true; continue; }
    if (c === '`') return k;
    if (c === '$' && source[k + 1] === '{') {
      let depth = 1;
      k += 2;
      for (; k < source.length && depth > 0; k++) {
        const d = source[k];
        if (d === '`') { k = skipTemplate(source, k); if (k < 0) return -1; continue; }
        if (d === '"' || d === "'") { k = skipQuoted(source, k, d); if (k < 0) return -1; continue; }
        if (d === '{') depth++;
        else if (d === '}') depth--;
      }
      k--;
    }
  }
  return -1;
}

// Blank every comment to spaces, preserving offsets and newlines, so a
// refusal *named in prose* is never mistaken for a refusal in code.
function blankComments(source) {
  const out = source.split('');
  const blank = (from, to) => {
    for (let k = from; k < to && k < out.length; k++) {
      if (out[k] !== '\n') out[k] = ' ';
    }
  };
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (c === '/' && source[i + 1] === '/') {
      const end = source.indexOf('\n', i);
      blank(i, end < 0 ? source.length : end);
      i = end < 0 ? source.length : end;
      continue;
    }
    if (c === '/' && source[i + 1] === '*') {
      const end = source.indexOf('*/', i);
      blank(i, end < 0 ? source.length : end + 2);
      i = end < 0 ? source.length : end + 1;
      continue;
    }
    if (c === '"' || c === "'") { i = skipQuoted(source, i, c); if (i < 0) break; continue; }
    if (c === '`') { i = skipTemplate(source, i); if (i < 0) break; continue; }
    if (c === '/') {
      let prev = i - 1;
      while (prev >= 0 && /\s/.test(source[prev])) prev--;
      if (prev >= 0 && !'(,=:[!&|?{;+*%~^<>'.includes(source[prev])) continue;
      let k = i + 1, inClass = false, esc = false;
      for (; k < source.length; k++) {
        const d = source[k];
        if (esc) { esc = false; continue; }
        if (d === '\\') { esc = true; continue; }
        if (d === '[') inClass = true;
        else if (d === ']') inClass = false;
        else if (d === '/' && !inClass) { i = k; break; }
        else if (d === '\n') break;
      }
    }
  }
  return out.join('');
}

// Every place the runner refuses. `only` narrows to one constructor.
function scanRefusals(rawSource, only) {
  const source = blankComments(rawSource);
  const names = only ? [only] : ['assert', 'fail', 'DrillError'];
  const found = [];
  for (const name of names) {
    for (let from = 0; ;) {
      const at = source.indexOf(name + '(', from);
      if (at < 0) break;
      from = at + 1;
      // Skip member calls, longer identifiers (assertRunOwnedBatch) and the
      // declarations of the refusal helpers themselves.
      if (at > 0 && /[A-Za-z0-9_$.]/.test(source[at - 1])) continue;
      if (/function\s+$/.test(source.slice(Math.max(0, at - 16), at))) continue;
      const args = splitCallArgs(source, at + name.length);
      if (!args) continue;
      while (args.length && !args[args.length - 1]) args.pop();
      const raw = args[REFUSAL_CODE_ARG[name]] || '';
      const literal = /^'[a-z0-9_]+'$/.test(raw);
      found.push({
        name,
        line: source.slice(0, at).split('\n').length,
        code: literal ? raw.slice(1, -1) : raw,
        literal,
      });
    }
  }
  return found.sort((a, b) => a.line - b.line);
}

function stepBlock(workflow, name) {
  const marker = `      - name: ${name}`;
  const start = workflow.indexOf(marker);
  if (start < 0) return '';
  const next = workflow.indexOf('\n      - ', start + marker.length);
  return workflow.slice(start, next < 0 ? workflow.length : next);
}

function sourceFunction(source, name) {
  const match = new RegExp(
    `(?:async\\s+)?function\\s+${name}\\s*\\([\\s\\S]*?\\)\\s*\\{`,
  ).exec(source);
  if (!match) return '';
  const brace = match.index + match[0].length - 1;
  let depth = 0;
  let quote = '';
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let index = brace; index < source.length; index++) {
    const char = source[index];
    const next = source[index + 1];
    if (lineComment) {
      if (char === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (char === '*' && next === '/') {
        blockComment = false;
        index++;
      }
      continue;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = '';
      continue;
    }
    if (char === '/' && next === '/') {
      lineComment = true;
      index++;
      continue;
    }
    if (char === '/' && next === '*') {
      blockComment = true;
      index++;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }
    if (char === '{') depth++;
    else if (char === '}' && --depth === 0) return source.slice(match.index, index + 1);
  }
  return '';
}

function publicLeavesAreSafe(value) {
  const safeEnums = new Set([
    // The script's own public allowlists, so this helper cannot drift from it.
    ...require(SCRIPT_PATH).FAILURE_CODES,
    ...require(SCRIPT_PATH).PROVIDER_INACTIVE_ENUMS,
    'pass',
    'passed',
    'fail',
    'not_run',
    'none',
    'test_only',
    'active_test_only',
    'synthetic_identity_shapes_only',
    'supervised_owner_session_required',
    'ready',
    'refused',
    'accepted',
    'degraded',
    'recovered',
    'no_personal_queue',
    'assignee_out_of_scope',
    'assignee_role_incompatible',
    'assignee_mapping_unavailable',
    'assignee_provider_inactive',
    'operation_forbidden',
    'preflight',
    'f94_negative',
    'f94_stale_picker',
    'f136_matrix',
    'f37_identity',
    'f95_convergence',
    'cleanup',
    'flag_invariant',
    'read_rebaseline',
    'report',
  ]);
  const forbiddenKey = /(?:^|_)(?:id|ids|slug|slugs|time|times|timestamp|timestamps|date|dates|error|errors|message|messages|stack|stacks|detail|details|url|urls|path|paths|name|names)(?:_|$)/i;

  function visit(item) {
    if (typeof item === 'boolean') return true;
    if (typeof item === 'number') return Number.isInteger(item) && item >= 0;
    if (typeof item === 'string') return safeEnums.has(item);
    if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
    return Object.entries(item).every(([key, child]) =>
      (!forbiddenKey.test(key) || key === 'error_code') && visit(child));
  }
  return visit(value);
}

(async () => {
  ok(fs.existsSync(SCRIPT_PATH), 'the Slice 5 runner exists');
  ok(fs.existsSync(WORKFLOW_PATH), 'the owner-gated workflow exists');
  if (!fs.existsSync(SCRIPT_PATH) || !fs.existsSync(WORKFLOW_PATH)) {
    process.exit(1);
  }

  const source = fs.readFileSync(SCRIPT_PATH, 'utf8');
  const workflow = fs.readFileSync(WORKFLOW_PATH, 'utf8').replace(/\r/g, '');
  const runner = require(SCRIPT_PATH);
  const policy = await import(`${pathToFileURL(POLICY_PATH).href}?slice5-drill-contract`);

  // ---- Workflow: manual, pinned, trusted-main provenance ----------------
  ok(/^on:\n  workflow_dispatch:\n    inputs:\n      commit_sha:/m.test(workflow),
    'workflow_dispatch exposes the required commit_sha input');
  ok(/commit_sha:[\s\S]{0,180}required: true[\s\S]{0,80}type: string/.test(workflow),
    'commit_sha is a required string');
  ok(!/^  (?:push|pull_request|pull_request_target|schedule|workflow_call):/m.test(workflow),
    'the live drill has no push, PR, schedule, or reusable-workflow trigger');
  ok(/^permissions:\n  contents: read$/m.test(workflow)
    && !/contents:\s*write/.test(workflow),
  'workflow permissions are contents-read only');
  ok(/^concurrency:\n  group: slice5-test-drills\n  cancel-in-progress: false$/m.test(workflow),
    'one non-canceling concurrency group serializes TEST fixture use');
  ok(/^    environment: production$/m.test(workflow),
    'the drill job is protected by the production Environment');
  ok(/^    timeout-minutes: 180$/m.test(workflow),
    'the full matrix has enough bounded runner time to reach its own cleanup');
  // Exactly one always() step is permitted: the public-safety validator must
  // also run when the drill step fails, because the failure-only report is the
  // artifact a reviewer reads and it must be validated before it is uploaded.
  const alwaysSteps = (workflow.match(/\balways\(\)/g) || []).length;
  ok(alwaysSteps === 1, 'exactly one always() step exists (the public-safety validator)');
  ok(/- name: Validate the public-safe aggregate\n        if: always\(\)/.test(workflow),
    'the always() step is the validator, so a failure report is never uploaded unvalidated');
  ok(/stage=\$\{stage\} code=\$\{code\}/.test(workflow),
    'a failed run names the refusing stage and an allowlisted failure code in the job log');
  ok(/if: failure\(\)\n        uses: actions\/upload-artifact@v4/.test(workflow),
    'the failure-only report is uploaded when the drill step fails');

  // ---- Preflight-only mode and per-assert failure codes ------------------
  ok(/^      preflight_only:$/m.test(workflow)
    && /^        default: false$/m.test(workflow)
    && /^        type: boolean$/m.test(workflow),
  'preflight_only is an optional boolean dispatch input defaulting to false');
  ok(/SLICE5_TEST_DRILLS_PREFLIGHT_ONLY: \$\{\{ inputs\.preflight_only \}\}/.test(workflow),
    'the preflight_only input reaches the script as an env var');
  ok(/fs\.unlinkSync\(reportPath\)/.test(workflow)
    && /if \(rejected\) process\.exit\(1\)/.test(workflow),
  'a report the validator rejects is deleted so the failure upload cannot publish it');

  // The workflow validator allowlist must equal the script allowlist exactly,
  // or a legitimate failure code would be rejected as unsafe at the last step.
  const workflowEnums = new Set(
    (workflow.slice(workflow.indexOf('const safeEnums = new Set(['),
      workflow.indexOf(']);', workflow.indexOf('const safeEnums = new Set(['))
    ).match(/'[a-z0-9_]+'/g) || []).map(v => v.slice(1, -1)),
  );
  const missingFromWorkflow = [...runner.FAILURE_CODES].filter(c => !workflowEnums.has(c));
  ok(missingFromWorkflow.length === 0,
    'every script failure code is accepted by the workflow public-safety validator');

  // ---- Failure-code coverage: the WHOLE file, not a slice of one function ----
  // Every reported stage runs through shared helpers, so bounding this scan to
  // preflight()'s source range was the bug: 15 refusals outside that range
  // still reported stage=preflight with no code. Scan every refusal instead.
  const refusals = scanRefusals(source);
  const uncoded = refusals.filter(call => !call.code);
  ok(refusals.length > 150,
    `the refusal scanner sees the whole runner (${refusals.length} sites)`);
  ok(uncoded.length === 0,
    'every assert/fail/DrillError refusal carries an explicit public-safe failure code'
      + (uncoded.length ? `: ${uncoded.map(c => `${c.name}@${c.line}`).join(', ')}` : ''));
  const unallowlisted = refusals
    .filter(call => call.literal && !runner.FAILURE_CODES.has(call.code));
  ok(unallowlisted.length === 0,
    'every literal failure code at a refusal site is in FAILURE_CODES'
      + (unallowlisted.length ? `: ${unallowlisted.map(c => c.code).join(', ')}` : ''));
  ok(runner.FAILURE_CODES.has('unclassified_failure'),
    'unclassified_failure remains available for uncodified stages');

  // poll() is the one refusal the scan above cannot check by itself: its code
  // is a parameter, so an uncoded WAIT hides behind a coded fail(). Require the
  // parameter, and require every call site to name a distinct wait.
  ok(/async function poll\(runtime, stage, label, code, fn,/.test(source),
    'poll takes a required failure code positionally, ahead of the predicate');
  ok(/assert\(FAILURE_CODES\.has\(code\), stage,[\s\S]{0,140}'poll_code_missing'\)/.test(source),
    'poll refuses at runtime when its code is missing or unallowlisted');
  ok(/fail\(stage, `\$\{label\} timed out`, \{ last \}, code\)/.test(source),
    'a poll timeout reports the call site code rather than a bare stage');
  const pollCodes = scanRefusals(source, 'poll').map(call => call.code);
  ok(pollCodes.length >= 9 && pollCodes.every(code => runner.FAILURE_CODES.has(code)),
    `every poll call site passes an allowlisted code (${pollCodes.length} sites)`);
  ok(new Set(pollCodes).size === pollCodes.length,
    'no two poll call sites share a timeout code, so a timeout names which wait ran out');

  // ---- Intake project: verified on readback, not gated on a tagged row ----
  // The drill creates through ledgerWrite -> the b4-write edge functions, whose
  // TEST-override check reads clients.linear_project_ids FLAT and requires the
  // caller-supplied project_id to be in that set union B4_TEST_PROJECT_IDS.
  // Nothing on that path applies projectIdsForTeam, so preflight must not
  // demand a team-tagged entry.
  const preflightSource = source.slice(
    source.indexOf('async function preflight(runtime) {'),
    source.indexOf('function syntheticMemberRows(runtime) {'),
  );
  ok(!/projectIdsForTeam\(runtime\.client\.linear_project_ids/.test(preflightSource),
    'preflight no longer gates on the client-row project mapping');
  // test_project_unavailable survives, but with a different and provable
  // meaning: not "the row lacks a team-tagged Video project" but "there is no
  // project id to offer the TEST-override write path at all".
  ok(!/projectIdsForTeam[\s\S]{0,120}test_project_unavailable/.test(preflightSource),
    'test_project_unavailable no longer comes from a team-tagged client-row lookup');
  ok(/flatClientProjectIds\(runtime\.client\.linear_project_ids\)/.test(preflightSource)
    && /test_project_unavailable/.test(preflightSource),
  'preflight names a missing offerable project id instead of failing inside a create');
  ok(/linear_catalog_incomplete/.test(preflightSource)
    && /linear_team_unavailable/.test(preflightSource)
    && /provider_pool_incomplete/.test(preflightSource),
  'the real Linear catalog, team and provider-pool preconditions are kept');

  // projectIdsForTeam itself is untouched: the real-client intake path still
  // depends on its stricter team-tagged shape.
  ok(runner.projectIdsForTeam(['bare-id'], 'video').length === 0
    && runner.projectIdsForTeam([{ team: 'video', id: 'tagged' }], 'video')[0] === 'tagged',
  'projectIdsForTeam keeps requiring a team-tagged entry');

  // ---- linear_parent_ids has its own reader, derived from its own writer ----
  // projectIdsForTeam reads clients.linear_project_ids: a PROJECT-id map keyed
  // id/project_id/linear_project_id. linear_parent_ids is parent-ISSUE linkage
  // written by mergeBatchParentIds, which puts the id under `uuid`. Pointing
  // the project reader at it returns [] for every freshly created batch, which
  // is a 60s poll timeout with no way to see why. Proven against the REAL
  // writer, imported here, so a change to its output shape fails this test.
  const mapping = await import(
    `${pathToFileURL(path.join(ROOT, 'supabase', 'functions', 'linear-outbound', 'mapping.mjs')).href}?slice5-drill-contract`
  );
  const freshBatchParents = mapping.mergeBatchParentIds(null, 'video', {
    id: 'issue-uuid-video',
    identifier: 'VID-13061',
    url: 'https://linear.app/team/issue/VID-13061',
  });
  ok(JSON.stringify(Object.keys(freshBatchParents)) === JSON.stringify(['video'])
    && freshBatchParents.video.uuid === 'issue-uuid-video'
    && !('id' in freshBatchParents.video),
  'mergeBatchParentIds still writes a team-keyed object with the id under uuid');
  ok(runner.parentIssueIdsForTeam(freshBatchParents, 'video')[0] === 'issue-uuid-video',
    'the parent-issue reader returns the uuid mergeBatchParentIds actually wrote');
  // The defect this replaces, pinned so a revert cannot look harmless.
  ok(runner.projectIdsForTeam(freshBatchParents, 'video').length === 0,
    'the project reader returns nothing for that shape, which is why the poll timed out');
  // A second team merged in later must not disturb the first, and each team
  // must resolve to exactly one id -- the poll requires ids.length === 1.
  const twoTeamParents = mapping.mergeBatchParentIds(freshBatchParents, 'GRA', {
    id: 'issue-uuid-graphics',
    identifier: 'GRA-9',
  });
  ok(runner.parentIssueIdsForTeam(twoTeamParents, 'video').length === 1
    && runner.parentIssueIdsForTeam(twoTeamParents, 'video')[0] === 'issue-uuid-video'
    && runner.parentIssueIdsForTeam(twoTeamParents, 'graphics')[0] === 'issue-uuid-graphics',
  'a graphics parent merged in later leaves the video parent resolvable and unique');
  // Team keys are normalized exactly as mergeBatchParentIds normalizes them,
  // so a 'GRA'/'VID' key is read, not missed.
  ok(runner.parentTeamKey('GRA') === 'graphics' && runner.parentTeamKey('graphic') === 'graphics'
    && runner.parentTeamKey('VID') === 'video' && runner.parentTeamKey('video') === 'video',
  'the reader normalizes team keys the way mergeBatchParentIds does');
  ok(runner.parentIssueIdsForTeam({ VID: { uuid: 'legacy-key' } }, 'video')[0] === 'legacy-key',
    'a legacy VID-keyed entry still resolves to the video parent');
  // The id/linear_issue_id fallbacks exist for exactly one reason: the object
  // branch of mergeBatchParentIds copies teams it is NOT writing straight
  // through, so a pre-normalization entry survives untouched.
  const passedThrough = mapping.mergeBatchParentIds(
    { video: { id: 'pre-normalization-id' } }, 'GRA', { id: 'g' },
  );
  ok(passedThrough.video.id === 'pre-normalization-id' && !passedThrough.video.uuid,
    'mergeBatchParentIds passes an untouched team through verbatim, uuid or not');
  ok(runner.parentIssueIdsForTeam(passedThrough, 'video')[0] === 'pre-normalization-id',
    'the fallback keys read exactly that pass-through case');
  // jsonb can arrive as a string; mergeBatchParentIds parses one, so this does.
  ok(runner.parentIssueIdsForTeam(JSON.stringify(freshBatchParents), 'video')[0] === 'issue-uuid-video',
    'a stringified column value is parsed rather than read as empty');
  ok(runner.parentIssueIdsForTeam(null, 'video').length === 0
    && runner.parentIssueIdsForTeam({}, 'video').length === 0
    && runner.parentIssueIdsForTeam({ video: {} }, 'video').length === 0,
  'an unlinked batch resolves to no parent id rather than a bogus one');

  // Neither call site may go back to the project reader. Both read
  // linear_parent_ids; after this change projectIdsForTeam has no caller in
  // the runner at all.
  ok(!/projectIdsForTeam\([^)]*linear_parent_ids/.test(source),
    'no call site reads linear_parent_ids with the project-id reader');
  ok(occurrences(source, 'parentIssueIdsForTeam(row.linear_parent_ids, MATRIX_TEAM)') === 2,
    'both linear_parent_ids call sites use the parent-issue reader');
  // The flat reader mirrors the edge allowlist rule (b4-write projectIds),
  // which is what actually admits the drill create intent.
  ok(runner.flatClientProjectIds(['bare-id'])[0] === 'bare-id'
    && runner.flatClientProjectIds([{ team: 'video', id: 'tagged' }])[0] === 'tagged'
    && runner.flatClientProjectIds(null).length === 0,
  'the flat client-project reader accepts the bare id array the edge accepts');

  // The readback proof, exercised directly rather than pattern-matched.
  const intakeSource = sourceFunction(source, 'verifyGatewayIntakeProject');
  ok(/'linear_project_unavailable'/.test(intakeSource),
    'the intake-project readback reuses the linear_project_unavailable code');
  const vidProject = { id: 'p-vid', teams: { nodes: [{ key: 'VID' }] } };
  const usable = runner.intakeProjectIssueUsable({ id: 'i', project: vidProject });
  ok(usable.usable === true && usable.projectId === 'p-vid',
    'a live, non-archived, VID-teamed project is accepted and yields its id');
  for (const [label, issue] of [
    ['a missing issue', null],
    ['an archived issue', { id: 'i', archivedAt: '2026-01-01', project: vidProject }],
    ['a missing project', { id: 'i' }],
    ['a project with no id', { id: 'i', project: { teams: { nodes: [{ key: 'VID' }] } } }],
    ['an archived project', { id: 'i', project: { ...vidProject, archivedAt: '2026-01-01' } }],
    ['a project with no teams', { id: 'i', project: { id: 'p', teams: { nodes: [] } } }],
    ['a non-VID project', { id: 'i', project: { id: 'p', teams: { nodes: [{ key: 'GRA' }] } } }],
  ]) {
    const verdict = runner.intakeProjectIssueUsable(issue);
    ok(verdict.usable === false && verdict.projectId === '',
      `the readback rejects ${label}`);
  }
  // The issue TEAM must not enter the verdict: createFixture supplies that team
  // id itself, so consulting it would make the assert unconditional.
  ok(runner.intakeProjectIssueUsable({
    id: 'i', team: { key: 'VID' }, project: { id: 'p', teams: { nodes: [{ key: 'GRA' }] } },
  }).usable === false,
  'a VID issue team cannot rescue a non-VID project (no tautological fallback)');
  ok(!/issue\.team/.test(intakeSource),
    'the readback does not consult the issue team the drill itself supplied');
  ok(/runtime\.linear\.verifiedProjectId = mintedIssue\.projectId/.test(source),
    'the verified project id comes from the minted issue, not from the offered id');


  // preflight_only genuinely does not verify the project, and says so.
  ok(Object.prototype.hasOwnProperty.call(runner.emptyReport(), 'intake_project_verified')
    && runner.emptyReport().intake_project_verified === false,
  'the aggregate reports intake_project_verified, false until the readback proves it');
  const preflightOnlyBlock = source.slice(
    source.indexOf("await runBoundedDrillPhase(runtime, 'preflight'"),
    source.indexOf("stage = 'f94_negative';"),
  );
  ok(preflightOnlyBlock.indexOf('report.preflight_only = true;')
    < preflightOnlyBlock.indexOf('report.intake_project_verified'),
  'a preflight-only run returns before the project readback, so it cannot claim verification');
  for (const code of [
    'test_client_not_unique', 'test_project_unavailable', 'linear_catalog_incomplete',
    'provider_pool_incomplete', 'roster_empty', 'browser_key_unavailable',
    'policy_source_unavailable', 'role_key_missing', 'identity_plan_already_reserved',
    'preflight_only_mutation_blocked', 'preflight_only_browser_blocked',
  ]) {
    ok(runner.FAILURE_CODES.has(code), `failure code ${code} is allowlisted`);
  }
  ok(/if \(runtime\.config\.preflightOnly\) \{\n        report\.preflight_only = true;\n        return;\n      \}/.test(source),
    'preflight-only returns before the first create, not merely around each one');
  for (const fn of ['restWrite', 'edgeWrite', 'gatewayWrite']) {
    const body = source.slice(source.indexOf(`async function ${fn}(`),
      source.indexOf(`async function ${fn}(`) + 700);
    ok(/assert\(!runtime\.config\.preflightOnly/.test(body),
      `${fn} refuses outright in preflight-only mode`);
  }
  ok(/assert\(!runtime\.config\.preflightOnly[\s\S]{0,160}preflight_only_browser_blocked/
    .test(source.slice(source.indexOf('async function launchBrowser('))),
  'launchBrowser refuses outright in preflight-only mode');

  const drillClock = stepBlock(workflow, 'Start the bounded drill clock');
  const trustedCheckout = stepBlock(workflow, 'Check out trusted main for the provenance gate');
  const provenance = stepBlock(workflow, 'Verify requested commit is an exact ancestor of origin/main');
  const pinnedCheckout = stepBlock(workflow, 'Check out the verified commit');
  const exactHead = stepBlock(workflow, 'Reverify exact checked-out commit');
  const trustedAt = workflow.indexOf('      - name: Check out trusted main for the provenance gate');
  const clockAt = workflow.indexOf('      - name: Start the bounded drill clock');
  const provenanceAt = workflow.indexOf('      - name: Verify requested commit is an exact ancestor of origin/main');
  const pinnedAt = workflow.indexOf('      - name: Check out the verified commit');
  ok(trustedAt >= 0 && provenanceAt > trustedAt && pinnedAt > provenanceAt,
    'trusted main checkout and ancestry proof precede dispatched-SHA checkout');
  ok(clockAt >= 0 && clockAt < trustedAt
    && /SLICE5_JOB_STARTED_AT_MS=%s/.test(drillClock)
    && /\$GITHUB_ENV/.test(drillClock)
    && !/secrets\./.test(drillClock),
  'a credential-free workflow clock starts before checkout and dependency setup');
  ok(/ref: refs\/heads\/main/.test(trustedCheckout)
    && /fetch-depth: 0/.test(trustedCheckout)
    && /persist-credentials: false/.test(trustedCheckout),
  'the provenance gate begins from a credential-free full-depth main checkout');
  ok(/\^\[0-9a-f\]\{40\}\$/.test(provenance)
    && /git merge-base --is-ancestor "\$RUN_COMMIT" origin\/main/.test(provenance)
    && /git cat-file -e "\$RUN_COMMIT\^\{commit\}"/.test(provenance),
  'the gate requires exact lowercase 40-hex commit shape, existence, and main ancestry');
  ok(/ref: \$\{\{ steps\.provenance\.outputs\.validated_commit \}\}/.test(pinnedCheckout)
    && /fetch-depth: 0/.test(pinnedCheckout)
    && /persist-credentials: false/.test(pinnedCheckout),
  'only the gate output can select the full-depth drill checkout');
  ok(/git rev-parse HEAD/.test(exactHead)
    && /\[ "\$actual" != "\$RUN_COMMIT" \]/.test(exactHead),
  'the checked-out HEAD is reverified against the gated SHA');

  ok(/uses: actions\/setup-node@v4[\s\S]{0,100}node-version: '22'/.test(workflow),
    'the lane uses Node 22');
  ok(/npm install --no-save --package-lock=false/.test(workflow)
    && !/npm ci/.test(workflow),
  'dependencies install without inventing a lockfile in this lockfile-free repository');
  ok(/npx playwright install --with-deps chromium/.test(workflow),
    'the owner lane installs Playwright Chromium');

  const drillStep = stepBlock(workflow, 'Run the guarded TEST-only drill suite');
  const secretNames = [
    'SUPABASE_SERVICE_ROLE_KEY',
    'LINEAR_API_KEY',
    'ROLE_KEY_ADMIN',
    'ROLE_KEY_SMM',
    'ROLE_KEY_CREATIVE',
  ];
  ok(secretNames.every(name =>
    drillStep.includes(`${name}: \${{ secrets.${name} }}`)),
  'all service/provider/role credentials are present under their exact environment-secret names');
  ok(secretNames.every(name => occurrences(workflow, `secrets.${name}`) === 1)
    && occurrences(workflow, 'secrets.') === secretNames.length,
  'all secrets are referenced exactly once and only by the drill step');
  ok(/for name in[\s\S]{0,220}SUPABASE_SERVICE_ROLE_KEY LINEAR_API_KEY[\s\S]{0,120}ROLE_KEY_ADMIN ROLE_KEY_SMM ROLE_KEY_CREATIVE/.test(drillStep)
    && /if \[ -z "\$\{!name\}" \]/.test(drillStep),
  'the credential-bearing step refuses a missing service, provider, or role key before running');
  ok(!workflow.slice(0, workflow.indexOf('    steps:')).includes('secrets.'),
    'no secret is job-scoped');
  ok(drillStep.includes("SLICE5_TEST_DRILLS_CONFIRM: 'SLICE5_TEST_ONLY'")
    && drillStep.includes('SLICE5_TEST_DRILLS_REPORT: artifacts/slice5-test-drills.json')
    && drillStep.includes('SLICE5_TEST_DRILLS_PRIVATE_LOG: ${{ runner.temp }}/slice5-test-drills-private.json'),
  'confirmation, public report, and runner-private failure paths are fixed');
  ok(/> "\$\{RUNNER_TEMP\}\/slice5-test-drills-console\.log" 2>&1/.test(drillStep)
    && !/\btee\b/.test(drillStep),
  'raw drill process output remains runner-private and is never teed to the public log');

  const aggregateStep = stepBlock(workflow, 'Validate the public-safe aggregate');
  const uploadStep = stepBlock(workflow, 'Upload public-safe drill aggregate');
  ok(/forbiddenKey/.test(aggregateStep)
    && /safeEnums/.test(aggregateStep)
    && /'read_rebaseline'/.test(aggregateStep)
    && /unsafe_public_aggregate/.test(aggregateStep),
  'an independent recursive allowlist validates aggregate keys and leaf values');
  ok(/uses: actions\/upload-artifact@v4/.test(uploadStep)
    && /path: artifacts\/slice5-test-drills\.json/.test(uploadStep)
    && /if-no-files-found: error/.test(uploadStep)
    && !/\n\s+if:/.test(uploadStep),
  'only the success-path public aggregate is uploaded');

  // ---- Runner: import-safe, fail-closed TEST target ----------------------
  ok(/if \(require\.main === module\)/.test(source),
    'importing pure test seams cannot start a live drill');
  for (const exportName of [
    'sanitizePublicReport',
    'discoverUniqueActiveTestClient',
    'assertActiveTestWriteTarget',
    'assertSyntheticMemberMutationAllowed',
    'classifyMatrixAttempt',
    'expectedCreativeAcceptedSet',
    'matrixSyntheticStamp',
    'requestDeadlineMs',
    'memberReferenceIds',
    'assertWriteMemberReferencesRunOwned',
    'readCompleteRoster',
    'acquireBoundedResource',
    'installBrowserRoutes',
    'selectLinearDrillProviderUsers',
    'runLedgerPayload',
    'assertRunLedgerRow',
    'assertRunOwnedLinearIssueSnapshot',
    'stableJson',
    'liveRequest',
    'writePrivateFailure',
    'main',
  ]) {
    ok(typeof runner[exportName] === 'function', `runner exports pure seam ${exportName}`);
  }
  ok(source.includes('SLICE5_TEST_ONLY')
    && source.includes('SLICE5_TEST_DRILLS_CONFIRM'),
  'main requires the exact fixed TEST-only confirmation');
  ok(/expected exactly one active TEST client/i.test(source)
    || /unique active TEST client/i.test(source),
  'the runner aborts unless exactly one active TEST client is discovered');
  ok(!/sidneylaruel/i.test(source),
    'the active TEST client is discovered rather than hard-coded by slug');

  const activeGuard = sourceFunction(source, 'assertActiveTestWriteTarget');
  ok(/active/i.test(activeGuard) && /\btest\b/i.test(activeGuard)
    && /targetClientSlug/.test(activeGuard)
    && /discoverUniqueActiveTestClient/.test(activeGuard),
  'the pre-send target guard re-reads active TEST client scope');
  ok(/\bassert\(/.test(activeGuard)
    && /write target is not the unique active TEST client/.test(activeGuard),
    'a non-TEST target aborts instead of being skipped');

  const mutationAdapters = runner.WRITE_ADAPTERS;
  ok(Array.isArray(mutationAdapters)
    && JSON.stringify(mutationAdapters) === JSON.stringify([
      'restWrite',
      'edgeWrite',
      'gatewayWrite',
      'guardedBrowserVerifier',
    ]),
    'network mutations are centralized in explicitly guarded write adapters');
  for (const name of mutationAdapters) {
    const body = sourceFunction(source, name);
    const guardAt = body.indexOf('assertActiveTestWriteTarget');
    const sendAt = body.indexOf('liveRequest(');
    ok(body && guardAt >= 0 && sendAt >= 0 && guardAt < sendAt,
      `${name} revalidates active TEST scope immediately before its send`);
  }
  ok(/WRITE_(?:ADAPTERS|KINDS)/.test(source),
    'the finite mutation-adapter inventory is source-visible for review');

  // Disposable members must be both drill-marked and created by this run.
  const memberGuard = sourceFunction(source, 'assertSyntheticMemberMutationAllowed');
  ok(/runtime\.createdMemberIds\.has\(id\)/.test(memberGuard)
    && /!runtime\.readOnlyMemberIds\.has\(id\)/.test(memberGuard)
    && /markerPresent\(row\.(?:name|email), runtime\)/.test(memberGuard)
    && /\bassert\(/.test(memberGuard),
  'member writes require the drill marker/run-created allowlist and reject real roster ids');
  ok(/(?:DRILL_MEMBER_MARKER|DRILL_MARKER)/.test(source)
    && /new Set\(\)/.test(source),
  'the runner carries an explicit drill marker and disposable-member allowlist');
  const realMemberId = 'inactive-real-member';
  const nestedMemberPayload = {
    patch: {
      reviewer_member_id: realMemberId,
      deeper: [{ member_id: realMemberId }],
    },
  };
  ok(JSON.stringify(runner.memberReferenceIds(nestedMemberPayload).sort())
      === JSON.stringify([realMemberId, realMemberId].sort()),
  'the recursive guard discovers nested and generic member references');
  const serializedMemberPayload = {
    patch: JSON.stringify({ nested: { assignee_id: realMemberId } }),
  };
  ok(JSON.stringify(runner.memberReferenceIds(serializedMemberPayload))
      === JSON.stringify([realMemberId])
    && JSON.stringify(runner.postgrestMemberReferenceIds(
      `deliverables?assignee_id=eq.${realMemberId}`,
    )) === JSON.stringify([realMemberId]),
  'the firewall discovers serialized patch and mutation-query member references');
  let guardedFetches = 0;
  const offlineGuardRuntime = {
    runToken: 'slice5-offline',
    client: { slug: 'test-only' },
    config: {
      supabaseUrl: 'https://offline.invalid',
      serviceKey: 'offline',
      publicAnonKey: 'offline',
      roleKeys: { admin: 'offline', smm: 'offline', creative: 'offline' },
    },
    processDeadlineAt: Date.now() + (60 * 60_000),
    cleanupStarted: false,
    activeRequestControllers: new Set(),
    readOnlyMemberIds: new Set([realMemberId]),
    createdMemberIds: new Set([realMemberId]),
    createdDeliverableIds: new Set(),
    createdBatchIds: new Set(),
    createdDedups: new Set(),
    fetch: async () => {
      guardedFetches++;
      throw new Error('offline guard leaked to fetch');
    },
  };
  let readEscapeFetches = 0;
  const readEscapeRuntime = {
    ...offlineGuardRuntime,
    fetch: async () => {
      readEscapeFetches++;
      throw new Error('mutation-shaped read helper leaked to fetch');
    },
  };
  let readEscapeRejects = 0;
  for (const invoke of [
    () => runner.restRead(readEscapeRuntime, 'clients?active=eq.true', {
      method: 'DELETE',
      stage: 'preflight',
    }),
    () => runner.restRead(readEscapeRuntime, 'team_members?id=neq.none', {
      method: 'PATCH',
      stage: 'preflight',
    }),
    () => runner.linearRead(
      readEscapeRuntime,
      'mutation Escape { issueArchive(id: "real") { success } }',
      {},
      'preflight',
    ),
  ]) {
    try {
      await invoke();
    } catch (_error) {
      readEscapeRejects++;
    }
  }
  ok(readEscapeRejects === 3 && readEscapeFetches === 0,
    'read helpers reject mutation-capable HTTP and GraphQL shapes before fetch');

  // ---- Linear failure classification: three fixes, three codes -----------
  // One code for 401, 429 and a rejected query made the lane undebuggable:
  // a bad key, a rate limit and an invalid document need different fixes and
  // looked identical. Driven through the REAL linearRead with a stubbed fetch.
  const linearCases = [
    [401, { errors: [{ message: 'authentication failed' }] }, 'linear_auth_failed', 401],
    [403, { errors: [{ message: 'forbidden' }] }, 'linear_auth_failed', 403],
    [429, { errors: [{ message: 'rate limited' }] }, 'linear_rate_limited', 429],
    [200, { errors: [{ message: 'Cannot query field' }] }, 'linear_query_rejected', 200],
    [400, { errors: [{ message: 'complexity' }] }, 'linear_read_failed', 400],
    [500, {}, 'linear_read_failed', 500],
    [502, null, 'linear_read_failed', 502],
  ];
  for (const [status, payload, expectedCode, expectedStatus] of linearCases) {
    const runtimeForStatus = {
      ...offlineGuardRuntime,
      fetch: async () => ({
        ok: status >= 200 && status < 300,
        status,
        headers: { get: () => 'application/json' },
        arrayBuffer: async () => Buffer.from(payload === null ? 'not json' : JSON.stringify(payload)),
      }),
    };
    let caught = null;
    try {
      await runner.linearRead(runtimeForStatus, 'query Probe { viewer { id } }', {}, 'preflight');
    } catch (error) {
      caught = error;
    }
    ok(caught && caught.code === expectedCode,
      `HTTP ${status} classifies as ${expectedCode}`);
    ok(caught && caught.httpStatus === expectedStatus,
      `HTTP ${status} carries its numeric status publicly`);
  }
  // A 200 with data and no errors must still succeed.
  const okRuntime = {
    ...offlineGuardRuntime,
    fetch: async () => ({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      arrayBuffer: async () => Buffer.from(JSON.stringify({ data: { viewer: { id: 'v' } } })),
    }),
  };
  const okData = await runner.linearRead(okRuntime, 'query Probe { viewer { id } }', {}, 'preflight');
  ok(okData && okData.viewer && okData.viewer.id === 'v',
    'a clean Linear read still returns its data');
  // The status reaches the public aggregate and the failure report; nothing
  // else from the response does.
  ok(runner.emptyReport().failure_http_status === 0,
    'the aggregate carries a numeric failure_http_status, 0 when no HTTP call failed');

  // ---- gateway_status_mismatch carries the pair it disagreed on ----------
  // The code alone said only that SOME probe disagreed, with http_status
  // reading 0 because no status was ever threaded through. Driven through the
  // real DrillError, not regex-matched.
  const factsFor = over => runner.publicFacts(over);
  const allNone = factsFor(null);
  ok(Object.values(allNone).every(value => value === 'none' || value === 0)
    && Object.keys(allNone).length === Object.keys(runner.PUBLIC_FACT_FIELDS).length,
  'a failure with no facts still reports the fixed, all-default shape');
  // The bug that made run #14's probe and run #15's whole line unreadable:
  // report assembly re-sanitizes an already sanitized object, and 'none' is
  // not a member of role/current/next/..., so every default became
  // unrecognized_enum. publicFacts must be idempotent.
  ok(JSON.stringify(factsFor(factsFor(null))) === JSON.stringify(allNone),
    'sanitizing an already-sanitized fact set is a no-op, not a corruption');
  const realistic = factsFor({ probe: 'mapping', expected_status: 409, actual_status: 503,
    expected_code: 'assignee_mapping_unavailable', actual_code: 'authority_unavailable' });
  ok(JSON.stringify(factsFor(realistic)) === JSON.stringify(realistic),
    'idempotence holds for a populated fact set too');
  const realPair = factsFor({
    probe: 'mapping',
    expected_status: 409,
    actual_status: 503,
    expected_code: 'assignee_mapping_unavailable',
    actual_code: 'authority_unavailable',
  });
  ok(realPair.probe === 'mapping'
    && realPair.expected_status === 409 && realPair.actual_status === 503
    && realPair.expected_code === 'assignee_mapping_unavailable'
    && realPair.actual_code === 'authority_unavailable',
  'a real expected/actual pair survives verbatim');
  // A 2xx has no error enum: an accepted write that should have been refused
  // must look different from a wrong refusal.
  ok(factsFor({ probe: 'role', expected_status: 403, actual_status: 200,
    expected_code: 'assignee_role_incompatible', actual_code: 'none' }).actual_code === 'none',
  'an accepted write reports actual_code none rather than a missing field');
  // Nothing that is not an enum or a small integer can get through.
  const hostile = factsFor({
    probe: 'acme-corp',
    expected_status: 'four-oh-nine',
    actual_status: 99_999,
    expected_code: 'client-slug-here',
    actual_code: 'Deliverable "Q3 launch" for Acme is not assignable',
  });
  ok(hostile.probe === 'unrecognized_enum'
    && hostile.expected_code === 'unrecognized_enum'
    && hostile.actual_code === 'unrecognized_enum'
    && hostile.expected_status === 0 && hostile.actual_status === 0,
  'a non-enum or out-of-range fact degrades rather than reaching a public artifact');
  // The facts ride the DrillError and the report, and the report shape the
  // sanitizer demands is the one publicFacts always produces.
  let thrownMismatch = null;
  try {
    runner.assertDrainReceipt({
      ok: true,
      counts: { failed: 1 },
      target: { dedup_key: 'd', status: 'written', linear_result: { issue_id: 'i' } },
    }, 'd', 'f94_negative', 'created');
  } catch (error) { thrownMismatch = error; }
  ok(thrownMismatch && JSON.stringify(thrownMismatch.facts) === JSON.stringify(factsFor(null)),
    'a refusal that supplies no facts still carries the fixed shape');
  const reportWithFacts = {
    ...runner.emptyReport(),
    failure_code: 'gateway_status_mismatch',
    failure_http_status: 503,
    failure_facts: realPair,
  };
  ok(JSON.stringify(runner.sanitizePublicReport(reportWithFacts).failure_facts)
    === JSON.stringify(realPair),
  'the public sanitizer accepts the pair, so every value in it is an allowlisted enum');
  ok(runner.emptyReport().failure_facts.probe === 'none',
    'the aggregate always carries failure_facts, so its shape never varies by outcome');

  // Every gateway enum the drill may echo is really thrown by the gateway.
  // Derived from the deployed sources rather than invented here.
  const gatewaySource = fs.readFileSync(
    path.join(ROOT, 'supabase', 'functions', 'production-write', 'index.ts'), 'utf8');
  const policySource = fs.readFileSync(POLICY_PATH, 'utf8');
  const unproven = [...runner.GATEWAY_REFUSAL_ENUMS]
    .filter(code => code !== 'none' && code !== 'unrecognized_enum')
    .filter(code => !gatewaySource.includes(`"${code}"`) && !policySource.includes(`"${code}"`));
  ok(unproven.length === 0,
    'every gateway refusal enum the drill can echo appears in production-write or policy.mjs'
      + (unproven.length ? `: ${unproven.join(', ')}` : ''));
  // The three eligibility reasons the assignment path can actually produce,
  // including the one the drill does NOT expect -- if a probe ever returns it,
  // actual_code must name it rather than degrading to unrecognized_enum.
  for (const code of [
    'assignee_mapping_unavailable', 'assignee_provider_inactive', 'assignee_provider_unverified',
  ]) {
    ok(runner.GATEWAY_REFUSAL_ENUMS.has(code) && policySource.includes(`"${code}"`),
      `${code} is echoable, so a probe returning it is named rather than hidden`);
  }
  // The probe label closes the gap the aggregate cannot: runBoundedDrillPhase
  // only assigns report.f94_negative when the phase RESOLVES, so a failed
  // phase leaves it reading not_run with every count at zero.
  ok(runner.emptyReport().f94_negative.result === 'not_run'
    && runner.emptyReport().f94_negative.attempts_count === 0,
  'the f94_negative section cannot name the in-flight probe, which is why facts carry it');
  ok(runner.F94_PROBES.length === 6
    && runner.F94_PROBES.every(probe => factsFor({ probe }).probe === probe),
  'every F94 probe label round-trips through the public facts');

  // The workflow echoes the pair and accepts every value it can hold.
  // Built from PUBLIC_FACT_FIELDS itself, so a new fact field cannot be added
  // without its enum set being checked against the validator allowlist.
  const factEnums = [...new Set(
    Object.values(runner.PUBLIC_FACT_FIELDS)
      .map(field => field.enums)
      .filter(Boolean)
      .flatMap(allowed => [...allowed]),
  )].filter(value => value !== 'none');
  ok(factEnums.length > 60,
    `the fact allowlist is built from every field's own enum set (${factEnums.length})`);
  const missingFactEnums = factEnums.filter(code => !workflowEnums.has(code));
  ok(missingFactEnums.length === 0,
    'the workflow validator accepts every probe and gateway enum the facts can carry'
      + (missingFactEnums.length ? `: ${missingFactEnums.join(', ')}` : ''));
  // The job log prints exactly the facts that are NOT at their default, so it
  // needs no per-field knowledge and stays correct as fields are added.
  ok(/Object\.entries\(f\)\.map\(\(\[k,v\]\)=>`\$\{k\}=\$\{v\}`\)/.test(workflow),
    'the job log names every public fact the refusal carried');
  ok(/if\(p\.length\)process\.stdout\.write\(" "\+p\.join\(" "\)\)/.test(workflow),
    'a failure with no facts adds nothing to the error line rather than printing none/0');
  ok(/facts: failure instanceof DrillError \? failure\.reportedFacts : \{\}/.test(source),
    'the failure report carries only the fields the refusal populated');
  // Proven end to end against the real reportedFacts output.
  const renderFacts = facts => Object.entries(runner.reportedFacts(facts))
    .map(([key, value]) => `${key}=${value}`).join(' ');
  ok(renderFacts(null) === '',
    'a refusal with no facts renders an empty suffix');
  ok(renderFacts({
    direction: 'gateway_more_permissive', role: 'creative', current: 'in_progress',
    next: 'smm_approval', ownership: 'peer', route: 'list',
    classification: 'authority_fenced', expected_status: 403, actual_status: 409,
    expected_code: 'operation_forbidden', actual_code: 'team_is_linear_authoritative',
  }) === 'direction=gateway_more_permissive role=creative current=in_progress'
    + ' next=smm_approval ownership=peer route=list classification=authority_fenced'
    + ' expected_status=403 actual_status=409 expected_code=operation_forbidden'
    + ' actual_code=team_is_linear_authoritative',
  'a matrix mismatch renders the whole cell, the direction and both sides');
  // The reason the whole line was unreadable: an F95 code printed matrix
  // fields it never populated. It must now print its own fields and nothing
  // else -- including client_height=0, which is the answer, not an unset field.
  ok(renderFacts({
    list_element: 'missing', client_height: 0, scroll_height: 0,
    offset_parent_height: 0, viewport_width: 1280, viewport_height: 800, row_count: 0,
  }) === 'list_element=missing client_height=0 scroll_height=0'
    + ' offset_parent_height=0 viewport_width=1280 viewport_height=800 row_count=0',
  'a scroll failure prints its own measurements, zeros included, and no matrix fields');
  ok(/code=\$\{code\} http_status=\$\{http\}\$\{facts\}/.test(workflow),
    'the pair rides the same ::error:: line as the stage and code');

  // The wiring at the two probe sites. publicFacts and DrillError are proven
  // behaviourally above; exercising the probes themselves needs a live
  // gateway, so the connection between them is asserted here.
  const f94Source = source.slice(
    source.indexOf('async function runF94Negative('),
    source.indexOf('async function runF94StalePicker('),
  );
  ok(/'gateway_status_mismatch', response\.status, \{/.test(f94Source),
    'the mismatch refusal threads the real HTTP status, so http_status stops reading 0');
  ok(/probe: label,\s+expected_status: expectedStatus,\s+actual_status: response\.status,\s+expected_code: expectedCode,\s+actual_code: actualCode,/
    .test(f94Source),
  'the mismatch refusal carries the probe and both sides of the pair');
  ok(/'f94_eligible_assignment_rejected', response\.status, \{\s+probe: 'eligible_accept',/
    .test(f94Source),
  'the eligible-accept refusal carries its status and probe too');
  ok(/const actualCode = clean\(response\.body && response\.body\.error\) \|\| 'none';/
    .test(f94Source),
  'the observed enum is read once and reused for both the check and the report');

  // ---- F136: the matrix cell, and WHICH WAY it diverged ------------------
  // The oracle mismatch used to report only that some cell disagreed. The
  // assert already held role/current/next/ownership/route/classification; all
  // six are plain enums and went only to the private log. `response` stays
  // private -- it is the one value there that can carry client data.
  const matrixSource = source.slice(
    source.indexOf('async function runF136Matrix('),
    source.indexOf('function roleKeyForMember('),
  );
  ok(/direction: expected \? 'gateway_more_restrictive' : 'gateway_more_permissive',/
    .test(matrixSource),
  'the mismatch names the direction explicitly rather than leaving it to be inferred');
  ok(/expected \? 'f136_gateway_more_restrictive' : 'f136_gateway_more_permissive',/
    .test(matrixSource),
  'the direction is the failure CODE too, since it decides urgency');
  ok(/role,\s+current,\s+next,\s+ownership,\s+route: routeName,\s+classification,/
    .test(matrixSource),
  'the whole matrix cell reaches the public facts');
  ok(/expected_status: expected \? 409 : 403,\s+expected_code: expected \? 'team_is_linear_authoritative' : 'operation_forbidden',/
    .test(matrixSource),
  'the expected pair is the oracle contract, not a placeholder');
  ok(/'f136_gateway_more_restrictive' : 'f136_gateway_more_permissive',\s+response\.status,/
    .test(matrixSource),
  'the matrix refusal threads the real HTTP status');
  // `response` must NOT become a public fact: it is the one value in that
  // detail object that can carry client data.
  ok(!/response,?\s*\n\s*\}\);\s*$/m.test(matrixSource.slice(matrixSource.indexOf('direction:'))),
    'the raw gateway response stays in the private detail only');
  for (const code of ['f136_gateway_more_restrictive', 'f136_gateway_more_permissive']) {
    ok(runner.FAILURE_CODES.has(code), `${code} is allowlisted`);
  }
  ok(!runner.FAILURE_CODES.has('f136_policy_oracle_mismatch'),
    'the direction-blind code is gone rather than left reachable alongside the split');
  // f136_forbidden_tuple_escaped is a DIFFERENT layer and must stay that way:
  // it fires when the browser status control DISPATCHES a transition policy
  // forbids, before any gateway response exists. It is not the permissive-case
  // code for the gateway.
  const controlSource = source.slice(
    source.indexOf('async function browserMatrixStatusControl('),
    source.indexOf('async function runF136Matrix('),
  );
  ok(/f136_forbidden_tuple_escaped/.test(controlSource)
    && !/f136_forbidden_tuple_escaped/.test(matrixSource),
  'forbidden_tuple_escaped stays a UI-control refusal, not a gateway verdict');
  ok(/interaction\.dispatched === false/.test(controlSource)
    && !/classifyMatrixAttempt/.test(controlSource),
  'the UI-control refusal never inspects a gateway response, so it cannot replace the split');

  // Every matrix enum the facts can carry is the real one, not a copy that
  // drifted. Statuses come from policy.mjs; roles, routes and classifications
  // come from the loops and the classifier that produce them.
  ok(JSON.stringify(runner.DELIVERABLE_STATUS_ENUMS) === JSON.stringify(policy.DELIVERABLE_STATUSES),
    'the pinned status enums equal policy.mjs DELIVERABLE_STATUSES exactly');
  ok(/for \(const role of MATRIX_ROLES\) \{/.test(source),
    'the matrix role loop and the role enum set are the same list');
  ok(runner.MATRIX_ROUTES.every(route => matrixSource.includes(`driveSurface('${route}'`)),
    'every route enum is a route the matrix actually drives');
  for (const classification of runner.MATRIX_CLASSIFICATIONS) {
    ok(source.includes(`return '${classification}'`),
      `classifyMatrixAttempt really returns ${classification}`);
  }
  ok(runner.classifyMatrixAttempt(403, { error: 'operation_forbidden' }) === 'forbidden'
    && runner.classifyMatrixAttempt(409, { error: 'team_is_linear_authoritative' }) === 'authority_fenced'
    && runner.classifyMatrixAttempt(503, {}) === 'unexpected',
  'the classifier maps the three verdicts the facts can report');
  // Both directions round-trip, and a bogus one degrades.
  ok(factsFor({ direction: 'gateway_more_permissive' }).direction === 'gateway_more_permissive'
    && factsFor({ direction: 'gateway_more_restrictive' }).direction === 'gateway_more_restrictive'
    && factsFor({ direction: 'sideways' }).direction === 'unrecognized_enum',
  'the direction field accepts exactly the two directions');
  ok(factsFor({ role: 'creative' }).role === 'creative'
    && factsFor({ role: 'owner' }).role === 'unrecognized_enum'
    && factsFor({ current: 'smm_approval' }).current === 'smm_approval'
    && factsFor({ next: 'acme-launch' }).next === 'unrecognized_enum'
    && factsFor({ ownership: 'peer' }).ownership === 'peer'
    && factsFor({ route: 'list' }).route === 'list'
    && factsFor({ classification: 'authority_fenced' }).classification === 'authority_fenced',
  'every matrix fact is gated by its own enum set');

  // ---- The rebaseline parser reads the probe's REAL output format --------
  // Run #17 reported rebaseline_medians_unbounded while the probe itself
  // exited 0 with no failure marker. The probe prints
  //   `wall_med=${String(median(...)).padStart(5)}ms`
  // and padStart pads with SPACES, so a healthy line is `wall_med=  392ms`.
  // A pattern requiring a digit right after `=` matched ZERO times for any
  // value under 10000ms: the check could only pass on a catastrophically slow
  // read path. Driven through the real parser, against lines built the way the
  // probe builds them.
  const probeSource = fs.readFileSync(
    path.join(ROOT, 'qa', 'probes', 'prod_read_path_timing.js'), 'utf8');
  ok(probeSource.includes('`wall_med=${String(median(good.map(run => run.wall))).padStart(5)}ms`'),
    'the probe still pads its wall medians, which is the format the parser must read');
  ok(/const sorted = \[\.\.\.values\]\.sort/.test(probeSource)
    && /return sorted\.length \? sorted\[Math\.floor\(sorted\.length \/ 2\)\] : 0;/.test(probeSource),
  'median still returns a plain number, so the parsed value is the measurement');
  // delta mode runs exactly three shapes, which is why the drill wants three.
  const deltaBody = probeSource.slice(
    probeSource.indexOf('async function delta()'),
    probeSource.indexOf('async function burst()'),
  );
  ok((deltaBody.match(/await shape\(/g) || []).length === 3,
    'delta mode still emits exactly three medians, so === 3 is the right count');

  const probeLine = (label, wall) => [
    String(label).padEnd(34),
    `upstream_med=${String(wall - 40).padStart(5)}ms`,
    `wall_med=${String(wall).padStart(5)}ms`,
    `rows=${String(97).padStart(4)}`,
    `kb=${String(180).padStart(5)}`,
    '',
  ].join('  ').trimEnd();
  const realOutput = [
    '\n== F95 refresh predicate ==',
    '   What one foreground tick costs once a watermark is held.\n',
    probeLine('delta, 15 minute window', 392),
    probeLine('delta, 24 hour window', 415),
    probeLine('watermark read', 88),
  ].join('\n');
  ok(realOutput.includes('wall_med=  392ms'),
    'the fixture reproduces the padded shape a healthy run actually prints');
  ok(JSON.stringify(runner.parseWallMedians(realOutput)) === JSON.stringify([392, 415, 88]),
    'three padded medians parse back as three numbers');
  // A wide value needs no padding and must still parse -- the only case the
  // old pattern could ever match.
  ok(JSON.stringify(runner.parseWallMedians(probeLine('slow shape', 12345))) === JSON.stringify([12345]),
    'an unpadded five-digit median still parses');
  // upstream_med must never be counted: three shapes would look like six.
  ok(runner.parseWallMedians('upstream_med=  352ms').length === 0,
    'upstream_med is not mistaken for a wall median');
  ok(runner.parseWallMedians('').length === 0
    && runner.parseWallMedians(null).length === 0
    && runner.parseWallMedians('wall_med=ms').length === 0,
  'empty, absent and malformed output yield no medians rather than a bogus one');
  // Fractional medians are possible in principle and must survive.
  ok(JSON.stringify(runner.parseWallMedians('wall_med= 12.5ms')) === JSON.stringify([12.5]),
    'a fractional median parses as a fraction');
  // The bound and the count are NOT relaxed.
  const rebaselineSource = source.slice(
    source.indexOf('function runReadRebaseline('),
    source.indexOf('function emptyReport('),
  );
  ok(/medianMatches\.length === 3/.test(rebaselineSource),
    'the rebaseline still requires exactly three medians');
  ok(/value <= MATRIX_TICK_MS/.test(rebaselineSource),
    'the rebaseline still bounds every median by MATRIX_TICK_MS');
  ok(/const medianMatches = parseWallMedians\(raw\);/.test(rebaselineSource),
    'the rebaseline reads its medians through the tested parser');

  // ---- Audit: the OTHER text contract between the drill and the probe ----
  // The probe never throws or exits non-zero when a shape's requests fail --
  // shape() only logs FAILED=[...] and the runner exits 0 -- so
  // result.status === 0 does NOT catch a failed read path. The textual marker
  // is the only guard, and it is load-bearing for a second reason: median([])
  // returns 0, so a shape whose every rep failed prints `wall_med=    0ms`,
  // which parses cleanly and passes the MATRIX_TICK_MS bound. Pin the format
  // so a rename in the probe cannot silently turn a failure into a pass.
  ok(probeSource.includes("failed.length ? `FAILED=[${failed.join(' ')}]` : ''"),
    'the probe still marks a failed shape with FAILED=[...], the drill\'s only signal');
  ok(/return sorted\.length \? sorted\[Math\.floor\(sorted\.length \/ 2\)\] : 0;/.test(probeSource),
    'median([]) is still 0, so a fully failed shape reports a BOUNDED median');
  ok(runner.parseWallMedians(probeLine('all reps failed', 0)).length === 1
    && runner.parseWallMedians(probeLine('all reps failed', 0))[0] === 0,
  'a fully failed shape parses as median 0, which the bound alone would accept');
  ok(/process\.exit\(1\)/.test(probeSource) && !/shape[\s\S]{0,600}process\.exit/.test(probeSource),
    'the probe exits non-zero only on an unhandled error, never for a failed shape');
  const failedMarkerSource = rebaselineSource.slice(rebaselineSource.indexOf('const failedMarker'));
  ok(/FAILED\|ABORTED/.test(failedMarkerSource),
    'the drill still refuses on that marker, since the exit code cannot see it');

  // ---- F95: why the list did not scroll, not just that it did not ---------
  // The probe returned one number: -1 meant the element was never found, 0
  // meant it was found and did not scroll. Those have different owners --
  // .prod-listwrap is rendered ONLY on the non-empty branch of the production
  // list, so an absent container is a drill/data precondition, while a present
  // one that grew instead of scrolling is a layout finding.
  const f95Source = source.slice(
    source.indexOf('async function runF95Convergence('),
    source.indexOf('async function optionalRunOwnedDeliverable('),
  );
  ok(/found: !!list,/.test(f95Source)
    && /clientHeight: list \? round\(list\.clientHeight\) : 0,/.test(f95Source)
    && /scrollHeight: list \? round\(list\.scrollHeight\) : 0,/.test(f95Source)
    && /offsetParentHeight: list && list\.offsetParent/.test(f95Source)
    && /viewportWidth: round\(window\.innerWidth\),/.test(f95Source)
    && /rowCount: document\.querySelectorAll\('\.prod-row'\)\.length,/.test(f95Source),
  'the scroll probe measures the element, its box, the viewport and the row count');
  for (const [code, why] of [
    ['f95_list_container_absent', 'the container was never rendered'],
    ['f95_list_not_constrained', 'the container grew instead of scrolling'],
    ['f95_surface_not_scrollable', 'the container could scroll and did not'],
  ]) {
    ok(runner.FAILURE_CODES.has(code) && f95Source.includes(`'${code}'`),
      `${code} names one cause: ${why}`);
  }
  // Order matters: absent, then unconstrained, then not scrolled.
  ok(f95Source.indexOf('f95_list_container_absent') < f95Source.indexOf('f95_list_not_constrained')
    && f95Source.indexOf('f95_list_not_constrained') < f95Source.indexOf('f95_surface_not_scrollable'),
  'the three preconditions are checked in the order they occur');
  // The scroll proof itself is NOT weakened: the final assert still demands a
  // real non-zero scrollTop in every context.
  ok(/assert\(listScrollBefore\.every\(probe => probe\.scrollTop > 0\), 'f95_convergence',/
    .test(f95Source),
  'the scroll assert still requires a real scroll position in every context');
  ok(/value === listScrollBefore\[index\]\.scrollTop && value > 0/.test(f95Source),
    'the preserved-scroll comparison reads the measured scrollTop, not the probe object');
  // The failing context is the one reported, not context 1 unconditionally.
  ok(/listScrollBefore\.find\(probe => !\(probe && probe\.scrollTop > 0\)\)/.test(f95Source),
    'the reported measurements come from the context that actually failed');
  // All three refusals must carry the measurements: a code that names the
  // cause but reports no numbers is the same swallowed diagnosis again.
  ok(occurrences(f95Source, 'undefined, scrollFacts);') === 3,
    'every one of the three scroll refusals carries the measurements');
  // Explicit viewport: a headless layout precondition must be a property of
  // the drill, not of whatever default the browser driver ships.
  ok(runner.DRILL_VIEWPORT.width === 1280 && runner.DRILL_VIEWPORT.height === 800,
    'the drill states one explicit viewport');
  ok(/browser\.newContext\(\{ viewport: \{ \.\.\.DRILL_VIEWPORT \} \}\)/.test(source),
    'every drill context is created at that explicit viewport');
  // The measurement fields are bounded integers, not a smuggling channel.
  ok(factsFor({ list_element: 'missing' }).list_element === 'missing'
    && factsFor({ list_element: 'found' }).list_element === 'found'
    && factsFor({ list_element: 'acme-corp' }).list_element === 'unrecognized_enum',
  'list_element is an enum, not free text');
  ok(factsFor({ client_height: 1874 }).client_height === 1874
    && factsFor({ client_height: 0 }).client_height === 0
    && factsFor({ client_height: -1 }).client_height === 0
    && factsFor({ client_height: 9e9 }).client_height === 0
    && factsFor({ scroll_height: 'tall' }).scroll_height === 0,
  'a pixel fact is a bounded non-negative integer or nothing');
  ok(factsFor({ viewport_width: 1280 }).viewport_width === 1280
    && factsFor({ viewport_height: 800 }).viewport_height === 800
    && factsFor({ row_count: 7 }).row_count === 7,
  'the viewport and row count round-trip as plain integers');

  // ---- Targeted drain receipt: the evidence is checked, not discarded ----
  // linear-outbound answers ok:false only when counts.failed > 0. Three other
  // paths finish a create WITHOUT its linkage, leave counts.failed at 0 and
  // answer ok:true, so edgeWrite was satisfied and the only remaining signal
  // was a 60s linkage poll timing out. Driven through the REAL checker.
  const drainReceipt = (over = {}, counts = {}) => ({
    ok: true,
    counts: { written: 1, failed: 0, skipped: 0, stale_dropped: 0, ...counts },
    target: {
      dedup_key: 'drill-dedup',
      status: 'written',
      attempts: 1,
      last_error: null,
      linear_result: { mutation: 'issueCreate', issue_id: 'issue-uuid-1' },
      ...over,
    },
  });
  const drainCode = (drain, expect) => {
    try {
      runner.assertDrainReceipt(drain, 'drill-dedup', 'preflight', expect);
      return null;
    } catch (error) {
      return error.code;
    }
  };
  const drainCases = [
    // The three silent no-linkage paths, each with its own code.
    ['a written create carrying no minted issue id',
      drainReceipt({ linear_result: { mutation: 'issueCreate' } }), 'created',
      'linkage_result_shape_invalid'],
    ['a create tolerated as historical',
      drainReceipt({
        status: 'skipped',
        linear_result: { conflict: { decision: 'tolerated_historical' }, issue: { id: 'x' } },
      }, { written: 0, skipped: 1 }), 'created', 'create_tolerated_historical'],
    ['a create dropped as stale',
      drainReceipt({
        status: 'stale',
        linear_result: { conflict: { decision: 'stale' } },
      }, { written: 0, stale_dropped: 1 }), 'created', 'create_stale_dropped'],
    // Everything else a create must not end as.
    ['a create left pending', drainReceipt({ status: 'pending', linear_result: {} }, { written: 0 }),
      'created', 'drain_create_not_written'],
    ['a drain reporting a failed row', drainReceipt({}, { failed: 1 }), 'created', 'drain_row_failed'],
    ['a receipt for a different intent', drainReceipt({ dedup_key: 'someone-elses' }), 'created',
      'drain_receipt_missing'],
    ['a response with no receipt at all', { ok: true, counts: {} }, 'created', 'drain_receipt_missing'],
    // A create skipped for any reason OTHER than the two named above still
    // refuses, just under the generic code -- the enumeration is a diagnostic
    // refinement, never an escape hatch.
    ['a create skipped on a parent conflict',
      drainReceipt({
        status: 'skipped',
        linear_result: { conflict: { decision: 'parent_create_idempotency_conflict' } },
      }, { written: 0, skipped: 1 }), 'created', 'drain_create_not_written'],
  ];
  for (const [label, drain, expect, expectedCode] of drainCases) {
    ok(drainCode(drain, expect) === expectedCode, `${label} refuses as ${expectedCode}`);
  }
  ok(drainCode(drainReceipt(), 'created') === null,
    'a written create that minted an issue passes the strict receipt check');
  ok(drainCode(drainReceipt({ linear_result: { conflict: {}, issue: { id: 'i' } } }), 'created') === null,
    'the minted id is accepted from linear_result.issue.id as well as issue_id');

  // Cleanup runs under partial failure by design. A re-drained archive intent
  // can legitimately come back skipped or stale, and ensureDedupTerminal
  // already defines terminal as exactly that set, so a written-only rule here
  // would turn healthy recovery into a coded failure and strand the run.
  for (const status of ['written', 'skipped', 'stale']) {
    ok(runner.DRAIN_TERMINAL_STATUSES.has(status),
      `cleanup still tolerates a ${status} re-drain`);
    ok(drainCode(drainReceipt({ status, linear_result: {} }), 'terminal') === null,
      `a ${status} cleanup re-drain is not a failure`);
  }
  // ...but cleanup still refuses a non-terminal row and a failed count.
  ok(drainCode(drainReceipt({ status: 'pending' }, { written: 0 }), 'terminal')
    === 'drain_intent_not_terminal',
  'a cleanup re-drain that left its intent pending still refuses');
  ok(drainCode(drainReceipt({ status: 'skipped' }, { failed: 1 }), 'terminal') === 'drain_row_failed',
    'a cleanup re-drain that reported a failed row still refuses');
  // The tolerated-historical and stale codes are create-only. Firing them from
  // cleanup is exactly the regression this parameterization prevents.
  ok(drainCode(drainReceipt({
    status: 'skipped',
    linear_result: { conflict: { decision: 'tolerated_historical' } },
  }, { written: 0, skipped: 1 }), 'terminal') === null,
  'tolerated_historical is a create-only refusal, never a cleanup one');

  // Every call site declares its expectation, and the fixture creates are the
  // only strict ones.
  ok(/async function drainTestOutbox\(runtime, dedup, stage, expect\)/.test(source),
    'drainTestOutbox takes a required per-call-site expectation');
  ok(/assert\(DRAIN_EXPECTATIONS\.has\(expect\), stage,[\s\S]{0,160}'drain_expectation_missing'\)/
    .test(source),
  'drainTestOutbox refuses at runtime when no expectation was declared');
  const drainCallSites = [...source.matchAll(/drainTestOutbox\(runtime, [A-Za-z]+, '[a-z0-9_]+'(?:, '([a-z]+)')?\)/g)]
    .map(match => match[1]);
  ok(drainCallSites.length === 7 && drainCallSites.every(expect => expect === 'created' || expect === 'terminal'),
    `every drainTestOutbox call site declares an expectation (${drainCallSites.length} sites)`);
  ok(drainCallSites.filter(expect => expect === 'created').length === 2,
    'exactly the two fixture creates use the strict expectation');
  ok(/return assertDrainReceipt\(drain, dedup, stage, expect\);/.test(source),
    'drainTestOutbox hands the checked receipt back rather than discarding it');

  // ---- Linear query complexity: every nested connection is bounded --------
  // An unbounded nested connection takes the platform default of 50, which
  // multiplies against the outer page size. projects(250) x teams(default 50)
  // was rejected 400. These assertions exist so the bounds are not "optimized"
  // away and the 400 silently reintroduced.
  const preflightQueries = source.slice(
    source.indexOf('const [projectsData, teamsData, usersData] = await Promise.all(['),
    source.indexOf('const projects = projectsData.projects'),
  );
  ok(/projects\(first: 250, includeArchived: true\)/.test(preflightQueries),
    'the projects outer page size is unchanged at a flat 250');
  ok(/teams\(first: 10\) \{ nodes \{ id key name \} \}/.test(preflightQueries),
    'the projects query bounds its NESTED teams connection');
  ok(/teams\(first: 10\) \{/.test(preflightQueries)
    && !/\bteams\(first: 50\)/.test(preflightQueries),
  'the teams outer page size is reduced to 10 (6 teams exist workspace-wide)');
  ok(/states\(first: 50\)/.test(preflightQueries),
    'the teams query bounds its NESTED states connection explicitly');
  ok(/users\(first: \$first, includeArchived: true\)/.test(preflightQueries),
    'the users query is left alone: no nesting, and 250 flat is proven in production');
  // No connection anywhere in these three documents may be left unbounded.
  const unboundedNested = (preflightQueries.match(/\b(teams|states|nodes|projects|users|issues|members)\s*\{/g) || [])
    .filter(match => !/^nodes/.test(match.trim()));
  ok(unboundedNested.length === 0,
    'no connection in the preflight Linear documents is left without a first: bound');
  const linearReadSource = sourceFunction(source, 'linearRead');
  ok(!/body\.errors\[0\]|errors\[0\]\.message|\.message\b[\s\S]{0,40}fail\(/.test(linearReadSource),
    'no GraphQL error text is promoted into the public code path');
  for (const invoke of [
    () => runner.restWrite(offlineGuardRuntime, 'deliverables?id=eq.offline', {
      method: 'PATCH',
      body: nestedMemberPayload,
      targetClientSlug: 'test-only',
      stage: 'f94_negative',
    }),
    () => runner.edgeWrite(
      offlineGuardRuntime,
      'offline-edge',
      nestedMemberPayload,
      { targetClientSlug: 'test-only', stage: 'f94_negative' },
    ),
    () => runner.gatewayWrite(
      offlineGuardRuntime,
      nestedMemberPayload,
      { targetClientSlug: 'test-only', stage: 'f136_matrix' },
    ),
    () => runner.guardedBrowserVerifier(offlineGuardRuntime, {
      method: () => 'POST',
      url: () => 'https://offline.invalid/functions/v1/key-verify',
      postData: () => JSON.stringify({
        surface: 'staff-login',
        member: { id: realMemberId },
      }),
      headers: () => ({}),
    }, 'offline', {
      targetClientSlug: 'test-only',
      stage: 'f37_identity',
    }),
  ]) {
    let rejected = false;
    try {
      await invoke();
    } catch (_error) {
      rejected = true;
    }
    ok(rejected && guardedFetches === 0,
      'a write adapter aborts an inactive/nested real-member reference before fetch');
  }
  let serializedRejects = 0;
  for (const invoke of [
    () => runner.restWrite(offlineGuardRuntime, 'deliverables?id=eq.offline', {
      method: 'PATCH',
      body: serializedMemberPayload,
      targetClientSlug: 'test-only',
      stage: 'f136_matrix',
    }),
    () => runner.edgeWrite(
      offlineGuardRuntime,
      'offline-edge',
      serializedMemberPayload,
      { targetClientSlug: 'test-only', stage: 'f136_matrix' },
    ),
    () => runner.gatewayWrite(
      offlineGuardRuntime,
      serializedMemberPayload,
      { targetClientSlug: 'test-only', stage: 'f136_matrix' },
    ),
  ]) {
    try {
      await invoke();
    } catch (_error) {
      serializedRejects++;
    }
  }
  let queryRejected = false;
  try {
    await runner.restWrite(
      offlineGuardRuntime,
      `deliverables?assignee_id=eq.${realMemberId}`,
      {
        method: 'PATCH',
        body: { status: 'todo' },
        targetClientSlug: 'test-only',
        stage: 'f136_matrix',
      },
    );
  } catch (_error) {
    queryRejected = true;
  }
  let logicalQueryRejected = false;
  try {
    await runner.restWrite(
      offlineGuardRuntime,
      `deliverables?or=(assignee_id.eq.${realMemberId},status.eq.todo)`,
      {
        method: 'PATCH',
        body: { status: 'todo' },
        targetClientSlug: 'test-only',
        stage: 'f136_matrix',
      },
    );
  } catch (_error) {
    logicalQueryRejected = true;
  }
  ok(serializedRejects === 3
    && queryRejected
    && logicalQueryRejected
    && guardedFetches === 0,
  'every accepting adapter rejects serialized, direct-query, or logical-filter member escapes before fetch');
  let broadTargetFetches = 0;
  const broadTargetRuntime = {
    ...offlineGuardRuntime,
    readOnlyMemberIds: new Set(),
    createdMemberIds: new Set(),
    createdDeliverableIds: new Set(['owned-deliverable']),
    fetch: async () => {
      broadTargetFetches++;
      throw new Error('broad PostgREST target leaked to fetch');
    },
  };
  let broadTargetRejects = 0;
  for (const resource of [
    'deliverables?status=eq.todo',
    'deliverables?id=eq.owned-deliverable',
    'deliverables?id=eq.some-other-row&client_slug=eq.test-only',
    'clients?id=eq.owned-deliverable&client_slug=eq.test-only',
  ]) {
    try {
      await runner.restWrite(broadTargetRuntime, resource, {
        method: 'PATCH',
        body: { status: 'todo' },
        deliverableId: 'owned-deliverable',
        targetClientSlug: 'test-only',
        stage: 'f136_matrix',
      });
    } catch (_error) {
      broadTargetRejects++;
    }
  }
  ok(broadTargetRejects === 4 && broadTargetFetches === 0,
    'PostgREST writes bind the allowed table, exact run-owned id, and active TEST client before fetch');
  let edgeTargetFetches = 0;
  const edgeTargetRuntime = {
    ...broadTargetRuntime,
    createdBatchIds: new Set(['owned-batch']),
    createdDedups: new Set(['owned-dedup']),
    fetch: async () => {
      edgeTargetFetches++;
      throw new Error('mismatched Edge target leaked to fetch');
    },
  };
  let edgeTargetRejects = 0;
  for (const invoke of [
    () => runner.edgeWrite(edgeTargetRuntime, 'deliverable-write', {
      id: 'real-deliverable',
      operation: 'archive',
      patch: {},
      test_override: true,
      confirm: 'B4_TEST_ONLY',
    }, {
      deliverableId: 'owned-deliverable',
      targetClientSlug: 'test-only',
      stage: 'cleanup',
    }),
    () => runner.edgeWrite(edgeTargetRuntime, 'batch-write', {
      id: 'real-batch',
      operation: 'archive',
      patch: {},
      test_override: true,
      confirm: 'B4_TEST_ONLY',
    }, {
      batchId: 'owned-batch',
      targetClientSlug: 'test-only',
      stage: 'cleanup',
    }),
    () => runner.edgeWrite(edgeTargetRuntime, 'unknown-write', {
      id: 'owned-deliverable',
    }, {
      deliverableId: 'owned-deliverable',
      targetClientSlug: 'test-only',
      stage: 'cleanup',
    }),
    () => runner.edgeWrite(edgeTargetRuntime, 'linear-outbound', {
      limit: 1,
      target_dedup_key: 'foreign-dedup',
      test_override: {
        client_slug: 'test-only',
        mode: 'live',
        authority: 'syncview',
      },
      confirm: 'B4_TEST_ONLY',
    }, {
      targetClientSlug: 'test-only',
      stage: 'cleanup',
    }),
  ]) {
    try {
      await invoke();
    } catch (_error) {
      edgeTargetRejects++;
    }
  }
  ok(edgeTargetRejects === 4 && edgeTargetFetches === 0,
    'Edge writes bind function, body target, and outbound dedup before fetch');
  let gatewayTargetFetches = 0;
  const gatewayTargetRuntime = {
    ...edgeTargetRuntime,
    fetch: async () => {
      gatewayTargetFetches++;
      throw new Error('mismatched gateway target leaked to fetch');
    },
  };
  let gatewayTargetRejects = 0;
  for (const body of [
    {
      operation: 'assignee',
      entity: 'deliverable',
      surface: 'production',
      test_override: true,
      confirm: 'B4_TEST_ONLY',
    },
    {
      operation: 'assignee',
      entity: 'deliverable',
      surface: 'production',
      id: 'real-deliverable',
      test_override: true,
      confirm: 'B4_TEST_ONLY',
    },
    {
      operation: 'assignee',
      entity: 'deliverable',
      surface: 'production',
      id: 'owned-deliverable',
      client_slug: 'real-client',
      test_override: true,
      confirm: 'B4_TEST_ONLY',
    },
    {
      operation: 'intake_create',
      entity: 'deliverable',
      surface: 'production',
      id: 'owned-deliverable',
      test_override: true,
      confirm: 'B4_TEST_ONLY',
    },
    {
      operation: 'assignee',
      entity: 'batch',
      surface: 'production',
      id: 'owned-deliverable',
      test_override: true,
      confirm: 'B4_TEST_ONLY',
    },
    {
      operation: 'assignee',
      entity: 'deliverable',
      surface: 'calendar',
      id: 'owned-deliverable',
      test_override: true,
      confirm: 'B4_TEST_ONLY',
    },
  ]) {
    try {
      await runner.gatewayWrite(gatewayTargetRuntime, body, {
        targetClientSlug: 'test-only',
        stage: 'f94_negative',
      });
    } catch (_error) {
      gatewayTargetRejects++;
    }
  }
  ok(gatewayTargetRejects === 6 && gatewayTargetFetches === 0,
    'gateway writes bind production surface, operation, entity, body id, and client scope before fetch');
  let assigneeOptionFetches = 0;
  const assigneeOptionsRuntime = {
    ...gatewayTargetRuntime,
    fetch: async (url, init = {}) => {
      assigneeOptionFetches++;
      const href = String(url);
      if (href.includes('/rest/v1/deliverables?')) {
        return new Response(JSON.stringify([{
          id: 'owned-deliverable',
          client_slug: 'test-only',
          title: 'drill slice5-offline fixture',
          brief: 'drill slice5-offline fixture',
        }]), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (href.includes('/rest/v1/clients?')) {
        return new Response(JSON.stringify([{
          slug: 'test-only',
          kind: 'test',
          active: true,
        }]), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (href.endsWith('/functions/v1/production-write') && init.method === 'POST') {
        return new Response(JSON.stringify({
          ok: true,
          complete: true,
          assignees: [],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      throw new Error('unexpected offline assignee-options request');
    },
  };
  const assigneeOptionsBody = {
    action: 'assignee_options',
    surface: 'production',
    id: 'owned-deliverable',
    client_slug: 'test-only',
    request_id: 'offline-assignee-options',
    test_override: true,
    confirm: 'B4_TEST_ONLY',
  };
  const assigneeOptionsResponse = await runner.gatewayWrite(
    assigneeOptionsRuntime,
    assigneeOptionsBody,
    { targetClientSlug: 'test-only', stage: 'f94_stale_picker' },
  );
  const assigneeOptionsFetchesAfterSuccess = assigneeOptionFetches;
  let assigneeOptionsMutationShapeRejected = false;
  try {
    await runner.gatewayWrite(assigneeOptionsRuntime, {
      ...assigneeOptionsBody,
      status: 'todo',
    }, {
      targetClientSlug: 'test-only',
      stage: 'f94_stale_picker',
    });
  } catch (_error) {
    assigneeOptionsMutationShapeRejected = true;
  }
  ok(assigneeOptionsResponse.status === 200
      && assigneeOptionsFetchesAfterSuccess === 3
      && assigneeOptionsMutationShapeRejected
      && assigneeOptionFetches === assigneeOptionsFetchesAfterSuccess,
  'the stale-picker assignee-options read has one exact offline courier and rejects mutation fields');
  const pinnedLinearId = 'e92452e1-4499-41e1-8519-e8d066d99e43';
  const pinnedLinearEmail = 'laruelsidney@gmail.com';
  const inactiveLinearUser = {
    id: 'offline-inactive-provider',
    email: 'archived@example.invalid',
    active: false,
  };
  const nonPinnedActiveUser = {
    id: 'offline-real-active-user',
    email: 'person@example.invalid',
    active: true,
  };
  const selectedLinearUsers = runner.selectLinearDrillProviderUsers({
    nodes: [
      nonPinnedActiveUser,
      { id: pinnedLinearId, email: pinnedLinearEmail, active: true },
      inactiveLinearUser,
    ],
  });
  ok(selectedLinearUsers.machineUser.id === pinnedLinearId
      && selectedLinearUsers.machineUser.email === pinnedLinearEmail
      && selectedLinearUsers.inactiveUser.id === inactiveLinearUser.id,
  'preflight pins the eligible provider to SyncView Mirror and ignores another active user');
  let nonPinnedActiveRejected = false;
  try {
    runner.selectLinearDrillProviderUsers({
      nodes: [nonPinnedActiveUser, inactiveLinearUser],
    });
  } catch (_error) {
    nonPinnedActiveRejected = true;
  }
  ok(nonPinnedActiveRejected,
    'a non-pinned active Linear user is refused instead of becoming the drill assignee');
  let pinnedMismatchRejected = false;
  try {
    runner.selectLinearDrillProviderUsers({
      nodes: [
        { id: pinnedLinearId, email: 'wrong@example.invalid', active: true },
        inactiveLinearUser,
      ],
    });
  } catch (_error) {
    pinnedMismatchRejected = true;
  }
  ok(pinnedMismatchRejected,
    'preflight aborts on pinned account drift');
  // An inactive provider user is OPTIONAL. The workspace has none, and
  // deactivating a real Linear seat to manufacture one is not an acceptable
  // cost, so its absence skips exactly one negative case instead of aborting
  // the whole run.
  const withoutInactive = runner.selectLinearDrillProviderUsers({
    nodes: [{ id: pinnedLinearId, email: pinnedLinearEmail, active: true }],
  });
  ok(withoutInactive && withoutInactive.inactiveUser === null,
    'a workspace with no inactive provider user resolves to null rather than aborting preflight');
  const withInactive = runner.selectLinearDrillProviderUsers({
    nodes: [
      { id: pinnedLinearId, email: pinnedLinearEmail, active: true },
      inactiveLinearUser,
    ],
  });
  ok(withInactive && withInactive.inactiveUser
    && withInactive.inactiveUser.id === inactiveLinearUser.id,
  'an inactive provider user is still selected when the workspace has one');
  const embeddedUuids = [...source.matchAll(
    /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi,
  )].map(match => match[0].toLowerCase());
  ok(JSON.stringify([...new Set(embeddedUuids)]) === JSON.stringify([pinnedLinearId]),
    'the only embedded UUID is the explicitly pinned SyncView Mirror provider id');

  // ---- Public privacy: a closed projection, not generic redaction --------
  const rawPrivateFixture = {
    schema_version: 1,
    ok: false,
    mode: 'test_only',
    scope: 'active_test_only',
    error_code: 'preflight',
    client_slug: 'private-real-client',
    member_id: 'private-member-id',
    occurred_at: '2026-07-26T00:00:00Z',
    error: { message: 'private backend failure', stack: 'private stack' },
  };
  let rawFixtureRejected = false;
  try {
    runner.sanitizePublicReport(rawPrivateFixture);
  } catch (error) {
    rawFixtureRejected = /public report/.test(String(error && error.message));
  }
  ok(rawFixtureRejected,
    'the public projection rejects rather than redacts a payload containing private strings');
  const sanitized = runner.sanitizePublicReport(runner.emptyReport());
  const publicText = JSON.stringify(sanitized);
  ok(publicLeavesAreSafe(sanitized),
    'the sanitizer emits only finite enums, non-negative counts, and booleans');
  ok(Object.prototype.hasOwnProperty.call(sanitized.f37_identity, 'duplicate_label_ok')
    && !Object.prototype.hasOwnProperty.call(sanitized.f37_identity, 'duplicate_names_ok'),
  'duplicate-display-name evidence is a boolean with no identity-bearing key');
  ok(!Object.prototype.hasOwnProperty.call(sanitized.f136_matrix, 'route_mode_count')
    && !Object.prototype.hasOwnProperty.call(sanitized.f136_matrix, 'device_count'),
  'public F136 evidence does not overclaim unexercised route or device paths');
  for (const privateValue of [
    'private-real-client',
    'private-member-id',
    '2026-07-26',
    'private backend failure',
    'private stack',
  ]) {
    ok(!publicText.includes(privateValue), `public payload excludes private fixture value: ${privateValue}`);
  }
  ok(!/"(?:client_slug|member_id|occurred_at|error|message|stack|details?)"\s*:/.test(publicText),
    'public payload contains no raw errors, ids, slugs, times, or details');

  const privateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'slice5-drill-private-'));
  const privateLog = path.join(privateDir, 'failure.json');
  ok(runner.writePrivateFailure(
    new Error('private failure detail'),
    'f94_negative',
    privateLog,
    ROOT,
  ), 'raw failure detail can be written only to an explicit runner-private path');
  const privatePayload = JSON.parse(fs.readFileSync(privateLog, 'utf8'));
  ok(privatePayload.message === 'private failure detail'
    && privatePayload.stack.includes('private failure detail'),
  'the runner-private failure file retains diagnostic detail');
  let repoPrivateRejected = false;
  const repoPrivatePath = path.join(ROOT, 'artifacts', 'must-not-exist-private.json');
  try {
    runner.writePrivateFailure(new Error('do not publish'), 'fixture', repoPrivatePath, ROOT);
  } catch (_error) {
    repoPrivateRejected = true;
  }
  ok(repoPrivateRejected && !fs.existsSync(repoPrivatePath),
    'private failure detail is refused anywhere inside the public repository');
  ok(!/console\.(?:log|error)\([^)]*(?:failure|error)\.(?:message|stack)/.test(source)
    && !/\btee\b/.test(source),
  'raw failure bodies are not wired to console output');

  // ---- F94: all four refusals plus exact zero/atomic proofs ---------------
  const refusalEnums = [
    'assignee_out_of_scope',
    'assignee_role_incompatible',
    'assignee_mapping_unavailable',
    'assignee_provider_inactive',
  ];
  ok(refusalEnums.every(value => source.includes(value)),
    'F94 covers every owed refusal enum');
  ok(/F94_REFUSAL_ENUMS/.test(source)
    && refusalEnums.every(value =>
      (source.match(new RegExp(`${value}['"]?\\s*[:,]?[\\s\\S]{0,100}\\b(?:403|409)\\b`))
        || source.match(new RegExp(`\\b(?:403|409)\\b[\\s\\S]{0,100}${value}`)))),
  'F94 refusal enum/status expectations are explicit');
  ok(source.includes('deliverables')
    && source.includes('deliverable_events')
    && source.includes('mirror_outbox'),
  'F94 snapshots the row, event, and outbox stores');
  ok(/assertZeroF94Mutation/.test(source)
    && /(?:before|baseline)/i.test(source)
    && /after/i.test(source),
  'every refusal is proven by before/after zero-mutation evidence');
  ok(/assertEligibleAssignmentBundle/.test(source)
    && /eligible_bundle_count/.test(source),
  'the eligible assignment requires native row, event, and outbox to appear together');
  const f94Baseline = {
    row: { assignee_id: null, updated_at: 'stable-fixture' },
    eventCount: 0,
    outboxCount: 0,
  };
  ok(runner.assertZeroF94Mutation(f94Baseline, {
    row: { assignee_id: null, updated_at: 'stable-fixture' },
    eventCount: 0,
    outboxCount: 0,
  }, 'offline') === true,
  'the zero-mutation oracle accepts an unchanged row with zero event/outbox rows');
  for (const changed of [
    { row: { assignee_id: 'changed', updated_at: 'stable-fixture' }, eventCount: 0, outboxCount: 0 },
    { row: { assignee_id: null, updated_at: 'stable-fixture' }, eventCount: 1, outboxCount: 0 },
    { row: { assignee_id: null, updated_at: 'stable-fixture' }, eventCount: 0, outboxCount: 1 },
  ]) {
    let rejected = false;
    try {
      runner.assertZeroF94Mutation(f94Baseline, changed, 'offline');
    } catch (_error) {
      rejected = true;
    }
    ok(rejected, 'the zero-mutation oracle rejects each row/event/outbox delta independently');
  }
  ok(runner.assertEligibleAssignmentBundle(f94Baseline, {
    row: { assignee_id: 'eligible-member', updated_at: 'changed-fixture' },
    eventCount: 1,
    outboxCount: 1,
  }, 'eligible-member') === true,
  'the eligible oracle requires row, event, and outbox to appear as one bundle');
  ok(/stale[_ -]?picker/i.test(source)
    && /deactivat/i.test(source)
    && /reactivat/i.test(source)
    && /failed_closed/.test(source),
  'the stale-picker leg deactivates out of band, fails closed, and reactivates');
  const stalePicker = sourceFunction(source, 'runF94StalePicker');
  ok(/launchBrowser\(runtime, ['"]f94_stale_picker['"]\)/.test(stalePicker)
    && /openBoundedProduction\([\s\S]{0,160}page, port,[\s\S]{0,80}\/\?prod=1&view=list/.test(stalePicker)
    && /data-prod-assign-pop/.test(stalePicker)
    && /heldCandidate\.click\(\)/.test(stalePicker),
  'F94 stale-picker proof opens and commits through the real browser picker');
  const deactivateAt = stalePicker.indexOf('patchSyntheticMember(runtime, member, { active: false }');
  const commitAt = stalePicker.indexOf('heldCandidate.click()');
  ok(deactivateAt >= 0 && commitAt > deactivateAt
    && /matrixBlockSnapshot\(runtime, ['"]f94_stale_picker['"]\)/.test(stalePicker),
  'the browser holds its candidate before out-of-band deactivation and zero-mutation readback');

  // ---- F136: exact imported 13 x 13 policy, not a copied oracle ----------
  ok(policy.DELIVERABLE_STATUSES.length === 13,
    'the authoritative gateway policy exposes exactly 13 statuses');
  ok(source.includes('supabase/functions/production-write/policy.mjs')
    && /(?:await\s+)?import\(/.test(source),
  'the live matrix imports the gateway policy source directly');
  ok(!/(?:const|let|var)\s+CREATIVE_STATUS_TRANSITIONS\s*=/.test(source),
    'the drill does not copy the creative transition table');
  const expectedCreative = new Set();
  for (const current of policy.DELIVERABLE_STATUSES) {
    for (const next of runner.expectedCreativeAcceptedSet(policy, current, 'own')) {
      expectedCreative.add(`${current}->${next}`);
    }
  }
  const flattenedCreative = new Set();
  for (const [current, nextValues] of Object.entries(policy.CREATIVE_STATUS_TRANSITIONS)) {
    for (const next of nextValues) flattenedCreative.add(`${current}->${next}`);
  }
  ok(expectedCreative.size === flattenedCreative.size
    && [...flattenedCreative].every(value => expectedCreative.has(value)),
  'the expected creative acceptance set is derived exactly from CREATIVE_STATUS_TRANSITIONS');
  ok(policy.DELIVERABLE_STATUSES.every(current =>
    runner.expectedCreativeAcceptedSet(policy, current, 'peer').length === 0
      && runner.expectedCreativeAcceptedSet(policy, current, 'unassigned').length === 0),
  'the creative acceptance oracle remains empty for peer and unassigned rows');
  ok(runner.classifyMatrixAttempt(403, { error: 'operation_forbidden' }) === 'forbidden'
    && runner.classifyMatrixAttempt(409, {
      error: 'team_is_linear_authoritative',
    }) === 'authority_fenced'
    && runner.classifyMatrixAttempt(409, { error: 'write_conflict' }) === 'unexpected',
  'the deployed-policy oracle distinguishes denial, accepted authority fence, and unexpected CAS');
  ok(/for\s*\([^)]*(?:role|keyRole)/.test(source)
    && /for\s*\([^)]*current/.test(source)
    && /for\s*\([^)]*next/.test(source)
    && /operation_forbidden/.test(source),
  'the gateway drill drives role x current x next and expects every non-policy case to refuse');
  ok(/403/.test(source) && /zero_mutation_proofs_count/.test(source),
    'forbidden matrix cases require 403 before any mutation');
  const stale0 = runner.matrixSyntheticStamp(0);
  const stale1 = runner.matrixSyntheticStamp(1);
  ok(/const OWNERSHIP_STATES = Object\.freeze\(\[['"]own['"], ['"]peer['"], ['"]unassigned['"]\]\)/.test(source)
    && stale0 !== stale1
    && stale0.startsWith('2000-01-01T')
    && /matrixSyntheticStamp\(matrixBlockOrdinal\)/.test(source),
  'the matrix covers own/peer/unassigned rows with a unique stale browser CAS per block');
  const matrixRunner = sourceFunction(source, 'runF136Matrix');
  const matrixControl = sourceFunction(source, 'browserMatrixStatusControl');
  const browserProjection = sourceFunction(source, 'browserProjection');
  const browserRouter = sourceFunction(source, 'installBrowserRoutes');
  ok(occurrences(matrixRunner, 'openTestProductionPage(runtime, browser') === 2
    && /\/\?prod=1&view=list&issues=all&prodcache=0/.test(matrixRunner)
    && /\/\?prod=1&d=\$\{encodeURIComponent\(runtime\.fixture\.deliverableId\)\}/.test(matrixRunner),
  'F136 opens independent list and exact direct-link browser contexts');
  ok(/driveSurface\(['"]list['"], listCourier, listState, listStatusSelector\)/.test(matrixRunner)
    && /driveSurface\(['"]direct['"], directCourier, directState, directStatusSelector\)/.test(matrixRunner)
    && /attempts === expectedTuples \* 2/.test(matrixRunner)
    && /listAttempts === expectedTuples/.test(matrixRunner)
    && /directAttempts === expectedTuples/.test(matrixRunner)
    && /controlInteractions === attempts/.test(matrixRunner)
    && /controlDispatches === policyAccepted/.test(matrixRunner)
    && /controlBlocks === forbidden/.test(matrixRunner),
  'every F136 tuple exercises both independent real status-control surfaces');
  ok(Object.prototype.hasOwnProperty.call(sanitized.f136_matrix, 'list_attempts_count')
    && Object.prototype.hasOwnProperty.call(sanitized.f136_matrix, 'direct_attempts_count')
    && Object.prototype.hasOwnProperty.call(sanitized.f136_matrix, 'control_interactions_count')
    && Object.prototype.hasOwnProperty.call(sanitized.f136_matrix, 'control_dispatches_count')
    && Object.prototype.hasOwnProperty.call(sanitized.f136_matrix, 'control_blocks_count')
    && /list_attempts_count:\s*listAttempts/.test(matrixRunner)
    && /direct_attempts_count:\s*directAttempts/.test(matrixRunner),
  'the public aggregate exposes per-context and status-control matrix counts');
  ok(/creativeObservedList === creativeExpected/.test(matrixRunner)
    && /creativeObservedDirect === creativeExpected/.test(matrixRunner)
    && /assertMatrixBlockUnchanged\(before, after\)/.test(matrixRunner),
  'both routes independently match the creative policy set under one exact zero-mutation snapshot');
  const expectedTuples = 3 * policy.DELIVERABLE_STATUSES.length
    * policy.DELIVERABLE_STATUSES.length * 3;
  const expectedAcceptedPerContext =
    2 * policy.DELIVERABLE_STATUSES.length * policy.DELIVERABLE_STATUSES.length * 3
    + flattenedCreative.size;
  const expectedForbiddenPerContext = expectedTuples - expectedAcceptedPerContext;
  const expectedZeroProofs = 3 * 3 * policy.DELIVERABLE_STATUSES.length + 1;
  /*
   * Re-derived 2026-08-17 for the owner's creative-transition ruling. Only
   * `flattenedCreative` moved: the transition table went from 12 declared
   * current→next pairs to the full 13×13 = 169, so accepted rises by 157 per
   * context (2052 → 2366) and forbidden falls by the same (990 → 676). The
   * tuple count (3042) and zero-proof count (118) are functions of the status
   * vocabulary alone and are unchanged, which is the check that this ruling
   * widened permissions without touching the status set itself.
   */
  ok(expectedTuples * 2 === 3042
    && expectedAcceptedPerContext * 2 === 2366
    && expectedForbiddenPerContext * 2 === 676
    && flattenedCreative.size * 2 === 338
    && expectedZeroProofs === 118
    && /policyAccepted === expectedAcceptedPerContext \* 2/.test(matrixRunner)
    && /forbidden === expectedForbiddenPerContext \* 2/.test(matrixRunner)
    && /zeroProofs === expectedZeroProofs/.test(matrixRunner)
    && /cas_fenced_count:\s*2/.test(matrixRunner),
  'the exact dual-context totals are derived as 3042/2366/676/338/118 plus two UI CAS fences');
  ok(/\.prod-row\[data-prod-row=/.test(matrixRunner)
    && /\.prod-detail\[data-prod-detail=/.test(matrixRunner)
    && /#prodLayer \.prod-pop/.test(matrixControl)
    && /\[data-prod-pick\]/.test(matrixControl)
    && /control\.click\(\)/.test(matrixControl)
    && /target\.click\(\)/.test(matrixControl)
    && /matrix_forbidden_status_was_offered/.test(matrixControl)
    && !/\bfetch\(/.test(matrixControl),
  'F136 opens, inspects, blocks, and dispatches through the real list/detail status controls');
  ok(/routeState\.allowMatrix === true/.test(browserProjection)
    && /kind: ['"]video['"]/.test(browserProjection)
    && /matrixSyntheticStamp/.test(browserProjection)
    && /video: ['"]syncview['"]/.test(browserProjection),
  'the F136-only browser lens enables staff controls and supplies unique stale projection clocks');
  const matrixOraclePatchAt = matrixRunner.indexOf(
    'await setFixtureOracleState(runtime, current',
  );
  const matrixClockHandoffAt = matrixRunner.indexOf(
    'listState.matrixSyntheticStamp = syntheticStamp',
  );
  ok(/clearInterval\(_prodOperationalTimer\)/.test(matrixRunner)
    && /clearInterval\(_prodAuthorityTimer\)/.test(matrixRunner)
    && /matrix_background_refresh_did_not_settle/.test(matrixRunner)
    && matrixOraclePatchAt >= 0
    && matrixClockHandoffAt > matrixOraclePatchAt,
  'F136 freezes background ticks and advances its browser clock only after the TEST oracle patch');
  ok(/routeState\.allowMatrix === true/.test(browserRouter)
    && /!input\.test_override/.test(browserRouter)
    && /clean\(input\.id\) === runtime\.fixture\.deliverableId/.test(browserRouter)
    && /clean\(input\.client_slug\) === runtime\.client\.slug/.test(browserRouter)
    && /lower\(input\.status\) === expected\.next/.test(browserRouter)
    && /clean\(input\.expected_updated_at\) === expected\.syntheticStamp/.test(browserRouter)
    && /matrixCasWrites/.test(browserRouter)
    && /matrixRequestIds\.has\(browserRequestId\)/.test(browserRouter)
    && /routeState\.matrixWrites/.test(browserRouter),
  'the Node route admits only the exact expected UI status/CAS request for the active TEST fixture');

  // ---- Pre-existing roster safety + synthetic-only F37 identity shapes ----
  const completeRoster = sourceFunction(source, 'readCompleteRoster');
  const establishRoster = sourceFunction(source, 'establishReadOnlyRoster');
  const rosterInvariant = sourceFunction(source, 'assertPreExistingRosterUnchanged');
  const f37Runner = sourceFunction(source, 'runF37Identity');
  ok(/team_members\?select=\*&order=id\.asc&limit=\$\{pageSize\}/.test(completeRoster)
    && /id=gt\./.test(completeRoster)
    && /page < 100/.test(completeRoster)
    && /runtime\.readOnlyMemberIds\.add\(clean\(row\.id\)\)/.test(establishRoster)
    && /withoutRunRows/.test(rosterInvariant)
    && /runtime\.preExistingRoster/.test(rosterInvariant),
  'the safety baseline freezes the complete paginated roster without selecting real identities');
  const pagedRoster = Array.from({ length: 501 }, (_unused, index) => ({
    id: `member-${String(index + 1).padStart(4, '0')}`,
    name: `offline-${index + 1}`,
    role: index === 0 ? 'editor' : 'admin',
    active: true,
  }));
  let rosterFetches = 0;
  const rosterRuntime = {
    config: { supabaseUrl: 'https://offline.invalid', serviceKey: 'offline' },
    processDeadlineAt: Date.now() + (60 * 60_000),
    cleanupStarted: false,
    activeRequestControllers: new Set(),
    fetch: async urlValue => {
      rosterFetches++;
      const url = new URL(urlValue);
      const cursor = String(url.searchParams.get('id') || '').replace(/^gt\./, '');
      const start = cursor
        ? pagedRoster.findIndex(row => row.id === cursor) + 1
        : 0;
      const body = pagedRoster.slice(start, start + 500);
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  };
  const completeOfflineRoster = await runner.readCompleteRoster(rosterRuntime);
  ok(completeOfflineRoster.length === 501
    && completeOfflineRoster[500].id === 'member-0501'
    && rosterFetches === 2,
  'the roster keyset reader proves completeness beyond one 500-row page');
  let changedRosterRejected = false;
  try {
    await runner.assertPreExistingRosterUnchanged({
      preExistingRoster: [{ id: 'member-0001', name: 'Before', role: 'editor', active: true }],
      createdMemberIds: new Set(),
      config: { supabaseUrl: 'https://offline.invalid', serviceKey: 'offline' },
      processDeadlineAt: Date.now() + (60 * 60_000),
      cleanupStarted: true,
      activeRequestControllers: new Set(),
      fetch: async () => new Response(JSON.stringify([
        { id: 'member-0001', name: 'Changed', role: 'editor', active: true },
      ]), { status: 200, headers: { 'content-type': 'application/json' } }),
    }, 'cleanup');
  } catch (_error) {
    changedRosterRejected = true;
  }
  ok(changedRosterRejected,
    'cleanup rejects any changed field on a pre-existing roster row');
  ok(/runtime\.createdMemberIds\.has\(memberId\)/.test(browserRouter)
    && /!runtime\.readOnlyMemberIds\.has\(memberId\)/.test(browserRouter)
    && !/if \(readOnlyMember\)|readOnlyRosterById|localRosterVerifications/.test(browserRouter),
  'the F37 verifier route admits synthetic drill identities only');
  ok(/scope:\s*['"]synthetic_identity_shapes_only['"]/.test(f37Runner)
    && /real_sign_in_verification:\s*['"]supervised_owner_session_required['"]/.test(f37Runner)
    && /synthetic_identity_count:\s*activeCreatives\.length/.test(f37Runner)
    && !/preExistingRoster|readOnlyMember|rosterBefore|real creative/i.test(f37Runner),
  'F37 reports synthetic-shape scope and explicitly leaves real sign-ins to the owner');
  ok(sanitized.f37_identity.scope === 'synthetic_identity_shapes_only'
    && sanitized.f37_identity.real_sign_in_verification
      === 'supervised_owner_session_required'
    && Object.prototype.hasOwnProperty.call(
      sanitized.f37_identity, 'synthetic_identity_count')
    && !Object.prototype.hasOwnProperty.call(
      sanitized.f37_identity, 'active_creative_roster_count')
    && !Object.prototype.hasOwnProperty.call(
      sanitized.f37_identity, 'read_only_roster_checks_count'),
  'the public aggregate cannot be read as proving real-staff sign-ins');

  // ---- Every live request is aborted inside a reserved process budget ----
  const liveRequestSource = sourceFunction(source, 'liveRequest');
  const deadlineSource = sourceFunction(source, 'requestDeadlineMs');
  const directLiveAdapters = [
    'restRead',
    'restWrite',
    'edgeWrite',
    'gatewayWrite',
    'guardedBrowserVerifier',
    'linearRead',
    'guardedBrowserCommentRead',
  ];
  ok(occurrences(source, 'runtime.fetch(') === 1
    && /runtime\.fetch\(/.test(liveRequestSource)
    && directLiveAdapters.every(name => /liveRequest\(/.test(sourceFunction(source, name))),
  'every Node live request is centralized in the bounded request adapter');
  ok(/new AbortController\(\)/.test(liveRequestSource)
    && /setTimeout\([\s\S]*controller\.abort\(\)/.test(liveRequestSource)
    && /signal:\s*controller\.signal/.test(liveRequestSource)
    && /await response\.(?:arrayBuffer|text)\(/.test(liveRequestSource)
    && /clearTimeout\(timer\)/.test(liveRequestSource),
  'the Node abort remains armed through response-body consumption');
  ok(/const DRILL_PROCESS_BUDGET_MS = 170 \* 60_000;/.test(source)
    && /const CLEANUP_RESERVE_MS = 30 \* 60_000;/.test(source)
    && /processDeadline - CLEANUP_RESERVE_MS/.test(deadlineSource)
    && /jobStartedAtMs:\s*Number\(clean\(env\.SLICE5_JOB_STARTED_AT_MS\)\)/.test(source)
    && /processDeadlineAt:\s*startedAt \+ DRILL_PROCESS_BUDGET_MS/.test(source)
    && /runBoundedDrillPhase\(/.test(source)
    && /runtime\.cleanupStarted = true;[\s\S]{0,120}closeBrowsers\(runtime\)/.test(source),
  'the main phase cannot consume the separately reserved 30-minute cleanup window');
  ok(/pageEvaluate\(/.test(matrixControl)
    && /poll\(/.test(matrixControl)
    && /BROWSER_REQUEST_TIMEOUT_MS/.test(matrixControl)
    && /isLoopbackStatic/.test(browserRouter)
    && /route\.abort\(['"]blockedbyclient['"]\)/.test(browserRouter),
  'browser matrix controls remain bounded and unknown external requests are blocked');
  const fakeNow = 1_000_000;
  ok(runner.requestDeadlineMs({
    processDeadlineAt: fakeNow + (30 * 60_000) + 5_000,
    cleanupStarted: false,
  }, 20_000, fakeNow, 'f136_matrix') === 5_000,
  'a drill request is shortened at the edge of the cleanup reserve');
  ok(runner.requestDeadlineMs({
    processDeadlineAt: fakeNow + 5_000,
    cleanupStarted: true,
  }, 20_000, fakeNow, 'cleanup') === 5_000,
  'cleanup requests use only the remaining hard process budget');
  let reserveRejected = false;
  try {
    runner.requestDeadlineMs({
      processDeadlineAt: fakeNow + (30 * 60_000),
      cleanupStarted: false,
    }, 20_000, fakeNow, 'f136_matrix');
  } catch (_error) {
    reserveRejected = true;
  }
  ok(reserveRejected, 'the next drill request is refused once cleanup reserve begins');
  let latePhaseRejected = false;
  try {
    runner.requestDeadlineMs({
      processDeadlineAt: fakeNow + 60_000,
      cleanupStarted: true,
    }, 20_000, fakeNow, 'f95_convergence');
  } catch (_error) {
    latePhaseRejected = true;
  }
  ok(latePhaseRejected,
    'a late browser/route request is refused after cleanup has begun');
  let abortObserved = false;
  const abortStarted = Date.now();
  try {
    await runner.liveRequest({
      processDeadlineAt: Date.now() + (31 * 60_000),
      cleanupStarted: false,
      activeRequestControllers: new Set(),
      fetch: (_url, init) => new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => {
          abortObserved = true;
          reject(new Error('offline bounded abort'));
        }, { once: true });
      }),
    }, 'https://offline.invalid/read', {}, {
      stage: 'preflight',
      kind: 'offline_test',
      timeoutMs: 15,
    });
  } catch (_error) {}
  ok(abortObserved && Date.now() - abortStarted < 1_000,
    'the centralized adapter actively aborts a hung fetch within its bound');
  const boundedStarted = Date.now();
  let operationBounded = false;
  try {
    await runner.boundedOperation({
      processDeadlineAt: Date.now() + (31 * 60_000),
      cleanupStarted: false,
    }, 'f95_convergence', 'offline hung browser operation',
    () => new Promise(() => {}), 15);
  } catch (_error) {
    operationBounded = true;
  }
  ok(operationBounded && Date.now() - boundedStarted < 1_000,
    'a hung browser operation yields control before the cleanup reserve');
  let lateRegistered = false;
  let lateDisposed = false;
  let acquisitionTimedOut = false;
  try {
    await runner.acquireBoundedResource({
      processDeadlineAt: Date.now() + (31 * 60_000),
      cleanupStarted: false,
    }, 'f95_convergence', 'offline late resource',
    () => new Promise(resolve => setTimeout(() => resolve({ handle: true }), 35)),
    () => { lateRegistered = true; },
    () => { lateDisposed = true; },
    15);
  } catch (_error) {
    acquisitionTimedOut = true;
  }
  await new Promise(resolve => setTimeout(resolve, 60));
  ok(acquisitionTimedOut && lateDisposed && !lateRegistered,
    'a resource resolving after acquisition timeout is disposed instead of registered late');
  const launchSource = sourceFunction(source, 'launchBrowser');
  const contextCloseSource = sourceFunction(source, 'closeContext');
  const staticStartSource = sourceFunction(source, 'startStaticServer');
  const staticCloseSource = sourceFunction(source, 'closeStaticServer');
  const centralCloseSource = sourceFunction(source, 'closeBrowsers');
  ok(/launchServer\(/.test(launchSource)
    && /browserServers\.add/.test(launchSource)
    && /forceKillBrowserServer/.test(launchSource)
    && /created\.unref\(\)/.test(staticStartSource)
    && /neutralizeStaticServer/.test(staticCloseSource)
    && !/finally[\s\S]*contexts\.delete/.test(contextCloseSource)
    && /Chromium server force kill/.test(centralCloseSource)
    && /late browser operation drain/.test(centralCloseSource),
  'teardown retains failed contexts and force-neutralizes server/process handles');

  // ---- F37/F95: real browser machinery and bounded recovery --------------
  ok(/require\(['"]playwright['"]\)/.test(source)
    && /\bchromium\b/.test(source),
  'F37/F95 use the established Playwright runtime');
  ok(source.includes('docs/syncview-design/tests/prod-test-utils')
    || source.includes('qa/'),
  'the browser drills reuse the existing Production/QA e2e machinery');
  const f95Runner = sourceFunction(source, 'runF95Convergence');
  ok(occurrences(f95Runner, 'openTestProductionPage(runtime, browser') === 2
    && /const \{ context: contextA, page: pageA \}/.test(f95Runner)
    && /const \{ context: contextB, page: pageB \}/.test(f95Runner),
  'F95 creates two independent headless browser contexts');
  ok(source.includes('?prod=1'), 'both browser contexts enter through the Production route');
  const rowConvergence = sourceFunction(source, 'assertContextsConverge');
  const commentConvergence = sourceFunction(source, 'assertContextsObserveComment');
  ok(/const MATRIX_TICK_MS = 30_000;/.test(source)
    && !/MATRIX_TICK_MARGIN/.test(source)
    && [rowConvergence, commentConvergence].every(body =>
      /Date\.now\(\) - started <= MATRIX_TICK_MS/.test(body)
        && /elapsed <= MATRIX_TICK_MS/.test(body)),
  'row and comment convergence are both hard-capped at one 30-second tick');
  ok(source.includes('[data-prod-freshness="degraded"]')
    && source.includes('[data-prod-refresh="1"]'),
  'the forced failure asserts degraded state and recovers through Retry');
  ok(/signed[_ -]?out/i.test(source)
    && /deactivat/i.test(source)
    && /zero[_ -]?row/i.test(source)
    && /duplicate[_ -]?name/i.test(source)
    && /reorder/i.test(source)
    && /account[_ -]?switch/i.test(source),
  'F37 covers signed-out, deactivated, zero-row, duplicate-name, reorder, and account-switch shapes');
  ok(/scroll_preserved/.test(source)
    && /composer_preserved/.test(source)
    && /draft_preserved/.test(source),
  'F95 proves preserved scroll, composer, and draft state');

  // ---- Read-path rebaseline: private delta only, never burst -------------
  const readRebaseline = sourceFunction(source, 'runReadRebaseline');
  ok(/qa\/probes\/prod_read_path_timing\.js/.test(readRebaseline)
    && /spawnSync\(process\.execPath,\s*\[probe,\s*['"]delta['"]\]/.test(readRebaseline),
  'the sixth drill invokes the established read-only probe in delta mode');
  ok(!/['"](?:burst|all)['"]/.test(readRebaseline),
    'the rebaseline cannot invoke the load-generating burst or all modes');
  ok(/FAILED\|ABORTED/.test(readRebaseline)
    && /result\.status\s*===\s*0/.test(readRebaseline),
  'textual FAILED/ABORTED markers fail the drill even when the probe exits zero');
  // The wall_med pattern itself now lives in parseWallMedians, which is tested
  // directly against the probe's real padded output further down.
  ok(/parseWallMedians\(raw\)/.test(readRebaseline)
    && /value\s*<=\s*MATRIX_TICK_MS/.test(readRebaseline),
  'the private delta evidence must contain bounded wall medians');
  ok(/wall_med=\\s\*/.test(sourceFunction(source, 'parseWallMedians')),
    'the parser tolerates the padStart whitespace the probe actually emits');
  ok(!/\.\.\.process\.env/.test(readRebaseline)
    && !/SUPABASE_SERVICE_ROLE_KEY|LINEAR_API_KEY|ROLE_KEY_(?:ADMIN|SMM|CREATIVE)/.test(readRebaseline),
  'the read-only child receives no service, provider, or role credential');
  ok(/return\s*\{\s*result:\s*['"]pass['"],\s*mode_count:\s*1,\s*passed:\s*true\s*\}/.test(readRebaseline)
    && /read_rebaseline:\s*\{\s*result:\s*['"]not_run['"],\s*mode_count:\s*0,\s*passed:\s*false\s*\}/.test(source),
  'read-path output is reduced to one enum, one count, and one boolean');

  // ---- Cleanup + invariant proof -----------------------------------------
  ok(/\bfinally\s*\{/.test(source)
    && /cleanup_ok/.test(source)
    && /created_member_count/.test(source)
    && /deleted_member_count/.test(source),
  'cleanup is finally-owned and publicly reports exact aggregate completion');
  ok(source.includes('syncview_runtime_flags')
    && /flagsBefore/.test(source)
    && /flagsAfter/.test(source)
    && /stableJson\(flagsBefore\)\s*===\s*stableJson\(flagsAfter\)/.test(source)
    && /flags_unchanged/.test(source),
  'runtime flags are independently read before/after and must remain byte-stable');
  ok(!/syncview_runtime_flags[\s\S]{0,300}(?:method:\s*['"](?:POST|PATCH|PUT|DELETE)['"])/i.test(source),
    'the runner contains no runtime-flag write path');
  const cleanupRunner = sourceFunction(source, 'cleanup');
  const memberCleanup = sourceFunction(source, 'cleanupSyntheticMembers');
  const providerIssue = sourceFunction(source, 'providerIssueIdFor');
  const mainRunner = sourceFunction(source, 'main');
  const restWriteSource = sourceFunction(source, 'restWrite');
  const openRunLedger = sourceFunction(source, 'openDurableRunLedger');
  const clearRunLedger = sourceFunction(source, 'clearDurableRunLedger');
  const linearOwnershipRuntime = {
    runToken: 'slice5-offline-owned',
    linear: {
      // The cleanup ownership guard now compares against the project the
      // gateway actually used, established by the fixture readback, not the id
      // the drill offered on its create intent.
      verifiedProjectId: 'offline-test-project',
      team: { id: 'offline-test-team' },
    },
  };
  const ownedLinearIssue = {
    id: 'offline-minted-issue',
    title: 'Slice 5 drill slice5-offline-owned Deliverable',
    description: 'Slice 5 drill slice5-offline-owned Disposable TEST deliverable',
    project: { id: 'offline-test-project' },
    team: { id: 'offline-test-team' },
  };
  ok(runner.assertRunOwnedLinearIssueSnapshot(
    linearOwnershipRuntime,
    ownedLinearIssue,
    ownedLinearIssue.id,
    'deliverable',
  ) === ownedLinearIssue,
  'cleanup accepts an exact run-marker, issue-id, TEST-project, and TEST-team ownership proof');
  let foreignLinearIssueRejected = false;
  try {
    runner.assertRunOwnedLinearIssueSnapshot(
      linearOwnershipRuntime,
      { ...ownedLinearIssue, title: 'Pre-existing issue' },
      ownedLinearIssue.id,
      'deliverable',
    );
  } catch (_error) {
    foreignLinearIssueRejected = true;
  }
  ok(foreignLinearIssueRejected,
    'TEST project/team scope alone cannot authorize archiving a pre-existing Linear issue');

  // Cleanup must still recognise its own issues when the readback FAILED --
  // both fixture issues already exist by then, so a guard that insists on a
  // still-empty verifiedProjectId would fail every ownership check and strand
  // live TEST issues in Linear. Exercised directly, not pattern-matched.
  const unverifiedRuntime = {
    runToken: 'slice5-offline-owned',
    linear: {
      verifiedProjectId: '',
      intakeProjectId: 'offline-test-project',
      team: { id: 'offline-test-team' },
    },
  };
  ok(runner.assertRunOwnedLinearIssueSnapshot(
    unverifiedRuntime, ownedLinearIssue, ownedLinearIssue.id, 'deliverable',
  ) === ownedLinearIssue,
  'cleanup still identifies its own issue when the intake-project readback failed');
  let unownedWhenUnverifiedRejected = false;
  try {
    runner.assertRunOwnedLinearIssueSnapshot(
      unverifiedRuntime,
      { ...ownedLinearIssue, project: { id: 'someone-elses-project' } },
      ownedLinearIssue.id,
      'deliverable',
    );
  } catch (_error) {
    unownedWhenUnverifiedRejected = true;
  }
  ok(unownedWhenUnverifiedRejected,
    'the unverified fallback still refuses an issue in a project this run never offered');
  ok(/lower\(create\.status\) === ['"]written['"]/.test(providerIssue)
    && /clean\(create\.dedup_key\) === clean\(expected\.dedup\)/.test(providerIssue)
    && /clean\(result\.mutation\) === ['"]issueCreate['"]/.test(providerIssue)
    && /idempotency_conflict/.test(providerIssue)
    && providerIssue.indexOf('await linearIssueSnapshot(')
      < providerIssue.indexOf('return clean(expected.issueId)'),
  'the create receipt and live marker ownership are proved before an issue id reaches archive');
  ok((cleanupRunner.match(
    /const issueId = await providerIssueIdFor\([\s\S]{0,500}?await ledgerWrite\(/g,
  ) || []).length === 2,
  'both deliverable and batch archive intents are submitted only after provider ownership proof');

  const ledgerRuntime = {
    runToken: 'slice5-offline-ledger',
    client: { slug: 'offline-test-client' },
    identityPlan: {
      members: [{ id: 'member-b' }, { id: 'member-a' }],
      fixture: {
        batchId: 'batch-a',
        deliverableId: 'deliverable-a',
        batchIssueId: 'issue-b',
        deliverableIssueId: 'issue-a',
      },
    },
  };
  const ledgerPayload = runner.runLedgerPayload(ledgerRuntime);
  ok(runner.stableJson(ledgerPayload) === runner.stableJson({
    protocol: 'slice5_test_drill_run_v1',
    marker: 'drill',
    run_token: 'slice5-offline-ledger',
    member_ids: ['member-a', 'member-b'],
    batch_ids: ['batch-a'],
    deliverable_ids: ['deliverable-a'],
    linear_issue_ids: ['issue-a', 'issue-b'],
    dedup_prefix: 'slice5-offline-ledger:',
  }),
  'the durable ledger records every reserved cleanup identity before any create');
  const ledgerRow = {
    id: 7,
    surface: 'slice5_test_drills',
    client_slug: 'offline-test-client',
    actor: 'slice5-offline-ledger',
    role: 'system',
    action: 'run_open',
    source: 'slice5_test_drill',
    payload: ledgerPayload,
  };
  ok(runner.assertRunLedgerRow(ledgerRuntime, ledgerRow, 'cleanup') === ledgerRow,
    'only the exact active-TEST run ledger row is accepted for cleanup clearing');
  let foreignLedgerRejected = false;
  try {
    runner.assertRunLedgerRow(
      ledgerRuntime,
      { ...ledgerRow, client_slug: 'real-client' },
      'cleanup',
    );
  } catch (_error) {
    foreignLedgerRejected = true;
  }
  ok(foreignLedgerRejected,
    'a ledger row for another client cannot be cleared by this run');
  const reserveAt = mainRunner.indexOf('reserveRunIdentities(runtime)');
  const ledgerOpenAt = mainRunner.indexOf('openDurableRunLedger(runtime)');
  const memberCreateAt = mainRunner.indexOf('createSyntheticMembers(');
  const fixtureCreateAt = mainRunner.indexOf('createFixture(');
  ok(reserveAt >= 0
    && ledgerOpenAt > reserveAt
    && memberCreateAt > ledgerOpenAt
    && fixtureCreateAt > ledgerOpenAt
    && /settings_events/.test(openRunLedger),
  'the durable ledger is persisted after identity reservation and before the first create');
  const ambiguousSettleAt = memberCleanup.indexOf('AMBIGUOUS_WRITE_SETTLE_MS');
  const memberRecoveryAt = memberCleanup.indexOf('for (const id of memberIds)');
  ok(/options\.memberInsert === true/.test(restWriteSource)
    && /runtime\.ambiguousMemberIds\.add\(id\)/.test(restWriteSource)
    && ambiguousSettleAt >= 0
    && memberRecoveryAt > ambiguousSettleAt
    && /survivors\.length === 0/.test(memberCleanup),
  'an aborted member create stays unresolved until a settle window and final absence proof');
  ok(/const cleanupProven = errors\.length === 0/.test(cleanupRunner)
    && cleanupRunner.indexOf('if (cleanupProven && runtime.runLedger)')
      < cleanupRunner.indexOf('clearDurableRunLedger(runtime)')
    && /durable run ledger clear was not proven/.test(clearRunLedger)
    && /runLedgerCleared/.test(cleanupRunner),
  'cleanup_ok cannot become true or clear discoverability before every cleanup proof completes');
  ok(/deliverable_events/.test(cleanupRunner)
    && /mirror_outbox/.test(cleanupRunner)
    && /cleanupSyntheticMembers\(runtime, deliverableIds\)/.test(cleanupRunner)
    && /for \(const id of memberIds\)/.test(memberCleanup)
    && /catch \(error\)[\s\S]{0,80}capture\(error\)/.test(memberCleanup)
    && /survivors\.length === 0/.test(memberCleanup),
  'cleanup independently attempts row/event/outbox recovery and every disposable member');
  ok(/assertPreExistingRosterUnchanged\(runtime, ['"]cleanup['"]\)/.test(cleanupRunner)
    && /errors\.length === 0/.test(cleanupRunner)
    && /cleanupResult\.ok/.test(source),
  'cleanup_ok requires complete recovery plus a byte-stable pre-existing roster');

  if (failures) {
    console.error(`\nslice5-test-drills: ${failures} check(s) failed`);
    process.exit(1);
  }
  console.log('\nslice5-test-drills: owner-gated safety and evidence contract passed');
})().catch(error => {
  // This is an offline source-contract failure; no live/private payload exists.
  console.error(error);
  process.exit(1);
});
