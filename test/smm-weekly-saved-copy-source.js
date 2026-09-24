'use strict';
// SMM weekly reports paints a saved copy first and refreshes behind it.
// These pins keep that copy staff-only, owner-bound and purged on sign-out,
// and keep the managers roster to one read per page load.
const fs = require('fs');
const path = require('path');
const SRC = fs.readFileSync(path.join(__dirname, '..', 'src/index/110-time-off-reports.js.part'), 'utf8');
const STAFF = fs.readFileSync(path.join(__dirname, '..', 'src/index/100-onboarding-staff-controls.js.part'), 'utf8');
function ok(v, m) { if (!v) { console.error('FAIL smm-weekly-saved-copy-source:', m); process.exit(1); } }
const owner = SRC.slice(SRC.indexOf('function _srpSavedOwner()'), SRC.indexOf('function _srpSavedViewKey()'));
ok(/_isClientLink\) return ''/.test(owner), 'client links never own a saved copy');
ok(/_syncviewStaffIdentityForHeaders\(\)/.test(owner), 'owner comes from the VERIFIED identity only');
ok(!/ident\.key/.test(owner), 'the role key is never part of the saved copy owner');
const load = SRC.slice(SRC.indexOf('async function _srpLoadReports()'), SRC.indexOf('function _srpReportModel()'));
ok(load.indexOf("_syncviewRequireStaffIdentity('weekly-report-manage')") < load.indexOf('_srpSavedRead('), 'saved copy is read only after the manage capability is required');
ok(/needOptions \? _srpLoadOptions\(\)/.test(load), 'managers roster is fetched once, not on every filter change');
ok(/seq !== _srpLoadSeq/.test(load), 'a superseded load never paints');
ok(/_srpOptionsFetched = false; _srpLoadReports\(\)/.test(SRC), 'Refresh re-reads the managers roster too');
ok(/removeItem\(SRP_SAVED_KEY\)/.test(SRC.slice(SRC.indexOf('function _srpPurgeSensitiveState()'))), 'purge drops the saved copy');
ok(/_srpPurgeSensitiveState\(\)/.test(STAFF.slice(STAFF.indexOf('function _syncviewStaffPurgeSensitiveState()'), STAFF.indexOf('function _syncviewStaffPurgeSensitiveState()') + 1200)), 'sign-out purge calls the reports purge');
console.log('smm-weekly-saved-copy-source: ok');
