'use strict';
/*
 * templates-coverage.js — the dawn check's "every current client has a
 * Templates page" count (qa/dawn/templates-coverage.js). Offline, fixture names.
 */
const assert = require('assert');
const { coverage, clientNamesFromCsv, parseCsv } = require('../qa/dawn/templates-coverage.js');
let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };

const csv = 'client_name,email\n"Alpha Fixture","a@example.invalid"\n"Beta Fixture, Two",b@example.invalid\n"Gamma ""G"" Fixture",\nDelta Fixture,\n,\nTest Fixture,\n';
const names = clientNamesFromCsv(csv);
ok(names.length === 5 && names[1] === 'Beta Fixture, Two' && names[2] === 'Gamma "G" Fixture', 'Clients Info names are read, quotes and commas included');
ok(parseCsv('a,"b\nc"\r\nd,e').length === 2, 'a newline inside quotes stays in its field');
ok(clientNamesFromCsv('email\nx@example.invalid\n').length === 0, 'no client_name column reads as no clients');

const clients = [{ slug: 'testfixture', display_name: 'Test Fixture', kind: 'test' }, { slug: 'alphafixture', display_name: 'Alpha Fixture', kind: 'client' }];
const templates = [
  { client_slug: 'alphafixture', data: { thumbnails_canva_link: 'https://example.invalid/a' } },
  { client_slug: 'betafixturetwo', data: { thumbnails_canva_link: '  ' } },
  { client_slug: 'testfixture', data: {} },
];
const c = coverage({ clientNames: names, clients, templates });
ok(c.current === 4, 'the test client is left out of current clients');
ok(c.noRow === 2, 'clients with no Templates row are counted');
ok(c.noLink === 1, 'a row with a blank thumbnail link is counted once, separately');
ok(JSON.stringify(coverage({ clientNames: ['Alpha Fixture'], clients, templates })) === JSON.stringify({ current: 1, noRow: 0, noLink: 0 }), 'a fully set-up client is not flagged');
ok(coverage({ clientNames: ['Alpha Fixture', 'alpha fixture'], clients, templates }).current === 1, 'the same client written twice counts once');
const titled = [{ slug: 'epsilonfixture', display_name: 'Dr. Epsilon Fixture', kind: 'client' }];
ok(JSON.stringify(coverage({ clientNames: ['Dr. Epsilon Fixture'], clients: titled, templates: [{ client_slug: 'epsilonfixture', data: { thumbnails_canva_link: 'x' } }] })) === JSON.stringify({ current: 1, noRow: 0, noLink: 0 }),
  'a row keyed by the client slug is found even when the display name differs');

console.log(`templates-coverage: ${n} checks passed ✅`);
