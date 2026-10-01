// Copied from the live workflow. One edit: a real phone number in the comments below was replaced by a fictional 555 number (public repo); no code changed.
// Decides who is due, and renders every merge field.
// Emits nothing when nothing is due, which is the normal case on most of the
// 144 runs a day. Zero items means the rest of the chain simply does not run.
//
// 2026-09-04 — BOTH CHANNELS, ALWAYS. Every non-finisher now gets an email AND
// a text, not one or the other. This used to be strictly either/or: a lead with
// an email got E1 and nothing else, and only a lead with NO email was parked
// for SMS. Channel need is now computed per channel, per lead:
//
//   needEmail = has an email AND we have not emailed them yet
//   needSms   = has a phone AND we have not texted them yet
//
// Quiet hours (SMS only) are handled WITHOUT delaying the email. If a lead is
// due at 02:00 their time, the email goes immediately and `_sms_pending` is set
// so Mark Email Sent leaves the row 'pending' instead of 'completed'; a later
// run inside the window picks it back up and sends the text. That is why the
// old blanket `if (email_sent_at) continue` is gone — a row can legitimately
// come back around with one channel already done.
//
// FIRST LINE OF DEFENCE AGAINST CHASING SOMEONE WHO BOOKED (2026-09-04):
// reads every row already marked booked (Get Booked Rows) and drops any pending
// lead who matches one by email or by phone. This is our OWN authoritative
// record, not HubSpot's: capture stamps suppressed_reason='booked' the moment a
// booking webhook lands, whereas HubSpot only knows if a deal happened to be
// created. It also catches LEGACY DUPLICATE ROWS written before the capture
// lead_key fix, where the same human exists twice under two different keys.
// Identity is compared on normalised email AND last-9 phone digits, so a lead
// stored as +15550100123 in one row and (555) 010-0123 in another still matches.
// It sits ahead of the channel logic, so it covers both channels at once.

const MAX_AGE_HOURS = 72;      // past this a lead is cold; stop scanning them
const DEFAULT_TZ = 'America/New_York';
const QUIET_START_HOUR = 8;    // recipient-local; SMS-only, email is unaffected
const QUIET_END_HOUR = 21;     // 24h clock, exclusive

// Leads per run, not messages per run — one lead can now cost two sends.
// Keeps a backlog from going out in one burst and bounds any defect that slips
// through.
const MAX_SENDS_PER_RUN = 5;

// Rows armed BEFORE this instant are never chased. Capture has been recording
// since before the sender existed, and those leads are stale — some are days
// old, some are build-time test rows. Only genuinely fresh abandonment gets a
// message. Bump this to "now" any time you want a clean slate.
const ACTIVATED_AFTER = '2026-08-14T23:30:00.000Z';

const now = new Date();
const due = [];
const other = [];

const emailKey = (v) => String(v || '').trim().toLowerCase();
const phoneKey = (v) => {
  const d = String(v || '').replace(/[^0-9]/g, '');
  return d.length >= 7 ? d.slice(-9) : '';
};

// Every identity that has ALREADY BOOKED, from our own table.
// Only bookings inside this window block a fresh chase. Past it the lead is a
// new episode - mirrors the 30-day cooldown in capture's Arm or Touch, so the
// two cannot disagree about whether someone is chaseable.
const BOOKED_LOOKBACK_DAYS = 30;
const bookedCutoff = Date.now() - BOOKED_LOOKBACK_DAYS * 86400000;
const bookedEmails = {};
const bookedPhones = {};
for (const item of $input.all()) {
  const b = item.json;
  if (!b || !b.lead_key) continue;                     // empty item from alwaysOutputData
  if (String(b.suppressed_reason || '') !== 'booked') continue;
  // Undated or unparseable rows fail CLOSED: they stay in the blocking set.
  const _st = Math.max(Date.parse(String(b.updated_at || "")) || 0, Date.parse(String(b.created_at || "")) || 0);
  if (_st && _st < bookedCutoff) continue;
  const be = emailKey(b.email);
  if (be) bookedEmails[be] = true;
  const bp = phoneKey(b.phone);
  if (bp) bookedPhones[bp] = true;
}

// Next two business days. Verified by docs/booking-recovery/n8n/test-date-logic.js
// — "tomorrow or Monday" on a Thursday, "Monday or Tuesday" on a Friday.
function dayOptions(from, tz) {
  const opts = [];
  for (let i = 1; i <= 7 && opts.length < 2; i++) {
    const d = new Date(from.getTime() + i * 86400000);
    const dow = d.toLocaleDateString('en-US', { weekday: 'short', timeZone: tz });
    if (dow === 'Sat' || dow === 'Sun') continue;
    opts.push(i === 1 ? 'tomorrow' : d.toLocaleDateString('en-US', { weekday: 'long', timeZone: tz }));
  }
  while (opts.length < 2) opts.push('later this week');
  return opts;
}

function validTz(tz) {
  if (!tz) return DEFAULT_TZ;
  try { new Date().toLocaleString('en-US', { timeZone: tz }); return tz; }
  catch (e) { return DEFAULT_TZ; }
}

function cleanName(raw) {
  let name = String(raw || '').trim();
  if (!(name.length >= 2 && !/[0-9@]/.test(name))) return '';
  if (name === name.toLowerCase() || name === name.toUpperCase()) {
    name = name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
  }
  return name;
}

function localHour(at, tz) {
  return Number(new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hour12: false }).format(at));
}

for (const item of $('Get Pending').all()) {
  const r = item.json;
  if (String(r.status || '') !== 'pending') continue;

  // Opt-out wins over everything. Anyone flagged is closed out and never
  // contacted again on any channel.
  if (String(r.do_not_contact || '').trim()) {
    other.push({ json: Object.assign({}, r, { _action: 'optout' }) });
    continue;
  }

  // THE BOOKING CHECK. Deliberately ahead of the due-date test so a lead who
  // booked is closed out immediately rather than sitting armed until their
  // timer expires. Ahead of the channel split, so it covers email AND SMS.
  const em = emailKey(r.email);
  const ph = phoneKey(r.phone);
  if ((em && bookedEmails[em]) || (ph && bookedPhones[ph])) {
    other.push({ json: Object.assign({}, r, { _action: 'booked_elsewhere' }) });
    continue;
  }

  const hasEmail = !!String(r.email || '').trim();
  const hasPhone = !!String(r.phone || '').trim();
  const needEmail = hasEmail && !String(r.email_sent_at || '').trim();
  const needSms = hasPhone && !String(r.sms_sent_at || '').trim();

  // Nothing left to send on either channel — close the row out rather than
  // scanning it every ten minutes forever.
  if (!needEmail && !needSms) {
    other.push({ json: Object.assign({}, r, { _action: 'done' }) });
    continue;
  }

  const createdAt = new Date(r.created_at);
  if (isNaN(createdAt)) continue;

  const dueAt = new Date(r.follow_up_due_at);
  if (isNaN(dueAt) || now < dueAt) continue;          // not yet

  // Too old to be worth a message.
  if ((now - createdAt) / 3600000 > MAX_AGE_HOURS) {
    other.push({ json: Object.assign({}, r, { _action: 'expire' }) });
    continue;
  }

  // Armed before the sender existed — stale, never chase.
  if (createdAt < new Date(ACTIVATED_AFTER)) {
    other.push({ json: Object.assign({}, r, { _action: 'stale' }) });
    continue;
  }

  const tz = validTz(r.timezone);
  const hr = localHour(now, tz);
  const inQuietWindow = hr >= QUIET_START_HOUR && hr < QUIET_END_HOUR;

  // Email is never quiet-houred. SMS is: outside 08:00–21:00 in the LEAD's own
  // local time we defer the text rather than send it, and leave the row pending
  // so a later run inside the window delivers it.
  const sendEmail = needEmail;
  const sendSms = needSms && inQuietWindow;

  // Only the text is left and we are outside their window — wait, do not send,
  // do not close the row.
  if (!sendEmail && !sendSms) continue;

  // Owed a text after this run finishes. Mark Email Sent reads this to decide
  // whether the row is finished or has to stay pending for the SMS.
  const smsPending = needSms && !sendSms;

  const opts = dayOptions(now, tz);
  const name = cleanName(r.first_name);

  due.push({ json: Object.assign({}, r, {
    _action: 'send',
    _send_email: sendEmail,
    _send_sms: sendSms,
    _sms_pending: smsPending,
    first_name: name,
    subject: name
      ? name + ', still want that social media strategy call?'
      : 'Still want that social media strategy call?',
    salutation: name ? 'Hi ' + name + ',' : 'Hi,',
    day_option_1: opts[0],
    day_option_2: opts[1]
  }) });
}

// Oldest first, then capped.
due.sort((a, b) => new Date(a.json.created_at) - new Date(b.json.created_at));
return other.concat(due.slice(0, MAX_SENDS_PER_RUN));
