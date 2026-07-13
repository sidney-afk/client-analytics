// Supabase Edge Function: production-write
//
// The single browser-callable write gateway for native Production mutations.
// It authenticates either a staff role key plus one exact active roster actor,
// or a client review token scoped to the target client. Caller-supplied role,
// member id, author text, and Linear identifiers never authorize a write.

import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2.49.8";
import {
  matchingRoleForKey,
  timingSafeEqual,
  type StaffRoleKey,
} from "../_shared/staff-role-auth.ts";
import {
  DELIVERABLE_STATUSES,
  clean,
  clientOperationAllowed,
  configuredProjectIds,
  deterministicNativeId,
  intentFingerprint,
  legacyParityAllowed,
  lower,
  normalizeActor,
  normalizeOperation,
  normalizeTeam,
  roleCompatible,
  sourceTimestamp,
  staffOperationAllowed,
  validDateOrNull,
  validRequestId,
} from "./policy.mjs";

type JsonMap = Record<string, unknown>;
type Entity = "deliverable" | "batch";
type StaffMember = JsonMap & {
  id: string;
  name: string;
  role: string;
  team?: string | null;
  active: boolean;
};
type ClientRow = JsonMap & {
  slug: string;
  display_name: string;
  active: boolean;
  kind: string;
  linear_project_ids?: unknown;
};
type Principal = {
  kind: "staff" | "client" | "test";
  keyRole: StaffRoleKey | "client" | "test";
  actorName: string;
  actorKey: string;
  actorRole: string;
  memberId: string | null;
  memberTeam: string;
  clientSlug: string;
  client: ClientRow | null;
  testOnly: boolean;
};

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": [
    "authorization",
    "apikey",
    "content-type",
    "x-syncview-key",
    "x-syncview-actor",
    "x-syncview-role",
    "x-syncview-client-token",
  ].join(", "),
  "Cache-Control": "no-store",
};
const SURFACES = new Set(["production", "calendar", "sxr", "submission"]);
const MAX_COMMENT_BODY = 20_000;
const MAX_INTAKE_ITEMS = 100;

class GatewayError extends Error {
  status: number;
  code: string;
  detail?: JsonMap;

  constructor(status: number, code: string, detail?: JsonMap) {
    super(code);
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

function json(body: JsonMap, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

function parseJson(value: unknown): JsonMap {
  if (!value) return {};
  if (typeof value === "object" && !Array.isArray(value)) return value as JsonMap;
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as JsonMap : {};
  } catch (_error) {
    return {};
  }
}

function bearer(req: Request): string {
  return clean(req.headers.get("authorization")).replace(/^Bearer\s+/i, "");
}

async function serviceRoleRequest(req: Request): Promise<boolean> {
  const supplied = bearer(req);
  const expected = clean(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
  if (!supplied) return false;
  if (expected && timingSafeEqual(supplied, expected)) return true;

  const url = clean(Deno.env.get("SUPABASE_URL"));
  if (!url) return false;
  try {
    const response = await fetch(`${url}/rest/v1/rpc/b4_service_role_probe`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${supplied}`,
        apikey: supplied,
        "content-type": "application/json",
      },
      body: "{}",
    });
    if (!response.ok) return false;
    return await response.json() === true;
  } catch (_error) {
    return false;
  }
}

async function clientBySlug(supabase: SupabaseClient, slug: string): Promise<ClientRow | null> {
  const { data, error } = await supabase.from("clients")
    .select("slug,display_name,active,kind,linear_project_ids")
    .eq("slug", slug)
    .maybeSingle();
  if (error) throw new GatewayError(503, "client_lookup_unavailable");
  return data as ClientRow | null;
}

async function uniqueActiveTestClient(supabase: SupabaseClient): Promise<ClientRow> {
  const { data, error } = await supabase.from("clients")
    .select("slug,display_name,active,kind,linear_project_ids")
    .eq("active", true)
    .eq("kind", "test");
  if (error) throw new GatewayError(503, "client_lookup_unavailable");
  if (!Array.isArray(data) || data.length !== 1) {
    throw new GatewayError(409, "test_client_scope_ambiguous");
  }
  return data[0] as ClientRow;
}

async function authenticate(
  supabase: SupabaseClient,
  req: Request,
  body: JsonMap,
  targetClientSlug: string,
): Promise<Principal> {
  const key = clean(req.headers.get("x-syncview-key"));
  const token = clean(req.headers.get("x-syncview-client-token"));
  if (key && token) throw new GatewayError(401, "ambiguous_credentials");

  if (body.test_override === true && !key && !token) {
    if (key || token || clean(body.confirm) !== "B4_TEST_ONLY" || !(await serviceRoleRequest(req))) {
      throw new GatewayError(401, "invalid_test_override");
    }
    const client = await clientBySlug(supabase, targetClientSlug);
    if (!client || client.active !== true || lower(client.kind) !== "test") {
      throw new GatewayError(403, "test_client_scope_required");
    }
    return {
      kind: "test",
      keyRole: "test",
      actorName: "SyncView TEST write drill",
      actorKey: "test:production-write",
      actorRole: "admin",
      memberId: null,
      memberTeam: "",
      clientSlug: client.slug,
      client,
      testOnly: true,
    };
  }

  if (key) {
    const keyRole = matchingRoleForKey(key);
    if (!keyRole) throw new GatewayError(401, "invalid_staff_key");
    const requestedActor = normalizeActor(req.headers.get("x-syncview-actor"));
    if (!requestedActor) throw new GatewayError(403, "roster_actor_required");

    const { data, error } = await supabase.from("team_members")
      .select("id,name,role,team,active")
      .eq("active", true);
    if (error) throw new GatewayError(503, "roster_lookup_unavailable");
    const matches = ((data || []) as StaffMember[]).filter(member =>
      normalizeActor(member.name) === requestedActor && roleCompatible(keyRole, member.role)
    );
    if (matches.length !== 1) throw new GatewayError(403, "roster_actor_not_unique");
    const member = matches[0];
    const principal: Principal = {
      kind: "staff",
      keyRole,
      actorName: clean(member.name),
      actorKey: `member:${clean(member.id)}`,
      actorRole: lower(member.role),
      memberId: clean(member.id),
      memberTeam: normalizeTeam(member.team),
      clientSlug: targetClientSlug,
      client: null,
      testOnly: false,
    };
    return await deriveBrowserTestScope(supabase, principal, body, targetClientSlug);
  }

  if (token) {
    const { data, error } = await supabase.from("client_access")
      .select("slug,review_token");
    if (error) throw new GatewayError(503, "client_auth_unavailable");
    const matches = ((data || []) as JsonMap[]).filter(row => {
      const stored = clean(row.review_token);
      return !!stored && timingSafeEqual(token, stored);
    });
    if (matches.length === 0) throw new GatewayError(401, "invalid_client_token");
    if (matches.length !== 1) throw new GatewayError(403, "ambiguous_client_token");
    const matchedSlug = clean(matches[0].slug);
    if (!matchedSlug || matchedSlug !== targetClientSlug) {
      throw new GatewayError(403, "client_scope_mismatch");
    }
    const client = await clientBySlug(supabase, matchedSlug);
    if (!client || client.active !== true) throw new GatewayError(403, "client_inactive");
    const principal: Principal = {
      kind: "client",
      keyRole: "client",
      actorName: clean(client.display_name),
      actorKey: `client:${client.slug}`,
      actorRole: "client",
      memberId: null,
      memberTeam: "",
      clientSlug: client.slug,
      client,
      testOnly: false,
    };
    return await deriveBrowserTestScope(supabase, principal, body, targetClientSlug);
  }

  throw new GatewayError(401, "credentials_required");
}

async function deriveBrowserTestScope(
  supabase: SupabaseClient,
  principal: Principal,
  body: JsonMap,
  targetClientSlug: string,
): Promise<Principal> {
  if (body.test_override !== true) return principal;
  const client = principal.client || await clientBySlug(supabase, targetClientSlug);
  if (!client || client.active !== true || lower(client.kind) !== "test") {
    throw new GatewayError(403, "test_client_scope_required");
  }
  return { ...principal, client, testOnly: true };
}

async function authorityFor(supabase: SupabaseClient, team: string): Promise<"linear" | "syncview"> {
  const normalizedTeam = normalizeTeam(team);
  if (!normalizedTeam) throw new GatewayError(409, "team_authority_unknown");
  const { data, error } = await supabase.from("syncview_runtime_flags")
    .select("value")
    .eq("key", "prod_authority")
    .maybeSingle();
  if (error || !data) throw new GatewayError(503, "authority_unavailable");
  const value = parseJson((data as JsonMap).value);
  if (!(normalizedTeam in value)) throw new GatewayError(503, "authority_unavailable");
  const authority = lower(value[normalizedTeam]);
  if (authority === "syncview" || authority === "supabase") return "syncview";
  if (authority === "linear") return "linear";
  throw new GatewayError(503, "authority_unavailable");
}

async function assertLegacyParityEnabled(supabase: SupabaseClient): Promise<void> {
  const { data, error } = await supabase.from("syncview_runtime_flags")
    .select("value")
    .eq("key", "linear_legacy_parity_enabled")
    .maybeSingle();
  if (error || !data) throw new GatewayError(503, "legacy_parity_gate_unavailable");
  const value = parseJson((data as JsonMap).value);
  if (value.enabled !== true) throw new GatewayError(409, "legacy_parity_disabled");
}

function surfaceFor(body: JsonMap): string {
  const surface = lower(body.surface);
  if (!SURFACES.has(surface)) throw new GatewayError(400, "invalid_surface");
  return surface;
}

function assertSurfaceOperation(surface: string, operation: string): void {
  if (operation === "intake_create") {
    if (surface !== "submission") throw new GatewayError(400, "invalid_surface_operation");
    return;
  }
  if (surface === "submission") throw new GatewayError(400, "invalid_surface_operation");
  if ((surface === "calendar" || surface === "sxr") && !["status", "comment"].includes(operation)) {
    throw new GatewayError(400, "invalid_surface_operation");
  }
}

function authorityLane(
  authority: "linear" | "syncview",
  principal: Principal,
  surface: string,
  operation: string,
  requestedParity: boolean,
): boolean {
  if (principal.testOnly) {
    if (requestedParity) throw new GatewayError(409, "legacy_parity_not_allowed");
    return false;
  }
  if (requestedParity) {
    if (!legacyParityAllowed(surface, operation) || authority !== "linear") {
      throw new GatewayError(409, "legacy_parity_not_allowed");
    }
    return true;
  }
  if (authority === "syncview") return false;
  if (surface === "production") throw new GatewayError(409, "team_is_linear_authoritative");
  if (!legacyParityAllowed(surface, operation)) {
    throw new GatewayError(409, "team_is_linear_authoritative");
  }
  throw new GatewayError(409, "legacy_parity_required");
}

function requestIdFor(body: JsonMap): string {
  const id = validRequestId(body.request_id || body.idempotency_key);
  if (!id) throw new GatewayError(400, "valid_request_id_required");
  return id;
}

function dedupKey(operation: string, entity: string, id: string, requestId: string): string {
  return `write-ui:${operation}:${entity}:${id}:${requestId}`;
}

function eventFor(
  operation: string,
  principal: Principal,
  sourceEditedAt: string,
  surface: string,
  outbound: JsonMap,
  existing: JsonMap | null = null,
  nextStatus = "",
): JsonMap {
  return {
    source: "ui",
    action: operation === "intake_create" ? "create" : `${operation}_change`,
    actor: principal.actorName,
    actor_key: principal.actorKey,
    role: principal.actorRole,
    auth_kind: principal.kind,
    surface,
    ts: sourceEditedAt,
    from_status: clean(existing && existing.status) || null,
    to_status: clean(nextStatus || (existing && existing.status)) || null,
    outbound,
  };
}

async function rpc(supabase: SupabaseClient, name: string, args: JsonMap): Promise<unknown> {
  const { data, error } = await supabase.rpc(name, args);
  if (error) {
    if (String(error.code || "") === "23505" || /idempotency_conflict/i.test(clean(error.message))) {
      throw new GatewayError(409, "idempotency_conflict");
    }
    if (/write_conflict/i.test(clean(error.message))) throw new GatewayError(409, "write_conflict");
    if (/authority_unavailable/i.test(clean(error.message))) throw new GatewayError(503, "authority_unavailable");
    if (/legacy_parity_gate_unavailable/i.test(clean(error.message))) {
      throw new GatewayError(503, "legacy_parity_gate_unavailable");
    }
    if (/team_is_linear_authoritative|legacy_parity_not_allowed/i.test(clean(error.message))) {
      throw new GatewayError(409, /legacy_parity/i.test(clean(error.message))
        ? "legacy_parity_not_allowed"
        : "team_is_linear_authoritative");
    }
    if (/test_client_scope_required/i.test(clean(error.message))) {
      throw new GatewayError(403, "test_client_scope_required");
    }
    console.error("production-write RPC failed", name, error.code || "unknown");
    throw new GatewayError(500, "native_write_failed");
  }
  return data;
}

function publicRow(value: unknown): JsonMap {
  const row = parseJson(value);
  return {
    id: clean(row.id),
    identifier: clean(row.identifier) || null,
    batch_id: clean(row.batch_id) || null,
    client_slug: clean(row.client_slug),
    team: normalizeTeam(row.team) || null,
    kind: clean(row.kind) || null,
    title: clean(row.title || row.name),
    status: clean(row.status) || null,
    status_at: clean(row.status_at) || null,
    due_date: clean(row.due_date) || null,
    assignee_id: clean(row.assignee_id) || null,
    updated_at: clean(row.updated_at) || null,
  };
}

function assertCas(body: JsonMap, existing: JsonMap): void {
  if (body.expected_status !== undefined
      && clean(existing.status) !== clean(body.expected_status)) {
    throw new GatewayError(409, "write_conflict", { conflict: true, row: publicRow(existing) });
  }
  if (body.expected_updated_at !== undefined
      && clean(existing.updated_at) !== clean(body.expected_updated_at)) {
    throw new GatewayError(409, "write_conflict", { conflict: true, row: publicRow(existing) });
  }
}

async function targetedDrain(
  dedup: string,
  principal: Principal,
): Promise<JsonMap> {
  const url = clean(Deno.env.get("SUPABASE_URL"));
  const key = clean(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
  if (!url || !key) return { attempted: false, acknowledged: false, error: "drainer_unavailable" };
  const body = principal.testOnly
    ? {
      target_dedup_key: dedup,
      test_override: { client_slug: principal.clientSlug, mode: "live", authority: "syncview" },
      confirm: "B4_TEST_ONLY",
    }
    : {
      target_dedup_key: dedup,
      legacy_parity: true,
      confirm: "WRITE_UI_LEGACY_PARITY",
    };
  try {
    const response = await fetch(`${url}/functions/v1/linear-outbound`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${key}`,
        apikey: key,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const result = await response.json().catch(() => ({})) as JsonMap;
    const target = parseJson(result.target);
    const targetStatus = lower(target.status);
    const conflict = parseJson(parseJson(target.linear_result).conflict);
    const terminal = targetStatus === "written"
      || (targetStatus === "skipped" && ["already_applied", "already_exists"].includes(lower(conflict.decision)));
    return {
      attempted: true,
      acknowledged: response.ok && result.ok === true && terminal,
      status: response.status,
      target_status: targetStatus || null,
    };
  } catch (_error) {
    return { attempted: true, acknowledged: false, error: "drainer_unavailable" };
  }
}

async function findOutboxId(supabase: SupabaseClient, dedup: string): Promise<number> {
  const { data, error } = await supabase.from("mirror_outbox")
    .select("id")
    .eq("dedup_key", dedup)
    .maybeSingle();
  if (error || !data || !Number((data as JsonMap).id)) {
    throw new GatewayError(500, "outbox_checkpoint_missing");
  }
  return Number((data as JsonMap).id);
}

async function assertDedupIntent(
  supabase: SupabaseClient,
  dedup: string,
  expected: JsonMap,
): Promise<boolean> {
  const { data, error } = await supabase.from("mirror_outbox")
    .select("id,entity,entity_id,operation,client_slug,team,actor,role,source_edited_at,payload,legacy_parity,test_only")
    .eq("dedup_key", dedup)
    .maybeSingle();
  if (error) throw new GatewayError(503, "idempotency_lookup_unavailable");
  if (!data) return false;
  const row = data as JsonMap;
  const payload = parseJson(row.payload);
  const matches = clean(row.entity) === clean(expected.entity)
    && clean(row.entity_id) === clean(expected.entity_id)
    && clean(row.operation) === clean(expected.operation)
    && clean(row.client_slug) === clean(expected.client_slug)
    && normalizeTeam(row.team) === normalizeTeam(expected.team)
    && clean(row.actor) === clean(expected.actor)
    && clean(row.role) === clean(expected.role)
    && row.legacy_parity === expected.legacy_parity
    && row.test_only === expected.test_only
    && clean(payload._intent_fingerprint) === clean(expected.intent_fingerprint);
  if (!matches) throw new GatewayError(409, "idempotency_conflict");
  return true;
}

function dedupExpectation(
  principal: Principal,
  team: string,
  sourceEditedAt: string,
  outbound: JsonMap,
  fingerprint: string,
): JsonMap {
  return {
    entity: outbound.entity,
    entity_id: outbound.entity_id,
    operation: outbound.operation,
    client_slug: principal.clientSlug,
    team,
    actor: principal.actorName,
    role: principal.actorRole,
    source_edited_at: sourceEditedAt,
    legacy_parity: outbound.legacy_parity === true,
    test_only: outbound.test_only === true,
    intent_fingerprint: fingerprint,
  };
}

function configuredTestProjectIds(): Set<string> {
  return new Set(clean(Deno.env.get("B4_TEST_PROJECT_IDS"))
    .split(",")
    .map(clean)
    .filter(Boolean));
}

function configuredTestProjectForTeam(team: string): string {
  const raw = clean(Deno.env.get("B4_TEST_PROJECT_BY_TEAM"));
  const configured = parseJson(raw || "{}");
  const normalizedTeam = normalizeTeam(team);
  const jsonValue = clean(configured[normalizedTeam]);
  if (jsonValue) return jsonValue;
  for (const entry of raw.split(",")) {
    const separator = entry.indexOf(":");
    if (separator < 1) continue;
    if (normalizeTeam(entry.slice(0, separator)) === normalizedTeam) {
      return clean(entry.slice(separator + 1));
    }
  }
  return "";
}

function linearReadKey(): string {
  return clean(
    Deno.env.get("LINEAR_READ_API_KEY")
      || Deno.env.get("LINEAR_MIRROR_API_KEY")
      || Deno.env.get("LINEAR_API_KEY"),
  );
}

async function linearRead(query: string, variables: JsonMap): Promise<JsonMap> {
  const apiKey = linearReadKey();
  if (!apiKey) throw new GatewayError(503, "project_mapping_validation_unavailable");
  let response: Response;
  try {
    response = await fetch("https://api.linear.app/graphql", {
      method: "POST",
      headers: { authorization: apiKey, "content-type": "application/json" },
      body: JSON.stringify({ query, variables }),
    });
  } catch (_error) {
    throw new GatewayError(503, "project_mapping_validation_unavailable");
  }
  const result = await response.json().catch(() => null) as JsonMap | null;
  if (!response.ok || !result || Array.isArray(result.errors)) {
    throw new GatewayError(503, "project_mapping_validation_unavailable");
  }
  return parseJson(result.data);
}

function compactLinearProject(value: unknown): JsonMap {
  const project = parseJson(value);
  const nodes = parseJson(project.teams).nodes;
  const teams: string[] = [];
  if (Array.isArray(nodes)) {
    for (const node of nodes) {
      const team = normalizeTeam(parseJson(node).key);
      if (team && !teams.includes(team)) teams.push(team);
    }
  }
  return { id: clean(project.id), name: clean(project.name), teams };
}

async function readLinearProject(projectId: string): Promise<JsonMap> {
  const apiKey = clean(
    Deno.env.get("LINEAR_READ_API_KEY")
      || Deno.env.get("LINEAR_MIRROR_API_KEY")
      || Deno.env.get("LINEAR_API_KEY"),
  );
  if (!apiKey) throw new GatewayError(503, "project_mapping_validation_unavailable");
  const data = await linearRead(
    "query ProductionWriteProjectScope($id: String!) { project(id: $id) { id name teams { nodes { id key } } } }",
    { id: projectId },
  );
  const project = compactLinearProject(data.project);
  if (clean(project.id) !== projectId) throw new GatewayError(409, "project_mapping_missing");
  return project;
}

async function listLinearProjects(): Promise<JsonMap[]> {
  const projects: JsonMap[] = [];
  let after: string | null = null;
  for (let page = 0; page < 20; page++) {
    const data = await linearRead(
      "query ProductionWriteProjectList($after: String) { projects(first: 100, after: $after, includeArchived: false) { nodes { id name teams { nodes { id key } } } pageInfo { hasNextPage endCursor } } }",
      { after },
    );
    const connection = parseJson(data.projects);
    if (Array.isArray(connection.nodes)) {
      for (const project of connection.nodes) projects.push(compactLinearProject(project));
    }
    const pageInfo = parseJson(connection.pageInfo);
    if (pageInfo.hasNextPage !== true) return projects;
    after = clean(pageInfo.endCursor) || null;
    if (!after) throw new GatewayError(503, "project_mapping_validation_unavailable");
  }
  throw new GatewayError(503, "project_mapping_validation_unavailable");
}

function projectMatchesTeam(project: JsonMap, team: string): boolean {
  return Array.isArray(project.teams) && project.teams.includes(normalizeTeam(team));
}

async function projectForIntake(client: ClientRow, team: string, principal: Principal): Promise<string> {
  if (principal.testOnly) {
    const projectId = configuredTestProjectForTeam(team);
    const allowlist = configuredTestProjectIds();
    if (!projectId) {
      throw new GatewayError(503, "test_project_mapping_unavailable");
    }
    if (!allowlist.has(projectId)) throw new GatewayError(403, "test_project_scope_required");
    const project = await readLinearProject(projectId);
    if (!projectMatchesTeam(project, team)) {
      throw new GatewayError(403, "test_project_scope_required");
    }
    return projectId;
  }
  let candidates = configuredProjectIds(client.linear_project_ids);

  let matching: JsonMap[];
  if (candidates.length > 0) {
    matching = [];
    for (const id of candidates) {
      const project = await readLinearProject(id);
      if (projectMatchesTeam(project, team)) matching.push(project);
    }
  } else {
    const clientName = normalizeActor(client.display_name);
    const projects = await listLinearProjects();
    matching = projects.filter(project =>
      normalizeActor(project.name) === clientName && projectMatchesTeam(project, team)
    );
  }

  if (matching.length !== 1) {
    throw new GatewayError(409, matching.length > 1 ? "project_mapping_ambiguous" : "project_mapping_missing");
  }
  const projectId = clean(matching[0].id);
  return projectId;
}

function teamIdFor(team: string): string {
  return clean(Deno.env.get(normalizeTeam(team) === "graphics"
    ? "LINEAR_GRAPHICS_TEAM_ID"
    : "LINEAR_VIDEO_TEAM_ID"));
}

async function validateAssignee(
  supabase: SupabaseClient,
  assigneeId: string,
  team: string,
): Promise<void> {
  if (!assigneeId) return;
  const { data, error } = await supabase.from("team_members")
    .select("id,team,active")
    .eq("id", assigneeId)
    .eq("active", true)
    .maybeSingle();
  if (error) throw new GatewayError(503, "assignee_lookup_unavailable");
  if (!data || normalizeTeam((data as JsonMap).team) !== normalizeTeam(team)) {
    throw new GatewayError(403, "assignee_out_of_scope");
  }
}

async function autoAssigneeForIntake(supabase: SupabaseClient, team: string): Promise<string> {
  const normalizedTeam = normalizeTeam(team);
  const { data, error } = await supabase.from("team_members")
    .select("id,name,role,team,linear_user_id,default_for_team,active")
    .eq("active", true)
    .eq("team", normalizedTeam);
  if (error) throw new GatewayError(503, "assignee_lookup_unavailable");
  const members = ((data || []) as JsonMap[])
    .filter(member => clean(member.linear_user_id))
    .sort((left, right) => clean(left.name).localeCompare(clean(right.name)) || clean(left.id).localeCompare(clean(right.id)));
  if (normalizedTeam === "graphics") {
    const defaults = members.filter(member => member.default_for_team === true);
    if (defaults.length !== 1) throw new GatewayError(409, "graphics_default_assignee_unavailable");
    return clean(defaults[0].id);
  }

  const editors = members.filter(member => lower(member.role) === "editor");
  if (!editors.length) throw new GatewayError(409, "video_assignee_pool_unavailable");
  const { data: deliverables, error: loadError } = await supabase.from("deliverables")
    .select("assignee_id,status")
    .eq("team", "video")
    .neq("status", "duplicate");
  if (loadError) throw new GatewayError(503, "assignee_load_unavailable");
  const load = new Map(editors.map(member => [clean(member.id), 0]));
  for (const row of (deliverables || []) as JsonMap[]) {
    const id = clean(row.assignee_id);
    if (load.has(id)) load.set(id, Number(load.get(id) || 0) + 1);
  }
  editors.sort((left, right) =>
    Number(load.get(clean(left.id)) || 0) - Number(load.get(clean(right.id)) || 0)
    || clean(left.name).localeCompare(clean(right.name))
    || clean(left.id).localeCompare(clean(right.id))
  );
  return clean(editors[0].id);
}

async function graphicDescriptions(
  supabase: SupabaseClient,
  client: ClientRow,
  batchInput: JsonMap,
  items: JsonMap[],
  existingById: Map<string, JsonMap>,
  deliverableIds: string[],
  skipGeneration: boolean,
): Promise<Map<number, string>> {
  const needed = items.map((item, index) => ({ item, index }))
    .filter(({ item }) => normalizeTeam(item.team) === "graphics")
    .filter(({ index }) => !clean(existingById.get(deliverableIds[index])?.brief));
  const fallback = new Map<number, string>();
  for (const { item, index } of needed) {
    const number = Number(item.videoNumber || item.number || index + 1);
    fallback.set(index, `Video ${Number.isInteger(number) && number > 0 ? number : index + 1}`);
  }
  if (!needed.length) return fallback;
  if (skipGeneration) return fallback;

  const apiKey = clean(Deno.env.get("GRAPHIC_TITLE_API_KEY"));
  const model = clean(Deno.env.get("GRAPHIC_TITLE_MODEL"));
  const prompt = clean(Deno.env.get("GRAPHIC_TITLE_PROMPT"));
  if (!apiKey || !model || !prompt) {
    throw new GatewayError(503, "graphic_generation_unavailable");
  }

  let filmingPlan = "";
  const { data: plan } = await supabase.from("filming_plans")
    .select("doc_id")
    .eq("client_slug", client.slug)
    .maybeSingle();
  const docId = clean(plan && plan.doc_id);
  if (docId) {
    try {
      const response = await fetch(`https://docs.google.com/document/d/${encodeURIComponent(docId)}/export?format=txt`);
      if (response.ok) filmingPlan = (await response.text()).slice(0, 20_000);
    } catch (_error) {
      filmingPlan = "";
    }
  }

  let response: Response;
  try {
    response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_tokens: 2_000,
        system: prompt,
        messages: [{
          role: "user",
          content: JSON.stringify({
            client: client.display_name,
            submissionTitle: clean(batchInput.name),
            notes: clean(batchInput.notes),
            filmingPlan,
            videos: needed.map(({ item, index }) => ({
              videoNumber: Number(item.videoNumber || item.number || index + 1),
              dueDate: clean(item.due_date) || null,
            })),
          }),
        }],
      }),
    });
  } catch (_error) {
    throw new GatewayError(502, "graphic_generation_failed");
  }

  const providerBody = await response.json().catch(() => null) as JsonMap | null;
  if (!response.ok || !providerBody || !Array.isArray(providerBody.content)) {
    throw new GatewayError(502, "graphic_generation_failed");
  }
  const text = providerBody.content.map(part => parseJson(part))
    .filter(part => lower(part.type) === "text")
    .map(part => String(part.text || ""))
    .join("\n")
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (_error) {
    const arrayStart = text.indexOf("[");
    const arrayEnd = text.lastIndexOf("]");
    if (arrayStart < 0 || arrayEnd <= arrayStart) {
      throw new GatewayError(502, "graphic_generation_failed");
    }
    try {
      parsed = JSON.parse(text.slice(arrayStart, arrayEnd + 1));
    } catch (_nestedError) {
      throw new GatewayError(502, "graphic_generation_failed");
    }
  }
  if (!Array.isArray(parsed)) throw new GatewayError(502, "graphic_generation_failed");

  const firstByNumber = new Map<number, string>();
  const requestedNumbers = new Set(needed.map(({ item, index }) =>
    Number(item.videoNumber ?? item.number ?? index + 1)
  ));
  for (const raw of parsed) {
    const row = parseJson(raw);
    const number = row.videoNumber;
    const title = typeof row.title === "string" ? clean(row.title) : "";
    if (typeof number !== "number"
        || !Number.isInteger(number)
        || !requestedNumbers.has(number)
        || !title
        || title.length > 500) continue;
    // Match the legacy generator deterministically: the first valid title for
    // a requested video number wins; missing or invalid rows fall back alone.
    if (!firstByNumber.has(number)) firstByNumber.set(number, title);
  }
  for (const { item, index } of needed) {
    const number = Number(item.videoNumber ?? item.number ?? index + 1);
    if (firstByNumber.has(number)) fallback.set(index, firstByNumber.get(number)!);
  }
  return fallback;
}

async function handleEntityOperation(
  supabase: SupabaseClient,
  req: Request,
  body: JsonMap,
  operation: string,
  surface: string,
  requestId: string,
  sourceEditedAt: string,
): Promise<Response> {
  const entity = lower(body.entity || "deliverable") as Entity;
  if (!(["deliverable", "batch"] as string[]).includes(entity)) {
    throw new GatewayError(400, "invalid_entity");
  }
  if (entity === "batch" && operation !== "comment") {
    throw new GatewayError(400, "unsupported_batch_operation");
  }
  let id = clean(body.id);
  let resolvedData: JsonMap | null = null;
  if (!id
      && entity === "deliverable"
      && body.legacy_parity === true
      && (surface === "calendar" || surface === "sxr")
      && (operation === "status" || operation === "comment")) {
    const issue = clean(body.issue || body.linear_issue);
    if (!issue) throw new GatewayError(400, "entity_id_required");
    const candidates = new Map<string, JsonMap>();
    const columns = /^https?:\/\//i.test(issue)
      ? ["linear_issue_url"]
      : ["linear_issue_uuid", "linear_identifier"];
    for (const column of columns) {
      const { data: rows, error: lookupError } = await supabase.from("deliverables")
        .select("*")
        .eq(column, issue)
        .limit(2);
      if (lookupError) throw new GatewayError(503, "entity_lookup_unavailable");
      for (const row of (rows || []) as JsonMap[]) candidates.set(clean(row.id), row);
    }
    if (candidates.size === 0) throw new GatewayError(404, "entity_not_found");
    if (candidates.size !== 1) throw new GatewayError(409, "legacy_link_ambiguous");
    resolvedData = [...candidates.values()][0];
    id = clean(resolvedData.id);
  }
  if (!id) throw new GatewayError(400, "entity_id_required");
  const table = entity === "batch" ? "batches" : "deliverables";
  const lookup = resolvedData
    ? { data: resolvedData, error: null }
    : await supabase.from(table).select("*").eq("id", id).maybeSingle();
  const { data, error } = lookup;
  if (error) throw new GatewayError(503, "entity_lookup_unavailable");
  if (!data) throw new GatewayError(404, "entity_not_found");
  const existing = data as JsonMap;
  const targetClientSlug = clean(existing.client_slug);
  const team = normalizeTeam(existing.team);
  if (!targetClientSlug || !team) throw new GatewayError(409, "entity_scope_unavailable");

  const principal = await authenticate(supabase, req, body, targetClientSlug);
  const nextStatus = lower(body.status || parseJson(body.patch).status);
  if (surface === "production" && operation !== "comment") {
    if (!clean(body.expected_updated_at)
        || (operation === "status" && !clean(body.expected_status))) {
      throw new GatewayError(400, "cas_required");
    }
  }
  if (principal.kind === "staff"
      && !staffOperationAllowed(principal.keyRole, operation, principal.memberTeam, team, nextStatus)) {
    throw new GatewayError(403, "operation_forbidden");
  }
  const authority = principal.testOnly ? "syncview" : await authorityFor(supabase, team);
  const legacyParity = authorityLane(
    authority,
    principal,
    surface,
    operation,
    body.legacy_parity === true,
  );
  if (legacyParity) await assertLegacyParityEnabled(supabase);
  let dedup = dedupKey(operation, entity, id, requestId);
  const outboundBase: JsonMap = {
    entity: operation === "comment" ? "comment" : entity,
    entity_id: id,
    operation,
    dedup_key: dedup,
    source_edited_at: sourceEditedAt,
    test_only: principal.testOnly,
    legacy_parity: legacyParity,
  };

  let result: unknown;
  if (operation === "comment") {
    const commentInput = parseJson(body.comment);
    const commentBody = String(commentInput.body == null ? body.body || "" : commentInput.body).trim();
    if (!commentBody || commentBody.length > MAX_COMMENT_BODY) {
      throw new GatewayError(400, "invalid_comment_body");
    }
    const audience = principal.kind === "client" ? "client" : lower(commentInput.audience || "internal");
    if (!["internal", "client"].includes(audience)) throw new GatewayError(400, "invalid_comment_audience");
    const suppliedNativeId = clean(commentInput.native_comment_id);
    if (suppliedNativeId
        && (!(surface === "calendar" || surface === "sxr")
          || !/^[a-zA-Z0-9][a-zA-Z0-9:_-]{1,199}$/.test(suppliedNativeId))) {
      throw new GatewayError(400, "invalid_native_comment_id");
    }
    if (suppliedNativeId) {
      // Calendar/SXR queue entries carry a stable native id. Make that id,
      // rather than a retry's request id, own the one durable/outbound intent.
      dedup = dedupKey("comment", entity, id, `native:${suppliedNativeId}`);
      outboundBase.dedup_key = dedup;
    }
    const rawParentId = clean(commentInput.parent_id);
    let parentId = rawParentId;
    if (rawParentId) {
      if (!/^[a-zA-Z0-9][a-zA-Z0-9:_-]{1,199}$/.test(rawParentId)) {
        throw new GatewayError(400, "invalid_comment_parent");
      }
      const { data: parents, error: parentError } = await supabase.from("production_comments")
        .select("id,native_comment_id,deliverable_id,batch_id,client_slug,audience")
        .or(`id.eq.${rawParentId},native_comment_id.eq.${rawParentId}`)
        .limit(2);
      if (parentError) throw new GatewayError(503, "comment_parent_lookup_unavailable");
      if (!Array.isArray(parents) || parents.length !== 1) {
        throw new GatewayError(409, "comment_parent_ambiguous");
      }
      const parent = parents[0] as JsonMap;
      if (clean(parent.client_slug) !== targetClientSlug
          || clean(parent.deliverable_id) !== (entity === "deliverable" ? id : "")
          || clean(parent.batch_id) !== (entity === "batch" ? id : "")
          || (principal.kind === "client" && clean(parent.audience) !== "client")) {
        throw new GatewayError(403, "comment_parent_forbidden");
      }
      parentId = clean(parent.id);
    }
    const productionCommentId = suppliedNativeId
      ? await deterministicNativeId("pc", `${entity}:${id}`, suppliedNativeId)
      : await deterministicNativeId("pc", requestId, `${entity}:${id}:production`);
    const nativeCommentId = suppliedNativeId || productionCommentId;
    const round = commentInput.round == null || commentInput.round === ""
      ? null
      : Number(commentInput.round);
    if (round != null && (!Number.isInteger(round) || round < 0)) {
      throw new GatewayError(400, "invalid_comment_round");
    }
    const fingerprint = await intentFingerprint({
      operation, entity, id,
      ...(suppliedNativeId ? {} : { requestId, surface, legacyParity }),
      actorKey: principal.actorKey,
      comment: {
        body: commentBody,
        audience,
        native_comment_id: nativeCommentId,
        parent_id: parentId || null,
        component: clean(commentInput.component) || null,
        is_tweak: commentInput.is_tweak === true,
        round,
      },
    });
    const outbound = {
      ...outboundBase,
      comment_id: productionCommentId,
      payload: { body: commentBody, _intent_fingerprint: fingerprint },
    };
    const event = eventFor(operation, principal, sourceEditedAt, surface, outbound, existing);
    if (body.expected_status !== undefined) event.expected_status = clean(body.expected_status);
    if (body.expected_updated_at !== undefined) event.expected_updated_at = clean(body.expected_updated_at);
    const comment: JsonMap = {
      id: productionCommentId,
      native_comment_id: nativeCommentId,
      idempotency_key: dedup,
      deliverable_id: entity === "deliverable" ? id : null,
      batch_id: entity === "batch" ? id : null,
      team,
      operation: "add",
      author_key: principal.actorKey,
      author_member_id: principal.memberId,
      author_name: principal.actorName,
      role: principal.actorRole,
      transport_actor: "production-write",
      transport_role: "gateway",
      body: commentBody,
      body_format: "markdown",
      audience,
      parent_id: parentId || null,
      component: clean(commentInput.component) || null,
      is_tweak: commentInput.is_tweak === true,
      round,
      origin: "native",
      source: "ui",
      source_created_at: sourceEditedAt,
      source_updated_at: sourceEditedAt,
      provenance: { surface },
    };
    const replay = await assertDedupIntent(
      supabase,
      dedup,
      dedupExpectation(principal, team, sourceEditedAt, outbound, fingerprint),
    );
    if (replay) {
      const { data: committed, error: committedError } = await supabase.from("production_comments")
        .select("*")
        .eq("id", productionCommentId)
        .maybeSingle();
      if (committedError || !committed) throw new GatewayError(500, "idempotent_result_missing");
      result = committed;
    } else {
      if (principal.kind === "client"
          && !clientOperationAllowed(operation, existing.status, nextStatus)) {
        throw new GatewayError(403, "operation_forbidden");
      }
      assertCas(body, existing);
      result = await rpc(supabase, "production_comment_write", { p_comment: comment, p_event: event });
    }
  } else {
    let patch: JsonMap;
    let payload: JsonMap;
    if (operation === "status") {
      if (!DELIVERABLE_STATUSES.includes(nextStatus)) throw new GatewayError(400, "invalid_status");
      patch = { status: nextStatus, status_at: sourceEditedAt };
      payload = { status: nextStatus };
    } else if (operation === "due") {
      const dueDate = body.due_date == null ? parseJson(body.patch).due_date : body.due_date;
      if (!validDateOrNull(dueDate)) throw new GatewayError(400, "invalid_due_date");
      patch = { due_date: clean(dueDate) || null };
      payload = { due_date: clean(dueDate) || null };
    } else {
      const assigneeId = clean(body.assignee_id == null ? parseJson(body.patch).assignee_id : body.assignee_id);
      await validateAssignee(supabase, assigneeId, team);
      patch = { assignee_id: assigneeId || null };
      payload = { assignee_id: assigneeId || null };
    }
    const fingerprint = await intentFingerprint({
      operation, entity, id, requestId, surface, legacyParity,
      actorKey: principal.actorKey,
      patch,
    });
    payload._intent_fingerprint = fingerprint;
    const outbound = { ...outboundBase, payload };
    const row = { ...existing, ...patch };
    const event = eventFor(operation, principal, sourceEditedAt, surface, outbound, existing, clean(row.status));
    if (body.expected_status !== undefined) event.expected_status = clean(body.expected_status);
    if (body.expected_updated_at !== undefined) event.expected_updated_at = clean(body.expected_updated_at);
    const replay = await assertDedupIntent(
      supabase,
      dedup,
      dedupExpectation(principal, team, sourceEditedAt, outbound, fingerprint),
    );
    if (!replay) {
      if (principal.kind === "client"
          && !clientOperationAllowed(operation, existing.status, nextStatus)) {
        throw new GatewayError(403, "operation_forbidden");
      }
      assertCas(body, existing);
    }
    if (replay) {
      result = existing;
    } else {
      try {
        result = await rpc(supabase, "production_deliverable_write", { p_row: row, p_event: event });
      } catch (error) {
        if (error instanceof GatewayError && error.code === "write_conflict") {
          const { data: current } = await supabase.from("deliverables").select("*").eq("id", id).maybeSingle();
          throw new GatewayError(409, "write_conflict", {
            conflict: true,
            row: current ? publicRow(current as JsonMap) : publicRow(existing),
          });
        }
        throw error;
      }
    }
  }

  const shouldDrain = legacyParity || principal.testOnly;
  const mirror = shouldDrain
    ? await targetedDrain(dedup, principal)
    : { attempted: false, acknowledged: false };
  const mirrorPending = shouldDrain ? mirror.acknowledged !== true : true;
  return json({
    ok: true,
    native_committed: true,
    authority,
    legacy_parity: legacyParity,
    mirror_pending: mirrorPending,
    mirror,
    // Keep `row` entity-shaped for every operation so a composer success
    // cannot replace the caller's deliverable/CAS cursor with a comment id.
    row: operation === "comment" ? publicRow(existing) : publicRow(result),
    ...(operation === "comment" ? { comment: parseJson(result) } : {}),
  }, mirrorPending && shouldDrain ? 202 : 200);
}

async function ensureBatch(
  supabase: SupabaseClient,
  row: JsonMap,
  event: JsonMap,
  dedup: string,
  replay: boolean,
): Promise<{ row: JsonMap; outboxId: number }> {
  const { data, error } = await supabase.from("batches").select("*").eq("id", clean(row.id)).maybeSingle();
  if (error) throw new GatewayError(503, "batch_lookup_unavailable");
  if (data && (
    clean(data.client_slug) !== clean(row.client_slug)
    || normalizeTeam(data.team) !== normalizeTeam(row.team)
    || clean(data.name) !== clean(row.name)
    || clean(data.description) !== clean(row.description)
    || clean(data.filming_doc_url) !== clean(row.filming_doc_url)
    || clean(data.footage_folder_url) !== clean(row.footage_folder_url)
    || clean(data.delivery_folder_url) !== clean(row.delivery_folder_url)
    || clean(data.color) !== clean(row.color)
  )) throw new GatewayError(409, "intake_id_conflict");
  if (replay && !data) throw new GatewayError(500, "idempotent_result_missing");
  const written = replay ? data : await rpc(supabase, "production_batch_write", { p_row: data || row, p_event: event });
  return { row: parseJson(written), outboxId: await findOutboxId(supabase, dedup) };
}

async function ensureDeliverable(
  supabase: SupabaseClient,
  row: JsonMap,
  event: JsonMap,
  dedup: string,
  replay: boolean,
): Promise<JsonMap> {
  const { data, error } = await supabase.from("deliverables").select("*").eq("id", clean(row.id)).maybeSingle();
  if (error) throw new GatewayError(503, "deliverable_lookup_unavailable");
  if (data && (
    clean(data.client_slug) !== clean(row.client_slug)
    || normalizeTeam(data.team) !== normalizeTeam(row.team)
    || clean(data.batch_id) !== clean(row.batch_id)
    || clean(data.title) !== clean(row.title)
  )) throw new GatewayError(409, "intake_id_conflict");
  if (replay && !data) throw new GatewayError(500, "idempotent_result_missing");
  return parseJson(replay ? data : await rpc(supabase, "production_deliverable_write", { p_row: data || row, p_event: event }));
}

async function handleIntakeCreate(
  supabase: SupabaseClient,
  req: Request,
  body: JsonMap,
  surface: string,
  requestId: string,
  sourceEditedAt: string,
): Promise<Response> {
  let clientSlug = clean(body.client_slug);
  if (!clientSlug
      && body.test_override === true
      && !clean(req.headers.get("x-syncview-key"))
      && !clean(req.headers.get("x-syncview-client-token"))
      && await serviceRoleRequest(req)) {
    clientSlug = (await uniqueActiveTestClient(supabase)).slug;
  }
  const batchInput = parseJson(body.batch);
  const items = Array.isArray(body.items) ? body.items.map(parseJson) : [];
  if (!clientSlug || !clean(batchInput.name) || items.length < 1 || items.length > MAX_INTAKE_ITEMS) {
    throw new GatewayError(400, "invalid_intake_payload");
  }
  const teams = new Set(items.map(item => normalizeTeam(item.team)).filter(Boolean));
  if (teams.size < 1 || teams.size > 2 || items.some(item => !normalizeTeam(item.team))) {
    throw new GatewayError(400, "invalid_intake_teams");
  }
  // Validate every caller-owned item field before any external generator call.
  // The provider response is matched by these already-validated video numbers.
  for (let index = 0; index < items.length; index++) {
    const item = items[index];
    const videoNumber = Number(item.videoNumber ?? item.number ?? index + 1);
    const priority = item.priority == null || item.priority === "" ? null : Number(item.priority);
    const sortKey = item.sort_key == null ? index : Number(item.sort_key);
    const status = lower(item.status || "in_progress");
    const videoTitle = normalizeTeam(item.team) === "video" ? clean(item.title) : "";
    if (!Number.isInteger(videoNumber) || videoNumber < 1) {
      throw new GatewayError(400, "invalid_intake_video_number", { item_index: index });
    }
    if (clean(item.assignee_id)) {
      throw new GatewayError(400, "intake_assignee_override_not_allowed", { item_index: index });
    }
    if ((videoTitle && videoTitle.length > 500)
        || !validDateOrNull(item.due_date)
        || (priority != null && (!Number.isInteger(priority) || priority < 0 || priority > 4))
        || !Number.isFinite(sortKey) || sortKey < 0
        || !DELIVERABLE_STATUSES.includes(status)) {
      throw new GatewayError(400, "invalid_intake_item", { item_index: index });
    }
  }
  const teamList = ["video", "graphics"].filter(team => teams.has(team));
  const principal = await authenticate(supabase, req, body, clientSlug);
  if (principal.kind === "client" || (principal.kind === "staff" && !["admin", "smm"].includes(principal.keyRole))) {
    throw new GatewayError(403, "operation_forbidden");
  }
  const client = principal.client || await clientBySlug(supabase, clientSlug);
  if (!client || client.active !== true) throw new GatewayError(403, "client_inactive");
  // This read-only validation happens before the first native row write.
  const projectByTeam: Record<string, string> = {};
  const authorityByTeam: Record<string, "linear" | "syncview"> = {};
  const parityByTeam: Record<string, boolean> = {};
  for (const team of teamList) {
    projectByTeam[team] = await projectForIntake(client, team, principal);
    authorityByTeam[team] = principal.testOnly ? "syncview" : await authorityFor(supabase, team);
    // Submission is already an authenticated native-first flow. The server
    // selects parity only for the still-Linear-authoritative leg; a mixed
    // graphics-first request therefore takes one normal and one parity lane.
    parityByTeam[team] = !principal.testOnly && authorityByTeam[team] === "linear";
  }
  if (Object.values(parityByTeam).some(Boolean)) await assertLegacyParityEnabled(supabase);

  const batchId = await deterministicNativeId("bat", requestId, "submission");
  const deliverableIds = await Promise.all(items.map((_item, index) =>
    deterministicNativeId("del", requestId, `${normalizeTeam(items[index].team)}:${index}`)
  ));
  const { data: existingDeliverables, error: existingError } = await supabase.from("deliverables")
    .select("*")
    .in("id", deliverableIds);
  if (existingError) throw new GatewayError(503, "deliverable_lookup_unavailable");
  const existingById = new Map(((existingDeliverables || []) as JsonMap[]).map(row => [clean(row.id), row]));
  const skipGraphicGeneration = body.skip_graphic_generation === true;
  if (skipGraphicGeneration && principal.kind !== "test") {
    throw new GatewayError(403, "skip_graphic_generation_forbidden");
  }
  for (let index = 0; index < items.length; index++) {
    if (normalizeTeam(items[index].team) === "graphics"
        && clean(items[index].brief)
        && !existingById.has(deliverableIds[index])) {
      throw new GatewayError(400, "graphics_brief_server_owned", { item_index: index });
    }
  }
  const generatedDescriptions = await graphicDescriptions(
    supabase, client, { ...batchInput, notes: clean(batchInput.notes || body.notes) },
    items, existingById, deliverableIds, skipGraphicGeneration,
  );
  const assigneeByTeam: Record<string, string> = {};
  for (const team of teamList) {
    const teamExistingIds = [...existingById.values()]
      .filter(row => normalizeTeam(row.team) === team)
      .map(row => clean(row.assignee_id))
      .filter(Boolean);
    const retryAssignees = new Set(teamExistingIds);
    if (retryAssignees.size > 1) throw new GatewayError(409, "intake_id_conflict");
    assigneeByTeam[team] = retryAssignees.size === 1
      ? [...retryAssignees][0]
      : await autoAssigneeForIntake(supabase, team);
  }

  const plannedItems: JsonMap[] = [];
  for (let index = 0; index < items.length; index++) {
    const item = items[index];
    const team = normalizeTeam(item.team);
    const assigneeId = assigneeByTeam[team];
    const videoNumber = Number(item.videoNumber ?? item.number ?? index + 1);
    if (!Number.isInteger(videoNumber) || videoNumber < 1) {
      throw new GatewayError(400, "invalid_intake_item", { item_index: index });
    }
    const fallbackTitle = `Video ${videoNumber}`;
    const title = team === "graphics" ? fallbackTitle : clean(item.title) || fallbackTitle;
    const sourceBrief = team === "graphics" ? "" : clean(item.brief);
    const existingBrief = clean(existingById.get(deliverableIds[index])?.brief);
    const brief = team === "graphics"
      ? existingBrief || clean(generatedDescriptions.get(index)) || fallbackTitle
      : existingBrief || sourceBrief;
    const priority = item.priority == null || item.priority === "" ? null : Number(item.priority);
    const sortKey = item.sort_key == null ? index : Number(item.sort_key);
    const status = lower(item.status || "in_progress");
    if (clean(item.assignee_id)) {
      throw new GatewayError(400, "intake_assignee_override_not_allowed", { item_index: index });
    }
    if (!title || title.length > 500
        || !validDateOrNull(item.due_date)
        || (priority != null && (!Number.isInteger(priority) || priority < 0 || priority > 4))
        || !Number.isFinite(sortKey) || sortKey < 0
        || !DELIVERABLE_STATUSES.includes(status)) {
      throw new GatewayError(400, "invalid_intake_item", { item_index: index });
    }
    const row: JsonMap = {
      id: deliverableIds[index],
      identifier: null,
      batch_id: batchId,
      client_slug: clientSlug,
      team,
      kind: team === "graphics" ? "thumbnail" : "video",
      title,
      brief: brief || null,
      status,
      status_at: sourceEditedAt,
      assignee_id: assigneeId,
      due_date: clean(item.due_date) || null,
      priority,
      origin: "manual",
      card_id: clean(item.card_id) || null,
      sort_key: sortKey,
      created_by: principal.actorKey,
      created_at: sourceEditedAt,
    };
    const existing = existingById.get(deliverableIds[index]);
    if (existing && (
      clean(existing.client_slug) !== clientSlug
      || normalizeTeam(existing.team) !== team
      || clean(existing.batch_id) !== batchId
      || clean(existing.title) !== title
      || clean(existing.status) !== status
      || clean(existing.assignee_id) !== assigneeId
      || clean(existing.due_date) !== clean(row.due_date)
      || Number(existing.priority == null ? 0 : existing.priority) !== Number(priority == null ? 0 : priority)
    )) throw new GatewayError(409, "intake_id_conflict", { item_index: index });
    plannedItems.push({ item_index: index, video_number: videoNumber, source_brief: sourceBrief, row });
  }

  const batchRow: JsonMap = {
    id: batchId,
    client_slug: clientSlug,
    team: teamList.length === 1 ? teamList[0] : null,
    name: clean(batchInput.name).slice(0, 500),
    description: clean(batchInput.description) || null,
    filming_doc_url: clean(batchInput.filming_doc_url) || null,
    footage_folder_url: clean(batchInput.footage_folder_url) || null,
    delivery_folder_url: clean(batchInput.delivery_folder_url) || null,
    color: clean(batchInput.color) || null,
    status: "active",
    created_by: principal.actorKey,
    created_at: sourceEditedAt,
  };
  const parentPlans: JsonMap[] = [];
  for (const team of teamList) {
    const parentDedup = dedupKey("create", "batch", batchId, `${requestId}:${team}`);
    const parentFingerprint = await intentFingerprint({
      operation: "intake_create", requestId, surface, team,
      legacyParity: parityByTeam[team], actorKey: principal.actorKey,
      clientSlug, projectId: projectByTeam[team],
      batch: {
        name: batchRow.name,
        description: batchRow.description,
        filming_doc_url: batchRow.filming_doc_url,
        footage_folder_url: batchRow.footage_folder_url,
        delivery_folder_url: batchRow.delivery_folder_url,
        color: batchRow.color,
      },
      items: plannedItems.filter(item => normalizeTeam((item.row as JsonMap).team) === team).map(item => {
        const row = item.row as JsonMap;
        return {
          id: row.id, title: row.title, source_brief: item.source_brief,
          video_number: item.video_number, status: row.status,
          assignee_id: row.assignee_id, due_date: row.due_date, priority: row.priority,
          card_id: row.card_id, sort_key: row.sort_key,
        };
      }),
    });
    const parentOutbound: JsonMap = {
      entity: "batch", entity_id: batchId, team, operation: "create",
      dedup_key: parentDedup, source_edited_at: sourceEditedAt,
      test_only: principal.testOnly, legacy_parity: parityByTeam[team],
      payload: {
        team_id: teamIdFor(team) || undefined,
        project_id: projectByTeam[team],
        title: clean(batchInput.name),
        description: clean(batchInput.description) || undefined,
        _intent_fingerprint: parentFingerprint,
      },
    };
    const parentEvent = eventFor("intake_create", principal, sourceEditedAt, surface, parentOutbound, null);
    const parentReplay = await assertDedupIntent(
      supabase, parentDedup,
      dedupExpectation(principal, team, sourceEditedAt, parentOutbound, parentFingerprint),
    );
    parentPlans.push({ team, dedup: parentDedup, outbound: parentOutbound, event: parentEvent, replay: parentReplay });
  }

  for (const planned of plannedItems) {
    const index = Number(planned.item_index);
    const row = planned.row as JsonMap;
    const team = normalizeTeam(row.team);
    const projectId = projectByTeam[team];
    const legacyParity = parityByTeam[team];
    const childDedup = dedupKey("create", "deliverable", clean(row.id), requestId);
    const childFingerprint = await intentFingerprint({
      operation: "intake_create", requestId, surface, legacyParity,
      actorKey: principal.actorKey, clientSlug, team, projectId, item_index: index,
      row: {
        id: row.id, title: row.title, source_brief: planned.source_brief,
        video_number: planned.video_number, status: row.status,
        assignee_id: row.assignee_id, due_date: row.due_date, priority: row.priority,
        card_id: row.card_id, sort_key: row.sort_key,
      },
    });
    const childOutbound: JsonMap = {
      entity: "deliverable",
      entity_id: row.id,
      team,
      operation: "create",
      dedup_key: childDedup,
      source_edited_at: sourceEditedAt,
      test_only: principal.testOnly,
      legacy_parity: legacyParity,
      payload: {
        team_id: teamIdFor(team) || undefined,
        project_id: projectId,
        title: row.title,
        description: row.brief || undefined,
        status: row.status,
        assignee_id: row.assignee_id,
        due_date: row.due_date || undefined,
        priority: row.priority == null ? undefined : row.priority,
        _intent_fingerprint: childFingerprint,
      },
    };
    planned.child_dedup = childDedup;
    planned.child_fingerprint = childFingerprint;
    planned.child_outbound = childOutbound;
    planned.child_replay = await assertDedupIntent(
      supabase,
      childDedup,
      dedupExpectation(principal, team, sourceEditedAt, childOutbound, childFingerprint),
    );
  }

  // Every item, mapping, assignee, existing deterministic row, and dedup
  // fingerprint is validated above before the first native RPC commits.
  const firstParent = parentPlans[0];
  const batch = await ensureBatch(
    supabase,
    batchRow,
    firstParent.event as JsonMap,
    clean(firstParent.dedup),
    firstParent.replay === true,
  );
  const parentOutboxByTeam: Record<string, number> = {
    [clean(firstParent.team)]: batch.outboxId,
  };
  for (let index = 1; index < parentPlans.length; index++) {
    const parent = parentPlans[index];
    if (parent.replay !== true) {
      await rpc(supabase, "production_batch_intent_write", {
        p_batch_id: batchId,
        p_event: parent.event,
      });
    }
    parentOutboxByTeam[clean(parent.team)] = await findOutboxId(supabase, clean(parent.dedup));
  }
  const responseItems: JsonMap[] = [];
  const drainPlans: JsonMap[] = parentPlans.map(parent => ({
    dedup_key: parent.dedup,
    targeted: principal.testOnly || (parent.outbound as JsonMap).legacy_parity === true,
  }));
  for (const planned of plannedItems) {
    const index = Number(planned.item_index);
    const row = planned.row as JsonMap;
    const childDedup = clean(planned.child_dedup);
    const childOutbound = planned.child_outbound as JsonMap;
    const itemTeam = normalizeTeam(row.team);
    childOutbound.depends_on_id = parentOutboxByTeam[itemTeam];
    const childEvent = eventFor(
      "intake_create", principal, sourceEditedAt, surface, childOutbound, null, clean(row.status),
    );
    const written = await ensureDeliverable(
      supabase, row, childEvent, childDedup, planned.child_replay === true,
    );
    responseItems.push({ item_index: index, ...publicRow(written) });
    drainPlans.push({ dedup_key: childDedup, targeted: principal.testOnly || childOutbound.legacy_parity === true });
  }

  const mirrorResults: JsonMap[] = [];
  for (const plan of drainPlans) {
    if (plan.targeted === true) {
      mirrorResults.push({ dedup_key: plan.dedup_key, ...await targetedDrain(clean(plan.dedup_key), principal) });
    }
  }
  const targetedFailure = mirrorResults.some(result => result.acknowledged !== true);
  const hasNormalPending = drainPlans.some(plan => plan.targeted !== true);
  const mirrorPending = targetedFailure || hasNormalPending;
  // A targeted create drain checkpoints Linear linkage through the ledger RPCs,
  // which deliberately advances updated_at. Return that post-linkage version so
  // the caller's first scalar CAS cannot reject its own successful create.
  const [currentBatchResult, currentItemsResult] = await Promise.all([
    supabase.from("batches").select("*").eq("id", batchId).maybeSingle(),
    supabase.from("deliverables").select("*").in("id", deliverableIds),
  ]);
  if (currentBatchResult.error || currentItemsResult.error || !currentBatchResult.data) {
    throw new GatewayError(500, "native_response_refresh_failed");
  }
  const currentItemsById = new Map(
    ((currentItemsResult.data || []) as JsonMap[]).map(row => [clean(row.id), row]),
  );
  const currentResponseItems = responseItems.map(item => {
    const current = currentItemsById.get(clean(item.id));
    return current ? { item_index: item.item_index, ...publicRow(current) } : item;
  });
  return json({
    ok: true,
    native_committed: true,
    authority: authorityByTeam,
    legacy_parity: parityByTeam,
    mirror_pending: mirrorPending,
    mirror: mirrorResults,
    batch: publicRow(currentBatchResult.data),
    items: currentResponseItems,
  }, targetedFailure ? 202 : 201);
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  const url = clean(Deno.env.get("SUPABASE_URL"));
  const key = clean(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
  if (!url || !key) return json({ ok: false, error: "service_unavailable" }, 503);
  const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  try {
    const body = await req.json().catch(() => null) as JsonMap | null;
    if (!body || Array.isArray(body)) throw new GatewayError(400, "invalid_json");
    const operation = normalizeOperation(body.operation);
    if (!operation) throw new GatewayError(400, "unsupported_operation");
    const surface = surfaceFor(body);
    assertSurfaceOperation(surface, operation);
    const requestId = requestIdFor(body);
    let sourceEditedAt: string;
    try {
      sourceEditedAt = sourceTimestamp(body.source_edited_at);
    } catch (_error) {
      throw new GatewayError(400, "invalid_source_edited_at");
    }
    return operation === "intake_create"
      ? await handleIntakeCreate(supabase, req, body, surface, requestId, sourceEditedAt)
      : await handleEntityOperation(supabase, req, body, operation, surface, requestId, sourceEditedAt);
  } catch (error) {
    if (error instanceof GatewayError) {
      return json({ ok: false, error: error.code, ...(error.detail || {}) }, error.status);
    }
    console.error("production-write failed", error instanceof Error ? error.message : "unknown");
    return json({ ok: false, error: "write_failed" }, 500);
  }
});
