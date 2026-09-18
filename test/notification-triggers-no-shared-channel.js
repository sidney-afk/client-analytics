'use strict';
/*
 * The native notification readers must never resolve a destination from
 * clients.slack_channel_id.
 *
 * That column holds the SHARED client channel — the one the client is in.
 * Measured 2026-09-18 on the live roster: all 26 stored values are shared client
 * channels. Until 2026-09-18-notification-creative-channel.sql, all three intent
 * triggers and the client branch of the reconcile RPC read it, so an enabled
 * sender would have posted internal status changes and staff comments where the
 * client could read them.
 *
 * This guard walks the migrations in date order, takes the LAST definition of
 * each of the four routines — the one that would win on a fresh apply — strips
 * comments and string-free prose, and asserts the shared column is not read and
 * the creative column is. A future migration that reintroduces the old read
 * fails here rather than in someone's Slack.
 */
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MIGRATIONS = path.join(ROOT, 'migrations');
const SHARED = 'slack_channel_id';
const CREATIVE = 'creative_channel_id';
const ROUTINES = [
  'production_notification_status_intent_after',
  'production_notification_comment_intent_after',
  'production_notification_client_comment_event_after',
  'production_notification_reconcile',
];

// Line comments only: the routine bodies carry no block comments, and a naive
// /* */ strip would eat a regex or a dollar-quoted body.
const stripComments = sql => sql.split('\n').map(line => line.replace(/--.*$/, '')).join('\n');

function lastDefinition(name, files) {
  let found = null;
  for (const file of files) {
    const sql = fs.readFileSync(path.join(MIGRATIONS, file), 'utf8');
    const pattern = new RegExp('create\\s+(?:or\\s+replace\\s+)?function\\s+public\\.' + name + '\\s*\\([\\s\\S]*?\\n\\$fn\\$;', 'g');
    let match;
    while ((match = pattern.exec(sql))) found = { file, body: match[0] };
  }
  return found;
}

const files = fs.readdirSync(MIGRATIONS).filter(f => f.endsWith('.sql')).sort();
assert(files.length > 0, 'no migrations found');

// The check must be seen to fire (journal D26): a synthetic body carrying the
// shared column is detected by the same predicate used on the real ones.
const plantedBody = `create or replace function public.planted_control()
returns trigger language plpgsql as $fn$
begin
  v_channel := nullif(btrim(coalesce(v_client.slack_channel_id, '')), '');
  return new;
end;
$fn$;`;
assert.equal(stripComments(plantedBody).includes(SHARED), true, 'the control must detect a planted shared-column read');
assert.equal(stripComments(plantedBody.replace(SHARED, CREATIVE)).includes(SHARED), false, 'and must clear once it is replaced');

const report = [];
for (const name of ROUTINES) {
  const found = lastDefinition(name, files);
  assert(found, `${name} has no definition in migrations/`);
  const body = stripComments(found.body);
  assert.equal(
    body.includes(SHARED),
    false,
    `${name} (last defined in ${found.file}) reads ${SHARED}: the shared client channel is never a notification destination`,
  );
  assert.equal(
    body.includes(CREATIVE),
    true,
    `${name} (last defined in ${found.file}) does not read ${CREATIVE}: it must resolve its destination from the creative channel`,
  );
  report.push({ routine: name, last_defined_in: found.file });
}

console.log(JSON.stringify({
  marker: 'NOTIFICATION_TRIGGERS_NO_SHARED_CHANNEL_OK',
  routines_checked: report.length,
  migrations_scanned: files.length,
  planted_control: 'DETECTED_THEN_CLEARED',
  report,
}));
