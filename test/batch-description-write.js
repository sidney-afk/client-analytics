'use strict';
/*
 * A post's own description becomes editable.
 *
 * Owner, 2026-08-31, on a batch parent opened from a shared link: "I need to be
 * able to edit the description and it says that the post batch parent cannot
 * ... any parent issue should be able to ... the description should be
 * editable". Asked what shape: "I want it like linear, so there's a description
 * for the parent issue, and then there is the description for all of the
 * sub-issues."
 *
 * The model was ALREADY that — a sub-issue has its own `deliverables.brief`,
 * the parent shows `batches.description`, and neither is shared into the other.
 * The write was the missing half: the gateway refused every batch-entity
 * mutation except `comment`, so a post description set at intake was permanent
 * from every seat.
 *
 * This file pins the two failures that cost the most time on 2026-08-31, both
 * of which this path could have repeated verbatim:
 *
 *   1. THE MISSING client_slug. batch_write is INSERT ... ON CONFLICT (id) DO
 *      UPDATE, and PostgreSQL evaluates NOT NULL on the PROPOSED INSERT TUPLE
 *      before resolving the conflict — so a partial row without client_slug
 *      raises 23502 on a row that already exists. That made every batch folder
 *      link unsaveable for the whole estate.
 *   2. THE `outbound` KEY. Its presence IS the enqueue signal for
 *      track_b_enqueue_outbound_intent. A batch write has no Linear mirror, so
 *      requesting one dies in the F27 fence as f27_authority_generation_stale
 *      and surfaces as 500 write_failed — a `wait`-class code telling people to
 *      retry something that will never succeed.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SQL = fs.readFileSync(path.join(ROOT, 'migrations', '2026-09-01-batch-description-write.sql'), 'utf8');
const GATEWAY = fs.readFileSync(path.join(ROOT, 'supabase', 'functions', 'production-write', 'index.ts'), 'utf8');
const INDEX = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

/* Structural checks read CODE. The header above names `outbound` and
   `client_slug` in prose, and the migration explains itself at length — the
   first draft of a guard like this reported failures against its own
   documentation. Comments are stripped first, in both languages. */
function stripSql(src) {
  return src.split('\n').map(line => line.replace(/--.*$/, '')).join('\n');
}
function stripJs(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n').map(line => line.replace(/\/\/.*$/, '')).join('\n');
}
function grabFunc(src, signature) {
  const start = src.indexOf(signature);
  if (start < 0) throw new Error('not found: ' + signature);
  let depth = 0, quote = '', comment = '', escaped = false;
  for (let i = src.indexOf('{', start); i < src.length; i++) {
    const c = src[i], n = src[i + 1];
    if (comment === 'line') { if (c === '\n') comment = ''; continue; }
    if (comment === 'block') { if (c === '*' && n === '/') { comment = ''; i++; } continue; }
    if (quote) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === quote) quote = '';
      continue;
    }
    if (c === '/' && n === '/') { comment = 'line'; i++; continue; }
    if (c === '/' && n === '*') { comment = 'block'; i++; continue; }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
    if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return src.slice(start, i + 1);
  }
  throw new Error('unclosed: ' + signature);
}

const sql = stripSql(SQL);

/* ---- 1. The migration writes ONE column, and carries the key that lets it -- */

ok(/create or replace function public\.production_batch_description_write\(/.test(sql),
  'the RPC exists under its own name rather than widening the asset writer with a mode flag');

const vRow = /v_row := ([\s\S]*?);/.exec(sql);
ok(!!vRow, 'the row handed to batch_write was located');
const rowKeys = (vRow ? vRow[1] : '').match(/'([a-z_]+)',/g) || [];
ok(rowKeys.length === 3
  && /'id',/.test(vRow[1]) && /'client_slug',/.test(vRow[1]) && /'description',/.test(vRow[1]),
  'EXACTLY three keys reach batch_write: id, client_slug, description — every other column is left alone by the per-key ON CONFLICT arms');
ok(/'client_slug', v_current\.client_slug/.test(vRow[1]),
  'THE 23502 LESSON: client_slug is present, because NOT NULL is evaluated on the proposed INSERT tuple before the conflict resolves — its absence made every batch folder link unsaveable');
['footage_folder_url', 'delivery_folder_url', 'filming_doc_url', 'name', 'purpose'].forEach(col => {
  ok(!new RegExp("'" + col + "'").test(vRow[1]),
    'and it cannot reach ' + col + ' — the whitelist lives in the database, not only in the gateway that calls it today');
});

/* ---- 2. Scope, lock, authority ----------------------------------------- */

ok(/where b\.id = p_batch_id\s*\n?\s*and b\.client_slug = p_client_slug/.test(sql),
  'scope and existence resolve together, so a mismatched client slug cannot be used to discover which batch ids exist');
ok(/for update;/.test(sql),
  'the batch row is locked for the write');
ok(/from public\.deliverables d\s*\n?\s*where d\.batch_id = v_current\.id/.test(sql),
  'the team is derived from the batch AND its deliverables — batches.team is null on hundreds of rows, and authorizing on it alone is what made the asset slots unwritable');
ok(/foreach v_team in array v_teams loop\s*\n?\s*perform public\.production_assert_authority\(/.test(sql),
  'authority is asserted for EVERY team the post serves, so a mixed batch cannot be edited while half of it is Linear-authoritative');
ok(/revoke all on function public\.production_batch_description_write[\s\S]*?from public, anon, authenticated/.test(sql)
  && /grant execute on function public\.production_batch_description_write[\s\S]*?to service_role/.test(sql),
  'service_role only — never anon or authenticated');

/* ---- 3. The gateway asks for no mirror it cannot have ------------------- */

const handler = stripJs(grabFunc(GATEWAY, 'async function handleBatchDescriptionWrite('));
ok(!/outbound/.test(handler),
  'THE F27 LESSON: the event carries NO `outbound` key — that key IS the enqueue signal, and a batch write has no Linear leg to mirror');
ok(/eventFor\("batch_description", principal, sourceEditedAt, surface, null\)/.test(handler),
  'and it passes null for the outbound argument explicitly, rather than relying on omission');
ok(/rpc\(supabase, "production_batch_description_write"/.test(handler),
  'it calls the new RPC');
ok(/expected_updated_at[\s\S]{0,260}write_conflict/.test(handler),
  'the gateway pre-checks the batch clock as a fast refusal');
ok(/p_expected_updated_at: body\.expected_updated_at === undefined/.test(handler),
  'and PASSES the expectation through to the RPC — the pre-check alone is a TOCTOU, because two saves that start together both read the row unlocked and both pass it');
ok(/if p_expected_updated_at is not null[\s\S]{0,200}for update/.test(sql) === false,
  'and the SQL re-check happens AFTER the row lock, not before it');
const lockAt = sql.indexOf('for update;');
const casAt = sql.indexOf('p_expected_updated_at is not null');
ok(lockAt > -1 && casAt > lockAt,
  'the CAS is serialised against a concurrent writer by the lock it sits under — the only place the comparison is safe');
ok(/raise exception 'production batch description write conflict'/.test(sql),
  'and a loser is refused rather than silently overwriting the winner');

ok(/v_description text := nullif\(p_description, ''\);/.test(sql),
  'ONLY the exact empty string becomes NULL — btrim would rewrite validated Markdown after the fact, destroying a fenced code block\'s indentation and the trailing spaces that are a hard line break');
ok(!/btrim\(coalesce\(p_description/.test(sql),
  'so the description is never trimmed on its way to the column');
ok(/staffOperationAllowed\(principal\.keyRole, "batch_description", principal\.memberTeam, scopeTeam\)/.test(handler),
  'every team the post serves is authorized, matching the SQL half — the two must agree or the gateway lies about what will happen');
ok(/principal\.kind === "client"[\s\S]{0,80}operation_forbidden/.test(handler),
  'a client link can never write a post description');
ok(/canonicalDescription\(descriptionValue\)/.test(handler),
  'the description is validated by the same helper the deliverable path uses — one length and NUL rule, not two');

const gatewayFlat = stripJs(GATEWAY);
ok(/if \(operation === "batch_description"\) \{\s*return await handleBatchDescriptionWrite\(/.test(gatewayFlat),
  'dispatched as its own top-level operation, BEFORE the deliverable machinery — so it cannot accidentally acquire the outbox and fingerprint path a post description has no use for');

/* ---- 4. The browser opens exactly one control on a batch parent --------- */

const canWrite = stripJs(grabFunc(INDEX, 'function _prodCanWrite('));
ok(/syntheticBatchParent === true && operation !== 'description'/.test(canWrite),
  'a batch parent is writable for description and for NOTHING else — status, due, assignee and labels stay gated because there is no deliverable row to write');

const gateText = stripJs(grabFunc(INDEX, 'function _prodWriteGateText('));
ok(/syntheticBatchParent === true && operation !== 'description'/.test(gateText),
  'and the refusal sentence stops telling people to open a sub-issue for the one thing they can now do right here');

const roleCanWrite = stripJs(grabFunc(INDEX, 'function _prodRoleCanWrite('));
ok(/operation === 'batch_asset' \|\| operation === 'batch_description'/.test(roleCanWrite),
  'the role rule treats a post description as post-level, like its folder links — a two-team post must not hand its description to one side');

const save = stripJs(grabFunc(INDEX, 'async function _prodSaveDescription('));
ok(/batchParent \? 'batch_description' : 'description'/.test(save),
  'the save routes a batch parent to the batch operation and a deliverable to the ordinary one');
ok(/batchParent \? json\.description : committedRow\.brief/.test(save),
  'and reads the committed text from the TOP-LEVEL description field — publicRow has no description, so reading it off the row returned undefined on every successful save and wrote an empty string back over the text just typed');
ok(/error\.batch && typeof error\.batchDescription === 'string'/.test(save),
  'a write_conflict adopts the winning BATCH and its text — a batch answer carries neither on `row`, so the loser used to keep its own stale text and stale clock and conflict again forever');
ok(/state\.sourceUpdatedAt = serverRow\.updated_at/.test(save),
  'including the winner\'s clock, which is what stops the retry loop');

const gatewayWrite = stripJs(grabFunc(INDEX, 'async function _prodGatewayWrite('));
ok(/error\.batch = json && json\.batch \|\| null/.test(gatewayWrite)
  && /error\.batchDescription = json && typeof json\.description === 'string'/.test(gatewayWrite),
  'and the gateway error carries them, which it did not before — only `row` was ever attached');

const policy = fs.readFileSync(path.join(ROOT, 'supabase', 'functions', 'production-write', 'policy.mjs'), 'utf8');
ok(/if \(op === "batch_description"\) return false;/.test(stripJs(policy)),
  'a CREATIVE cannot write a post description — descriptions are admin/SMM everywhere in the estate, and widening a new write past the one it sits beside is an owner ruling, not a side effect');

const syncBatch = stripJs(grabFunc(INDEX, 'function _prodSyncBatchDescriptionRow('));
ok(/issue && issue\.batchId/.test(syncBatch),
  'the optimistic write-back resolves the real batch id from the issue, not the node id — a two-team batch mints a suffixed parent per team and only one of those strings is a batch id');
ok(/_prodState\.adapter = null/.test(syncBatch),
  'and drops the adapter so the parent re-derives its description from the batch it just wrote');

/* ---- 5. Executed: which operations a batch parent may write ------------- */

const canWriteFn = new Function('issue', 'operation', `
  ${grabFunc(INDEX, 'function _prodCanWrite(')}
  return _prodCanWrite(issue, operation);
`);
const parent = { id: 'bat_1', syntheticBatchParent: true, team: 'video' };
['status', 'due', 'assignee', 'labels', 'attachment', 'comment'].forEach(op => {
  ok(canWriteFn(parent, op) === false,
    'a batch parent still refuses ' + op + ' — there is no deliverable row behind it');
});
// `description` is the one that must NOT short-circuit here. It falls through to
// the ordinary identity/attribution/authority checks, which throw in this bare
// harness precisely because they are reached — that IS the assertion.
let reachedOrdinaryChecks = false;
try { canWriteFn(parent, 'description'); } catch (e) { reachedOrdinaryChecks = true; }
ok(reachedOrdinaryChecks,
  'while description falls THROUGH to the ordinary attribution and authority checks rather than being refused at the door');

console.log(failures === 0
  ? '\nbatch description write checks passed'
  : '\n' + failures + ' batch description write check(s) failed');
process.exit(failures === 0 ? 0 : 1);
