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
vm.runInContext(body + '\nthis.api = { svClientKey, svCurrentClients, svRosterEntryFor, svScopeMode, svSmmCurrentClients, svUnownedCurrentClients };', sandbox);
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

// Test clients (clients.kind = 'test') never count.
const withTest = api.svCurrentClients(['Jane Fixture', 'Dr Test Fixture', 'Slugged Fixture'], [
  { slug: 'x', display_name: 'Test Fixture', kind: 'test' },
  { slug: 'slugged-fixture', display_name: 'Other Name', kind: 'test' },
  { slug: 'jane-fixture', display_name: 'Jane Fixture', kind: 'client' },
]);
ok(JSON.stringify([...withTest.values()]) === JSON.stringify(['Jane Fixture']), 'a test client is dropped, matched by display name or slug; a real one stays');
ok(api.svSmmCurrentClients({ source_clients: ['Test Fixture', 'Jane Fixture'] }, withTest).join() === 'Jane Fixture', "a test client is never in an SMM's own list");

// Which clients a person sees (svScopeMode). No switch, nothing saved.
ok(api.svScopeMode(true, true) === 'mine', 'an admin on the roster sees their own clients');
ok(api.svScopeMode(true, false) === 'all', 'an admin not on the roster sees all clients');
ok(api.svScopeMode(false, true) === 'mine', 'an SMM sees their own clients');
ok(api.svScopeMode(false, false) === 'mine', 'a non-admin not on the roster still never sees all');

if (failed) { console.log(`smm-client-match: ${failed} failed`); process.exit(1); }
console.log('smm-client-match: all checks passed');
