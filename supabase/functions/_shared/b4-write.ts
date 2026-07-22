import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2.49.8";

type JsonMap = Record<string, unknown>;
type Role = "admin" | "smm" | "creative";
type Member = JsonMap & { id: string; name: string; role: string; active: boolean };

const TEXT = new TextEncoder();
const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-syncview-key, x-syncview-actor, x-syncview-role",
  "Cache-Control": "no-store",
};
const OPERATIONS = [
  "create", "status", "comment", "due", "assignee",
  "title", "priority", "parent", "archive", "restore",
];
const CREATE_FIELDS: Record<string, Set<string>> = {
  batches: new Set([
    "client_slug", "team", "name", "description", "filming_doc_url",
    "footage_folder_url", "delivery_folder_url", "color", "status",
    "comments", "sort_key", "created_by",
  ]),
  deliverables: new Set([
    "identifier", "batch_id", "client_slug", "team", "kind", "title", "brief", "status",
    "status_at", "assignee_id", "due_date", "priority", "file_url", "comments",
    "origin", "card_id", "sort_key", "created_by",
  ]),
};

function updateFields(table: "deliverables" | "batches", operation: string): Set<string> {
  if (operation === "comment") return new Set(["comments"]);
  if (operation === "title") return new Set([table === "batches" ? "name" : "title"]);
  if (operation === "archive" || operation === "restore") {
    return table === "batches" ? new Set(["status"]) : new Set();
  }
  if (table === "batches") return new Set();
  if (operation === "status") return new Set(["status", "status_at"]);
  if (operation === "due") return new Set(["due_date"]);
  if (operation === "assignee") return new Set(["assignee_id"]);
  if (operation === "priority") return new Set(["priority"]);
  if (operation === "parent") return new Set(["batch_id"]);
  return new Set();
}

function clean(value: unknown): string {
  return String(value == null ? "" : value).trim();
}

function lower(value: unknown): string {
  return clean(value).toLowerCase();
}

function sourceEditTimestamp(value: unknown): string {
  const now = Date.now();
  if (!clean(value)) return new Date(now).toISOString();
  const parsed = Date.parse(clean(value));
  if (!Number.isFinite(parsed) || parsed > now + 5 * 60 * 1_000) {
    throw new Error("invalid_source_edited_at");
  }
  return new Date(parsed).toISOString();
}

function norm(value: unknown): string {
  let text = lower(value);
  try {
    text = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  } catch (_e) {
    // Normalization is a convenience; exact ASCII still works.
  }
  return text.replace(/[^a-z0-9@.]+/g, "");
}

function timingSafeEqual(a: string, b: string): boolean {
  const left = TEXT.encode(a || "");
  const right = TEXT.encode(b || "");
  let diff = left.length ^ right.length;
  const max = Math.max(left.length, right.length);
  for (let i = 0; i < max; i++) diff |= (left[i] || 0) ^ (right[i] || 0);
  return diff === 0;
}

async function serviceRoleRequest(req: Request): Promise<boolean> {
  const expected = clean(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
  const supplied = clean(req.headers.get("authorization")).replace(/^Bearer\s+/i, "");
  if (!supplied) return false;
  if (expected && timingSafeEqual(expected, supplied)) return true;
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
  } catch (_e) {
    return false;
  }
}

function parseArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value == null ? "[]" : value));
    return Array.isArray(parsed) ? parsed : [];
  } catch (_e) {
    return [];
  }
}

function parseJson(value: unknown): JsonMap {
  if (!value) return {};
  if (typeof value === "object" && !Array.isArray(value)) return value as JsonMap;
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as JsonMap : {};
  } catch (_e) {
    return {};
  }
}

function projectIds(value: unknown): Set<string> {
  const ids = new Set<string>();
  const stack = parseArray(value);
  while (stack.length) {
    const item = stack.pop();
    if (typeof item === "string" && clean(item)) ids.add(clean(item));
    else if (item && typeof item === "object") {
      const row = item as JsonMap;
      for (const key of ["id", "project_id", "linear_project_id"]) {
        if (clean(row[key])) ids.add(clean(row[key]));
      }
      for (const child of Object.values(row)) if (Array.isArray(child)) stack.push(...child);
    }
  }
  return ids;
}

function configuredTestProjectIds(): Set<string> {
  return new Set(clean(Deno.env.get("B4_TEST_PROJECT_IDS"))
    .split(",")
    .map(clean)
    .filter(Boolean));
}

async function validateTestOverride(
  supabase: SupabaseClient,
  req: Request,
  body: JsonMap,
  existing: JsonMap | null,
  row: JsonMap,
): Promise<boolean> {
  if (!body.test_override) return false;
  if (!(await serviceRoleRequest(req)) || clean(body.confirm) !== "B4_TEST_ONLY") {
    throw new Error("invalid TEST override");
  }
  const slug = clean(row.client_slug);
  if (!slug || (existing && clean(existing.client_slug) !== slug)) {
    throw new Error("TEST override client mismatch");
  }
  const { data, error } = await supabase.from("clients")
    .select("slug,kind,active,linear_project_ids")
    .eq("slug", slug)
    .maybeSingle();
  if (error || !data || data.kind !== "test" || data.active !== true) {
    throw new Error("TEST override requires an active test client");
  }
  if (!existing) {
    const payload = body.linear_payload && typeof body.linear_payload === "object"
      ? body.linear_payload as JsonMap
      : {};
    const projectId = clean(payload.project_id);
    const allowedProjects = projectIds(data.linear_project_ids);
    for (const id of configuredTestProjectIds()) allowedProjects.add(id);
    if (!projectId || !allowedProjects.has(projectId)) {
      throw new Error("TEST override project mismatch");
    }
  }
  return true;
}

function roleForKey(key: string): Role | null {
  const pairs: Array<[Role, string | undefined]> = [
    ["admin", Deno.env.get("ROLE_KEY_ADMIN")],
    ["smm", Deno.env.get("ROLE_KEY_SMM")],
    ["creative", Deno.env.get("ROLE_KEY_CREATIVE")],
  ];
  for (const [role, secret] of pairs) {
    if (secret && timingSafeEqual(key, secret)) return role;
  }
  return null;
}

function roleCompatible(keyRole: Role, member: Member): boolean {
  if (keyRole === "admin") return member.role === "admin";
  if (keyRole === "smm") return member.role === "smm";
  return member.role === "editor" || member.role === "designer";
}

function json(body: JsonMap, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

async function resolveMember(
  supabase: SupabaseClient,
  body: JsonMap,
  req: Request,
): Promise<Member | null> {
  const memberId = clean(body.member_id);
  if (memberId) {
    const { data, error } = await supabase.from("team_members")
      .select("*")
      .eq("id", memberId)
      .eq("active", true)
      .maybeSingle();
    if (error) throw error;
    return data as Member | null;
  }

  const actor = norm(req.headers.get("x-syncview-actor") || body.actor);
  if (!actor) return null;
  const { data, error } = await supabase.from("team_members")
    .select("*")
    .eq("active", true);
  if (error) throw error;
  return ((data || []) as Member[]).find(member => norm(member.name) === actor) || null;
}

async function teamAuthority(supabase: SupabaseClient, team: string): Promise<string> {
  const { data } = await supabase.from("syncview_runtime_flags")
    .select("value")
    .eq("key", "prod_authority")
    .maybeSingle();
  const value = data && typeof data.value === "object" ? data.value as JsonMap : {};
  const key = lower(team) === "graphics" || lower(team) === "graphic" ? "graphics" : "video";
  const raw = lower(value[key]);
  return raw === "syncview" || raw === "supabase" ? "syncview" : "linear";
}

async function f27WriteAuthorizationGeneration(
  supabase: SupabaseClient,
  team: string,
): Promise<number> {
  const rawTeam = lower(team);
  const normalizedTeam = ["graphics", "graphic", "gra"].includes(rawTeam)
    ? "graphics"
    : ["video", "vid"].includes(rawTeam)
      ? "video"
      : "";
  if (!normalizedTeam) throw new Error("authority_unavailable");
  const { data, error } = await supabase.rpc("track_b_f27_write_authorization", {
    p_team: normalizedTeam,
  });
  const authorization = parseJson(data);
  const generation = authorization.generation;
  if (error
      || authorization.ok !== true
      || clean(authorization.type) !== "f27_write_authorization"
      || clean(authorization.team) !== normalizedTeam
      || !["linear", "syncview"].includes(clean(authorization.authority))
      || typeof generation !== "number"
      || !Number.isSafeInteger(generation)
      || generation < 0) {
    throw new Error("authority_unavailable");
  }
  return generation;
}

function outboundPayload(operation: string, patch: JsonMap, supplied: JsonMap): JsonMap {
  if (Object.keys(supplied).length) return supplied;
  if (operation === "status") return { status: clean(patch.status) };
  if (operation === "title") return { title: clean(patch.title) };
  if (operation === "due") return { due_date: clean(patch.due_date) || null };
  if (operation === "assignee") return { assignee_id: clean(patch.assignee_id) || null };
  if (operation === "priority") return { priority: patch.priority == null ? 0 : Number(patch.priority) };
  if (operation === "parent") return { parent_linear_issue_id: clean(patch.parent_linear_issue_id) || null };
  return {};
}

export async function handleB4Write(
  req: Request,
  config: { table: "deliverables" | "batches"; rpc: "deliverable_write" | "batch_write"; entity: "deliverable" | "batch" },
): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  // These low-level wrappers remain available to the service-only B4 harness,
  // but browsers must enter through production-write. A role header, actor,
  // member_id, or otherwise valid staff key cannot bypass the gateway's client
  // scoping and per-operation policy.
  if (!(await serviceRoleRequest(req))) {
    return json({ ok: false, error: "gateway_required" }, 403);
  }

  const url = clean(Deno.env.get("SUPABASE_URL"));
  const key = clean(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
  if (!url || !key) return json({ ok: false, error: "service_unavailable" }, 503);
  const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  try {
    const body = await req.json() as JsonMap;
    const id = clean(body.id);
    let patch = body.patch && typeof body.patch === "object" && !Array.isArray(body.patch)
      ? body.patch as JsonMap
      : {};
    const operation = lower(body.operation);
    let sourceEditedAt: string;
    try {
      sourceEditedAt = sourceEditTimestamp(body.source_edited_at);
    } catch (_error) {
      return json({ ok: false, error: "invalid_source_edited_at" }, 400);
    }
    if (!OPERATIONS.includes(operation)) {
      return json({ ok: false, error: "unsupported_operation" }, 400);
    }
    if (config.table === "batches" && !["create", "title", "comment", "archive", "restore"].includes(operation)) {
      return json({ ok: false, error: "unsupported_batch_operation" }, 400);
    }
    let existing: JsonMap | null = null;
    if (id) {
      const { data, error } = await supabase.from(config.table)
        .select("*")
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      existing = data as JsonMap | null;
    }

    if (operation === "create" && existing) {
      return json({ ok: false, conflict: true, row: existing }, 409);
    }
    if (operation !== "create" && !existing) {
      return json({ ok: false, error: "row_not_found" }, 404);
    }
    const allowedFields = operation === "create"
      ? CREATE_FIELDS[config.table]
      : updateFields(config.table, operation);
    const invalidField = Object.keys(patch).find(field => !allowedFields.has(field));
    if (invalidField) {
      return json({ ok: false, error: "invalid_patch_field" }, 400);
    }

    patch = { ...patch };
    if (operation === "status" && patch.status_at === undefined) {
      patch.status_at = sourceEditedAt;
    }
    if (config.table === "deliverables" && (operation === "archive" || operation === "restore")) {
      const raw = parseJson(existing && existing.linear_raw);
      if (operation === "archive") {
        raw.archived = sourceEditedAt;
      } else {
        for (const key of ["archived", "webhook_delete", "deleted", "delete", "removed"]) delete raw[key];
        const issue = parseJson(raw.issue);
        if (Object.keys(issue).length) raw.issue = { ...issue, archivedAt: null };
      }
      patch.linear_raw = raw;
    }
    if (config.table === "batches" && operation === "archive") patch.status = "archived";
    if (config.table === "batches" && operation === "restore" && !["active", "done"].includes(lower(patch.status))) {
      patch.status = "active";
    }

    if (existing && body.expected_status !== undefined
        && clean(existing.status) !== clean(body.expected_status)) {
      return json({ ok: false, conflict: true, row: existing }, 409);
    }
    if (existing && body.expected_updated_at !== undefined
        && clean(existing.updated_at) !== clean(body.expected_updated_at)) {
      return json({ ok: false, conflict: true, row: existing }, 409);
    }

    const row = { ...(existing || {}), ...patch };
    if (id) row.id = id;
    const testOverride = await validateTestOverride(supabase, req, body, existing, row);
    const keyRole = testOverride ? "admin" : roleForKey(clean(req.headers.get("x-syncview-key")));
    const member = testOverride
      ? { id: "b4-test-harness", name: clean(body.actor) || "B4 TEST harness", role: "admin", active: true } as Member
      : await resolveMember(supabase, body, req);
    if (!keyRole || !member || (!testOverride && !roleCompatible(keyRole, member))) {
      return json({ ok: false, error: "forbidden" }, 403);
    }

    const team = clean(row.team);
    if (!team || (!testOverride && await teamAuthority(supabase, team) !== "syncview")) {
      return json({ ok: false, paused: true, error: "team_is_linear_authoritative" }, 409);
    }
    const authorityGeneration = await f27WriteAuthorizationGeneration(supabase, team);

    const dedupKey = clean(body.dedup_key);
    if (!dedupKey) {
      return json({ ok: false, error: "operation_and_dedup_key_required" }, 400);
    }

    const suppliedPayload = body.linear_payload && typeof body.linear_payload === "object"
      ? body.linear_payload as JsonMap
      : {};
    const outbound = {
      entity: operation === "comment" ? "comment" : config.entity,
      entity_id: id || null,
      operation,
      dedup_key: dedupKey,
      source_edited_at: sourceEditedAt,
      comment_id: clean(body.comment_id) || null,
      depends_on_id: body.depends_on_id == null ? null : Number(body.depends_on_id),
      payload: {
        ...outboundPayload(operation, patch, suppliedPayload),
        _f27_authority_generation: authorityGeneration,
        _f27_legacy_parity: false,
      },
      test_only: testOverride,
    };
    const event = {
      source: "ui",
      action: operation === "create" ? "create" : operation + "_change",
      actor: member.name,
      role: keyRole,
      ts: sourceEditedAt,
      from_status: clean(existing && existing.status) || null,
      to_status: clean(row.status) || null,
      outbound,
    };
    const result = operation === "comment"
      ? await supabase.rpc(
        config.table === "deliverables" ? "deliverable_b4_comment_write" : "batch_b4_comment_write",
        {
          p_id: id,
          p_comments: String(patch.comments == null ? "" : patch.comments),
          p_base: body.comments_base == null
            ? String(existing && existing.comments || "")
            : String(body.comments_base),
          p_event: event,
        },
      )
      : await supabase.rpc(config.rpc, { p_row: row, p_event: event });
    const { data, error } = result;
    if (error) throw error;
    return json({ ok: true, row: data });
  } catch (_error) {
    return json({ ok: false, error: "write_failed" }, 500);
  }
}
