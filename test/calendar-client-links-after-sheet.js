'use strict';
/*
 * The Calendar's globe (social profiles) button must appear as soon as the
 * Clients Info sheet lands, not only after a client switch.
 *
 * The button is built from clientMap handles by _calSyncClientLinks, which
 * used to run only when the calendar body repainted. If the calendar painted
 * before the sheet arrived, nothing repainted afterwards and the button stayed
 * missing until the owner switched client and back.
 *
 * Runs the shipped _applyEssentialTexts with stubs and checks that it re-syncs
 * the button, AFTER clientMap is populated.
 */
const fs = require('node:fs');
const path = require('node:path');

let failures = 0;
function ok(c, m) { if (c) console.log('  ok  ' + m); else { failures++; console.error('FAIL  ' + m); } }

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'index', '040-shared-briefs.js.part'), 'utf8');
const start = src.indexOf('function _applyEssentialTexts');
const end = src.indexOf('\n    function _applyExtraTexts', start);
ok(start > -1 && end > start, '_applyEssentialTexts is defined');

let syncSawHandles = null;
// eslint-disable-next-line no-new-func
const run = new Function(`
  let allData = [], clientMap = {};
  const _analyticsAppliedFp = {};
  const _analyticsFp = () => 'fp';
  const parseCSV = () => [];
  const _clientsInfoPublicRows = () => [{ client_name: 'Test Client', instagram_handle: 'x' }];
  const wlMergeClientsFromSheet = () => {};
  const _blankAnalyticsRow = n => ({ client_name: n });
  const _calSyncClientLinks = () => { report(!!(clientMap['Test Client'] && clientMap['Test Client'].instagram_handle)); };
  let report;
  ${src.slice(start, end)}
  return (cb) => { report = cb; _applyEssentialTexts('', ''); };
`)();
run(v => { syncSawHandles = v; });

ok(syncSawHandles !== null, 'loading the Clients Info sheet re-syncs the calendar globe button');
ok(syncSawHandles === true, 'the re-sync runs after clientMap holds the handles');

if (failures) { console.error(`\n${failures} failure(s)`); process.exit(1); }
console.log('\ncalendar-client-links-after-sheet: all passed');
