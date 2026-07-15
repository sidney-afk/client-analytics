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
} from "./policy.js";

export { computePtoBalance, countPtoDays, ptoFixedHolidays } from "./policy.js";

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-syncview-key, x-syncview-actor, x-syncview-role",
  "Cache-Control": "no-store",
};

const STAFF_ROLES: readonly StaffRoleKey[] = ["admin", "smm", "creative"];
const PTO_TYPES = ["wellness", "sick", "floating_holiday", "unpaid"];
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

function utcToday(): string {
  return new Date().toISOString().slice(0, 10);
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
    wellness_used: 0,
    wellness_available: 0,
    sick_granted: 0,
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
  const asOf = utcToday();
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
        member_id: member.id,
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
      && row.start_date <= windowEnd
      && row.end_date >= windowStart
    )
    .map((row) => ({
      id: row.id,
      member_id: row.member_id,
      member_name: names.get(row.member_id) || "Team member",
      type: row.type,
      start_date: row.start_date,
      end_date: row.end_date,
      days: Number(row.days || 0),
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
  };

  if (keyRole === "admin") {
    response.pending_requests = data.requests
      .filter((row) => row.status === "pending")
      .map((row) => serializeRequest(row, names.get(row.member_id) || "Team member"));
    response.pending = response.pending_requests;
    response.admin_members = data.members.map((member) => {
      const ptoMember = ptoByMember.get(member.id) || null;
      const balance = balances.get(member.id) || emptyBalance(member, ptoMember);
      return {
        member_id: member.id,
        name: member.name,
        pto_start_date: ptoMember?.pto_start_date || null,
        pto_enabled: !!ptoMember?.pto_enabled,
        wellness_granted: Number(balance.wellness_granted || 0),
        wellness_used: Number(balance.wellness_used || 0),
        wellness_available: Number(balance.wellness_available || 0),
        sick_used: Number(balance.sick_used || 0),
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

async function requestTimeOff(
  supabase: SupabaseClient,
  data: PtoData,
  caller: MemberRow,
  body: JsonMap,
): Promise<Response> {
  const ptoMember = data.ptoMembers.find((row) => row.member_id === caller.id);
  if (!ptoMember || !ptoMember.pto_enabled) {
    return json({ ok: false, error: "pto_not_enabled" }, 403);
  }

  const type = clean(body.type, 40);
  const startDate = parseIsoDate(body.start_date);
  const endDate = parseIsoDate(body.end_date);
  const days = halfDayAmount(body.days);
  const note = clean(body.note, 2000);
  if (!PTO_TYPES.includes(type)) return json({ ok: false, error: "invalid_type" }, 400);
  if (!startDate || !endDate || endDate < startDate) {
    return json({ ok: false, error: "invalid_date_range" }, 400);
  }
  if (days == null) return json({ ok: false, error: "invalid_days" }, 400);

  let fullDays: number;
  try {
    fullDays = countPtoDays(startDate, endDate);
  } catch (_error) {
    return json({ ok: false, error: "invalid_date_range" }, 400);
  }
  // A partial request may subtract half-day increments from the server-derived
  // full count. It may never invent a day outside that recomputed range.
  const partialDayCount = Math.max(0.5, fullDays - 0.5);
  if (fullDays <= 0 || (days !== fullDays && days !== partialDayCount)) {
    return json({ ok: false, error: "days_mismatch", full_days: fullDays }, 400);
  }
  // A floating holiday represents one calendar square on the team calendar.
  // A half-day is allowed, but it must still be attached to one business date.
  if (type === "floating_holiday" && (startDate !== endDate || fullDays !== 1)) {
    return json({ ok: false, error: "floating_holiday_range" }, 400);
  }

  const today = utcToday();
  if (type !== "sick" && startDate <= today) {
    return json({ ok: false, error: "past_date_not_allowed" }, 400);
  }

  const currentBalance = computePtoBalance(ptoMember, data.requests, data.adjustments, today);
  if (paidType(type) && (!currentBalance.eligible || startDate < currentBalance.eligibility_date)) {
    return json({ ok: false, error: "not_eligible" }, 403);
  }

  const requestYearBalance = computePtoBalance(
    ptoMember,
    data.requests,
    data.adjustments,
    startDate,
  );
  if (paidType(type) && endDate > String(requestYearBalance.leave_year_end || "")) {
    return json({ ok: false, error: "crosses_leave_year" }, 400);
  }
  if (type === "wellness" && Number(requestYearBalance.wellness_available) < days) {
    return json({ ok: false, error: "insufficient_balance" }, 409);
  }
  if (type === "sick" && Number(requestYearBalance.sick_available) < days) {
    return json({ ok: false, error: "insufficient_sick_balance" }, 409);
  }
  if (type === "floating_holiday") {
    if (days > FLOATING_HOLIDAY_ALLOWANCE || floatingAlreadyClaimed(data.requests, caller.id, startDate.slice(0, 4))) {
      return json({ ok: false, error: "floating_holiday_used" }, 409);
    }
  }

  const { data: inserted, error } = await supabase
    .from("pto_requests")
    .insert({
      member_id: caller.id,
      type,
      start_date: startDate,
      end_date: endDate,
      days,
      note,
      status: "pending",
      source: "syncview",
    })
    .select("*")
    .single();
  if (error) {
    if (type === "floating_holiday" && error.code === "23505") {
      return json({ ok: false, error: "floating_holiday_used" }, 409);
    }
    throw new Error("pto_request_insert_failed");
  }
  if (!inserted) throw new Error("pto_request_insert_failed");
  return json({
    ok: true,
    request: serializeRequest(inserted as PtoRequestRow, caller.name),
    full_days: fullDays,
  }, 201);
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
    && request.status !== "cancelled"
    && utcToday() < request.start_date;
  if (!requesterCanCancel && !adminCanCancel) {
    return json({ ok: false, error: "cancel_not_allowed" }, 403);
  }

  const now = new Date().toISOString();
  const { data: updated, error } = await supabase
    .from("pto_requests")
    .update({ status: "cancelled", decided_by: caller.name, decided_at: now })
    .eq("id", request.id)
    .eq("status", request.status)
    .select("*")
    .maybeSingle();
  if (error) throw new Error("pto_request_cancel_failed");
  if (!updated) return json({ ok: false, error: "request_state_changed" }, 409);
  return json({ ok: true, request: serializeRequest(updated as PtoRequestRow) });
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
  body: JsonMap,
): Promise<Response> {
  const memberId = clean(body.member_id, 80);
  const startDate = parseIsoDate(body.pto_start_date);
  if (!UUID.test(memberId)) return json({ ok: false, error: "invalid_member_id" }, 400);
  const member = data.members.find((row) => row.id === memberId);
  if (!member) return json({ ok: false, error: "member_not_found" }, 404);
  if (!startDate || startDate > utcToday()) {
    return json({ ok: false, error: "invalid_pto_start_date" }, 400);
  }
  if (typeof body.pto_enabled !== "boolean") {
    return json({ ok: false, error: "invalid_pto_enabled" }, 400);
  }

  const now = new Date().toISOString();
  const { data: upserted, error } = await supabase
    .from("pto_members")
    .upsert({
      member_id: memberId,
      pto_start_date: startDate,
      pto_enabled: body.pto_enabled,
      updated_at: now,
    }, { onConflict: "member_id" })
    .select("member_id,pto_start_date,pto_enabled,state_version,updated_at")
    .single();
  if (error || !upserted) throw new Error("pto_member_upsert_failed");
  return json({
    ok: true,
    member: { name: member.name, ...(upserted as PtoMemberRow) },
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
    if (req.method === "POST" && !["request", "decide", "cancel", "adjust", "set_start_date"].includes(action)) {
      return json({ ok: false, error: "unknown_action" }, 400);
    }

    const adminOnly = action === "decide" || action === "adjust" || action === "set_start_date";
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
    if ((action === "request" || action === "cancel") && !callerMemberId) {
      callerMemberId = body.member_id;
    }

    // Approval gets a per-member transactional snapshot from the database RPC;
    // it must not depend on the global overview/history loader.
    if (action === "decide") {
      const members = await loadAllMembers(supabase);
      const caller = resolveCaller(members, req, callerMemberId, auth.role);
      if (!caller) return json({ ok: false, error: "forbidden" }, 403);
      return await decideRequest(supabase, caller, body);
    }

    const data = await loadPtoData(supabase);
    const caller = resolveCaller(data.members, req, callerMemberId, auth.role);
    if (!caller) return json({ ok: false, error: "forbidden" }, 403);

    if (action === "overview") return await overview(data, caller, auth.role);
    if (action === "request") return await requestTimeOff(supabase, data, caller, body);
    if (action === "cancel") return await cancelRequest(supabase, data, caller, auth.role, body);
    if (action === "adjust") return await addAdjustment(supabase, data, caller, body);
    if (action === "set_start_date") return await setStartDate(supabase, data, body);
    return json({ ok: false, error: "unknown_action" }, 400);
  } catch (error) {
    console.error("pto function failed", error);
    return json({ ok: false, error: "pto_service_failed" }, 500);
  }
});
