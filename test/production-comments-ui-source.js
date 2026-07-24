'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
let failures = 0;
function ok(value, label) {
  if (value) console.log('  ok  ' + label);
  else { failures++; console.error('FAIL  ' + label); }
}
function extract(name) {
  const start = source.indexOf(`function ${name}`);
  if (start < 0) throw new Error(`missing ${name}`);
  const brace = source.indexOf('{', start);
  let depth = 0, quote = '', escaped = false;
  for (let i = brace; i < source.length; i++) {
    const ch = source[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`unclosed ${name}`);
}

const context = {
  result: null,
  _prodHashText(text) {
    let h = 0;
    for (const ch of String(text || '')) h = ((h << 5) - h + ch.charCodeAt(0)) | 0;
    return Math.abs(h);
  },
};
vm.createContext(context);
vm.runInContext([
  extract('_prodCommentTruthy'),
  extract('_prodCommentNormalize'),
  extract('_prodCommentMerge'),
  `result = _prodCommentMerge([
    { id:'edit', author_name:'Before', body:'old', source_created_at:'2026-07-01T00:00:00Z', source_updated_at:'2026-07-01T00:00:00Z' },
    { id:'delete', author_name:'Before', body:'body must vanish', source_created_at:'2026-07-02T00:00:00Z' },
    { id:'ingestion', author_name:'Backfill', body:'not edited', source_created_at:'2026-07-02T01:00:00Z', source_updated_at:'2026-07-02T01:00:00Z', updated_at:'2026-07-10T00:00:00Z' },
    { id:'client', author_name:'Client', body:'visible', audience:'client' },
    { id:'internal', author_name:'Staff', body:'visible', audience:'internal' }
  ], [
    { id:'edit', author_name:'After', body:'new', source_created_at:'2026-07-01T00:00:00Z', source_updated_at:'2026-07-01T00:05:00Z', edited_at:'2026-07-01T00:05:00Z' },
    { id:'delete', author_name:'Before', body:'new deleted secret', source_created_at:'2026-07-02T00:00:00Z', deleted_at:'2026-07-02T00:05:00Z' },
    { id:'hidden', author_name:'Hidden', body:'hidden body', hidden:true }
  ]);`,
].join('\n'), context);

const rows = context.result;
ok(rows.filter(row => row.id === 'edit').length === 1 && rows.find(row => row.id === 'edit').body === 'new', 'stable-id page merge replaces edits');
ok(rows.find(row => row.id === 'edit').edited === true, 'source edit timestamp renders edited state');
ok(rows.find(row => row.id === 'delete').deleted === true && rows.find(row => row.id === 'delete').body === '', 'deleted timestamp erases body before caching/rendering');
ok(rows.find(row => row.id === 'ingestion').edited === false, 'database ingestion updated_at does not imply a source edit');
ok(!rows.some(row => row.id === 'hidden'), 'hidden comments never enter render set');
ok(rows.some(row => row.audience === 'client') && rows.some(row => row.audience === 'internal'), 'staff keeps both audiences');
ok(/PROD_COMMENTS_PAGE_SIZE\s*=\s*50/.test(source), 'page size is 50');
ok(/\/functions\/v1\/production-comments/.test(source), 'protected Production comments endpoint is used');
ok(/deliverable_id: id,[\s\S]{0,120}limit: PROD_COMMENTS_PAGE_SIZE,[\s\S]{0,120}before: cursor \|\| null/.test(source), 'request posts the opaque before cursor');
ok(/candidateCursor\.created_at[\s\S]*candidateCursor\.id/.test(source), 'response preserves created_at/id cursor object');
ok(/Authorization:\s*'Bearer '\s*\+\s*CAL_SUPABASE_ANON_KEY/.test(source) && /_syncviewEfHeaders/.test(source), 'request combines anon EF routing with verified staff headers');
ok(/data-prod-comments-state="signin"/.test(source) && /data-prod-comments-state="error"/.test(source) && /data-prod-comments-state="empty"/.test(source), 'sign-in error and empty states are explicit');
ok(/function refresh\(id\)[\s\S]*current\.status === 'loading' \|\| current\.refreshing[\s\S]*load\(id, \{ force: true, refresh: true \}\)/.test(source), 'refresh deduplicates an initial or in-flight revalidation');
ok(/_prodComments\.ensure\(id\);\s*_prodComments\.refresh\(id\);/.test(source), 'reopening an issue revalidates its comments');
ok(/_prodState\.view === 'detail' && _prodState\.openId\) _prodComments\.refresh\(_prodState\.openId\)/.test(source), 'normal Production refresh revalidates the open thread');
ok(/preserveDeepCursor \? current\.cursor : nextCursor/.test(source) && /priorPages > 1/.test(source), 'newest-page refresh preserves the deepest loaded pagination cursor');
ok(/\(append \|\| refreshing\) && current \? current\.items : \[\]/.test(source), 'newest-page refresh merges into already-loaded comments');
ok(/Load older comments/.test(source), 'older-page control is rendered');
ok(/c\.parent_id \? ' is-reply' : ''/.test(source), 'replies receive indentation');
ok(/c\.deleted \? 'Comment deleted\.' : _prodLinkify\(c\.body\)/.test(source), 'tombstones cannot render deleted bodies');
ok(/prod-comment-edited/.test(source) && /prod-comment-pill">Resolved/.test(source), 'edited and resolved states render');
ok(/target="_blank" rel="noopener noreferrer"/.test(source), 'linkified bodies isolate new tabs');
ok(/function _prodComposerHTML\(issue\)/.test(source)
  && /_prodCanWrite\(issue, 'comment'\)/.test(source)
  && /data-prod-comment-form/.test(source)
  && /data-prod-disabled=\\?"composer/.test(source),
  'composer renders only behind the team authority gate and keeps an explicit read-only state');
const issueClientSurface = extract('_prodIssueClientCommentSurfaceKnown');
const verifiedClientContext = extract('_prodVerifiedClientCommentSurfaceContext');
const sxrCommentsForView = extract('_sxrCommentsForView');
ok(/row\.origin[\s\S]*=== 'samples'/.test(issueClientSurface)
  && /row\.card_id/.test(issueClientSurface)
  && /_prodIssueClientCommentSurfaceKnown\(issue\)/.test(source),
'staff Client-visible is offered only from durable exact Samples card linkage');
ok(/cap\.verified/.test(verifiedClientContext)
  && /cap\.view !== 'sample-reviews'/.test(verifiedClientContext)
  && /mountedSlug !== String\(cap\.slug/.test(verifiedClientContext)
  && /_writeUiNativeId\(post, component\)/.test(verifiedClientContext)
  && /source_surface: 'sxr'/.test(verifiedClientContext),
'verified client SXR context binds capability, slug, card component and canonical deliverable');
ok(/rawPage\.filter\(row => row[\s\S]*row\.audience[\s\S]*=== 'client'/.test(source)
  && /!canonicalGate\.linked \|\| !canonicalGate\.ready \|\| !canonicalGate\.client/.test(sxrCommentsForView),
'client UI drops internal rows and never falls back to linked legacy card arrays');
ok(!/json\.client_surface_canonical/.test(source)
  && !/clientReaderVerified/.test(source),
'endpoint self-attestation cannot unlock Client-visible');
ok(!/localStorage[^\n]{0,120}comment/i.test(source.slice(source.indexOf('const _prodComments'), source.indexOf('function _prodDescriptionHTML'))), 'comment bodies are not persisted to localStorage');
const cardCommit = extract('_writeUiCommitCardCommentLifecycle');
const cardLifecycle = extract('_writeUiCardCommentLifecycle');
const cardRetry = extract('_writeUiRetryCardCommentAction');
ok(/await _prodComments\.readCanonical/.test(cardCommit)
  && /await _prodProjectCanonicalCardComments/.test(cardCommit)
  && /const refreshed = _prodComments\.find/.test(cardCommit)
  && /failure\.expectedVersion = Number\(refreshed\.version\)/.test(cardCommit)
  && /failure\.expectedUpdatedAt = String\(refreshed\.row_updated_at\)/.test(cardCommit)
  && /failure\.currentBody = String\(refreshed\.body/.test(cardCommit)
  && /failure\.rebased = true/.test(cardCommit),
'Calendar/Samples second-device conflicts rebase the preserved edit onto the refreshed exact comment');
ok(/retryCursor && retryCursor\.rebased === true/.test(cardLifecycle)
  && /retryCursor\.expectedVersion/.test(cardLifecycle)
  && /retryCursor\.expectedUpdatedAt/.test(cardLifecycle)
  && /comment-' \+ action, \[nativeId, comment\.id, version, updatedAt\]/.test(cardLifecycle)
  && /_calRetryCommentEdit\(failure\.commentId, failure\.body, failure\)/.test(cardRetry)
  && /_sxrRetryCommentEdit\(failure\.commentId, failure\.body, failure\)/.test(cardRetry),
'Calendar/Samples retry uses the refreshed CAS cursor and therefore a fresh lifecycle intent identity');
ok(/A newer version was loaded\. Your draft was preserved; Retry applies it to the current comment\./.test(source),
'conflict copy tells the user the newer version is loaded and the preserved draft will apply to current state');

if (failures) {
  console.error(`\n${failures} Production comment UI source check(s) failed`);
  process.exit(1);
}
console.log('\nProduction comment UI source checks passed');
