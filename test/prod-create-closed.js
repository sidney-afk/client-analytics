'use strict';
/*
 * Owner ruling 2026-08-23 — the Production tab creates NOTHING.
 *
 *   "a sub-issue is a card, not a parent issue. So I would say that we
 *    shouldn't be able to do parent issues or sub-issues because we don't
 *    want to do posts in sync linear that are not in the calendar."
 *
 * Why the ruling is factually right: supabase/functions/production-write
 * hardcodes `card_id: null` in the create insert for BOTH modes. The
 * `parentRoute` branch only decides whether a BATCH row is also written, so a
 * sub-issue added under a parent that HAS a card still produces a deliverable
 * with no card — invisible to the content calendar, to Kasper's cross-client
 * queue, and to every client review link.
 *
 * This suite EXECUTES the shipped gate functions rather than grepping them,
 * because the previous closure (Video-only + the authority flag) looked shut
 * in source and was not: the topbar re-implemented the gate inline and
 * rendered a live New issue button on the unscoped board.
 *
 * The one thing that stays open is recovery. A saved draft marked `ambiguous`
 * means the create MAY ALREADY HAVE COMMITTED; its retry is the only path
 * that ever shows the creator the row that landed. Refusing it would strand a
 * committed card-less row — the exact orphan this closure exists to prevent.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const edge = fs.readFileSync(path.join(ROOT, 'supabase/functions/production-write/index.ts'), 'utf8');

let failures = 0;
function ok(value, label) {
  if (value) console.log('  ok  ' + label);
  else { failures += 1; console.error('FAIL  ' + label); }
}

function extract(text, name) {
  const marker = 'function ' + name + '(';
  let start = text.indexOf(marker);
  if (start < 0) throw new Error('missing ' + name);
  if (text.slice(start - 6, start) === 'async ') start -= 6;
  const brace = text.indexOf('{', start);
  let depth = 0, quote = '', escaped = false, line = false, block = false;
  for (let i = brace; i < text.length; i++) {
    const ch = text[i];
    if (line) { if (ch === '\n') line = false; continue; }
    if (block) { if (ch === '*' && text[i + 1] === '/') { block = false; i++; } continue; }
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '/' && text[i + 1] === '/') { line = true; i++; continue; }
    if (ch === '/' && text[i + 1] === '*') { block = true; i++; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return text.slice(start, i + 1);
  }
  throw new Error('unclosed ' + name);
}

// ---- the shipped sentence, read from the shipped source ------------------
const closedTextLine = /const PROD_CREATE_CLOSED_TEXT = '((?:[^'\\]|\\.)*)';/.exec(source);
ok(!!closedTextLine, 'index.html declares PROD_CREATE_CLOSED_TEXT');
const CLOSED = closedTextLine ? JSON.parse('"' + closedTextLine[1].replace(/"/g, '\\"') + '"') : '';
ok(/content calendar/i.test(CLOSED) && /Create Post/.test(CLOSED),
  'the refusal names where posts ARE created (the content calendar) instead of only saying no: ' + JSON.stringify(CLOSED));

// ---- run the real gate functions ----------------------------------------
const sandbox = {
  console,
  PROD_CREATE_CLOSED_TEXT: CLOSED,
  _prodState: { authority: null, authorityLoaded: false },
  identity: null,
  savedDraft: null,
  clients: {
    'active-client': { raw: { active: true, kind: 'client' } },
    'test-client': { raw: { active: true, kind: 'test' } },
    'retired-client': { raw: { active: false, kind: 'client' } },
  },
  _syncviewStaffIdentityForHeaders: () => sandbox.identity,
  _prodClient: slug => sandbox.clients[slug] || null,
  _prodWriteTeam: value => (value === 'video' || value === 'graphics' ? value : ''),
  _prodTeamLabel: team => (team === 'graphics' ? 'Graphics' : 'Video'),
  _prodIdentityRepairGateText: () => '',
  _prodAttributionResolved: () => true,
  _prodAttributionGateText: () => 'attribution',
  _prodCreateSavedDraft: () => sandbox.savedDraft,
  _calEscAttr: value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'),
  _prodIcon: () => '<svg></svg>',
};
vm.createContext(sandbox);
for (const name of ['_prodCreateRoleAllowed', '_prodCreateGateText', '_prodCreateRecoveryGateText', '_prodCreateTopbarButton']) {
  vm.runInContext(extract(source, name), sandbox);
}
const gate = sandbox._prodCreateGateText;
const recoveryGate = sandbox._prodCreateRecoveryGateText;
const topbar = sandbox._prodCreateTopbarButton;

const identities = [
  null,
  { role: 'admin' }, { role: 'smm' }, { role: 'creative' }, { role: 'designer' }, { role: 'editor' },
];
const authorities = [
  null,
  { video: 'linear', graphics: 'linear' },
  { video: 'linear', graphics: 'syncview' },
  { video: 'syncview', graphics: 'linear' },
  { video: 'syncview', graphics: 'syncview' },
];
const scopes = [['', ''], ['active-client', ''], ['active-client', 'video'], ['active-client', 'graphics']];
const parents = [
  undefined,
  { id: 'p1', parent: null, project: 'active-client', team: 'video' },
  { id: 'p2', parent: 'p1', project: 'active-client', team: 'graphics' },
];

let gateChecks = 0;
let gateOpen = 0;
for (const identity of identities) {
  for (const authority of authorities) {
    for (const [slug, team] of scopes) {
      for (const parent of parents) {
        sandbox.identity = identity;
        sandbox._prodState.authority = authority;
        sandbox._prodState.authorityLoaded = !!authority;
        gateChecks += 1;
        if (gate(slug, team, parent) !== CLOSED) gateOpen += 1;
      }
    }
  }
}
ok(gateChecks === 360 && gateOpen === 0,
  `every role x authority x scope x parent combination refuses with the one sentence (${gateChecks} checked, ${gateOpen} open)`);

// The flip is the specific thing that must NOT reopen it: the previous
// closure was a team-authority accident, and Video is being prepared to flip.
sandbox.identity = { role: 'admin' };
sandbox._prodState.authority = { video: 'syncview', graphics: 'syncview' };
sandbox._prodState.authorityLoaded = true;
ok(gate('active-client', 'video') === CLOSED
  && gate('active-client', 'graphics') === CLOSED
  && gate('active-client', '') === CLOSED,
  'a fully SyncView-authoritative estate (the post-flip world) still refuses both modes');

// ---- the topbar asks the same gate, on every scope -----------------------
sandbox.savedDraft = null;
const topbarHtml = [topbar('', ''), topbar('active-client', 'video'), topbar('active-client', 'graphics')];
ok(topbarHtml.every(html => / disabled /.test(html)
    && html.includes(sandbox._calEscAttr(CLOSED))
    && !html.includes('onclick')
    && html.includes('New issue')),
  'the New issue button is disabled and carries the reason on the unscoped board and on both team scopes');
ok(!/Sign in with an Admin or SMM staff account to create issues/.test(extract(source, '_prodCreateTopbarButton')),
  'the topbar no longer carries its own copy of the gate (the inline copy is why it rendered live while the gate refused)');
ok(/_prodCreateGateText\(clientSlug, team\)/.test(extract(source, '_prodCreateTopbarButton')),
  'the topbar reads the one gate');

// ---- recovery is deliberately NOT closed --------------------------------
ok(recoveryGate({ clientSlug: 'active-client' }) === '',
  'an ambiguous draft on an active roster client can still be recovered — its create may already have committed');
sandbox.identity = null;
ok(/Sign in/.test(recoveryGate({ clientSlug: 'active-client' })),
  'recovery still requires the same signed-in staff identity');
sandbox.identity = { role: 'creative' };
ok(/Only Admin and SMM/.test(recoveryGate({ clientSlug: 'active-client' })),
  'recovery stays Admin/SMM-only');
sandbox.identity = { role: 'admin' };
ok(/service-authenticated/.test(recoveryGate({ clientSlug: 'test-client' })),
  'recovery cannot self-enter the service-only TEST lane');
ok(/no longer active/.test(recoveryGate({ clientSlug: 'retired-client' })),
  'recovery refuses a retired roster client');
ok(!extract(source, '_prodCreateRecoveryGateText').includes('PROD_CREATE_CLOSED_TEXT'),
  'the closure was not copied into the recovery gate');

sandbox.savedDraft = { ambiguous: true, clientSlug: 'active-client', team: 'video' };
const recoveringHtml = topbar('active-client', 'video');
ok(!/ disabled /.test(recoveringHtml)
  && /onclick="return _prodOpenCreate\(\)"/.test(recoveringHtml)
  && recoveringHtml.includes('Recover issue'),
  'a committed-but-unacknowledged create keeps its one recovery affordance');
sandbox.savedDraft = { ambiguous: false, clientSlug: 'active-client', team: 'video' };
ok(/ disabled /.test(topbar('active-client', 'video')),
  'a NON-ambiguous saved draft cannot reopen the dialog — only a create that may have committed can');
sandbox.savedDraft = null;

// ---- what is now dead, and what only LOOKS dead --------------------------
// The dialog is still reachable, in recovery mode only. So most of it is
// live. Two pieces were checked by execution rather than by eye:
const savedDraftSandbox = {
  console, JSON, Date, Number, Set, String, Array,
  PROD_CREATE_DRAFT_KEY: 'k',
  PROD_CREATED_STATUS: 'todo',
  PROD_STATUS_FROM_ARTIFACT: { todo: 'todo' },
  store: {},
  _prodWriteTeam: value => (value === 'video' || value === 'graphics' ? value : ''),
  _prodWriteRequestId: () => 'prod:create:regenerated-abcdefgh',
};
savedDraftSandbox.sessionStorage = {
  getItem: key => savedDraftSandbox.store[key] || null,
  setItem: (key, value) => { savedDraftSandbox.store[key] = value; },
  removeItem: key => { delete savedDraftSandbox.store[key]; },
};
vm.createContext(savedDraftSandbox);
vm.runInContext(extract(source, '_prodCreateValidDate'), savedDraftSandbox);
vm.runInContext(extract(source, '_prodCreateSavedDraft'), savedDraftSandbox);
const storedDraft = {
  mode: 'subissue', parentId: 'p1', parentLocked: true, ambiguous: true,
  clientSlug: 'active-client', team: 'graphics', graphicsContext: true,
  title: 't', description: 'd', status: 'todo', dueDate: '', assigneeId: '', labelIds: [],
  requestId: 'prod:create:abcdefghij', sourceEditedAt: '2026-08-23T09:00:00.000Z',
  savedAt: Date.now(),
};
savedDraftSandbox.store.k = JSON.stringify(storedDraft);
const recovered = savedDraftSandbox._prodCreateSavedDraft();
ok(recovered && !Object.prototype.hasOwnProperty.call(recovered, 'graphicsContext'),
  'graphicsContext does not survive a saved draft — so the graphics explainer note can no longer render, because the only draft that reaches the form now comes back through _prodCreateSavedDraft');
ok(recovered && recovered.team === 'graphics' && recovered.mode === 'subissue',
  'a graphics-pinned SUB-ISSUE draft does survive — the Graphics entry in the team list and the mode/parent pickers are NOT dead code, they render the locked recovery form');
ok(/if \(draft\.team === 'graphics'\) \{\s*\n\s*teamItems\.push\(\{ value: 'graphics', label: 'Graphics' \}\);/.test(extract(source, '_prodCreateFormHTML')),
  'the create form still displays a pinned Graphics team, so a recovered graphics sub-issue does not show an empty locked picker');
const staleDraft = { ...storedDraft, savedAt: Date.now() - (7 * 864e5 + 1000) };
savedDraftSandbox.store.k = JSON.stringify(staleDraft);
ok(savedDraftSandbox._prodCreateSavedDraft() === null,
  'a saved draft expires after 7 days — that plus the tab lifetime is the whole recovery exposure window (sessionStorage, not localStorage)');

// ---- the browser's error copy for the server refusal ---------------------
ok(/if \(code === 'production_create_closed'\) return PROD_CREATE_CLOSED_TEXT;/.test(extract(source, '_prodCreateErrorText')),
  'a server refusal shows the same sentence, not a raw error code');

// ---- the generic write-failure reporter carries the same sentence -------
// test/write-ui-failure-messages.js is a TOTAL gate: a GatewayError code with
// no user guidance fails it. That table is lifted whole into a bare VM, so it
// cannot reference PROD_CREATE_CLOSED_TEXT and duplicates the sentence.
ok(/add\('blocked', \[[\s\S]{0,600}'production_create_closed'/.test(source),
  'production_create_closed is classed as a blocked (owner-decision) refusal, not a retryable one');
const failureTableEntry = /production_create_closed: \{\s*\n\s*title: '([^']*)',\s*\n\s*text: '([^']*)'/.exec(source);
ok(!!failureTableEntry && failureTableEntry[2] === CLOSED,
  'the write-failure table and PROD_CREATE_CLOSED_TEXT still say exactly the same thing');

// ---- the server closes too, and closes in the right ORDER ---------------
const createHandler = extract(edge, 'handleProductionCreate');
ok(/throw new GatewayError\(403, "production_create_closed"\)/.test(createHandler),
  'production-write refuses a NEW production create — a browser-only closure is one a hand-crafted request undoes');
ok(/if \(replay\) return replay;[\s\S]{0,1200}throw new GatewayError\(403, "production_create_closed"\);/.test(createHandler),
  'the refusal sits AFTER productionCreateReplay, so a create that already committed still returns its row');
const beforeReplay = createHandler.slice(0, createHandler.indexOf('if (replay) return replay;'));
ok(!/production_create_closed/.test(beforeReplay),
  'nothing refuses before the replay — refusing there would strand a committed card-less row with no owner');
ok(/if \(operation === "create"\) \{\s*\n\s*if \(surface !== "production"\) throw new GatewayError\(400, "invalid_surface_operation"\);/
  .test(extract(edge, 'assertSurfaceOperation')),
  'the router still ROUTES create, so a recovery replay can reach the handler that answers it');

if (failures) {
  console.error(`\nProduction create closure: ${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nProduction create closure checks passed');
