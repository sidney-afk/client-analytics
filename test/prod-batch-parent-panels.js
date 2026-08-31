'use strict';
/*
 * Owner observations from live testing, 2026-08-30 (SyncLinear / ?prod=1).
 *
 * 1. A batch parent showed "Filming Plan: https://docs.google.com/..." as a live
 *    link in its Description while its own Assets grid called all four rows
 *    "Not provided / Missing", and its child resolved the same plan correctly.
 *
 *    VID-13663 is not a real issue: it is a SYNTHETIC node minted from the
 *    `batches` row. Its grid is populated from batches.filming_doc_url /
 *    footage_folder_url / delivery_folder_url -- three columns the f34/f53
 *    migration deliberately revoked from the browser grant, and which
 *    PROD_BATCH_SELECT therefore never asks for. They arrive undefined on every
 *    synthetic parent, so `String(undefined || '')` makes them '' and the panel
 *    prints Missing. The child is right because it reads the SAME batch row
 *    through a service-role edge function. Nothing is missing in the data; two
 *    readers with different privileges look at one field. Measured live: 220 of
 *    292 batch parents printed Missing on every row while carrying the link in
 *    their own description.
 *
 *    Widening the browser select is NOT the fix -- it returns 42501 and takes
 *    the whole Production tab down. So the panel stops asserting a fact about
 *    the world it cannot know, and asserts one about the reader instead.
 *
 * 2. The parent also carried a "Deliverable file" row, which cannot ever be
 *    populated there: the projection hardcodes it to ''. A batch parent is a
 *    container; the artifact belongs to a sub-issue (measured: file_url proxies
 *    point at a child 483 times vs a parent 8).
 *
 * 3. The Description panel carried a Refresh button whose premise -- Linear
 *    changing a description underneath the page -- the flip retired.
 */
const fs = require('fs');
const path = require('path');

const INDEX = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

function grabFunc(name) {
  const at = INDEX.indexOf('function ' + name + '(');
  if (at < 0) throw new Error('function not found: ' + name);
  let depth = 0, quote = '', escaped = false, comment = '';
  for (let j = INDEX.indexOf('{', at); j < INDEX.length; j++) {
    const c = INDEX[j], next = INDEX[j + 1];
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
    else if (c === '}') {
      depth--;
      if (depth === 0) {
        // Keep the `async` prefix: slicing from the `function` keyword alone
        // strips it, and every await in the body then fails to parse.
        const prefix = INDEX.slice(Math.max(0, at - 6), at) === 'async ' ? 'async ' : '';
        return prefix + INDEX.slice(at, j + 1);
      }
    }
  }
  throw new Error('unbalanced braces: ' + name);
}

/* ---- 1. The synthetic parent's asset states, executed ------------------- */

const ensureSrc = grabFunc('_prodEnsureAssets');
/* Only the synthetic short-circuit is under test; it returns before any
 * network path, so the rest of the function never runs in this harness. */
const runSynthetic = new Function('deps', `
  const { _prodIssue, _prodAssetState, _prodWriteTeam, _prodState, PROD_BATCH_ASSET_GUIDANCE, PROD_ASSET_UNREAD_GUIDANCE } = deps;
  ${ensureSrc}
  return _prodEnsureAssets;
`);

function syntheticState(assetValues) {
  const assets = {};
  for (const key of ['filming_plan', 'raw_footage', 'delivery_folder', 'deliverable_file']) {
    const url = String(assetValues[key] || '').trim();
    assets[key] = { slot: key, url, state: url ? 'checking' : 'missing', checked_at: '', guidance: '' };
  }
  const state = { status: 'idle', complete: false, assets, error: '' };
  return {
    _prodIssue: () => ({ id: 'batch::node', syntheticBatchParent: true, team: 'video' }),
    _prodAssetState: () => state,
    _prodWriteTeam: t => t,
    _prodState: { assets: new Map(), writes: new Map() },
    PROD_BATCH_ASSET_GUIDANCE: 'Held on the post, not readable here. Open a sub-issue to see it.',
    PROD_ASSET_UNREAD_GUIDANCE: 'Not readable until asset access is checked.',
    state,
  };
}

/* ---- 0. The FIRST PAINT, which is what the reader actually sees ---------
 * _prodRender seeds state from _prodAssetDefaultEvidence and paints, THEN
 * calls _prodEnsureAssets -- whose synthetic branch returns without repainting.
 * So a correction made only in ensure never reaches the screen until some
 * unrelated re-render. Caught in review of this very change; the honesty has
 * to be decided at seed time, and this is the check that proves it is. */
const seedSrc = grabFunc('_prodAssetDefaultEvidence');
const seed = new Function('deps', `
  const { PROD_ASSET_SPECS, PROD_BATCH_ASSET_GUIDANCE, PROD_ASSET_UNREAD_GUIDANCE } = deps;
  ${seedSrc}
  return _prodAssetDefaultEvidence;
`)({
  PROD_ASSET_SPECS: [
    { key: 'filming_plan', label: 'Filming plan' },
    { key: 'raw_footage', label: 'Raw footage' },
    { key: 'delivery_folder', label: 'Frame folder' },
    { key: 'deliverable_file', label: 'Deliverable file', graphicsLabel: 'Thumbnail file' },
  ],
  PROD_BATCH_ASSET_GUIDANCE: 'Held on the post, not readable here. Open a sub-issue to see it.',
  PROD_ASSET_UNREAD_GUIDANCE: 'Not readable until asset access is checked.',
});

{
  const parent = seed({ id: 'batch::node', syntheticBatchParent: true, assets: {} });
  ok(parent.filming_plan.state === 'unavailable' && parent.raw_footage.state === 'unavailable',
    'FIRST PAINT: a batch parent seeds Unavailable, so the honest state is on screen immediately');
  ok(/Open a sub-issue/.test(parent.filming_plan.guidance),
    'and the seeded guidance says where to look');
  /* REVISED 2026-08-31, and the revision is the finding.
     This used to assert that a real deliverable seeds Missing, on the reasoning
     that empty there genuinely means absent and the edge function will resolve
     it. The first half is false. `issue.assets` is hardcoded to four empty
     strings for EVERY row the projection builds, because no asset column is
     browser-readable at all -- the browser view carries 46 columns and not one
     of them is asset-bearing, and deliverables.file_url and
     batches.filming_doc_url both answer 42501 to the browser key. So an empty
     slot on a real deliverable means exactly what it means on a synthetic
     parent: this reader has not been told.
     The second half is true but does not rescue it, because the read is not
     always going to answer. It is refused permanently for a creative looking at
     the other team (both teams are in here as of today) and for the 686 live
     rows whose client_slug is not an active client, and the panel went on
     asserting absence underneath the red banner explaining the refusal.
     The batch-parent fix was right and too narrow; this is the same fix at the
     width the projection actually justifies. */
  const child = seed({ id: 'del_1', team: 'video', assets: {} });
  ok(child.filming_plan.state === 'unavailable',
    'a REAL deliverable ALSO seeds Unavailable -- no asset column is browser-readable, so empty never means absent here either');
  ok(/asset access/i.test(child.filming_plan.guidance)
    && !/sub-issue/.test(child.filming_plan.guidance),
    'and it gets the unread explanation, not the batch-parent one about opening a sub-issue');
  ok(seed(null).filming_plan.state === 'missing',
    'with no issue at all the seed stays Missing: that is the projection-swap placeholder, not a claim about a row');
  const withUrl = seed({ id: 'batch::node', syntheticBatchParent: true, assets: { filming_plan: 'https://docs.google.com/document/d/a/edit' } });
  ok(withUrl.filming_plan.state === 'checking',
    'a parent that CAN see a URL still seeds checking, so a future grant needs no second change');
}

(async () => {
  {
    // The shape every synthetic parent actually has: nothing readable.
    const d = syntheticState({});
    await runSynthetic(d)('batch::node');
    for (const key of ['filming_plan', 'raw_footage', 'delivery_folder']) {
      ok(d.state.assets[key].state === 'unavailable',
        `${key} on a batch parent reads Unavailable, not Missing -- the browser cannot see the column`);
      ok(/Open a sub-issue/.test(d.state.assets[key].guidance),
        `${key} says where the value can actually be seen`);
    }
    ok(d.state.status === 'ready' && d.state.complete === true,
      'the panel still settles, so nothing spins forever');
  }
  {
    // If the columns ever DO arrive (a widened grant, a real parent row), a
    // present URL must still resolve to Available -- the honesty fix must not
    // swallow a real value.
    const d = syntheticState({ filming_plan: 'https://docs.google.com/document/d/abc/edit' });
    await runSynthetic(d)('batch::node');
    ok(d.state.assets.filming_plan.state === 'available',
      'a batch parent that CAN see a link still shows it as Available');
    ok(d.state.assets.raw_footage.state === 'unavailable',
      'while its unreadable siblings stay Unavailable');
  }

  /* ---- 2. The parent drops the row it can never fill -------------------- */

  const detail = grabFunc('_prodDetail');
  ok(/_prodAssetsPanelHTML\(batchAssetSource \|\| d, d\.syntheticBatchParent === true/.test(detail),
    'the detail view passes a slot list for a synthetic batch parent');
  const slotList = (detail.match(/slots: \[([^\]]*)\]/) || [])[1] || '';
  ok(/filming_plan/.test(slotList) && /raw_footage/.test(slotList) && /delivery_folder/.test(slotList),
    'the three post-level slots survive on the parent');
  ok(!/deliverable_file/.test(slotList),
    'and deliverable_file does NOT -- a container has no canonical artifact');
  /* Read-only exactly when there is nobody to ask. Once a resolved child is
     answering, the two folder links are as writable on the parent as on any
     sub-issue -- they are one batch row -- and the parent is where a reader
     looks for what belongs to the whole post. With no source the panel falls
     back to the parent row, which the gateway cannot authorize, so offering a
     control there would be the dead end this file exists to prevent. */
  ok(/readOnly: !batchAssetSource/.test(detail.slice(detail.indexOf('syntheticBatchParent === true'))),
    'the parent panel is read-only only when no child can answer for the batch');
  ok(!/readOnly: true/.test(detail),
    'and it is no longer read-only unconditionally');
  ok(/_prodAssetsPanelHTML\(batchAssetSource \|\| d, d\.syntheticBatchParent === true[\s\S]{0,900}: undefined\)/.test(detail),
    'a REAL deliverable still gets the full four-row panel (only the synthetic parent is narrowed)');

  /* ---- 2b. The parent stops hedging and shows the actual links -----------
   * OWNER, 2026-08-31: "I want the drive and frame URL and all the assets to
   * be viewable on the parent issue too."
   *
   * The hedge above was accurate but useless -- the reader wanted the link,
   * not a sentence about who may read the column. The column stays revoked
   * from the browser (widening it would publish every client folder URL under
   * the public anon key), and instead the panel is rendered against a CHILD of
   * the same batch, which reaches the identical three columns through the
   * service-role prober. The fallback is what makes this safe to ship: with no
   * usable child the parent still renders itself, and section 1 above proves
   * that path still says Unavailable rather than Missing. */
  const sourceSrc = grabFunc('_prodBatchAssetSource');
  const makeSource = (rows, roster) => new Function('deps', `
    const { _prodChildrenOf, _prodClient, PROD_ATTRIBUTION_NEEDS, PROD_ATTRIBUTION_CONFLICT } = deps;
    ${sourceSrc}
    return _prodBatchAssetSource;
  `)({
    _prodChildrenOf: id => rows.filter(r => r.parent === id),
    // The active roster the page actually loaded. Default: everything the rows
    // name is active, which is the ordinary case.
    _prodClient: slug => ((roster || null) ? (roster.includes(slug) ? { id: slug } : null) : { id: slug }),
    PROD_ATTRIBUTION_NEEDS: '__needs_attribution__',
    PROD_ATTRIBUTION_CONFLICT: '__attribution_conflict__',
  });

  const PARENT = { id: 'batch::n1', syntheticBatchParent: true, batchId: 'b1' };
  {
    const rows = [
      { id: 'del_a', parent: 'batch::n1', batchId: 'b1', authorityProject: 'acme' },
      { id: 'del_b', parent: 'batch::n1', batchId: 'b1', authorityProject: 'acme' },
    ];
    const picked = makeSource(rows)(PARENT);
    ok(picked && picked.id === 'del_a',
      'a batch parent borrows a resolved child of its own batch to read the post-level slots');
  }
  {
    /* REVISED after review (Codex P1). This used to require a RESOLVED
       attribution, which looked safer and was not: the scope the prober is
       actually sent is authorityProject THEN storedClientSlug THEN project, so
       a row whose UI attribution never resolved can still carry the stored slug
       the gateway matches on -- and discarding it kept hiding links the server
       would have returned. The selection now asks the same question the read
       asks, and merely PREFERS a resolved child. */
    const rows = [
      { id: 'del_a', parent: 'batch::n1', batchId: 'b1', authorityProject: '', storedClientSlug: 'acme' },
      { id: 'del_b', parent: 'batch::n1', batchId: 'b1', authorityProject: 'acme' },
    ];
    ok(makeSource(rows)(PARENT).id === 'del_b',
      'a resolved child is preferred when one exists');
    const onlyStored = [
      { id: 'del_a', parent: 'batch::n1', batchId: 'b1', authorityProject: '', storedClientSlug: 'acme' },
    ];
    ok(makeSource(onlyStored)(PARENT).id === 'del_a',
      'but a child with only a STORED slug is still used -- that is the scope the read would send, and it works');
    const onlyProject = [
      { id: 'del_a', parent: 'batch::n1', batchId: 'b1', authorityProject: '', storedClientSlug: '', project: 'acme' },
    ];
    ok(makeSource(onlyProject)(PARENT).id === 'del_a',
      'and the third link in the same fallback chain counts too');
  }
  {
    /* The one thing that must NOT be treated as a scope. A row with no
       attribution carries a SENTINEL in `project`, and sending it as a client
       slug is a guaranteed 403 -- which would replace the honest hedge with a
       permission error about a row nobody asked about. */
    for (const sentinel of ['__needs_attribution__', '__attribution_conflict__']) {
      const rows = [
        { id: 'del_a', parent: 'batch::n1', batchId: 'b1', authorityProject: '', storedClientSlug: '', project: sentinel },
      ];
      ok(makeSource(rows)(PARENT) === null,
        'the ' + sentinel + ' sentinel is not a client slug, so that child is no candidate at all');
    }
  }
  {
    // A two-team batch mints a second synthetic parent, and children can be
    // re-parented across batches; neither may answer for THIS batch.
    const rows = [
      { id: 'batch::n1::graphics', parent: 'batch::n1', batchId: 'b1', authorityProject: 'acme', syntheticBatchParent: true },
      { id: 'del_x', parent: 'batch::n1', batchId: 'b2', authorityProject: 'acme' },
    ];
    ok(makeSource(rows)(PARENT) === null,
      'another synthetic node and a child of a DIFFERENT batch are both refused as sources');
  }
  {
    /* And the scope has to name a client on the ACTIVE roster, because that is
       the next thing the gateway checks -- handleAssetAccessRead refuses an
       inactive or unknown client with a flat 403 before it looks at the id.
       686 live rows carry a client_slug that is not an active client. Asking
       anyway would collect a refusal the page could have predicted, on a
       surface that made no request at all before this feature existed. */
    const rows = [
      { id: 'del_a', parent: 'batch::n1', batchId: 'b1', authorityProject: 'goneclient' },
      { id: 'del_b', parent: 'batch::n1', batchId: 'b1', authorityProject: 'acme' },
    ];
    ok(makeSource(rows, ['acme'])(PARENT).id === 'del_b',
      'a child whose client is not on the active roster is skipped -- the gateway would 403 it');
    ok(makeSource([rows[0]], ['acme'])(PARENT) === null,
      'and when that is the only child, the panel keeps the honest hedge rather than collecting a predictable refusal');
  }
  {
    ok(makeSource([])(PARENT) === null,
      'a parent with no children has no source, so the panel falls back to the honest Unavailable rows');
    ok(makeSource([])({ id: 'del_real', team: 'video', batchId: 'b1' }) === null,
      'and a REAL deliverable never borrows -- it reads its own assets directly');
  }
  {
    const render = grabFunc('_prodRender');
    ok(/_prodBatchAssetSource\(_prodIssue\(_prodState\.openId\)\)/.test(render)
      && /if \(batchAssetSource\) _prodEnsureAssets\(batchAssetSource\.id, false\)/.test(render),
      'the render loop actually ASKS for the borrowed read -- ensure on the parent id returns without a network call');
  }

  /* ---- 2c. Labels: the control the truth pass missed --------------------
   * Found by the unknowable-assertion sweep, 2026-08-31. A synthetic parent's
   * id IS the batch id, so handleLabelsRead answers 404 entity_not_found every
   * single time. _prodLabelErrorText has branches for 401, 403 and
   * incomplete_label_state only, so it fell through to "Labels could not be
   * loaded. Retry to check the current Linear state." -- and rendered a Retry
   * that re-fired the identical request forever.
   *
   * Both halves of that sentence were false. The read did not fail
   * transiently; it cannot succeed. And there is no Linear label state to
   * re-check, because the parent has no Linear issue. Description and Assets
   * both short-circuit here already, and the pickers already refuse with the
   * batch-parent sentence; Labels was the one that did not.
   */
  const labels = grabFunc('_prodEnsureLabels');
  ok(/if \(issue\.syntheticBatchParent === true\) \{/.test(labels),
    'the labels read short-circuits on a batch parent instead of asking for a row that does not exist');
  const structuralArm = labels.slice(labels.indexOf('syntheticBatchParent === true'));
  ok(/status: 'ready'/.test(structuralArm) && /complete: true/.test(structuralArm),
    "...and SETTLES, because leaving it unset strands the button on 'Loading labels' -- a quieter version of the same lie");
  ok(/structural: true/.test(structuralArm),
    'the state records WHY it is empty, so the button and the popover can tell the two apart');
  ok(labels.indexOf('syntheticBatchParent === true') < labels.indexOf('PROD_WRITE_EF_URL'),
    'the short-circuit precedes the request, so no 404 is generated at all');

  const labelsButton = grabFunc('_prodLabelsButtonHTML');
  ok(/state\.structural === true/.test(labelsButton) && /No labels/.test(labelsButton),
    'the button reads "No labels" rather than "Labels unavailable"');
  ok(!/Add labels[\s\S]{0,80}structural/.test(labelsButton),
    'and never "Add labels", which would be the third promise this panel makes that the gateway cannot keep');

  const pop = grabFunc('_prodLabelsPopHTML');
  const structuralPop = pop.slice(pop.indexOf("state.structural === true"), pop.indexOf("state.status === 'error'"));
  ok(/no Linear issue of its own/.test(structuralPop),
    'the popover explains the structural reason');
  ok(!/data-prod-label-retry/.test(structuralPop),
    'and offers NO Retry -- a retry is an offer to try again, and this one could never have succeeded');
  ok(/data-prod-label-retry/.test(pop),
    'while a genuine read failure keeps its Retry, which is the case that IS recoverable');

  /* ---- 3. The description Refresh button is gone, the handler is not ---- */

  ok(!/data-prod-description-control="refresh"/.test(INDEX),
    'neither description header renders a Refresh button any more');
  ok(/function _prodRefreshDescription\(/.test(INDEX),
    'but the handler survives');
  ok((INDEX.match(/onclick="return _prodRefreshDescription\(/g) || []).length === 2,
    'because the two error-banner Retry buttons are its real callers -- a failed read must stay recoverable');
  ok(/function _prodEnsureDescription\(/.test(INDEX)
    && /description_read/.test(INDEX),
    'and the read itself is untouched: brief is not in the browser grant, so this is the only way a description reaches the page');

  /* ---- 4. The invalid-link copy must name the rule the code enforces ----
   * The shipped sentence refused folders and never mentioned Frame.io, which
   * is exactly backwards: the 2026-08-16 owner ruling widened deliverable_file
   * to accept a file OR a folder, and Frame.io links resolve as folders. A
   * designer pasting the shape the team actually ships was told to go and fix
   * a link that was already valid. */
  const policy = fs.readFileSync(path.resolve(__dirname, '..', 'supabase', 'functions', 'production-write', 'policy.mjs'), 'utf8');
  const allowed = policy.slice(policy.indexOf('export function assetTypeAllowed'));
  ok(/deliverable_file"\) return kind === "file" \|\| kind === "folder"/.test(allowed)
     || /key === 'deliverable_file'\) return kind === 'file' \|\| kind === 'folder'/.test(allowed),
    'the policy really does accept a folder for deliverable_file (the rule the copy must match)');
  const copy = (INDEX.match(/if \(code === 'invalid_artifact_url'\) return '([^']*)'/) || [])[1] || '';
  ok(copy, 'the invalid_artifact_url message exists');
  ok(!/folders are not canonical/.test(copy),
    'it no longer claims folders are refused, which the policy contradicts');
  ok(/Frame\.io/.test(copy),
    'it names Frame.io, the host the team actually ships deliverables on');
  ok(/folder/.test(copy) && /Doc/.test(copy),
    'and it states the real rule: file or folder yes, a Doc no');

  /* ---- 5. A video deliverable explains itself instead of going silent ---
   * `graphics && …` suppressed the gate SENTENCE as well as the control, so a
   * video issue rendered four rows and no reason at all. That is what "I have
   * no way of editing the assets" looked like from the inside. */
  const panel = grabFunc('_prodAssetsPanelHTML');
  /* This panel briefly explained WHY a video deliverable could not be attached.
   * That sentence is gone because the refusal is gone: the database learned the
   * video projection, the two server guards moved with it, and the panel now
   * asks only whether this person may write this row. What must hold is that
   * `graphics` no longer gates the CONTROLS -- only the row label. */
  /* 2026-08-31: the control moved from the panel HEADER onto each ROW, because
     three slots are writable now and one must never be. A single header button
     cannot express that -- it would either offer the wrong slot or require the
     reader to already know which one it means. What must still hold is the
     original property: the control is gated by PERMISSION, never by team, and
     a refusal always carries the real reason. */
  ok(/const operation = spec\.write \|\| '';/.test(panel)
    && /const editable = !options\.readOnly && !!operation;/.test(panel),
    'each row derives its control from the slot own write operation, so an unwritable slot has none');
  ok(/_prodWriteGateAttrs\(issue, operation, \{/.test(panel),
    'the row control is gated by permission alone, not by team, and carries the gate sentence');
  ok(/_prodWriteGateText\(issue, blockedSpec\.write\)/.test(panel),
    'and a panel whose reader may write none of its slots still explains why, with the real reason');
  ok(!/graphics && _prodCanWrite/.test(panel)
     && !/!options\.readOnly && graphics &&/.test(panel),
    'no control is conditioned on the team any more');
  ok(/graphics && spec\.graphicsLabel/.test(panel),
    'but the row LABEL still differs: Thumbnail file on graphics, Deliverable file on video');

  /* ---- 6. One rule for both refresh controls -------------------------
   * Removing the Description Refresh left its twin behind: "Refresh access"
   * still rendered on a batch parent and toasted a re-probe the authenticated
   * prober cannot perform there, since it has no row to authorize against.
   * A surface with one phantom refresh instead of two is not a rule. */
  ok(/syntheticBatchParent === true \? ''\s*\n?\s*: '<button class="prod-assets-refresh"/.test(panel),
    'Refresh access is not offered on a batch parent, where it cannot act');
  ok(/prod-assets-refresh/.test(panel),
    'and is still offered on a real deliverable, where it does real work gating status transitions');

  /* ---- 7. The VALUE column, which is the one people read ---------------
   * Review catch on this very change: switching the state pill to Unavailable
   * left "Not provided" in the prominent value column, so the row went on
   * asserting the absence -- and the correction sat in a title tooltip on a
   * non-focusable span, invisible to keyboard and touch users entirely. */
  ok(/const unreadable = !url && assetState === 'unavailable'/.test(panel),
    'the row distinguishes unreadable from genuinely empty');
  ok(/_calEsc\(unreadable \? String\(asset\.guidance\)\.trim\(\) : 'Not provided'\)/.test(panel),
    'and an unreadable slot renders its explanation as the VISIBLE value, not Not provided');
  ok(/'<span>' \+ _calEsc\(/.test(panel),
    'the value is escaped into the span like every other user-facing string here');

  if (failures) { console.error(`\n${failures} check(s) failed.`); process.exit(1); }
  console.log('\nProduction batch-parent panel checks passed');
})();
