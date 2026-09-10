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
const CAP = Number(process.env.CAP || argOf('cap') || 25);
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
].join('\n') + ';return { CAL_PRIORITY, _calNormStatus, computeOverallStatus, _calClearStaleApprovals };')();
const { _calNormStatus, computeOverallStatus, _calClearStaleApprovals } = mod;

/* A deliverable's `kind` and the card's component vocabulary are not the same
 * word for the graphic lane; everything downstream speaks the card's. */
const COMPONENT_FOR_KIND = { video: 'video', thumbnail: 'graphic', graphic: 'graphic', caption: 'caption' };
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
    restRows('mirror_outbox',
      'select=entity_id,operation,status,entity,payload,processed_at,created_at,role,test_only'
      + `&role=eq.client&status=eq.written&operation=eq.status&entity=eq.deliverable&created_at=gte.${since}`),
    restRows('production_comments',
      'select=id,deliverable_id,component,body,author_name,role,is_tweak,round,audience,created_at,updated_at,deleted_at'
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
      + 'video_tweaks,graphic_tweaks,caption_tweaks,updated_at,'
      + 'client_video_approved_at,client_graphic_approved_at,client_caption_approved_at,kasper_approved_at'
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

function detect(world) {
  const cardById = new Map(world.cards.map(c => [String(c.id), c]));
  const delById = new Map(world.deliverables.map(d => [String(d.id), d]));
  const findings = [];
  const skipped = [];

  const resolve = (deliverableId) => {
    const del = delById.get(String(deliverableId || ''));
    if (!del || !del.card_id) return null;
    const card = cardById.get(String(del.card_id));
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
  const latestApprove = new Map();
  for (const row of world.outbox) {
    if (row && row.test_only === true) continue;
    const to = String((row && row.payload && row.payload.status) || '').toLowerCase();
    if (to !== 'approved') continue;
    const hit = resolve(row && row.entity_id);
    if (!hit) continue;
    const comp = COMPONENT_FOR_KIND[String(hit.del.kind || '').toLowerCase()];
    if (!comp) continue;
    const at = String(row.processed_at || row.created_at || '');
    if (!at) continue;
    const key = hit.card.id + '|' + comp;
    const prev = latestApprove.get(key);
    if (!prev || Date.parse(at) > Date.parse(prev.at)) latestApprove.set(key, { at, card: hit.card, comp });
  }
  for (const { at, card, comp } of latestApprove.values()) {
    if (String(card[STAMP_FIELD(comp)] || '').trim()) continue;   // already stamped
    if (!stampSurvives(card, comp, at)) {
      skipped.push({ kind: 'stamp', reason: 'superseded_status', card: card.id, component: comp,
        card_status: card[STATUS_FIELD(comp)] || '' });
      continue;
    }
    findings.push({ kind: 'stamp', card, component: comp, stamp_at: at,
      detail: `sign-off stamp missing for a committed client approve (${at})` });
  }

  /* B. A committed client CHANGE REQUEST that never reached the card. */
  for (const pc of world.comments) {
    if (!pc || pc.deleted_at) continue;
    const hit = resolve(pc.deliverable_id);
    if (!hit) continue;
    const comp = COMPONENT_FOR_KIND[String(pc.component || '').toLowerCase()]
      || COMPONENT_FOR_KIND[String(hit.del.kind || '').toLowerCase()];
    if (!comp) continue;
    const body = normText(pc.body);
    if (!body) continue;
    const list = parseComments(hit.card[TWEAKS_FIELD(comp)]);
    if (list === null) {
      skipped.push({ kind: 'comment', reason: 'card_cell_unparseable', card: hit.card.id, component: comp });
      continue;
    }
    const present = list.some(c =>
      String(c.id || '') === String(pc.id || '') || normText(c.body) === body);
    if (present) continue;
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
    for (const { finding, patch } of plan) {
      try {
        await writePatch(finding.card, patch);
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
