'use strict';

/* B1-2 retirement guard for the former F44 legacy Submit sender. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
const removed = [
  '_submitLinearFormLegacy', '_submitLinearFormOnce', '_linearAwaitCreate',
  '_linearPayloadHash', '_linearReceiptStoreWrite', '_linearReceiptStoreRead',
  '_linearUuid', '_linearRestoreSubmitButtons', 'LINEAR_SUBMIT_TIMEOUT_MS',
  '_linearTargetForTeam', '_linearConfirmedCreate', '_linearConfirmedReceived',
  '_linearResponseParentId', '_linearSafeReceiptRef', '_linearReceiptFailure',
  '_linearCreateError', '_linearPrepareReceipts', '_linearApplyReceiptOutcomes',
  '_linearSelectedTeams', '_linearReceiptKey', '_linearRecoveryIdText',
  'VIDEO_FORM_WEBHOOK', 'GRAPHIC_FORM_WEBHOOK',
];
for (const symbol of removed) {
  assert(!new RegExp('\\b' + symbol + '\\b').test(source), symbol + ' must stay retired');
}
for (const symbol of ['_linearStableJson', '_linearCompareRemove', '_linearDraftSnapshot', 'LINEAR_RECEIPTS_KEY']) {
  assert(new RegExp('\\b' + symbol + '\\b').test(source), symbol + ' must remain for native hold/recovery');
}
const routedStart = source.indexOf('async function _submitLinearFormRoutedOnce(');
const routedEnd = source.indexOf('\n\n    async function ', routedStart + 1);
const routed = source.slice(routedStart, routedEnd);
assert(routedStart >= 0 && routed.includes("_linearHoldSubmission(mode, 'saved_legacy_receipt'"));
assert(routed.includes("_linearHoldSubmission(mode, 'legacy_receipt_read_failed'"));
assert(routed.includes("_linearHoldSubmission(mode, 'routing_helper_missing'"));
assert(routed.includes("_linearHoldSubmission(mode, 'native_routing_unavailable'"));
console.log('legacy Submit sender retirement checks passed');
