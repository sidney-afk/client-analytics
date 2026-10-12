'use strict';
// Offline. Stops a migration from re-breaking the private database backup.
//
// The Track-B backup refuses to run when any table outside its corpus has a
// foreign key into a corpus table, or the other way round ("omitted incoming
// foreign key" / "omitted referenced relation"). PR 2036 added
// public.pto_member_events (a foreign key to team_members) without adding it
// to the corpus, and the backup then failed every real run for two days
// (OPEN_REPAIRS 409). This reads every migration, finds each table it creates
// with a foreign key to or from a table in the NEWEST corpus, and fails when
// that table is not in the newest corpus itself.
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const backup = require('../scripts/track-b-backup');
const { stripBlockComments } = require('./helpers/strip-comments');

const ROOT = path.resolve(__dirname, '..');
const MIGRATION_DIRS = ['migrations', 'supabase/migrations'];

function stripComments(sql) {
  return stripBlockComments(sql, ' ').replace(/--[^\n]*/g, ' ');
}

// Matches an optionally quoted, optionally public-qualified table name.
// Another schema (auth.users, storage.objects) returns null: not our corpus.
const NAME = '(?:"?public"?\\.)?"?([a-z_][a-z0-9_]*)"?';
const OTHER_SCHEMA = /^"?[a-z_][a-z0-9_]*"?\./i;

function bodyAt(sql, open) {
  let depth = 0;
  for (let i = open; i < sql.length; i++) {
    if (sql[i] === '(') depth++;
    else if (sql[i] === ')' && --depth === 0) return sql.slice(open + 1, i);
  }
  return sql.slice(open + 1);
}

// Returns { tables: Set, edges: [{child, parent, file}], dropped: Set }
function scan(files) {
  const tables = new Set(), dropped = new Set(), edges = [];
  const refRe = new RegExp('references\\s+(?!\\s)((?:"?[a-z_][a-z0-9_]*"?\\.)?"?[a-z_][a-z0-9_]*"?)', 'gi');
  const parentOf = raw => {
    if (/^"?public"?\./i.test(raw)) return raw.replace(/^"?public"?\./i, '').replace(/"/g, '');
    if (OTHER_SCHEMA.test(raw)) return null;
    return raw.replace(/"/g, '');
  };
  for (const { file, sql: original } of files) {
    const sql = stripComments(original).toLowerCase();
    const createRe = new RegExp('create\\s+table\\s+(?:if\\s+not\\s+exists\\s+)?' + NAME + '\\s*\\(', 'g');
    let m;
    while ((m = createRe.exec(sql))) {
      const child = m[1];
      tables.add(child);
      const body = bodyAt(sql, m.index + m[0].length - 1);
      let r;
      refRe.lastIndex = 0;
      while ((r = refRe.exec(body))) {
        const parent = parentOf(r[1]);
        if (parent) edges.push({ child, parent, file });
      }
    }
    const alterRe = new RegExp('alter\\s+table\\s+(?:if\\s+exists\\s+)?(?:only\\s+)?' + NAME + '\\s+([^;]*?)references\\s+((?:"?[a-z_][a-z0-9_]*"?\\.)?"?[a-z_][a-z0-9_]*"?)', 'g');
    while ((m = alterRe.exec(sql))) {
      const parent = parentOf(m[3]);
      if (parent) edges.push({ child: m[1], parent, file });
    }
    const dropRe = new RegExp('drop\\s+table\\s+(?:if\\s+exists\\s+)?' + NAME, 'g');
    while ((m = dropRe.exec(sql))) dropped.add(m[1]);
  }
  return { tables, edges, dropped };
}

// Pure so the self-check below can feed it synthetic migrations.
function violations(files, corpusName) {
  const corpus = backup.resolveCorpus(corpusName);
  const inCorpus = new Set(corpus.tables.map(t => t.name));
  const { tables, edges, dropped } = scan(files);
  const next = 'history-v' + (corpus.version + 1);
  const out = new Map();
  for (const { child, parent, file } of edges) {
    if (dropped.has(child) || dropped.has(parent)) continue;
    if (inCorpus.has(child) === inCorpus.has(parent)) continue;
    const outside = inCorpus.has(child) ? parent : child;
    const inside = inCorpus.has(child) ? child : parent;
    // A table the migrations never create is a platform table; only ours count.
    if (!tables.has(outside)) continue;
    if (out.has(outside)) continue;
    out.set(outside, `public.${outside} has a foreign key ${outside === child ? 'to' : 'from'} public.${inside}, which is in the newest Track-B corpus (${corpus.name}), but public.${outside} is not in it (${file}). `
      + `The private backup refuses to run until it is. Fix: add it to a new Track-B corpus (${next}), following docs/ops/TRACK_B_BACKUP.md and the history-v13 change for pto_member_events.`);
  }
  return [...out.values()];
}

function repoMigrations() {
  const files = [];
  for (const dir of MIGRATION_DIRS) {
    const abs = path.join(ROOT, dir);
    if (!fs.existsSync(abs)) continue;
    for (const f of fs.readdirSync(abs).filter(n => n.endsWith('.sql')).sort()) {
      files.push({ file: `${dir}/${f}`, sql: fs.readFileSync(path.join(abs, f), 'utf8') });
    }
  }
  return files;
}

const newest = Object.values(backup.CORPORA).reduce((a, b) => (b.version > a.version ? b : a));
let n = 0;
const check = (label, fn) => { fn(); n++; console.log('ok - ' + label); };

check('the guard names the table and the fix when a migration adds an uncovered table with a foreign key into the corpus', () => {
  const v = violations([{ file: 'migrations/x.sql', sql: 'create table if not exists public.brand_new_audit (id bigint, member_id uuid not null references public.team_members (id));' }], newest.name);
  assert.equal(v.length, 1);
  assert.match(v[0], /public\.brand_new_audit/);
  assert.match(v[0], /add it to a new Track-B corpus \(history-v\d+\)/);
});
check('the guard also catches a corpus table that points at an uncovered table, and an ALTER TABLE foreign key', () => {
  const t = [...backup.resolveCorpus(newest.name).tables][1].name;
  const fromCorpus = violations([{ file: 'a.sql', sql: `create table public.side_a (id int primary key); alter table public.${t} add constraint fk foreign key (z) references public.side_a (id);` }], newest.name);
  assert.equal(fromCorpus.length, 1);
  assert.match(fromCorpus[0], /public\.side_a/);
});
check('the guard ignores platform schemas, tables outside the corpus on both ends, and dropped tables', () => {
  assert.deepEqual(violations([{ file: 'a.sql', sql: 'create table public.a1 (id int, u uuid references auth.users (id)); create table public.a2 (id int); create table public.a3 (id int references public.a2 (id)); create table public.gone (m uuid references public.team_members (id)); drop table if exists public.gone;' }], newest.name), []);
});
check('the guard would have caught PR 2036 against history-v12', () => {
  const v = violations(repoMigrations(), 'history-v12');
  assert.ok(v.some(x => x.includes('public.pto_member_events')), 'history-v12 should fail on pto_member_events');
});
check(`every migration is consistent with the newest corpus (${newest.name})`, () => {
  const v = violations(repoMigrations(), newest.name);
  assert.deepEqual(v, [], '\n' + v.join('\n'));
});

console.log(`track-b-corpus-migration-guard: ${n} checks passed`);
