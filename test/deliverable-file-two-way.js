'use strict';
/*
 * The Deliverable file and the calendar's Video URL are one field with two
 * windows — and the sub-issue list can open it.
 *
 * OWNER, 2026-08-30: "each sub issue has a deliverable file which is a frame
 * link and this is the exact same link that there is on the social media
 * manager calendar, the thing that says video URL... So if a video editor puts
 * a deliverable file it should appear as the video URL on the content calendar,
 * and vice versa." And: "this is a link that people should be able to click on
 * when they are viewing the parent issue and they see the list of sub-issues."
 *
 * The editor-to-calendar direction is a database projection inside
 * production_artifact_write and is covered elsewhere. This file covers the two
 * halves that were missing.
 *
 * WHY THE REVERSE IS A READ AND NOT A WRITE. Giving the calendar a writer would
 * mean its save path writing a deliverable while the artifact path writes a
 * card: two transactions taking the same two row locks in opposite orders,
 * which deadlocks the first afternoon both happen at once. What the owner asked
 * for is that the link APPEAR in both places, and the calendar's copy already
 * IS the link — so the panel shows it, says where it came from, and the first
 * edit promotes it to canonical through the ordinary attach path, which
 * projects the same value straight back onto the card it came from.
 *
 * The load-bearing rule in both halves is that only the BOUND card may speak
 * for a deliverable. graphicsApprovalArtifactCandidate tolerates a blank
 * binding because it answers "does an artifact exist for this approval", where
 * a blank binding is old data. These answer "what file does this deliverable
 * have", where an unbound card is not evidence at all.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const GATEWAY = fs.readFileSync(
  path.join(ROOT, 'supabase', 'functions', 'production-write', 'index.ts'), 'utf8');
const UI = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

function grab(source, name) {
  const asyncAt = source.indexOf('async function ' + name + '(');
  const at = asyncAt >= 0 ? asyncAt : source.indexOf('function ' + name + '(');
  if (at < 0) throw new Error('function not found: ' + name);
  /* Find the BODY brace, not the first one. A TypeScript signature can carry
     an inline object type in its return position -- `Promise<{ url: string }
     | null>` -- and scanning from the first `{` after the name would balance
     inside that type and hand back the signature alone, which then passes
     nothing and fails everything. Every body opener in this file sits at the
     end of its line; an inline type brace never does. */
  let bodyAt = at;
  for (;;) {
    bodyAt = source.indexOf('{', bodyAt);
    if (bodyAt < 0) throw new Error('no body brace: ' + name);
    if (source[bodyAt + 1] === '\n') break;
    bodyAt += 1;
  }
  let depth = 0, quote = '', escaped = false, comment = '';
  for (let j = bodyAt; j < source.length; j++) {
    const c = source[j], next = source[j + 1];
    if (comment) {
      if (comment === 'line' && c === '\n') comment = '';
      else if (comment === 'block' && c === '*' && next === '/') { comment = ''; j++; }
      continue;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === quote) quote = '';
      continue;
    }
    if (c === '/' && next === '/') { comment = 'line'; j++; continue; }
    if (c === '/' && next === '*') { comment = 'block'; j++; continue; }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return source.slice(at, j + 1); }
  }
  throw new Error('unclosed ' + name);
}

/* ---- 1. Only the BOUND card speaks -------------------------------------- */

const bound = grab(GATEWAY, 'boundCardArtifact');
ok(/if \(clean\(card\[linkColumn\]\) !== deliverableId\) return null;/.test(bound),
  'a card whose deliverable id is not this one does not speak for it -- and neither does an UNBOUND card, '
  + 'because a blank binding fails the same equality');
ok(/\.eq\("client", clientSlug\)/.test(bound),
  'the card is looked up inside the deliverable client, so a same-id card of another client cannot answer');
ok(/team === "video" \? "asset_url" : "thumbnail_url"/.test(bound)
  && /team === "video" \? "video_deliverable_id" : "graphic_deliverable_id"/.test(bound),
  'video reads asset_url keyed on video_deliverable_id and graphics reads thumbnail_url keyed on graphic_deliverable_id '
  + '-- the same pairing the projection writes, read back the other way');
ok(/calendar: "calendar_posts"/.test(GATEWAY) && /samples: "sample_reviews"/.test(GATEWAY),
  'both card surfaces are covered, so a samples deliverable is not silently excluded');
ok(/if \(error\) throw new GatewayError\(503, "entity_lookup_unavailable"\);/.test(bound),
  'a lookup failure raises rather than collapsing into "no file", which would turn a blip into a false absence');

/* ---- 2. The borrowed value is never presented as the row own ------------ */

const snapshot = grab(GATEWAY, 'assetSnapshot');
ok(/let deliverableFile = clean\(deliverable\.file_url\);/.test(snapshot)
  && /if \(!deliverableFile\) \{/.test(snapshot),
  'the canonical file wins when the deliverable has one; the card is consulted only when it does not');
ok(/deliverableFileSource = bound\.surface === "samples" \? "samples_card" : "calendar_card";/.test(snapshot),
  'and the response says WHICH surface the borrowed link came from');

const panel = grab(UI, '_prodAssetsPanelHTML');
ok(/asset\.source === 'calendar_card' \|\| asset\.source === 'samples_card'/.test(panel),
  'the panel distinguishes a borrowed link from an owned one');
ok(/from the '\s*\+\s*\(asset\.source === 'samples_card' \? 'samples card' : 'content calendar'\)/.test(panel),
  'and names the surface in visible text, not only a tooltip -- a borrowed value presented silently '
  + 'would be the panel claiming a value it does not hold');

const ensure = grab(UI, '_prodEnsureAssets');
/* The vocabulary gained a fourth member on 2026-09-01 -- `client_plan`, the
   filming plan resolved from the client when the batch carries no copy -- and a
   fifth on 2026-09-05: `post`, a shared folder link the post holds on a batch
   row other than this one's. What this assertion is about is unchanged and is
   the reason it is written as a list plus a fallback rather than as "contains
   the three I know": the set is CLOSED, so a value this deploy has never heard
   of renders nothing instead of arbitrary server text on the page. */
ok(/\['deliverable','calendar_card','samples_card','client_plan','post'\]\s*\.includes\(String\(asset\.source \|\| ''\)\)/.test(ensure),
  'the browser accepts a closed vocabulary for the source, so a surprising value renders nothing rather than server text');
ok(/\?\s*String\(asset\.source\)\s*:\s*''/.test(ensure),
  'and an unrecognized source falls back to no source at all, rather than to the raw string');

/* ---- 3. The sub-issue file pill ----------------------------------------- */

const filesRead = grab(GATEWAY, 'handleBatchFilesRead');
ok(/if \(principal\.kind === "client"\) throw new GatewayError\(403, "asset_scope_forbidden"\)/.test(filesRead),
  'the pill read is staff-only');
ok(filesRead.indexOf('authenticate(') < filesRead.indexOf('.from("deliverables")'),
  'and authenticates the declared scope before resolving anything, like every other protected read here');
ok(/!staffAssetReadAllowed\(principal\.keyRole, principal\.memberTeam, team\)/.test(filesRead)
  && /continue;/.test(filesRead),
  'per-team read permission is applied per row, and a refused row is simply absent from the list');
ok(!/probeAssetUrl/.test(filesRead) && !/recordAssetEvidence/.test(filesRead),
  'it does NOT probe: a pill opens a link, it does not certify one, and probing every child would cost '
  + 'four outbound checks per sub-issue just to draw a list');
/* And it does not fan out serially either. The first version awaited
   boundCardArtifact per fileless child -- fourteen sequential round-trips on a
   fourteen-child post, which is the cost this read exists to avoid, handed
   straight back. Cards are fetched by id set, one query per surface, and
   matched in memory against the SAME binding rule. */
ok(!/await boundCardArtifact/.test(filesRead),
  'and it does not call the per-row card lookup in a loop');
ok(/\.in\("id", cardIds\)/.test(filesRead) && /const pendingCards/.test(filesRead),
  'fileless children are collected and resolved by id set, one query per surface');
ok(/if \(clean\(card\[linkColumn\]\) !== clean\(row\.id\)\) continue;/.test(filesRead),
  'and the batched path enforces the identical binding rule -- only the bound card may speak');
ok(/if \(cardError\) throw new GatewayError\(503, "entity_lookup_unavailable"\)/.test(filesRead),
  'a failed card lookup still raises rather than reading as a batch with nothing attached');
ok(/if \(!cardUrl\) continue;/.test(filesRead)
  && /if \(!card\) continue;/.test(filesRead),
  'a child with no file and no bound card contributes no entry, so the pill is absent rather than dead');

const row = grab(UI, '_prodSubIssueRowHTML');
ok(/const kFile = _prodBatchFileFor\(k\.id, k\);/.test(row) && /kFile\s*\n?\s*\?/.test(row),
  'the row renders a pill only when that sub-issue actually has a file');
ok(/onclick="event\.stopPropagation\(\);"/.test(row),
  'and the pill does not also open the sub-issue, which the row click already does');
ok(/target="_blank" rel="noopener noreferrer"/.test(row),
  'the pill opens the file in a new tab without handing it a window reference');

/* ---- 3b. The page must not ask for a read this deploy does not have ----
 *
 * Caught by CI, not by review: the live polish lane went green -> red the
 * moment this read shipped, on two suites, both `error_generic`. The browser
 * reaches main through Pages the instant a PR merges and the gateway is
 * deployed by hand afterwards, so the page is routinely NEWER than the
 * function. For a write that window is harmless -- every layer fails closed and
 * the control is refused with a reason. For a read it is not: the deployed
 * gateway answered 400 unsupported_action on every parent open, which is a
 * failed request in the console, the network panel, and the audit, for a
 * feature that was merely not deployed yet.
 *
 * asset_access_read runs first on every detail open, so it announces what this
 * deploy can serve and the page asks for nothing else. An absent field means an
 * older deploy, which is exactly the case to stay quiet for.
 */
ok(/const ASSET_READ_CAPABILITIES = Object\.freeze\(\["batch_files_read"\]\);/.test(GATEWAY),
  'the gateway announces the reads it can serve');
const assetRead = grab(GATEWAY, 'handleAssetAccessRead');
ok(/capabilities: ASSET_READ_CAPABILITIES,/.test(assetRead),
  '...on the read the browser already makes for every detail, so detection costs no extra request');

const ensureFiles = grab(UI, '_prodEnsureBatchFiles');
ok(/if \(!_prodState\.gatewayReads \|\| !_prodState\.gatewayReads\.has\('batch_files_read'\)\) return null;/.test(ensureFiles),
  'and the page asks for the pill links ONLY after the gateway said it can answer');
ok(ensureFiles.indexOf('gatewayReads') < ensureFiles.indexOf('fetch('),
  '...before the request, so a page ahead of its gateway makes no doomed call at all');
ok(/gatewayReads: null,/.test(UI),
  'the unknown state is null rather than an empty set, so "not asked yet" is not confused with "answered nothing"');
ok(/if \(current && current\.generation === generation\) return current;/.test(ensureFiles),
  'the pill links are asked for once per batch per projection generation, not once per render');
/* Keyed by batch AND scope since 2026-09-05. The read is answered per
   (batch_id, client_slug) and the gateway refuses a mismatch with a flat 403,
   so a key of batch id alone lets one scope's answer -- or one scope's refusal
   -- stand in for another's. Harmless while this was asked once per open row;
   not once it is asked once per batch row of a post. */
ok(/const statusKey = batchId \+ '\\u0000' \+ clientSlug;/.test(ensureFiles),
  '...and keyed by the SCOPE as well as the batch, so two rows declaring different scopes for one batch cannot inherit each other\'s answer or refusal');
ok(/if \(generation !== _prodState\.projectionGeneration\) return null;/.test(ensureFiles),
  'and a response that lands after a projection swap is dropped rather than painted');
ok(/if \(!staffIdentity\) return null;/.test(ensureFiles),
  'without staff sign-in it asks for nothing at all');

/* THE PILLS FOLLOW THE POST, NOT THE OPEN ROW'S BATCH (2026-09-05).
   batch_files_read answers `deliverables where batch_id = <one id>`, and the
   render loop asked only for the open parent's own batch. On a post whose
   children sit on another batch row -- 44 of 1,138 measured live -- the
   response carried the parent alone, _prodBatchFileFor found no entry for any
   sub-issue, and every pill was omitted. The owner reported this as pills that
   had stopped appearing; they had never appeared for these posts, and did for
   the other 1,027. The common case still makes exactly one request. */
const renderLoop = UI.slice(UI.indexOf('The file pills on the sub-issue list'));
ok(/_prodPostRows\(openIssue\)\.forEach\(row => \{/.test(renderLoop.slice(0, 2400)),
  'the pill links are asked for across every batch row the POST occupies, so a sub-issue on a different batch row than its parent still gets one');
ok(/if \(!rowBatchId \|\| asked\.has\(rowBatchId\)\) return;/.test(renderLoop.slice(0, 2400)),
  'each distinct batch row is asked for once, so a post that sits on one row -- the overwhelming majority -- pays exactly what it paid before');
ok(/row\.authorityProject \|\| row\.storedClientSlug/.test(renderLoop.slice(0, 2400)),
  "and each request declares the scope of the row that NAMES that batch, since the gateway pins on client_slug and answers a mismatch with a flat 403");
ok(/scope === PROD_ATTRIBUTION_NEEDS[\s\S]{0,80}scope === PROD_ATTRIBUTION_CONFLICT/.test(renderLoop.slice(0, 3600)),
  'and a row carrying an attribution SENTINEL is skipped rather than asked about -- that slug is a guaranteed 403, and a request whose refusal is already known is a failed call for an answer nobody gains');

const invalidate = grab(UI, '_prodInvalidateScopedReads');
ok(/_prodState\.batchFilesStatus\.clear\(\);/.test(invalidate)
  && !/_prodState\.batchFiles\.clear\(\);/.test(invalidate),
  'a projection swap drops the pill STATUS so the parent re-asks, and keeps the entries so the pills stay up while it does (2026-09-05)');
const pillFor = grab(UI, '_prodBatchFileFor');
ok(/String\(live\.batchId \|\| ''\)\.trim\(\) !== entry\.batchId\) return null;/.test(pillFor)
  && /scope !== entry\.scope\) return null;/.test(pillFor),
  'and a kept pill is refused at USE time for a row that left its batch or changed scope, which is what makes keeping it safe');

/* The pill glyph must stay out of the locked artifact icon set. */
ok(/const PROD_FILE_LINK_ICON = /.test(UI)
  && !/link: _prodRawIcon|link: '<svg/.test(UI.slice(UI.indexOf('const PROD_ICON = {'), UI.indexOf('const PROD_REFRESH_ICON'))),
  'the pill glyph lives outside PROD_ICON, which test/port-fidelity-check.js holds byte-identical to the artifact');

console.log(failures === 0
  ? '\nDeliverable-file two-way checks passed'
  : '\n' + failures + ' two-way check(s) failed');
process.exit(failures === 0 ? 0 : 1);
