'use strict';
/*
 * The standing check `OPEN_REPAIRS.md` items 99-101 asked for, pinned offline.
 *
 * Item 99: a client's root comment and the staff reply to it are routed by two
 * DIFFERENT predicates. The client's add fails-legacy when the deliverable
 * crosswalk does not describe this exact card; the staff reply consults only
 * the `write_ui_reroute_clients` allowlist and goes to the gateway anyway. The
 * gateway then cannot find a parent that was never written canonically, refuses
 * the reply, and `_calAppendComment` discards the text. Item 101 is why a
 * script had to exist at all: that refusal reaches NO server -- it is a console
 * line and a 50-entry localStorage ring in one browser -- so the only way to
 * find the breakage before a client reports it is to derive it from data.
 * `scripts/card-comment-transport-split-check.js` is that derivation; this file
 * proves its rules without a network, so the suite never depends on a service.
 *
 * THE NARROWING IS THE POINT and is what this mostly guards. Measured
 * 2026-09-02: 19,362 card/component slots, of which 18,180 carry no deliverable
 * id at all (consistent: both sides go legacy) and 1,010 crosswalk cleanly
 * (consistent: both sides go canonical). Of the 172 that mismatch, 152 carry no
 * client-authored root -- and those are FINE, because a staff root on a
 * mismatching slot still went to the gateway and therefore HAS a canonical row
 * a reply can resolve. Only a CLIENT root is the poisoned parent. A check that
 * counted every mismatch would report 172 instead of 20, and a check that
 * counted every unlinked slot would report 18,180: the alarm-fatigue failure
 * `PRE_FLIP_HEALTH_CHECK.md` exists to prevent, rebuilt inside a new tool.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'scripts', 'card-comment-transport-split-check.js'), 'utf8');
const INDEX = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

function grabFunc(source, name) {
  const at = source.indexOf('function ' + name + '(');
  if (at < 0) throw new Error('function not found: ' + name);
  let depth = 0, quote = '', escaped = false, comment = '';
  for (let j = source.indexOf('{', at); j < source.length; j++) {
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

/* OPEN_REPAIRS item 96: the hand-rolled extractor above mis-extracts on regex
   literals, and an over-extraction that still PARSES passes silently while the
   sandbox quietly receives thousands of extra lines of `index.html`. Item 96's
   two required properties, applied here rather than waiting for the shared
   extractor it asks for: never accept a slice that does not parse standalone,
   and bound its size so a swallowed remainder is loud instead of plausible.
   Every function lifted here is under twenty lines in both files. */
function lift(source, name, maxChars) {
  const slice = grabFunc(source, name);
  if (slice.length > maxChars) {
    throw new Error(`${name} extracted ${slice.length} chars, over the ${maxChars} bound — `
      + 'the scanner ran past the function (OPEN_REPAIRS item 96)');
  }
  new vm.Script('(' + slice + ')');   // refuses loudly rather than guessing
  return slice;
}

/* ---- 1. The crosswalk is the page's, not the check's own idea of it ----- */

/* `_prodCanonicalCommentGate` calls a card LINKED only when
   `_prodCrosswalkMismatchFields` returns empty, and
   `_prodClientCommentGatewayContext` fails-legacy on the same answer. A check
   with a private copy of that rule would measure a different population than
   the one that actually breaks, and would keep passing while it did. So both
   implementations are lifted and made to agree row for row. */
const SURFACE_ORIGIN_RE = /const PROD_CROSSWALK_SURFACE_ORIGIN = (\{[^}]*\});/;
const pageOrigins = SURFACE_ORIGIN_RE.exec(INDEX);
const checkOrigins = SURFACE_ORIGIN_RE.exec(SRC);
ok(!!pageOrigins && !!checkOrigins && pageOrigins[1] === checkOrigins[1],
  'PROD_CROSSWALK_SURFACE_ORIGIN is byte-identical in the page and the check — '
  + 'the surface->origin map is what decides `calendar` from `samples`');

function buildPage() {
  const src = [
    pageOrigins ? pageOrigins[0] : '',
    lift(INDEX, '_prodCrosswalkTeamForComponent', 400),
    lift(INDEX, '_prodCrosswalkCardSlug', 400),
    lift(INDEX, '_prodCrosswalkMismatchFields', 1600),
    'return _prodCrosswalkMismatchFields;',
  ].join('\n');
  return new Function(src)();
}
function buildCheck() {
  const src = [
    checkOrigins ? checkOrigins[0] : '',
    "const low = v => String(v == null ? '' : v).trim().toLowerCase();",
    "const exact = v => String(v == null ? '' : v).trim();",
    lift(SRC, 'crosswalkTeamForComponent', 400),
    lift(SRC, 'crosswalkCardSlug', 400),
    lift(SRC, 'crosswalkMismatchFields', 1600),
    'return crosswalkMismatchFields;',
  ].join('\n');
  return new Function(src)();
}
const pageFields = buildPage();
const checkFields = buildCheck();

const CARD = 'p_test_card_0001';
const post = { id: CARD, client: 'aclient' };
const goodGraphic = { origin: 'calendar', team: 'graphics', client_slug: 'aclient', card_id: CARD };
const cases = [
  ['a graphic slot whose deliverable describes exactly this card is VALID',
    goodGraphic, post, 'graphic', []],
  ['a video slot is VALID against team `video`',
    { ...goodGraphic, team: 'video' }, post, 'video', []],
  ['origin `manual` mismatches — 5,046 of 6,241 deliverables carry it',
    { ...goodGraphic, origin: 'manual' }, post, 'graphic', ['origin']],
  ['a NULL card_id mismatches — 5,150 of 6,241 deliverables carry it',
    { ...goodGraphic, card_id: null }, post, 'graphic', ['card_id']],
  ['origin+card_id together is the live incident shape, and 16 of the 20 at-risk slots',
    { ...goodGraphic, origin: 'manual', card_id: null }, post, 'graphic', ['card_id', 'origin']],
  ['a graphic slot bound to a `video` deliverable mismatches on team — 2 of the 20',
    { ...goodGraphic, team: 'video' }, post, 'graphic', ['team']],
  ['all three at once is the fourth reason in the histogram — 1 of the 20',
    { origin: 'manual', team: 'video', client_slug: 'aclient', card_id: null }, post, 'graphic',
    ['card_id', 'origin', 'team']],
  ['a deliverable bound to a DIFFERENT card mismatches on card_id, not merely on absence',
    { ...goodGraphic, card_id: 'p_test_card_0002' }, post, 'graphic', ['card_id']],
  ['a missing deliverable row mismatches on all four fields rather than passing',
    null, post, 'graphic', ['card_id', 'client_slug', 'origin', 'team']],
  ['origin and team compare case-INsensitively',
    { ...goodGraphic, origin: 'Calendar', team: 'GRAPHICS' }, post, 'graphic', []],
  ['client_slug and card_id compare exactly, after trimming only',
    { ...goodGraphic, client_slug: ' aclient ', card_id: ' ' + CARD + ' ' }, post, 'graphic', []],
  ['the card slug comes from post.client_slug when present, post.client otherwise',
    goodGraphic, { id: CARD, client_slug: 'aclient', client: 'someoneelse' }, 'graphic', []],
];
for (const [why, deliverable, p, component, expected] of cases) {
  const page = pageFields(deliverable, 'calendar', p, component);
  const check = checkFields(deliverable, 'calendar', p, component);
  ok(JSON.stringify(page) === JSON.stringify(expected)
    && JSON.stringify(check) === JSON.stringify(expected), why);
}
ok(JSON.stringify(pageFields(goodGraphic, 'sxr', post, 'graphic')) === JSON.stringify(['origin'])
  && JSON.stringify(checkFields(goodGraphic, 'sxr', post, 'graphic')) === JSON.stringify(['origin']),
  'the Samples surface expects origin `samples`, so a calendar deliverable mismatches there — '
  + 'the check passes `calendar` because it walks calendar cards');

/* ---- 2. Which comments count, and which deliberately do not ------------- */

const runtime = (() => {
  const src = [
    "const low = v => String(v == null ? '' : v).trim().toLowerCase();",
    "const exact = v => String(v == null ? '' : v).trim();",
    lift(SRC, 'commentColumn', 600),
    lift(SRC, 'readComments', 900),
    lift(SRC, 'clientRootCount', 900),
    lift(SRC, 'nativeId', 500),
    'return { commentColumn, readComments, clientRootCount, nativeId };',
  ].join('\n');
  return new Function(src)();
})();

const col = rows => JSON.stringify(rows);
const clientRoot = extra => ({ id: 'c_1', parent_id: null, role: 'client', ...extra });
const cardWith = (component, rows) => (component === 'graphic'
  ? { id: CARD, graphic_tweaks: col(rows) }
  : { id: CARD, video_tweaks: col(rows) });

ok(runtime.clientRootCount(cardWith('graphic', [clientRoot()]), 'graphic') === 1,
  'a client-authored root on the graphic column counts — that is the thread a staff reply lands on');
ok(runtime.clientRootCount(cardWith('graphic', [{ id: 'c_1', parent_id: null, role: 'smm' }]), 'graphic') === 0,
  'a STAFF root does NOT count: it routed to the gateway and HAS a canonical row, so a reply to it resolves — '
  + 'this single rule is what takes the population from 172 to 20');
ok(runtime.clientRootCount(cardWith('graphic', [{ id: 'c_2', parent_id: 'c_1', role: 'client' }]), 'graphic') === 0,
  'a client REPLY is not a root — the parent is what the gateway looks up, so only roots poison a thread');
ok(runtime.clientRootCount(cardWith('graphic', [clientRoot({ role: 'Client' })]), 'graphic') === 1,
  'the role compares case-insensitively');
ok(runtime.clientRootCount(cardWith('graphic', [clientRoot({ deleted: true })]), 'graphic') === 0,
  'a tombstoned root is excluded — `_calCommentsForView` never renders it, so nobody can reply to it '
  + '(this is the difference between 33 client roots and the 32 reported)');
ok(runtime.clientRootCount(cardWith('graphic', [clientRoot({ deleted: true, canonical: true })]), 'graphic') === 1,
  'but a CANONICAL row marked deleted still renders, matching the page, so it still counts');
ok(runtime.clientRootCount(cardWith('graphic', [clientRoot({ hidden: true })]), 'graphic') === 0,
  'and an audit-hidden row is excluded for the same reason');
ok(runtime.clientRootCount(cardWith('graphic', [{ parent_id: null, role: 'client' }]), 'graphic') === 0,
  'a row with no id is dropped on read exactly as the page drops it');
ok(runtime.clientRootCount({ id: CARD, graphic_tweaks: 'not json at all' }, 'graphic') === 0
  && runtime.clientRootCount({ id: CARD }, 'graphic') === 0,
  'an unparseable or absent column is empty, never a crash — the check must survive every card');
ok(runtime.commentColumn({ video_tweaks: '', tweaks: '[]' }, 'video') === '[]',
  'VIDEO falls back to the legacy `tweaks` column when `video_tweaks` is empty, as `_calLoadComments` does — '
  + 'one linked video slot in the estate reads that column today, and missing it would undercount');
ok(runtime.commentColumn({ video_tweaks: '[1]', tweaks: '[2]' }, 'video') === '[1]'
  && runtime.commentColumn({ graphic_tweaks: '[3]', tweaks: '[4]' }, 'graphic') === '[3]',
  'and the component column wins wherever it is populated; graphics never reads the legacy column');
ok(runtime.nativeId({ graphic_deliverable_id: ' b1_d_x ' }, 'graphic') === 'b1_d_x'
  && runtime.nativeId({ video_deliverable_id: 'b1_d_y', graphic_deliverable_id: 'b1_d_x' }, 'video') === 'b1_d_y'
  && runtime.nativeId(null, 'video') === '',
  'a slot is the (card, component) pair and its deliverable id is read the way `_writeUiNativeId` reads it');

/* ---- 3. The classifier, including the half nobody would guess ---------- */

const split = (() => {
  const src = [
    checkOrigins ? checkOrigins[0] : '',
    "const low = v => String(v == null ? '' : v).trim().toLowerCase();",
    "const exact = v => String(v == null ? '' : v).trim();",
    lift(SRC, 'crosswalkTeamForComponent', 400),
    lift(SRC, 'crosswalkCardSlug', 400),
    lift(SRC, 'crosswalkMismatchFields', 1600),
    lift(SRC, 'nativeId', 500),
    lift(SRC, 'commentColumn', 600),
    lift(SRC, 'readComments', 900),
    lift(SRC, 'clientRootCount', 900),
    lift(SRC, 'transportSplit', 1400),
    'return transportSplit;',
  ].join('\n');
  return new Function(src)();
})();

const linkedGraphicCard = rows => ({ id: CARD, client: 'aclient',
  graphic_deliverable_id: 'b1_d_x', graphic_tweaks: col(rows) });

ok(split({ id: CARD, client: 'aclient', graphic_tweaks: col([clientRoot()]) }, 'graphic', null, true, true) === '',
  'A SLOT WITH NO DELIVERABLE ID IS EXCLUDED — the gate answers `unlinked`, both sides go legacy, '
  + 'and the thread is consistent. 18,180 of the 19,362 slots are this, and counting them would '
  + 'report a number nine hundred times larger than the defect');
ok(split(linkedGraphicCard([clientRoot()]), 'graphic', goodGraphic, true, true) === '',
  'a crosswalk-VALID slot is excluded — both sides go canonical');

/* THE FRONT-DOOR CARVE-OUT. `_prodClientCommentGatewayContext` (index.html)
   admits a mismatch on `card_id` ALONE when the deliverable side is UNBOUND —
   origin, team and slug all correct — because that is what the gateway's
   `clientCommentFrontDoorTargetAllowed` verifies server-side. A client root on
   such a slot went to the GATEWAY and HAS a canonical row, so the thread is not
   one-way and counting it would be a false positive that trips this check's own
   `--baseline=20` gate. Measured 2026-09-02: 8 slots mismatch on card_id alone
   and all 8 name a DIFFERENT card, so the carve-out moves no row today — which
   is exactly why it needs a pin rather than a measurement. */
const unboundCardId = { ...goodGraphic, card_id: null };
ok(split(linkedGraphicCard([clientRoot()]), 'graphic', unboundCardId, true, true) === '',
  'FRONT DOOR: card_id alone + deliverable UNBOUND is excluded — the client root there is canonical, '
  + 'so a staff reply to it resolves and the thread was never one-way');
ok(split(linkedGraphicCard([clientRoot()]), 'graphic', unboundCardId, true, false)
  === 'crosswalk_fields: card_id',
  'but ONLY while `client_comment_gateway_enabled` is on: with the flag off the client goes legacy too '
  + 'and the split is real, so the flag is read live rather than assumed');
ok(split(linkedGraphicCard([clientRoot()]), 'graphic',
  { ...goodGraphic, card_id: 'p_test_card_0002' }, true, true) === 'crosswalk_fields: card_id',
  'and a card_id bound to a DIFFERENT card is NOT that carve-out — the gateway denies it, so it stays '
  + 'at risk. This is the shape all 8 of the estate\'s card_id-only mismatches actually have');
ok(split(linkedGraphicCard([clientRoot()]), 'graphic',
  { ...goodGraphic, origin: 'manual', card_id: null }, true, true) === 'crosswalk_fields: card_id,origin',
  'nor does the carve-out reach a SECOND mismatching field — card_id+origin is the live incident shape '
  + 'and the front door refuses it, which is why that client root took the legacy lane at all');
ok(split(linkedGraphicCard([{ id: 'c_1', parent_id: null, role: 'smm' }]), 'graphic',
  { ...goodGraphic, origin: 'manual', card_id: null }, true, true) === '',
  'a mismatching slot with no client root is excluded — 152 of the 172 mismatches, and every one of '
  + 'them is fine');
ok(split(linkedGraphicCard([clientRoot()]), 'graphic',
  { ...goodGraphic, origin: 'manual', card_id: null }, true, true) === 'crosswalk_fields: card_id,origin',
  'AT RISK: deliverable-linked + crosswalk fails + a client root. The reason names the FIELDS, in the '
  + "planner's `crosswalk_fields:` form, so the repair knows what to backfill rather than only that "
  + 'something is wrong');
ok(/^latent, slug off the gateway allowlist/.test(split(linkedGraphicCard([clientRoot()]), 'graphic',
  { ...goodGraphic, origin: 'manual', card_id: null }, false, true)),
  'LATENT when the slug is off `write_ui_reroute_clients`: staff route to legacy too, so the thread is '
  + 'consistent and no reply is refused — it becomes live the moment the slug is added. All six affected '
  + 'slugs are on the allowlist today (42 slugs, read live), so this class is 0, and it is still '
  + 'reported because a flip would otherwise look like new breakage');
ok(split(linkedGraphicCard([clientRoot()]), 'graphic', { ...goodGraphic, origin: 'manual', card_id: null }, false, true)
  .includes('crosswalk_fields: card_id,origin'),
  'and a latent row still names its fields, so the two classes are one repair');

/* ---- 4. Contract: paging, exit codes, and what must never be printed --- */

ok(/for \(let offset = 0; ; offset \+= 1000\)/.test(SRC) && /rows\.length < 1000\) return out/.test(SRC),
  'BOTH big tables are paged — `calendar_posts` is 9,681 rows and `deliverables` 6,241, and the REST '
  + 'default of 1000 would silently truncate into a wrong, reassuring answer');
ok(/pageAll\('calendar_posts\?/.test(SRC) && /pageAll\('deliverables\?/.test(SRC),
  'and both go through the pager rather than a bare fetch');
ok(/select=id,client_slug,team,origin,card_id/.test(SRC),
  '`deliverables` is read with an explicit column list — `select=*` answers 401 to the publishable key');
ok(/client_comment_gateway_enabled/.test(SRC) && /gatewayFlag\.value\.enabled === true/.test(SRC),
  'the front-door flag is READ from syncview_runtime_flags rather than assumed on — with it off the '
  + 'carve-out must not apply, and the flag is exactly what the owner uses to roll that door back');
ok(/const BASELINE = baselineArg/.test(SRC) && /--baseline=/.test(SRC),
  'the baseline is a flag, so a repair can lower it in the same commit that lands');
ok(/process\.exit\(failed \? 1 : 0\)/.test(SRC) && /process\.exit\(2\)/.test(SRC),
  'exit 1 above the baseline so it can gate, 2 on error so a dead service is never read as a clean run');
ok(/--json/.test(SRC) && /no writes/i.test(SRC) && !/\bfetch\([^)]*method/i.test(SRC),
  'read-only, with a --json mode for a caller that wants the rows');
ok(/h\.client !== TEST_CLIENT|r\.client !== TEST_CLIENT/.test(SRC) && /const TEST_CLIENT/.test(SRC),
  'the drill client is reported but never gated, the same way its two siblings treat it');

/* The repo is public and this output lands in CI logs. The check reads the
   comment COLUMNS, which contain client feedback verbatim, so the rule is not
   "do not read bodies" but "never let one out". */
ok(!/\.body\b/.test(SRC) && !/\.author\b/.test(SRC) && !/\.author_name\b/.test(SRC),
  'the check never touches a comment body or author — it counts roots and prints the count');
ok(!/display_name|share_token|share_link|apikey=|token=/.test(SRC.replace(/apikey: SUPA_KEY/g, '')),
  'no display name, share token or credential is read or printed anywhere');
const emitted = [...SRC.matchAll(/atRisk\.push\(\{([\s\S]*?)\}\);/g)]
  .concat([...SRC.matchAll(/inverse\.push\(\{([\s\S]*?)\}\);/g)])
  .map(m => m[1]);
ok(emitted.length === 2 && emitted.every(block =>
  [...block.matchAll(/([a-z_]+):/g)].every(k => ['card_id', 'component', 'deliverable_id', 'client',
    'crosswalk_fields', 'client_roots', 'card_status', 'deliverable_row_present', 'on_allowlist',
    'why'].includes(k[1]))),
  'and every field on an emitted row is a slug, an opaque id, a status, a field name or a count — '
  + 'the two row shapes are pinned here so a future field cannot be added without reading this line');

console.log(failures === 0
  ? '\ncard comment transport split checks passed'
  : '\n' + failures + ' card comment transport split check(s) failed');
process.exit(failures === 0 ? 0 : 1);
