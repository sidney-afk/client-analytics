// @ts-check

/** @typedef {{ name: string, date: string, observed_date: string }} PtoHoliday */
/** @typedef {'ineligible' | '2-6mo' | '6mo+'} TenureBucket */
/** @typedef {'policy_baseline' | 'eligibility' | 'monthly'} GrantKind */
/** @typedef {{ date: Date, amount: number, kind: GrantKind }} GrantCandidate */
/** @typedef {{ date: string, amount: number, kind: GrantKind, bucket: TenureBucket, cap: number }} GrantEvent */
/**
 * @typedef {object} PtoMemberInput
 * @property {string=} member_id
 * @property {string=} id
 * @property {string=} pto_start_date
 * @property {string=} start_date
 */
/**
 * @typedef {object} PtoRequestInput
 * @property {string=} id
 * @property {string=} member_id
 * @property {string=} type
 * @property {string=} start_date
 * @property {string=} end_date
 * @property {number|string=} days
 * @property {string=} status
 */
/**
 * @typedef {object} PtoAdjustmentInput
 * @property {string=} member_id
 * @property {string=} kind
 * @property {number|string=} delta
 * @property {string=} effective_date
 */
/**
 * @typedef {object} PtoBalance
 * @property {string} as_of_date
 * @property {string} pto_start_date
 * @property {string} eligibility_date
 * @property {boolean} eligible
 * @property {TenureBucket} tenure_bucket
 * @property {string} leave_year_start
 * @property {string} leave_year_end
 * @property {number} wellness_cap
 * @property {number} wellness_granted
 * @property {number} wellness_approved_used
 * @property {number} wellness_adjustment
 * @property {number} wellness_used
 * @property {number} wellness_available
 * @property {number} sick_granted
 * @property {number} sick_approved_used
 * @property {number} sick_adjustment
 * @property {number} sick_used
 * @property {number} sick_available
 * @property {boolean} floating_holiday_used
 * @property {boolean} floating_holiday_pending
 * @property {number} floating_holiday_available
 * @property {'used'|'pending'|'available'|'ineligible'} floating_holiday_status
 * @property {string|null} next_accrual_date
 * @property {GrantEvent[]} wellness_grant_events
 */

export const FLOATING_HOLIDAY_ALLOWANCE = 1;

/**
 * Return the five fixed company holidays and their US-observed dates.
 *
 * @param {number|string} year
 * @returns {PtoHoliday[]}
 */
export function ptoFixedHolidays(year) {
  const y = Number(year);
  if (!Number.isInteger(y) || y < 1900 || y > 2200) throw new Error("invalid holiday year");

  /** @param {Date} date @returns {string} */
  function iso(date) {
    return date.toISOString().slice(0, 10);
  }

  /** @param {Date} date @returns {Date} */
  function observed(date) {
    const copy = new Date(date.getTime());
    const day = copy.getUTCDay();
    if (day === 6) copy.setUTCDate(copy.getUTCDate() - 1);
    if (day === 0) copy.setUTCDate(copy.getUTCDate() + 1);
    return copy;
  }

  /** @param {string} name @param {number} month @param {number} day @returns {PtoHoliday} */
  function fixed(name, month, day) {
    const date = new Date(Date.UTC(y, month - 1, day));
    return { name: name, date: iso(date), observed_date: iso(observed(date)) };
  }

  const novemberFirst = new Date(Date.UTC(y, 10, 1));
  const thanksgivingDay = 1 + ((4 - novemberFirst.getUTCDay() + 7) % 7) + 21;
  const thanksgiving = new Date(Date.UTC(y, 10, thanksgivingDay));

  return [
    fixed("New Year's Day", 1, 1),
    fixed("Independence Day", 7, 4),
    { name: "Thanksgiving", date: iso(thanksgiving), observed_date: iso(thanksgiving) },
    fixed("Christmas Eve", 12, 24),
    fixed("Christmas Day", 12, 25),
  ];
}

/**
 * Count inclusive business days, excluding weekends and observed holidays.
 *
 * @param {string} startDate
 * @param {string} endDate
 * @returns {number}
 */
export function countPtoDays(startDate, endDate) {
  /** @param {string} value @returns {Date} */
  function parse(value) {
    const raw = String(value == null ? "" : value).trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) throw new Error("invalid date");
    const date = new Date(raw + "T00:00:00Z");
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== raw) {
      throw new Error("invalid date");
    }
    return date;
  }

  const start = parse(startDate);
  const end = parse(endDate);
  if (end.getTime() < start.getTime()) throw new Error("end before start");
  const span = Math.floor((end.getTime() - start.getTime()) / 86400000);
  if (span > 3660) throw new Error("date range too large");

  /** @type {Set<string>} */
  const holidays = new Set();
  for (let year = start.getUTCFullYear() - 1; year <= end.getUTCFullYear() + 1; year++) {
    for (const holiday of ptoFixedHolidays(year)) holidays.add(holiday.observed_date);
  }

  let days = 0;
  const cursor = new Date(start.getTime());
  while (cursor.getTime() <= end.getTime()) {
    const weekday = cursor.getUTCDay();
    const iso = cursor.toISOString().slice(0, 10);
    if (weekday !== 0 && weekday !== 6 && !holidays.has(iso)) days += 1;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

/**
 * Compute the complete server-authoritative PTO balance at a date cutoff.
 *
 * @param {PtoMemberInput} member
 * @param {PtoRequestInput[]|null|undefined} requests
 * @param {PtoAdjustmentInput[]|null|undefined} adjustments
 * @param {string|Date} asOfDate
 * @returns {PtoBalance}
 */
export function computePtoBalance(member, requests, adjustments, asOfDate) {
  const DAY = 86400000;
  const POLICY_BASELINE = "2026-02-06";

  /** @param {unknown} value @returns {Date} */
  function parse(value) {
    if (value instanceof Date) {
      if (!Number.isFinite(value.getTime())) throw new Error("invalid date");
      return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
    }
    const raw = String(value == null ? "" : value).trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) throw new Error("invalid date");
    const date = new Date(raw + "T00:00:00Z");
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== raw) {
      throw new Error("invalid date");
    }
    return date;
  }

  /** @param {Date} date @returns {string} */
  function iso(date) {
    return date.toISOString().slice(0, 10);
  }

  /** @param {Date} date @param {number} count @returns {Date} */
  function addDays(date, count) {
    const copy = new Date(date.getTime());
    copy.setUTCDate(copy.getUTCDate() + count);
    return copy;
  }

  /** @param {number} year @param {number} month @returns {number} */
  function daysInMonth(year, month) {
    return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  }

  /** @param {number} year @param {number} month @param {number} day @returns {Date} */
  function makeClamped(year, month, day) {
    return new Date(Date.UTC(year, month, Math.min(day, daysInMonth(year, month))));
  }

  /** @param {Date} date @param {number} count @returns {Date} */
  function addMonths(date, count) {
    const index = date.getUTCFullYear() * 12 + date.getUTCMonth() + count;
    const year = Math.floor(index / 12);
    const month = ((index % 12) + 12) % 12;
    return makeClamped(year, month, date.getUTCDate());
  }

  /** @param {Date} date @returns {Date} */
  function firstOfFollowingMonth(date) {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));
  }

  /** @param {Date} a @param {Date} b @returns {Date} */
  function maxDate(a, b) {
    return a.getTime() >= b.getTime() ? a : b;
  }

  /** @param {Date} date @param {Date} start @param {Date} end @returns {boolean} */
  function within(date, start, end) {
    return date.getTime() >= start.getTime() && date.getTime() <= end.getTime();
  }

  /** @param {unknown} value @returns {number} */
  function amount(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
  }

  /** @param {number} value @returns {number} */
  function round(value) {
    return Math.round((value + Number.EPSILON) * 100) / 100;
  }

  const hire = parse(member && (member.pto_start_date || member.start_date));
  const asOf = parse(asOfDate);
  const baseline = parse(POLICY_BASELINE);
  const eligibility = addDays(hire, 60);
  const sixMonths = addMonths(hire, 6);
  const memberId = String(member && (member.member_id || member.id) || "");

  /** @param {number} year @returns {Date} */
  function anniversary(year) {
    return makeClamped(year, hire.getUTCMonth(), hire.getUTCDate());
  }

  let leaveYearStart = hire;
  if (asOf.getTime() >= hire.getTime()) {
    leaveYearStart = anniversary(asOf.getUTCFullYear());
    if (leaveYearStart.getTime() > asOf.getTime()) {
      leaveYearStart = anniversary(asOf.getUTCFullYear() - 1);
    }
    if (leaveYearStart.getTime() < hire.getTime()) leaveYearStart = hire;
  }
  const nextAnniversary = anniversary(leaveYearStart.getUTCFullYear() + 1);
  const leaveYearEnd = addDays(nextAnniversary, -1);

  /** @param {Date} date @returns {TenureBucket} */
  function bucketAt(date) {
    if (date.getTime() < eligibility.getTime()) return "ineligible";
    return date.getTime() < sixMonths.getTime() ? "2-6mo" : "6mo+";
  }

  /** @param {Date} cycleStart @param {Date} cycleEnd @returns {GrantEvent[]} */
  function eventsForCycle(cycleStart, cycleEnd) {
    /** @type {GrantCandidate[]} */
    const candidates = [];

    if (within(baseline, cycleStart, cycleEnd) && eligibility.getTime() <= baseline.getTime()) {
      candidates.push({
        date: baseline,
        amount: sixMonths.getTime() <= baseline.getTime() ? 6 : 2,
        kind: "policy_baseline",
      });
    } else if (
      eligibility.getTime() > baseline.getTime()
      && within(eligibility, cycleStart, cycleEnd)
    ) {
      candidates.push({ date: eligibility, amount: 2, kind: "eligibility" });
    }

    let boundary = maxDate(cycleStart, baseline);
    boundary = maxDate(boundary, eligibility);
    let monthly = firstOfFollowingMonth(boundary);
    while (monthly.getTime() <= cycleEnd.getTime()) {
      const bucket = bucketAt(monthly);
      if (bucket !== "ineligible") {
        candidates.push({
          date: new Date(monthly.getTime()),
          amount: bucket === "2-6mo" ? 0.5 : 1,
          kind: "monthly",
        });
      }
      monthly = firstOfFollowingMonth(monthly);
    }

    candidates.sort(function (a, b) { return a.date.getTime() - b.date.getTime(); });
    /** @type {GrantEvent[]} */
    const events = [];
    let granted = 0;
    for (const candidate of candidates) {
      const bucket = bucketAt(candidate.date);
      const cap = bucket === "6mo+" ? 12 : 6;
      const grant = Math.min(candidate.amount, Math.max(0, cap - granted));
      if (grant <= 0) continue;
      granted = round(granted + grant);
      events.push({
        date: iso(candidate.date),
        amount: grant,
        kind: candidate.kind,
        bucket: bucket,
        cap: cap,
      });
    }
    return events;
  }

  const cycleEvents = eventsForCycle(leaveYearStart, leaveYearEnd);
  const grantedEvents = cycleEvents.filter(function (event) {
    return event.date <= iso(asOf);
  });
  const wellnessGranted = round(grantedEvents.reduce(function (sum, event) {
    return sum + event.amount;
  }, 0));

  let nextAccrual = cycleEvents.find(function (event) { return event.date > iso(asOf); }) || null;
  if (!nextAccrual) {
    const followingStart = nextAnniversary;
    const followingEnd = addDays(anniversary(followingStart.getUTCFullYear() + 1), -1);
    nextAccrual = eventsForCycle(followingStart, followingEnd)[0] || null;
  }

  /** @param {PtoRequestInput|PtoAdjustmentInput|null|undefined} row @returns {boolean} */
  function belongs(row) {
    if (!row || typeof row !== "object") return false;
    const rowMember = String(row.member_id || "");
    return !memberId || !rowMember || rowMember === memberId;
  }

  /** @param {unknown} value @returns {boolean} */
  function inCurrentLeaveYear(value) {
    try {
      return within(parse(value), leaveYearStart, leaveYearEnd);
    } catch (_error) {
      return false;
    }
  }

  const requestRows = Array.isArray(requests) ? requests.filter(belongs) : [];
  const adjustmentRows = Array.isArray(adjustments) ? adjustments.filter(belongs) : [];
  let wellnessApproved = 0;
  let sickApproved = 0;
  let floatingUsed = false;
  let floatingPending = false;

  for (const request of requestRows) {
    const requestDays = amount(request.days);
    if (request.status === "approved" && inCurrentLeaveYear(request.start_date)) {
      if (request.type === "wellness") wellnessApproved += requestDays;
      if (request.type === "sick") sickApproved += requestDays;
    }
    let requestYear = "";
    try { requestYear = String(parse(request.start_date).getUTCFullYear()); } catch (_error) {}
    if (request.type === "floating_holiday" && requestYear === String(asOf.getUTCFullYear())) {
      if (request.status === "approved") floatingUsed = true;
      if (request.status === "pending") floatingPending = true;
    }
  }

  let wellnessAdjustment = 0;
  let sickAdjustment = 0;
  for (const adjustment of adjustmentRows) {
    /** @type {Date} */
    let effectiveDate;
    try { effectiveDate = parse(adjustment.effective_date); } catch (_error) { continue; }
    if (!within(effectiveDate, leaveYearStart, leaveYearEnd) || effectiveDate.getTime() > asOf.getTime()) continue;
    if (adjustment.kind === "wellness") wellnessAdjustment += amount(adjustment.delta);
    if (adjustment.kind === "sick") sickAdjustment += amount(adjustment.delta);
  }

  wellnessApproved = round(wellnessApproved);
  sickApproved = round(sickApproved);
  wellnessAdjustment = round(wellnessAdjustment);
  sickAdjustment = round(sickAdjustment);
  const eligible = asOf.getTime() >= eligibility.getTime() && asOf.getTime() >= baseline.getTime();
  const sickGranted = eligible ? 3 : 0;
  const wellnessUsed = round(wellnessApproved - wellnessAdjustment);
  const sickUsed = round(sickApproved - sickAdjustment);
  const bucket = bucketAt(asOf);

  return {
    as_of_date: iso(asOf),
    pto_start_date: iso(hire),
    eligibility_date: iso(eligibility),
    eligible: eligible,
    tenure_bucket: bucket,
    leave_year_start: iso(leaveYearStart),
    leave_year_end: iso(leaveYearEnd),
    wellness_cap: bucket === "6mo+" ? 12 : (bucket === "2-6mo" ? 6 : 0),
    wellness_granted: wellnessGranted,
    wellness_approved_used: wellnessApproved,
    wellness_adjustment: wellnessAdjustment,
    wellness_used: wellnessUsed,
    wellness_available: round(wellnessGranted - wellnessApproved + wellnessAdjustment),
    sick_granted: sickGranted,
    sick_approved_used: sickApproved,
    sick_adjustment: sickAdjustment,
    sick_used: sickUsed,
    sick_available: round(sickGranted - sickApproved + sickAdjustment),
    floating_holiday_used: floatingUsed,
    floating_holiday_pending: floatingPending,
    floating_holiday_available: eligible && !floatingUsed && !floatingPending ? FLOATING_HOLIDAY_ALLOWANCE : 0,
    floating_holiday_status: floatingUsed ? "used" : (floatingPending ? "pending" : (eligible ? "available" : "ineligible")),
    next_accrual_date: nextAccrual ? nextAccrual.date : null,
    wellness_grant_events: grantedEvents,
  };
}
