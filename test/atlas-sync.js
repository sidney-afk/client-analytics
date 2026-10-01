'use strict';
// Repository evidence keeps the Atlas inventory honest. Live catalogs remain
// dated observations; this offline check cannot prove a deployment is current.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { stripBlockComments } = require('./helpers/strip-comments');
const ROOT = path.resolve(__dirname, '..');
let pass = 0, fail = 0;
function ok(condition, message) {
  console.log((condition ? 'OK  ' : 'FAIL ') + message);
  condition ? pass++ : fail++;
}
function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(file) : [file];
  });
}
function tableCreates(sql) {
  // Keep executable DO/function bodies and quoted identifiers. Exclude comments.
  // This inventories files, without asserting that their DDL was applied.
  return /\bcreate\s+(?:(?:unlogged|temporary|temp)\s+)?table\s+(?:if\s+not\s+exists\s+)?(?:"[^"]+"|[a-z_]\w*)/i
    .test(stripBlockComments(sql).replace(/^[ \t]*--.*$/gm, ' '));
}
function workflowIds(doc) {
  // Retained historical IDs are included alongside the dated current census.
  const tick = String.fromCharCode(96);
  return new Set([...doc.matchAll(new RegExp(tick + '([A-Za-z0-9]{16})' + tick, 'g'))]
    .map(match => match[1]).filter(id => !/^[0-9a-f]{16}$/.test(id)));
}
function expected(root) {
  const relative = file => path.relative(root, file).split(path.sep).join('/');
  return {
    edge: new Set(fs.readdirSync(path.join(root, 'supabase/functions'), { withFileTypes: true })
      .filter(entry => entry.isDirectory()).map(entry => entry.name)),
    migration: new Set(['migrations', 'supabase/migrations'].flatMap(dir => walk(path.join(root, dir)))
      .filter(file => file.endsWith('.sql') && tableCreates(fs.readFileSync(file, 'utf8'))).map(relative)),
    action: new Set(walk(path.join(root, '.github/workflows')).map(relative)),
    n8n: workflowIds(fs.readFileSync(path.join(root, 'docs/truth/N8N.md'), 'utf8')),
  };
}
function entries(atlas) {
  const result = { edge: new Set(), migration: new Set(), action: new Set(), n8n: new Set() };
  const errors = [];
  let matched = 0;
  for (const match of atlas.matchAll(/<!-- atlas:(edge|migration|action|n8n) ([^\s]+) -->/g)) {
    matched++;
    const [, kind, id] = match;
    if (result[kind].has(id)) errors.push('duplicate ' + kind + ' entry: ' + id);
    result[kind].add(id);
    const start = atlas.lastIndexOf('\n', match.index) + 1;
    const end = atlas.indexOf('\n', match.index);
    const line = atlas.slice(start, end < 0 ? atlas.length : end).replace(/<!--.*?-->/g, '').trim();
    if (!line.startsWith('|') || !/\[[^\]]+\]\([^)]+\)/.test(line))
      errors.push(kind + ' entry needs a visible linked table row: ' + id);
  }
  if ([...atlas.matchAll(/<!--\s*atlas:[^>]*-->/g)].length !== matched)
    errors.push('malformed Atlas inventory marker');
  return { result, errors };
}
function compare(wanted, observed) {
  const errors = [];
  for (const kind of Object.keys(wanted)) {
    for (const id of wanted[kind]) if (!observed[kind].has(id)) errors.push('missing ' + kind + ' entry: ' + id);
    for (const id of observed[kind]) if (!wanted[kind].has(id)) errors.push('stale ' + kind + ' entry: ' + id);
  }
  return errors;
}
const atlas = fs.readFileSync(path.join(ROOT, 'docs/ATLAS.md'), 'utf8');
const wanted = expected(ROOT);
const observed = entries(atlas);
for (const error of observed.errors.concat(compare(wanted, observed.result))) ok(false, error);
for (const [kind, ids] of Object.entries(wanted)) {
  ok(ids.size > 0, kind + ' inventory is nonempty');
  ok(ids.size === observed.result[kind].size, kind + ' inventory matches (' + ids.size + ' entries)');
}
// Local navigation is also checked. Remote evidence links need a live read.
const anchors = new Set([...atlas.matchAll(/^#{1,6}\s+(.+)$/gm)].map(match => match[1]
  .toLowerCase().replace(/[^\w\s-]/g, '').trim().replace(/\s/g, '-')));
for (const link of new Set([...atlas.matchAll(/\]\(([^)\s]+)\)/g)].map(match => match[1]))) {
  if (link.startsWith('#')) { ok(anchors.has(link.slice(1)), 'Atlas section exists: ' + link); continue; }
  if (/^https?:/.test(link)) continue;
  const target = decodeURIComponent(link.split('#')[0]);
  ok(fs.existsSync(path.resolve(ROOT, 'docs', target)), 'Atlas link exists: ' + target);
}
ok(/docs\/ATLAS\.md/.test(fs.readFileSync(path.join(ROOT, 'REPO_MAP.md'), 'utf8')), 'Repo map links the Atlas');
ok(/\]\(ATLAS\.md\)/.test(fs.readFileSync(path.join(ROOT, 'docs/STATE_OF_THINGS.md'), 'utf8')), 'Owner priorities link the Atlas');
// Exercise source discovery against real temporary files, then additions and
// removals in every required class. No checkout or live catalog is mutated.
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-sync-'));
try {
  for (const dir of ['supabase/functions/example', 'migrations', 'supabase/migrations', '.github/workflows', 'docs/truth'])
    fs.mkdirSync(path.join(sandbox, dir), { recursive: true });
  fs.writeFileSync(path.join(sandbox, 'migrations/example.sql'), 'CREATE TABLE example (id int);');
  fs.writeFileSync(path.join(sandbox, 'supabase/migrations/second.sql'), 'CREATE TABLE "private"."second" (id int);');
  fs.writeFileSync(path.join(sandbox, '.github/workflows/example.yml'), 'name: example\n');
  const tick = String.fromCharCode(96);
  fs.writeFileSync(path.join(sandbox, 'docs/truth/N8N.md'), tick + 'AbCdEf0123456789' + tick);
  const fixture = expected(sandbox);
  ok(fixture.edge.has('example') && fixture.migration.size === 2 && fixture.action.has('.github/workflows/example.yml') && fixture.n8n.has('AbCdEf0123456789'), 'control discovers all four real source classes and both migration roots');
  const operations = {
    edge: () => fs.mkdirSync(path.join(sandbox, 'supabase/functions/added')),
    migration: () => fs.writeFileSync(path.join(sandbox, 'supabase/migrations/added.sql'), 'CREATE TABLE added (id int);'),
    action: () => fs.writeFileSync(path.join(sandbox, '.github/workflows/added.yml'), 'name: added\n'),
    n8n: () => fs.appendFileSync(path.join(sandbox, 'docs/truth/N8N.md'), '\n' + tick + 'AddedWorkflow123' + tick),
  };
  for (const [kind, add] of Object.entries(operations)) {
    add();
    const changed = expected(sandbox);
    ok(compare(changed, fixture).some(error => error.startsWith('missing ' + kind)), 'control rejects missing ' + kind + ' after source addition');
    ok(compare(fixture, changed).some(error => error.startsWith('stale ' + kind)), 'control rejects stale ' + kind + ' after source removal');
  }
} finally {
  // This fresh directory is generated by mkdtemp, outside the repository.
  fs.rmSync(sandbox, { recursive: true, force: true });
}
ok(!tableCreates('-- CREATE TABLE ignored (id int);\n/* CREATE TABLE ignored_too (id int); */'), 'control ignores commented DDL');
ok(tableCreates('CREATE TABLE IF NOT EXISTS "private"."example" (id int);'), 'control sees quoted DDL');
ok(tableCreates('DO $$ BEGIN CREATE TEMP TABLE example (id int); END $$;'), 'control sees DDL in a DO body');
ok(entries('| <!-- atlas:edge example --> [example](example.ts) | Purpose. |\n| <!-- atlas:edge example --> [example](example.ts) | Purpose. |').errors.length > 0, 'control rejects duplicate entries');
ok(entries('<!-- atlas:edge example -->').errors.length > 0, 'control rejects an invisible entry');
const tick = String.fromCharCode(96);
ok(workflowIds(tick + 'AbCdEf0123456789' + tick + ' ' + tick + 'abcdef0123456789' + tick).size === 1, 'control separates workflow IDs from commit prefixes');
console.log('\natlas-sync: ' + pass + ' passed, ' + fail + ' failed');
if (fail) process.exit(1);
