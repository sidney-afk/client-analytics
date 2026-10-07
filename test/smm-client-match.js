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
vm.runInContext(body + '\nthis.api = { svClientKey, svCurrentClients, svRosterEntryFor, svScopeMode, svSmmCurrentClients, svUnownedCurrentClients, svAlsoSeesNames };', sandbox);
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

// ALSO SEES (rule 6): extra clients for one staff member, never a roster change.
const cur3 = api.svCurrentClients(['Ann Fixture', 'Bob Fixture', 'Cat Fixture', 'Dan Fixture', 'Eve Fixture']);
const roster6 = [
  { slug: 'mgr-a', name: 'Manager A', active: true, source_clients: ['Ann Fixture', 'Bob Fixture'] },
  { slug: 'mgr-b', name: 'Manager B', active: true, source_clients: ['Cat Fixture', 'Former Fixture'] },
  { slug: 'mgr-gone', name: 'Manager Gone', active: false, source_clients: ['Dan Fixture'] },
];
const grants = [
  { viewer_member_id: 'viewer-1', manager_slug: 'mgr-a', client_name: null },
  { viewer_member_id: 'viewer-1', manager_slug: 'mgr-b', client_name: null },
  { viewer_member_id: 'viewer-1', manager_slug: null, client_name: 'eve  fixture' },
  { viewer_member_id: 'viewer-1', manager_slug: 'mgr-gone', client_name: null },
  { viewer_member_id: 'viewer-2', manager_slug: null, client_name: 'Dan Fixture' },
];
const v1 = api.svAlsoSeesNames(grants, roster6, 'viewer-1');
ok(api.svSmmCurrentClients(null, cur3, v1).join() === 'Ann Fixture,Bob Fixture,Cat Fixture,Eve Fixture',
  'a staff member with no roster entry sees every current client of the managers granted, plus a granted client');
ok(!api.svSmmCurrentClients(null, cur3, v1).includes('Dan Fixture'), 'an inactive manager grants nothing, and another viewer\'s grant does not count');
ok(!api.svSmmCurrentClients(null, cur3, v1).includes('Former Fixture'), 'a granted manager\'s former client (not in Clients Info) is not shown');
ok(api.svSmmCurrentClients(null, cur3, api.svAlsoSeesNames(grants, roster6, '')).length === 0, 'no member id: no grants');
ok(api.svSmmCurrentClients({ source_clients: ['Dan Fixture'] }, cur3, api.svAlsoSeesNames(grants, roster6, 'viewer-2')).join() === 'Dan Fixture',
  'grants add to a roster entry; duplicates are shown once');
ok(api.svSmmCurrentClients({ source_clients: ['Ann Fixture'] }, cur3).join() === 'Ann Fixture', 'without grants the rule is unchanged');
// It follows the roster: move a client onto a granted manager and it appears.
roster6[0].source_clients.push('Dan Fixture');
ok(api.svSmmCurrentClients(null, cur3, api.svAlsoSeesNames(grants, roster6, 'viewer-1')).includes('Dan Fixture'),
  'a client moved onto a granted manager appears with no change to the grants');
ok(JSON.stringify(roster6[1].source_clients) === JSON.stringify(['Cat Fixture', 'Former Fixture']), 'the roster itself is never changed');

if (failed) { console.log(`smm-client-match: ${failed} failed`); process.exit(1); }
console.log('smm-client-match: all checks passed');
