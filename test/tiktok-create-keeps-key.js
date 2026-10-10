'use strict';
/*
 * REGRESSION GUARD: a TikTok create answer that leaves the post possibly made
 * keeps its key, so pressing Submit again finishes that same post instead of
 * making a second one (OPEN_REPAIRS 404, Digger bug archaeology 2026-10-10;
 * the Instagram twin was corrected for the same answer in 384 item 2).
 *
 * Run:  node --require ./test/helpers/single-file-index.js test/tiktok-create-keeps-key.js
 *
 * tiktok-upload stores a Post For Me timeout or 5xx as a failed row and answers
 * HTTP 200 {ok:false, row:{status:'failed'}}, though Post For Me may have taken
 * the post. The page treated that as a clear answer and dropped the key; the
 * next Submit minted a new one and the function could not adopt the first post.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { extractFunction, stripNonCode } = require('./helpers/extract-function.js');

const INDEX = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const keeps = new Function(`${extractFunction(INDEX, '_tkCreateAnswerKeepsKey')}\nreturn _tkCreateAnswerKeepsKey;`)();

assert.strictEqual(keeps({ ok: false, status: 200, json: { ok: false, error: 'Post For Me answered 0', row: { status: 'failed' } } }), true,
  'HTTP 200 with a failed row (a Post For Me timeout stored as failed) keeps the key');
assert.strictEqual(keeps({ ok: false, status: 502, json: { ok: false } }), true, 'a 5xx keeps the key');
assert.strictEqual(keeps({ ok: false, status: 0, json: null }), true, 'no answer keeps the key');
assert.strictEqual(keeps({ ok: false, status: 400, json: { ok: false, error: 'bad' } }), false, 'a 4xx is a clear refusal: a new key next time');
assert.strictEqual(keeps({ ok: false, status: 409, json: { ok: false } }), false, 'so is a 409');
assert.strictEqual(keeps({ ok: true, status: 200, json: { ok: true } }), false, 'a success needs no retry key');

const create = stripNonCode(extractFunction(INDEX, '_tkCreateViaFunction'));
assert.ok(/tkState\.retryCreate = _tkCreateAnswerKeepsKey\(out\) \? ambiguous : null;/.test(create),
  'the create flow keeps the attempt exactly when that rule says so');
assert.ok(!/out\.status >= 500 \|\| !out\.json/.test(create), 'the old rule (only a 5xx or no JSON keeps the key) is gone');

// The message fits the answer. Post For Me answering "failed" may be a real
// refusal (the person must change something) or a timeout stored the same way,
// so that case names both; only a 5xx or no answer says plainly to press again.
const answeredBranch = /if \(tkState\.retryCreate && answered\) \{([\s\S]*?)\} else if \(tkState\.retryCreate\) \{([\s\S]*?)\}/.exec(extractFunction(INDEX, '_tkCreateViaFunction'));
assert.ok(answeredBranch, 'a "failed" answer from Post For Me gets its own message');
assert.ok(/If that names something to change, change it and submit again\. If not, press Submit again without changing anything/.test(answeredBranch[1]),
  'after a "failed" answer the person is told to fix what it names, or press again unchanged if it names nothing');
assert.ok(/Press Submit again without changing anything/.test(answeredBranch[2]), 'after a 5xx or no answer, pressing again unchanged is the advice');

console.log('tiktok-create-keeps-key: a possibly-made TikTok post keeps its key, so Submit again cannot post twice ✅');
