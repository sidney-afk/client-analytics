// Supabase Edge Function: workload-linear
//
// Staff-readable Linear deadline/workload-label metadata plus an Admin/SMM-only
// deadline writer for active Workload sub-issues. Linear is the authority only
// while the owning team's exact current prod_authority value remains `linear`;
// the workload_issues update after a confirmed Linear mutation is best-effort only.

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
import {
  clean,
  dueDateSuccessReceipt,
  exactDueDateAcknowledgement,
  graphqlResponseHasErrors,
  linearAuthorityDecision,
  linearIssueTeamDecision,
  linearMetadataRow,
  metadataSuccessReceipt,
  normalizeMetadataIssueIds,
  splitAliasBatches,
  validIsoDateOrNull,
  workloadTeamBucket,
} from "./policy.mjs";

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-syncview-key, x-syncview-actor, x-syncview-role, x-syncview-source, x-syncview-client-token",
  "Cache-Control": "no-store",
};

const WORKLOAD_LINEAR_READ_ROLES: readonly StaffRoleKey[] = [
  "admin",
  "smm",
  "creative",
];
const WORKLOAD_LINEAR_WRITE_ROLES: readonly StaffRoleKey[] = [
  "admin",
  "smm",
];
const SAFE_ISSUE_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/;
const LINEAR_URL = "https://api.linear.app/graphql";
const MIRROR_UPDATE_TIMEOUT_MS = 2500;

type JsonMap = Record<string, unknown>;
type WorkloadIssue = {
  id: string;
  clientName: string;
};
type WritableWorkloadIssue = WorkloadIssue & {
  team: "video" | "graphics";
};
type MetadataRow = {
  issue_id: string;
  due_date: string | null;
  updated_at: string;
  workload: { label: string; weight: number; color: string } | null;
};

class WorkloadLinearError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string) {
    super(code);
    this.name = "WorkloadLinearError";
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

function parseJson(value: unknown): JsonMap {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonMap
    : {};
}

function serviceClient(): SupabaseClient {
  const url = clean(Deno.env.get("SUPABASE_URL"));
  const key = clean(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
  if (!url || !key) throw new WorkloadLinearError(503, "service_unavailable");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function requestBody(req: Request): Promise<JsonMap> {
  let parsed: unknown;
  try {
    parsed = await req.json();
  } catch (_error) {
    throw new WorkloadLinearError(400, "invalid_json");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new WorkloadLinearError(400, "invalid_body");
  }
  return parsed as JsonMap;
}

function isWriteRole(role: string): role is StaffRoleKey {
  return (WORKLOAD_LINEAR_WRITE_ROLES as readonly string[]).includes(role);
}

function requireMetadataStaff(req: Request): StaffRoleKey {
  const key = clean(req.headers.get("x-syncview-key"));
  const auth = authorizeStaffKey(key, WORKLOAD_LINEAR_READ_ROLES);
  if (!auth.ok || !auth.role) {
    throw new WorkloadLinearError(
      staffAuthFailureStatus(auth),
      auth.role ? "forbidden" : "unauthorized",
    );
  }
  return auth.role;
}

function linearKey(): string {
  const key = clean(Deno.env.get("LINEAR_MIRROR_API_KEY"));
  if (!key) throw new WorkloadLinearError(503, "linear_unavailable");
  return key;
}

async function linearRequest(
  query: string,
  variables: JsonMap,
): Promise<{ data: JsonMap; hasErrors: boolean }> {
  let response: Response;
  try {
    response = await fetch(LINEAR_URL, {
      method: "POST",
      headers: {
        authorization: linearKey(),
        "content-type": "application/json",
      },
      body: JSON.stringify({ query, variables }),
    });
  } catch (_error) {
    throw new WorkloadLinearError(503, "linear_unavailable");
  }
  const body = await response.json().catch(() => null) as JsonMap | null;
  if (!response.ok || !body) {
    throw new WorkloadLinearError(503, "linear_unavailable");
  }
  return {
    data: parseJson(body.data),
    hasErrors: graphqlResponseHasErrors(body),
  };
}

async function requireActiveSubIssues(
  db: SupabaseClient,
  issueIds: string[],
): Promise<Map<string, WorkloadIssue>> {
  const { data, error } = await db
    .from("workload_issues")
    .select("id,client_name,is_sub_issue,active")
    .in("id", issueIds);
  if (error || !Array.isArray(data)) {
    throw new WorkloadLinearError(500, "issue_lookup_failed");
  }

  const rows = new Map<string, WorkloadIssue>();
  for (const raw of data) {
    const row = raw as JsonMap;
    const id = clean(row.id);
    if (!id || row.active !== true || row.is_sub_issue !== true) continue;
    rows.set(id, { id, clientName: clean(row.client_name) });
  }
  if (rows.size !== issueIds.length || issueIds.some((id) => !rows.has(id))) {
    // Keep missing, inactive, and parent targets indistinguishable.
    throw new WorkloadLinearError(409, "issue_not_readable");
  }
  return rows;
}

async function requireWritableSubIssue(
  db: SupabaseClient,
  issueId: string,
  client: string,
): Promise<WritableWorkloadIssue> {
  const { data, error } = await db
    .from("workload_issues")
    .select("id,client_name,team_key,team_name,is_sub_issue,active")
    .eq("id", issueId)
    .maybeSingle();
  if (error) throw new WorkloadLinearError(500, "issue_lookup_failed");
  const row = data as JsonMap | null;
  if (
    !row
    || row.active !== true
    || row.is_sub_issue !== true
    || clean(row.id) !== issueId
    || normalizeBrowserWriteClient(row.client_name) !== client
  ) {
    throw new WorkloadLinearError(409, "issue_not_writable");
  }
  const team = workloadTeamBucket(row.team_key, row.team_name);
  if (team !== "video" && team !== "graphics") {
    throw new WorkloadLinearError(409, "issue_team_unavailable");
  }
  return { id: issueId, clientName: clean(row.client_name), team };
}

async function requireLinearAuthority(
  db: SupabaseClient,
  team: "video" | "graphics",
): Promise<void> {
  const { data, error } = await db
    .from("syncview_runtime_flags")
    .select("value")
    .eq("key", "prod_authority")
    .maybeSingle();
  const decision = linearAuthorityDecision(
    !error && data ? (data as JsonMap).value : null,
    team,
  );
  if (!decision.ok) throw new WorkloadLinearError(decision.status, decision.error);
}

async function requireCurrentLinearTeam(
  issueId: string,
  mirroredTeam: "video" | "graphics",
): Promise<"video" | "graphics"> {
  const query = "query WorkloadLinearIssueTeam($id: String!) { issue(id: $id) { id team { key name } } }";
  const result = await linearRequest(query, { id: issueId });
  if (result.hasErrors) {
    throw new WorkloadLinearError(503, "linear_team_unavailable");
  }
  const decision = linearIssueTeamDecision(
    result.data.issue,
    issueId,
    mirroredTeam,
  );
  if (!decision.ok || (decision.team !== "video" && decision.team !== "graphics")) {
    throw new WorkloadLinearError(decision.status, decision.error);
  }
  return decision.team;
}

function metadataQuery(issueIds: string[]): { query: string; variables: JsonMap } {
  const declarations: string[] = [];
  const selections: string[] = [];
  const variables: JsonMap = {};
  issueIds.forEach((issueId, index) => {
    declarations.push(`$id${index}: String!`);
    selections.push(
      `i${index}: issue(id: $id${index}) { id dueDate updatedAt labels(first: 50) { nodes { name color } pageInfo { hasNextPage } } }`,
    );
    variables[`id${index}`] = issueId;
  });
  return {
    query: `query WorkloadLinearMetadata(${declarations.join(", ")}) { ${selections.join(" ")} }`,
    variables,
  };
}

async function metadataRows(issueIds: string[]): Promise<{
  rows: MetadataRow[];
  missingIssueIds: string[];
  incompleteIssueIds: string[];
}> {
  const byId = new Map<string, MetadataRow>();
  const missing = new Set<string>();
  const incomplete = new Set<string>();

  for (const batch of splitAliasBatches(issueIds)) {
    const request = metadataQuery(batch);
    let result: { data: JsonMap; hasErrors: boolean };
    try {
      result = await linearRequest(request.query, request.variables);
    } catch (_error) {
      batch.forEach((issueId) => {
        missing.add(issueId);
        incomplete.add(issueId);
      });
      continue;
    }

    batch.forEach((issueId, index) => {
      const parsed = linearMetadataRow(result.data[`i${index}`], issueId);
      if (!parsed.row) {
        missing.add(issueId);
        incomplete.add(issueId);
        return;
      }
      if (parsed.incomplete) incomplete.add(issueId);
      byId.set(issueId, parsed.row as MetadataRow);
    });

    // A GraphQL error may describe an alias that returned no usable data. Any
    // successfully parsed aliases above remain available, but completeness is
    // false until every requested alias has a clean response.
    if (result.hasErrors) {
      batch.forEach((issueId) => incomplete.add(issueId));
    }
  }

  return {
    rows: issueIds.flatMap((issueId) => byId.has(issueId) ? [byId.get(issueId)!] : []),
    missingIssueIds: issueIds.filter((issueId) => missing.has(issueId)),
    incompleteIssueIds: issueIds.filter((issueId) => incomplete.has(issueId)),
  };
}

async function setLinearDueDate(
  issueId: string,
  dueDate: string | null,
): Promise<{ issueId: string; dueDate: string | null; updatedAt: string }> {
  const query = "mutation WorkloadLinearSetDueDate($id: String!, $input: IssueUpdateInput!) { issueUpdate(id: $id, input: $input) { success issue { id dueDate updatedAt } } }";
  const result = await linearRequest(query, {
    id: issueId,
    input: { dueDate },
  });
  const acknowledged = exactDueDateAcknowledgement(
    result.data.issueUpdate,
    issueId,
    dueDate,
  );
  if (result.hasErrors || !acknowledged) {
    throw new WorkloadLinearError(502, "linear_commit_unconfirmed");
  }
  return acknowledged;
}

async function updateMirrorAfterCommit(
  db: SupabaseClient,
  issue: WorkloadIssue,
  dueDate: string | null,
  linearUpdatedAt: string,
): Promise<number> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), MIRROR_UPDATE_TIMEOUT_MS);
  try {
    const { data, error } = await db
      .from("workload_issues")
      .update({
        due_date: dueDate,
        linear_updated_at: linearUpdatedAt,
        synced_at: new Date().toISOString(),
      })
      .eq("id", issue.id)
      .eq("client_name", issue.clientName)
      .eq("active", true)
      .eq("is_sub_issue", true)
      .select("id")
      .abortSignal(controller.signal);
    if (error || !Array.isArray(data) || data.length !== 1) return 0;
    return data.length;
  } catch (_error) {
    return 0;
  } finally {
    clearTimeout(timeout);
  }
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
  let requestedCount = 0;
  let returnedCount = 0;
  let linearCommitted = false;
  let mirrorUpdated = 0;

  try {
    const body = await requestBody(req);
    const requestedAction = clean(body.action).toLowerCase();
    if (requestedAction !== "metadata" && requestedAction !== "set_due_date") {
      throw new WorkloadLinearError(400, "invalid_action");
    }
    action = requestedAction;

    if (action === "metadata") {
      requireMetadataStaff(req);
      const parsed = normalizeMetadataIssueIds(body.issue_ids);
      if (!parsed.ok) throw new WorkloadLinearError(400, parsed.error);
      requestedCount = parsed.issueIds.length;
      const db = serviceClient();
      await requireActiveSubIssues(db, parsed.issueIds);
      const metadata = await metadataRows(parsed.issueIds);
      const receipt = metadataSuccessReceipt(
        parsed.issueIds,
        metadata.rows,
        metadata.missingIssueIds,
        metadata.incompleteIssueIds,
      );
      returnedCount = receipt.returned;
      outcome = receipt.complete ? "ok" : "partial";
      return json(receipt);
    }

    const client = normalizeBrowserWriteClient(body.client);
    if (!client) throw new WorkloadLinearError(400, "invalid_client");
    const issueId = clean(body.issue_id);
    if (!SAFE_ISSUE_ID.test(issueId)) {
      throw new WorkloadLinearError(400, "invalid_issue_id");
    }
    if (!Object.prototype.hasOwnProperty.call(body, "due_date")
        || !validIsoDateOrNull(body.due_date)) {
      throw new WorkloadLinearError(400, "invalid_due_date");
    }
    const dueDate = body.due_date === null ? null : clean(body.due_date);

    const db = serviceClient();
    const principal: BrowserWritePrincipal = await authorizeBrowserWrite(
      db,
      req,
      client,
      "workload-linear",
    );
    if (principal.kind !== "staff" || !isWriteRole(principal.role)) {
      throw new WorkloadLinearError(403, "staff_required");
    }

    const target = await requireWritableSubIssue(db, issueId, client);
    // Resolve the issue's current Linear team rather than trusting the mirror's
    // potentially stale team. A move fails closed until the mirror reconciles;
    // only then do we choose and re-read that exact team's current authority.
    const currentTeam = await requireCurrentLinearTeam(issueId, target.team);
    await requireLinearAuthority(db, currentTeam);
    const committed = await setLinearDueDate(issueId, dueDate);
    linearCommitted = true;

    // Never turn a confirmed external commit into a failure. A missed local
    // mirror refresh is explicit and will converge through the normal reader.
    mirrorUpdated = await updateMirrorAfterCommit(
      db,
      target,
      committed.dueDate,
      committed.updatedAt,
    );
    outcome = mirrorUpdated === 1 ? "ok" : "mirror_pending";
    return json(dueDateSuccessReceipt(
      committed.issueId,
      committed.dueDate,
      committed.updatedAt,
      mirrorUpdated,
    ));
  } catch (error) {
    const browserAuth = browserWriteAuthResponse(error);
    if (browserAuth) {
      outcome = "denied";
      return json({ ok: false, error: browserAuth.code }, browserAuth.status);
    }
    if (error instanceof WorkloadLinearError) {
      outcome = error.status === 401 || error.status === 403 ? "denied" : "error";
      return json({ ok: false, error: error.code }, error.status);
    }
    return json({ ok: false, error: "request_failed" }, 500);
  } finally {
    // Aggregate operational facts only: no client, issue, date, label, key, or
    // caller-provided identity values are logged.
    console.log(JSON.stringify({
      fn: "workload-linear",
      action,
      outcome,
      requested: requestedCount,
      returned: returnedCount,
      linear_committed: linearCommitted,
      mirror_updated: mirrorUpdated,
      ms: Date.now() - started,
    }));
  }
});
