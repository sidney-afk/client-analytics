// Protected reader for native Production comment threads.
//
// The underlying table intentionally has no anon/authenticated SELECT policy.
// This gateway verifies the shared role key and an active, role-compatible
// roster identity before using the service role for a bounded read.

import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2.49.8";
import {
  authorizeStaffKey,
  staffAuthFailureStatus,
  type StaffRoleKey,
} from "../_shared/staff-role-auth.ts";

type JsonMap = Record<string, unknown>;
type Member = {
  id: string;
  name: string;
  role: "admin" | "smm" | "editor" | "designer";
  team: "video" | "graphics" | null;
  active: boolean;
};

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-syncview-key, x-syncview-actor, x-syncview-role",
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

function clean(value: unknown): string {
  return String(value == null ? "" : value).trim();
}

function norm(value: unknown): string {
  let text = clean(value).toLowerCase();
  try {
    text = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  } catch (_error) {
    // Exact ASCII names remain usable if normalization is unavailable.
  }
  return text.replace(/[^a-z0-9@.]+/g, "");
}

function json(body: JsonMap, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

function roleCompatible(keyRole: StaffRoleKey, member: Member): boolean {
  if (keyRole === "admin") return member.role === "admin";
  if (keyRole === "smm") return member.role === "smm";
  return member.role === "editor" || member.role === "designer";
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
    norm(member.name) === actor && roleCompatible(keyRole, member)
  );
  return matches.length === 1 ? matches[0] : null;
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

  const key = clean(req.headers.get("x-syncview-key"));
  const auth = authorizeStaffKey(key, ["admin", "smm", "creative"]);
  if (!auth.ok || !auth.role) {
    return json({ ok: false, error: "unauthorized" }, staffAuthFailureStatus(auth));
  }

  let body: JsonMap;
  try {
    body = await req.json() as JsonMap;
  } catch (_error) {
    return json({ ok: false, error: "invalid_json" }, 400);
  }

  const deliverableId = clean(body.deliverable_id);
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
    const member = await resolveActiveMember(
      supabase,
      clean(req.headers.get("x-syncview-actor")),
      auth.role,
    );
    if (!member) return json({ ok: false, error: "forbidden" }, 403);

    const totalQuery = supabase
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

    if (before) {
      pageQuery = pageQuery.or(
        `created_at.lt.${before.created_at},and(created_at.eq.${before.created_at},id.lt.${before.id})`,
      );
    }

    const [totalResult, pageResult] = await Promise.all([totalQuery, pageQuery]);
    if (totalResult.error || pageResult.error) throw new Error("comment_read_failed");

    const fetched = Array.isArray(pageResult.data) ? pageResult.data : [];
    const hasMore = fetched.length > limit;
    const comments = fetched.slice(0, limit);
    const tail = comments.length ? comments[comments.length - 1] as JsonMap : null;

    return json({
      ok: true,
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
