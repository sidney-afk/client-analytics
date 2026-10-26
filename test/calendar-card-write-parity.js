'use strict';
/*
 * calendar-card-write (step 1 of docs/ops/CALENDAR_UPSERT_RETIREMENT_PLAN.md) must answer every save the way
 * calendar-upsert does. This runs both writers' guard code side by side on generated saves:
 *
 *   - calendar-upsert: its own source (supabase/functions/calendar-upsert/index.ts), the pure part cut out and
 *     type-stripped by Node, so the comparison is against the code that is there, not a copy of it.
 *   - calendar-card-write: logic.mjs.
 *
 * Compared: buildIncoming, mergeCell, applyGuards (rows, conflicts and the phantom-row refusal), the update
 * payload, the comment-merge RPC arguments, and the event ledger. The one intended ledger difference is the live
 * writer's role override (an approval is the client's, a Kasper approve, finish or close is Kasper's), which the
 * repo copy of calendar-upsert never received; it is checked on its own below. The one intended difference in the
 * stored row: a blank urgent time is stored as no time (null), where calendar-upsert sends "" and Postgres refuses
 * the save; that is checked on its own too.
 *
 * Then exact cases at the edges the generator rarely hits, each of which went unnoticed when deliberately broken
 * in review (Lighthouse, 2026-10-16): comment and stamp ties in the three-way merge and the stale-save check, and
 * the archived twin the duplicate-link guard must ignore.
 *
 * Then the handler's wiring: staff key required, client tokens refused, the roster switch read by the function.
 */
const fs = require('node:fs');
const path = require('node:path');
const { stripTypeScriptTypes } = require('node:module');

const ROOT = path.join(__dirname, '..');
const OLD_SRC = fs.readFileSync(path.join(ROOT, 'supabase/functions/calendar-upsert/index.ts'), 'utf8');
const NEW_HANDLER = fs.readFileSync(path.join(ROOT, 'supabase/functions/calendar-card-write/index.ts'), 'utf8');

let checks = 0;
function ok(cond, msg) {
  if (!cond) { console.error('FAIL  ' + msg); process.exit(1); }
  checks += 1;
}
function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
// The ledger rows are compared as rows: the key order inside one is not part of what is stored.
const sorted = v => Array.isArray(v) ? v.map(sorted) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, sorted(v[k])])) : v;

/* calendar-upsert's pure part: from the allow-list to the end of buildEvents. */
function loadOld() {
  const start = OLD_SRC.indexOf('const ALLOWED = [');
  const end = OLD_SRC.indexOf('async function insertEvents(');
  if (start < 0 || end < 0) throw new Error('calendar-upsert source moved: the parity cut points are gone');
  const js = stripTypeScriptTypes(OLD_SRC.slice(start, end));
  const factory = new Function('normalizeBrowserWriteClient', 'shouldScanGraphicTweakResolution',
    js + '\nreturn { buildIncoming, mergeCell, applyGuards, scalarPayloadForExisting, updatePayload, stripPrivate, responsePayload, callCommentRpc, buildEvents, mintThumbRev };');
  return factory(norm, () => false);
}
const norm = v => String(v == null ? '' : v).trim().toLowerCase();

(async () => {
  const OLD = loadOld();
  const NEW = await import(path.join(ROOT, 'supabase/functions/calendar-card-write/logic.mjs'));

  // A small seeded generator, so a failure always reproduces.
  let seed = 20261016;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const pick = a => a[Math.floor(rnd() * a.length)];
  const maybe = (p = 0.5) => rnd() < p;
  const STAMPS = ['', '2026-10-01T10:00:00.000Z', '2026-10-05T10:00:00.000Z', '2026-10-10T10:00:00.000Z', '2026-10-15T10:00:00.000Z'];
  const STATUSES = ['', 'In Progress', 'For SMM Approval', 'Kasper Approval', 'Client Approval', 'Tweaks Needed', 'Approved', 'Archived'];
  const LINKS = ['', '__CLEAR_LINK__', 'https://linear.app/x/issue/A-1', 'https://linear.app/x/issue/A-2'];
  const comment = (id, extra) => Object.assign({ id, body: 'b' + id, created_at: pick(STAMPS.slice(1)) }, extra);
  const cell = () => {
    if (maybe(0.3)) return '';
    if (maybe(0.05)) return 'not json';
    const n = Math.floor(rnd() * 4);
    const out = [];
    for (let i = 0; i < n; i++) {
      const c = comment('c' + Math.floor(rnd() * 5), maybe(0.3) ? { updated_at: pick(STAMPS.slice(1)) } : {});
      if (maybe(0.2)) { c.deleted = true; c.updated_at = maybe() ? '2025-01-01T00:00:00.000Z' : pick(STAMPS.slice(1)); }
      out.push(c);
    }
    return JSON.stringify(out);
  };
  const FIELDS = ['caption', 'name', 'scheduled_date', 'status', 'video_status', 'graphic_status', 'caption_status', 'title_status',
    'linear_issue_id', 'graphic_linear_issue_id', 'video_deliverable_id', 'graphic_deliverable_id', 'asset_url', 'thumbnail_url',
    'video_tweaks', 'graphic_tweaks', 'caption_tweaks', 'title_tweaks', 'client_video_approved_at', 'client_caption_approved_at',
    'kasper_approved_at', 'kasper_finished_at', 'kasper_closed_at', 'video_urgent_pinged_at', 'video_urgent_editor',
    'kasper_urgent_pinged_at', 'kasper_urgent_comp', 'cta', 'platforms', 'not_allowed_field'];
  const valueFor = f => {
    if (/_tweaks$/.test(f)) return cell();
    if (/status$/.test(f)) return pick(STATUSES);
    if (/linear_issue_id$/.test(f)) return pick(LINKS);
    if (/deliverable_id$/.test(f)) return pick(['', '__CLEAR_LINK__', 'd1', 'd2']);
    if (/_at$/.test(f)) return pick(STAMPS);
    if (f === 'kasper_urgent_comp') return pick(['', 'video', 'graphic', 'caption', 'title', 'bogus']);
    return maybe(0.3) ? '' : f + '-' + Math.floor(rnd() * 3);
  };
  const existingRow = () => {
    if (maybe(0.2)) return {};
    const row = { id: 'p1', client: 'fixture', updated_at: pick(STAMPS.slice(1)) };
    for (const f of FIELDS) if (maybe(0.5)) row[f] = valueFor(f);
    for (const f of ['video_status_at', 'graphic_status_at', 'caption_status_at', 'title_status_at', 'video_urgent_issue']) if (maybe()) row[f] = pick(STAMPS);
    // Urgent rounds: a component waiting where a ping is allowed, often enough to reach both marker guards.
    if (maybe(0.3)) for (const c of ['video', 'graphic', 'caption', 'title']) if (maybe()) row[c + '_status'] = pick(['Kasper Approval', 'Tweaks Needed']);
    return row;
  };
  const NOW = '2026-10-16T12:00:00.000Z';
  const NOW_MS = Date.parse(NOW);
  const actor = { actor: 'Staff', role: 'smm', source: 'ui' };

  const capture = fn => { try { return { value: fn() }; } catch (e) { return { error: e.message }; } };
  let compared = 0, conflicts = 0, refusals = 0, blankStamps = 0;
  // The intended difference in the stored row (see logic.mjs, NULLABLE_STAMP_COLUMNS).
  const URGENT_STAMPS = ['video_urgent_pinged_at', 'video_urgent_status_at', 'kasper_urgent_pinged_at', 'kasper_urgent_status_at'];
  const blankStampsToNull = row => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, URGENT_STAMPS.includes(k) && v === '' ? null : v]));
  for (let i = 0; i < 4000; i++) {
    const post = { id: 'p1' };
    for (const f of FIELDS) if (maybe(0.25)) post[f] = valueFor(f);
    if (maybe(0.2)) { post.kasper_urgent_pinged_at = pick(STAMPS.slice(1)); post.kasper_urgent_comp = pick(['video', 'graphic', 'caption', 'title']); }
    if (maybe(0.15)) post.video_urgent_pinged_at = pick(STAMPS.slice(1));
    const body = { client: maybe(0.05) ? '' : 'Fixture', post, comments_base_at: maybe(0.6) ? pick(STAMPS) : '' };
    const a = capture(() => OLD.buildIncoming(body, NOW));
    const b = capture(() => NEW.buildIncoming(body, NOW, norm));
    ok(same(a, b), `case ${i}: buildIncoming agrees`);
    if (a.error) continue;
    const incoming = a.value.row;
    const existing = existingRow();
    const twins = maybe(0.5) ? [{ id: maybe(0.8) ? 'p2' : 'p1', status: pick(STATUSES), linear_issue_id: maybe(0.7) && incoming.linear_issue_id ? incoming.linear_issue_id : pick(LINKS) }] : [];
    const readFailed = maybe(0.03);
    const ga = capture(() => OLD.applyGuards({ ...incoming }, existing, twins, readFailed, NOW_MS));
    const gb = capture(() => NEW.applyGuards({ ...incoming }, existing, twins, readFailed, NOW_MS));
    ok(same(ga, gb), `case ${i}: applyGuards agrees (${JSON.stringify(ga).slice(0, 160)} vs ${JSON.stringify(gb).slice(0, 160)})`);
    if (ga.error) { refusals += 1; continue; }
    if (ga.value._conflict) { conflicts += 1; continue; }
    const pa = OLD.stripPrivate(ga.value), pb = NEW.stripPrivate(gb.value);
    if (URGENT_STAMPS.some(k => pa[k] === '')) blankStamps += 1;
    ok(same(blankStampsToNull(pa), pb), `case ${i}: the stored row agrees (a blank urgent time stored as null)`);
    ok(same(OLD.responsePayload(pa), NEW.responsePayload(pb)), `case ${i}: the answer agrees`);
    ok(same(blankStampsToNull(OLD.updatePayload('fixture', OLD.scalarPayloadForExisting(pa))), NEW.updatePayload('fixture', NEW.scalarPayloadForExisting(pb))), `case ${i}: the update payload agrees`);
    let rpcArgs = null;
    await OLD.callCommentRpc({ rpc: async (_name, args) => { rpcArgs = args; return { error: null }; } }, 'fixture', pa);
    ok(same(rpcArgs, NEW.commentRpcArgs('fixture', pb)), `case ${i}: the comment-merge arguments agree`);
    const ea = OLD.buildEvents('fixture', pa, incoming, existing, actor, NOW);
    const eb = NEW.buildEvents('fixture', pb, incoming, existing, actor, NOW);
    const overridden = e => /^approve_/.test(e.action) ? 'client' : /^kasper_(approve|finish|close)$/.test(e.action) ? 'kasper' : e.role;
    ok(same(sorted(ea.map(e => ({ ...e, role: overridden(e) }))), sorted(eb)), `case ${i}: the ledger agrees (with the live role override)`);
    compared += 1;
  }
  ok(compared > 1500 && conflicts > 50 && refusals > 20 && blankStamps > 50, `the generator reached every branch (${compared} saved, ${conflicts} conflicts, ${refusals} refusals, ${blankStamps} blank urgent times)`);

  /* The Retry that failed live (2026-10-16): a whole-card save of a card that was never pinged carries the four
     urgent times blank. calendar-upsert stores "" (Postgres refuses it: "calendar update failed"); this writer
     stores no time. A blank still never replaces a stored time: the marker guards put the stored one back first. */
  {
    const never = { id: 'p1', updated_at: STAMPS[1], video_status: 'In Progress' };
    const blank = { id: 'p1', caption: 'kept', video_urgent_pinged_at: null, video_urgent_status_at: null, kasper_urgent_pinged_at: null, kasper_urgent_status_at: null };
    const inc = NEW.buildIncoming({ client: 'Fixture', post: blank }, NOW, norm).row;
    const oldRow = OLD.stripPrivate(OLD.applyGuards({ ...inc }, never, [], false, NOW_MS));
    const newRow = NEW.stripPrivate(NEW.applyGuards({ ...inc }, never, [], false, NOW_MS));
    ok(URGENT_STAMPS.every(k => oldRow[k] === ''), 'calendar-upsert sends the never-pinged card\'s urgent times as "", which Postgres refuses');
    ok(URGENT_STAMPS.every(k => newRow[k] === null) && newRow.caption === 'kept', 'calendar-card-write stores them as no time, and the rest of the save goes through');
    ok(URGENT_STAMPS.every(k => NEW.responsePayload(newRow)[k] === ''), 'the answer still says "" for no time, as calendar-upsert\'s does');
    const pinged = { ...never, video_urgent_pinged_at: STAMPS[2], kasper_urgent_pinged_at: STAMPS[3], kasper_urgent_status_at: STAMPS[3], kasper_urgent_comp: 'graphic' };
    const kept = NEW.stripPrivate(NEW.applyGuards({ ...inc }, pinged, [], false, NOW_MS));
    ok(kept.video_urgent_pinged_at === STAMPS[2] && kept.kasper_urgent_pinged_at === STAMPS[3] && kept.kasper_urgent_status_at === STAMPS[3],
      'a blank urgent time never replaces a stored one');
  }

  /* Ties in the comment merge and the stale-save check. Changing any of these three ">" to ">=" in either writer
     changes an answer below. Both writers are held to them. */
  for (const [W, name] of [[OLD, 'calendar-upsert'], [NEW, 'calendar-card-write']]) {
    const T = '2026-10-10T10:00:00.000Z';
    const cellOf = s => JSON.parse(s || '[]');
    // The same comment at the same time on both sides: the incoming copy is the one kept.
    const tie = cellOf(W.mergeCell(JSON.stringify([{ id: 'c1', body: 'stored', updated_at: T }]), JSON.stringify([{ id: 'c1', body: 'mine', updated_at: T }]), T, NOW_MS));
    ok(tie.length === 1 && tie[0].body === 'mine', `${name}: a comment edited at the same time on both sides keeps the incoming copy`);
    const newer = cellOf(W.mergeCell(JSON.stringify([{ id: 'c1', body: 'stored', updated_at: STAMPS[4] }]), JSON.stringify([{ id: 'c1', body: 'mine', updated_at: T }]), T, NOW_MS));
    ok(newer.length === 1 && newer[0].body === 'stored', `${name}: a comment stored later than the incoming copy wins`);
    // A stored comment the save left out: dropped if this screen had seen it (stamp at or before the base), kept if it came later.
    const seen = cellOf(W.mergeCell(JSON.stringify([{ id: 'c2', body: 'seen', created_at: T }]), '[]', T, NOW_MS));
    ok(seen.length === 0, `${name}: a stored comment from exactly the screen's base time, left out of the save, is dropped`);
    const later = cellOf(W.mergeCell(JSON.stringify([{ id: 'c3', body: 'later', created_at: STAMPS[4] }]), '[]', T, NOW_MS));
    ok(later.length === 1 && later[0].body === 'later', `${name}: a stored comment newer than the screen's base survives a save that never saw it`);
    // The stale-save check: a row stored at exactly the base time is not "changed since".
    const atBase = W.applyGuards({ id: 'p1', updated_at: NOW, caption: 'new', _baseAt: T }, { id: 'p1', updated_at: T, caption: 'old' }, [], false, NOW_MS);
    ok(atBase._conflict === false && atBase.caption === 'new', `${name}: a card stored at exactly the screen's base time saves`);
    const afterBase = W.applyGuards({ id: 'p1', updated_at: NOW, caption: 'new', _baseAt: T }, { id: 'p1', updated_at: STAMPS[4], caption: 'old' }, [], false, NOW_MS);
    ok(afterBase._conflict === true && afterBase.conflict === true, `${name}: a card changed after the screen's base time is a conflict`);
  }

  /* The duplicate-link guard ignores an archived twin and only an archived one. */
  for (const [W, name] of [[OLD, 'calendar-upsert'], [NEW, 'calendar-card-write']]) {
    const L = 'https://linear.app/x/issue/A-1';
    const mine = { id: 'p1', updated_at: STAMPS[1], linear_issue_id: '' };
    const save = { id: 'p1', updated_at: NOW, linear_issue_id: L };
    const guarded = twin => W.applyGuards({ ...save }, mine, [twin], false, NOW_MS);
    ok(guarded({ id: 'p2', status: 'Archived', linear_issue_id: L }).linear_issue_id === L, `${name}: a link held only by an archived card can be set`);
    ok(guarded({ id: 'p2', status: ' ARCHIVED ', linear_issue_id: L }).linear_issue_id === L, `${name}: "archived" is read in any case and spacing`);
    for (const st of ['In Progress', 'Approved', '', 'Archived later']) {
      ok(guarded({ id: 'p2', status: st, linear_issue_id: L }).linear_issue_id === '', `${name}: a link a live card holds (status "${st}") is refused`);
    }
    ok(guarded({ id: 'p1', status: 'In Progress', linear_issue_id: L }).linear_issue_id === L, `${name}: the card itself is not its own twin`);
    const created = W.applyGuards({ id: 'p9', updated_at: NOW, name: 'new', linear_issue_id: L }, {}, [{ id: 'p2', status: 'Archived', linear_issue_id: L }], false, NOW_MS);
    ok(created.linear_issue_id === L, `${name}: a new card may take a link only an archived card holds`);
    const createdLive = W.applyGuards({ id: 'p9', updated_at: NOW, name: 'new', linear_issue_id: L }, {}, [{ id: 'p2', status: 'Client Approval', linear_issue_id: L }], false, NOW_MS);
    ok(createdLive.linear_issue_id === '', `${name}: a new card may not take a link a live card holds`);
  }

  ok(same(OLD.mintThumbRev('abc', NOW), NEW.mintThumbRev('abc', NOW)) && NEW.mintThumbRev(Date.parse(NOW).toString(36), NOW) !== Date.parse(NOW).toString(36), 'thumb_rev minting agrees and never repeats');

  // The ledger source is the live writer's: three automation sources pass, anything else is "ui".
  ok(['linear', 'reconcile', 'auto-posted'].every(s => NEW.ledgerSource(s) === s), 'automation sources pass through');
  ok(['', null, 'calendar-component-fill', 'calendar-native', 'UI', 'x'].every(s => NEW.ledgerSource(s) === 'ui'), 'every other source is recorded as ui');

  // The roster switch fails closed.
  ok(NEW.rosterAllows({ clients: ['fixture'] }, 'fixture') && NEW.rosterAllows({ all: true }, 'fixture'), 'a listed client, or all, is on');
  ok(![null, undefined, [], 'x', { clients: [] }, { clients: 'fixture' }, { enabled: true }, { all: 'true' }].some(v => NEW.rosterAllows(v, 'fixture')), 'no row, a malformed value or an empty roster is off');
  ok(!NEW.rosterAllows({ clients: ['other'] }, 'fixture') && !NEW.rosterAllows({ clients: ['fixture'] }, ''), 'an unlisted or empty client is off');

  // The handler's wiring.
  ok(/const principal = await authorizeBrowserWrite\(supabase, req, client, FN\);\s*if \(principal\.kind !== "staff"\) throw new Refusal\(403, "client_path_not_enabled"\);\s*await assertRosterAllows\(supabase, client\);/.test(NEW_HANDLER),
    'a staff key is required, a client token is refused, and the roster is checked before any read or write');
  ok(/\.from\("syncview_runtime_flags"\)\s*\.select\("value"\)\s*\.eq\("key", FLAG_KEY\)/.test(NEW_HANDLER) && /if \(error\) throw new Refusal\(503, "switch_unreadable"\);/.test(NEW_HANDLER),
    'the function reads its own switch and an unreadable switch refuses');
  ok(NEW.FLAG_KEY === 'calendar_card_write_clients', 'the switch key');
  // OPEN_REPAIRS 508: a save that took too long inside the function is refused just before the write, under the page's 20 s timer.
  ok(NEW.WRITE_DEADLINE_MS === 15000 && NEW.WRITE_DEADLINE_MS < 20000, 'the write deadline is 15 s, under the page\'s 20 s timer');
  ok(!NEW.pastWriteDeadline(1000, 1000) && !NEW.pastWriteDeadline(1000, 16000) && NEW.pastWriteDeadline(1000, 16001) && NEW.pastWriteDeadline(0, 131644),
    'past the deadline only after more than 15 s (the 2026-10-26 stall, 131644 ms, is refused)');
  ok(/const existsAlready = !!\(existingRead\.row && existingRead\.row\.id\);\s*(\/\/[^\n]*\n\s*)?if \(pastWriteDeadline\(started, Date\.now\(\)\)\) throw new Refusal\(503, "too_late"\);\s*await writeCalendarRow\(/.test(NEW_HANDLER),
    'the deadline is checked immediately before the write, after every read, and refuses with 503 too_late');
  ok(NEW_HANDLER.indexOf('pastWriteDeadline(started') < NEW_HANDLER.indexOf('await writeCalendarRow(') && /const started = Date\.now\(\);\s*if \(req\.method === "OPTIONS"\)/.test(NEW_HANDLER),
    'the clock starts when the request arrives');
  ok(/const FN = "calendar-card-write";/.test(NEW_HANDLER) && /fn: FN,/.test(NEW_HANDLER), 'its log line names this function, apart from calendar-upsert');
  ok(/supabase\.rpc\("calendar_merge_comments", args\)/.test(NEW_HANDLER) && /\.from\("calendar_post_events"\)\.insert\(events\)/.test(NEW_HANDLER), 'comments merge through the same RPC and the same ledger table');
  ok(!/x-syncview-client-token[^\n]*review_token/.test(NEW_HANDLER) && !/\bservice_role\b/.test(NEW_HANDLER.replace(/SUPABASE_SERVICE_ROLE_KEY/g, '')), 'no client-token shortcut and no other service-role path');

  console.log(`calendar-card-write-parity: ${checks} checks passed (${compared} generated saves compared with calendar-upsert)`);
})().catch(e => { console.error(e); process.exit(1); });
