// Pure rules for the Leads CRM (crm-leads Edge Function, the Leads page and
// scripts/crm-import.js). No I/O, so test/crm-leads.js runs every branch
// offline. Model: docs/features/CRM_LEADS.md.

export const LEAD_TYPES = ['dream100', 'ad_lead', 'past_call', 'email'];
export const STAGES = ['to_contact', 'contacted', 'replied', 'call1_booked', 'no_show', 'call1_done', 'call2_done', 'nurture', 'won', 'lost'];
export const LOST_REASONS = ['price', 'trust', 'timing', 'budget', 'no_show'];
export const NOTE_MAX = 4000;
export const LIST_MAX = 500;

/* WHO MAY USE LEADS.
   Authorisation comes from the staff role key (X-Syncview-Key), never from a
   header the browser chooses. LEADS_ROLES is the role matrix: admin today.

   A per-person grant is one line: add { role, actor } to LEADS_MEMBER_GRANTS
   (and the same pair to CRM_LEADS_MEMBER_GRANTS in the page's Leads fragment,
   so the link shows). Example, commented out on purpose:
     { role: 'smm', actor: '<member display name>' },
   Limit, said plainly: the role key is shared by everyone in that role, and
   the actor header is attribution the browser sends, so such a grant keeps
   Leads out of the menus of the role's other members but cannot stop one of
   them who forges the header. It is a grant inside an already-trusted role.
   Real per-person isolation needs per-person keys, which SyncView does not
   have yet; docs/features/CRM_LEADS.md says what that would take. */
export const LEADS_ROLES = ['admin'];
export const LEADS_MEMBER_GRANTS = [];

export function leadsAllowed(role, actor) {
  const r = String(role || '').trim().toLowerCase();
  if (!r) return false;
  if (LEADS_ROLES.includes(r)) return true;
  const a = String(actor || '').trim().toLowerCase();
  return !!a && LEADS_MEMBER_GRANTS.some((g) => g.role === r && String(g.actor || '').trim().toLowerCase() === a);
}

// ── Normalisers: the same rules as the SQL crm_normalize_* functions. ──
export function normalizeEmail(v) {
  const s = String(v == null ? '' : v).trim().toLowerCase();
  return s || null;
}
export function normalizePhone(v) {
  const d = String(v == null ? '' : v).replace(/[^0-9]/g, '');
  return d.length >= 7 ? d : null;
}
/** Strips bracketed tags such as "[NEAR-MISS: ...]" and leading @. */
export function cleanHandle(v) {
  return String(v == null ? '' : v).replace(/\[[^\]]*\]/g, '').trim().replace(/^@+/, '').trim();
}
export function normalizeHandle(v) {
  const s = cleanHandle(v).toLowerCase();
  return s || null;
}

function validZone(tz) {
  if (typeof tz !== 'string' || !tz.trim() || tz.length > 64) return false;
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch (e) { return false; }
}
function sameInstant(a, b) {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return Date.parse(String(a)) === Date.parse(String(b));
}
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isUuid(v) { return UUID.test(String(v || '')); }
function validDate(v) {
  if (!ISO_DATE.test(String(v))) return false;
  const d = new Date(String(v) + 'T00:00:00Z');
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/** Monday..Sunday (UTC dates) of the week that holds `now`. */
export function weekRange(now) {
  const d = new Date(now);
  const day = (d.getUTCDay() + 6) % 7;
  const mon = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day));
  const sun = new Date(mon.getTime() + 6 * 86400000);
  return { from: mon.toISOString().slice(0, 10), to: sun.toISOString().slice(0, 10) };
}

/** List filters from the request body. Unknown or empty values are dropped,
 *  never refused: the server answers with fewer filters, not an error. */
export function parseListFilters(input, now = Date.now()) {
  const src = input && typeof input === 'object' ? input : {};
  const f = {};
  if (LEAD_TYPES.includes(src.lead_type)) f.lead_type = src.lead_type;
  if (STAGES.includes(src.stage)) f.stage = src.stage;
  if (typeof src.niche === 'string' && src.niche.trim()) f.niche = src.niche.trim().slice(0, 120);
  if (typeof src.owner === 'string' && src.owner.trim()) f.owner = src.owner.trim().slice(0, 80);
  if (isUuid(src.source_id)) f.source_id = String(src.source_id).toLowerCase();
  if (src.due_this_week === true) f.due = weekRange(now);
  return f;
}

/** Validates a change. Returns { ok, patch } or { ok: false, error }. */
export function validatePatch(input) {
  const src = input && typeof input === 'object' && !Array.isArray(input) ? input : null;
  if (!src) return { ok: false, error: 'patch_required' };
  const patch = {};
  for (const key of Object.keys(src)) {
    const v = src[key];
    if (key === 'stage') {
      if (!STAGES.includes(v)) return { ok: false, error: 'bad_stage' };
      patch.stage = v;
    } else if (key === 'owner') {
      if (v !== null && typeof v !== 'string') return { ok: false, error: 'bad_owner' };
      const s = String(v || '').trim();
      if (s.length > 80) return { ok: false, error: 'bad_owner' };
      patch.owner = s;
    } else if (key === 'next_step') {
      if (v !== null && typeof v !== 'string') return { ok: false, error: 'bad_next_step' };
      const s = String(v || '').trim();
      if (s.length > 500) return { ok: false, error: 'bad_next_step' };
      patch.next_step = s;
    } else if (key === 'next_step_due') {
      if (v === null || v === '') patch.next_step_due = '';
      else if (validDate(v)) patch.next_step_due = v;
      else return { ok: false, error: 'bad_next_step_due' };
    } else if (key === 'lost_reason') {
      if (v === null || v === '') patch.lost_reason = '';
      else if (LOST_REASONS.includes(v)) patch.lost_reason = v;
      else return { ok: false, error: 'bad_lost_reason' };
    } else if (key === 'call_at') {
      if (v === null || v === '') patch.call_at = '';
      else if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v) && !isNaN(Date.parse(v))) patch.call_at = new Date(v).toISOString();
      else return { ok: false, error: 'bad_call_at' };
    } else if (key === 'timezone') {
      if (v === null || v === '') patch.timezone = '';
      else if (validZone(v)) patch.timezone = v;
      else return { ok: false, error: 'bad_timezone' };
    } else if (key === 'opted_out') {
      if (typeof v !== 'boolean') return { ok: false, error: 'bad_opted_out' };
      patch.opted_out = v;
    } else if (key === 'tags') {
      if (!Array.isArray(v) || v.length > 30 || v.some((t) => typeof t !== 'string' || !t.trim() || t.length > 40)) return { ok: false, error: 'bad_tags' };
      patch.tags = Array.from(new Set(v.map((t) => t.trim().toLowerCase())));
    } else {
      return { ok: false, error: 'unknown_field' };
    }
  }
  return { ok: true, patch };
}

export function validateNote(v) {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!s) return { ok: false, error: 'note_required' };
  if (s.length > NOTE_MAX) return { ok: false, error: 'note_too_long' };
  return { ok: true, note: s };
}

function norm(v) { return v == null ? '' : String(v); }

/** The timeline rows one change writes. A field that did not change writes
 *  nothing, so a save that changes nothing writes no events (and the
 *  function does not call the database). */
export function changeEvents(before, patch, note) {
  const b = before || {};
  const out = [];
  const p = patch || {};
  if ('stage' in p && p.stage !== b.stage) out.push({ kind: 'stage_changed', channel: 'system', detail: { from: b.stage || null, to: p.stage } });
  if ('owner' in p && p.owner !== norm(b.owner)) out.push({ kind: 'owner_changed', channel: 'system', detail: { from: b.owner || null, to: p.owner || null } });
  const stepChanged = 'next_step' in p && p.next_step !== norm(b.next_step);
  const dueChanged = 'next_step_due' in p && p.next_step_due !== norm(b.next_step_due);
  if (stepChanged || dueChanged) {
    out.push({ kind: 'next_step_set', channel: 'task', detail: {
      next_step: 'next_step' in p ? (p.next_step || null) : (b.next_step || null),
      due: 'next_step_due' in p ? (p.next_step_due || null) : (b.next_step_due || null),
    } });
  }
  if ('lost_reason' in p && p.lost_reason !== norm(b.lost_reason)) out.push({ kind: 'lost_reason_set', channel: 'system', detail: { from: b.lost_reason || null, to: p.lost_reason || null } });
  if ('tags' in p) {
    const was = Array.isArray(b.tags) ? b.tags : [];
    if (JSON.stringify([...was].sort()) !== JSON.stringify([...p.tags].sort())) out.push({ kind: 'tags_changed', channel: 'system', detail: { from: was, to: p.tags } });
  }
  if ('call_at' in p && !sameInstant(p.call_at, b.call_at)) out.push({ kind: 'call_at_set', channel: 'call', detail: { from: b.call_at || null, to: p.call_at || null } });
  if ('timezone' in p && p.timezone !== norm(b.timezone)) out.push({ kind: 'timezone_set', channel: 'system', detail: { from: b.timezone || null, to: p.timezone || null } });
  if ('opted_out' in p && p.opted_out !== !!b.opted_out_at) out.push({ kind: 'opted_out', channel: 'system', detail: { opted_out: p.opted_out } });
  if (note) out.push({ kind: 'note', channel: null, detail: { text: note } });
  return out;
}

/** Only the fields that change, so the database writes exactly what moved. */
export function effectivePatch(before, patch) {
  const b = before || {};
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const [k, v] of Object.entries(patch || {})) {
    if (k === 'tags') {
      const was = Array.isArray(b.tags) ? b.tags : [];
      if (JSON.stringify([...was].sort()) !== JSON.stringify([...v].sort())) out.tags = v;
    } else if (k === 'call_at') {
      if (!sameInstant(v, b.call_at)) out.call_at = v;
    } else if (k === 'opted_out') {
      if (v !== !!b.opted_out_at) out.opted_out = v;
    } else if (v !== norm(b[k])) out[k] = v;
  }
  return out;
}

/** Row → what the Pipeline card needs. Contact details stay on the person
 *  read, not the list. */
export function cardOf(row, today) {
  const due = row.next_step_due || null;
  return {
    id: row.id,
    display_name: row.display_name || '',
    instagram_handle: row.instagram_handle || '',
    lead_type: row.lead_type,
    niche: row.niche || '',
    stage: row.stage,
    owner: row.owner || '',
    next_step: row.next_step || '',
    next_step_due: due,
    overdue: !!(due && today && due < today && row.stage !== 'won' && row.stage !== 'lost'),
    source_id: row.source_id || null,
    tags: Array.isArray(row.tags) ? row.tags : [],
    call_at: row.call_at || null,
    opted_out: !!row.opted_out_at,
    state_version: row.state_version,
    updated_at: row.updated_at || null,
  };
}

// ── Import (scripts/crm-import.js) ──────────────────────────────────────
function pick(row, names) {
  for (const n of names) {
    for (const k of Object.keys(row)) {
      if (k.trim().toLowerCase() === n && String(row[k] || '').trim()) return String(row[k]).trim();
    }
  }
  return '';
}
const TRUTHY = /^(y|yes|true|1|x)$/i;

/** One CSV row → { skip } or { person }. defaults: { lead_type, tags }. */
export function importRow(row, defaults = {}) {
  const excluded = pick(row, ['excluded', 'exclude', 'status']);
  if (TRUTHY.test(excluded) || /^excluded$/i.test(excluded)) return { skip: 'excluded' };
  const rawHandle = pick(row, ['instagram_handle', 'instagram', 'handle', 'ig']);
  const handle = cleanHandle(rawHandle);
  const email = pick(row, ['email', 'email address', 'e-mail']);
  const phone = pick(row, ['phone', 'phone number', 'mobile']);
  if (!normalizeEmail(email) && !normalizePhone(phone) && !normalizeHandle(handle)) return { skip: 'no_contact' };
  const typeIn = pick(row, ['lead_type', 'type']).toLowerCase().replace(/[\s-]+/g, '_');
  const lead_type = LEAD_TYPES.includes(typeIn) ? typeIn : (LEAD_TYPES.includes(defaults.lead_type) ? defaults.lead_type : null);
  if (!lead_type) return { skip: 'no_lead_type' };
  const tags = new Set((defaults.tags || []).map((t) => String(t).trim().toLowerCase()).filter(Boolean));
  for (const t of pick(row, ['tags']).split(/[,;|]/)) if (t.trim()) tags.add(t.trim().toLowerCase());
  if (TRUTHY.test(pick(row, ['bench'])) || /\[bench\]/i.test(rawHandle)) tags.add('bench');
  const nearMiss = /\[near-miss[^\]]*\]/i.test(rawHandle);
  if (nearMiss) tags.add('near-miss');
  return { person: {
    display_name: pick(row, ['display_name', 'name', 'full name']).slice(0, 200),
    email: email || null,
    phone: phone || null,
    instagram_handle: handle || null,
    lead_type,
    niche: pick(row, ['niche', 'industry']).slice(0, 120) || null,
    tags: [...tags],
  } };
}

/** Keys a person is deduped on, in order of trust. */
export function dedupeKeys(p) {
  const out = [];
  const e = normalizeEmail(p.email); if (e) out.push('e:' + e);
  const ph = normalizePhone(p.phone); if (ph) out.push('p:' + ph);
  const h = normalizeHandle(p.instagram_handle); if (h) out.push('h:' + h);
  return out;
}

/** Fills blanks on an existing person from an incoming row; never overwrites
 *  a value someone already has, never touches stage or owner. */
export function mergeForImport(existing, incoming) {
  const patch = {};
  for (const k of ['display_name', 'email', 'phone', 'instagram_handle', 'niche']) {
    if (!String(existing[k] || '').trim() && incoming[k]) patch[k] = incoming[k];
  }
  const tags = new Set([...(existing.tags || []), ...(incoming.tags || [])]);
  if (tags.size !== (existing.tags || []).length) patch.tags = [...tags];
  return patch;
}

// ── Ingest (n8n, server key only; crm-leads `ingest`) ───────────────────
// n8n logs what happened to a lead outside SyncView. One request = one fact.
// No migration: each event maps onto a crm_events kind the table already
// allows, and the n8n name is kept in detail.event. The `reply` and `booked`
// kinds are the ones the sequence stop rule (crm-sequences-core stopReason)
// already reads.
export const INGEST_EVENTS = {
  form_capture: { kind: 'imported', channel: 'system' },
  form_submit: { kind: 'imported', channel: 'system' },
  booked: { kind: 'booked', channel: 'call' },
  cancelled: { kind: 'call', channel: 'call' },
  rescheduled: { kind: 'call', channel: 'call' },
  no_show_marked: { kind: 'call', channel: 'call' },
  sms_sent: { kind: 'message_sent', channel: 'sms' },
  email_sent: { kind: 'message_sent', channel: 'email' },
  sms_reply: { kind: 'reply', channel: 'sms' },
  recovery_email_sent: { kind: 'message_sent', channel: 'email' },
  recovery_sms_sent: { kind: 'message_sent', channel: 'sms' },
  confirmation_sent: { kind: 'message_sent', channel: 'email' },
  nurture_sent: { kind: 'message_sent', channel: 'email' },
};
export const SOURCE_KINDS = ['csv_import', 'quiz', 'ad', 'referral', 'manual', 'other'];
const INGEST_CHANNELS = ['instagram_dm', 'email', 'sms', 'call', 'task', 'system'];
/** detail keys never stored: message bodies and anything secret-shaped. */
const DROP_DETAIL = /^(body|text|html|message|content|transcript|password|secret|token|api_?key|key|authorization|auth|cookie|signature)$|token|secret|password/i;
const TEST_EMAIL = /^sidney\.laruel\+[^@\s]*@gmail\.com$/;

function isoOrNull(v) {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(v) || isNaN(Date.parse(v))) return null;
  return new Date(v).toISOString();
}

/** Flat, small, no bodies, no secrets. */
export function cleanDetail(input) {
  const out = {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) return out;
  let n = 0;
  for (const [k, v] of Object.entries(input)) {
    if (n >= 30) break;
    if (!/^[a-z0-9_]{1,40}$/i.test(k) || DROP_DETAIL.test(k)) continue;
    if (typeof v === 'string') out[k] = v.slice(0, 300);
    else if (typeof v === 'number' && isFinite(v)) out[k] = v;
    else if (typeof v === 'boolean' || v === null) out[k] = v;
    else continue;
    n++;
  }
  return out;
}

/** Validates an ingest body. Returns { ok, ... } or { ok: false, error }. */
export function validateIngest(body) {
  const b = body && typeof body === 'object' ? body : {};
  const event = String(b.event || '');
  const map = INGEST_EVENTS[event];
  if (!map) return { ok: false, error: 'bad_event' };
  const key = typeof b.idempotency_key === 'string' ? b.idempotency_key.trim() : '';
  if (!key || key.length > 200) return { ok: false, error: 'bad_idempotency_key' };
  const p = b.person && typeof b.person === 'object' ? b.person : {};
  const person = {
    display_name: typeof p.name === 'string' ? p.name.trim().slice(0, 200) : '',
    email: normalizeEmail(p.email) && String(p.email).trim().length <= 320 ? String(p.email).trim() : null,
    phone: normalizePhone(p.phone) && String(p.phone).trim().length <= 40 ? String(p.phone).trim() : null,
    instagram_handle: normalizeHandle(p.instagram) && cleanHandle(p.instagram).length <= 100 ? cleanHandle(p.instagram) : null,
    timezone: validZone(p.timezone) ? p.timezone : null,
  };
  if (!person.email && !person.phone && !person.instagram_handle) return { ok: false, error: 'no_contact' };
  const s = b.source && typeof b.source === 'object' ? b.source : {};
  const sourceName = typeof s.name === 'string' ? s.name.trim().slice(0, 120) : '';
  const source = sourceName ? { name: sourceName, kind: SOURCE_KINDS.includes(s.kind) ? s.kind : 'other' } : null;
  const occurredAt = b.occurred_at == null || b.occurred_at === '' ? null : isoOrNull(b.occurred_at);
  if (b.occurred_at != null && b.occurred_at !== '' && !occurredAt) return { ok: false, error: 'bad_occurred_at' };
  const callAt = b.call_at == null || b.call_at === '' ? null : isoOrNull(b.call_at);
  if (b.call_at != null && b.call_at !== '' && !callAt) return { ok: false, error: 'bad_call_at' };
  if ((event === 'booked' || event === 'rescheduled') && !callAt) return { ok: false, error: 'call_at_required' };
  let channel = map.channel;
  if (b.channel != null && b.channel !== '') {
    if (!INGEST_CHANNELS.includes(b.channel)) return { ok: false, error: 'bad_channel' };
    channel = b.channel;
  }
  const actor = typeof b.actor === 'string' && b.actor.trim() ? b.actor.trim().slice(0, 80) : 'n8n';
  const detail = cleanDetail(b.detail);
  const isTest = !!(person.email && TEST_EMAIL.test(normalizeEmail(person.email)))
    || String(detail.utm_source || '').trim().toLowerCase() === 'test';
  // match_only: log only for someone already in the CRM; never create a person.
  const matchOnly = b.match_only === true;
  return { ok: true, event, kind: map.kind, channel, key, person, source, occurredAt, callAt, actor, detail, isTest, matchOnly };
}

/** Stage moves an ingest may make: forward only, from the listed stages. */
function forwardTo(current, target, from) {
  return from.includes(current) && current !== target ? target : null;
}

/** The person-level change one validated ingest makes. Pure.
 *  Returns { patch, events } for crm_apply_change (events include the ingest
 *  row itself), and stopEnrolments when active sequences must stop. */
export function ingestPlan(before, v) {
  const b = before || {};
  const patch = {};
  if (v.event === 'booked') {
    const to = forwardTo(b.stage, 'call1_booked', ['to_contact', 'contacted', 'replied', 'no_show']);
    if (to) patch.stage = to;
    patch.call_at = v.callAt;
  } else if (v.event === 'rescheduled') {
    patch.call_at = v.callAt;
  } else if (v.event === 'cancelled') {
    patch.call_at = '';
  } else if (v.event === 'sms_reply') {
    const to = forwardTo(b.stage, 'replied', ['to_contact', 'contacted']);
    if (to) patch.stage = to;
  }
  if (v.person.timezone && !b.timezone) patch.timezone = v.person.timezone;
  if (v.isTest) {
    const tags = Array.isArray(b.tags) ? b.tags : [];
    if (!tags.includes('test')) patch.tags = [...tags, 'test'];
  }
  const eff = effectivePatch(b, patch);
  const detail = Object.assign({}, v.detail, {
    event: v.event, idempotency_key: v.key,
    source: v.source ? v.source.name : null,
    occurred_at: v.occurredAt,
    call_at: v.callAt || (v.event === 'cancelled' ? (b.call_at || null) : null),
    test: v.isTest || undefined,
  });
  if (!detail.test) delete detail.test;
  const events = [{ kind: v.kind, channel: v.channel, detail }, ...changeEvents(b, eff, '')];
  return { patch: eff, events, stopEnrolments: v.event === 'sms_reply' };
}
