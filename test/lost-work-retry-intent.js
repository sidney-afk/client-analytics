'use strict';
/*
 * OPEN_REPAIRS 314, item 1: a Calendar Retry never resends an older status.
 *
 * Source-shape checks (offline). The behaviour itself is proven in a browser by
 * docs/syncview-design/tests/lost-work-retry-intent-browser.js (fully mocked).
 *   - a failed save that rolled a field back keeps the person's change;
 *   - Retry sends that change, and when it cannot be recovered sends nothing and says so;
 *   - the kept change never goes out on the wire by accident;
 *   - Samples already retries the retained edits and refuses when they are missing.
 */
const fs = require('fs');
const path = require('path');
const { stripComments } = require('./helpers/strip-comments');
const ROOT = path.resolve(__dirname, '..');
const cal = stripComments(fs.readFileSync(path.join(ROOT, 'src/index/170-calendar-links-status.js.part'), 'utf8'));
const sxr = stripComments(fs.readFileSync(path.join(ROOT, 'src/index/280-samples-cards-notes.js.part'), 'utf8'));
let failures = 0;
const ok = (c, m) => { console.log((c ? '  ok  ' : 'FAIL  ') + m); if (!c) failures++; };

const retry = (cal.match(/function _calRetrySave\(pid\) \{[\s\S]*?\n    \}\n/) || [''])[0];
ok(retry.length > 200, 'Calendar _calRetrySave found');
ok(/_calFailedIntentLabel/.test(retry) && /_calUsableFailedIntent\(post\)/.test(retry), 'Retry looks for the kept change first');
ok(/_calRefuseLostIntent\(post\); return;/.test(retry), 'Retry returns without sending when the change is unrecoverable');
ok(/_calReviewBlockReason\(post, c, chosen\)/.test(retry), 'Retry goes through the same content rule as the pick');
ok(/if \(k in bucket\) continue;/.test(retry), 'a newer pick in the queue wins over the kept one');
ok(/_calPriorStatus\[k\] = post\[k\]/.test(retry), 'a second failure rolls back to the shown value, not to something older');
const refuse = (cal.match(/function _calRefuseLostIntent\(post\) \{[\s\S]*?\n    \}\n/) || [''])[0];
ok(/showNotify\('Nothing was sent'/.test(refuse) && /You chose ' \+ label/.test(refuse), 'the refusal names what the person chose');
ok(!/_calFlushCardSave|_calUpsertFetch/.test(refuse), 'the refusal path cannot send');
ok(/function _calKeepFailedIntent/.test(cal) && /_calKeepFailedIntent\(cur, edits\);/.test(cal), 'the failed save keeps the change where it rolls the field back');
ok(/CAL_FAILED_INTENT_MAX_AGE_MS = 6 \* 60 \* 60 \* 1000/.test(cal), 'a kept change older than 6 hours is not trusted');
ok(/delete wirePost\._calFailedIntent;/.test(cal) && /delete wirePost\._calFailedIntentLabel;/.test(cal), 'the kept change is stripped from the whole-card payload');
ok(/_calSupersedeFailedIntent\(post, edits\);/.test(cal), 'a newer save of the same field drops the older kept change');
ok(/_calRestoreFailedIntentChip\(_okPost\);/.test(cal), 'an unrelated successful save keeps the Retry chip for the unsent change');
// Samples: the retained edits are kept even when nothing committed, and a missing record refuses.
ok(/cur\._writeUiRetryEdits = Object\.assign\(\{\}, edits\);/.test(sxr) && /if \(!gatewayCommitted\) _SXR_ROLLBACK_FIELDS/.test(sxr), 'Samples keeps the failed edit set after rolling back');
ok(/Retry details are missing\. Refresh this card and make the edit again\./.test(sxr), 'Samples refuses a Retry whose details are missing');

if (failures) { console.error('\nlost-work-retry-intent: ' + failures + ' FAILED'); process.exit(1); }
console.log('\nlost-work-retry-intent: all checks passed');
