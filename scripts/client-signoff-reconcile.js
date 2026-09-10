'use strict';
/*
 * Client review ⇄ card reconciler — the server-side completion of a client's
 * committed review action.
 *
 *   node scripts/client-signoff-reconcile.js                  # DRY-RUN: report only
 *   node scripts/client-signoff-reconcile.js --apply          # apply repairs
 *   node scripts/client-signoff-reconcile.js --client=<slug>  # scope to one client
 *   node scripts/client-signoff-reconcile.js --fixtures=f.json --json   # offline
 *
 * WHY THIS EXISTS (OPEN_REPAIRS 186/189/190/191)
 *   A client review action writes TWO legs: the gateway's deliverable row, then
 *   the `calendar_posts` row humans actually read. The gateway leg is durable —
 *   `mirror_outbox` records that it committed. The card leg runs in the client's
 *   browser, and a repair journal finishes it ONLY in that browser and ONLY if
 *   she comes back. She met an error, reported it and closed the tab, so a write
 *   the server had already committed stayed unfinished with nothing server-side
 *   able to complete it (item 189, "the completion of a committed write still
 *   depends on one particular browser session surviving").
 *
 *   This closes that. A committed client action whose card never received it is
 *   a repairable FACT, visible without any browser.
 *
 * THE RULE — evidence repairs, it never invents
 *   Every repair is driven by something the SERVER already committed, and every
 *   value written comes from that record:
 *     · a sign-off stamp is the commit time of the client's approve, never "now"
 *       and never derived from the status (deriving a stamp from a status is the
 *       exact lie item 190 is about, pointing the other way);
 *     · a change request's body, author, round and clock come from
 *       `production_comments`, never reconstructed.
 *   If the server has no record, this job does nothing. It is a completion
 *   mechanism, not a source of truth.
 *
 * THE RULE — a card that has moved on is never overwritten
 *   A committed action can be superseded by later work, and finishing a stale
 *   write would undo it. So:
 *     · a sign-off stamp is only restored where the app's OWN stale-approval
 *       rule (`_calClearStaleApprovals`, extracted from index.html at runtime)
 *       would keep it. If that rule would clear it, the component has moved
 *       below client approval and the approval is superseded — report, never
 *       write. This is the same rule the browser fix in item 191 applies, so the
 *       two can never disagree about what "stale" means.
 *     · a change request is only delivered while the component is still IN the
 *       review round (Client Approval / Tweaks Needed). Once it reads Approved,
 *       re-injecting a Tweaks-Needed request would reopen settled work and
 *       contradict a later decision, which is worse than the omission it fixes.
 *
 * SAFETY
 *   - DRY-RUN BY DEFAULT. Writes only with --apply (or APPLY=true).
 *   - CAP: a run wanting more repairs than the cap ABORTS without writing. A
 *     mass divergence is a bug or an incident, and a human should look before
 *     hundreds of client-facing rows move.
 *   - Writes go only through `calendar-upsert`, the same safe endpoint the other
 *     reconcilers use, so the overall pill and the stale-approval sweep are
 *     recomputed by the canonical path rather than by anything written here.
 *   - Reads need SUPABASE_SERVICE_ROLE_KEY (`mirror_outbox` and
 *     `production_comments` are not readable with the publishable key); writes
 *     need SYNCVIEW_STAFF_KEY. Neither is ever printed.
 *   - --fixtures runs the entire decision path offline with no credentials and
 *     no network, which is how the tests exercise it.
 */
const fs = require('fs');
const path = require('path');

const ARGV = process.argv.slice(2);
const argOf = (name) => {
  const hit = ARGV.find(a => a === '--' + name || a.startsWith('--' + name + '='));
  if (!hit) return '';
  return hit.includes('=') ? hit.slice(hit.indexOf('=') + 1) : 'true';
};
const APPLY = ARGV.includes('--apply') || /^(1|true|yes)$/i.test(process.env.APPLY || '');
const JSON_OUT = ARGV.includes('--json');
/* The cap is a free-form workflow input, so it has to be VALIDATED, not just
 * coerced. `Number('25x')` is NaN, every comparison with NaN is false, and the
 * advertised mass-repair abort would silently pass an unlimited plan. */
const CAP_RAW = String(process.env.CAP || argOf('cap') || '25').trim();
const CAP = Number(CAP_RAW);
if (!Number.isInteger(CAP) || CAP <= 0) {
  console.error(`client-signoff-reconcile: cap must be a positive whole number, got ${JSON.stringify(CAP_RAW)}`);
  process.exit(2);
}
const ONLY_CLIENT = String(argOf('client') || process.env.ONLY_CLIENT || '').trim().toLowerCase();
const FIXTURES = String(argOf('fixtures') || '').trim();
const LOOKBACK_DAYS = Number(process.env.LOOKBACK_DAYS || argOf('days') || 180);

const REST = 'https://uzltbbrjidmjwwfakwve.supabase.co/rest/v1';
const UPSERT_EF_URL = 'https://uzltbbrjidmjwwfakwve.supabase.co/functions/v1/calendar-upsert';
const SERVICE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const SYNCVIEW_STAFF_KEY = String(process.env.SYNCVIEW_STAFF_KEY || '').trim();

const lines = [];
const log = (m) => { lines.push(m); if (!JSON_OUT) console.log(m); };

/* ── canonical logic, extracted verbatim from index.html ──────────────────
 * The stale-approval rule and the overall-status computation must be the app's
 * own, not a copy: a second implementation of "is this approval stale" is a
 * second opinion, and the two would drift. Same technique as
 * scripts/linear-sync-reconcile.js. */
const SRC = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const grabFunc = (name) => {
  const at = SRC.indexOf('function ' + name + '(');
  if (at < 0) throw new Error('fn ' + name);
  let depth = 0;
  for (let j = SRC.indexOf('{', at); j < SRC.length; j++) {
    if (SRC[j] === '{') depth++;
    else if (SRC[j] === '}' && --depth === 0) return SRC.slice(at, j + 1);
  }
  throw new Error('braces ' + name);
};
const grabConst = (name) => SRC.match(new RegExp('^\\s*const ' + name + '\\s*=.*;\\s*$', 'm'))[0];
const mod = new Function([
  grabConst('CAL_STATUSES'), grabConst('CAL_PRIORITY'), grabConst('CAL_COMPONENTS'),
  grabFunc('_calNormStatus'), grabFunc('computeOverallStatus'), grabFunc('_calClearStaleApprovals'),
  grabFunc('_calMapNativeStatusStrict'),
].join('\n') + ';return { CAL_PRIORITY, _calNormStatus, computeOverallStatus, _calClearStaleApprovals, _calMapNativeStatusStrict };')();
const { CAL_PRIORITY, _calNormStatus, computeOverallStatus, _calClearStaleApprovals, _calMapNativeStatusStrict } = mod;

/* Does a later committed transition REOPEN the component, i.e. take it back
 * below Approved? Ranked with the app's own CAL_PRIORITY after the app's own
 * native mapper, so this cannot drift from the lifecycle the product defines.
 * An unmapped native status (canceled, triage, anything unrecognised) counts as
 * a reopen: fail closed, because the safe answer is to leave the card alone. */
function reopensBelowApproved(nativeStatus) {
  const mapped = _calMapNativeStatusStrict(nativeStatus);
  if (!mapped) return true;
  const rank = CAL_PRIORITY[mapped];
  return !(typeof rank === 'number' && rank >= CAL_PRIORITY['Approved']);
}

/* A deliverable's `kind` and the card's component vocabulary are not the same
 * word for the graphic lane; everything downstream speaks the card's. */
/* WHAT THIS JOB IS ALLOWED TO WRITE.
 *
 * Stamp repair only. Change-request DELIVERY is detected and reported, never
 * written — an owner decision taken after eight review rounds and 23 findings,
 * of which nearly every one since round 2 landed on delivery rather than on
 * stamps, and the last three rounds were each a defect created by the previous
 * round's fix. OPEN_REPAIRS 189 records the same pattern on the browser-side
 * attempt at this problem, abandoned for the same reason.
 *
 * The asymmetry is in the problems themselves, not in the effort spent:
 *   · a STAMP repair reads a committed approve, checks for a later reopen and
 *     writes one dated field. Nothing to match, nothing to merge.
 *   · a DELIVERY must decide identity across two systems with no shared ids,
 *     reconcile two lifecycle clocks, merge into a cell whose format predates
 *     ids, and survive a non-atomic two-step write. Round 8 ended at 8 live
 *     rows where the data cannot say whether delivering is a repair or a
 *     duplicate.
 *
 * Detection stays fully wired, because the report is the deliverable for that
 * half: it tells a person exactly which requests never reached a card. The
 * guard lives at the WRITE, so no future edit to detection can make delivery
 * writable by accident. */
const WRITABLE_KINDS = new Set(['stamp']);

const COMPONENT_FOR_KIND = {
  video: 'video', thumbnail: 'graphic', graphic: 'graphic', caption: 'caption', title: 'title',
};
/* The card side of the crosswalk. Only the two components that carry a work
 * item have a reverse pointer; caption and title never do
 * (`_writeUiComponentHasWorkItem`, index.html). */
const REVERSE_LINK_FIELD = { video: 'video_deliverable_id', graphic: 'graphic_deliverable_id' };
/* The inverse of the app's own `_prodCrosswalkTeamForComponent` (index.html).
 * Note `graphics` (the team) against `graphic` (the component): the card's
 * vocabulary and the deliverable's are not the same word here either. */
const COMPONENT_FOR_TEAM = { video: 'video', graphics: 'graphic' };
/* Cards live on the calendar surface; `samples` deliverables belong to sxr and
 * `manual` ones to neither (PROD_CROSSWALK_SURFACE_ORIGIN, index.html). */
const SURFACE_ORIGIN_FOR_CARDS = 'calendar';

const STAMP_FIELD = (comp) => 'client_' + comp + '_approved_at';
const TWEAKS_FIELD = (comp) => comp + '_tweaks';
const STATUS_FIELD = (comp) => comp + '_status';

/* Comments live in one per-component cell as a JSON array (index.html
 * `_calStringifyComments`). Parsing it is what makes the body comparison
 * trustworthy: comparing the raw cell as text reports a false miss on every
 * request containing a quote or a newline, because the cell stores those
 * JSON-escaped. */
function parseComments(cell) {
  const raw = String(cell || '').trim();
  if (!raw) return [];
  let list;
  try {
    list = JSON.parse(raw);
  } catch (_) {
    return null;   // unreadable: the caller must skip, never treat it as empty
  }
  /* Valid JSON that is not an array, or an array holding entries WITHOUT ids,
   * is an INCOMPLETE read, not an empty one — the same judgement the browser's
   * `_calLoadCommentsField` makes. Treating either as empty is how a repair
   * erases legacy feedback: `stringifyComments` and the merge RPC drop id-less
   * entries, so writing a rebuilt array over a cell holding them destroys real
   * client words that simply predate the id field. Refuse instead. */
  if (!Array.isArray(list)) return null;
  const objects = list.filter(c => c && typeof c === 'object');
  if (objects.length !== list.length) return null;
  if (objects.some(c => !c.id)) return null;
  return objects;
}
function stringifyComments(list) {
  const keep = Array.isArray(list) ? list.filter(c => c && c.id) : [];
  return keep.length ? JSON.stringify(keep) : '';
}
const normText = (s) => String(s == null ? '' : s).normalize('NFC').replace(/\s+/g, ' ').trim();

/* ── reads ──────────────────────────────────────────────────────────────── */
/* Offset pagination without a total order is not stable: each page is a separate
 * query and the database may order them differently, so a row can be skipped or
 * repeated between pages. The outbox read alone exceeds one page. A SKIPPED row
 * is the dangerous direction here — if it is a later reopen, the supersession
 * test never sees it and a stale approval gets restored. Every paged read is
 * therefore ordered by a unique column. */
async function restRows(table, query, orderBy) {
  /* The order column is checked FIRST: a missing one is a defect in this file,
   * true in every environment, while a missing credential is environmental. */
  if (!orderBy) throw new Error(`restRows(${table}) needs a unique order column`);
  if (!SERVICE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required (or use --fixtures)');
  const out = [];
  let offset = 0;
  const page = 1000;
  for (;;) {
    const url = `${REST}/${table}?${query}&order=${orderBy}.asc&limit=${page}&offset=${offset}`;
    const res = await fetch(url, {
      headers: { apikey: SERVICE_KEY, Authorization: 'Bearer ' + SERVICE_KEY, Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`${table}: HTTP ${res.status}`);
    const rows = await res.json();
    if (!Array.isArray(rows)) throw new Error(`${table}: unexpected payload`);
    out.push(...rows);
    if (rows.length < page) break;
    offset += page;
  }
  return out;
}

async function loadWorld() {
  if (FIXTURES) {
    const raw = JSON.parse(fs.readFileSync(FIXTURES, 'utf8'));
    return {
      outbox: raw.outbox || [], comments: raw.comments || [],
      deliverables: raw.deliverables || [], cards: raw.cards || [],
    };
  }
  const since = new Date(Date.now() - LOOKBACK_DAYS * 864e5).toISOString();
  const [outbox, comments, deliverables] = await Promise.all([
    /* NOTE THE MISSING STATUS FILTER, AND `source_edited_at`.
     * A row exists in `mirror_outbox` because the NATIVE write committed; its
     * `status` describes what the Linear carrier did afterwards (`written`,
     * `skipped`, `stale`, and `pending` while in flight). Filtering on
     * `written` therefore equates outbound delivery with source commit, which
     * hides a reopen whose delivery is pending or was skipped — and an
     * invisible reopen is exactly what lets a stale approval be restored.
     * So every row is read, and the two uses are deliberately ASYMMETRIC
     * below: broad evidence for "leave it alone", narrow evidence for "repair".
     * `source_edited_at` is the client's own write clock and must be selected
     * or the code that prefers it silently falls back to `created_at`. */
    restRows('mirror_outbox',
      'select=entity_id,operation,status,entity,payload,source_edited_at,processed_at,created_at,'
      + 'role,client_slug,test_only'
      + `&operation=eq.status&entity=eq.deliverable&created_at=gte.${since}`, 'id'),
    restRows('production_comments',
      'select=id,native_comment_id,deliverable_id,client_slug,component,body,author_name,role,is_tweak,'
      + 'round,audience,created_at,updated_at,deleted_at,resolved_at,resolved_by_name'
      + `&role=eq.client&is_tweak=is.true&created_at=gte.${since}`, 'id'),
    restRows('deliverables', 'select=id,card_id,kind,team,origin,client_slug,status,status_at', 'id'),
  ]);
  const cardIds = new Set(deliverables.map(d => d && d.card_id).filter(Boolean));
  const cards = [];
  const ids = [...cardIds];
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200).map(encodeURIComponent).join(',');
    cards.push(...await restRows('calendar_posts',
      'select=id,client,name,status,video_status,graphic_status,caption_status,'
      + 'title_status,video_tweaks,graphic_tweaks,caption_tweaks,title_tweaks,updated_at,'
      + 'client_video_approved_at,client_graphic_approved_at,client_caption_approved_at,'
      + 'client_title_approved_at,kasper_approved_at,'
      + 'video_deliverable_id,graphic_deliverable_id'
      + `&id=in.(${chunk})`, 'id'));
  }
  return { outbox, comments, deliverables, cards };
}

/* ── detection ──────────────────────────────────────────────────────────── */

/* Would the app's own rule keep a client sign-off on a component sitting at
 * this status? Asking the rule itself, rather than restating which statuses
 * count as "at or past client approval", is what guarantees this job and the
 * browser can never disagree about staleness. */
function stampSurvives(card, comp, stampValue) {
  const clone = Object.assign({}, card, { [STAMP_FIELD(comp)]: stampValue });
  const edits = { [STAMP_FIELD(comp)]: stampValue };
  _calClearStaleApprovals(clone, edits);
  return edits[STAMP_FIELD(comp)] === stampValue && clone[STAMP_FIELD(comp)] === stampValue;
}

/* Could this card entry be a client's own change-request root? Staff-authored
 * entries, replies and deleted entries never represent one. Absent role is
 * allowed (legacy rows predate the field); an explicit staff role is not. */
const STAFF_ROLES = new Set(['kasper', 'smm', 'admin', 'editor', 'designer', 'system']);
function couldBeClientTweak(entry) {
  if (!entry) return false;
  if (entry.deleted === true) return false;
  if (entry.parent_id) return false;
  const role = String(entry.role || '').trim().toLowerCase();
  return !STAFF_ROLES.has(role);
}

/* calendar_posts is keyed by (client, id), NOT by id alone: 13 live card ids are
 * used by more than one client, and 17 deliverables point at one of them. Keying
 * anything here by id alone lets one client's card stand in for another's, which
 * on an apply run would write a client's approval or their words onto a
 * different client's card. Every lookup, consumption key and re-read is
 * therefore composite. */
const cardKey = (client, id) => String(client || '').trim().toLowerCase() + '|' + String(id || '');

function detect(world) {
  const cardById = new Map(world.cards.map(c => [cardKey(c.client, c.id), c]));
  const delById = new Map(world.deliverables.map(d => [String(d.id), d]));
  const findings = [];
  const skipped = [];

  /* EVERY ROW THAT TAKES PART IN A REPAIR MUST AGREE ABOUT THE CLIENT, and the
   * check belongs in ONE place rather than being rediscovered per table.
   *
   * `scripts/move-card-client.js` moves a card between clients by rewriting
   * `calendar_posts.client` and `deliverables.client_slug`; historical rows in
   * `mirror_outbox` and `production_comments` keep the client they were written
   * for. Round 9 closed this for the outbox and round 10 found the identical
   * hole one table over, which is the argument for making it structural: the
   * caller MUST pass the client its own row carries, so a future source cannot
   * be wired in without answering the question.
   *
   * An absent client is not a conflict (legacy rows), but a DIFFERENT one is. */
  /* A plain function, not an arrow, so `arguments.length` can tell "the caller
   * did not pass a client" (a programming error) from "this row's client column
   * is empty" (legitimate, and treated as absent rather than conflicting). A
   * default parameter cannot distinguish those: it fires on `undefined` too. */
  function resolve(deliverableId, rowClient) {
    if (arguments.length < 2) throw new Error("resolve() needs the row's own client");
    const del = delById.get(String(deliverableId || ''));
    /* THE CLIENT SCOPE COMES FIRST, before any refusal is produced. A run
     * advertised as limited to one client must not report another client's rows
     * or count them — the operator would be sent to investigate work they did
     * not ask about. Scoped on the row's own client (or the deliverable's) since
     * the refusals below are precisely the cases where no card is identified. */
    if (ONLY_CLIENT) {
      /* THE ROW'S OWN CLIENT WINS. After `move-card-client.js` runs, historical
       * outbox and comment rows still carry the PREVIOUS client while the
       * deliverable carries the new one — preferring the deliverable would put
       * A's historical rows in a `--client=B` run and hide them from
       * `--client=A`, the exact opposite of row-owned scope. The deliverable is
       * the legacy fallback, for rows whose own client column is empty. */
      const scope = String(rowClient || (del && del.client_slug) || '').trim().toLowerCase();
      if (scope && scope !== ONLY_CLIENT) return null;
    }
    /* STRUCTURAL FAILURES ARE REPORTABLE; INTENTIONAL SUPPRESSION IS NOT.
     * `null` used to mean both, so a client approval whose deliverable is
     * missing, carries no card_id or no client, or names a card that is not
     * there, vanished from the report exactly like an archived card that is
     * meant to be ignored. Those are opposite things: one is a lost approval
     * nobody will hear about, the other is a decision. From here `null` means
     * ONLY "deliberately out of scope" — archived, or another client on a
     * scoped run — and everything else names itself. */
    if (!del) return 'deliverable_unknown';
    /* ANOTHER SURFACE IS OUT OF SCOPE, NOT A BROKEN CROSSWALK — and this test
     * has to come BEFORE the card lookup, or a Samples deliverable fails to
     * find a `calendar_posts` row and is escalated as a lost Calendar approval.
     * Its card is not missing; it lives on the Samples surface, which this job
     * does not read. Live: 2 of the 227 committed client approvals are Samples,
     * and both would have been reported as lost. False alerts bury the real
     * ones, which is the entire argument for the report being short. */
    if (SURFACE_ORIGIN_FOR_CARDS !== String(del.origin || '').trim().toLowerCase()) return null;
    if (!String(del.card_id || '').trim()) return 'deliverable_names_no_card';
    /* No client on the deliverable means the card cannot be identified, and
     * guessing is what this whole guard exists to prevent. */
    if (!String(del.client_slug || '').trim()) return 'deliverable_names_no_client';
    const card = cardById.get(cardKey(del.client_slug, del.card_id));
    if (!card) return 'card_not_found';
    const owner = String(rowClient || '').trim().toLowerCase();
    if (owner && owner !== String(card.client || '').trim().toLowerCase()) return 'client_mismatch';
    /* CARRYING A CARD ID IS NOT THE SAME AS BEING LINKED TO THAT CARD.
     *
     * `deliverables.card_id` is a plain text column with NO foreign key
     * (migrations/2026-07-06-b1-linear-data-model.sql), and it is written by
     * one side only. The product's own canonical rule is the full crosswalk:
     * `_prodCrosswalkMismatchFields` in index.html accepts a deliverable as
     * describing a card only when origin, team, client_slug and card_id all
     * agree, and refuses to treat a half-link as linked precisely because
     * acting on one destroys real data. F42 recorded the live evidence: every
     * deliverable with origin='manual' carries no card_id at all, so a
     * card-side-only link produces exactly this state.
     *
     * Following the one-way pointer alone would let a Samples deliverable whose
     * card_id happens to name an existing same-client calendar card, or a stale
     * pointer left behind by a re-link, produce a WRITABLE stamp on a card that
     * never had anything to do with this approval.
     *
     * So the link must close both ways: this deliverable's own component slot
     * on the card must name this deliverable back. That subsumes the team half
     * of the crosswalk (video work reverse-links through
     * `video_deliverable_id`, graphic work through `graphic_deliverable_id`),
     * and it is checked HERE, next to the client rule, for the same reason
     * round 10 moved that one here: identity questions answered per call site
     * get answered inconsistently.
     *
     * Live shape at the time of writing: of the calendar-origin deliverables
     * carrying a card_id, every one reverse-links correctly, and every
     * Samples-origin card_id resolves to no same-client calendar card at all.
     * Zero rows are affected today. One re-link or one id collision creates
     * one silently, and it would be a write. */
    /* TEAM IS ITS OWN FIELD IN THE CANONICAL PREDICATE, and `kind` and `team`
     * are independently constrained columns, so the reverse-link slot — which
     * is derived from one of them — cannot stand in for the other. A row
     * carrying kind='video' with team='graphics' would otherwise pass on a
     * matching `video_deliverable_id` and write a client VIDEO stamp.
     *
     * Deriving the slot from TEAM rather than kind is what makes this the
     * canonical check instead of a lookalike: `_prodCrosswalkTeamForComponent`
     * is the app's own component→team map, and it is also what gives kind
     * `other` (live, team='graphics') a defensible slot instead of the weaker
     * "either slot will do" rule this replaces. Where `kind` DOES map to a
     * component it must agree, since a disagreement means the row cannot say
     * which review it belongs to at all. */
    const teamComp = COMPONENT_FOR_TEAM[String(del.team || '').trim().toLowerCase()];
    if (!teamComp) return 'unknown_team';
    const kindComp = COMPONENT_FOR_KIND[String(del.kind || '').toLowerCase()];
    if (kindComp && kindComp !== teamComp) return 'kind_and_team_disagree';
    const id = String(del.id || '').trim();
    if (!id || String(card[REVERSE_LINK_FIELD[teamComp]] || '').trim() !== id) {
      return 'card_does_not_link_back';
    }
    /* Archived is the card's OVERALL status, not a column — same test
     * scripts/linear-sync-reconcile.js applies. */
    if (String(card.status || '').toLowerCase() === 'archived') return null;
    /* Re-checked against the CARD's own client: the early scope test used the
     * deliverable's, and a card mid-move can disagree with it. */
    if (ONLY_CLIENT && String(card.client || '').toLowerCase() !== ONLY_CLIENT) return null;
    /* The component travels WITH the resolution, from the same validated team
     * that chose the reverse-link slot. Deriving it again at the call site from
     * `kind` is what silently dropped a `kind='other'` approval: resolve()
     * accepted it through the graphic slot and the caller then produced neither
     * a repair nor a skip. Same argument as the client rule — one place. */
    return { del, card, component: teamComp };
  }

  /* A. A committed client APPROVE whose card carries no sign-off stamp.
   * Keyed to the latest committed approve per (card, component): a later
   * approval is the operative sign-off, and an earlier one would understate
   * when the client actually signed. */
  /* Every committed status transition, by deliverable, so a later REOPEN can be
   * seen. The read now carries all roles: a client's approval is just as
   * superseded by a designer reopening the work as by another client action. */
  const transitionsByDeliverable = new Map();
  for (const row of world.outbox) {
    if (!row || row.test_only === true) continue;
    const key = String(row.entity_id || '');
    if (!key) continue;
    if (!transitionsByDeliverable.has(key)) transitionsByDeliverable.set(key, []);
    transitionsByDeliverable.get(key).push({
      at: String(row.source_edited_at || row.created_at || row.processed_at || ''),
      status: String((row.payload && row.payload.status) || '').toLowerCase(),
    });
  }

  /* A LATER CLIENT CHANGE REQUEST SUPERSEDES AN APPROVAL, and the outbox cannot
   * always say so. A tweak commits its comment leg and its status leg
   * separately; when the status leg fails, no transition exists for the reopen
   * test to find, and the card can still read Approved. Restoring the older
   * stamp there claims the client signed off on work they had since asked to
   * change — while this same run separately reports their request as
   * `review_round_closed`. The two halves of one contradiction.
   *
   * `world.comments` is already filtered to committed, non-deleted client
   * tweaks, so their clock is available without another read.
   * Live: none of the four repair candidates has a later client request, so
   * this changes no repair today. It is the falsest positive this job could
   * produce, which is why it is checked anyway. */
  const latestClientRequest = new Map();
  for (const pc of world.comments) {
    if (!pc || pc.deleted_at) continue;
    const id = String(pc.deliverable_id || '');
    if (!id) continue;
    const at = String(pc.created_at || '');
    const prev = latestClientRequest.get(id);
    if (!prev || Date.parse(at) > Date.parse(prev)) latestClientRequest.set(id, at);
  }
  const supersededByRequest = (deliverableId, approvedAt) => {
    const req = latestClientRequest.get(String(deliverableId));
    const reqMs = Date.parse(req || ''), apprMs = Date.parse(approvedAt || '');
    return isFinite(reqMs) && isFinite(apprMs) && reqMs > apprMs;
  };

  /* The REPAIR side stays narrow: only a row the carrier actually wrote is
   * taken as a client approval to act on. The supersession side above is
   * deliberately broader. Erring narrow here and broad there both err toward
   * leaving the card alone. */
  const latestApprove = new Map();
  const unwrittenApprove = new Map();
  for (const row of world.outbox) {
    if (row && row.test_only === true) continue;
    if (String((row && row.role) || '').toLowerCase() !== 'client') continue;
    const to = String((row && row.payload && row.payload.status) || '').toLowerCase();
    if (to !== 'approved') continue;
    /* THE NARROW WRITE POLICY IS NOT A LICENCE TO SAY NOTHING. Only a row the
     * carrier actually wrote is acted on, but a client approval whose carrier
     * status is `pending`, `skipped`, `stale` or a failure is the very case an
     * operator is looking for when both legs went wrong: the outbound never
     * landed AND the browser never wrote the card. Exiting here silently
     * produced neither a stamp nor a line, which reads as "nothing to
     * investigate".
     *
     * Reported ONLY when the stamp is actually absent. Live: of the 5 such rows
     * in the window, 4 are already stamped and would be noise; 1 is a genuinely
     * lost client approval that this job named nowhere before now. */
    const carrier = String((row && row.status) || '').toLowerCase();
    if (carrier !== 'written') {
      /* COLLECTED, NOT REPORTED HERE. Reporting at this point skips the
       * supersession checks the written path runs below, which would raise an
       * actionable-looking "lost approval" for a sign-off that is missing ON
       * PURPOSE — reopened after the client approved, or sitting on a component
       * that has since moved below Approved. A false lead in a report a person
       * reads is the same class of harm as a false repair. */
      const unwritten = resolve(row && row.entity_id, row && row.client_slug);
      /* THE SAME REFUSAL THE WRITTEN PATH REPORTS. Accepting only resolved
       * objects here made the unwritten branch silently drop exactly the rows
       * that matter most: both delivery legs failed AND the crosswalk is stale,
       * so nothing else in the system names this approval either. */
      if (typeof unwritten === 'string') {
        /* DO NOT CLAIM THE CARD LEG FAILED WHEN THE CARD IS UNKNOWN. The four
         * qualifying tests the resolvable rows go through — stamp already
         * present, a later reopen, a later client request, current status — all
         * need a card, and this row has none. Running them is impossible;
         * asserting their conclusion anyway would tell the operator "this
         * approval reached neither leg" about a card that may well carry the
         * stamp already.
         *
         * The alternative considered and rejected: follow the half-link anyway
         * to check the stamp. That is the exact trust the crosswalk gate exists
         * to refuse, and using it to SUPPRESS a report would hide a real loss on
         * a mis-linked card. So the row is kept and its claim is narrowed to
         * what is actually known: the carrier did not write, and the card
         * cannot be identified. */
        skipped.push({ kind: 'stamp', reason: 'carrier_did_not_write_and_card_unknown',
          refusal: unwritten === 'client_mismatch' ? 'approval_belongs_to_another_client' : unwritten,
          carrier_status: carrier || '(none)', card: '(unidentified)',
          deliverable: String((row && row.entity_id) || ''), component: '' });
        continue;
      }
      if (unwritten && unwritten.component) {
        const at = String(row.source_edited_at || row.created_at || row.processed_at || '');
        if (at) {
          const key = cardKey(unwritten.card.client, unwritten.card.id) + '|' + unwritten.component;
          const prev = unwrittenApprove.get(key);
          if (!prev || Date.parse(at) > Date.parse(prev.at)) {
            unwrittenApprove.set(key, { at, card: unwritten.card, comp: unwritten.component,
              deliverableId: String(unwritten.del.id), carrier: carrier || '(none)' });
          }
        }
      }
      continue;
    }
    const hit = resolve(row && row.entity_id, row && row.client_slug);
    if (typeof hit === 'string') {
      /* A COMMITTED CLIENT APPROVAL WHOSE CARD CANNOT BE FOUND IS WORK, not a
       * card that moved on. Without the deliverable and the client this printed
       * as `card (unlinked) [] left alone: card_not_found` — indistinguishable
       * rows an operator cannot act on, which is the whole thing round 20 set
       * out to surface. It does NOT claim the carrier failed: the carrier
       * wrote. Only the crosswalk is broken. */
      skipped.push({ kind: 'stamp',
        reason: hit === 'client_mismatch' ? 'approval_belongs_to_another_client' : hit,
        crosswalk_broken: hit !== 'client_mismatch',
        deliverable: String((row && row.entity_id) || ''),
        client: String((row && row.client_slug) || ''),
        card: '(unidentified)', component: '' });
      continue;
    }
    if (!hit) continue;
    const comp = hit.component;
    /* resolve() refuses an unknown team, so this cannot fire today; it is here
     * because the failure it replaces was a SILENT `continue`, and a committed
     * client approval disappearing without a line in the report is the one
     * outcome this job must never have. */
    if (!comp) {
      skipped.push({ kind: 'stamp', reason: 'no_component_for_deliverable',
        card: hit.card.id, component: '' });
      continue;
    }
    /* `source_edited_at` is when the CLIENT's write committed; `processed_at`
     * is when linear-outbound finished carrying it onward, which on a retried
     * or delayed delivery is minutes or hours later. The documented contract is
     * the commit time, so the originating clock wins and processed_at is only a
     * last resort. */
    const at = String(row.source_edited_at || row.created_at || row.processed_at || '');
    if (!at) continue;
    const key = cardKey(hit.card.client, hit.card.id) + '|' + comp;
    const prev = latestApprove.get(key);
    if (!prev || Date.parse(at) > Date.parse(prev.at)) {
      latestApprove.set(key, { at, card: hit.card, comp, deliverableId: String(hit.del.id) });
    }
  }
  for (const { at, card, comp, deliverableId } of latestApprove.values()) {
    if (String(card[STAMP_FIELD(comp)] || '').trim()) continue;   // already stamped
    /* SUPERSEDED BY A LATER ROUND. The card's CURRENT status is not enough:
     * a client approves, the work is reopened (clearing the stamp), staff later
     * advance it back to Approved, and the card reads Approved again while the
     * client never saw the new revision. Stamping there would claim a sign-off
     * that did not happen. So look for a reopen AFTER the approval, not just at
     * where the component sits now.
     *
     * Only a move back BELOW Approved counts. A later `posted` or `scheduled`
     * is the work progressing, and treating that as supersession would discard
     * every genuine repair — measured against live rows, all of which had
     * exactly such a forward transition. */
    const approvedMs = Date.parse(at);
    const reopened = (transitionsByDeliverable.get(deliverableId) || []).some(t => {
      const ms = Date.parse(t.at);
      return isFinite(ms) && isFinite(approvedMs) && ms > approvedMs && reopensBelowApproved(t.status);
    });
    if (reopened) {
      skipped.push({ kind: 'stamp', reason: 'superseded_by_later_reopen', card: card.id, component: comp,
        card_status: card[STATUS_FIELD(comp)] || '' });
      continue;
    }
    if (supersededByRequest(deliverableId, at)) {
      skipped.push({ kind: 'stamp', reason: 'superseded_by_later_client_request',
        card: card.id, component: comp, card_status: card[STATUS_FIELD(comp)] || '' });
      continue;
    }
    if (!stampSurvives(card, comp, at)) {
      skipped.push({ kind: 'stamp', reason: 'superseded_status', card: card.id, component: comp,
        card_status: card[STATUS_FIELD(comp)] || '' });
      continue;
    }
    findings.push({ kind: 'stamp', writable: true, card, component: comp, stamp_at: at,
      deliverable_id: deliverableId,
      detail: `sign-off stamp missing for a committed client approve (${at})` });
  }

  /* THE SAME SUPERSESSION TESTS THE WRITTEN PATH RUNS, over the approvals whose
   * carrier never wrote. A row surviving both is a client approval that reached
   * neither the card nor the outbound: the case an operator is hunting, and the
   * only one worth a line. A row failing either is a stamp that is absent by
   * design, and reporting it would send someone after nothing. */
  for (const [key, cand] of unwrittenApprove) {
    /* A WRITTEN APPROVE ONLY SUPERSEDES A LATER ONE IF IT IS ITSELF LATER. The
     * key names a (card, component), not a review: an older written approve,
     * then a reopen, then a NEWER client approve whose carrier failed, would
     * otherwise suppress the new lost approval — while the old written one is
     * separately rejected by the reopen test, leaving the current loss reported
     * nowhere. Compare the clocks, not the presence of a key. */
    const written = latestApprove.get(key);
    if (written && Date.parse(written.at) >= Date.parse(cand.at)) continue;
    const { at, card, comp, deliverableId, carrier } = cand;
    if (String(card[STAMP_FIELD(comp)] || '').trim()) continue;   // already stamped
    const approvedMs = Date.parse(at);
    const reopened = (transitionsByDeliverable.get(deliverableId) || []).some(t => {
      const ms = Date.parse(t.at);
      return isFinite(ms) && isFinite(approvedMs) && ms > approvedMs && reopensBelowApproved(t.status);
    });
    if (reopened || !stampSurvives(card, comp, at)) continue;
    if (supersededByRequest(deliverableId, at)) continue;
    skipped.push({ kind: 'stamp', reason: 'carrier_did_not_write', carrier_status: carrier,
      card: card.id, client: card.client, component: comp,
      card_status: card[STATUS_FIELD(comp)] || '' });
  }

  /* B2. PARTIAL REPAIR — the postcondition on this job's own work.
   * `calendar-upsert` merges comments and updates scalars as two separate
   * operations, so a failure between them leaves the request on the card with
   * the status leg never applied. Presence alone would then suppress the
   * finding forever, and the round would sit at Client Approval with an
   * unanswered request on it.
   *
   * This runs over EVERY claim, id-made or body-made, because the id pass is
   * exactly the one that recognises this job's own earlier delivery. Scoped to
   * entries carrying `recovered_by`, so it can only fire on this job's own
   * unfinished work and never on an ordinary card sitting at Client Approval.
   * Placed after both claim passes for the same reason. */
  const partialRepairPass = () => {
    for (const row of resolved) {
      if (!claimOf.has(row)) continue;
      const { pc, hit, comp, list } = row;
      if (pc.resolved_at) continue;           // no status leg was ever owed
      const entry = list[claimOf.get(row)];
      if (!entry || entry.recovered_by !== 'client-signoff-reconcile') continue;
      /* THE CARD ENTRY'S OWN LIFECYCLE OVERRULES A STALE SNAPSHOT. `loadWorld`
       * may have read the source comment before someone resolved it, leaving
       * `pc.resolved_at` empty while the card already shows the entry done. In
       * that window this pass would move a resolved component back to Tweaks
       * Needed and the sweep would strip its sign-off. The card was read later,
       * so where the two disagree the card wins. */
      if (entry.done === true || entry.deleted === true) continue;
      if (_calNormStatus(hit.card[STATUS_FIELD(comp)] || '') !== 'Client Approval') continue;
      findings.push({ kind: 'status_only', writable: false, card: hit.card, component: comp,
        comment: pc,
        detail: `a request this job delivered never got its status leg (${pc.id})` });
    }
  };

  /* B. A committed client CHANGE REQUEST that never reached the card.
   *
   * IDENTITY, and why it is not a simple `some()`.
   *   · The card usually stores the request under `native_comment_id`, not the
   *     production_comments row id. Measured live: the row id matches 4 card
   *     entries, the native id matches 57. Comparing only the row id therefore
   *     misses almost every delivered request and leaves the body doing all the
   *     work.
   *   · Body alone cannot tell repeats apart. A client who asks for the same
   *     thing again in a later round ("fix the intro", again) would be matched
   *     against the FIRST round's entry and their new request would stay
   *     invisible — the exact failure this job exists to prevent.
   * So each card entry is CONSUMED by at most one server request: ids claim
   * their entry first, then bodies claim what is left. Two identical requests
   * on the server need two identical entries on the card, or one is missing.
   * Counting rather than existence-checking is what makes repeats work without
   * depending on the two systems agreeing about round numbers (they do not
   * always: 2 of 317 live body matches sit on a different round). */
  const consumedByCard = new Map();   // card|comp -> Set of consumed indices
  const commentsInOrder = world.comments
    .filter(pc => pc && !pc.deleted_at)
    .slice()
    .sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')));

  /* Resolve each request to its card cell ONCE, so the id pass below can run
   * across every request before any body fallback does. */
  const resolved = [];
  for (const pc of commentsInOrder) {
    const hit = resolve(pc.deliverable_id, pc.client_slug);
    if (typeof hit === 'string') {
      skipped.push({ kind: 'comment',
        reason: hit === 'client_mismatch' ? 'request_belongs_to_another_client' : hit,
        card: '(unlinked)', component: '', comment: pc.id });
      continue;
    }
    if (!hit) continue;
    /* A request NAMES its component. Falling back to the deliverable's kind
     * when that name is unrecognised is how title feedback lands in
     * `video_tweaks` and drags `video_status` to Tweaks Needed: the wrong
     * review, mutated on the strength of a guess. The kind is a fallback only
     * when the request names nothing at all; a named-but-unmappable component
     * is reported and left alone. */
    const named = String(pc.component || '').trim().toLowerCase();
    const comp = named
      ? COMPONENT_FOR_KIND[named]
      : hit.component;
    if (!comp) {
      if (named) {
        skipped.push({ kind: 'comment', reason: 'unmapped_component', card: hit.card.id,
          component: named, comment: pc.id });
      }
      continue;
    }
    const body = normText(pc.body);
    if (!body) continue;
    const list = parseComments(hit.card[TWEAKS_FIELD(comp)]);
    if (list === null) {
      skipped.push({ kind: 'comment', reason: 'card_cell_unparseable', card: hit.card.id, component: comp });
      continue;
    }
    resolved.push({ pc, hit, comp, body, list, cellKey: cardKey(hit.card.client, hit.card.id) + '|' + comp });
  }

  /* PASS 1 — EXACT IDENTITY FIRST, ACROSS EVERY REQUEST.
   * Claiming ids globally before any body fallback matters when two requests
   * share a body and the card holds only the later one under its native id: a
   * single pass in date order lets the EARLIER request consume that entry by
   * body, and the later one is then reported missing and delivered again while
   * the older request's identity and round vanish. Ids are exact, so they get
   * first refusal everywhere. */
  const claimOf = new Map();
  for (const row of resolved) {
    if (!consumedByCard.has(row.cellKey)) consumedByCard.set(row.cellKey, new Set());
    const consumed = consumedByCard.get(row.cellKey);
    const ids = [String(row.pc.id || ''), String(row.pc.native_comment_id || '')].filter(Boolean);
    const at = row.list.findIndex((c, i) => !consumed.has(i) && ids.includes(String(c.id || '')));
    if (at >= 0) { consumed.add(at); claimOf.set(row, at); }
  }

  for (const row of resolved) {
    if (claimOf.has(row)) continue;
    const { pc, hit, comp, body, list, cellKey } = row;
    const consumed = consumedByCard.get(cellKey);
    /* PASS 2 — body fallback, but only onto an entry that could actually BE
     * this client request. An internal staff note, a reply, or a deleted entry
     * carrying the same words is not a delivery of it, and consuming one would
     * declare the client's request delivered while it is nowhere on the card.
     * Measured live: all 327 card entries matching a client request are
     * client-authored roots, and 18 of them carry is_tweak:false — so authorship
     * and shape are required, and is_tweak deliberately is not. */
    const claimed = list.findIndex((c, i) =>
      !consumed.has(i) && normText(c.body) === body && couldBeClientTweak(c)
      && !(pc.resolved_at == null && c.done === true));
    if (claimed >= 0) { consumed.add(claimed); claimOf.set(row, claimed); continue; }

    /* AN UNRESOLVED REQUEST WHOSE ONLY BODY MATCH IS A **DONE** ENTRY IS
     * AMBIGUOUS, AND NEITHER ANSWER IS SAFE.
     *   · Treat it as delivered, and if the done entry is an OLDER request with
     *     the same words, this client's live feedback stays invisible.
     *   · Deliver it, and if the done entry IS this request (resolved on the
     *     card while the source row lagged), the client sees their own words
     *     twice.
     * Body text cannot tell those apart, and 8 live rows sit in exactly this
     * state. So the job does neither: it reports, which is the one honest
     * option, and a person decides. This is also the clearest evidence that
     * request DELIVERY is a guessing game in a way stamp repair is not. */
    const doneTwin = list.some((c, i) =>
      !consumed.has(i) && normText(c.body) === body && c.done === true);
    if (doneTwin && !pc.resolved_at) {
      skipped.push({ kind: 'comment', reason: 'ambiguous_repeat_of_completed_request',
        card: hit.card.id, component: comp, comment: pc.id });
      continue;
    }
    const status = _calNormStatus(hit.card[STATUS_FIELD(comp)] || '');
    if (status !== 'Client Approval' && status !== 'Tweaks Needed') {
      /* A RESOLVED request on a closed round is reported under its own reason
       * rather than written. Since round 6 a resolved patch is status-neutral,
       * so restoring one here would reopen nothing — but measured against live
       * rows, 100 resolved requests sit on closed rounds and NOT ONE of them is
       * missing from its card. Writing them would repair nothing today while
       * making a class of 100 closed cards writable, and this job's standing
       * bias is to leave a card alone. Reported, so an operator can see it and
       * the row is never silently forgotten; the gate is one line to relax if
       * that count ever stops being zero. */
      skipped.push({
        kind: 'comment',
        reason: pc.resolved_at ? 'review_round_closed_resolved' : 'review_round_closed',
        card: hit.card.id, component: comp, card_status: status, comment: pc.id,
      });
      continue;
    }
    findings.push({ kind: 'comment', writable: false, card: hit.card, component: comp,
      comment: pc, existing: list,
      detail: `committed client change request absent from the card (${pc.id})` });
  }

  partialRepairPass();

  return { findings, skipped };
}

/* ── repair ─────────────────────────────────────────────────────────────── */

/* Builds the patch for one finding. The card clone is only ever used to
 * recompute the overall pill and to run the stale-approval sweep; the patch
 * carries the minimum set of fields the repair actually changes. */
function patchFor(finding) {
  const card = finding.card;
  const comp = finding.component;
  const clone = JSON.parse(JSON.stringify(card));
  const patch = { id: card.id };
  const pending = {};
  let movedComponent = false;

  if (finding.kind === 'status_only') {
    /* Only the status leg is owed; the request is already on the card. */
    clone[STATUS_FIELD(comp)] = 'Tweaks Needed';
    patch[STATUS_FIELD(comp)] = 'Tweaks Needed';
    pending[STATUS_FIELD(comp)] = 'Tweaks Needed';
    movedComponent = true;
  } else if (finding.kind === 'stamp') {
    clone[STAMP_FIELD(comp)] = finding.stamp_at;
    patch[STAMP_FIELD(comp)] = finding.stamp_at;
  } else {
    const pc = finding.comment;
    /* Rebuilt from the server's own record. `id` is the production comment id,
     * so a later run recognises this request as delivered and a second copy can
     * never be appended. */
    /* The browser's canonical projector and its source-repair journal store
     * `native_comment_id`. If this job completes a closed browser's failed leg
     * and that browser later resumes its journal, an atomic merge keyed on a
     * different id keeps BOTH copies and the client sees their own request
     * twice. Detection already recognises either id, so writing the native one
     * makes server-side and browser recovery converge. */
    const appended = {
      id: String(pc.native_comment_id || pc.id),
      parent_id: null,
      author: String(pc.author_name || 'Client'),
      role: 'client',
      is_tweak: true,
      audience: String(pc.audience || 'client'),
      round: Number(pc.round || 0) || (finding.existing.filter(c => c && c.is_tweak !== false).length + 1),
      body: String(pc.body || ''),
      created_at: String(pc.created_at || ''),
      updated_at: String(pc.updated_at || pc.created_at || ''),
      /* A request already resolved on the server must not be republished as
       * live work. 103 of 345 live client requests carry a resolution, so
       * hard-coding `done: false` would hand the team completed feedback as an
       * open task. The resolution travels with the request. */
      done: !!pc.resolved_at,
      done_at: String(pc.resolved_at || ''),
      done_by: String(pc.resolved_at ? (pc.resolved_by_name || 'Resolved') : ''),
      /* Provenance: this row was completed server-side from a committed write,
       * not typed into this card by a person. */
      recovered_by: 'client-signoff-reconcile',
    };
    const list = finding.existing.concat([appended]);
    clone[TWEAKS_FIELD(comp)] = stringifyComments(list);
    patch[TWEAKS_FIELD(comp)] = clone[TWEAKS_FIELD(comp)];
    /* A RESOLVED request carries no status change. Delivering it restores the
     * record; moving the component to Tweaks Needed would reopen work that is
     * already finished, and the stale sweep would then strip a sign-off on the
     * strength of a request nobody is waiting on. Carrying `done` while still
     * flipping the status would have been the worst of both. */
    if (!pc.resolved_at
        && _calNormStatus(card[STATUS_FIELD(comp)] || '') === 'Client Approval') {
      clone[STATUS_FIELD(comp)] = 'Tweaks Needed';
      patch[STATUS_FIELD(comp)] = 'Tweaks Needed';
      pending[STATUS_FIELD(comp)] = 'Tweaks Needed';
      movedComponent = true;
    }
  }

  /* The house sweep, on the app's own rule: a component dropping to Tweaks
   * Needed must not keep a client sign-off from the round it just left. */
  _calClearStaleApprovals(clone, pending);
  for (const key of Object.keys(pending)) {
    if (/_approved_at$/.test(key)) patch[key] = pending[key];
  }
  /* The overall pill is recomputed ONLY when this repair actually moved a
   * component. Restoring a sign-off stamp changes no component status, so
   * recomputing there would rewrite the pill as a side effect of a repair that
   * was never about it — and `computeOverallStatus` derives from the whole
   * component set, so any component this read did not carry would be inferred
   * rather than known. Caught by the fixture run: a stamp repair on a card
   * reading Approved proposed `status="In Progress"`. */
  if (movedComponent) {
    const overall = computeOverallStatus(clone);
    if (_calNormStatus(card.status || '') !== overall) patch.status = overall;
  }
  return patch;
}

/* Re-run the FULL decision against a freshly read card, immediately before
 * writing. Between loadWorld() and the POST a client or a colleague can move
 * the card, and the snapshot-derived patch would then apply to a state nobody
 * checked: a change request could reopen a component approved a minute ago, or
 * a stamp could land on work just sent back for tweaks — the exact moved-on
 * cases this job promises never to overwrite.
 *
 * This re-runs `detect` rather than re-checking a few fields by hand, so the
 * revalidation cannot drift from the rules above.
 *
 * HONEST LIMIT: this NARROWS the window to one round-trip, it does not close
 * it. A true fix needs a compare-and-set on the write, and the Calendar status
 * lane carries none — payloads have neither `expected_status` nor
 * `expected_updated_at`, and `production-write` requires them on the
 * `production` surface only (OPEN_REPAIRS 189, finding 2). Closing it properly
 * is Edge Function work, deliberately not smuggled in here. Repairs are rare
 * and this job is dispatched, so the residual risk is a few seconds per row. */
async function revalidate(world, finding) {
  /* The card is re-read, and so is the SOURCE row. A request can be resolved or
   * deleted between `loadWorld` and the write — which is precisely the two-leg
   * window this job exists for — and reusing the original snapshot would append
   * it as open, or finish a status leg no longer owed, and strip a sign-off on
   * the strength of stale lifecycle state. Round 7 answered the half of this
   * that the CARD can see; this is the half only the source knows. */
  /* And the TRANSITIONS. A component reopened after `loadWorld` and returned to
   * Approved before the write passes `stampSurvives` on the fresh card while the
   * reopen is missing from the snapshot, so the obsolete approval is restored.
   * The card cannot see that; only the outbox can. Scoped to the one
   * deliverable, so it is a single keyed read per repair. */
  /* And the DELIVERABLE. `move-card-client.js` rewrites `deliverables.client_slug`
   * and `calendar_posts.client` as two separate PATCHes; a revalidation landing
   * between them would otherwise resolve through the stale mapping and stamp a
   * card that is mid-move. Re-read it, so the composite mapping checked here is
   * the one that exists now. */
  let deliverables = world.deliverables;
  if (finding.deliverable_id) {
    const rows = await restRows('deliverables',
      'select=id,card_id,kind,team,origin,client_slug,status,status_at'
      + `&id=eq.${encodeURIComponent(finding.deliverable_id)}`, 'id');
    deliverables = world.deliverables
      .filter(d => String(d && d.id) !== String(finding.deliverable_id))
      .concat(rows);
  }

  let outbox = world.outbox;
  if (finding.deliverable_id) {
    const rows = await restRows('mirror_outbox',
      'select=entity_id,operation,status,entity,payload,source_edited_at,processed_at,created_at,'
      + 'role,client_slug,test_only'
      + `&operation=eq.status&entity=eq.deliverable`
      + `&entity_id=eq.${encodeURIComponent(finding.deliverable_id)}`, 'id');
    outbox = world.outbox
      .filter(r => String(r && r.entity_id) !== String(finding.deliverable_id))
      .concat(rows);
  }

  /* AND THE CLIENT REQUESTS ON THIS DELIVERABLE. A committed client request is a
   * supersession clock now, so it is a source detection reads — and the rule
   * this doc leads with is that revalidation refreshes EVERY source detection
   * used, or it is validating against a partial snapshot. A request committing
   * between `loadWorld` and the write, whose own status leg then fails, leaves
   * the fresh card reading Approved with no reopen in the refreshed outbox: the
   * stamp would be restored over a change the client had just asked for.
   * Scoped to the one deliverable, so it is a single keyed read per repair. */
  let comments = world.comments;
  if (finding.deliverable_id) {
    const rows = await restRows('production_comments',
      'select=id,native_comment_id,deliverable_id,client_slug,component,body,author_name,role,is_tweak,'
      + 'round,audience,created_at,updated_at,deleted_at,resolved_at,resolved_by_name'
      + `&role=eq.client&is_tweak=is.true`
      + `&deliverable_id=eq.${encodeURIComponent(finding.deliverable_id)}`, 'id');
    comments = comments
      .filter(c => String(c && c.deliverable_id) !== String(finding.deliverable_id))
      .concat(rows);
  }
  if (finding.comment) {
    const row = await restRows('production_comments',
      'select=id,native_comment_id,deliverable_id,client_slug,component,body,author_name,role,is_tweak,'
      + 'round,audience,created_at,updated_at,deleted_at,resolved_at,resolved_by_name'
      + `&id=eq.${encodeURIComponent(finding.comment.id)}`, 'id');
    /* Gone entirely means gone: drop it rather than fall back to the snapshot. */
    comments = world.comments
      .filter(c => String(c.id) !== String(finding.comment.id))
      .concat(row);
  }
  const fresh = await restRows('calendar_posts',
    'select=id,client,name,status,video_status,graphic_status,caption_status,'
    + 'title_status,video_tweaks,graphic_tweaks,caption_tweaks,title_tweaks,updated_at,'
    + 'client_video_approved_at,client_graphic_approved_at,client_caption_approved_at,'
    + 'client_title_approved_at,kasper_approved_at,'
    + 'video_deliverable_id,graphic_deliverable_id'
    + `&id=eq.${encodeURIComponent(finding.card.id)}`
    + `&client=eq.${encodeURIComponent(finding.card.client)}`, 'id');
  if (!fresh.length) return null;
  const again = detect({ outbox, comments, deliverables, cards: fresh });
  const match = again.findings.find(f =>
    f.kind === finding.kind
    && f.component === finding.component
    && String(f.card.id) === String(finding.card.id)
    && cardKey(f.card.client, f.card.id) === cardKey(finding.card.client, finding.card.id)
    && (!f.comment || String(f.comment.id) === String(finding.comment.id)));
  return match || null;
}

async function writePatch(card, patch, kind) {
  /* THE GUARD. Placed at the write rather than at detection, so no future edit
   * to the detection path can make a delivery writable by accident. */
  if (!WRITABLE_KINDS.has(String(kind || ''))) {
    throw new Error(`refusing to write a ${kind} repair: this job writes stamps only`);
  }
  if (!SYNCVIEW_STAFF_KEY) throw new Error('SYNCVIEW_STAFF_KEY is required for calendar-upsert writes');
  const res = await fetch(UPSERT_EF_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Syncview-Source': 'client-signoff-reconcile',
      'X-Syncview-Key': SYNCVIEW_STAFF_KEY,
    },
    body: JSON.stringify({ client: card.client, post: patch }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.ok === false) {
    throw new Error(`calendar-upsert: HTTP ${res.status} ${JSON.stringify(body).slice(0, 160)}`);
  }
  return body;
}

/* The run summary, as a pure function, because the COUNTS are a rule too: the
 * workflow tells the operator to read these lines, so a row that needs a person
 * being filed under "left alone" is a defect, not a cosmetic one. Extracted so
 * the suite can assert the bucketing instead of trusting it.
 *
 * Reasons that are WORK, not "a card that moved on": an ambiguous repeat is a
 * delivery decision the job cannot make, and a carrier failure is a client
 * approval that reached neither leg. Both land in `skipped` only because nothing
 * here can be written for them. */
const NEEDS_A_PERSON = new Set(['ambiguous_repeat_of_completed_request', 'carrier_did_not_write']);
/* Returns the BUCKETS as well as the lines. Returning only the lines is what
 * left `main()` referencing bucket names that no longer existed there — the
 * whole run died with a ReferenceError before any write, and 83 offline checks
 * did not notice because none of them ran the entry point. Every consumer of
 * these groupings now gets them from one place. */
function classify({ findings, skipped }) {
  const writable = findings.filter(f => WRITABLE_KINDS.has(f.kind));
  const reportOnly = findings.filter(f => !WRITABLE_KINDS.has(f.kind));
  const ambiguous = skipped.filter(row => row.reason === 'ambiguous_repeat_of_completed_request');
  /* A carrier failure that could not even resolve a card is MORE urgent than one
   * that could, not less: both delivery legs failed AND the crosswalk is stale,
   * so nothing else in the system names that approval. Keyed on the carrier
   * status the row carries rather than on the reason, so a future refusal reason
   * cannot quietly fall out of this bucket the way this one did. */
  const carrierFailed = skipped.filter(row => row.kind === 'stamp'
    && (row.carrier_status || String(row.reason || '').startsWith('carrier_did_not_write')));
  /* The carrier WROTE; the crosswalk is broken. Separate from a carrier failure
   * because the operator looks in a different place, and separate from "left
   * alone" because there is something to do. */
  const crosswalkBroken = skipped.filter(row => row.crosswalk_broken && !row.carrier_status);
  const leftAlone = skipped.filter(row => !NEEDS_A_PERSON.has(row.reason)
    && !row.crosswalk_broken
    && !(row.kind === 'stamp'
      && (row.carrier_status || String(row.reason || '').startsWith('carrier_did_not_write'))));
  const lines = [
    `REPAIRS (written on --apply): ${writable.length} sign-off stamp(s)`,
    `NEEDS A PERSON (never written): `
      + `${reportOnly.length + ambiguous.length + carrierFailed.length + crosswalkBroken.length}  `
      + `(change request absent from card ${reportOnly.filter(f => f.kind === 'comment').length}, `
      + `unfinished status leg ${reportOnly.filter(f => f.kind === 'status_only').length}, `
      + `ambiguous repeat ${ambiguous.length}, `
      + `client approve that reached neither leg ${carrierFailed.length}, `
      + `carried approve whose card is missing ${crosswalkBroken.length})`,
    `left alone: ${leftAlone.length} (a card that moved on is never overwritten)`,
  ];
  return { writable, reportOnly, ambiguous, carrierFailed, crosswalkBroken, leftAlone, lines };
}
const summaryLines = (input) => classify(input).lines;

/* ── run ────────────────────────────────────────────────────────────────── */
async function main() {
  const world = await loadWorld();
  const { findings, skipped } = detect(world);

  log(`client-signoff-reconcile — ${APPLY ? 'APPLY' : 'DRY-RUN'}`
    + `${FIXTURES ? ' (fixtures)' : ''}${ONLY_CLIENT ? ` client=${ONLY_CLIENT}` : ''}`);
  log(`scanned: ${world.outbox.length} committed client status writes, `
    + `${world.comments.length} committed client change requests, ${world.cards.length} cards`);
  const { writable, ambiguous, carrierFailed, crosswalkBroken, leftAlone, lines } =
    classify({ findings, skipped });
  for (const line of lines) log(line);

  const plan = findings.map(f => ({ finding: f, patch: patchFor(f) }));
  for (const { finding, patch } of plan) {
    log(`  ${WRITABLE_KINDS.has(finding.kind) ? '·' : '»'} card ${finding.card.id} `
      + `[${finding.component}] ${finding.detail}`
      + `${WRITABLE_KINDS.has(finding.kind) ? '' : '  — REPORT ONLY, a person decides'}`);
    /* The arrow means "this is written"; a report-only row shows what a person
     * WOULD have to do, and must not read as a pending write. */
    log(`      ${WRITABLE_KINDS.has(finding.kind) ? '→ writes' : '  would need'} `
      + `${Object.keys(patch).filter(k => k !== 'id').map(k =>
        `${k}=${k.endsWith('_tweaks') ? '(+1 request)' : JSON.stringify(patch[k])}`).join(' ')}`);
  }
  /* A count with no rows tells the operator that ONE approval needs attention
   * and nothing about which one. The dispatched workflow passes no --json, so
   * this loop is the only human-readable output these rows ever get. */
  for (const row of carrierFailed) {
    /* calendar_posts is keyed by (client, id) and 13 live ids are shared across
     * clients, so a card id alone does not say whose approval was lost. */
    log(`  » card ${row.card}${row.client ? ` (${row.client})` : ''}`
      + `${row.deliverable ? ` deliverable ${row.deliverable}` : ''}`
      + `${row.component ? ` [${row.component}]` : ''} `
      + (row.reason === 'carrier_did_not_write'
        ? `a client APPROVE reached neither leg (carrier ${row.carrier_status}, `
          + `card reads ${row.card_status || 'unknown'})`
        : `a client APPROVE was not carried (carrier ${row.carrier_status}) and its card `
          + `cannot be identified (${row.refusal}) — whether the card leg landed is UNKNOWN`)
      + ' — REPORT ONLY, a person decides');
  }
  for (const row of crosswalkBroken) {
    log(`  » deliverable ${row.deliverable}${row.client ? ` (${row.client})` : ''} `
      + `carried a client APPROVE, and its card cannot be found (${row.reason}) `
      + '— the carrier wrote; the crosswalk is broken — REPORT ONLY, a person decides');
  }
  for (const row of ambiguous) {
    log(`  » card ${row.card} [${row.component}] request ${row.comment} matches only a `
      + 'COMPLETED entry — cannot tell a repeat from a duplicate; a person decides');
  }
  for (const row of leftAlone) {
    /* Print the deliverable when the card could not be identified, or the line
     * is `card (unidentified) [] left alone: <reason>` and names nothing the
     * reader can look up. */
    log(`  ~ card ${row.card}${row.client ? ` (${row.client})` : ''}`
      + `${row.deliverable ? ` deliverable ${row.deliverable}` : ''}`
      + ` [${row.component}] left alone: ${row.reason}`
      + `${row.comment ? ` (request ${row.comment})` : ''}`
      + `${row.card_status ? ` (card reads ${row.card_status})` : ''}`);
  }

  let applied = 0;
  const failures = [];
  const writablePlan = plan.filter(row => WRITABLE_KINDS.has(row.finding.kind));
  if (APPLY && writablePlan.length > CAP) {
    log(`ABORT: ${writablePlan.length} repairs exceeds cap ${CAP}. Nothing written.`);
    if (JSON_OUT) console.log(JSON.stringify({ ok: false, aborted: 'cap', findings: writablePlan.length, cap: CAP }));
    process.exitCode = 2;
    return;
  }
  if (APPLY && !FIXTURES) {
    for (const { finding } of plan.filter(row => WRITABLE_KINDS.has(row.finding.kind))) {
      try {
        const current = await revalidate(world, finding);
        if (!current) {
          skipped.push({ kind: finding.kind, reason: 'changed_under_us',
            card: finding.card.id, component: finding.component });
          log(`  ~ card ${finding.card.id} [${finding.component}] left alone: `
            + 'the card changed between the read and the write');
          continue;
        }
        await writePatch(current.card, patchFor(current), current.kind);
        applied++;
      } catch (e) {
        failures.push({ card: finding.card.id, error: e.message });
        log(`  ! card ${finding.card.id}: ${e.message}`);
      }
    }
    log(`applied: ${applied}, failed: ${failures.length}`);
  } else if (APPLY && FIXTURES) {
    log('fixtures mode: repairs planned, nothing written');
  }

  if (JSON_OUT) {
    console.log(JSON.stringify({
      ok: failures.length === 0,
      mode: APPLY ? 'apply' : 'dry-run',
      scanned: { outbox: world.outbox.length, comments: world.comments.length, cards: world.cards.length },
      findings: plan.map(({ finding, patch }) => ({
        kind: finding.kind,
        writable: WRITABLE_KINDS.has(finding.kind),
        card: finding.card.id, component: finding.component, patch,
      })),
      skipped, applied, failures,
    }, null, 2));
  }
  if (failures.length) process.exitCode = 1;
}

if (require.main === module) {
  main().catch(e => {
    console.error('client-signoff-reconcile failed:', e.message);
    process.exitCode = 1;
  });
}

module.exports = { detect, summaryLines, classify, patchFor, parseComments, normText, stampSurvives, restRows, writePatch, WRITABLE_KINDS, COMPONENT_FOR_KIND };
