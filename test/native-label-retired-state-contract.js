'use strict';

/*
 * Offline contract checks for the retired-label change. No database, no
 * network. These police the shape of the change and, in particular, that every
 * layer that could reintroduce the defect carries the field.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const MIGRATION = 'migrations/2026-09-18-native-label-retired-state.sql';
const migration = read(MIGRATION);
const lib = read('scripts/linear-label-catalog-export.js');
const cli = read('scripts/linear-label-catalog-export.cli.js');
const gateway = read('supabase/functions/production-write/index.ts');

let passed = 0;
const ok = (name, value) => { assert.ok(value, name); passed += 1; console.log(`  ok ${name}`); };

/* ------------------------------------------------------------ the migration */

ok('the migration replaces exactly the checker and the reader, and defines nothing new',
  JSON.stringify([...migration.matchAll(/create\s+or\s+replace\s+function\s+public\.(\w+)\s*\(/g)].map(m => m[1]).sort())
    === JSON.stringify(['production_label_catalog_check_manifest', 'production_label_catalog_read_version']));
ok('it creates no table, trigger, index or column', !/\b(create\s+(table|trigger|index)|alter\s+table)\b/i.test(migration));
ok('retiredAt is REQUIRED on every label, exactly as archivedAt is',
  migration.includes("or not (v_label ? 'archivedAt') or not (v_label ? 'retiredAt') or not (v_label ? 'team') then"));
ok('a non-null retiredAt must be a well-formed timestamp, and is cast to prove it',
  migration.includes("if v_label->'retiredAt' <> 'null'::jsonb then")
    && migration.includes("perform (v_label->>'retiredAt')::timestamptz;"));
ok('the served catalog excludes retired alongside groups and archived',
  migration.includes("where n->'isGroup' = 'false'::jsonb and n->'archivedAt' = 'null'::jsonb")
    && migration.includes("and n->'retiredAt' = 'null'::jsonb"));
ok('validate_selection is NOT replaced -- retention of an existing selection falls out of it unchanged',
  !migration.includes('production_label_catalog_validate_selection('));
ok('the manifest still carries retired labels, so the count reconciles',
  !/retiredAt[^\n]*continue|delete[^\n]*retiredAt/.test(migration));

const revokes = [...migration.matchAll(/revoke all on function[\s\S]*?;/g)].map(m => m[0]);
ok('every revoke names all four roles',
  revokes.length === 2 && revokes.every(r =>
    ['public', 'anon', 'authenticated', 'service_role'].every(role => new RegExp(`\\b${role}\\b`).test(r))));
const grants = [...migration.matchAll(/grant execute on function ([\s\S]*?);/g)].map(m => m[1]);
ok('only the reader keeps EXECUTE, to service_role, exactly as before',
  grants.length === 1 && /production_label_catalog_read_version/.test(grants[0]) && /to service_role/.test(grants[0]));

/* ------------------------------------------------------- the exporter halves */

ok('the capture query asks Linear for retiredAt', /nodes \{[^}]*\bretiredAt\b/.test(cli));
ok('the selected-labels query asks for it too', (cli.match(/\bretiredAt\b/g) || []).length >= 2);
ok('the receipt reports the retired count separately from archived',
  cli.includes('of which retired') && cli.includes('if (node.retiredAt != null) retired += 1;'));
ok('LABEL_FIELDS carries retiredAt, so the fixture round-trip checks it',
  lib.includes("'archivedAt', 'retiredAt', 'team'"));
ok('the mirrored checker requires retiredAt and validates its format',
  lib.includes("if (!Object.prototype.hasOwnProperty.call(label, 'retiredAt')) labelBad('label.retiredAt missing');")
    && lib.includes("labelBad('label.retiredAt format')"));
ok('projectLabel carries retiredAt through', lib.includes('retiredAt: node.retiredAt == null ? null : clean(node.retiredAt),'));

/* ------------------------------------------------------------- the gateway  */

/* B2 Slice 8 removed the provider (Linear) label catalog from the gateway
   entirely, so the retired-label defect can no longer re-enter through it: the
   only catalog served is the native one, which the migration above filters. */
ok('the gateway has no provider label catalog left to leak a retired label',
  !gateway.includes('async function linearLabelCatalog(')
    && !gateway.includes('issueLabels(')
    && !gateway.includes('api.linear.app'));
ok('label reads and writes refuse as held unless the native catalog is installed',
  /if \(config\.mode !== "native"\) throw new GatewayError\(503, "native_label_catalog_held"\);/.test(gateway));

/* The page needs no change, and this is why: lifecycle never reaches it. The
   gateway hands the browser only the four sanitized keys, so the picker cannot
   render a retired label as applicable even by accident. */
const sanitized = gateway.slice(gateway.indexOf('function sanitizedLabel('), gateway.indexOf('function sortedLabels('));
ok('sanitizedLabel emits only id, name, color and description -- no lifecycle field reaches the browser',
  ['id,', 'name,', 'color:', 'description:'].every(k => sanitized.includes(k))
    && !sanitized.includes('archivedAt') && !sanitized.includes('retiredAt'));

/* --------------------------------------------------- inventory and pinning  */

const preflight = read('scripts/linear-exit-deploy-preflight.js');
for (const routine of ['production_label_catalog_check_manifest(jsonb)', 'production_label_catalog_read_version(uuid,text)'])
  ok(`the preflight pins ${routine} to the retired-state migration`,
    preflight.includes(`['${routine}', '${MIGRATION}'`));

const manifestMod = require('../scripts/linear-exit-install-manifest');
const built = manifestMod.build();
ok('the migration is in the install inventory',
  built.entries.some(e => e.id === '2026-09-18-native-label-retired-state.sql'));
ok('it installs after the foundation whose bodies it replaces',
  built.dependency_order.indexOf('2026-09-05-native-label-catalog-foundation.sql')
    < built.dependency_order.indexOf('2026-09-18-native-label-retired-state.sql'));

ok('the migration carries no UUID literal',
  !/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/.test(migration));
ok('the migration states that any earlier capture must be retaken',
  /MUST BE RETAKEN/.test(migration));

console.log(JSON.stringify({
  marker: 'NATIVE_LABEL_RETIRED_STATE_CONTRACT_OK',
  checks: passed,
  migration_sha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, MIGRATION))).digest('hex'),
}));
