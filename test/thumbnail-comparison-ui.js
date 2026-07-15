'use strict';
/* Previous/current thumbnail comparison UI wiring and disclosure boundary. */
const fs = require('fs');
const path = require('path');

const INDEX = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');

function grabFunc(name) {
  const at = INDEX.indexOf('function ' + name + '(');
  if (at < 0) throw new Error('function not found: ' + name);
  let depth = 0;
  for (let i = INDEX.indexOf('{', at); i < INDEX.length; i++) {
    if (INDEX[i] === '{') depth++;
    else if (INDEX[i] === '}') {
      depth--;
      if (depth === 0) return INDEX.slice(at, i + 1);
    }
  }
  throw new Error('unbalanced function: ' + name);
}

let failures = 0;
function check(label, condition) {
  if (condition) console.log('  ok  ' + label);
  else { console.log('FAIL  ' + label); failures++; }
}

const buttonHtml = grabFunc('_thumbCompareButtonHtml');
const watchedPost = grabFunc('_thumbCompareWatchedPost');
const eligiblePost = grabFunc('_thumbCompareEligiblePost');
const discover = grabFunc('_thumbCompareDiscoverAvailability');
const openCompare = grabFunc('_thumbCompareOpen');
const renderPair = grabFunc('_thumbCompareRenderPair');
const paneHtml = grabFunc('_thumbComparePaneHtml');
const ensureOverlay = grabFunc('_thumbCompareEnsureOverlay');
const refreshChangedCards = grabFunc('_thumbRefreshChangedCards');

check('comparison reader uses the protected Edge Function',
  /const THUMBNAIL_REVISION_READ_EF_URL = CAL_SUPABASE_URL \+ '\/functions\/v1\/thumbnail-revision-read'/.test(INDEX));
check('comparison discovery considers only watched single-Drive thumbnails',
  /_calIsFolderLink\(thumbnailUrl\)[\s\S]*_calDriveFileId\(thumbnailUrl\)/.test(watchedPost));
check('Tweaks Needed never exposes a prior cycle during async baseline capture',
  /graphic_status[\s\S]*toLowerCase\(\) !== 'tweaks needed'/.test(eligiblePost) &&
  /!client \|\| !_thumbCompareEligiblePost\(post\)[\s\S]*_thumbCompareRefreshSlots/.test(openCompare) &&
  /if \(!_thumbCompareWatchedPost\(post\)\) return ''/.test(grabFunc('_thumbCompareSlotHtml')));
check('focused-field deferred refresh keeps history-only icon state truthful',
  /_thumbCompareVersion\(old\) !== _thumbCompareVersion\(post\)[\s\S]*comparisonChanged = true/.test(refreshChangedCards) &&
  /if \(comparisonChanged\)[\s\S]*_thumbCompareRefreshSlots\(surface, client\)[\s\S]*_thumbCompareScheduleAvailability\(surface\)/.test(refreshChangedCards));
check('unknown, unavailable, and stale-version icons remain hidden',
  /!known \|\| known\.available !== true \|\| known\.version !== _thumbCompareVersion\(post\)[\s\S]*return ''/.test(buttonHtml) &&
  /thumbnail_url[\s\S]*thumb_rev[\s\S]*graphic_status/.test(grabFunc('_thumbCompareVersion')));
check('availability is one bounded ID-only batch, never a signed-image prefetch',
  /offset \+= 50/.test(discover) &&
  /mode: 'availability', source_ids: sourceIds/.test(discover) &&
  /available_source_ids/.test(discover) &&
  !/source_id: state\.pid/.test(discover) &&
  !/_thumbCompareRenderPair/.test(discover));
check('a stale availability response cannot reveal an icon for newer card state',
  /requestedVersion = candidates\.get\(pid\)[\s\S]*_thumbCompareVersion\(post\) !== requestedVersion[\s\S]*return/.test(discover) &&
  /completed = true[\s\S]*if \(completed\) _thumbCompareScheduleAvailability\(surface\)/.test(discover));
check('exact comparison request remains click-only, scoped, and cache bypassed',
  /cache: 'no-store'[\s\S]*JSON\.stringify\(\{ surface: state\.surface, client: state\.client, source_id: state\.pid \}\)/.test(grabFunc('_thumbCompareLoad')));
check('staff without a verified identity is prompted before an exact history read',
  /if \(!_isClientLink && !_syncviewStaffIdentityForHeaders\(\)\)[\s\S]*_syncviewOpenStaffIdentity\(\{ reason: 'required' \}\)/.test(grabFunc('_thumbCompareOpen')));
check('Calendar and Samples put history beside the thumbnail folder action',
  /const compareSlot = isThumb \? _thumbCompareSlotHtml\('calendar', post, false, 'link'\)/.test(INDEX) &&
  /const compareSlot = isThumb \? _thumbCompareSlotHtml\('samples', post, false, 'link'\)/.test(INDEX) &&
  /\$\{folderBtn\}\s*\$\{compareSlot\}\s*<button type="button" class="cal-link-edit"/.test(INDEX));
check('organizer footer is Notes-only while Review retains history-only access',
  !/_thumbCompareButtonHtml\('calendar', p, false\)/.test(INDEX) &&
  !/_thumbCompareButtonHtml\('samples', p, false\)/.test(INDEX) &&
  /_thumbCompareSlotHtml\('calendar', p, true, 'review'\)/.test(INDEX) &&
  /_thumbCompareSlotHtml\('samples', p, true, 'review'\)/.test(INDEX));
check('successful comparison contains only Previous/Current labels and images',
  /_thumbComparePaneHtml\('Previous'/.test(renderPair) &&
  /_thumbComparePaneHtml\('Current'/.test(renderPair) &&
  !/Change captured|Detected|detectedAt|status-pill/.test(renderPair) &&
  !/<time|modified_at|captured_at/.test(paneHtml));
check('dialog removes visible heading copy but keeps an accessible name',
  /aria-label="Previous and current thumbnail comparison"/.test(ensureOverlay) &&
  !/thumb-compare-eyebrow|thumbCompareTitle|thumbCompareSubtitle|See the version captured/.test(ensureOverlay));
check('successful images enlarge to the comparison viewport without inner boxes',
  /\.thumb-compare-dialog \{[^}]*width: min\(1280px, 96vw\)/.test(INDEX) &&
  /\.thumb-compare-image-wrap \{[^}]*height: min\(76vh, 720px\)/.test(INDEX) &&
  /\.thumb-compare-image-wrap img \{[^}]*width: 100%; height: 100%; object-fit: contain/.test(INDEX) &&
  /\.thumb-compare-pane \{ min-width: 0; margin: 0; \}/.test(INDEX));
check('dialog supports Escape, focus trapping, and focus restoration',
  /e\.key === 'Escape'[\s\S]*_thumbCompareClose\(\)/.test(INDEX) &&
  /e\.key !== 'Tab'/.test(INDEX) &&
  /trigger\.isConnected[\s\S]*trigger\.focus\(\)/.test(INDEX));
check('mobile comparison stacks previous and current vertically',
  /@media \(max-width: 720px\)[\s\S]*\.thumb-compare-grid \{ grid-template-columns: 1fr; \}/.test(INDEX));
check('comparison images use only short-lived URLs returned by the exact reader',
  /return String\(entry\.url \|\| entry\.media_url \|\| ''\)/.test(INDEX) &&
  !/_thumbCompareImageUrl[\s\S]{0,500}googleusercontent\.com/.test(INDEX));

console.log(failures === 0
  ? '\nAll thumbnail comparison UI checks passed.'
  : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
