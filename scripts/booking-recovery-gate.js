'use strict';
/*
 * n8n exit, phase 2 step C: the "is anything due?" test for Sales, Booking Recovery Dispatch.
 *
 * Today the Dispatch workflow wakes every hour, reads the whole booking_recovery queue and the
 * booked rows, and ends with nothing to do on almost every run. A gated trigger would run the
 * workflow only when this answers true. This file is the pure test, so the replay test can prove
 * it against the live workflow's own code (test/fixtures/booking-recovery/) BEFORE anything is
 * switched. Nothing in the live system calls it yet: the queue lives in an n8n data table that a
 * database timer cannot read (docs/ops/BOOKING_RECOVERY_GATE.md).
 *
 * The rule: run when at least one pending row could make the chain DO something. That is
 *   - an opt-out flag (the chain closes the row),
 *   - a match with an identity that already booked (the chain closes the row),
 *   - nothing left to send on either channel (the chain closes the row),
 *   - a valid created_at and follow_up_due_at with the due time reached (the chain sends, expires,
 *     or marks the row stale, or is waiting out the lead's quiet hours and must keep coming back).
 * A pending row with an unreadable date, or one not yet due, does nothing, so it never wakes the
 * workflow. Anything this misses would be a recovery that never sends, which is why the replay
 * test compares it against the real code on every row.
 */

const BOOKED_LOOKBACK_DAYS = 30;

const emailKey = (v) => String(v || '').trim().toLowerCase();
const phoneKey = (v) => {
  const d = String(v || '').replace(/[^0-9]/g, '');
  return d.length >= 7 ? d.slice(-9) : '';
};

// The identities that already booked, same window and same fail-closed rule as the workflow.
function bookedIdentities(bookedRows, nowMs) {
  const cutoff = nowMs - BOOKED_LOOKBACK_DAYS * 86400000;
  const emails = new Set();
  const phones = new Set();
  for (const b of bookedRows || []) {
    if (!b || !b.lead_key) continue;
    if (String(b.suppressed_reason || '') !== 'booked') continue;
    const st = Math.max(Date.parse(String(b.updated_at || '')) || 0, Date.parse(String(b.created_at || '')) || 0);
    if (st && st < cutoff) continue;
    const e = emailKey(b.email);
    if (e) emails.add(e);
    const p = phoneKey(b.phone);
    if (p) phones.add(p);
  }
  return { emails, phones };
}

function gateShouldRun(pendingRows, bookedRows, nowMs) {
  const booked = bookedIdentities(bookedRows, nowMs);
  for (const r of pendingRows || []) {
    if (!r || String(r.status || '') !== 'pending') continue;
    if (String(r.do_not_contact || '').trim()) return true;
    const em = emailKey(r.email);
    const ph = phoneKey(r.phone);
    if ((em && booked.emails.has(em)) || (ph && booked.phones.has(ph))) return true;
    const needEmail = !!String(r.email || '').trim() && !String(r.email_sent_at || '').trim();
    const needSms = !!String(r.phone || '').trim() && !String(r.sms_sent_at || '').trim();
    if (!needEmail && !needSms) return true;
    const created = new Date(r.created_at);
    if (isNaN(created)) continue;
    const dueAt = new Date(r.follow_up_due_at);
    if (isNaN(dueAt) || nowMs < dueAt.getTime()) continue;
    return true;
  }
  return false;
}

module.exports = { gateShouldRun, bookedIdentities, BOOKED_LOOKBACK_DAYS };
