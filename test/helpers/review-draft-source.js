'use strict';
const assert = require('node:assert/strict');
module.exports = function reviewDraftSource(source) {
  const start = source.indexOf('    const REVIEW_DRAFT_PREFIX =');
  const end = source.indexOf('    const _calReviewState =', start);
  assert.ok(start > 0 && end > start, 'actual composer ownership helpers must exist');
  return source.slice(start, end);
};
