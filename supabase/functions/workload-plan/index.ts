// Supabase Edge Function: workload-plan
//
// Staff-only projection and writer for internal Workload plan days. Client
// deadlines remain display-only Linear mirror data; this function reads
// workload_issues only to validate the exact active sub-issue/client scope and
// writes only the isolated workload_plan sidecar.

import {
  createClient,
  type SupabaseClient,
} from "npm:@supabase/supabase-js@2.49.8";
import {
  authorizeBrowserWrite,
  browserWriteAuthResponse,
  normalizeBrowserWriteClient,
  type BrowserWritePrincipal,
} from "../_shared/browser-write-auth.ts";
import {
  authorizeStaffKey,
  staffAuthFailureStatus,
  type StaffRoleKey,
} from "../_shared/staff-role-auth.ts";

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-syncview-key, x-syncview-actor, x-syncview-role, x-syncview-source, x-syncview-client-token",
  "Cache-Control": "no-store",
};

const HUMAN_STAFF_ROLES: readonly StaffRoleKey[] = [
  "admin",
  "smm",
  "creative",
];
const SAFE_ISSUE_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const LIST_PAGE_SIZE = 1000;
const MAX_LIST_PAGES = 50;

type JsonMap = Record<string, unknown>;
type PlanRow = {
  issue_id: string;
  client: string;
  plan_date: string | null;
  updated_at: string;
};

class WorkloadPlanError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string) {
    super(code);
    this.name = "WorkloadPlanError";
    this.status = status;
    this.code = code;
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

function clean(value: unknown): string {
  return String(value == null ? "" : value).trim();
}

function isHumanStaffRole(role: string): role is StaffRoleKey {
  return (HUMAN_STAFF_ROLES as readonly string[]).includes(role);
}

function serviceClient(): SupabaseClient {
  const url = clean(Deno.env.get("SUPABASE_URL"));
  const key = clean(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
  if (!url || !key) throw new WorkloadPlanError(503, "service_unavailable");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function requestBody(req: Request): Promise<JsonMap> {
  let parsed: unknown;
  try {
    parsed = await req.json();
  } catch (_error) {
    throw new WorkloadPlanError(400, "invalid_json");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new WorkloadPlanError(400, "invalid_body");
  }
  return parsed as JsonMap;
}

function parsePlanDate(value: unknown): string | null {
  if (value === null) return null;
  const date = clean(value);
  if (!ISO_DATE.test(date)) {
    throw new WorkloadPlanError(400, "invalid_plan_date");
  }
  const parsed = new Date(`${date}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new WorkloadPlanError(400, "invalid_plan_date");
  }
  return date;
}

function planRow(row: JsonMap): PlanRow {
  return {
    issue_id: clean(row.issue_id),
    client: clean(row.client),
    plan_date: row.plan_date == null ? null : clean(row.plan_date),
    updated_at: clean(row.updated_at),
  };
}

function requireListStaff(req: Request): StaffRoleKey {
  const key = clean(req.headers.get("x-syncview-key"));
  const auth = authorizeStaffKey(key, HUMAN_STAFF_ROLES);
  if (!auth.ok || !auth.role) {
    throw new WorkloadPlanError(
      staffAuthFailureStatus(auth),
      auth.role ? "forbidden" : "unauthorized",
    );
  }
  return auth.role;
}

async function listPlans(db: SupabaseClient): Promise<PlanRow[]> {
  const plans: PlanRow[] = [];
  let afterIssueId = "";
  for (let page = 0; page < MAX_LIST_PAGES; page++) {
    let query = db
      .from("workload_plan")
      .select("issue_id,client,plan_date,updated_at")
      .not("plan_date", "is", null)
      .order("issue_id", { ascending: true })
      .limit(LIST_PAGE_SIZE);
    if (afterIssueId) query = query.gt("issue_id", afterIssueId);
    const { data, error } = await query;
    if (error) throw new WorkloadPlanError(500, "plan_list_failed");
    if (!Array.isArray(data)) throw new WorkloadPlanError(500, "plan_list_failed");
    plans.push(...data.map((row) => planRow(row as JsonMap)));
    if (data.length < LIST_PAGE_SIZE) return plans;
    const nextAfter = clean((data[data.length - 1] as JsonMap).issue_id);
    if (!nextAfter || nextAfter === afterIssueId) {
      throw new WorkloadPlanError(500, "plan_list_failed");
    }
    afterIssueId = nextAfter;
  }
  // Returning a partial list would make existing overrides appear to vanish.
  throw new WorkloadPlanError(503, "plan_list_limit");
}

async function requireWritableIssue(
  db: SupabaseClient,
  issueId: string,
  client: string,
): Promise<void> {
  const { data, error } = await db
    .from("workload_issues")
    .select("id,client_name,is_sub_issue,active")
    .eq("id", issueId)
    .maybeSingle();
  if (error) throw new WorkloadPlanError(500, "issue_lookup_failed");

  const target = data as JsonMap | null;
  if (
    !target ||
    target.active !== true ||
    target.is_sub_issue !== true ||
    normalizeBrowserWriteClient(target.client_name) !== client
  ) {
    // Keep missing, inactive, parent, and cross-client targets indistinguishable.
    throw new WorkloadPlanError(409, "issue_not_writable");
  }
}

async function setPlan(
  db: SupabaseClient,
  principal: BrowserWritePrincipal,
  issueId: string,
  client: string,
  planDate: string | null,
): Promise<{ updated: number; plan: PlanRow | null }> {
  const now = new Date().toISOString();
  const { data, error } = await db
    .from("workload_plan")
    .upsert({
      issue_id: issueId,
      client,
      plan_date: planDate,
      updated_by: principal.actor,
      updated_at: now,
    }, { onConflict: "issue_id" })
    .select("issue_id,client,plan_date,updated_at");
  if (error) throw new WorkloadPlanError(500, "plan_write_failed");

  // F141 invariant: report rows actually returned by the write, never the
  // requested count or a literal success count.
  const updated = Array.isArray(data) ? data.length : 0;
  return {
    updated,
    plan: updated === 1 ? planRow(data[0] as JsonMap) : null,
  };
}

Deno.serve(async (req: Request): Promise<Response> => {
  const started = Date.now();
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }
  if (req.method !== "POST") {
    return json({ ok: false, error: "method_not_allowed" }, 405);
  }

  let action = "invalid";
  let outcome = "error";
  let writeCount = 0;

  try {
    const body = await requestBody(req);
    const requestedAction = clean(body.action).toLowerCase();
    if (requestedAction !== "list" && requestedAction !== "set") {
      throw new WorkloadPlanError(400, "invalid_action");
    }
    action = requestedAction;

    if (action === "list") {
      requireListStaff(req);
      const plans = await listPlans(serviceClient());
      outcome = "ok";
      return json({ ok: true, plans });
    }

    const client = normalizeBrowserWriteClient(body.client);
    if (!client) throw new WorkloadPlanError(400, "invalid_client");
    const issueId = clean(body.issue_id);
    if (!SAFE_ISSUE_ID.test(issueId)) {
      throw new WorkloadPlanError(400, "invalid_issue_id");
    }
    if (!Object.prototype.hasOwnProperty.call(body, "plan_date")) {
      throw new WorkloadPlanError(400, "invalid_plan_date");
    }
    const planDate = parsePlanDate(body.plan_date);

    const db = serviceClient();
    const principal = await authorizeBrowserWrite(
      db,
      req,
      client,
      "workload-plan",
    );
    if (
      principal.kind !== "staff" ||
      !isHumanStaffRole(principal.role)
    ) {
      throw new WorkloadPlanError(403, "staff_required");
    }

    await requireWritableIssue(db, issueId, client);
    const result = await setPlan(db, principal, issueId, client, planDate);
    writeCount = result.updated;
    if (result.updated !== 1 || !result.plan) {
      outcome = "short_write";
      return json({
        ok: false,
        error: "short_write",
        updated: result.updated,
      }, 409);
    }

    outcome = "ok";
    return json({
      ok: true,
      updated: result.updated,
      plan: result.plan,
    });
  } catch (error) {
    const browserAuth = browserWriteAuthResponse(error);
    if (browserAuth) {
      outcome = "denied";
      return json({
        ok: false,
        error: browserAuth.code,
      }, browserAuth.status);
    }
    if (error instanceof WorkloadPlanError) {
      outcome = error.status === 401 || error.status === 403 ? "denied" : "error";
      return json({ ok: false, error: error.code }, error.status);
    }
    return json({ ok: false, error: "request_failed" }, 500);
  } finally {
    // Aggregate-only operational metadata: never log client, issue, date, or
    // caller-supplied identity values.
    console.log(JSON.stringify({
      fn: "workload-plan",
      action,
      outcome,
      updated: writeCount,
      ms: Date.now() - started,
    }));
  }
});
