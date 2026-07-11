'use strict';

const path = require('path');
const { pathToFileURL } = require('url');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

function rawHasAny(raw, keys) {
  const stack = raw && typeof raw === 'object' ? [raw] : [];
  while (stack.length) {
    const current = stack.pop();
    if (!current || typeof current !== 'object') continue;
    for (const key of keys) {
      if (Object.prototype.hasOwnProperty.call(current, key) && current[key]) return true;
    }
    for (const value of Object.values(current)) {
      if (value && typeof value === 'object') stack.push(value);
    }
  }
  return false;
}

function productionVisible(raw) {
  if (rawHasAny(raw, ['webhook_delete', 'deleted', 'delete', 'removed', 'archived'])) return false;
  return !(raw.issue && (raw.issue.archivedAt || raw.issue.canceledAt));
}

(async () => {
  const moduleUrl = pathToFileURL(path.join(
    __dirname,
    '..',
    'supabase',
    'functions',
    'linear-inbound',
    'restore-markers.mjs',
  )).href;
  const { clearArchiveMarkers } = await import(moduleUrl);

  const archived = {
    issue: { id: 'linear_fixture', archivedAt: '2026-07-11T00:00:00Z', canceledAt: null },
    archived: '2026-07-11T00:00:00Z',
    webhook_delete: true,
    nested: { deleted: true, delete: true, removed: true, keep: 'fixture' },
    inbound: { delivery_id: 'fixture_delivery' },
    restored: true,
  };
  ok(!productionVisible(archived), 'archive markers hide the fixture before restore');

  const restored = clearArchiveMarkers(archived);
  ok(productionVisible(restored), 'archive -> restore makes the fixture visible');
  ok(restored.issue.archivedAt === null, 'restore clears the nested archivedAt value');
  ok(restored.restored === true && restored.nested.keep === 'fixture', 'restore preserves non-archive raw metadata');
  ok(!rawHasAny(restored, ['webhook_delete', 'deleted', 'delete', 'removed', 'archived']),
    'restore removes every archive/delete marker recursively');
  ok(archived.webhook_delete === true && archived.issue.archivedAt, 'marker clearing does not mutate the stored input snapshot');

  if (failures) {
    console.error(`\n${failures} linear-inbound restore check(s) failed`);
    process.exit(1);
  }
  console.log('\nlinear-inbound archive/restore checks passed');
})().catch(error => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});
