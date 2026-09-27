'use strict';
/* The one SMM-to-client rule (src/index/098-smm-clients.js.part), shared by
 * Today and the client dropdown's "My clients".
 *
 * The roster sheet and Clients Info spell the same client differently: a
 * title on one side only ("Dr Firstname Lastname" versus "Firstname
 * Lastname"), and "and" versus "&" in a duo's name. Both once left a live
 * client looking unowned. Fixture names only; this repo is public. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'index', '098-smm-clients.js.part'), 'utf8');
const body = src.split('\n').filter(l => !/^import /.test(l)).join('\n').split('\nexport {')[0];
const sandbox = { clientMap: {} };
vm.createContext(sandbox);
vm.runInContext(body + '\nthis.api = { svClientKey, svCurrentClients, svRosterEntryFor, svSmmCurrentClients, svUnownedCurrentClients };', sandbox);
const api = sandbox.api;

let failed = 0;
function ok(cond, msg) { console.log((cond ? '  ok  ' : '  FAIL ') + msg); if (!cond) failed++; }

ok(api.svClientKey('Dr Jane Fixture') === api.svClientKey('Jane Fixture'), 'a title without a dot is ignored ("Dr Jane Fixture")');
ok(api.svClientKey('Dr. Jane Fixture') === api.svClientKey('jane  fixture'), 'a title with a dot, case and extra spaces are ignored');
ok(api.svClientKey('Alpha and Beta') === api.svClientKey('Alpha & Beta'), '"and" and "&" are the same ("Alpha and Beta")');
ok(api.svClientKey("Gamma O'Delta-Smith") === api.svClientKey('gamma odelta smith'), 'punctuation is ignored');
ok(api.svClientKey('Jane Fixture') !== api.svClientKey('Jane Fixtures'), 'different names stay different');

// Clients Info (current clients) and a roster.
const current = api.svCurrentClients(['Jane Fixture', 'Alpha & Beta', 'Omega Fixture', 'Unowned Fixture']);
const roster = [
  { name: 'Casey Smm', email: 'casey@example.test', active: true, source_clients: ['Dr Jane Fixture', 'Alpha and Beta', 'Former Fixture'] },
  { name: 'Robin Smm', email: 'robin@example.test', active: true, source_clients: [] },
  { name: 'Old Smm', email: 'old@example.test', active: false, source_clients: ['Omega Fixture'] },
];

const casey = api.svRosterEntryFor(roster, { email: 'CASEY@example.test', name: 'Someone Else' });
ok(casey && casey.name === 'Casey Smm', 'the roster entry is found by email first');
ok(api.svRosterEntryFor(roster, { email: '', name: 'Casey' }).name === 'Casey Smm', 'then by a first name only one entry carries');
ok(api.svRosterEntryFor(roster, { email: 'old@example.test', name: 'Old Smm' }) === null, 'an inactive roster row (a former SMM) is ignored');

const mine = api.svSmmCurrentClients(casey, current).sort();
ok(JSON.stringify(mine) === JSON.stringify(['Alpha & Beta', 'Jane Fixture']), 'an SMM gets both spelling variants, as Clients Info names');
ok(!mine.includes('Former Fixture'), 'a client missing from Clients Info never appears, whatever the roster says');
ok(api.svSmmCurrentClients(api.svRosterEntryFor(roster, { name: 'Robin Smm' }), current).length === 0, 'a new SMM with no clients gets none (Today shows its short note)');

const unowned = api.svUnownedCurrentClients(roster, current).sort();
ok(JSON.stringify(unowned) === JSON.stringify(['Omega Fixture', 'Unowned Fixture']), 'admins-only list = current clients no ACTIVE SMM lists');

if (failed) { console.log(`smm-client-match: ${failed} failed`); process.exit(1); }
console.log('smm-client-match: all checks passed');
