// Pure rules for Leads follow-up sequences (crm-leads Edge Function, the
// Leads page and test/crm-sequences.js). No I/O. Nothing here sends anything:
// the `due` action only answers what a future sender MAY send now, and the
// sender records each result with `log_send`. Model: docs/features/CRM_LEADS.md.

export const SEQ_CHANNELS = ['sms', 'email'];
export const SEQ_AUDIENCES = ['all', 'lost_price', 'lost_trust', 'lost_other'];
export const APPROVAL_STATES = ['draft', 'approved'];
/** Texts go out only from 08:00 up to (not including) 18:00, lead's local time. */
export const TEXT_WINDOW = { from: 8, to: 18 };
/** Used when a lead has no timezone stored. Most leads are US doctors. */
export const DEFAULT_TZ = 'America/New_York';
export const SMS_MAX = 300;
export const SUBJECT_MAX = 200;
export const TEMPLATE_MAX = 4000;
/** Filled here from the person. */
export const PERSON_PLACEHOLDERS = ['first_name', 'niche'];
/** Left in place for the sender to fill (links it owns). */
export const LINK_PLACEHOLDERS = ['rebook_link', 'call2_link', 'case_study_link', 'testimonials_link', 'useful_link'];
export const PLACEHOLDERS = [...PERSON_PLACEHOLDERS, ...LINK_PLACEHOLDERS];
export const SEND_RESULTS = ['sent', 'failed', 'skipped'];

const DAY = 86400000;
const HOUR = 3600000;

// ── Time zones ────────────────────────────────────────────────────────────
export function validTimeZone(tz) {
  if (typeof tz !== 'string' || !tz.trim() || tz.length > 64) return false;
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch (e) { return false; }
}
export function zoneOf(person) {
  return person && validTimeZone(person.timezone) ? person.timezone : DEFAULT_TZ;
}
/** Wall-clock parts of an instant in a zone. */
export function localParts(ms, tz) {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });
  const o = {};
  for (const p of f.formatToParts(new Date(ms))) if (p.type !== 'literal') o[p.type] = Number(p.value);
  return { y: o.year, m: o.month, d: o.day, h: o.hour === 24 ? 0 : o.hour, min: o.minute };
}
/** The instant when the wall clock in `tz` reads y-m-d h:00. */
export function zonedToUtc(y, m, d, h, tz) {
  let guess = Date.UTC(y, m - 1, d, h);
  for (let i = 0; i < 3; i++) {
    const p = localParts(guess, tz);
    const seen = Date.UTC(p.y, p.m - 1, p.d, p.h, p.min);
    const want = Date.UTC(y, m - 1, d, h);
    if (seen === want) break;
    guess += want - seen;
  }
  return guess;
}
export function inTextWindow(ms, tz) {
  const h = localParts(ms, tz).h;
  return h >= TEXT_WINDOW.from && h < TEXT_WINDOW.to;
}

/** When a step becomes due for one enrolment. With send_hour set, it is that
 *  hour (lead's local time) on the enrolment's local date plus day_offset;
 *  otherwise enrolment time + day_offset days + hour_offset hours. */
export function stepDueAt(step, enrolledAtMs, tz) {
  const day = Number(step.day_offset) || 0;
  if (step.send_hour == null || step.send_hour === '') return enrolledAtMs + day * DAY + (Number(step.hour_offset) || 0) * HOUR;
  const p = localParts(enrolledAtMs, tz);
  const base = new Date(Date.UTC(p.y, p.m - 1, p.d + day));
  return zonedToUtc(base.getUTCFullYear(), base.getUTCMonth() + 1, base.getUTCDate(), Number(step.send_hour), tz);
}

// ── Templates ─────────────────────────────────────────────────────────────
export function placeholdersIn(template) {
  const out = new Set();
  String(template || '').replace(/\{([a-z0-9_]+)\}/gi, (_, k) => { out.add(k); return ''; });
  return [...out];
}
export function firstName(displayName) {
  const words = String(displayName || '').replace(/^\s*(dr\.?|doctor)\s+/i, '').trim().split(/\s+/);
  return words[0] || '';
}
/** Fills the person placeholders. Link placeholders stay, listed in `needs`. */
export function renderTemplate(template, person) {
  const vars = { first_name: firstName(person && person.display_name) || 'there', niche: String(person && person.niche || '').trim() || 'your field' };
  const needs = new Set();
  const text = String(template || '').replace(/\{([a-z0-9_]+)\}/gi, (whole, k) => {
    if (k in vars) return vars[k];
    needs.add(k);
    return whole;
  });
  return { text, needs: [...needs] };
}

/** A step edit from the page. Returns { ok, fields } or { ok:false, error }. */
export function validateStepEdit(input, channel) {
  const src = input && typeof input === 'object' && !Array.isArray(input) ? input : null;
  if (!src) return { ok: false, error: 'fields_required' };
  if (!SEQ_CHANNELS.includes(channel)) return { ok: false, error: 'bad_channel' };
  const fields = {};
  for (const key of Object.keys(src)) {
    const v = src[key];
    if (key === 'template') {
      if (typeof v !== 'string' || !v.trim()) return { ok: false, error: 'template_required' };
      const t = v.trim();
      if (t.length > TEMPLATE_MAX) return { ok: false, error: 'template_too_long' };
      if (channel === 'sms' && t.length > SMS_MAX) return { ok: false, error: 'text_too_long' };
      if (placeholdersIn(t).some((k) => !PLACEHOLDERS.includes(k))) return { ok: false, error: 'unknown_placeholder' };
      fields.template = t;
    } else if (key === 'subject') {
      const s = typeof v === 'string' ? v.trim() : '';
      if (channel === 'sms') { if (s) return { ok: false, error: 'subject_on_text' }; continue; }
      if (!s || s.length > SUBJECT_MAX) return { ok: false, error: 'bad_subject' };
      if (placeholdersIn(s).some((k) => !PERSON_PLACEHOLDERS.includes(k))) return { ok: false, error: 'unknown_placeholder' };
      fields.subject = s;
    } else if (key === 'day_offset') {
      if (!Number.isInteger(v) || v < 0 || v > 365) return { ok: false, error: 'bad_day_offset' };
      fields.day_offset = v;
    } else if (key === 'hour_offset') {
      if (!Number.isInteger(v) || v < 0 || v > 23) return { ok: false, error: 'bad_hour_offset' };
      fields.hour_offset = v;
    } else if (key === 'send_hour') {
      if (v === null || v === '') fields.send_hour = null;
      else if (Number.isInteger(v) && v >= 6 && v <= 20) fields.send_hour = v;
      else return { ok: false, error: 'bad_send_hour' };
    } else {
      return { ok: false, error: 'unknown_field' };
    }
  }
  if (!Object.keys(fields).length) return { ok: false, error: 'fields_required' };
  return { ok: true, fields };
}

// ── Who gets which step ───────────────────────────────────────────────────
export function audienceMatches(step, person) {
  const a = step.audience || 'all';
  const r = person && person.lost_reason;
  if (a === 'all') return true;
  if (a === 'lost_price') return r === 'price';
  if (a === 'lost_trust') return r === 'trust';
  if (a === 'lost_other') return r !== 'price' && r !== 'trust';
  return false;
}

/** Why an enrolment must stop, or '' to carry on. Events are the person's
 *  timeline rows; only those after the enrolment count. */
export function stopReason({ person, enrolment, sequence, events }) {
  if (!person) return 'person_missing';
  if (person.opted_out_at) return 'opted_out';
  const since = Date.parse(enrolment.enrolled_at);
  for (const e of events || []) {
    if (Date.parse(e.occurred_at) < since) continue;
    if (e.kind === 'opted_out' && !(e.detail && e.detail.opted_out === false)) return 'opted_out';
    if (e.kind === 'reply') return 'replied';
    if (e.kind === 'booked') return 'booked';
  }
  const stay = sequence && Array.isArray(sequence.stay_stages) ? sequence.stay_stages : [];
  if (stay.length && !stay.includes(person.stage)) return 'stage_moved';
  return '';
}

/** What one enrolment should do now.
 *  state: 'inactive' | 'stop' (reason) | 'complete' | 'wait' (step, due_at)
 *       | 'hold' (step, reason) | 'send' (step, due_at, channel, to, subject, body, needs) */
export function evaluateEnrolment({ sequence, steps, enrolment, person, events, now }) {
  if (!enrolment || enrolment.status !== 'active') return { state: 'inactive' };
  const reason = stopReason({ person, enrolment, sequence, events });
  if (reason) return { state: 'stop', reason };
  const sent = new Set(enrolment.sent_step_keys || []);
  const skipped = new Set(enrolment.skipped_step_keys || []);
  const remaining = (steps || [])
    .filter((s) => s.is_current !== false && s.sequence_id === enrolment.sequence_id && audienceMatches(s, person))
    .filter((s) => !sent.has(s.step_key) && !skipped.has(s.step_key))
    .sort((a, b) => a.position - b.position);
  if (!remaining.length) return { state: 'complete' };
  const step = remaining[0];
  const tz = zoneOf(person);
  const dueAt = stepDueAt(step, Date.parse(enrolment.enrolled_at), tz);
  const base = { step, due_at: new Date(dueAt).toISOString() };
  if (enrolment.paused) return Object.assign(base, { state: 'hold', reason: 'paused' });
  if (dueAt > now) return Object.assign(base, { state: 'wait' });
  if (!sequence || !sequence.active) return Object.assign(base, { state: 'hold', reason: 'sequence_off' });
  if (step.approval_state !== 'approved') return Object.assign(base, { state: 'hold', reason: 'not_approved' });
  if (!SEQ_CHANNELS.includes(step.channel)) return Object.assign(base, { state: 'hold', reason: 'bad_channel' });
  const to = step.channel === 'sms' ? person.phone : person.email;
  if (!String(to || '').trim()) return Object.assign(base, { state: 'hold', reason: step.channel === 'sms' ? 'no_phone' : 'no_email' });
  if (step.channel === 'sms' && !inTextWindow(now, tz)) return Object.assign(base, { state: 'hold', reason: 'quiet_hours', timezone: tz });
  const body = renderTemplate(step.template, person);
  if (step.channel === 'sms' && body.text.length > SMS_MAX) return Object.assign(base, { state: 'hold', reason: 'text_too_long' });
  const subject = step.channel === 'email' ? renderTemplate(step.subject || '', person).text : null;
  return Object.assign(base, { state: 'send', channel: step.channel, to: String(to).trim(), subject, body: body.text, needs: body.needs, timezone: tz });
}

/** Validates a log_send body. */
export function validateSendLog(input) {
  const src = input && typeof input === 'object' ? input : {};
  if (!SEND_RESULTS.includes(src.result)) return { ok: false, error: 'bad_result' };
  const detail = {};
  if (src.provider_id != null) {
    if (typeof src.provider_id !== 'string' || src.provider_id.length > 200) return { ok: false, error: 'bad_provider_id' };
    detail.provider_id = src.provider_id;
  }
  if (src.error != null) {
    if (typeof src.error !== 'string' || src.error.length > 500) return { ok: false, error: 'bad_error' };
    detail.error = src.error;
  }
  return { ok: true, result: src.result, detail };
}
/** The event kind a send result writes. */
export function sendEventKind(result) {
  return result === 'sent' ? 'message_sent' : result === 'failed' ? 'send_failed' : 'send_skipped';
}

export const ENROLMENT_ACTIONS = ['pause', 'resume', 'skip', 'stop'];
