'use strict';
/*
 * Previous/current thumbnail comparison UI wiring.
 *
 * This fast guard pins the security boundary and the four user-facing render
 * surfaces. The signed-image endpoint itself is covered by
 * thumbnail-revision-history.js; live browser proof is performed separately.
 */
const fs = require('fs');
const path = require('path');

const INDEX = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');

let failures = 0;
function check(label, condition) {
  if (condition) console.log('  ok  ' + label);
  else { console.log('FAIL  ' + label); failures++; }
}

check('comparison reader uses the protected Edge Function',
  /const THUMBNAIL_REVISION_READ_EF_URL = CAL_SUPABASE_URL \+ '\/functions\/v1\/thumbnail-revision-read'/.test(INDEX));
check('comparison control appears only for a watched single-Drive thumbnail_url',
  /const thumbnailUrl = String\(post\.thumbnail_url \|\| ''\)\.trim\(\);[\s\S]*_calIsFolderLink\(thumbnailUrl\)[\s\S]*!_calDriveFileId\(thumbnailUrl\)/.test(INDEX) &&
  !/_thumbCompareButtonHtml[\s\S]{0,300}_calDeriveThumbInfo\(post\)/.test(INDEX));
check('comparison request carries normal scoped SyncView credentials',
  /const headers = _syncviewEfHeaders\([\s\S]*THUMBNAIL_REVISION_READ_EF_URL\);[\s\S]*fetch\(THUMBNAIL_REVISION_READ_EF_URL/.test(INDEX));
check('comparison request is exact-card scoped and bypasses browser caches',
  /cache: 'no-store'[\s\S]*JSON\.stringify\(\{ surface: state\.surface, client: state\.client, source_id: state\.pid \}\)/.test(INDEX));
check('staff without a verified identity is prompted before any history read',
  /if \(!_isClientLink && !_syncviewStaffIdentityForHeaders\(\)\)[\s\S]*_syncviewOpenStaffIdentity\(\{ reason: 'required' \}\)/.test(INDEX));
check('signed previous/current URLs are rendered as a two-pane comparison',
  /_thumbComparePaneHtml\('Previous', model\.baseline[\s\S]*_thumbComparePaneHtml\('Current', model\.latest/.test(INDEX));
check('Calendar organizer and review cards expose comparison',
  /_thumbCompareButtonHtml\('calendar', p, false\)/.test(INDEX) &&
  /_thumbCompareButtonHtml\('calendar', p, true\)/.test(INDEX));
check('Samples organizer and review cards expose comparison',
  /_thumbCompareButtonHtml\('samples', p, false\)/.test(INDEX) &&
  /_thumbCompareButtonHtml\('samples', p, true\)/.test(INDEX));
check('dialog supports Escape, focus trapping, and focus restoration',
  /e\.key === 'Escape'[\s\S]*_thumbCompareClose\(\)/.test(INDEX) &&
  /e\.key !== 'Tab'/.test(INDEX) &&
  /trigger\.isConnected[\s\S]*trigger\.focus\(\)/.test(INDEX));
check('mobile comparison stacks previous and current vertically',
  /@media \(max-width: 720px\)[\s\S]*\.thumb-compare-grid \{ grid-template-columns: 1fr; \}/.test(INDEX));
check('comparison images use the short-lived URLs returned by the reader',
  /return String\(entry\.url \|\| entry\.media_url \|\| ''\)/.test(INDEX) &&
  !/_thumbCompareImageUrl[\s\S]{0,500}googleusercontent\.com/.test(INDEX));

console.log(failures === 0
  ? '\nAll thumbnail comparison UI checks passed.'
  : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
