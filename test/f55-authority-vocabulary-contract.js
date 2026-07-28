'use strict';

/*
 * F55 all-consumer contract test: every browser, edge function, reconciler,
 * n8n guard, and pending F27 SQL path that interprets `prod_authority` must
 * accept exactly `linear`/`syncview` and reject missing/malformed/legacy
 * values (including the retired backend-only `supabase` alias) the same way.
 *
 * This never touches a live database, Deno runtime, or n8n instance — it
 * extracts and exercises the real parsing/validation logic from each source
 * file (executing plain JS/.mjs directly; regex-asserting TS/SQL bodies that
 * this Node-only hermetic suite cannot execute, matching this repo's existing
 * test convention for those file types).
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '..');
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

// ---------------------------------------------------------------------------
// Shared extraction helpers (same brace/quote/comment-aware scan used across
// the rest of this suite for pulling one function's source out of a bigger
// file without a build step).
// ---------------------------------------------------------------------------

function extractFunction(source, name) {
  const marker = 'function ' + name + '(';
  let start = source.indexOf(marker);
  assert(start >= 0, 'missing function ' + name);
  if (source.slice(start - 6, start) === 'async ') start -= 6;
  const brace = source.indexOf('{', start);
  let depth = 0, quote = '', escaped = false, lineComment = false, blockComment = false;
  for (let index = brace; index < source.length; index++) {
    const ch = source[index], next = source[index + 1];
    if (lineComment) { if (ch === '\n') lineComment = false; continue; }
    if (blockComment) { if (ch === '*' && next === '/') { blockComment = false; index++; } continue; }
    if (quote) { if (escaped) escaped = false; else if (ch === '\\') escaped = true; else if (ch === quote) quote = ''; continue; }
    if (ch === '/' && next === '/') { lineComment = true; index++; continue; }
    if (ch === '/' && next === '*') { blockComment = true; index++; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return source.slice(start, index + 1);
  }
  throw new Error('unclosed function ' + name);
}

function extractConst(source, name) {
  const marker = 'const ' + name + ' = ';
  const start = source.indexOf(marker);
  assert(start >= 0, 'missing const ' + name);
  const brace = source.indexOf('{', start);
  let depth = 0, quote = '', escaped = false;
  for (let index = brace; index < source.length; index++) {
    const ch = source[index];
    if (quote) { if (escaped) escaped = false; else if (ch === '\\') escaped = true; else if (ch === quote) quote = ''; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return source.slice(start, index + 1) + ';';
  }
  throw new Error('unclosed const ' + name);
}

function extractSqlFunction(source, name) {
  const marker = `create or replace function public.${name}(`;
  const start = source.indexOf(marker);
  assert(start >= 0, 'missing sql function ' + name);
  const bodyStart = source.indexOf('$fn$', start);
  assert(bodyStart >= 0, 'missing $fn$ body for ' + name);
  const bodyEnd = source.indexOf('$fn$;', bodyStart + 4);
  assert(bodyEnd >= 0, 'unclosed sql function ' + name);
  return source.slice(start, bodyEnd + '$fn$;'.length);
}

function runInFreshContext(code, exposedName) {
  const context = {};
  vm.createContext(context);
  vm.runInContext(code + `\nglobalThis.__export = ${exposedName};`, context);
  return context.__export;
}

function safeCall(fn, ...args) {
  try { return fn(...args); } catch (e) { return { __threw: true, message: e.message }; }
}

function isRejected(result) {
  if (result && typeof result === 'object' && result.__threw) return true;
  return result === null || result === undefined || result === false || result === '';
}

// ---------------------------------------------------------------------------
// Contract 1: full {video, graphics} object validators. Every consumer here
// must accept only `linear`/`syncview` per side and reject the legacy
// `supabase` alias, unknown values, missing keys, and non-object shapes.
// ---------------------------------------------------------------------------

function checkObjectValidator(parse, label) {
  const bothLinear = safeCall(parse, { video: 'linear', graphics: 'linear' });
  ok(bothLinear && bothLinear.video === 'linear' && bothLinear.graphics === 'linear',
    label + ': accepts {video:linear, graphics:linear}');

  const bothSyncview = safeCall(parse, { video: 'syncview', graphics: 'syncview' });
  ok(bothSyncview && bothSyncview.video === 'syncview' && bothSyncview.graphics === 'syncview',
    label + ': accepts {video:syncview, graphics:syncview}');

  const mixed = safeCall(parse, { video: 'linear', graphics: 'syncview' });
  ok(mixed && mixed.video === 'linear' && mixed.graphics === 'syncview',
    label + ': accepts a mixed linear/syncview split');

  ok(isRejected(safeCall(parse, { video: 'supabase', graphics: 'linear' })),
    label + ': rejects legacy supabase alias on video');
  ok(isRejected(safeCall(parse, { video: 'linear', graphics: 'supabase' })),
    label + ': rejects legacy supabase alias on graphics');
  ok(isRejected(safeCall(parse, { video: 'sheets', graphics: 'linear' })),
    label + ': rejects an unrecognized value');
  ok(isRejected(safeCall(parse, { video: 'linear' })),
    label + ': rejects a missing team key');
  ok(isRejected(safeCall(parse, {})),
    label + ': rejects an empty object');
  ok(isRejected(safeCall(parse, null)),
    label + ': rejects null');
  ok(isRejected(safeCall(parse, 'linear')),
    label + ': rejects a bare string instead of an object');
  ok(isRejected(safeCall(parse, ['linear', 'syncview'])),
    label + ': rejects an array');
}

// ---------------------------------------------------------------------------
// Contract 2: single-side string validators (one team's value at a time).
// ---------------------------------------------------------------------------

function checkSideValidator(parse, label) {
  ok(safeCall(parse, 'linear') === 'linear', label + ': accepts linear');
  ok(safeCall(parse, 'syncview') === 'syncview', label + ': accepts syncview');
  ok(isRejected(safeCall(parse, 'supabase')), label + ': rejects legacy supabase alias');
  ok(isRejected(safeCall(parse, 'sheets')), label + ': rejects an unrecognized value');
  ok(isRejected(safeCall(parse, '')), label + ': rejects an empty value');
  ok(isRejected(safeCall(parse, undefined)), label + ': rejects a missing value');
}

(async () => {
  // --- Browser (index.html) -------------------------------------------------
  const indexHtml = read('index.html');

  checkObjectValidator(
    runInFreshContext(extractFunction(indexHtml, 'wlProductionAuthorityValue'), 'wlProductionAuthorityValue'),
    'browser Workload wlProductionAuthorityValue',
  );
  checkObjectValidator(
    runInFreshContext(extractFunction(indexHtml, '_writeUiNormalizeAuthority'), '_writeUiNormalizeAuthority'),
    'browser Write-UI _writeUiNormalizeAuthority',
  );
  checkObjectValidator(
    runInFreshContext(extractFunction(indexHtml, '_prodAuthorityValue'), '_prodAuthorityValue'),
    'browser Production preview _prodAuthorityValue',
  );

  // --- workload-linear/policy.mjs (edge function policy, shared with tests) -
  const workloadPolicy = await import(pathToFileURL(path.join(
    ROOT, 'supabase', 'functions', 'workload-linear', 'policy.mjs',
  )).href);
  checkObjectValidator(workloadPolicy.productionAuthorityValue, 'edge fn workload-linear policy.mjs productionAuthorityValue');
  {
    const allowed = workloadPolicy.linearAuthorityDecision({ video: 'linear', graphics: 'linear' }, 'video');
    const blocked = workloadPolicy.linearAuthorityDecision({ video: 'syncview', graphics: 'linear' }, 'video');
    const aliasBlocked = workloadPolicy.linearAuthorityDecision({ video: 'supabase', graphics: 'linear' }, 'video');
    ok(allowed.ok === true, 'edge fn workload-linear linearAuthorityDecision allows a linear-authoritative team');
    ok(blocked.ok === false && blocked.status === 409, 'edge fn workload-linear linearAuthorityDecision blocks a syncview-authoritative team');
    ok(aliasBlocked.ok === false, 'edge fn workload-linear linearAuthorityDecision rejects the legacy supabase alias');
  }

  // --- scripts/prod-authority-guard.js (shared reconciler guard) -----------
  const prodAuthorityGuard = require(path.join(ROOT, 'scripts', 'prod-authority-guard.js'));
  checkSideValidator(prodAuthorityGuard.normalizeSide, 'reconciler prod-authority-guard.js normalizeSide');
  ok(isRejected(safeCall(prodAuthorityGuard.validateAuthority, { video: 'linear', graphics: 'supabase' })),
    'reconciler prod-authority-guard.js validateAuthority rejects the legacy supabase alias');
  ok(!isRejected(safeCall(prodAuthorityGuard.validateAuthority, { video: 'linear', graphics: 'syncview' })),
    'reconciler prod-authority-guard.js validateAuthority accepts a valid split');

  // --- scripts/linear-deliverables-reconcile.js (local authorityFor) -------
  const linearDeliverablesReconcile = require(path.join(ROOT, 'scripts', 'linear-deliverables-reconcile.js'));
  {
    const fn = linearDeliverablesReconcile.authorityFor;
    ok(fn('video', { video: 'syncview', graphics: 'linear' }) === 'syncview',
      'reconciler linear-deliverables-reconcile.js authorityFor accepts syncview');
    ok(fn('video', { video: 'linear', graphics: 'linear' }) === 'linear',
      'reconciler linear-deliverables-reconcile.js authorityFor accepts linear');
    const alias = fn('video', { video: 'supabase', graphics: 'linear' });
    ok(alias !== 'syncview' && alias !== 'linear',
      'reconciler linear-deliverables-reconcile.js authorityFor rejects the legacy supabase alias');
    const malformed = fn('video', { video: 'sheets', graphics: 'linear' });
    ok(malformed !== 'syncview' && malformed !== 'linear',
      'reconciler linear-deliverables-reconcile.js authorityFor rejects an unrecognized value');
    const missing = fn('video', {});
    ok(missing !== 'syncview' && missing !== 'linear',
      'reconciler linear-deliverables-reconcile.js authorityFor rejects a missing team key');
  }

  // --- scripts/b4-outbound-shadow-audit.js assertSafe -----------------------
  const b4ShadowAudit = require(path.join(ROOT, 'scripts', 'b4-outbound-shadow-audit.js'));
  {
    const baseFlags = {
      linear_outbound_enabled: { mode: 'off' },
      linear_inbound_enabled: { enabled: true },
      auth_enforcement: { mode: 'permissive' },
    };
    const roster = { active_slugs: new Set(['test-client']), flagged_slugs: new Set(['test-client']) };
    const snapshot = prodAuthority => ({ flags: { ...baseFlags, prod_authority: prodAuthority }, ...roster });
    const validSnapshot = snapshot({ video: 'linear', graphics: 'syncview' });
    const aliasSnapshot = snapshot({ video: 'supabase', graphics: 'linear' });
    const malformedSnapshot = snapshot({ video: 'sheets', graphics: 'linear' });
    const missingSnapshot = snapshot({ video: 'linear' });
    assert.doesNotThrow(() => b4ShadowAudit.assertSafe(validSnapshot));
    assert.throws(() => b4ShadowAudit.assertSafe(aliasSnapshot));
    assert.throws(() => b4ShadowAudit.assertSafe(malformedSnapshot));
    assert.throws(() => b4ShadowAudit.assertSafe(missingSnapshot));
    ok(true, 'audit b4-outbound-shadow-audit.js assertSafe rejects the legacy supabase alias, unrecognized values, and a missing team key');
  }

  // --- scripts/production-write-drill.js ------------------------------------
  const productionWriteDrill = require(path.join(ROOT, 'scripts', 'production-write-drill.js'));
  {
    const baseline = {
      linear_outbound_enabled: { value: { mode: 'off' } },
      linear_inbound_enabled: { value: { enabled: true } },
      auth_enforcement: { value: { mode: 'permissive' } },
    };
    const validSnapshot = { ...baseline, prod_authority: { value: { video: 'linear', graphics: 'syncview' } } };
    const aliasSnapshot = { ...baseline, prod_authority: { value: { video: 'supabase', graphics: 'linear' } } };
    const malformedSnapshot = { ...baseline, prod_authority: { value: { video: 'sheets', graphics: 'linear' } } };
    assert.doesNotThrow(() => productionWriteDrill.assertFlipTolerantStance(validSnapshot));
    assert.throws(() => productionWriteDrill.assertFlipTolerantStance(aliasSnapshot));
    assert.throws(() => productionWriteDrill.assertFlipTolerantStance(malformedSnapshot));
    ok(true, 'drill production-write-drill.js assertFlipTolerantStance rejects the legacy supabase alias and unrecognized values');

    const native = { brief: 'the brief' };
    const mirrored = { description: 'the brief' };
    const aliasMatch = productionWriteDrill.descriptionReadbackMatches(
      { video: 'supabase' }, 'video', native, mirrored, 'the brief',
    );
    ok(aliasMatch === false, 'drill production-write-drill.js descriptionReadbackMatches no longer treats supabase as a syncview lane');
    const syncviewMatch = productionWriteDrill.descriptionReadbackMatches(
      { video: 'syncview' }, 'video', native, mirrored, 'the brief',
    );
    ok(syncviewMatch === true, 'drill production-write-drill.js descriptionReadbackMatches still accepts a real syncview lane');
  }

  // --- scripts/write-ui-n8n-authority-gates.js (n8n guard) ------------------
  const n8nAuthorityGates = require(path.join(ROOT, 'scripts', 'write-ui-n8n-authority-gates.js'));
  {
    const helperSource = n8nAuthorityGates.AUTHORITY_HELPER;
    ok(!/'supabase'/.test(helperSource), 'n8n guard AUTHORITY_HELPER source no longer references the legacy supabase alias');
    const normalize = runInFreshContext(extractConst(helperSource, '_prodNormalizeAuthority'), '_prodNormalizeAuthority');
    checkObjectValidator(normalize, 'n8n guard _prodNormalizeAuthority');
  }

  // ---------------------------------------------------------------------------
  // Contract 3: TypeScript edge functions. This hermetic Node suite cannot
  // execute Deno/TypeScript sources (the rest of this repo's test suite makes
  // the same trade-off for every *.ts edge function), so these are pinned as
  // source assertions: the legacy alias literal must be gone, the exact
  // `linear`/`syncview` comparisons must remain, and the two silent
  // default-to-`linear`/`false` bugs found during F55 must stay fixed.
  // ---------------------------------------------------------------------------

  const productionWriteSource = read('supabase/functions/production-write/index.ts');
  const b4WriteSource = read('supabase/functions/_shared/b4-write.ts');
  const linearOutboundSource = read('supabase/functions/linear-outbound/index.ts');
  const linearInboundSource = read('supabase/functions/linear-inbound/index.ts');

  {
    const fn = extractFunction(productionWriteSource, 'authorityFor');
    ok(!/"supabase"/.test(fn), 'edge fn production-write authorityFor no longer accepts the legacy supabase alias');
    ok(/authority === "syncview"/.test(fn) && /authority === "linear"/.test(fn),
      'edge fn production-write authorityFor still compares against exactly "syncview"/"linear"');
    ok((fn.match(/throw new GatewayError\(503, "authority_unavailable"\);/g) || []).length >= 1
      && fn.trim().endsWith('throw new GatewayError(503, "authority_unavailable");\n}'),
      'edge fn production-write authorityFor still rejects any other value with 503 authority_unavailable');
  }

  {
    const fn = extractFunction(b4WriteSource, 'teamAuthority');
    ok(!/"supabase"/.test(fn), 'edge fn _shared/b4-write.ts teamAuthority no longer accepts the legacy supabase alias');
    ok(/raw === "syncview"/.test(fn) && /raw === "linear"/.test(fn),
      'edge fn _shared/b4-write.ts teamAuthority still compares against exactly "syncview"/"linear"');
    ok(/throw new Error\("authority_unavailable"\);/.test(fn),
      'edge fn _shared/b4-write.ts teamAuthority now rejects malformed/missing values instead of silently defaulting to "linear"');
    ok(/catch \(_e\) \{\s*return json\(\{ ok: false, error: "authority_unavailable" \}, 503\);/.test(b4WriteSource),
      'edge fn _shared/b4-write.ts handleB4Write surfaces a rejected teamAuthority read as 503 authority_unavailable');
  }

  {
    const fn = extractFunction(linearOutboundSource, 'authorityFor');
    ok(!/"supabase"/.test(fn), 'edge fn linear-outbound authorityFor no longer accepts the legacy supabase alias');
    ok(/raw === "syncview"/.test(fn) && /raw === "linear"/.test(fn),
      'edge fn linear-outbound authorityFor still compares against exactly "syncview"/"linear"');
  }

  {
    const fn = extractFunction(linearInboundSource, 'isDetectOnlyTeam');
    ok(!/"supabase"/.test(fn), 'edge fn linear-inbound isDetectOnlyTeam no longer accepts the legacy supabase alias');
    ok(/value === "syncview"/.test(fn) && /value === "linear"/.test(fn),
      'edge fn linear-inbound isDetectOnlyTeam still compares against exactly "syncview"/"linear"');
    ok(/throw new Error\("authority_unavailable"\);/.test(fn),
      'edge fn linear-inbound isDetectOnlyTeam now rejects malformed/missing values instead of silently defaulting to Linear-authoritative (false)');
  }

  // ---------------------------------------------------------------------------
  // Contract 4: the pending (not live-applied) F27 SQL. Same trade-off as the
  // TS edge functions: no Postgres in this hermetic suite, so these are
  // source assertions plus an exact byte-identity guard between the two
  // migration copies (they are documented as required to stay verbatim) and
  // between the pending `production_assert_authority` and the one currently
  // live in `2026-07-12-write-ui-outbox-parity.sql`.
  // ---------------------------------------------------------------------------

  const rollbackSql = read('migrations/2026-07-20-f27-team-rollback.sql');
  const writeAuthOnlySql = read('migrations/2026-07-28-f27-write-authorization-only.sql');
  const liveOutboxParitySql = read('migrations/2026-07-12-write-ui-outbox-parity.sql');

  {
    const v20 = extractSqlFunction(rollbackSql, 'track_b_f27_write_authorization');
    const v28 = extractSqlFunction(writeAuthOnlySql, 'track_b_f27_write_authorization');
    ok(!/'supabase'/i.test(v20), 'SQL track_b_f27_write_authorization (2026-07-20-f27-team-rollback.sql) rejects the legacy supabase alias');
    ok(!/'supabase'/i.test(v28), 'SQL track_b_f27_write_authorization (2026-07-28-f27-write-authorization-only.sql) rejects the legacy supabase alias');
    ok(/not in \('linear', 'syncview'\)/.test(v20), 'SQL track_b_f27_write_authorization accepts exactly linear/syncview');
    ok(v20 === v28, 'SQL track_b_f27_write_authorization stays byte-identical across both migration copies (documented forward-compat invariant)');
  }

  {
    const holdGuard = extractSqlFunction(rollbackSql, 'track_b_f27_hold_guard');
    ok(!/'supabase'/i.test(holdGuard), 'SQL track_b_f27_hold_guard rejects the legacy supabase alias');
    ok(/<> 'syncview'/.test(holdGuard), 'SQL track_b_f27_hold_guard requires exactly syncview for a normal-lane write');
  }

  {
    const pending = extractSqlFunction(rollbackSql, 'production_assert_authority');
    const live = extractSqlFunction(liveOutboxParitySql, 'production_assert_authority');
    ok(!/'supabase'/i.test(pending), 'SQL production_assert_authority (pending F27) rejects the legacy supabase alias');
    ok(/is distinct from 'syncview'/.test(pending), 'SQL production_assert_authority (pending F27) uses the NULL-safe "is distinct from" check');
    const pendingWithoutLockLine = pending.replace('  lock table public.mirror_outbox in row exclusive mode;\n', '');
    ok(pendingWithoutLockLine === live,
      'SQL production_assert_authority (pending F27) matches the currently-live authority check exactly (plus the documented lock-table addition) — no regression from the live-strict vocabulary');
  }

  // ---------------------------------------------------------------------------
  // Contract 5: no flag value changed. This test only exercises parsing logic
  // against synthetic fixtures; guard that the actual runbook only ever
  // writes the canonical two values, never the retired alias.
  // ---------------------------------------------------------------------------

  {
    const flipRunbook = read('docs/ops/FLIP_RUNBOOK.md');
    const authorityWrites = flipRunbook.match(/jsonb_set\(value, '\{(?:video|graphics)\}', '"[a-z]+"'::jsonb/g) || [];
    ok(authorityWrites.length > 0, 'runbook FLIP_RUNBOOK.md still has F1 authority flip statements to check');
    ok(authorityWrites.every(stmt => /"linear"|"syncview"/.test(stmt) && !/"supabase"/.test(stmt)),
      'runbook FLIP_RUNBOOK.md F1 flips only ever write "linear" or "syncview", never the legacy alias');
  }

  if (failures) process.exit(1);
  console.log('\nF55 all-consumer authority vocabulary contract passed');
})().catch(error => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});
