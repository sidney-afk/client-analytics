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
const COMPONENT_FOR_KIND = {
  video: 'video', thumbnail: 'graphic', graphic: 'graphic', caption: 'caption', title: 'title',
};
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
  try {
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list.filter(c => c && typeof c === 'object') : [];
  } catch (_) {
    return null;   // unparseable: caller must treat the card as unreadable, not empty
  }
}
function stringifyComments(list) {
  const keep = Array.isArray(list) ? list.filter(c => c && c.id) : [];
  return keep.length ? JSON.stringify(keep) : '';
}
const normText = (s) => String(s == null ? '' : s).normalize('NFC').replace(/\s+/g, ' ').trim();

/* ── reads ──────────────────────────────────────────────────────────────── */
async function restRows(table, query) {
  if (!SERVICE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required (or use --fixtures)');
  const out = [];
  let offset = 0;
  const page = 1000;
  for (;;) {
    const url = `${REST}/${table}?${query}&limit=${page}&offset=${offset}`;
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
      'select=entity_id,operation,status,entity,payload,source_edited_at,processed_at,created_at,role,test_only'
      + `&operation=eq.status&entity=eq.deliverable&created_at=gte.${since}`),
    restRows('production_comments',
      'select=id,native_comment_id,deliverable_id,component,body,author_name,role,is_tweak,round,audience,created_at,updated_at,deleted_at'
      + `&role=eq.client&is_tweak=is.true&created_at=gte.${since}`),
    restRows('deliverables', 'select=id,card_id,kind,client_slug,status,status_at'),
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
      + 'client_title_approved_at,kasper_approved_at'
      + `&id=in.(${chunk})`));
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

  const resolve = (deliverableId) => {
    const del = delById.get(String(deliverableId || ''));
    if (!del || !del.card_id) return null;
    /* No client on the deliverable means the card cannot be identified, and
     * guessing is what this whole guard exists to prevent. */
    if (!String(del.client_slug || '').trim()) return null;
    const card = cardById.get(cardKey(del.client_slug, del.card_id));
    if (!card) return null;
    /* Archived is the card's OVERALL status, not a column — same test
     * scripts/linear-sync-reconcile.js applies. */
    if (String(card.status || '').toLowerCase() === 'archived') return null;
    if (ONLY_CLIENT && String(card.client || '').toLowerCase() !== ONLY_CLIENT) return null;
    return { del, card };
  };

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

  /* The REPAIR side stays narrow: only a row the carrier actually wrote is
   * taken as a client approval to act on. The supersession side above is
   * deliberately broader. Erring narrow here and broad there both err toward
   * leaving the card alone. */
  const latestApprove = new Map();
  for (const row of world.outbox) {
    if (row && row.test_only === true) continue;
    if (String((row && row.status) || '').toLowerCase() !== 'written') continue;
    if (String((row && row.role) || '').toLowerCase() !== 'client') continue;
    const to = String((row && row.payload && row.payload.status) || '').toLowerCase();
    if (to !== 'approved') continue;
    const hit = resolve(row && row.entity_id);
    if (!hit) continue;
    const comp = COMPONENT_FOR_KIND[String(hit.del.kind || '').toLowerCase()];
    if (!comp) continue;
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
    if (!stampSurvives(card, comp, at)) {
      skipped.push({ kind: 'stamp', reason: 'superseded_status', card: card.id, component: comp,
        card_status: card[STATUS_FIELD(comp)] || '' });
      continue;
    }
    findings.push({ kind: 'stamp', card, component: comp, stamp_at: at,
      detail: `sign-off stamp missing for a committed client approve (${at})` });
  }

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
    const hit = resolve(pc.deliverable_id);
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
      : COMPONENT_FOR_KIND[String(hit.del.kind || '').toLowerCase()];
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
      !consumed.has(i) && normText(c.body) === body && couldBeClientTweak(c));
    if (claimed >= 0) { consumed.add(claimed); continue; }
    const status = _calNormStatus(hit.card[STATUS_FIELD(comp)] || '');
    if (status !== 'Client Approval' && status !== 'Tweaks Needed') {
      skipped.push({ kind: 'comment', reason: 'review_round_closed', card: hit.card.id,
        component: comp, card_status: status, comment: pc.id });
      continue;
    }
    findings.push({ kind: 'comment', card: hit.card, component: comp, comment: pc, existing: list,
      detail: `committed client change request absent from the card (${pc.id})` });
  }
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

  if (finding.kind === 'stamp') {
    clone[STAMP_FIELD(comp)] = finding.stamp_at;
    patch[STAMP_FIELD(comp)] = finding.stamp_at;
  } else {
    const pc = finding.comment;
    /* Rebuilt from the server's own record. `id` is the production comment id,
     * so a later run recognises this request as delivered and a second copy can
     * never be appended. */
    const appended = {
      id: String(pc.id),
      parent_id: null,
      author: String(pc.author_name || 'Client'),
      role: 'client',
      is_tweak: true,
      audience: String(pc.audience || 'client'),
      round: Number(pc.round || 0) || (finding.existing.filter(c => c && c.is_tweak !== false).length + 1),
      body: String(pc.body || ''),
      created_at: String(pc.created_at || ''),
      updated_at: String(pc.updated_at || pc.created_at || ''),
      done: false, done_at: '', done_by: '',
      /* Provenance: this row was completed server-side from a committed write,
       * not typed into this card by a person. */
      recovered_by: 'client-signoff-reconcile',
    };
    const list = finding.existing.concat([appended]);
    clone[TWEAKS_FIELD(comp)] = stringifyComments(list);
    patch[TWEAKS_FIELD(comp)] = clone[TWEAKS_FIELD(comp)];
    if (_calNormStatus(card[STATUS_FIELD(comp)] || '') === 'Client Approval') {
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
  const fresh = await restRows('calendar_posts',
    'select=id,client,name,status,video_status,graphic_status,caption_status,'
    + 'title_status,video_tweaks,graphic_tweaks,caption_tweaks,title_tweaks,updated_at,'
    + 'client_video_approved_at,client_graphic_approved_at,client_caption_approved_at,'
    + 'client_title_approved_at,kasper_approved_at'
    + `&id=eq.${encodeURIComponent(finding.card.id)}`
    + `&client=eq.${encodeURIComponent(finding.card.client)}`);
  if (!fresh.length) return null;
  const again = detect({
    outbox: world.outbox, comments: world.comments,
    deliverables: world.deliverables, cards: fresh,
  });
  const match = again.findings.find(f =>
    f.kind === finding.kind
    && f.component === finding.component
    && String(f.card.id) === String(finding.card.id)
    && cardKey(f.card.client, f.card.id) === cardKey(finding.card.client, finding.card.id)
    && (f.kind !== 'comment' || String(f.comment.id) === String(finding.comment.id)));
  return match || null;
}

async function writePatch(card, patch) {
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

/* ── run ────────────────────────────────────────────────────────────────── */
async function main() {
  const world = await loadWorld();
  const { findings, skipped } = detect(world);

  log(`client-signoff-reconcile — ${APPLY ? 'APPLY' : 'DRY-RUN'}`
    + `${FIXTURES ? ' (fixtures)' : ''}${ONLY_CLIENT ? ` client=${ONLY_CLIENT}` : ''}`);
  log(`scanned: ${world.outbox.length} committed client status writes, `
    + `${world.comments.length} committed client change requests, ${world.cards.length} cards`);
  log(`repairable: ${findings.length}  (stamp ${findings.filter(f => f.kind === 'stamp').length}, `
    + `change request ${findings.filter(f => f.kind === 'comment').length})`);
  log(`left alone: ${skipped.length} (a card that moved on is never overwritten)`);

  const plan = findings.map(f => ({ finding: f, patch: patchFor(f) }));
  for (const { finding, patch } of plan) {
    log(`  · card ${finding.card.id} [${finding.component}] ${finding.detail}`);
    log(`      → ${Object.keys(patch).filter(k => k !== 'id').map(k =>
      `${k}=${k.endsWith('_tweaks') ? '(+1 request)' : JSON.stringify(patch[k])}`).join(' ')}`);
  }
  for (const s of skipped) {
    log(`  ~ card ${s.card} [${s.component}] left alone: ${s.reason}`
      + `${s.card_status ? ` (card reads ${s.card_status})` : ''}`);
  }

  let applied = 0;
  const failures = [];
  if (APPLY && plan.length > CAP) {
    log(`ABORT: ${plan.length} repairs exceeds cap ${CAP}. Nothing written.`);
    if (JSON_OUT) console.log(JSON.stringify({ ok: false, aborted: 'cap', findings: plan.length, cap: CAP }));
    process.exitCode = 2;
    return;
  }
  if (APPLY && !FIXTURES) {
    for (const { finding } of plan) {
      try {
        const current = await revalidate(world, finding);
        if (!current) {
          skipped.push({ kind: finding.kind, reason: 'changed_under_us',
            card: finding.card.id, component: finding.component });
          log(`  ~ card ${finding.card.id} [${finding.component}] left alone: `
            + 'the card changed between the read and the write');
          continue;
        }
        await writePatch(current.card, patchFor(current));
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
        kind: finding.kind, card: finding.card.id, component: finding.component, patch,
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

module.exports = { detect, patchFor, parseComments, normText, stampSurvives, COMPONENT_FOR_KIND };
