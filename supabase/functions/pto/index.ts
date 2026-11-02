// Supabase Edge Function: pto
//
// Staff-only source of truth for SyncView PTO balances, requests, approvals,
// and private hire-date/adjustment records. The browser never reads the three
// PTO tables directly. Authorization is derived only from the configured role
// key; actor and role headers are attribution and identity-selection metadata.
//
// Deploy:
//   supabase functions deploy pto --project-ref uzltbbrjidmjwwfakwve --no-verify-jwt

import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2.49.8";
import {
  authorizeStaffKey,
  staffAuthFailureStatus,
  type StaffRoleKey,
} from "../_shared/staff-role-auth.ts";
import {
  FLOATING_HOLIDAY_ALLOWANCE,
  computePtoBalance,
  countPtoDays,
  ptoFixedHolidays,
  ptoPolicyToday,
} from "./policy.js";

export { computePtoBalance, countPtoDays, ptoFixedHolidays, ptoPolicyToday } from "./policy.js";

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-syncview-key, x-syncview-actor, x-syncview-role",
  "Cache-Control": "no-store",
};

const STAFF_ROLES: readonly StaffRoleKey[] = ["admin", "smm", "creative"];
const PTO_TYPES = ["wellness", "sick", "floating_holiday", "unpaid"];
const MAX_REQUEST_SPAN_DAYS = 3660;
// pto_requests.days is numeric(4,1). Keep the server-derived full-day count
// below the column ceiling so both a full request and its half-day option fit.
const MAX_REQUEST_FULL_DAYS = 999;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

type JsonMap = Record<string, unknown>;
type MemberRow = {
  id: string;
  name: string;
  role: "admin" | "smm" | "editor" | "designer";
  team: "video" | "graphics" | null;
  active: boolean;
};
type PtoMemberRow = {
  member_id: string;
  pto_start_date: string;
  pto_enabled: boolean;
  state_version: number | string;
  updated_at: string;
};
type PtoRequestRow = JsonMap & {
  id: string;
  member_id: string;
  type: string;
  start_date: string;
  end_date: string;
  days: number | string;
  note: string;
  status: string;
  decided_by: string | null;
  decision_note: string;
  source: string;
  requested_at: string;
  decided_at: string | null;
  cancelled_by?: string | null;
  cancelled_at?: string | null;
};
type PtoAdjustmentRow = JsonMap & {
  id: string;
  member_id: string;
  kind: string;
  delta: number | string;
  effective_date: string;
  reason: string;
  created_by: string;
  created_at: string;
};
type PtoData = {
  members: MemberRow[];
  ptoMembers: PtoMemberRow[];
  requests: PtoRequestRow[];
  adjustments: PtoAdjustmentRow[];
};
type MemberPolicySnapshot = {
  ptoMember: PtoMemberRow | null;
  requests: PtoRequestRow[];
  adjustments: PtoAdjustmentRow[];
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

function clean(value: unknown, max = 500): string {
  return String(value == null ? "" : value).trim().slice(0, max);
}

function normalized(value: unknown): string {
  let text = clean(value, 200).toLowerCase();
  try { text = text.normalize("NFD").replace(/[\u0300-\u036f]/g, ""); } catch (_error) {}
  return text.replace(/[^a-z0-9@.]+/g, "");
}

function parseIsoDate(value: unknown): string | null {
  const raw = clean(value, 20);
  if (!ISO_DATE.test(raw)) return null;
  const date = new Date(raw + "T00:00:00Z");
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === raw ? raw : null;
}

function requestSpanDays(startDate: string, endDate: string): number {
  return Math.round((Date.parse(endDate + "T00:00:00Z") - Date.parse(startDate + "T00:00:00Z")) / 86400000) + 1;
}

function roleCompatible(keyRole: StaffRoleKey, member: MemberRow): boolean {
  if (keyRole === "admin") return member.role === "admin";
  if (keyRole === "smm") return member.role === "smm";
  return member.role === "editor" || member.role === "designer";
}

function resolveCaller(
  members: MemberRow[],
  req: Request,
  requestedMemberId: unknown,
  keyRole: StaffRoleKey,
): MemberRow | null {
  const actor = normalized(req.headers.get("x-syncview-actor"));
  const requestedId = clean(requestedMemberId, 80);
  if (!actor || (requestedId && !UUID.test(requestedId))) return null;
  const matches = members.filter((member) =>
    member.active !== false
    && roleCompatible(keyRole, member)
    && normalized(member.name) === actor
    && (!requestedId || member.id === requestedId)
  );
  return matches.length === 1 ? matches[0] : null;
}

function halfDayAmount(value: unknown, allowZero = false): number | null {
  const number = Number(value);
  if (!Number.isFinite(number) || number > 999.5) return null;
  if (allowZero ? number === 0 : number <= 0) return null;
  return Math.round(number * 2) === number * 2 ? number : null;
}

function dateShiftMonths(value: string, count: number): string {
  const source = new Date(value + "T00:00:00Z");
  const yearMonth = source.getUTCFullYear() * 12 + source.getUTCMonth() + count;
  const year = Math.floor(yearMonth / 12);
  const month = ((yearMonth % 12) + 12) % 12;
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(source.getUTCDate(), last))).toISOString().slice(0, 10);
}

function emptyBalance(member: MemberRow, ptoMember: PtoMemberRow | null): JsonMap {
  return {
    member_id: member.id,
    name: member.name,
    pto_enabled: !!ptoMember?.pto_enabled,
    pto_start_date: ptoMember?.pto_start_date || null,
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
    floating_holiday_status: "ineligible",
    next_accrual_date: null,
  };
}

function balanceFor(
  member: MemberRow,
  ptoMember: PtoMemberRow | null,
  requests: PtoRequestRow[],
  adjustments: PtoAdjustmentRow[],
  asOf: string,
): JsonMap {
  if (!ptoMember || !ptoMember.pto_enabled) return emptyBalance(member, ptoMember);
  return {
    member_id: member.id,
    name: member.name,
    pto_enabled: true,
    ...computePtoBalance(ptoMember, requests, adjustments, asOf),
  };
}

function serializeRequest(row: PtoRequestRow, memberName = ""): JsonMap {
  return {
    id: row.id,
    member_id: row.member_id,
    member_name: memberName,
    type: row.type,
    start_date: row.start_date,
    end_date: row.end_date,
    days: Number(row.days || 0),
    note: row.note || "",
    status: row.status,
    decided_by: row.decided_by || null,
    decision_note: row.decision_note || "",
    source: row.source || "syncview",
    requested_at: row.requested_at || "",
    decided_at: row.decided_at || null,
    cancelled_by: row.cancelled_by || null,
    cancelled_at: row.cancelled_at || null,
  };
}

function serializeAdjustment(row: PtoAdjustmentRow): JsonMap {
  return {
    id: row.id,
    member_id: row.member_id,
    kind: row.kind,
    delta: Number(row.delta || 0),
    effective_date: row.effective_date,
    reason: row.reason,
    created_by: row.created_by,
    created_at: row.created_at,
  };
}

function db(): SupabaseClient {
  const url = clean(Deno.env.get("SUPABASE_URL"), 500);
  const serviceKey = clean(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"), 5000);
  if (!url || !serviceKey) throw new Error("server_not_configured");
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function ptoFeatureEnabled(supabase: SupabaseClient): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from("syncview_runtime_flags")
      .select("value")
      .eq("key", "pto_v1")
      .maybeSingle();
    if (error || !data || !data.value || typeof data.value !== "object" || Array.isArray(data.value)) {
      return false;
    }
    return clean((data.value as JsonMap).mode, 20).toLowerCase() === "on";
  } catch (_error) {
    return false;
  }
}

async function loadAllPtoRows(
  supabase: SupabaseClient,
  table: "pto_requests" | "pto_adjustments",
  orderColumn: "requested_at" | "created_at",
  memberId = "",
): Promise<JsonMap[]> {
  const rows: JsonMap[] = [];
  const pageSize = 1000;
  let cursor = "";
  while (true) {
    let query = supabase
      .from(table)
      .select("*")
      .order("id", { ascending: true })
      .limit(pageSize);
    if (memberId) query = query.eq("member_id", memberId);
    if (cursor) query = query.gt("id", cursor);
    const { data, error } = await query;
    if (error) throw new Error("pto_read_failed");
    const batch = (data || []) as JsonMap[];
    rows.push(...batch);
    if (batch.length < pageSize) break;
    const nextCursor = clean(batch[batch.length - 1]?.id, 80);
    if (!nextCursor || nextCursor === cursor) throw new Error("pto_history_cursor_failed");
    cursor = nextCursor;
  }
  rows.sort((a, b) => clean(b[orderColumn], 80).localeCompare(clean(a[orderColumn], 80)) || clean(b.id, 80).localeCompare(clean(a.id, 80)));
  return rows;
}

async function loadPtoMember(
  supabase: SupabaseClient,
  memberId: string,
): Promise<PtoMemberRow | null> {
  const { data, error } = await supabase
    .from("pto_members")
    .select("member_id,pto_start_date,pto_enabled,state_version,updated_at")
    .eq("member_id", memberId)
    .maybeSingle();
  if (error) throw new Error("pto_read_failed");
  return (data || null) as PtoMemberRow | null;
}

// Request and quote validation need one coherent per-member policy view. Every
// request, adjustment, or profile mutation advances state_version, so bracketing
// the paged history reads catches an intervening write. The create RPC repeats
// the version check under a row lock before inserting.
async function loadMemberPolicySnapshot(
  supabase: SupabaseClient,
  memberId: string,
): Promise<MemberPolicySnapshot> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const before = await loadPtoMember(supabase, memberId);
    const [requests, adjustments] = await Promise.all([
      loadAllPtoRows(supabase, "pto_requests", "requested_at", memberId),
      loadAllPtoRows(supabase, "pto_adjustments", "created_at", memberId),
    ]);
    const after = await loadPtoMember(supabase, memberId);
    const stable = before === null && after === null
      || before !== null && after !== null
        && String(before.state_version) === String(after.state_version)
        && before.pto_start_date === after.pto_start_date
        && before.pto_enabled === after.pto_enabled;
    if (stable) {
      return {
        ptoMember: after,
        requests: requests as PtoRequestRow[],
        adjustments: adjustments as PtoAdjustmentRow[],
      };
    }
  }
  throw new Error("pto_request_snapshot_conflict");
}

async function loadAllMembers(supabase: SupabaseClient): Promise<MemberRow[]> {
  const rows: MemberRow[] = [];
  const pageSize = 1000;
  let cursor = "";
  while (true) {
    let query = supabase
      .from("team_members")
      .select("id,name,role,team,active")
      .eq("active", true)
      .order("id")
      .limit(pageSize);
    if (cursor) query = query.gt("id", cursor);
    const { data, error } = await query;
    if (error) throw new Error("pto_read_failed");
    const batch = (data || []) as MemberRow[];
    rows.push(...batch);
    if (batch.length < pageSize) break;
    const nextCursor = clean(batch[batch.length - 1]?.id, 80);
    if (!nextCursor || nextCursor === cursor) throw new Error("pto_member_cursor_failed");
    cursor = nextCursor;
  }
  rows.sort((a, b) => a.name.localeCompare(b.name));
  return rows;
}

async function loadAllPtoMembers(supabase: SupabaseClient): Promise<PtoMemberRow[]> {
  const rows: PtoMemberRow[] = [];
  const pageSize = 1000;
  let cursor = "";
  while (true) {
    let query = supabase
      .from("pto_members")
      .select("member_id,pto_start_date,pto_enabled,state_version,updated_at")
      .order("member_id")
      .limit(pageSize);
    if (cursor) query = query.gt("member_id", cursor);
    const { data, error } = await query;
    if (error) throw new Error("pto_read_failed");
    const batch = (data || []) as PtoMemberRow[];
    rows.push(...batch);
    if (batch.length < pageSize) return rows;
    const nextCursor = clean(batch[batch.length - 1]?.member_id, 80);
    if (!nextCursor || nextCursor === cursor) throw new Error("pto_member_cursor_failed");
    cursor = nextCursor;
  }
}

async function loadPtoData(supabase: SupabaseClient): Promise<PtoData> {
  const [members, ptoMembers, requests, adjustments] = await Promise.all([
    loadAllMembers(supabase),
    loadAllPtoMembers(supabase),
    loadAllPtoRows(supabase, "pto_requests", "requested_at"),
    loadAllPtoRows(supabase, "pto_adjustments", "created_at"),
  ]);
  return {
    members,
    ptoMembers,
    requests: requests as PtoRequestRow[],
    adjustments: adjustments as PtoAdjustmentRow[],
  };
}

function memberNameMap(members: MemberRow[]): Map<string, string> {
  return new Map(members.map((member) => [member.id, member.name]));
}

async function overview(
  data: PtoData,
  caller: MemberRow,
  keyRole: StaffRoleKey,
): Promise<Response> {
  const asOf = ptoPolicyToday();
  const names = memberNameMap(data.members);
  const ptoByMember = new Map(data.ptoMembers.map((row) => [row.member_id, row]));
  const balances = new Map<string, JsonMap>();
  for (const member of data.members) {
    balances.set(
      member.id,
      balanceFor(
        member,
        ptoByMember.get(member.id) || null,
        data.requests,
        data.adjustments,
        asOf,
      ),
    );
  }

  const callerBalance = balances.get(caller.id) || emptyBalance(caller, null);
  const isBusinessDay = countPtoDays(asOf, asOf) === 1;
  const enabledIds = new Set(data.ptoMembers.filter((row) => row.pto_enabled).map((row) => row.member_id));
  const approvedToday = new Set(
    data.requests
      .filter((row) => row.status === "approved" && row.start_date <= asOf && row.end_date >= asOf)
      .map((row) => row.member_id),
  );
  const members = data.members
    .filter((member) => enabledIds.has(member.id))
    .map((member) => {
      const balance = balances.get(member.id) || emptyBalance(member, null);
      return {
        name: member.name,
        wellness_available: Number(balance.wellness_available || 0),
        on_leave_today: isBusinessDay && approvedToday.has(member.id),
      };
    });

  const myRequests = data.requests
    .filter((row) => row.member_id === caller.id)
    .map((row) => serializeRequest(row, caller.name));
  // The browser navigates by whole months, so return the whole first and last
  // visible month rather than clipping both boundaries to today's day number.
  const asOfMonthStart = asOf.slice(0, 8) + "01";
  const windowStart = dateShiftMonths(asOfMonthStart, -3);
  const windowEndExclusive = new Date(dateShiftMonths(asOfMonthStart, 4) + "T00:00:00Z");
  windowEndExclusive.setUTCDate(windowEndExclusive.getUTCDate() - 1);
  const windowEnd = windowEndExclusive.toISOString().slice(0, 10);
  const absences = data.requests
    .filter((row) =>
      row.status === "approved"
      && names.has(row.member_id)
      && row.start_date <= windowEnd
      && row.end_date >= windowStart
    )
    .map((row) => ({
      member_name: names.get(row.member_id) || "Team member",
      start_date: row.start_date,
      end_date: row.end_date,
    }));

  const year = Number(asOf.slice(0, 4));
  const holidays = [];
  for (let holidayYear = year - 1; holidayYear <= year + 1; holidayYear++) {
    for (const holiday of ptoFixedHolidays(holidayYear)) {
      holidays.push({
        name: holiday.name,
        date: holiday.observed_date,
        actual_date: holiday.date,
        observed_date: holiday.observed_date,
      });
    }
  }

  const response: JsonMap = {
    ok: true,
    as_of_date: asOf,
    balance: callerBalance,
    my_balance: callerBalance,
    members,
    absences,
    requests: myRequests,
    my_requests: myRequests,
    holidays,
    holiday_date_min: `${year - 1}-01-01`,
    holiday_date_max: `${year + 1}-12-31`,
  };

  if (keyRole === "admin") {
    response.pending_requests = data.requests
      .filter((row) => row.status === "pending")
      .map((row) => serializeRequest(row, names.get(row.member_id) || "Team member"));
    response.pending = response.pending_requests;
    response.upcoming_approved_requests = data.requests
      .filter((row) => row.status === "approved" && row.start_date > asOf)
      .map((row) => serializeRequest(row, names.get(row.member_id) || "Team member"));
    response.recent_requests = data.requests
      .filter((row) => row.status !== "pending")
      .sort((a, b) => String(b.cancelled_at || b.decided_at || b.requested_at || "")
        .localeCompare(String(a.cancelled_at || a.decided_at || a.requested_at || "")))
      .slice(0, 50)
      .map((row) => serializeRequest(row, names.get(row.member_id) || "Team member"));
    response.admin_members = data.members.map((member) => {
      const ptoMember = ptoByMember.get(member.id) || null;
      const balance = balances.get(member.id) || emptyBalance(member, ptoMember);
      return {
        member_id: member.id,
        name: member.name,
        role: member.role,
        team: member.team,
        pto_start_date: ptoMember?.pto_start_date || null,
        pto_enabled: !!ptoMember?.pto_enabled,
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

  return json(response);
}

function paidType(type: string): boolean {
  return type === "wellness" || type === "sick" || type === "floating_holiday";
}

function floatingAlreadyClaimed(
  requests: PtoRequestRow[],
  memberId: string,
  year: string,
  excludeId = "",
): boolean {
  return requests.some((row) =>
    row.id !== excludeId
    && row.member_id === memberId
    && row.type === "floating_holiday"
    && row.start_date.slice(0, 4) === year
    && (row.status === "pending" || row.status === "approved")
  );
}

type TimeOffPlan = {
  type: string;
  startDate: string;
  endDate: string;
  days: number;
  note: string;
  fullDays: number;
  partialDayCount: number;
  ptoMember: PtoMemberRow;
  requestYearBalance: JsonMap;
};

// The one set of request checks (type, dates, business-day count, half days,
// eligibility, leave year, balance, floating holiday). A member's own request
// and an admin's logged entry both go through it; the only difference an admin
// gets is allowPast, because logging records leave that may already be over.
// quoteOnly lets a quote run without a day count (full range, or one half-day
// endpoint when body.half is true).
function checkTimeOff(
  snapshot: MemberPolicySnapshot,
  memberId: string,
  body: JsonMap,
  options: { allowPast: boolean; quoteOnly?: boolean },
): { error: Response } | { plan: TimeOffPlan } {
  const fail = (body: JsonMap, status: number) => ({ error: json({ ok: false, ...body }, status) });
  const ptoMember = snapshot.ptoMember;
  if (!ptoMember || !ptoMember.pto_enabled) return fail({ error: "pto_not_enabled" }, 403);

  const type = clean(body.type, 40);
  const startDate = parseIsoDate(body.start_date);
  const endDate = parseIsoDate(body.end_date);
  const daysGiven = !(options.quoteOnly && (body.days == null || body.days === ""));
  const requestedDays = daysGiven ? halfDayAmount(body.days) : null;
  const note = clean(body.note, 2000);
  if (!PTO_TYPES.includes(type)) return fail({ error: "invalid_type" }, 400);
  if (!startDate || !endDate || endDate < startDate) return fail({ error: "invalid_date_range" }, 400);
  if (daysGiven && requestedDays == null) return fail({ error: "invalid_days" }, 400);
  if (requestSpanDays(startDate, endDate) > MAX_REQUEST_SPAN_DAYS) {
    return fail({ error: "request_range_too_long" }, 400);
  }
  const today = ptoPolicyToday();
  if (!options.allowPast && type !== "sick" && startDate <= today) {
    return fail({ error: "past_date_not_allowed" }, 400);
  }

  let fullDays: number;
  try {
    fullDays = countPtoDays(startDate, endDate);
  } catch (_error) {
    return fail({ error: "invalid_date_range" }, 400);
  }
  if (fullDays > MAX_REQUEST_FULL_DAYS) return fail({ error: "request_range_too_long" }, 400);
  // A partial request may subtract half-day increments from the server-derived
  // full count. It may never invent a day outside that recomputed range.
  const partialDayCount = Math.max(0.5, fullDays - 0.5);
  // A quote with no day count asks about the full range, or about the range
  // with one half-day endpoint when body.half is true, so a half day that
  // fits the balance is not refused for the full day it is not.
  const days = requestedDays != null ? requestedDays : (body.half === true ? partialDayCount : fullDays);
  if (fullDays <= 0 || (days !== fullDays && days !== partialDayCount)) {
    return fail({ error: "days_mismatch", full_days: fullDays }, 400);
  }
  // A floating holiday represents one calendar square on the team calendar.
  // A half-day is allowed, but it must still be attached to one business date.
  if (type === "floating_holiday" && (startDate !== endDate || fullDays !== 1)) {
    return fail({ error: "floating_holiday_range" }, 400);
  }

  const currentBalance = computePtoBalance(ptoMember, snapshot.requests, snapshot.adjustments, today);
  if (paidType(type) && (!currentBalance.eligible || startDate < currentBalance.eligibility_date)) {
    return fail({ error: "not_eligible" }, 403);
  }

  const requestYearBalance = computePtoBalance(
    ptoMember,
    snapshot.requests,
    snapshot.adjustments,
    startDate,
  );
  if (paidType(type) && endDate > String(requestYearBalance.leave_year_end || "")) {
    return fail({ error: "crosses_leave_year" }, 400);
  }
  if (type === "wellness" && Number(requestYearBalance.wellness_available) < days) {
    return fail({ error: "insufficient_balance" }, 409);
  }
  if (type === "sick" && Number(requestYearBalance.sick_available) < days) {
    return fail({ error: "insufficient_sick_balance" }, 409);
  }
  if (type === "floating_holiday") {
    if (days > FLOATING_HOLIDAY_ALLOWANCE || floatingAlreadyClaimed(snapshot.requests, memberId, startDate.slice(0, 4))) {
      return fail({ error: "floating_holiday_used" }, 409);
    }
  }
  return {
    plan: { type, startDate, endDate, days, note, fullDays, partialDayCount, ptoMember, requestYearBalance },
  };
}

// Inserts a pending row through pto_create_request_v1 (the same transactional
// path as a member's request: row lock, state-version check, floating-holiday
// uniqueness). Answers the created row, or a refusal Response.
async function createRequestRow(
  supabase: SupabaseClient,
  memberId: string,
  plan: TimeOffPlan,
  source: "syncview" | "admin_log",
): Promise<{ row: PtoRequestRow } | { error: Response }> {
  const expectedStateVersion = Number(plan.ptoMember.state_version);
  if (!Number.isSafeInteger(expectedStateVersion) || expectedStateVersion < 0) {
    throw new Error("pto_request_state_invalid");
  }
  const { data: createdRaw, error } = await supabase.rpc("pto_create_request_v1", {
    p_member_id: memberId,
    p_type: plan.type,
    p_start_date: plan.startDate,
    p_end_date: plan.endDate,
    p_days: plan.days,
    p_note: plan.note,
    p_source: source,
    p_expected_state_version: expectedStateVersion,
  });
  // Deployed before migrations/2026-11-01-pto-admin-log-source.sql: the
  // source check refuses 'admin_log' (23514) and nothing is written. Say so
  // instead of failing as a generic service error.
  if (error && source === "admin_log" && (error.code === "23514" || /pto_requests_source_check/.test(clean(error.message, 500)))) {
    return {
      error: json({
        ok: false,
        error: "admin_log_not_ready",
        message: "Logging time off is paused until the admin-log database update is applied.",
      }, 503),
    };
  }
  if (error || !createdRaw || typeof createdRaw !== "object") {
    throw new Error("pto_request_insert_failed");
  }
  const created = createdRaw as JsonMap;
  const createStatus = clean(created.status, 40);
  if (createStatus === "stale") return { error: json({ ok: false, error: "request_state_changed" }, 409) };
  if (createStatus === "member_not_found") return { error: json({ ok: false, error: "member_not_found" }, 409) };
  if (createStatus === "not_enabled") return { error: json({ ok: false, error: "pto_not_enabled" }, 409) };
  if (createStatus === "floating_holiday_used") {
    return { error: json({ ok: false, error: "floating_holiday_used" }, 409) };
  }
  if (createStatus !== "ok" || !created.request || typeof created.request !== "object") {
    throw new Error("pto_request_insert_failed");
  }
  return { row: created.request as PtoRequestRow };
}

async function requestTimeOff(
  supabase: SupabaseClient,
  caller: MemberRow,
  body: JsonMap,
): Promise<Response> {
  const snapshot = await loadMemberPolicySnapshot(supabase, caller.id);
  const checked = checkTimeOff(snapshot, caller.id, body, { allowPast: false });
  if ("error" in checked) return checked.error;
  const created = await createRequestRow(supabase, caller.id, checked.plan, "syncview");
  if ("error" in created) return created.error;
  return json({
    ok: true,
    request: serializeRequest(created.row, caller.name),
    full_days: checked.plan.fullDays,
  }, 201);
}

async function quoteTimeOff(
  supabase: SupabaseClient,
  caller: MemberRow,
  body: JsonMap,
): Promise<Response> {
  const snapshot = await loadMemberPolicySnapshot(supabase, caller.id);
  const ptoMember = snapshot.ptoMember;
  if (!ptoMember || !ptoMember.pto_enabled) {
    return json({ ok: false, error: "pto_not_enabled" }, 403);
  }
  const type = clean(body.type, 40);
  const startDate = parseIsoDate(body.start_date);
  const endDate = parseIsoDate(body.end_date);
  if (!PTO_TYPES.includes(type)) return json({ ok: false, error: "invalid_type" }, 400);
  if (!startDate || !endDate || endDate < startDate) {
    return json({ ok: false, error: "invalid_date_range" }, 400);
  }
  if (requestSpanDays(startDate, endDate) > MAX_REQUEST_SPAN_DAYS) {
    return json({ ok: false, error: "request_range_too_long" }, 400);
  }
  const today = ptoPolicyToday();
  if (type !== "sick" && startDate <= today) {
    return json({ ok: false, error: "past_date_not_allowed" }, 400);
  }
  const currentBalance = computePtoBalance(ptoMember, snapshot.requests, snapshot.adjustments, today);
  if (paidType(type) && (!currentBalance.eligible || startDate < currentBalance.eligibility_date)) {
    return json({ ok: false, error: "not_eligible" }, 403);
  }
  const requestYearBalance = computePtoBalance(ptoMember, snapshot.requests, snapshot.adjustments, startDate);
  if (paidType(type) && endDate > String(requestYearBalance.leave_year_end || "")) {
    return json({ ok: false, error: "crosses_leave_year" }, 400);
  }
  let fullDays: number;
  try {
    fullDays = countPtoDays(startDate, endDate);
  } catch (_error) {
    return json({ ok: false, error: "invalid_date_range" }, 400);
  }
  if (fullDays > MAX_REQUEST_FULL_DAYS) {
    return json({ ok: false, error: "request_range_too_long" }, 400);
  }
  if (fullDays <= 0) {
    return json({
      ok: true,
      full_days: 0,
      partial_day_count: 0,
      leave_year_end: requestYearBalance.leave_year_end || null,
    });
  }
  if (type === "floating_holiday" && (startDate !== endDate || fullDays !== 1)) {
    return json({ ok: false, error: "floating_holiday_range" }, 400);
  }
  return json({
    ok: true,
    full_days: fullDays,
    partial_day_count: Math.max(0.5, fullDays - 0.5),
    leave_year_end: requestYearBalance.leave_year_end || null,
  });
}

async function decideRequest(
  supabase: SupabaseClient,
  caller: MemberRow,
  body: JsonMap,
): Promise<Response> {
  const requestId = clean(body.request_id, 80);
  const decision = clean(body.decision, 20);
  const decisionNote = clean(body.decision_note, 2000);
  if (!UUID.test(requestId)) return json({ ok: false, error: "invalid_request_id" }, 400);
  if (decision !== "approved" && decision !== "denied") {
    return json({ ok: false, error: "invalid_decision" }, 400);
  }
  return await finalizeDecision(supabase, caller, requestId, decision, decisionNote);
}

// The approval path itself: a transactional snapshot, the balance re-check at
// the moment of approval, and pto_finalize_decision_v1 with the caller as the
// decider. Kasper's Approve button and an admin's logged entry both use it.
async function finalizeDecision(
  supabase: SupabaseClient,
  caller: MemberRow,
  requestId: string,
  decision: "approved" | "denied",
  decisionNote: string,
): Promise<Response> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const { data: snapshotRaw, error: snapshotError } = await supabase
      .rpc("pto_decision_snapshot_v1", { p_request_id: requestId });
    if (snapshotError || !snapshotRaw || typeof snapshotRaw !== "object") {
      throw new Error("pto_decision_snapshot_failed");
    }
    const snapshot = snapshotRaw as JsonMap;
    const snapshotStatus = clean(snapshot.status, 40);
    if (snapshotStatus === "not_found") return json({ ok: false, error: "request_not_found" }, 404);
    if (snapshotStatus === "member_not_found") return json({ ok: false, error: "pto_not_enabled" }, 409);
    if (snapshotStatus !== "ok") throw new Error("pto_decision_snapshot_failed");

    const request = snapshot.request as PtoRequestRow;
    const ptoMember = snapshot.member as PtoMemberRow;
    const requests = (Array.isArray(snapshot.requests) ? snapshot.requests : []) as PtoRequestRow[];
    const adjustments = (Array.isArray(snapshot.adjustments) ? snapshot.adjustments : []) as PtoAdjustmentRow[];
    const stateVersion = Number(snapshot.state_version);
    if (!request || request.status !== "pending") {
      return json({ ok: false, error: "request_not_pending" }, 409);
    }
    if (!Number.isSafeInteger(stateVersion) || stateVersion < 0) {
      throw new Error("pto_decision_snapshot_failed");
    }

    if (decision === "approved") {
      if (!ptoMember || !ptoMember.pto_enabled) {
        return json({ ok: false, error: "pto_not_enabled" }, 409);
      }
      const balance = computePtoBalance(ptoMember, requests, adjustments, request.start_date);
      const days = Number(request.days || 0);
      if (paidType(request.type) && request.end_date > String(balance.leave_year_end || "")) {
        return json({ ok: false, error: "crosses_leave_year" }, 409);
      }
      if (request.type === "wellness" && Number(balance.wellness_available) < days) {
        return json({ ok: false, error: "insufficient_balance" }, 409);
      }
      if (request.type === "sick" && Number(balance.sick_available) < days) {
        return json({ ok: false, error: "insufficient_sick_balance" }, 409);
      }
      if (
        request.type === "floating_holiday"
        && floatingAlreadyClaimed(requests, request.member_id, request.start_date.slice(0, 4), request.id)
      ) {
        return json({ ok: false, error: "floating_holiday_used" }, 409);
      }
    }

    const { data: finalizedRaw, error: finalizeError } = await supabase
      .rpc("pto_finalize_decision_v1", {
        p_request_id: requestId,
        p_decision: decision,
        p_decision_note: decisionNote,
        p_actor: caller.name,
        p_expected_state_version: stateVersion,
      });
    if (finalizeError || !finalizedRaw || typeof finalizedRaw !== "object") {
      throw new Error("pto_request_decision_failed");
    }
    const finalized = finalizedRaw as JsonMap;
    const finalStatus = clean(finalized.status, 40);
    if (finalStatus === "stale") continue;
    if (finalStatus === "not_found") return json({ ok: false, error: "request_not_found" }, 404);
    if (finalStatus === "member_inactive") {
      return json({ ok: false, error: "member_inactive" }, 409);
    }
    if (finalStatus === "request_not_pending") {
      return json({ ok: false, error: "request_not_pending" }, 409);
    }
    if (finalStatus !== "ok" || !finalized.request || typeof finalized.request !== "object") {
      throw new Error("pto_request_decision_failed");
    }
    return json({ ok: true, request: serializeRequest(finalized.request as PtoRequestRow) });
  }
  return json({ ok: false, error: "decision_conflict" }, 409);
}

async function cancelRequest(
  supabase: SupabaseClient,
  data: PtoData,
  caller: MemberRow,
  keyRole: StaffRoleKey,
  body: JsonMap,
): Promise<Response> {
  const requestId = clean(body.request_id, 80);
  if (!UUID.test(requestId)) return json({ ok: false, error: "invalid_request_id" }, 400);
  const request = data.requests.find((row) => row.id === requestId);
  if (!request) return json({ ok: false, error: "request_not_found" }, 404);

  const requesterCanCancel = request.member_id === caller.id && request.status === "pending";
  const adminCanCancel = keyRole === "admin"
    && (request.status === "pending" || request.status === "approved")
    && ptoPolicyToday() < request.start_date;
  if (!requesterCanCancel && !adminCanCancel) {
    return json({ ok: false, error: "cancel_not_allowed" }, 403);
  }

  const now = new Date().toISOString();
  let updateResult = await supabase
    .from("pto_requests")
    .update({ status: "cancelled", cancelled_by: caller.name, cancelled_at: now })
    .eq("id", request.id)
    .eq("status", request.status)
    .select("*")
    .maybeSingle();
  // Main deploys can briefly precede the manually applied additive migration.
  // Fall back without destroying an existing approval decision; once the new
  // columns exist, cancellation receives its own actor/timestamp fields.
  const missingAuditColumns = !!updateResult.error && (
    updateResult.error.code === "PGRST204"
    || updateResult.error.code === "42703"
    || /cancelled_(?:by|at)/i.test(clean(updateResult.error.message, 500))
  );
  if (missingAuditColumns) {
    if (request.status === "approved") {
      return json({ ok: false, error: "cancellation_audit_not_ready" }, 503);
    }
    const legacyUpdate = { status: "cancelled", decided_by: caller.name, decided_at: now };
    updateResult = await supabase
      .from("pto_requests")
      .update(legacyUpdate)
      .eq("id", request.id)
      .eq("status", request.status)
      .select("*")
      .maybeSingle();
  }
  const { data: updated, error } = updateResult;
  if (error) throw new Error("pto_request_cancel_failed");
  if (!updated) return json({ ok: false, error: "request_state_changed" }, 409);
  return json({ ok: true, request: serializeRequest(updated as PtoRequestRow) });
}

function balanceKindFor(type: string): "wellness" | "sick" | "floating_holiday" | null {
  if (type === "wellness" || type === "sick" || type === "floating_holiday") return type;
  return null;
}

function availableFor(type: string, balance: JsonMap, requests: PtoRequestRow[], memberId: string, startDate: string): number | null {
  if (type === "wellness") return Number(balance.wellness_available || 0);
  if (type === "sick") return Number(balance.sick_available || 0);
  if (type === "floating_holiday") {
    return floatingAlreadyClaimed(requests, memberId, startDate.slice(0, 4)) ? 0 : FLOATING_HOLIDAY_ALLOWANCE;
  }
  return null;
}

// Live (pending or approved) leave of the same member on any of these dates.
// A member's own request path has no such check; a logged entry must not draw
// a second bar over leave that is already on the calendar or in the queue.
function overlappingRequest(
  requests: PtoRequestRow[],
  memberId: string,
  startDate: string,
  endDate: string,
): PtoRequestRow | null {
  return requests.find((row) =>
    row.member_id === memberId
    && (row.status === "pending" || row.status === "approved")
    && row.start_date <= endDate
    && row.end_date >= startDate
  ) || null;
}

// Admin "Log time off" (Kasper > Time Off). Creates the member's entry through
// the same checks and the same create RPC as their own request, then approves
// it through the same approval path as Kasper's Approve button, with the admin
// as the decider. The row carries source 'admin_log' and decided_by = the
// admin, so every view can say who logged it. Past dates are allowed (a sick
// day is usually logged after it happened); everything else is the member's
// rule set. quoteOnly answers what it would use and writes nothing.
async function logTimeOff(
  supabase: SupabaseClient,
  admin: MemberRow,
  members: MemberRow[],
  body: JsonMap,
  quoteOnly: boolean,
): Promise<Response> {
  const memberId = clean(body.member_id, 80);
  if (!UUID.test(memberId)) return json({ ok: false, error: "invalid_member_id" }, 400);
  const member = members.find((row) => row.id === memberId);
  if (!member) return json({ ok: false, error: "member_not_found" }, 404);

  const snapshot = await loadMemberPolicySnapshot(supabase, memberId);
  const checked = checkTimeOff(snapshot, memberId, body, { allowPast: true, quoteOnly });
  if ("error" in checked) return checked.error;
  const plan = checked.plan;
  const overlap = overlappingRequest(snapshot.requests, memberId, plan.startDate, plan.endDate);
  if (overlap) {
    return json({
      ok: false,
      error: "overlaps_existing",
      overlap: {
        status: overlap.status,
        type: overlap.type,
        start_date: overlap.start_date,
        end_date: overlap.end_date,
      },
    }, 409);
  }

  const availableBefore = availableFor(plan.type, plan.requestYearBalance, snapshot.requests, memberId, plan.startDate);
  const quote = {
    member_id: member.id,
    member_name: member.name,
    type: plan.type,
    start_date: plan.startDate,
    end_date: plan.endDate,
    full_days: plan.fullDays,
    partial_day_count: plan.partialDayCount,
    days: plan.days,
    balance_kind: balanceKindFor(plan.type),
    available_before: availableBefore,
    available_after: availableBefore == null ? null : availableBefore - plan.days,
    leave_year_end: plan.requestYearBalance.leave_year_end || null,
  };
  if (quoteOnly) return json({ ok: true, ...quote });

  const created = await createRequestRow(supabase, memberId, plan, "admin_log");
  if ("error" in created) return created.error;
  // Who logged it is decided_by (the admin) plus source 'admin_log'; the
  // decision note stays empty so the member's own view reads "Logged by".
  const loggedNote = "";
  const withdraw = async () => {
    await supabase
      .from("pto_requests")
      .update({ status: "cancelled", cancelled_by: admin.name, cancelled_at: new Date().toISOString() })
      .eq("id", created.row.id)
      .eq("status", "pending");
  };
  let decided: Response;
  try {
    decided = await finalizeDecision(supabase, admin, created.row.id, "approved", loggedNote);
  } catch (error) {
    try { await withdraw(); } catch (_withdrawError) {}
    throw error;
  }
  let decidedBody: JsonMap = {};
  try { decidedBody = await decided.clone().json() as JsonMap; } catch (_error) {}
  if (decided.ok && decidedBody.ok === true && decidedBody.request) {
    return json({
      ok: true,
      logged: true,
      request: serializeRequest(decidedBody.request as PtoRequestRow, member.name),
      quote,
    }, 201);
  }
  // The approval refused (a write slipped in between, or the balance moved).
  // Never leave a stray pending row in Kasper's queue that nobody asked for:
  // withdraw it, recorded as cancelled by the admin, and pass the refusal on.
  await withdraw();
  return json({ ...decidedBody, ok: false, withdrawn: true }, decided.status >= 400 ? decided.status : 409);
}

function halfDayDelta(value: unknown): number | null {
  const number = Number(value);
  if (!Number.isFinite(number) || number === 0 || Math.abs(number) > 999.5) return null;
  return Math.round(number * 2) === number * 2 ? number : null;
}

async function addAdjustment(
  supabase: SupabaseClient,
  data: PtoData,
  caller: MemberRow,
  body: JsonMap,
): Promise<Response> {
  const memberId = clean(body.member_id, 80);
  const kind = clean(body.kind, 20);
  const delta = halfDayDelta(body.delta);
  const effectiveDate = parseIsoDate(body.effective_date);
  const reason = clean(body.reason, 500);
  if (!UUID.test(memberId) || !data.members.some((member) => member.id === memberId)) {
    return json({ ok: false, error: "member_not_found" }, 404);
  }
  if (!data.ptoMembers.some((row) => row.member_id === memberId)) {
    return json({ ok: false, error: "pto_member_not_found" }, 409);
  }
  if (kind !== "wellness" && kind !== "sick") {
    return json({ ok: false, error: "invalid_adjustment_kind" }, 400);
  }
  if (delta == null) return json({ ok: false, error: "invalid_delta" }, 400);
  if (!effectiveDate) return json({ ok: false, error: "invalid_effective_date" }, 400);
  if (!reason) return json({ ok: false, error: "reason_required" }, 400);

  const { data: inserted, error } = await supabase
    .from("pto_adjustments")
    .insert({
      member_id: memberId,
      kind,
      delta,
      effective_date: effectiveDate,
      reason,
      created_by: caller.name,
    })
    .select("*")
    .single();
  if (error || !inserted) throw new Error("pto_adjustment_insert_failed");
  return json({ ok: true, adjustment: serializeAdjustment(inserted as PtoAdjustmentRow) }, 201);
}

async function setStartDate(
  supabase: SupabaseClient,
  data: PtoData,
  caller: MemberRow,
  body: JsonMap,
): Promise<Response> {
  const memberId = clean(body.member_id, 80);
  const startDate = parseIsoDate(body.pto_start_date);
  if (!UUID.test(memberId)) return json({ ok: false, error: "invalid_member_id" }, 400);
  const member = data.members.find((row) => row.id === memberId);
  if (!member) return json({ ok: false, error: "member_not_found" }, 404);
  if (!startDate || startDate > ptoPolicyToday()) {
    return json({ ok: false, error: "invalid_pto_start_date" }, 400);
  }
  const existing = data.ptoMembers.find((row) => row.member_id === memberId);
  const hasHistory = data.requests.some((row) => row.member_id === memberId)
    || data.adjustments.some((row) => row.member_id === memberId);
  if (hasHistory && (!existing || existing.pto_start_date !== startDate)) {
    return json({ ok: false, error: "start_date_history_conflict" }, 409);
  }
  if (typeof body.pto_enabled !== "boolean") {
    return json({ ok: false, error: "invalid_pto_enabled" }, 400);
  }

  const expectedStateVersion = existing == null ? null : Number(existing.state_version);
  if (existing && (!Number.isSafeInteger(expectedStateVersion) || Number(expectedStateVersion) < 0)) {
    throw new Error("pto_member_state_invalid");
  }
  // The start date drives every accrual and the switch zeroes a balance, so
  // the write and its record (who, before, after) commit together in v2
  // (migrations/2026-10-10-pto-member-setup-audit.sql, OPEN_REPAIRS 399).
  const actor = clean(caller.name, 200);
  if (!actor) throw new Error("pto_member_setup_actor_missing");
  const { data: setRaw, error } = await supabase.rpc("pto_set_member_start_v2", {
    p_member_id: memberId,
    p_start_date: startDate,
    p_enabled: body.pto_enabled,
    p_expected_state_version: expectedStateVersion,
    p_actor: actor,
  });
  // Deployed before its migration: refuse visibly. Never fall back to the
  // record-less v1 write.
  if (error && (error.code === "PGRST202" || error.code === "42883")) {
    return json({
      ok: false,
      error: "member_setup_audit_not_ready",
      message: "Member setup is paused until the member-setup record migration is applied.",
    }, 503);
  }
  if (error || !setRaw || typeof setRaw !== "object") throw new Error("pto_member_upsert_failed");
  const setResult = setRaw as JsonMap;
  const setStatus = clean(setResult.status, 40);
  if (setStatus === "stale") return json({ ok: false, error: "request_state_changed" }, 409);
  if (setStatus === "member_not_found") return json({ ok: false, error: "member_not_found" }, 404);
  if (setStatus === "history_conflict") {
    return json({ ok: false, error: "start_date_history_conflict" }, 409);
  }
  if (setStatus !== "ok" || !setResult.member || typeof setResult.member !== "object") {
    throw new Error("pto_member_upsert_failed");
  }
  const upserted = setResult.member as PtoMemberRow;
  return json({
    ok: true,
    member: { name: member.name, ...upserted },
  });
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "GET" && req.method !== "POST") {
    return json({ ok: false, error: "method_not_allowed" }, 405);
  }

  try {
    const url = new URL(req.url);
    let body: JsonMap = {};
    if (req.method === "POST") {
      try {
        body = await req.json() as JsonMap;
      } catch (_error) {
        return json({ ok: false, error: "invalid_json" }, 400);
      }
    }
    const action = clean(url.searchParams.get("action") || body.action, 40)
      || (req.method === "GET" ? "overview" : "");
    if (req.method === "GET" && action !== "overview") {
      return json({ ok: false, error: "unknown_action" }, 400);
    }
    if (req.method === "POST" && !["quote", "request", "decide", "cancel", "adjust", "set_start_date", "log", "log_quote"].includes(action)) {
      return json({ ok: false, error: "unknown_action" }, 400);
    }

    // log / log_quote put time off on someone else's record: admin key only,
    // refused here before any HR table is read.
    const adminOnly = action === "decide" || action === "adjust" || action === "set_start_date"
      || action === "log" || action === "log_quote";
    const auth = authorizeStaffKey(
      clean(req.headers.get("x-syncview-key"), 5000),
      adminOnly ? ["admin"] : STAFF_ROLES,
    );
    if (!auth.ok || !auth.role) {
      return json(
        { ok: false, error: auth.role ? "forbidden" : "unauthorized" },
        staffAuthFailureStatus(auth),
      );
    }

    const supabase = db();
    // Keep prelaunch seed/setup available to verified admins while the feature
    // is dark. Every user-facing or approval action fails closed before any HR
    // table is loaded when the flag is off, absent, malformed, or unreadable.
    const setupOnly = action === "adjust" || action === "set_start_date";
    if (!setupOnly && !(await ptoFeatureEnabled(supabase))) {
      return json({ ok: false, error: "feature_disabled" }, 503);
    }
    let callerMemberId: unknown = body.actor_member_id;
    if (action === "overview") callerMemberId = url.searchParams.get("member_id");
    if ((action === "quote" || action === "request" || action === "cancel") && !callerMemberId) {
      callerMemberId = body.member_id;
    }

    // Approval gets a transactional snapshot from its database RPC. Quote,
    // request and an admin's log use a state-version-bracketed per-member snapshot. None of these
    // paths depend on the global overview/history loader.
    if (action === "decide" || action === "quote" || action === "request" || action === "log" || action === "log_quote") {
      const members = await loadAllMembers(supabase);
      const caller = resolveCaller(members, req, callerMemberId, auth.role);
      if (!caller) return json({ ok: false, error: "forbidden" }, 403);
      if (action === "decide") return await decideRequest(supabase, caller, body);
      if (action === "log" || action === "log_quote") {
        return await logTimeOff(supabase, caller, members, body, action === "log_quote");
      }
      if (action === "quote") return await quoteTimeOff(supabase, caller, body);
      return await requestTimeOff(supabase, caller, body);
    }

    const data = await loadPtoData(supabase);
    const caller = resolveCaller(data.members, req, callerMemberId, auth.role);
    if (!caller) return json({ ok: false, error: "forbidden" }, 403);

    if (action === "overview") return await overview(data, caller, auth.role);
    if (action === "cancel") return await cancelRequest(supabase, data, caller, auth.role, body);
    if (action === "adjust") return await addAdjustment(supabase, data, caller, body);
    if (action === "set_start_date") return await setStartDate(supabase, data, caller, body);
    return json({ ok: false, error: "unknown_action" }, 400);
  } catch (error) {
    console.error("pto function failed", error);
    return json({ ok: false, error: "pto_service_failed" }, 500);
  }
});
