'use strict';

// Deterministic, synthetic-only PTO service used by the lifecycle browser
// simulation. It intentionally imports the production policy implementation
// instead of copying accrual or holiday rules into the test harness.
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const POLICY_FILE = path.join(ROOT, 'supabase', 'functions', 'pto', 'policy.js');
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PTO_TYPES = Object.freeze(['wellness', 'sick', 'floating_holiday', 'unpaid']);
const INITIAL_INSTANT = '2030-04-10T17:00:00.000Z';

const SHARED_CREATIVE_KEY = 'test-pto-shared-creative-role-key';
const ADMIN_KEY = 'test-pto-admin-role-key';

const TEST_PERSONAS = Object.freeze({
  staffA: Object.freeze({
    key: SHARED_CREATIVE_KEY,
    keyRole: 'creative',
    member: Object.freeze({
      id: '00000000-0000-4000-8000-000000000201',
      name: 'TEST PTO Staff Alpha',
      role: 'creative',
      team: 'TEST Studio',
      active: true,
    }),
  }),
  staffB: Object.freeze({
    key: SHARED_CREATIVE_KEY,
    keyRole: 'creative',
    member: Object.freeze({
      id: '00000000-0000-4000-8000-000000000202',
      name: 'TEST PTO Staff Beta',
      role: 'creative',
      team: 'TEST Studio',
      active: true,
    }),
  }),
  admin: Object.freeze({
    key: ADMIN_KEY,
    keyRole: 'admin',
    member: Object.freeze({
      id: '00000000-0000-4000-8000-000000000203',
      name: 'TEST PTO Administrator',
      role: 'admin',
      team: 'TEST Operations',
      active: true,
    }),
  }),
});

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function clean(value, max = 2000) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

function normalize(value) {
  let text = clean(value, 200).toLowerCase();
  try {
    text = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  } catch (_) {}
  return text.replace(/[^a-z0-9@.]+/g, '');
}

function parseIsoDate(value) {
  const raw = clean(value, 20);
  if (!ISO_DATE.test(raw)) return null;
  const date = new Date(`${raw}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === raw ? raw : null;
}

function halfDay(value, allowZero = false) {
  const number = Number(value);
  if (!Number.isFinite(number) || number > 999.5) return null;
  if (allowZero ? number < 0 : number <= 0) return null;
  return Math.round(number * 2) === number * 2 ? number : null;
}

function requestSpanDays(startDate, endDate) {
  return Math.round((
    Date.parse(`${endDate}T00:00:00.000Z`) - Date.parse(`${startDate}T00:00:00.000Z`)
  ) / 86400000) + 1;
}

function dateShiftMonths(value, count) {
  const source = new Date(`${value}T00:00:00.000Z`);
  const yearMonth = source.getUTCFullYear() * 12 + source.getUTCMonth() + count;
  const year = Math.floor(yearMonth / 12);
  const month = ((yearMonth % 12) + 12) % 12;
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(
    year,
    month,
    Math.min(source.getUTCDate(), last),
  )).toISOString().slice(0, 10);
}

function response(status, body) {
  return { status, body };
}

async function loadProductionPolicy() {
  const source = await fs.promises.readFile(POLICY_FILE, 'utf8');
  const url = `data:text/javascript;base64,${Buffer.from(source, 'utf8').toString('base64')}`;
  const policy = await import(url);
  const required = ['computePtoBalance', 'countPtoDays', 'ptoPolicyToday', 'ptoFixedHolidays'];
  for (const name of required) {
    if (typeof policy[name] !== 'function') {
      throw new Error(`Production PTO policy export is missing: ${name}`);
    }
  }
  return policy;
}

function initialState() {
  const members = Object.values(TEST_PERSONAS).map(persona => clone(persona.member));
  return {
    instant: INITIAL_INSTANT,
    members,
    ptoMembers: [
      {
        member_id: TEST_PERSONAS.staffA.member.id,
        pto_start_date: '2029-12-01',
        pto_enabled: true,
        state_version: 0,
        updated_at: INITIAL_INSTANT,
      },
      {
        member_id: TEST_PERSONAS.staffB.member.id,
        // This profile deliberately crosses six months on June 1 and resets
        // on December 1 so the time-travel journey can see both transitions.
        pto_start_date: '2029-12-01',
        pto_enabled: true,
        state_version: 0,
        updated_at: INITIAL_INSTANT,
      },
      {
        member_id: TEST_PERSONAS.admin.member.id,
        pto_start_date: '2029-01-15',
        pto_enabled: true,
        state_version: 0,
        updated_at: INITIAL_INSTANT,
      },
    ],
    requests: [],
    adjustments: [],
    requestSequence: 0,
    adjustmentSequence: 0,
    mutationSequence: 0,
  };
}

async function createMockBackend(options = {}) {
  const policy = await loadProductionPolicy();
  const initial = initialState();
  let state = clone(initial);
  let ledgerSequence = 0;
  const calls = [];
  const unexpectedWrites = [];
  const failureQueue = [];

  function today() {
    return policy.ptoPolicyToday(state.instant);
  }

  function mutationTimestamp() {
    state.mutationSequence += 1;
    return new Date(
      new Date(state.instant).getTime() + state.mutationSequence * 1000,
    ).toISOString();
  }

  function record(action, method, personaKey, status, outcome = 'response') {
    // This intentionally records no names, keys, dates, balances, notes,
    // request bodies, response bodies, or URLs.
    calls.push({
      sequence: ++ledgerSequence,
      action,
      method,
      persona: personaKey || 'unresolved',
      status,
      outcome,
    });
  }

  function recordUnexpected(surface, method) {
    unexpectedWrites.push({
      sequence: unexpectedWrites.length + 1,
      surface: clean(surface, 60) || 'external',
      method: clean(method, 10).toUpperCase() || 'UNKNOWN',
    });
  }

  function personaKeyForMember(memberId) {
    return Object.keys(TEST_PERSONAS).find(key => TEST_PERSONAS[key].member.id === memberId) || '';
  }

  function personaFor(reference) {
    if (!reference) return null;
    if (typeof reference === 'object') {
      if (reference.keyRole && reference.member) return reference;
      if (reference.id) return personaFor(reference.id);
    }
    const raw = clean(reference, 200);
    if (TEST_PERSONAS[raw]) return TEST_PERSONAS[raw];
    return Object.values(TEST_PERSONAS).find(persona =>
      persona.member.id === raw
      || normalize(persona.member.name) === normalize(raw)
    ) || null;
  }

  function memberFor(reference, includeInactive = true) {
    const persona = personaFor(reference);
    const id = persona ? persona.member.id : clean(reference && reference.id || reference, 80);
    const member = state.members.find(row => row.id === id) || null;
    return member && (includeInactive || member.active !== false) ? member : null;
  }

  function ptoMemberFor(memberId) {
    return state.ptoMembers.find(row => row.member_id === memberId) || null;
  }

  function emptyBalance(member, ptoMember) {
    return {
      member_id: member.id,
      name: member.name,
      pto_enabled: !!(ptoMember && ptoMember.pto_enabled),
      pto_start_date: ptoMember ? ptoMember.pto_start_date : null,
      eligible: false,
      leave_year_start: null,
      leave_year_end: null,
      wellness_cap: 0,
      wellness_granted: 0,
      wellness_approved_used: 0,
      wellness_adjustment: 0,
      wellness_used: 0,
      wellness_available: 0,
      sick_granted: 0,
      sick_approved_used: 0,
      sick_adjustment: 0,
      sick_used: 0,
      sick_available: 0,
      floating_holiday_used: false,
      floating_holiday_pending: false,
      floating_holiday_available: 0,
      floating_holiday_status: 'ineligible',
      next_accrual_date: null,
    };
  }

  function balanceFor(reference, asOfDate = today()) {
    const member = memberFor(reference);
    if (!member) return null;
    const ptoMember = ptoMemberFor(member.id);
    if (!ptoMember || !ptoMember.pto_enabled) return emptyBalance(member, ptoMember);
    return {
      member_id: member.id,
      name: member.name,
      pto_enabled: true,
      ...policy.computePtoBalance(
        ptoMember,
        state.requests,
        state.adjustments,
        asOfDate,
      ),
    };
  }

  function serializeRequest(row, memberName = '') {
    return {
      id: row.id,
      member_id: row.member_id,
      member_name: memberName,
      type: row.type,
      start_date: row.start_date,
      end_date: row.end_date,
      days: Number(row.days || 0),
      note: row.note || '',
      status: row.status,
      decided_by: row.decided_by || null,
      decision_note: row.decision_note || '',
      source: row.source || 'syncview',
      requested_at: row.requested_at || '',
      decided_at: row.decided_at || null,
      cancelled_by: row.cancelled_by || null,
      cancelled_at: row.cancelled_at || null,
    };
  }

  function newId(kind) {
    if (kind === 'adjustment') state.adjustmentSequence += 1;
    else state.requestSequence += 1;
    const sequence = kind === 'adjustment' ? state.adjustmentSequence : state.requestSequence;
    const prefix = kind === 'adjustment' ? '20000000' : '10000000';
    return `${prefix}-0000-4000-8000-${String(sequence).padStart(12, '0')}`;
  }

  function bumpState(memberId, timestamp) {
    const ptoMember = ptoMemberFor(memberId);
    if (!ptoMember) return;
    ptoMember.state_version = Number(ptoMember.state_version || 0) + 1;
    ptoMember.updated_at = timestamp || mutationTimestamp();
  }

  function floatingAlreadyClaimed(memberId, year, excludeId = '') {
    return state.requests.some(row =>
      row.id !== excludeId
      && row.member_id === memberId
      && row.type === 'floating_holiday'
      && row.start_date.slice(0, 4) === year
      && (row.status === 'pending' || row.status === 'approved')
    );
  }

  function paidType(type) {
    return type === 'wellness' || type === 'sick' || type === 'floating_holiday';
  }

  function buildOverview(caller, keyRole) {
    const asOf = today();
    const activeMembers = state.members.filter(member => member.active !== false);
    const activeNames = new Map(activeMembers.map(member => [member.id, member.name]));
    const enabledIds = new Set(
      state.ptoMembers.filter(row => row.pto_enabled).map(row => row.member_id),
    );
    const balances = new Map(activeMembers.map(member => [member.id, balanceFor(member.id, asOf)]));
    const isBusinessDay = policy.countPtoDays(asOf, asOf) === 1;
    const approvedToday = new Set(state.requests
      .filter(row =>
        row.status === 'approved'
        && row.start_date <= asOf
        && row.end_date >= asOf
      )
      .map(row => row.member_id));
    const members = activeMembers
      .filter(member => enabledIds.has(member.id))
      .map(member => ({
        name: member.name,
        wellness_available: Number(balances.get(member.id).wellness_available || 0),
        on_leave_today: isBusinessDay && approvedToday.has(member.id),
      }));
    const myRows = state.requests
      .filter(row => row.member_id === caller.id)
      .sort((a, b) => String(b.requested_at).localeCompare(String(a.requested_at)));
    const monthStart = `${asOf.slice(0, 8)}01`;
    const windowStart = dateShiftMonths(monthStart, -3);
    const windowEndDate = new Date(`${dateShiftMonths(monthStart, 4)}T00:00:00.000Z`);
    windowEndDate.setUTCDate(windowEndDate.getUTCDate() - 1);
    const windowEnd = windowEndDate.toISOString().slice(0, 10);
    const absences = state.requests
      .filter(row =>
        row.status === 'approved'
        && activeNames.has(row.member_id)
        && row.start_date <= windowEnd
        && row.end_date >= windowStart
      )
      .map(row => ({
        member_name: activeNames.get(row.member_id),
        start_date: row.start_date,
        end_date: row.end_date,
      }));
    const year = Number(asOf.slice(0, 4));
    const holidays = [];
    for (let holidayYear = year - 1; holidayYear <= year + 1; holidayYear += 1) {
      for (const holiday of policy.ptoFixedHolidays(holidayYear)) {
        holidays.push({
          name: holiday.name,
          date: holiday.observed_date,
          actual_date: holiday.date,
          observed_date: holiday.observed_date,
        });
      }
    }
    const callerBalance = balances.get(caller.id)
      || emptyBalance(caller, ptoMemberFor(caller.id));
    const overview = {
      ok: true,
      as_of_date: asOf,
      balance: callerBalance,
      my_balance: callerBalance,
      members,
      absences,
      requests: myRows.map(row => serializeRequest(row, caller.name)),
      my_requests: myRows.map(row => serializeRequest(row, caller.name)),
      holidays,
      holiday_date_min: `${year - 1}-01-01`,
      holiday_date_max: `${year + 1}-12-31`,
    };
    if (keyRole === 'admin') {
      const sorted = state.requests.slice().sort((a, b) =>
        String(b.requested_at || '').localeCompare(String(a.requested_at || ''))
      );
      overview.pending_requests = sorted
        .filter(row => row.status === 'pending')
        .map(row => serializeRequest(row, activeNames.get(row.member_id) || 'TEST Team member'));
      overview.pending = overview.pending_requests;
      overview.upcoming_approved_requests = sorted
        .filter(row => row.status === 'approved' && row.start_date > asOf)
        .map(row => serializeRequest(row, activeNames.get(row.member_id) || 'TEST Team member'));
      overview.recent_requests = sorted
        .filter(row => row.status !== 'pending')
        .sort((a, b) =>
          String(b.cancelled_at || b.decided_at || b.requested_at || '')
            .localeCompare(String(a.cancelled_at || a.decided_at || a.requested_at || ''))
        )
        .slice(0, 50)
        .map(row => serializeRequest(row, activeNames.get(row.member_id) || 'TEST Team member'));
      overview.admin_members = activeMembers.map(member => {
        const config = ptoMemberFor(member.id);
        const balance = balances.get(member.id) || emptyBalance(member, config);
        return {
          member_id: member.id,
          name: member.name,
          role: member.role,
          team: member.team,
          pto_start_date: config ? config.pto_start_date : null,
          pto_enabled: !!(config && config.pto_enabled),
          wellness_granted: Number(balance.wellness_granted || 0),
          wellness_approved_used: Number(balance.wellness_approved_used || 0),
          wellness_adjustment: Number(balance.wellness_adjustment || 0),
          wellness_used: Number(balance.wellness_used || 0),
          wellness_available: Number(balance.wellness_available || 0),
          sick_used: Number(balance.sick_used || 0),
          sick_approved_used: Number(balance.sick_approved_used || 0),
          sick_adjustment: Number(balance.sick_adjustment || 0),
          sick_available: Number(balance.sick_available || 0),
        };
      });
    }
    return overview;
  }

  function quoteTimeOff(caller, body) {
    const ptoMember = ptoMemberFor(caller.id);
    if (!ptoMember || !ptoMember.pto_enabled) {
      return response(403, { ok: false, error: 'pto_not_enabled' });
    }
    const type = clean(body.type, 40);
    const startDate = parseIsoDate(body.start_date);
    const endDate = parseIsoDate(body.end_date);
    if (!PTO_TYPES.includes(type)) return response(400, { ok: false, error: 'invalid_type' });
    if (!startDate || !endDate || endDate < startDate) {
      return response(400, { ok: false, error: 'invalid_date_range' });
    }
    if (requestSpanDays(startDate, endDate) > 3660) {
      return response(400, { ok: false, error: 'request_range_too_long' });
    }
    const asOf = today();
    if (type !== 'sick' && startDate <= asOf) {
      return response(400, { ok: false, error: 'past_date_not_allowed' });
    }
    const current = policy.computePtoBalance(
      ptoMember,
      state.requests,
      state.adjustments,
      asOf,
    );
    if (paidType(type) && (!current.eligible || startDate < current.eligibility_date)) {
      return response(403, { ok: false, error: 'not_eligible' });
    }
    const requestYear = policy.computePtoBalance(
      ptoMember,
      state.requests,
      state.adjustments,
      startDate,
    );
    if (paidType(type) && endDate > requestYear.leave_year_end) {
      return response(400, { ok: false, error: 'crosses_leave_year' });
    }
    let fullDays;
    try {
      fullDays = policy.countPtoDays(startDate, endDate);
    } catch (_) {
      return response(400, { ok: false, error: 'invalid_date_range' });
    }
    if (fullDays > 999) {
      return response(400, { ok: false, error: 'request_range_too_long' });
    }
    if (fullDays <= 0) {
      return response(200, {
        ok: true,
        full_days: 0,
        partial_day_count: 0,
        leave_year_end: requestYear.leave_year_end || null,
      });
    }
    if (type === 'floating_holiday' && (startDate !== endDate || fullDays !== 1)) {
      return response(400, { ok: false, error: 'floating_holiday_range' });
    }
    return response(200, {
      ok: true,
      full_days: fullDays,
      partial_day_count: Math.max(0.5, fullDays - 0.5),
      leave_year_end: requestYear.leave_year_end || null,
    });
  }

  function requestTimeOff(caller, body) {
    const quote = quoteTimeOff(caller, body);
    if (quote.status !== 200 || quote.body.full_days <= 0) {
      return quote.status === 200
        ? response(400, { ok: false, error: 'days_mismatch', full_days: quote.body.full_days })
        : quote;
    }
    const type = clean(body.type, 40);
    const days = halfDay(body.days);
    const fullDays = quote.body.full_days;
    const partial = Math.max(0.5, fullDays - 0.5);
    if (days == null || (days !== fullDays && days !== partial)) {
      return response(400, { ok: false, error: 'days_mismatch', full_days: fullDays });
    }
    const balance = policy.computePtoBalance(
      ptoMemberFor(caller.id),
      state.requests,
      state.adjustments,
      body.start_date,
    );
    if (type === 'wellness' && Number(balance.wellness_available) < days) {
      return response(409, { ok: false, error: 'insufficient_balance' });
    }
    if (type === 'sick' && Number(balance.sick_available) < days) {
      return response(409, { ok: false, error: 'insufficient_sick_balance' });
    }
    if (
      type === 'floating_holiday'
      && (days > 1 || floatingAlreadyClaimed(caller.id, body.start_date.slice(0, 4)))
    ) {
      return response(409, { ok: false, error: 'floating_holiday_used' });
    }
    const timestamp = mutationTimestamp();
    const row = {
      id: newId('request'),
      member_id: caller.id,
      type,
      start_date: body.start_date,
      end_date: body.end_date,
      days,
      note: clean(body.note, 2000),
      status: 'pending',
      decided_by: null,
      decision_note: '',
      source: 'syncview',
      requested_at: timestamp,
      decided_at: null,
      cancelled_by: null,
      cancelled_at: null,
    };
    state.requests.push(row);
    bumpState(caller.id, timestamp);
    return response(201, {
      ok: true,
      request: serializeRequest(row, caller.name),
      full_days: fullDays,
    });
  }

  function decideRequest(caller, body) {
    const requestId = clean(body.request_id, 80);
    const decision = clean(body.decision, 20);
    if (!UUID.test(requestId)) {
      return response(400, { ok: false, error: 'invalid_request_id' });
    }
    if (decision !== 'approved' && decision !== 'denied') {
      return response(400, { ok: false, error: 'invalid_decision' });
    }
    const row = state.requests.find(request => request.id === requestId);
    if (!row) return response(404, { ok: false, error: 'request_not_found' });
    if (row.status !== 'pending') {
      return response(409, { ok: false, error: 'request_not_pending' });
    }
    const target = memberFor(row.member_id);
    const ptoMember = ptoMemberFor(row.member_id);
    if (!ptoMember || !ptoMember.pto_enabled) {
      return response(409, { ok: false, error: 'pto_not_enabled' });
    }
    if (decision === 'approved') {
      const balance = policy.computePtoBalance(
        ptoMember,
        state.requests,
        state.adjustments,
        row.start_date,
      );
      if (paidType(row.type) && row.end_date > balance.leave_year_end) {
        return response(409, { ok: false, error: 'crosses_leave_year' });
      }
      if (row.type === 'wellness' && Number(balance.wellness_available) < Number(row.days)) {
        return response(409, { ok: false, error: 'insufficient_balance' });
      }
      if (row.type === 'sick' && Number(balance.sick_available) < Number(row.days)) {
        return response(409, { ok: false, error: 'insufficient_sick_balance' });
      }
      if (
        row.type === 'floating_holiday'
        && floatingAlreadyClaimed(row.member_id, row.start_date.slice(0, 4), row.id)
      ) {
        return response(409, { ok: false, error: 'floating_holiday_used' });
      }
      if (!target || target.active === false) {
        return response(409, { ok: false, error: 'member_inactive' });
      }
    }
    const timestamp = mutationTimestamp();
    row.status = decision;
    row.decided_by = caller.name;
    row.decision_note = clean(body.decision_note, 2000);
    row.decided_at = timestamp;
    bumpState(row.member_id, timestamp);
    return response(200, { ok: true, request: serializeRequest(row) });
  }

  function cancelRequest(caller, keyRole, body) {
    const requestId = clean(body.request_id, 80);
    if (!UUID.test(requestId)) {
      return response(400, { ok: false, error: 'invalid_request_id' });
    }
    const row = state.requests.find(request => request.id === requestId);
    if (!row) return response(404, { ok: false, error: 'request_not_found' });
    const requesterCanCancel = row.member_id === caller.id && row.status === 'pending';
    const adminCanCancel = keyRole === 'admin'
      && (row.status === 'pending' || row.status === 'approved')
      && today() < row.start_date;
    if (!requesterCanCancel && !adminCanCancel) {
      return response(403, { ok: false, error: 'cancel_not_allowed' });
    }
    const timestamp = mutationTimestamp();
    row.status = 'cancelled';
    row.cancelled_by = caller.name;
    row.cancelled_at = timestamp;
    bumpState(row.member_id, timestamp);
    return response(200, { ok: true, request: serializeRequest(row) });
  }

  function adjustMember(caller, body) {
    const member = memberFor(body.member_id, false);
    if (!member) return response(404, { ok: false, error: 'member_not_found' });
    if (!ptoMemberFor(member.id)) {
      return response(409, { ok: false, error: 'pto_member_not_found' });
    }
    const kind = clean(body.kind, 20);
    const delta = halfDay(Math.abs(Number(body.delta))) == null ? null : Number(body.delta);
    const effectiveDate = parseIsoDate(body.effective_date);
    const reason = clean(body.reason, 2000);
    if (kind !== 'wellness' && kind !== 'sick') {
      return response(400, { ok: false, error: 'invalid_adjustment_kind' });
    }
    if (delta == null || delta === 0 || Math.abs(delta) > 999.5) {
      return response(400, { ok: false, error: 'invalid_delta' });
    }
    if (!effectiveDate) return response(400, { ok: false, error: 'invalid_effective_date' });
    if (!reason) return response(400, { ok: false, error: 'reason_required' });
    const timestamp = mutationTimestamp();
    const row = {
      id: newId('adjustment'),
      member_id: member.id,
      kind,
      delta,
      effective_date: effectiveDate,
      reason,
      created_by: caller.name,
      created_at: timestamp,
    };
    state.adjustments.push(row);
    bumpState(member.id, timestamp);
    return response(201, { ok: true, adjustment: clone(row) });
  }

  function setStartDate(body) {
    const member = memberFor(body.member_id, false);
    if (!member) return response(404, { ok: false, error: 'member_not_found' });
    const startDate = parseIsoDate(body.pto_start_date);
    if (!startDate) return response(400, { ok: false, error: 'invalid_pto_start_date' });
    if (typeof body.pto_enabled !== 'boolean') {
      return response(400, { ok: false, error: 'invalid_pto_enabled' });
    }
    const existing = ptoMemberFor(member.id);
    const hasHistory = state.requests.some(row => row.member_id === member.id)
      || state.adjustments.some(row => row.member_id === member.id);
    if (existing && existing.pto_start_date !== startDate && hasHistory) {
      return response(409, { ok: false, error: 'start_date_history_conflict' });
    }
    const timestamp = mutationTimestamp();
    if (existing) {
      existing.pto_start_date = startDate;
      existing.pto_enabled = body.pto_enabled;
      bumpState(member.id, timestamp);
    } else {
      state.ptoMembers.push({
        member_id: member.id,
        pto_start_date: startDate,
        pto_enabled: body.pto_enabled,
        state_version: 0,
        updated_at: timestamp,
      });
    }
    const updated = ptoMemberFor(member.id);
    return response(200, {
      ok: true,
      member: {
        member_id: updated.member_id,
        pto_start_date: updated.pto_start_date,
        pto_enabled: updated.pto_enabled,
      },
    });
  }

  function dispatch(action, persona, body = {}, method = 'POST') {
    if (!persona) return response(403, { ok: false, error: 'forbidden' });
    const caller = memberFor(persona.member.id, false);
    if (!caller) return response(403, { ok: false, error: 'forbidden' });
    const keyRole = persona.keyRole;
    if (action === 'overview') return response(200, buildOverview(caller, keyRole));
    if (action === 'quote') return quoteTimeOff(caller, body);
    if (action === 'request') return requestTimeOff(caller, body);
    if (action === 'cancel') return cancelRequest(caller, keyRole, body);
    if (action === 'decide' || action === 'adjust' || action === 'set_start_date') {
      if (keyRole !== 'admin') return response(403, { ok: false, error: 'forbidden' });
      if (action === 'decide') return decideRequest(caller, body);
      if (action === 'adjust') return adjustMember(caller, body);
      return setStartDate(body);
    }
    return response(400, { ok: false, error: 'unknown_action' });
  }

  function authenticatePto(request, url, body, action) {
    const headers = request.headers();
    const key = clean(headers['x-syncview-key'], 5000);
    const keyPersona = Object.values(TEST_PERSONAS).find(persona => persona.key === key);
    if (!keyPersona) return { status: 401, persona: null };
    const keyRole = keyPersona.keyRole;
    let memberId = '';
    if (action === 'overview') memberId = clean(url.searchParams.get('member_id'), 80);
    else if (action === 'decide' || action === 'adjust' || action === 'set_start_date') {
      memberId = clean(body.actor_member_id, 80);
    } else {
      memberId = clean(body.member_id || body.actor_member_id, 80);
    }
    const actor = normalize(headers['x-syncview-actor']);
    const matches = Object.values(TEST_PERSONAS).filter(persona => {
      const current = memberFor(persona.member.id, false);
      return current
        && persona.keyRole === keyRole
        && (!memberId || current.id === memberId)
        && actor
        && normalize(current.name) === actor;
    });
    if (matches.length !== 1) return { status: 403, persona: null };
    return { status: 200, persona: matches[0] };
  }

  function consumeFailure(action, memberId = '') {
    const index = failureQueue.findIndex(item =>
      (item.action === action || item.action === '*')
      && (!item.memberId || item.memberId === memberId)
    );
    if (index < 0) return null;
    return failureQueue.splice(index, 1)[0];
  }

  async function fulfill(route, result) {
    await route.fulfill({
      status: result.status,
      contentType: 'application/json',
      headers: { 'Cache-Control': 'no-store' },
      body: JSON.stringify(result.body),
    });
  }

  const service = {
    personas: TEST_PERSONAS,
    policy,
    calls,
    unexpectedWrites,
    failureQueue,

    get state() {
      return clone(state);
    },

    get requests() {
      return clone(state.requests);
    },

    get instant() {
      return state.instant;
    },

    today,

    identity(reference) {
      const persona = personaFor(reference);
      return persona ? clone(persona) : null;
    },

    balance(reference, asOfDate) {
      return clone(balanceFor(reference, asOfDate || today()));
    },

    overview(reference) {
      return service.invoke('overview', reference, {}, 'GET');
    },

    quote(reference, body) {
      return service.invoke('quote', reference, body);
    },

    request(reference, body) {
      return service.invoke('request', reference, body);
    },

    decide(reference, body) {
      return service.invoke('decide', reference, body);
    },

    cancel(reference, body) {
      return service.invoke('cancel', reference, body);
    },

    invoke(action, reference, body = {}, method = 'POST') {
      const persona = personaFor(reference);
      const result = dispatch(action, persona, clone(body), method);
      record(action, method, persona ? personaKeyForMember(persona.member.id) : '', result.status, 'direct');
      return clone(result);
    },

    setInstant(instant) {
      const next = new Date(instant);
      if (!Number.isFinite(next.getTime())) throw new Error('Invalid synthetic PTO instant');
      state.instant = next.toISOString();
      state.mutationSequence = 0;
      return today();
    },

    setMemberActive(reference, active) {
      const member = memberFor(reference);
      if (!member) throw new Error('Unknown synthetic PTO member');
      member.active = !!active;
      return clone(member);
    },

    queueFailure(action, kind = '500', details = {}) {
      if (kind && typeof kind === 'object') {
        details = kind;
        kind = details.kind || details.type || '500';
      }
      const normalizedKind = clean(kind, 30).toLowerCase();
      if (![
        '500',
        'http',
        'abort',
        'connection_drop',
        'timeout',
        'timedout',
        'delay',
        'delayed',
        'hang',
        'hung',
        'post_commit_loss',
        'response_loss',
      ].includes(normalizedKind)) {
        throw new Error(`Unsupported synthetic failure kind: ${normalizedKind}`);
      }
      const target = details.memberId ? memberFor(details.memberId) : null;
      if (details.memberId && !target) throw new Error('Unknown synthetic PTO failure member');
      const entry = {
        action: clean(action, 40) || '*',
        kind: normalizedKind,
        delayMs: Math.max(0, Math.min(60000, Number(details.delayMs || details.ms || 0))),
        status: Number(details.status || 500),
        error: clean(details.error, 100) || 'simulated_server_error',
        message: clean(details.message, 300),
        memberId: target ? target.id : '',
      };
      failureQueue.push(entry);
      return clone(entry);
    },

    clearFailures() {
      failureQueue.splice(0);
    },

    snapshot() {
      return clone(state);
    },

    restore(snapshot) {
      if (!snapshot || !Array.isArray(snapshot.members) || !Array.isArray(snapshot.ptoMembers)) {
        throw new Error('Invalid synthetic PTO snapshot');
      }
      state = clone(snapshot);
      return service.snapshot();
    },

    reset(resetOptions = {}) {
      state = clone(initial);
      failureQueue.splice(0);
      if (!resetOptions.keepLedger) {
        calls.splice(0);
        unexpectedWrites.splice(0);
        ledgerSequence = 0;
      }
      return service.snapshot();
    },

    fingerprint() {
      const balances = state.members
        .filter(member => member.active !== false)
        .map(member => ({
          persona: personaKeyForMember(member.id),
          balance: balanceFor(member.id, today()),
        }));
      return JSON.stringify({
        instant: state.instant,
        balances,
        requests: state.requests,
        adjustments: state.adjustments,
      });
    },

    getRequest(requestId) {
      const row = state.requests.find(request => request.id === requestId);
      return row ? clone(row) : null;
    },

    findRequests(predicate) {
      const rows = clone(state.requests);
      return typeof predicate === 'function' ? rows.filter(predicate) : rows;
    },

    seedRequest(input) {
      const member = memberFor(input && input.member_id || input && input.member || input && input.persona);
      if (!member) throw new Error('Unknown synthetic PTO request member');
      const timestamp = clean(input.requested_at, 40) || mutationTimestamp();
      const row = {
        id: clean(input.id, 80) || newId('request'),
        member_id: member.id,
        type: clean(input.type, 40),
        start_date: parseIsoDate(input.start_date),
        end_date: parseIsoDate(input.end_date),
        days: Number(input.days),
        note: clean(input.note, 2000),
        status: clean(input.status, 20) || 'pending',
        decided_by: input.decided_by ? clean(input.decided_by, 200) : null,
        decision_note: clean(input.decision_note, 2000),
        source: clean(input.source, 40) || 'synthetic_fixture',
        requested_at: timestamp,
        decided_at: input.decided_at ? clean(input.decided_at, 40) : null,
        cancelled_by: input.cancelled_by ? clean(input.cancelled_by, 200) : null,
        cancelled_at: input.cancelled_at ? clean(input.cancelled_at, 40) : null,
      };
      if (!UUID.test(row.id) || !PTO_TYPES.includes(row.type) || !row.start_date || !row.end_date) {
        throw new Error('Invalid synthetic PTO request seed');
      }
      state.requests.push(row);
      bumpState(member.id, timestamp);
      return clone(row);
    },

    seedAdjustment(input) {
      const member = memberFor(input && input.member_id || input && input.member || input && input.persona);
      const effectiveDate = parseIsoDate(input && input.effective_date);
      if (!member || !effectiveDate) throw new Error('Invalid synthetic PTO adjustment seed');
      const timestamp = clean(input.created_at, 40) || mutationTimestamp();
      const row = {
        id: clean(input.id, 80) || newId('adjustment'),
        member_id: member.id,
        kind: clean(input.kind, 20),
        delta: Number(input.delta),
        effective_date: effectiveDate,
        reason: clean(input.reason, 2000) || 'TEST synthetic adjustment',
        created_by: 'TEST PTO Administrator',
        created_at: timestamp,
      };
      state.adjustments.push(row);
      bumpState(member.id, timestamp);
      return clone(row);
    },

    async handleRoute(route) {
      const request = route.request();
      const requestUrl = request.url();
      if (/^https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?\//i.test(requestUrl)) {
        return route.continue();
      }
      const url = new URL(requestUrl);
      const method = request.method().toUpperCase();
      if (method === 'OPTIONS') {
        return route.fulfill({
          status: 204,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'content-type,x-syncview-key,x-syncview-actor,x-syncview-role',
          },
          body: '',
        });
      }
      let body = {};
      try {
        body = request.postDataJSON() || {};
      } catch (_) {}

      if (url.pathname.endsWith('/rest/v1/syncview_runtime_flags')) {
        if (method !== 'GET') {
          recordUnexpected('runtime_flags', method);
          record('runtime_flag_write', method, '', 405, 'blocked');
          return fulfill(route, response(405, { ok: false, error: 'method_not_allowed' }));
        }
        record('runtime_flag_read', method, '', 200);
        const flagKey = clean(url.searchParams.get('key'), 80).replace(/^eq\./, '');
        return fulfill(route, response(
          200,
          flagKey === 'pto_v1' ? [{ value: { mode: 'on' } }] : [],
        ));
      }

      if (url.pathname.endsWith('/rest/v1/team_members')) {
        if (method !== 'GET') {
          recordUnexpected('team_members', method);
          return fulfill(route, response(405, { ok: false, error: 'method_not_allowed' }));
        }
        record('team_members_read', method, '', 200);
        return fulfill(route, response(
          200,
          state.members.filter(member => member.active !== false).map(clone),
        ));
      }

      if (url.pathname.endsWith('/functions/v1/key-verify')) {
        if (method !== 'POST') {
          return fulfill(route, response(405, { ok: false, error: 'method_not_allowed' }));
        }
        const key = clean(request.headers()['x-syncview-key'], 5000);
        const memberId = clean(body && body.member && body.member.id, 80);
        const persona = Object.values(TEST_PERSONAS).find(candidate =>
          candidate.key === key
          && candidate.member.id === memberId
          && !!memberFor(candidate.member.id, false)
        );
        const result = persona
          ? response(200, {
            ok: true,
            mode: 'strict',
            role: persona.keyRole,
            member: clone(memberFor(persona.member.id, false)),
          })
          : response(401, { ok: false, error: 'unauthorized' });
        record(
          'key_verify',
          method,
          persona ? personaKeyForMember(persona.member.id) : '',
          result.status,
        );
        return fulfill(route, result);
      }

      if (url.pathname.endsWith('/functions/v1/pto')) {
        const action = clean(url.searchParams.get('action') || body.action, 40);
        const failureMemberId = clean(
          url.searchParams.get('member_id') || body.member_id || body.actor_member_id,
          80,
        );
        const failure = consumeFailure(action, failureMemberId);
        if (failure) {
          if (
            failure.kind === 'abort'
            || failure.kind === 'connection_drop'
            || failure.kind === 'timeout'
            || failure.kind === 'timedout'
          ) {
            record(action, method, '', 0, 'connection-drop-before-commit');
            return route.abort('failed').catch(() => {});
          }
          if (failure.kind === 'hang' || failure.kind === 'hung') {
            await new Promise(resolve => setTimeout(resolve, failure.delayMs || 25000));
            record(action, method, '', 0, 'hung-without-commit');
            return route.abort('timedout').catch(() => {});
          }
          if (failure.kind === 'delay' || failure.kind === 'delayed') {
            await new Promise(resolve => setTimeout(resolve, failure.delayMs || 250));
          } else if (failure.kind !== 'post_commit_loss' && failure.kind !== 'response_loss') {
            const status = Number.isInteger(failure.status) ? failure.status : 500;
            record(action, method, '', status, 'simulated-500');
            return fulfill(route, response(status, {
              ok: false,
              error: failure.error,
              ...(failure.message ? { message: failure.message } : {}),
            }));
          }
        }
        const auth = authenticatePto(request, url, body, action);
        if (!auth.persona) {
          const result = response(
            auth.status,
            { ok: false, error: auth.status === 401 ? 'unauthorized' : 'forbidden' },
          );
          record(action, method, '', result.status, failure ? 'delayed' : 'response');
          return fulfill(route, result);
        }
        const result = dispatch(action, auth.persona, body, method);
        if (
          failure
          && (failure.kind === 'post_commit_loss' || failure.kind === 'response_loss')
          && result.status >= 200
          && result.status < 300
        ) {
          record(
            action,
            method,
            personaKeyForMember(auth.persona.member.id),
            result.status,
            'committed-response-lost',
          );
          return route.abort('failed').catch(() => {});
        }
        record(
          action,
          method,
          personaKeyForMember(auth.persona.member.id),
          result.status,
          failure ? 'delayed' : 'response',
        );
        return fulfill(route, result);
      }

      if (!['GET', 'HEAD'].includes(method)) {
        recordUnexpected(
          url.pathname.includes('/functions/v1/') ? 'other_edge_function' : 'external',
          method,
        );
      }
      if (url.pathname.includes('/rest/v1/')) {
        return fulfill(route, response(200, []));
      }
      if (
        url.hostname.includes('docs.google.com')
        || url.hostname.includes('script.google.com')
      ) {
        return route.fulfill({ status: 200, contentType: 'text/plain', body: '' });
      }
      if (['font', 'stylesheet', 'script', 'image'].includes(request.resourceType())) {
        return route.abort();
      }
      return fulfill(route, response(200, {}));
    },
  };

  if (options.instant) service.setInstant(options.instant);
  return service;
}

module.exports = {
  TEST_PERSONAS,
  createMockBackend,
};
