'use strict';
const assert = require('node:assert/strict');
const {observation, compare, load} = require('../scripts/linear-exit-observed-public-catalog');
const names = ['rules', 'types', 'views', 'tables', 'indexes', 'policies', 'triggers',
  'functions', 'sequences', 'default_acls', 'dependencies', 'publications', 'internal_constraint_triggers'];
const catalog = Object.fromEntries(names.map(name => [name, []]));
catalog.schema = {owner: 'postgres', acl: null}; catalog.server_major = 17;
catalog.functions = [{name: 'synthetic', body_raw_md5: '1'.repeat(32), body_lf_md5: '2'.repeat(32)}];
catalog.tables = [{name: 'synthetic', columns: [{name: 'id', not_null: true}]}];
const options = {projectRef: 'abcdefghijklmnopqrst', observedDate: '2026-09-12'};
const expected = observation(catalog, options);
assert.equal(compare(catalog, expected, options).status, 'MATCHED_OBSERVED_PUBLIC_CATALOG');
assert.equal(compare(catalog, expected, options).installation_authorized, false);
assert.equal(compare(catalog, expected, {}).code, 'PROJECT_CONTEXT_MISMATCH');
assert.equal(compare(catalog, expected, {...options, queryBytes: Buffer.from('other')}).code, 'CATALOG_QUERY_DRIFT');
let checks = 4;
for (const mutate of [
  x => { x.functions[0].body_raw_md5 = '3'.repeat(32); },
  x => { x.schema.acl = 'synthetic-grant'; },
  x => { x.tables[0].columns[0].not_null = false; },
  x => { x.tables.push({name: 'unexpected'}); },
  x => { x.unexpected = true; },
  x => { delete x.policies; }
]) {
  const changed = structuredClone(catalog); mutate(changed);
  assert.equal(compare(changed, expected, options).status, 'REFUSE'); checks++;
}
assert.throws(() => load({readFile: () => Buffer.from('{}')}), /ARTIFACT_DRIFT/); checks++;
assert.equal(load().installation_authorized, false); checks++;
const broken = structuredClone(expected); broken.sections.pop();
assert.equal(compare(catalog, broken, options).status, 'REFUSE'); checks++;
assert.ok(!JSON.stringify(expected).includes('synthetic-grant'));
console.log(JSON.stringify({marker: 'OBSERVED_PUBLIC_CATALOG_OFFLINE_PASS', checks,
  installation_authorized: false, hosted_connection_proven: false}));
