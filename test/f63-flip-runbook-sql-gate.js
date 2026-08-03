'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const runbookPath = path.join(root, 'docs', 'ops', 'FLIP_RUNBOOK.md');
const workflowPath = path.join(root, '.github', 'workflows', 'calendar-unit-tests.yml');
const runbook = fs.readFileSync(runbookPath, 'utf8');
const workflow = fs.readFileSync(workflowPath, 'utf8');

const j = value => JSON.stringify(value);

const actions = [
  {
    name: 'F1 Graphics forward',
    kind: 'forward',
    key: 'prod_authority',
    priors: [{ video: 'linear', graphics: 'linear' }],
    after: { video: 'linear', graphics: 'syncview' },
    jsonbPath: 'graphics',
    error: 'graphics flip refused: expected exact linear/linear authority'
  },
  {
    name: 'F1 Video forward',
    kind: 'forward',
    key: 'prod_authority',
    priors: [{ video: 'linear', graphics: 'syncview' }],
    after: { video: 'syncview', graphics: 'syncview' },
    jsonbPath: 'video',
    error: 'video flip refused: expected linear/syncview authority'
  },
  {
    name: 'F1 Graphics recovery from Graphics-only phase',
    kind: 'recovery',
    key: 'prod_authority',
    priors: [{ video: 'linear', graphics: 'syncview' }],
    after: { video: 'linear', graphics: 'linear' },
    jsonbPath: 'graphics',
    error: 'graphics reversal refused: expected linear/syncview authority'
  },
  {
    name: 'F1 Graphics recovery while Video remains SyncView',
    kind: 'recovery',
    key: 'prod_authority',
    priors: [{ video: 'syncview', graphics: 'syncview' }],
    after: { video: 'syncview', graphics: 'linear' },
    jsonbPath: 'graphics',
    error: 'graphics reversal refused: expected syncview/syncview authority'
  },
  {
    name: 'F1 Video recovery while Graphics remains SyncView',
    kind: 'recovery',
    key: 'prod_authority',
    priors: [{ video: 'syncview', graphics: 'syncview' }],
    after: { video: 'linear', graphics: 'syncview' },
    jsonbPath: 'video',
    error: 'video reversal refused: expected syncview/syncview authority'
  },
  {
    name: 'F1 Video recovery after Graphics is Linear',
    kind: 'recovery',
    key: 'prod_authority',
    priors: [{ video: 'syncview', graphics: 'linear' }],
    after: { video: 'linear', graphics: 'linear' },
    jsonbPath: 'video',
    error: 'video reversal refused: expected syncview/linear authority'
  },
  {
    name: 'F2 emergency normal-lane kill',
    kind: 'kill',
    key: 'linear_outbound_enabled',
    priors: [{ mode: 'shadow' }, { mode: 'live' }],
    after: { mode: 'off' },
    error: 'normal outbound kill refused: expected shadow or live; read back'
  },
  {
    name: 'F2 forward arm to shadow',
    kind: 'forward',
    key: 'linear_outbound_enabled',
    priors: [{ mode: 'off' }],
    after: { mode: 'shadow' },
    error: 'shadow arm refused: expected off'
  },
  {
    name: 'F2 forward live directly from off',
    kind: 'forward',
    key: 'linear_outbound_enabled',
    priors: [{ mode: 'off' }],
    after: { mode: 'live' },
    error: 'live arm refused: expected off'
  },
  {
    name: 'F2 forward live after shadow',
    kind: 'forward',
    key: 'linear_outbound_enabled',
    priors: [{ mode: 'shadow' }],
    after: { mode: 'live' },
    error: 'live arm refused: expected shadow'
  },
  {
    name: 'F3 inbound corruption kill',
    kind: 'kill',
    key: 'linear_inbound_enabled',
    priors: [{ enabled: true }],
    after: { enabled: false },
    error: 'inbound kill refused: expected enabled; read back'
  },
  {
    name: 'F3 inbound recovery enable',
    kind: 'recovery',
    key: 'linear_inbound_enabled',
    priors: [{ enabled: false }],
    after: { enabled: true },
    error: 'inbound enable refused: expected disabled'
  },
  {
    name: 'F4 emergency parity kill',
    kind: 'kill',
    key: 'linear_legacy_parity_enabled',
    priors: [{ enabled: true }],
    after: { enabled: false },
    error: 'parity kill refused: expected enabled; read back'
  },
  {
    name: 'F4 forward parity arm',
    kind: 'forward',
    key: 'linear_legacy_parity_enabled',
    priors: [{ enabled: false }],
    after: { enabled: true },
    error: 'parity arm refused: expected disabled'
  },
  {
    name: 'F5 forward auth enforcement',
    kind: 'forward',
    key: 'auth_enforcement',
    priors: [{ mode: 'permissive' }],
    after: { mode: 'enforced' },
    error: 'auth enforcement refused: expected permissive'
  }
];

function lineAt(text, offset) {
  return text.slice(0, offset).split(/\r?\n/).length;
}

function extractFences(text, language) {
  const escaped = language.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp('^```' + escaped + '[ \\t]*\\r?\\n([\\s\\S]*?)^```[ \\t]*$', 'gm');
  const found = [];
  let match;
  while ((match = re.exec(text))) {
    found.push({
      sql: match[1].replace(/\s+$/, ''),
      line: lineAt(text, match.index),
      offset: match.index
    });
  }
  return found;
}

function splitTopLevelStatements(sql) {
  const statements = [];
  let start = 0;
  let i = 0;
  let state = 'normal';
  let dollarTag = '';
  let blockDepth = 0;
  let escapeString = false;

  const push = end => {
    const value = sql.slice(start, end).trim();
    if (value) statements.push(value);
    start = end + 1;
  };

  while (i < sql.length) {
    const a = sql[i];
    const b = sql[i + 1];

    if (state === 'line-comment') {
      if (a === '\n') state = 'normal';
      i++;
      continue;
    }
    if (state === 'block-comment') {
      if (a === '/' && b === '*') {
        blockDepth++;
        i += 2;
      } else if (a === '*' && b === '/') {
        blockDepth--;
        i += 2;
        if (blockDepth === 0) state = 'normal';
      } else {
        i++;
      }
      continue;
    }
    if (state === 'single') {
      if (escapeString && a === '\\') {
        i += Math.min(2, sql.length - i);
      } else if (a === "'" && b === "'") {
        i += 2;
      } else if (a === "'") {
        state = 'normal';
        escapeString = false;
        i++;
      } else {
        i++;
      }
      continue;
    }
    if (state === 'double') {
      if (a === '"' && b === '"') {
        i += 2;
      } else if (a === '"') {
        state = 'normal';
        i++;
      } else {
        i++;
      }
      continue;
    }
    if (state === 'dollar') {
      if (sql.startsWith(dollarTag, i)) {
        i += dollarTag.length;
        state = 'normal';
      } else {
        i++;
      }
      continue;
    }

    if (a === '-' && b === '-') {
      state = 'line-comment';
      i += 2;
    } else if (a === '/' && b === '*') {
      state = 'block-comment';
      blockDepth = 1;
      i += 2;
    } else if (a === "'") {
      escapeString = i > 0 && /[eE]/.test(sql[i - 1]) && (i < 2 || !/[A-Za-z0-9_]/.test(sql[i - 2]));
      state = 'single';
      i++;
    } else if (a === '"') {
      state = 'double';
      i++;
    } else if (a === '$') {
      const tag = sql.slice(i).match(/^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/);
      if (tag) {
        dollarTag = tag[0];
        state = 'dollar';
        i += dollarTag.length;
      } else {
        i++;
      }
    } else if (a === ';') {
      push(i);
      i++;
    } else {
      i++;
    }
  }

  assert.notStrictEqual(state, 'single', 'unterminated single-quoted SQL string');
  assert.notStrictEqual(state, 'double', 'unterminated quoted SQL identifier');
  assert.notStrictEqual(state, 'dollar', 'unterminated dollar-quoted SQL body');
  assert.notStrictEqual(state, 'block-comment', 'unterminated SQL block comment');
  const tail = sql.slice(start).trim();
  if (tail) statements.push(tail);
  return statements;
}

function normalizeSql(sql) {
  return sql.replace(/\s+/g, ' ').trim().toLowerCase();
}

function parsedPriorValues(sql) {
  const exact = sql.match(/\band\s+value\s*=\s*'([^']+)'::jsonb\s*;/i);
  if (exact) return [JSON.parse(exact[1])];
  const enumerated = sql.match(/\band\s+value\s+in\s*\(([^)]+)\)\s*;/i);
  if (!enumerated) return [];
  return Array.from(enumerated[1].matchAll(/'([^']+)'::jsonb/g), match => JSON.parse(match[1]));
}

function normalizedCasPredicate(sql) {
  const matches = sql.match(/\bwhere\s+key\s*=\s*'[^']+'[\s\S]*?;/gi) || [];
  assert.strictEqual(matches.length, 1, 'mutation fence must contain one complete key/value CAS predicate');
  return matches[0].replace(/\s+/g, ' ').trim();
}

function validateUtility(fence) {
  const statements = splitTopLevelStatements(fence.sql);
  assert.strictEqual(statements.length, 2, 'read-only utility must contain its two declared result sets');
  for (const statement of statements) {
    assert.match(statement, /^\s*select\b/i, 'read-only utility may contain SELECT statements only');
  }
  assert.doesNotMatch(
    fence.sql,
    /\b(insert|update|delete|merge|call|copy|create|alter|drop|truncate|grant|revoke|comment|vacuum|analyze|refresh|reindex|cluster|do|begin|commit|rollback|savepoint|set|into|lock)\b/i,
    'read-only utility must be mutation- and transaction-free'
  );
  assert.match(statements[0], /\bfrom\s+public\.syncview_runtime_flags\b/i);
  assert.match(statements[1], /\bfrom\s+public\.flag_flips\b/i);
  assert.doesNotMatch(fence.sql, /\(/, 'read-only utility may not invoke a function');
  assert.strictEqual(
    normalizeSql(statements[0]),
    'select key, value, updated_at, updated_by from public.syncview_runtime_flags order by key',
    'read-only utility preserves the exact flag projection and order'
  );
  assert.strictEqual(
    normalizeSql(statements[1]),
    'select id, key, old_value, new_value, ts, actor from public.flag_flips order by id desc limit 20',
    'read-only utility preserves the exact audit projection and order'
  );
}

function validateMutation(fence, action) {
  const statements = splitTopLevelStatements(fence.sql);
  assert.strictEqual(statements.length, 1, `${action.name}: one top-level action per fence`);
  assert.match(statements[0], /^\s*do\s+\$/i, `${action.name}: action must be one assertion-bearing DO block`);
  assert.strictEqual(
    (fence.sql.match(/\bupdate\s+public\.syncview_runtime_flags\b/gi) || []).length,
    1,
    `${action.name}: exactly one runtime-flag UPDATE`
  );
  assert.strictEqual(
    (fence.sql.match(/\bupdate\b/gi) || []).length,
    1,
    `${action.name}: no second UPDATE target`
  );
  assert.doesNotMatch(
    fence.sql,
    /\b(insert\s+into|delete\s+from|merge\s+into|call\s+|copy\s+|create\s+|alter\s+|drop\s+|truncate\s+|grant\s+|revoke\s+|commit\b|rollback\b|savepoint\b|start\s+transaction|set\s+transaction|execute\b|perform\b|select\b)\b/i,
    `${action.name}: no second write, DDL, or transaction-control action`
  );
  assert.match(fence.sql, /\bset\s+value\s*=/i, `${action.name}: writes the flag value`);
  assert.match(fence.sql, /\bupdated_by\s*=\s*'owner-runbook'/i, `${action.name}: preserves owner attribution`);
  assert.match(fence.sql, /\bget\s+diagnostics\s+n\s*=\s*row_count\s*;/i, `${action.name}: captures affected rows`);
  assert.match(fence.sql, /\bif\s+n\s*<>\s*1\s+then\s+raise\s+exception\b/i, `${action.name}: zero/multi-row match fails loudly`);

  const key = fence.sql.match(/\bwhere\s+key\s*=\s*'([^']+)'/i);
  assert.ok(key, `${action.name}: target key predicate is required`);
  assert.strictEqual(key[1], action.key, `${action.name}: expected target key`);

  const priors = parsedPriorValues(fence.sql);
  assert.deepStrictEqual(priors, action.priors, `${action.name}: declared prior-state CAS`);
  const expectedPredicate = action.priors.length === 1
    ? `where key = '${action.key}' and value = '${j(action.priors[0])}'::jsonb;`
    : `where key = '${action.key}' and value in (${action.priors.map(prior => `'${j(prior)}'::jsonb`).join(', ')});`;
  assert.strictEqual(
    normalizedCasPredicate(fence.sql).toLowerCase(),
    expectedPredicate.toLowerCase(),
    `${action.name}: complete CAS predicate is exact and contains no broadened branch`
  );
  if (action.kind === 'forward') {
    assert.strictEqual(priors.length, 1, `${action.name}: forward action has one exact prior`);
    assert.doesNotMatch(fence.sql, /\bvalue\s+in\s*\(/i, `${action.name}: forward action cannot use a prior-state set`);
  } else {
    assert.ok(priors.length >= 1, `${action.name}: kill/recovery has an explicit finite prior set`);
  }

  assert.ok(fence.sql.includes(`raise exception '${action.error}'`), `${action.name}: stable loud-refusal message`);
  const expectedSet = action.key === 'prod_authority'
    ? `set value = jsonb_set(value, '{${action.jsonbPath}}', '"${action.after[action.jsonbPath]}"'::jsonb, false), updated_by = 'owner-runbook'`
    : `set value = '${j(action.after)}'::jsonb, updated_by = 'owner-runbook'`;
  const expectedBody = [
    'do $$ declare n integer; begin',
    'update public.syncview_runtime_flags',
    expectedSet,
    expectedPredicate,
    'get diagnostics n = row_count;',
    `if n <> 1 then raise exception '${action.error}'; end if;`,
    'end $$;'
  ].join(' ');
  assert.strictEqual(
    normalizeSql(fence.sql),
    normalizeSql(expectedBody),
    `${action.name}: DO body contains only the one approved CAS action and assertion`
  );
  if (action.key === 'prod_authority') {
    assert.match(fence.sql, /\bset\s+value\s*=\s*jsonb_set\s*\(/i, `${action.name}: composite flag changes one key`);
    const path = fence.sql.match(/jsonb_set\s*\(\s*value\s*,\s*'\{([^}]+)\}'/i);
    assert.ok(path, `${action.name}: one-key jsonb_set path`);
    assert.strictEqual(path[1], action.jsonbPath, `${action.name}: intended authority key only`);
  } else {
    assert.doesNotMatch(fence.sql, /\bset\s+value\s*=\s*jsonb_set\s*\(/i, `${action.name}: scalar flag uses its exact object`);
    assert.ok(
      fence.sql.includes(`set value = '${j(action.after)}'::jsonb`),
      `${action.name}: exact target value`
    );
  }
}

const sqlFences = extractFences(runbook, 'sql');
const textFences = extractFences(runbook, 'text');
const graphicsF2SqlFences = sqlFences.filter(fence =>
  /public\.track_b_enqueue_outbound_intent\(\)/i.test(fence.sql)
);
const f63SqlFences = sqlFences.filter(fence =>
  !/public\.track_b_enqueue_outbound_intent\(\)/i.test(fence.sql)
);

assert.strictEqual(sqlFences.length, 18, 'FLIP_RUNBOOK must expose exactly 18 executable SQL fences');
assert.strictEqual(graphicsF2SqlFences.length, 2, 'Graphics F2 owns exactly one revoke fence and one rollback fence');
assert.match(graphicsF2SqlFences[0].sql, /revoke\s+execute\s+on\s+function\s+public\.track_b_enqueue_outbound_intent\(\)\s+from\s+public/i);
assert.match(graphicsF2SqlFences[1].sql, /grant\s+execute\s+on\s+function\s+public\.track_b_enqueue_outbound_intent\(\)\s+to\s+public/i);
assert.strictEqual(f63SqlFences.length, 16, 'F63 retains exactly one utility and 15 mutation fences');
assert.strictEqual(actions.length, 15, 'F63 action manifest covers all 15 mutation fences');
assert.match(
  runbook.slice(Math.max(0, f63SqlFences[0].offset - 300), f63SqlFences[0].offset),
  /F63 read-only utility/i,
  'first SQL fence is explicitly classified as the shared read-only utility'
);
assert.ok(
  textFences.some(fence => /select\s+public\.track_b_f27_finalize\s*\(/i.test(fence.sql)),
  'R2 placeholder is retained as a non-executable text template'
);
assert.ok(
  textFences.some(fence => /<ROLLBACK_ID>/.test(fence.sql) && /<EXACT_AUTHORITY_FROM_BEGIN_RECEIPT>/.test(fence.sql)),
  'R2 text template retains both receipt-bound placeholders'
);
for (const fence of sqlFences) {
  assert.doesNotMatch(fence.sql, /<[^>]+>/, `SQL fence at line ${fence.line} contains no placeholder`);
  assert.doesNotMatch(fence.sql, /\bf27\b|track_b_f27|mirror_outbox/i, `SQL fence at line ${fence.line} creates no F27 dependency`);
}

validateUtility(f63SqlFences[0]);
actions.forEach((action, index) => validateMutation(f63SqlFences[index + 1], action));

assert.throws(
  () => validateUtility({ sql: `${f63SqlFences[0].sql}\nupdate public.syncview_runtime_flags set value='{}';` }),
  /two declared result sets|SELECT statements only|mutation-/,
  'linter rejects a mutating/multi-action utility'
);
assert.throws(
  () => validateMutation(
    { sql: `${f63SqlFences[1].sql}\nupdate public.syncview_runtime_flags set value='{}'::jsonb;` },
    actions[0]
  ),
  /one top-level action|exactly one runtime-flag UPDATE/,
  'linter rejects a multi-action mutation fence'
);
assert.throws(
  () => validateMutation(
    { sql: f63SqlFences[1].sql.replace(/\n\s+and value = '[^']+'::jsonb;/, ';') },
    actions[0]
  ),
  /declared prior-state CAS/,
  'linter rejects an unconditional whole-row replacement'
);
assert.throws(
  () => validateMutation(
    {
      sql: f63SqlFences[1].sql.replace(
        /jsonb_set\(value, '\{graphics\}', '"syncview"'::jsonb, false\)/,
        `'${j(actions[0].after)}'::jsonb`
      )
    },
    actions[0]
  ),
  /only the one approved CAS action/,
  'linter rejects a conditional whole-object replacement of the composite authority flag'
);
assert.throws(
  () => validateMutation(
    { sql: f63SqlFences[1].sql.replace(/::jsonb;/, '::jsonb or true;') },
    actions[0]
  ),
  /declared prior-state CAS|complete CAS predicate is exact/,
  'linter rejects a broadened OR predicate'
);
assert.throws(
  () => validateMutation(
    { sql: f63SqlFences[1].sql.replace('get diagnostics n = row_count;', "execute 'update another_table set value = 1';\n  get diagnostics n = row_count;") },
    actions[0]
  ),
  /no second UPDATE target|no second write, DDL, or transaction-control action/,
  'linter rejects dynamic secondary SQL'
);
assert.throws(
  () => validateMutation(
    {
      sql: f63SqlFences[1].sql.replace(
        'get diagnostics n = row_count;',
        "perform pg_notify('f63', 'extra');\n  get diagnostics n = row_count;"
      )
    },
    actions[0]
  ),
  /no second write, DDL, or transaction-control action|only the one approved CAS action/,
  'linter rejects a secondary function action inside the DO body'
);
assert.throws(
  () => validateUtility({ sql: `${f63SqlFences[0].sql.replace(/order by key;/i, 'order by key for share;')}` }),
  /exact flag projection and order/,
  'linter rejects a locking read-only utility'
);
assert.strictEqual(
  splitTopLevelStatements(String.raw`select E'a\';b'; select 2;`).length,
  2,
  'SQL statement splitter keeps semicolons inside PostgreSQL escape strings'
);

const unitJob = workflow.match(/\n  unit:\n([\s\S]*?)(?=\n  [A-Za-z0-9_-]+:\n|$)/);
assert.ok(unitJob, 'calendar-unit-tests defines the always-on unit job');
assert.match(unitJob[1], /\bimage:\s*postgres:16\b/, 'always-on unit job pins PostgreSQL 16');
assert.match(unitJob[1], /\bF63_REQUIRE_POSTGRES:\s*['"]?1['"]?/, 'always-on unit job requires F63 PostgreSQL execution');
assert.match(unitJob[1], /\bPGHOST:\s*localhost\b/, 'F63 CI PostgreSQL is loopback-only');
assert.match(unitJob[1], /\bnode test\/run-all\.js\b/, 'F63 remains auto-discovered by the unit runner');

console.log('PASS: extracted and classified 18 FLIP_RUNBOOK SQL fences (2 Graphics F2, 1 F63 utility, 15 F63 mutations)');
console.log('PASS: SQL-aware lint rejects multi-action, unconditional, whole-composite, placeholder, and F27 cases');
console.log('PASS: always-on CI requires its loopback PostgreSQL 16 service');

const requirePostgres = process.env.F63_REQUIRE_POSTGRES === '1';
if (!requirePostgres) {
  const isCalendarUnitGate =
    process.env.GITHUB_ACTIONS === 'true' &&
    process.env.GITHUB_WORKFLOW === 'Calendar unit tests';
  assert.ok(!isCalendarUnitGate, 'Calendar unit tests must execute the F63 PostgreSQL proof');
  console.log('SKIP: disposable PostgreSQL proof is required by the calendar unit gate and optional elsewhere');
  process.exit(0);
}

const allowedHosts = new Set(['localhost', '127.0.0.1', '::1']);
const pgHost = String(process.env.PGHOST || '').trim().toLowerCase();
assert.ok(allowedHosts.has(pgHost), `F63 refuses non-loopback PGHOST: ${pgHost || '(missing)'}`);
assert.strictEqual(String(process.env.PGDATABASE || ''), 'postgres', 'F63 bootstrap database must be postgres');
assert.ok(/^\d+$/.test(String(process.env.PGPORT || '')), 'F63 requires an explicit numeric PGPORT');
assert.ok(String(process.env.PGUSER || '').trim(), 'F63 requires an explicit PGUSER');

const database = `f63_${process.pid}_${Date.now()}`;
assert.match(database, /^f63_[a-z0-9_]+$/, 'disposable database name is a fixed safe identifier');

const psqlEnv = {};
for (const name of ['PATH', 'Path', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'HOME', 'LANG', 'LC_ALL']) {
  if (process.env[name] !== undefined) psqlEnv[name] = process.env[name];
}
Object.assign(psqlEnv, {
  PGHOST: pgHost,
  PGPORT: String(process.env.PGPORT),
  PGUSER: String(process.env.PGUSER),
  PGPASSWORD: String(process.env.PGPASSWORD || ''),
  PGDATABASE: 'postgres',
  PGSSLMODE: 'disable'
});
assert.deepStrictEqual(
  Object.keys(psqlEnv).filter(name => /^PG/.test(name)).sort(),
  ['PGDATABASE', 'PGHOST', 'PGPASSWORD', 'PGPORT', 'PGSSLMODE', 'PGUSER'],
  'psql receives no service, host-address, options, or live-database override'
);

function runPsql(targetDatabase, sql, expectSuccess = true) {
  const result = spawnSync(
    'psql',
    ['-X', '--quiet', '--no-align', '--tuples-only', '--set', 'ON_ERROR_STOP=1', '--dbname', targetDatabase, '--file', '-'],
    {
      cwd: root,
      env: psqlEnv,
      input: sql,
      encoding: 'utf8',
      windowsHide: true,
      maxBuffer: 4 * 1024 * 1024,
      timeout: 30000
    }
  );
  if (result.error) throw result.error;
  if (expectSuccess && result.status !== 0) {
    throw new Error(`psql failed (${result.status}): ${(result.stderr || result.stdout || '').trim()}`);
  }
  if (!expectSuccess && result.status === 0) {
    throw new Error('psql unexpectedly succeeded');
  }
  return result;
}

function scalar(targetDatabase, sql) {
  const result = runPsql(targetDatabase, `${sql.replace(/;\s*$/, '')};\n`);
  const lines = String(result.stdout || '').trim().split(/\r?\n/).filter(Boolean);
  assert.strictEqual(lines.length, 1, `expected one scalar row for: ${sql}`);
  return lines[0];
}

const serverVersion = scalar('postgres', 'show server_version_num');
assert.match(serverVersion, /^16\d{4}$/, `F63 requires PostgreSQL major 16, got ${serverVersion}`);
assert.strictEqual(scalar('postgres', 'select current_database()'), 'postgres');

const schemaSql = `
create table public.syncview_runtime_flags (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by text
);

create table public.flag_flips (
  id bigint generated always as identity primary key,
  key text not null,
  old_value jsonb,
  new_value jsonb,
  actor text,
  ts timestamptz not null default now()
);

create function public.syncview_runtime_flags_touch_updated_at()
returns trigger
language plpgsql
as $body$
begin
  new.updated_at = now();
  return new;
end;
$body$;

create trigger syncview_runtime_flags_touch_updated_at
before update on public.syncview_runtime_flags
for each row execute function public.syncview_runtime_flags_touch_updated_at();

create function public.syncview_runtime_flags_log_flip()
returns trigger
language plpgsql
as $body$
begin
  if old.value is distinct from new.value then
    insert into public.flag_flips (key, old_value, new_value, actor)
    values (new.key, old.value, new.value, new.updated_by);
  end if;
  return new;
end;
$body$;

create trigger syncview_runtime_flags_log_flip
after update on public.syncview_runtime_flags
for each row execute function public.syncview_runtime_flags_log_flip();
`;

assert.doesNotMatch(schemaSql, /\bf27\b|track_b_f27|mirror_outbox/i, 'fixture schema creates no F27 object');

const defaults = {
  prod_authority: { video: 'linear', graphics: 'linear' },
  linear_outbound_enabled: { mode: 'off' },
  linear_inbound_enabled: { enabled: true },
  linear_legacy_parity_enabled: { enabled: false },
  auth_enforcement: { mode: 'permissive' },
  f63_unrelated_sentinel: { exact: ['leave', 'unchanged'], revision: 63 }
};

function literal(value) {
  return `'${j(value).replace(/'/g, "''")}'::jsonb`;
}

function resetStore(action, prior, omitTarget = false) {
  const rows = Object.entries(defaults)
    .filter(([key]) => !(omitTarget && key === action.key))
    .map(([key, value]) => [
      key,
      key === action.key ? prior : value
    ]);
  const values = rows.map(([key, value]) =>
    `('${key}', ${literal(value)}, '2000-01-01 00:00:00+00'::timestamptz, 'fixture-seed')`
  ).join(',\n');
  runPsql(database, `
truncate table public.flag_flips restart identity;
delete from public.syncview_runtime_flags;
insert into public.syncview_runtime_flags(key, value, updated_at, updated_by)
values
${values};
`);
}

function snapshot() {
  const raw = scalar(database, `
select jsonb_build_object(
  'flags', coalesce((
    select jsonb_agg(to_jsonb(f) order by f.key)
    from public.syncview_runtime_flags f
  ), '[]'::jsonb),
  'flips', coalesce((
    select jsonb_agg(to_jsonb(x) order by x.id)
    from public.flag_flips x
  ), '[]'::jsonb)
)::text
`);
  return JSON.parse(raw);
}

function targetRow(state, key) {
  return state.flags.find(row => row.key === key);
}

function unrelatedRows(state, key) {
  return state.flags.filter(row => row.key !== key);
}

function runAction(sql, expectSuccess) {
  return runPsql(database, `begin;\n${sql}\ncommit;\n`, expectSuccess);
}

function proveSuccess(action, fence, prior) {
  resetStore(action, prior);
  const before = snapshot();
  runAction(fence.sql, true);
  const after = snapshot();
  const row = targetRow(after, action.key);
  const priorRow = targetRow(before, action.key);

  assert.ok(row, `${action.name}: target remains present`);
  assert.deepStrictEqual(row.value, action.after, `${action.name}: exact target readback`);
  assert.strictEqual(row.updated_by, 'owner-runbook', `${action.name}: owner attribution readback`);
  assert.ok(Number.isFinite(Date.parse(row.updated_at)), `${action.name}: timestamp readback is valid`);
  assert.notStrictEqual(row.updated_at, priorRow.updated_at, `${action.name}: timestamp trigger readback`);
  assert.deepStrictEqual(
    unrelatedRows(after, action.key),
    unrelatedRows(before, action.key),
    `${action.name}: unrelated rows remain byte-identical`
  );
  assert.strictEqual(after.flips.length, 1, `${action.name}: exactly one audit event`);
  assert.strictEqual(after.flips[0].key, action.key, `${action.name}: audit target`);
  assert.deepStrictEqual(after.flips[0].old_value, prior, `${action.name}: audit exact prior`);
  assert.deepStrictEqual(after.flips[0].new_value, action.after, `${action.name}: audit exact write`);
  assert.strictEqual(after.flips[0].actor, 'owner-runbook', `${action.name}: audit actor`);
  assert.strictEqual(
    Date.parse(after.flips[0].ts),
    Date.parse(row.updated_at),
    `${action.name}: audit and row timestamps share the exact transaction time`
  );
}

function proveRefusal(action, fence, prior, omitTarget, label) {
  resetStore(action, prior, omitTarget);
  const before = snapshot();
  const result = runAction(fence.sql, false);
  const diagnostic = `${result.stderr || ''}\n${result.stdout || ''}`;
  assert.ok(diagnostic.includes(action.error), `${action.name}: ${label} refusal is loud and stable`);
  const after = snapshot();
  assert.deepStrictEqual(after, before, `${action.name}: ${label} refusal leaves zero residue`);
}

function proveUtility(fence) {
  const seedAction = actions[0];
  resetStore(seedAction, seedAction.priors[0]);
  runPsql(database, `
insert into public.flag_flips(key, old_value, new_value, actor, ts)
values (
  'readback-fixture',
  '{"before":true}'::jsonb,
  '{"after":true}'::jsonb,
  'readback-fixture',
  '2000-01-01 00:00:00+00'::timestamptz
);
  `);
  const before = snapshot();
  const result = runPsql(database, `begin transaction read only;\n${fence.sql}\ncommit;\n`, true);
  const lines = String(result.stdout || '').trim().split(/\r?\n/).filter(Boolean);
  assert.strictEqual(lines.length, before.flags.length + before.flips.length, 'readback returns both declared result sets');
  const flagLines = lines.slice(0, before.flags.length);
  flagLines.forEach((line, index) => {
    const fields = line.split('|');
    const expected = before.flags[index];
    assert.strictEqual(fields.length, 4, `readback flag ${index + 1}: exact four-column projection`);
    assert.strictEqual(fields[0], expected.key, `readback flag ${index + 1}: key`);
    assert.deepStrictEqual(JSON.parse(fields[1]), expected.value, `readback flag ${index + 1}: value`);
    assert.strictEqual(Date.parse(fields[2]), Date.parse(expected.updated_at), `readback flag ${index + 1}: updated_at`);
    assert.strictEqual(fields[3], expected.updated_by, `readback flag ${index + 1}: updated_by`);
  });
  const expectedFlips = before.flips.slice().sort((a, b) => b.id - a.id).slice(0, 20);
  lines.slice(before.flags.length).forEach((line, index) => {
    const fields = line.split('|');
    const expected = expectedFlips[index];
    assert.strictEqual(fields.length, 6, `readback audit ${index + 1}: exact six-column projection`);
    assert.strictEqual(Number(fields[0]), expected.id, `readback audit ${index + 1}: id`);
    assert.strictEqual(fields[1], expected.key, `readback audit ${index + 1}: key`);
    assert.deepStrictEqual(JSON.parse(fields[2]), expected.old_value, `readback audit ${index + 1}: old_value`);
    assert.deepStrictEqual(JSON.parse(fields[3]), expected.new_value, `readback audit ${index + 1}: new_value`);
    assert.strictEqual(Date.parse(fields[4]), Date.parse(expected.ts), `readback audit ${index + 1}: ts`);
    assert.strictEqual(fields[5], expected.actor, `readback audit ${index + 1}: actor`);
  });
  assert.deepStrictEqual(snapshot(), before, 'readback utility leaves the store byte-identical');
}

let created = false;
try {
  runPsql('postgres', `create database "${database}" template template0;`);
  created = true;
  assert.strictEqual(
    scalar(database, `
      select count(*)
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
    `),
    '0',
    'template0 fixture starts without public relations, including F27 or mirror objects'
  );
  assert.strictEqual(
    scalar(database, `
      select count(*)
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
    `),
    '0',
    'template0 fixture starts without public functions, including F27 finalizers'
  );
  runPsql(database, schemaSql);
  proveUtility(f63SqlFences[0]);
  console.log(`PASS: F63 fence 1/16 line ${f63SqlFences[0].line} shared readback is executable and read-only`);

  actions.forEach((action, index) => {
    const fence = f63SqlFences[index + 1];
    for (const prior of action.priors) proveSuccess(action, fence, prior);
    proveRefusal(action, fence, action.after, false, 'wrong-prior zero-match');
    proveRefusal(action, fence, action.after, true, 'missing-row zero-match');
    console.log(
      `PASS: F63 fence ${index + 2}/16 line ${fence.line} ${action.name} ` +
      `(${action.priors.length} valid prior${action.priors.length === 1 ? '' : 's'}; wrong+missing refusal; exact readback/audit/sentinel)`
    );
  });

  console.log('F63_FLIP_RUNBOOK_SQL_GATE_OK');
} finally {
  if (created) {
    runPsql('postgres', `
select pg_terminate_backend(pid)
from pg_stat_activity
where datname = '${database}' and pid <> pg_backend_pid();
drop database "${database}";
`);
  }
}
