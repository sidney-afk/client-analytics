'use strict';
/*
 * Replay test for n8n exit phase 2, step C (docs/plans/2026-09-30-n8n-exit-phase-2.md).
 *
 * The question it answers BEFORE anything is switched: "if the Dispatch workflow only ran when
 * scripts/booking-recovery-gate.js says something is due, would every recovery that sends today
 * still send, with the same text and channel, never missed and never twice?"
 *
 * It runs the LIVE workflow's own code (test/fixtures/booking-recovery/select-due.n8n.js and
 * safety-gate.n8n.js, copied from workflow version ca93c4bf-fa15-4961-91d2-71921ecbc711) in a
 * sandbox over a set of queue rows at known times, applies the same row updates the Mark steps
 * make, and compares two schedules over five days:
 *   A. the workflow every hour, as today;
 *   B. the same hourly ticks, but the chain runs only when the gate is true (the exact proof);
 *   C. a check every 10 minutes that runs the chain only when the gate is true (the shape a
 *      database timer would have).
 * A and B must match exactly: same sends, same text, same channel, same send time, same final
 * rows. C must send everything A sends, with identical text and channel, never later, never
 * twice. Test people are fictional (example.invalid, 555-01xx numbers). No message is sent.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { gateShouldRun } = require('../scripts/booking-recovery-gate.js');

const FIX = (f) => fs.readFileSync(path.join(__dirname, 'fixtures', 'booking-recovery', f), 'utf8');
const SELECT_DUE = FIX('select-due.n8n.js');
const SAFETY_GATE = FIX('safety-gate.n8n.js');
let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };

// ---------- sandbox for the n8n Code steps ----------
function runCode(src, { nowMs, input, named }) {
  const RealDate = Date;
  class FakeDate extends RealDate {
    constructor(...a) { if (a.length === 0) super(nowMs); else super(...a); }
    static now() { return nowMs; }
  }
  const wrap = (arr) => arr.map((json) => ({ json }));
  const $input = { all: () => wrap(input) };
  const $ = (name) => ({ all: () => wrap(named[name] || []) });
  const fn = new Function('$input', '$', 'Date', 'Intl', src);
  return fn($input, $, FakeDate, Intl).map((i) => i.json);
}

// ---------- the chain: Select Due -> (HubSpot lookup) -> Safety Gate -> Mark steps ----------
const HUBSPOT = [
  { properties: { email: 'hs.booked@example.invalid', phone: '', deal_id: '9001', lifecyclestage: 'lead' } },
  { properties: { email: '', phone: '+1 (555) 010-0707', deal_id: '', iclosed_status: 'booked', lifecyclestage: 'lead' } },
  { properties: { email: 'hs.customer@example.invalid', phone: '', deal_id: '', lifecyclestage: 'customer' } },
];

function runChain(rows, nowMs, sends, log) {
  const booked = rows.filter((r) => String(r.suppressed_reason || '') === 'booked');
  const pending = rows.filter((r) => String(r.status || '') === 'pending').map((r) => Object.assign({}, r));
  const due = runCode(SELECT_DUE, { nowMs, input: booked, named: { 'Get Pending': pending } });
  if (!due.length) return 0;
  const hsHits = HUBSPOT.filter((h) => due.some((r) => r.email && String(r.email).toLowerCase() === h.properties.email
      || (r.phone && String(r.phone).replace(/\D/g, '').slice(-9) === String(h.properties.phone).replace(/\D/g, '').slice(-9) && String(h.properties.phone))));
  const out = runCode(SAFETY_GATE, { nowMs, input: hsHits, named: { 'Select Due': due } });
  const iso = new Date(nowMs).toISOString();
  for (const item of out) {
    const row = rows.find((r) => r.lead_key === item.lead_key);
    if (item._route === 'suppress') {
      row.status = 'suppressed'; row.suppressed_reason = item.suppressed_reason; row.updated_at = iso;
      log.push({ at: nowMs, lead: item.lead_key, action: 'suppress:' + item.suppressed_reason });
      continue;
    }
    if (item._send_email) {
      row.email_sent_at = iso; row.status = item._sms_pending ? 'pending' : 'completed'; row.updated_at = iso;
      sends.push({ at: nowMs, lead: item.lead_key, channel: 'email', subject: item.subject, salutation: item.salutation, d1: item.day_option_1, d2: item.day_option_2 });
    }
    if (item._send_sms) {
      row.sms_sent_at = iso; row.status = 'completed'; row.updated_at = iso;
      sends.push({ at: nowMs, lead: item.lead_key, channel: 'sms', name: item.first_name, d1: item.day_option_1, d2: item.day_option_2 });
    }
  }
  return out.length;
}

// ---------- fictional queue ----------
const H = 3600000;
const T0 = Date.parse('2026-10-05T08:00:00Z');           // a Monday
const iso = (ms) => new Date(ms).toISOString();
let n = 0;
const row = (over) => {
  n++;
  const dueMs = over.dueMs;
  const base = {
    lead_key: 'lead-' + String(n).padStart(2, '0'), status: 'pending', first_name: 'Test' + String.fromCharCode(96 + n),
    email: 'person' + n + '@example.invalid', phone: '+1555010' + String(1000 + n).slice(-4), timezone: 'America/New_York',
    created_at: iso(dueMs - 30 * 60000), follow_up_due_at: iso(dueMs), email_sent_at: '', sms_sent_at: '', do_not_contact: '',
    suppressed_reason: '', updated_at: iso(dueMs - 30 * 60000), utm_source: 'meta',
  };
  delete over.dueMs;
  return Object.assign(base, over);
};
const ROWS = () => {
  n = 0;
  return [
    row({ dueMs: T0 + 4 * H }),                                                             // 01 due exactly on the hour (12:00Z)
    row({ dueMs: T0 + 4 * H + 40 * 60000 }),                                                // 02 due 12:40Z
    row({ dueMs: T0 + 4 * H + 40 * 60000, email: 'just.booked@example.invalid', phone: '' }), // 03 booked in the same hour (see booked row)
    row({ dueMs: T0 + 5 * H, email: '', phone: '+1 (555) 010-0123' }),                       // 04 person just booked, phone written differently
    row({ dueMs: T0 + 5 * H, email: 'hs.booked@example.invalid', phone: '' }),              // 05 booked in HubSpot (deal)
    row({ dueMs: T0 + 5 * H, email: '', phone: '+15550100707' }),                            // 06 booked in HubSpot (iClosed status)
    row({ dueMs: T0 + 5 * H, email: 'hs.customer@example.invalid', phone: '' }),             // 07 existing customer
    row({ dueMs: T0 - 3 * H, email_sent_at: iso(T0 - 2 * H) }),                               // 08 emailed earlier, text owed
    row({ dueMs: T0 - 2 * H }),                                                              // 09 due at 02:00 ET: email now, text in the morning
    row({ dueMs: T0 + 6 * H, do_not_contact: 'yes' }),                                       // 10 opted out
    row({ dueMs: T0 - 80 * H, created_at: iso(T0 - 90 * H) }),                               // 11 too old, expires
    row({ dueMs: T0 - 60 * H, created_at: iso(Date.parse('2026-08-01T00:00:00Z')) }),        // 12 armed before launch, stale
    row({ dueMs: T0 + 6 * H, email: '', phone: '' }),                                        // 13 nothing to send, closed out
    row({ dueMs: T0 + 7 * H, email: '' }),                                                    // 14 phone only
    row({ dueMs: T0 + 7 * H, phone: '' }),                                                    // 15 email only
    row({ dueMs: T0 + 8 * H, timezone: 'Not/AZone' }),                                       // 16 unreadable time zone
    row({ dueMs: T0 + 9 * H, created_at: 'not a date' }),                                    // 17 unreadable created_at, never acts
    row({ dueMs: T0 + 300 * H }),                                                            // 18 not due inside the window
    row({ dueMs: T0 + 10 * H, status: 'completed' }),                                        // 19 already finished
    row({ dueMs: T0 + 10 * H, utm_source: 'test_meta' }),                                    // 20 test-tagged lead
    row({ dueMs: T0 + 10 * H, first_name: 'ANNA' }),                                         // 21 name tidy-up
    row({ dueMs: T0 + 10 * H, first_name: '12' }),                                           // 22 unusable name
    row({ dueMs: Date.parse('2026-10-06T06:50:00Z'), timezone: 'America/Los_Angeles' }),     // 23 crosses local midnight between schedules
    row({ dueMs: T0 + 11 * H, timezone: 'Asia/Tokyo' }),                                     // 24 text window in another zone
  ].concat(Array.from({ length: 8 }, () => row({ dueMs: T0 + 12 * H })), [
    // 33, 34: emailed already, only a text owed, and outside the text window at the first check (21:00 in
    // Auckland), but too old / armed before launch: the live code still closes them, so the gate must wake.
    row({ dueMs: T0 - 80 * H, created_at: iso(T0 - 90 * H), email_sent_at: iso(T0 - 79 * H), timezone: 'Pacific/Auckland' }),
    row({ dueMs: T0 - 60 * H, created_at: iso(Date.parse('2026-08-01T00:00:00Z')), email_sent_at: iso(T0 - 59 * H), timezone: 'Pacific/Auckland' }),
  ]);                    // 25-32 eight leads due at once (cap is 5 per run)
};
const BOOKED = () => [
  { lead_key: 'booked-1', status: 'completed', suppressed_reason: 'booked', email: 'just.booked@example.invalid', phone: '', created_at: iso(T0 + 4 * H + 20 * 60000), updated_at: iso(T0 + 4 * H + 20 * 60000) },
  { lead_key: 'booked-2', status: 'completed', suppressed_reason: 'booked', email: '', phone: '(555) 010-0123', created_at: iso(T0 - 5 * 86400000), updated_at: iso(T0 - 4 * 86400000) },
];

// ---------- schedules ----------
const HORIZON = 120;                                      // hours
function schedule(kind, only) {
  const rows = (only ? ROWS().filter((r) => r.lead_key === only) : ROWS()).concat(BOOKED());
  const sends = [], log = [], gateLog = [];
  const step = kind === 'C' ? 10 * 60000 : H;
  let ran = 0, ticks = 0, emptyWakes = 0;
  for (let t = T0; t <= T0 + HORIZON * H; t += step) {
    ticks++;
    const pending = rows.filter((r) => String(r.status || '') === 'pending');
    const booked = rows.filter((r) => String(r.suppressed_reason || '') === 'booked');
    if (kind === 'A') { ran++; runChain(rows, t, sends, log); continue; }
    const go = gateShouldRun(pending, booked, t);
    if (!go) {
      // The proof: where the gate says "nothing due", the real code must also do nothing.
      const would = runCode(SELECT_DUE, { nowMs: t, input: booked, named: { 'Get Pending': pending.map((r) => Object.assign({}, r)) } });
      gateLog.push({ at: t, wouldDo: would.length });
      continue;
    }
    ran++; if (runChain(rows, t, sends, log) === 0) emptyWakes++;
  }
  return { rows, sends, log, gateLog, ran, ticks, emptyWakes };
}

const A = schedule('A'), B = schedule('B'), C = schedule('C');
const key = (s) => s.lead + '|' + s.channel;
const strip = (s) => ({ lead: s.lead, channel: s.channel, subject: s.subject, salutation: s.salutation, name: s.name, d1: s.d1, d2: s.d2 });

// sanity: the data really exercises every category
const sentLeads = new Set(A.sends.map((s) => s.lead));
ok(A.sends.length >= 20, 'the hourly workflow sends a meaningful number of messages in the replay (' + A.sends.length + ')');
ok(A.sends.some((s) => s.channel === 'email') && A.sends.some((s) => s.channel === 'sms'), 'both channels are exercised');
ok(!sentLeads.has('lead-03') && !sentLeads.has('lead-04'), 'people who booked (own table, even written differently) are never chased');
ok(!sentLeads.has('lead-05') && !sentLeads.has('lead-06') && !sentLeads.has('lead-07'), 'people booked or customers in HubSpot are never chased');
ok(!sentLeads.has('lead-10') && !sentLeads.has('lead-11') && !sentLeads.has('lead-12') && !sentLeads.has('lead-13'), 'opt-outs, expired, stale and empty rows never send');
ok(!sentLeads.has('lead-17') && !sentLeads.has('lead-18') && !sentLeads.has('lead-19'), 'unreadable, not yet due and finished rows never send');
ok(A.sends.filter((s) => s.lead === 'lead-01').length === 2, 'a row due exactly on the hour sends both channels');

// A vs B: exact
ok(JSON.stringify(B.sends) === JSON.stringify(A.sends), 'A vs B: identical sends, same text, channel and send time, in the same order (' + B.sends.length + ' messages)');
ok(JSON.stringify(B.log) === JSON.stringify(A.log), 'A vs B: identical row closures (suppressed, expired, stale)');
ok(JSON.stringify(B.rows) === JSON.stringify(A.rows), 'A vs B: identical final queue rows');
ok(B.gateLog.every((g) => g.wouldDo === 0), 'wherever the gate said nothing is due, the live code would have done nothing (' + B.gateLog.length + ' skipped hours checked)');
ok(B.emptyWakes === 0 && C.emptyWakes === 0, 'the other direction too: whenever the gate wakes the workflow, the live code finds something to do (no empty wakes, including a row that only owes a text outside the lead\'s window)');
ok(B.ran < A.ran, 'the gate skips runs: the chain ran ' + B.ran + ' of ' + A.ran + ' hours');

// no duplicates, ever
for (const [label, run] of [['A', A], ['B', B], ['C', C]]) {
  const seen = new Set();
  for (const s of run.sends) { assert.ok(!seen.has(key(s)), label + ': ' + key(s) + ' sent twice'); seen.add(key(s)); }
  checks++;
}
ok(true, 'no lead is sent the same channel twice in any schedule');

// C: nothing missed, same text and channel, never later
const aByKey = new Map(A.sends.map((s) => [key(s), s]));
const cByKey = new Map(C.sends.map((s) => [key(s), s]));
ok(aByKey.size === cByKey.size && [...aByKey.keys()].every((k) => cByKey.has(k)), 'C: every message the hourly workflow sends is sent by the 10 minute gated check (' + cByKey.size + ' messages), none extra');
let lateCount = 0, textDiff = [];
for (const [k, a] of aByKey) {
  const c = cByKey.get(k);
  if (c.at > a.at) lateCount++;
  const sa = strip(a), sc = strip(c);
  if (JSON.stringify(sa) !== JSON.stringify(sc)) textDiff.push(k);
}
ok(lateCount === 0, 'C: no message goes out later than it does today');
ok(textDiff.every((k) => k.startsWith('lead-23|')) , 'C: text and channel are identical for every message except the one that crosses local midnight (' + textDiff.join(', ') + ')');
const a23 = strip(aByKey.get('lead-23|email')), c23 = strip(cByKey.get('lead-23|email'));
ok(a23.subject === c23.subject && a23.salutation === c23.salutation && (a23.d1 !== c23.d1 || a23.d2 !== c23.d2),
  'C: that one differs only in the "tomorrow or <day>" words, because the text is worded from the send time and C sends 10 minutes earlier, before local midnight');
const closedA = JSON.stringify(A.log.map((l) => l.lead + l.action).sort());
const closedC = JSON.stringify(C.log.map((l) => l.lead + l.action).sort());
ok(closedA === closedC, 'C: the same rows are closed with the same reasons');
ok(C.ran < C.ticks / 2, 'C: the chain ran on ' + C.ran + ' of ' + C.ticks + ' ten minute checks');
const finalStatus = (run) => JSON.stringify(run.rows.map((r) => [r.lead_key, r.status, r.suppressed_reason, !!r.email_sent_at, !!r.sms_sent_at]));
ok(finalStatus(A) === finalStatus(C), 'C: the queue ends in the same state as the hourly run');


// One row at a time. In the mixed queue a due row keeps the workflow running and incidentally
// closes everyone else, which would hide a gate that wakes too late for a row on its own
// (an opt-out, a person who booked, a row with nothing left to send). So every row is also
// replayed alone, and the hourly and gated schedules must agree on each.
let perRow = 0;
for (const r of ROWS()) {
  const a = schedule('A', r.lead_key), b = schedule('B', r.lead_key), c = schedule('C', r.lead_key);
  assert.equal(JSON.stringify(b.sends), JSON.stringify(a.sends), r.lead_key + ' alone: A vs B sends differ');
  assert.equal(JSON.stringify(b.log), JSON.stringify(a.log), r.lead_key + ' alone: A vs B row closures differ');
  assert.equal(JSON.stringify(b.rows), JSON.stringify(a.rows), r.lead_key + ' alone: A vs B final rows differ');
  assert.ok(b.gateLog.every((g) => g.wouldDo === 0), r.lead_key + ' alone: gate said nothing due but the live code would act');
  assert.equal(JSON.stringify(c.sends.map(key).sort()), JSON.stringify(a.sends.map(key).sort()), r.lead_key + ' alone: C sends a different set');
  assert.ok(c.sends.every((x) => { const y = a.sends.find((z) => key(z) === key(x)); return y && x.at <= y.at; }), r.lead_key + ' alone: C sent later than A');
  assert.equal(JSON.stringify(c.log.map((l) => l.lead + l.action).sort()), JSON.stringify(a.log.map((l) => l.lead + l.action).sort()), r.lead_key + ' alone: C closes different rows');
  assert.ok(c.log.every((x) => { const y = a.log.find((z) => z.lead === x.lead && z.action === x.action); return y && x.at <= y.at; }), r.lead_key + ' alone: C closed a row later than A');
  perRow++;
}
ok(perRow === ROWS().length, 'every one of the ' + perRow + ' rows, replayed alone, behaves the same under the gate: same sends, same closures, same final row, never later');

console.log('booking-recovery-replay: ' + checks + ' checks passed ✅ (hourly ' + A.sends.length + ' messages; chain runs A ' + A.ran + ' / B ' + B.ran + ' / C ' + C.ran + ')');
