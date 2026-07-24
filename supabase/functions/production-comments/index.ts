// Protected reader for native Production comment threads.
//
// The underlying table intentionally has no anon/authenticated SELECT policy.
// This gateway verifies either a shared staff role key plus active compatible
// roster identity, or an exact active-client token plus the verified SXR
// card/component/deliverable crosswalk, before a bounded service-role read.

import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2.49.8";
import {
  authorizeStaffKey,
  staffAuthFailureStatus,
  type StaffRoleKey,
} from "../_shared/staff-role-auth.ts";
import { timingSafeEqual } from "../_shared/staff-role-auth.ts";
import {
  audienceAllowed,
  clean,
  clientSurfaceTargetAllowed,
  clientTargetAllowed,
  credentialMode,
  normalizeTeam,
  publicComment,
  roleCompatible,
  staffTargetAllowed,
} from "./policy.mjs";

type JsonMap = Record<string, unknown>;
type Member = {
  id: string;
  name: string;
  role: "admin" | "smm" | "editor" | "designer";
  team: "video" | "graphics" | null;
  active: boolean;
};
type Principal = {
  kind: "staff" | "client";
  keyRole: StaffRoleKey | "client";
  member: Member | null;
  clientSlug: string;
  actorKey: string;
};

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-syncview-key, x-syncview-actor, x-syncview-role, x-syncview-client-token",
  "Cache-Control": "no-store",
};

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 30;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/;
const SAFE_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;
const COMMENT_SELECT = [
  "id", "native_comment_id", "deliverable_id", "batch_id", "client_slug", "team",
  "linear_issue_uuid", "linear_identifier", "linear_comment_id",
  "parent_id", "thread_root_id", "linear_parent_comment_id", "linear_thread_root_id",
  "author_key", "author_member_id", "linear_author_id", "author_name", "role",
  "transport_actor", "transport_role", "transport_linear_user_id",
  "body", "body_format", "attachments",
  "audience", "component", "is_tweak", "round", "origin", "source",
  "source_created_at", "source_updated_at", "edited_at", "deleted_at",
  "deleted_by_key", "deleted_by_name", "resolved_at", "resolved_by_key",
  "resolved_by_name", "version", "created_at", "updated_at", "ingested_at",
].join(",");

function norm(value: unknown): string {
  let text = clean(value).toLowerCase();
  try {
    text = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  } catch (_error) {
    // Exact ASCII names remain usable if normalization is unavailable.
  }
  return text.replace(/[^a-z0-9@.]+/g, "");
}

async function opaqueBucket(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value || "edge-unknown"),
  );
  return Array.from(new Uint8Array(digest))
    .map(byte => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function clientPreauthActor(req: Request): Promise<string> {
  // These forwarding headers are set by the serving edge, not accepted by the
  // browser CORS contract. Hash before storage so the budget key is stable but
  // never records a network address or presented client token.
  const forwarded = clean(
    req.headers.get("cf-connecting-ip")
      || req.headers.get("x-real-ip")
      || clean(req.headers.get("x-forwarded-for")).split(",")[0]
      || "edge-unknown",
  );
  return `preauth:client:${await opaqueBucket(forwarded)}`;
}

function json(body: JsonMap, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

async function resolveActiveMember(
  supabase: SupabaseClient,
  actorHeader: string,
  keyRole: StaffRoleKey,
): Promise<Member | null> {
  const actor = norm(actorHeader);
  if (!actor) return null;

  const { data, error } = await supabase
    .from("team_members")
    .select("id,name,role,team,active")
    .eq("active", true);
  if (error) throw new Error("member_lookup_failed");

  // Caller-supplied role headers never authorize access. The secret determines
  // the key family; the actor must resolve to exactly one compatible live row.
  const matches = ((data || []) as Member[]).filter((member) =>
    norm(member.name) === actor && roleCompatible(keyRole, member.role)
  );
  return matches.length === 1 ? matches[0] : null;
}

async function resolvePrincipal(
  supabase: SupabaseClient,
  req: Request,
): Promise<Principal | { status: number; error: string }> {
  const key = clean(req.headers.get("x-syncview-key"));
  const token = clean(req.headers.get("x-syncview-client-token"));
  const mode = credentialMode(key, token);
  if (mode === "ambiguous") return { status: 401, error: "ambiguous_credentials" };

  if (mode === "staff") {
    const auth = authorizeStaffKey(key, ["admin", "smm", "creative"]);
    if (!auth.ok || !auth.role) {
      return { status: staffAuthFailureStatus(auth), error: "unauthorized" };
    }
    const member = await resolveActiveMember(
      supabase,
      clean(req.headers.get("x-syncview-actor")),
      auth.role,
    );
    if (!member) return { status: 403, error: "forbidden" };
    return {
      kind: "staff",
      keyRole: auth.role,
      member,
      clientSlug: "",
      actorKey: `member:${clean(member.id)}`,
    };
  }

  if (mode === "client") {
    const preauthBudget = await takeReadBudget(supabase, await clientPreauthActor(req));
    if (preauthBudget === "unavailable") {
      return { status: 503, error: "read_authorization_unavailable" };
    }
    if (preauthBudget === "rate_limited") {
      return { status: 429, error: "rate_limited" };
    }
    const { data, error } = await supabase.from("client_access").select("slug,review_token");
    if (error) throw new Error("client_auth_failed");
    const matches = ((data || []) as JsonMap[]).filter((row) => {
      const stored = clean(row.review_token);
      return !!stored && timingSafeEqual(token, stored);
    });
    if (matches.length !== 1) {
      return { status: matches.length ? 403 : 401, error: matches.length ? "forbidden" : "unauthorized" };
    }
    const clientSlug = clean(matches[0].slug);
    const { data: client, error: clientError } = await supabase.from("clients")
      .select("slug,active")
      .eq("slug", clientSlug)
      .maybeSingle();
    if (clientError) throw new Error("client_lookup_failed");
    if (!client || client.active !== true) return { status: 403, error: "forbidden" };
    return {
      kind: "client",
      keyRole: "client",
      member: null,
      clientSlug,
      actorKey: `client:${clientSlug}`,
    };
  }

  return { status: 401, error: "unauthorized" };
}

async function auditRead(
  supabase: SupabaseClient,
  principal: Principal | null,
  deliverableId: string,
  decision: "allow" | "deny",
  reason: string,
): Promise<boolean> {
  try {
    const { error } = await supabase.from("production_comment_read_audit").insert({
      actor_key: principal?.actorKey || "anonymous",
      auth_kind: principal?.kind || "none",
      deliverable_id: deliverableId || null,
      decision,
      reason,
    });
    if (error) {
      // Denial audit is best effort, but authenticated principal-wide budget
      // bounds this diagnostic lane before any target lookup.
      console.warn("production_comment_denial_audit_failed");
      return false;
    }
    return true;
  } catch (_error) {
    // Audit storage is source-gated with the migration. A logging failure must
    // never widen access or leak whether the requested target exists.
    console.warn("production_comment_denial_audit_failed");
    return false;
  }
}

async function takeReadBudget(
  supabase: SupabaseClient,
  actorKey: string,
): Promise<"allow" | "rate_limited" | "unavailable"> {
  const { data, error } = await supabase.rpc("production_comment_read_budget_take", {
    p_actor_key: actorKey,
  });
  if (error || !data || typeof data !== "object" || Array.isArray(data)) return "unavailable";
  const result = data as JsonMap;
  if (result.ok !== true) return "unavailable";
  return result.allowed === true ? "allow" : "rate_limited";
}

async function authorizeAllowedRead(
  supabase: SupabaseClient,
  principal: Principal,
  deliverableId: string,
): Promise<boolean> {
  const { data, error } = await supabase.rpc("production_comment_read_authorize", {
    p_actor_key: principal.actorKey,
    p_auth_kind: principal.kind,
    p_deliverable_id: deliverableId,
  });
  if (error || !data || typeof data !== "object" || Array.isArray(data)) return false;
  const result = data as JsonMap;
  return result.ok === true && result.authorized === true;
}

function parseLimit(value: unknown): number | null {
  if (value == null || value === "") return DEFAULT_LIMIT;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_LIMIT) return null;
  return parsed;
}

function parseCursor(value: unknown): { created_at: string; id: string } | null | false {
  if (value == null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const cursor = value as JsonMap;
  const createdAt = clean(cursor.created_at);
  const id = clean(cursor.id);
  if (!SAFE_TIMESTAMP.test(createdAt) || !Number.isFinite(Date.parse(createdAt)) || !SAFE_ID.test(id)) {
    return false;
  }
  return { created_at: createdAt, id };
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  const url = clean(Deno.env.get("SUPABASE_URL"));
  const serviceKey = clean(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
  if (!url || !serviceKey) return json({ ok: false, error: "service_unavailable" }, 503);

  let body: JsonMap;
  try {
    body = await req.json() as JsonMap;
  } catch (_error) {
    return json({ ok: false, error: "invalid_json" }, 400);
  }

  const deliverableId = clean(body.deliverable_id);
  const clientSurface = {
    source_surface: clean(body.source_surface).toLowerCase(),
    card_id: clean(body.card_id),
    component: clean(body.component).toLowerCase(),
  };
  const limit = parseLimit(body.limit);
  const before = parseCursor(body.before);
  if (!deliverableId || !SAFE_ID.test(deliverableId)) {
    return json({ ok: false, error: "invalid_deliverable_id" }, 400);
  }
  if (limit == null) return json({ ok: false, error: "invalid_limit" }, 400);
  if (before === false) return json({ ok: false, error: "invalid_cursor" }, 400);

  const supabase = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const resolved = await resolvePrincipal(supabase, req);
    if ("status" in resolved) {
      return json({ ok: false, error: resolved.error }, resolved.status);
    }
    const principal = resolved;
    const budget = await takeReadBudget(supabase, principal.actorKey);
    if (budget === "unavailable") {
      return json({ ok: false, error: "read_authorization_unavailable" }, 503);
    }
    if (budget === "rate_limited") {
      return json({ ok: false, error: "rate_limited", retry_after_seconds: 300 }, 429);
    }

    const { data: target, error: targetError } = await supabase.from("deliverables")
      .select("id,client_slug,team,origin,card_id")
      .eq("id", deliverableId)
      .maybeSingle();
    if (targetError) throw new Error("target_lookup_failed");
    const targetAllowed = !!target && (
      principal.kind === "client"
        ? clientTargetAllowed(principal.clientSlug, target.client_slug)
          && clientSurfaceTargetAllowed(clientSurface, target)
        : staffTargetAllowed(
          principal.keyRole,
          principal.member && principal.member.team,
          target.team,
        )
    );
    if (!targetAllowed || !normalizeTeam(target && target.team)) {
      await auditRead(supabase, principal, deliverableId, "deny", "target_forbidden");
      // Missing and out-of-scope targets intentionally share one response.
      return json({ ok: false, error: "forbidden" }, 403);
    }
    if (!await authorizeAllowedRead(supabase, principal, deliverableId)) {
      // Never release comment bodies when the durable allow audit is missing.
      return json({ ok: false, error: "read_authorization_unavailable" }, 503);
    }

    let totalQuery = supabase
      .from("production_comments")
      .select("id", { count: "exact", head: true })
      .eq("deliverable_id", deliverableId);

    let pageQuery = supabase
      .from("production_comments")
      .select(COMMENT_SELECT)
      .eq("deliverable_id", deliverableId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(limit + 1);
    if (principal.kind === "client") {
      totalQuery = totalQuery.eq("audience", "client");
      pageQuery = pageQuery.eq("audience", "client");
    }

    if (before) {
      pageQuery = pageQuery.or(
        `created_at.lt.${before.created_at},and(created_at.eq.${before.created_at},id.lt.${before.id})`,
      );
    }

    const [totalResult, pageResult] = await Promise.all([totalQuery, pageQuery]);
    if (totalResult.error || pageResult.error) throw new Error("comment_read_failed");

    const fetched = Array.isArray(pageResult.data) ? pageResult.data : [];
    const hasMore = fetched.length > limit;
    const comments = fetched.slice(0, limit)
      .filter((row) => audienceAllowed(principal.kind, (row as JsonMap).audience))
      .map((row) => publicComment(row, {
        kind: principal.kind,
        keyRole: principal.keyRole,
        memberId: principal.member && principal.member.id,
        actorKey: principal.actorKey,
      }))
      .filter(Boolean);
    const tail = comments.length ? comments[comments.length - 1] as JsonMap : null;
    return json({
      ok: true,
      canonical_thread: true,
      audience_scope: principal.kind === "client" ? "client" : "all",
      total: Number(totalResult.count || 0),
      has_more: hasMore,
      next_cursor: hasMore && tail
        ? { created_at: clean(tail.created_at), id: clean(tail.id) }
        : null,
      comments,
    });
  } catch (_error) {
    return json({ ok: false, error: "read_failed" }, 500);
  }
});
