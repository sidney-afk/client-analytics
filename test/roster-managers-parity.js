'use strict';
// roster-managers-parity.js: the Social Media Managers tab versus the database,
// compared offline on synthetic rows (Sheets move, slice 1).
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const p = require('../scripts/roster-managers-parity.js');

let n = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); n++; console.log('  ok  ' + msg); };

ok(p.clientKey('Dr. Ana  Pérez & Co') === p.clientKey('ana perez and co'), 'client names match the way the page matches them (title, accents, "and", spacing)');

const sheet = p.sheetAssignments([
  { client_name: 'Client One', social_media_manager: 'Pat Example', slack_profile_url: 'https://example.invalid/a' },
  { client_name: 'Client Two', social_media_manager: 'Pat Example', slack_profile_url: 'https://example.invalid/a' },
  { client_name: '', social_media_manager: 'Nobody', slack_profile_url: '' },
]);
const db = p.databaseAssignments([
  { name: 'Pat  Example', active: true, source_clients: ['client one', 'Client Two'], slack_profile_url: 'https://example.invalid/a' },
  { name: 'Former', active: false, source_clients: ['Client Three'], slack_profile_url: '' },
]);
ok(sheet.length === 2, 'a Sheet row with no client is not an assignment');
ok(db.length === 2, 'an inactive manager owns nothing');
let r = p.compareAssignments(sheet, db);
ok(r.differences.length === 0 && r.clients === 2, 'equal copies compare clean');

r = p.compareAssignments(sheet, p.databaseAssignments([
  { name: 'Pat Example', active: true, source_clients: ['Client One'], slack_profile_url: 'https://example.invalid/b' },
]));
ok(r.differences.length === 3, 'a changed Slack link and a missing client are both differences');
ok(r.differences.every(d => /^[0-9a-f]{12}$/.test(d.client)), 'a client is reported only by a short reference');
ok(!JSON.stringify(r).includes('Client') && !JSON.stringify(r).includes('example.invalid'), 'the report carries no name or link');

const wf = fs.readFileSync(path.join(__dirname, '..', '.github/workflows/sheets-mirror-daily.yml'), 'utf8');
ok(/node scripts\/roster-managers-parity\.js --strict/.test(wf), 'the daily lane runs the managers comparison strictly');
console.log('roster-managers-parity: ' + n + ' checks passed');
