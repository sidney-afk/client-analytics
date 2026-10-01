'use strict';
// filming-plan-docs-write Edge Function (docs/plans/2026-09-30-n8n-exit-phase-2.md, step E):
// the pure logic under Node plus static wiring checks on the handler and the
// deploy lane. Nothing here touches a network.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const HANDLER = read('supabase/functions/filming-plan-docs-write/index.ts');
const LANE = read('.github/workflows/deploy-single-function.yml');
const ID = 'd'.repeat(44);
let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };

(async () => {
  const W = await import(path.join(ROOT, 'supabase/functions/filming-plan-docs-write/docswrite.mjs'));
  const good = [
    { insertText: { location: { index: 1 }, text: 'hello' } },
    { updateParagraphStyle: { range: { startIndex: 1, endIndex: 6 }, paragraphStyle: {}, fields: 'x' } },
    { updateTextStyle: { range: { startIndex: 1, endIndex: 6 }, textStyle: {}, fields: 'x' } },
    { replaceAllText: { containsText: { text: 'a' }, replaceText: 'b' } },
  ];

  // --- body parsing ---
  const parsed = W.parseWriteBody({ documentId: ID, requests: good });
  ok(parsed.documentId === ID && parsed.requests.length === 4, 'a valid body passes through unchanged');
  ok(W.parseWriteBody(null).error === 'invalid_body', 'null body refused');
  ok(W.parseWriteBody([]).error === 'invalid_body', 'array body refused');
  ok(W.parseWriteBody({ requests: good }).error === 'document_required', 'missing document refused');
  ok(W.parseWriteBody({ documentId: 'short', requests: good }).error === 'invalid_doc_id', 'short id refused');
  ok(W.parseWriteBody({ documentId: ID + '/../x', requests: good }).error === 'invalid_doc_id', 'path tricks in the id refused');
  ok(W.parseWriteBody({ documentId: ID }).error === 'requests_required', 'missing requests refused');
  ok(W.parseWriteBody({ documentId: ID, requests: [] }).error === 'requests_required', 'empty requests refused');
  ok(W.parseWriteBody({ documentId: ID, requests: new Array(W.MAX_REQUESTS + 1).fill(good[0]) }).error === 'too_many_requests', 'over the cap refused');
  ok(!W.parseWriteBody({ documentId: ID, requests: new Array(W.MAX_REQUESTS).fill(good[0]) }).error, 'exactly the cap passes');
  const del = W.parseWriteBody({ documentId: ID, requests: [good[0], { deleteContentRange: { range: { startIndex: 1, endIndex: 9 } } }] });
  ok(del.error === 'request_kind_not_allowed' && del.kind === 'deleteContentRange', 'a request that could delete content is refused by name');
  ok(W.parseWriteBody({ documentId: ID, requests: [{ insertText: {}, updateTextStyle: {} }] }).error === 'invalid_request', 'two kinds in one request refused');
  ok(W.parseWriteBody({ documentId: ID, requests: ['x'] }).error === 'invalid_request', 'a non object request refused');
  ok(JSON.stringify(W.ALLOWED_REQUEST_KINDS) === JSON.stringify(['insertText', 'updateParagraphStyle', 'updateTextStyle', 'replaceAllText']), 'only the four kinds the pipeline sends are allowed');

  // --- ownership ---
  const other = 'e'.repeat(44);
  ok(W.isOwnedDoc(ID, [ID], []) === true, 'a registered filming plan Doc is owned');
  ok(W.isOwnedDoc(ID, [], [ID]) === true, 'an extra listed Doc is owned');
  ok(W.isOwnedDoc(ID, [other], [other]) === false, 'any other Doc is not owned');
  ok(JSON.stringify(W.parseExtraDocIds(' ' + ID + ' , nope ,' + other)) === JSON.stringify([ID, other]), 'extra ids are trimmed and bad ones dropped');
  ok(W.parseExtraDocIds(undefined).length === 0, 'no extra secret means none');

  // --- handler wiring ---
  ok(/authorizeStaffKey\(supplied, \["admin", "smm", "creative"\]/.test(HANDLER), 'staff key required');
  ok(HANDLER.indexOf('requireStaff(req)') < HANDLER.indexOf('req.text()'), 'sign-in is checked before the body is read');
  ok(HANDLER.includes('req.method !== "POST"'), 'POST only');
  ok(HANDLER.includes('"https://www.googleapis.com/auth/documents"') && !HANDLER.includes('documents.readonly'), 'write scope, not read only');
  ok(HANDLER.indexOf('registry_unavailable') > 0 && HANDLER.indexOf('registry_unavailable') < HANDLER.indexOf('serviceAccountToken(creds)'), 'a failed registry read holds the write before any Google call');
  ok(HANDLER.indexOf('doc_not_registered') < HANDLER.indexOf(':batchUpdate'), 'an unregistered Doc is refused before Google is called');
  ok(!/n8n/i.test(HANDLER.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n')), 'no call or fallback to n8n inside the function');
  ok(!/private_key\s*[:=]\s*"-----/.test(HANDLER) && !/Bearer [A-Za-z0-9]{20,}/.test(HANDLER), 'no key value in the source');
  ok(HANDLER.includes('share_with') && !/share_with:\s*creds\.key/.test(HANDLER), 'share_with is the account email only');

  // --- deploy lane ---
  ok(/options: \[[^\]]*filming-plan-docs-write[^\]]*\]/.test(LANE), 'on the dispatch menu');
  ok(/\|filming-plan-docs-write\|/.test(LANE) || /case "\$DEPLOY_FUNCTION" in\s+[^\n]*filming-plan-docs-write/.test(LANE), 'on the allowlist case');
  ok(/for fn in [^;]*filming-plan-docs-write/.test(LANE), 'in the deploy loop');
  ok(/no-verify-jwt/.test(LANE), 'lane deploys with --no-verify-jwt like the other staff key functions');

  console.log('filming-plan-docs-write-source: ' + checks + ' checks passed ✅');
})().catch((e) => { console.error(e); process.exit(1); });
