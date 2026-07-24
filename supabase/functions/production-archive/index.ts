// Protected, paginated reader for read-only Linear archive history.
//
// The Production repair modal calls this only through an explicit staff action.
// It requires a real active roster identity and never returns an original
// private uploads.linear.app URL.

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
  "Access-Control-Allow-Headers":
    "authorization, apikey, content-type, x-syncview-key, x-syncview-actor, x-syncview-role",
  "Cache-Control": "no-store",
};
const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 30;
const INTERNAL_REF_PAGE_SIZE = 200;
const MAX_INTERNAL_REF_ROWS = 2_000;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/;
const ARCHIVE_LIST_SELECT = [
  "linear_uuid", "identifier", "aliases", "team", "client_slug",
  "parent_uuid", "parent_identifier", "title", "state",
  "assignee_name", "due_date", "priority", "created_at",
  "completed_at", "archived_at",
].join(",");
const COMMENT_SELECT = [
  "id", "native_comment_id", "linear_issue_uuid", "linear_identifier",
  "parent_id", "author_name", "role", "body", "body_format", "attachments",
  "audience", "component", "is_tweak", "round", "origin", "source",
  "source_created_at", "source_updated_at", "edited_at", "deleted_at",
  "resolved_at", "version", "created_at", "updated_at",
].join(",");
const REF_PUBLIC_SELECT = [
  "ref_id", "linear_uuid", "comment_id", "client_slug", "team", "audience",
  "source_kind", "location_key", "original_url", "original_url_sha256",
  "rescued_url", "destination_provider", "destination_folder_id",
  "destination_file_id", "content_sha256", "byte_length", "verified_at",
  "verification_receipt_hmac", "state", "media_type", "last_error_code",
  "reviewed_by", "review_note", "owner_evidence", "discovered_at", "rescued_at", "updated_at",
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

function normalizeTeam(value: unknown): "" | "video" | "graphics" {
  const team = clean(value).toLowerCase();
  if (team === "vid" || team === "video") return "video";
  if (team === "gra" || team === "graphic" || team === "graphics") return "graphics";
  return "";
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
  const { data, error } = await supabase.from("team_members")
    .select("id,name,role,team,active")
    .eq("active", true);
  if (error) throw new Error("member_lookup_failed");
  const matches = ((data || []) as Member[]).filter(member =>
    norm(member.name) === actor && roleCompatible(keyRole, member)
  );
  return matches.length === 1 ? matches[0] : null;
}

function parseLimit(value: unknown): number | null {
  if (value == null || value === "") return DEFAULT_LIMIT;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= MAX_LIMIT ? parsed : null;
}

function creativeScopeAllowed(
  keyRole: StaffRoleKey,
  member: Member,
  targetTeam: unknown,
): boolean {
  if (keyRole === "admin" || keyRole === "smm") return true;
  const memberTeam = normalizeTeam(member.team);
  return !!memberTeam && memberTeam === normalizeTeam(targetTeam);
}

function certifiedRescuedRef(ref: JsonMap): boolean {
  const fileId = clean(ref.destination_file_id);
  return clean(ref.state) === "rescued"
    && clean(ref.destination_provider) === "google_drive_private"
    && /^[A-Za-z0-9_-]{10,200}$/.test(clean(ref.destination_folder_id))
    && /^[A-Za-z0-9_-]{10,200}$/.test(fileId)
    && clean(ref.rescued_url) === `https://drive.google.com/file/d/${fileId}/view`
    && /^[a-f0-9]{64}$/.test(clean(ref.content_sha256))
    && Number.isInteger(Number(ref.byte_length))
    && Number(ref.byte_length) >= 1
    && Number(ref.byte_length) <= 52_428_800
    && Number.isFinite(Date.parse(clean(ref.verified_at)))
    && /^[a-f0-9]{64}$/.test(clean(ref.verification_receipt_hmac));
}

function replacementFor(ref: JsonMap): string {
  return certifiedRescuedRef(ref)
    ? clean(ref.rescued_url)
    : `[Attachment unavailable: ${clean(ref.state) || "pending"}]`;
}

function rewriteArchiveText(value: string, refs: JsonMap[]): string {
  let result = String(value == null ? "" : value);
  for (const ref of refs) {
    const original = clean(ref.original_url);
    if (original) result = result.split(original).join(replacementFor(ref));
  }
  // Fail closed for a private upload that discovery has not yet indexed.
  return result.replace(
    /https:\/\/uploads[.]linear[.]app\/[^\s<>"')\]]+/gi,
    "[Attachment unavailable: unresolved]",
  );
}

function rewriteArchiveValue(value: unknown, refs: JsonMap[]): unknown {
  if (typeof value === "string") return rewriteArchiveText(value, refs);
  if (Array.isArray(value)) return value.map(item => rewriteArchiveValue(item, refs));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as JsonMap).map(([key, item]) =>
      [key, rewriteArchiveValue(item, refs)]
    ));
  }
  return value;
}

function withoutArchiveComments(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutArchiveComments);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as JsonMap)
    .filter(([key]) => !["comments", "comment", "subscribers"].includes(key.toLowerCase()))
    .map(([key, item]) => [key, withoutArchiveComments(item)]));
}

function publicRef(value: unknown): JsonMap {
  const ref = value && typeof value === "object" ? value as JsonMap : {};
  return {
    ref_id: clean(ref.ref_id),
    linear_uuid: clean(ref.linear_uuid),
    comment_id: clean(ref.comment_id) || null,
    client_slug: clean(ref.client_slug),
    team: normalizeTeam(ref.team) || null,
    audience: clean(ref.audience),
    source_kind: clean(ref.source_kind),
    location_key: clean(ref.location_key),
    original_url_sha256: clean(ref.original_url_sha256),
    rescued_url: certifiedRescuedRef(ref) ? clean(ref.rescued_url) : null,
    state: clean(ref.state),
    media_type: clean(ref.media_type) || null,
    last_error_code: clean(ref.last_error_code) || null,
    reviewed_by: clean(ref.reviewed_by) || null,
    review_note: clean(ref.review_note) || null,
    owner_evidence: clean(ref.state) === "owner_dispositioned"
      ? ref.owner_evidence || null
      : null,
    discovered_at: clean(ref.discovered_at) || null,
    rescued_at: clean(ref.rescued_at) || null,
    updated_at: clean(ref.updated_at) || null,
  };
}

async function completeIssueRefs(
  supabase: SupabaseClient,
  linearUuid: string,
  audience: string,
): Promise<JsonMap[]> {
  const rows: JsonMap[] = [];
  let cursor = "";
  const seen = new Set<string>();
  for (;;) {
    let query = supabase.from("linear_archive_asset_refs")
      .select(REF_PUBLIC_SELECT)
      .eq("linear_uuid", linearUuid)
      .order("ref_id", { ascending: true })
      .limit(INTERNAL_REF_PAGE_SIZE + 1);
    if (audience === "client") query = query.eq("audience", "client");
    if (cursor) query = query.gt("ref_id", cursor);
    const { data, error } = await query;
    if (error) throw new Error("archive_ref_map_failed");
    const page = Array.isArray(data) ? data as JsonMap[] : [];
    const accepted = page.slice(0, INTERNAL_REF_PAGE_SIZE);
    rows.push(...accepted);
    if (rows.length > MAX_INTERNAL_REF_ROWS) throw new Error("archive_ref_map_incomplete");
    if (page.length <= INTERNAL_REF_PAGE_SIZE) return rows;
    const next = accepted.length ? clean(accepted[accepted.length - 1].ref_id) : "";
    if (!next || seen.has(next)) throw new Error("archive_ref_map_incomplete");
    seen.add(next);
    cursor = next;
  }
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  const url = clean(Deno.env.get("SUPABASE_URL"));
  const serviceKey = clean(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
  if (!url || !serviceKey) return json({ ok: false, error: "service_unavailable" }, 503);

  const auth = authorizeStaffKey(clean(req.headers.get("x-syncview-key")), [
    "admin", "smm", "creative",
  ]);
  if (!auth.ok || !auth.role) {
    return json({ ok: false, error: "unauthorized" }, staffAuthFailureStatus(auth));
  }

  let body: JsonMap;
  try {
    body = await req.json() as JsonMap;
  } catch (_error) {
    return json({ ok: false, error: "invalid_json" }, 400);
  }
  const action = clean(body.action).toLowerCase();
  const clientSlug = clean(body.client_slug);
  const audience = clean(body.audience).toLowerCase();
  if (!["list", "issue"].includes(action)) {
    return json({ ok: false, error: "invalid_action" }, 400);
  }
  if (!SAFE_ID.test(clientSlug)) return json({ ok: false, error: "invalid_client_scope" }, 400);
  if (!["internal", "client"].includes(audience)) {
    return json({ ok: false, error: "audience_required" }, 400);
  }

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
    const { data: client, error: clientError } = await supabase.from("clients")
      .select("slug,active")
      .eq("slug", clientSlug)
      .maybeSingle();
    if (clientError) throw new Error("client_scope_failed");
    // Normal archive repair is active-roster only. Unknown and inactive scope
    // share one post-auth denial; no inactive recovery mode is implemented.
    if (!client || client.active !== true) {
      return json({ ok: false, error: "forbidden" }, 403);
    }

    if (action === "list") {
      const limit = parseLimit(body.limit);
      const after = clean(body.after);
      const requestedTeam = normalizeTeam(body.team);
      if (limit == null || (after && !SAFE_ID.test(after))) {
        return json({ ok: false, error: "invalid_page" }, 400);
      }
      if (auth.role === "creative" && requestedTeam && requestedTeam !== normalizeTeam(member.team)) {
        return json({ ok: false, error: "forbidden" }, 403);
      }
      const team = auth.role === "creative" ? normalizeTeam(member.team) : requestedTeam;
      if (auth.role === "creative" && !team) return json({ ok: false, error: "forbidden" }, 403);

      let query = supabase.from("linear_archive")
        .select(ARCHIVE_LIST_SELECT, { count: "exact" })
        .eq("client_slug", clientSlug)
        .order("linear_uuid", { ascending: true })
        .limit(limit + 1);
      if (team) query = query.eq("team", team);
      if (after) query = query.gt("linear_uuid", after);
      const { data, error, count } = await query;
      if (error) throw new Error("archive_list_failed");
      const fetched = Array.isArray(data) ? data as JsonMap[] : [];
      const hasMore = fetched.length > limit;
      const issues = fetched.slice(0, limit);
      return json({
        ok: true,
        audience,
        total: Number(count || 0),
        has_more: hasMore,
        next_cursor: hasMore && issues.length ? clean(issues[issues.length - 1].linear_uuid) : null,
        issues,
      });
    }

    const linearUuid = clean(body.linear_uuid);
    if (!SAFE_ID.test(linearUuid)) return json({ ok: false, error: "invalid_issue" }, 400);
    const limit = parseLimit(body.limit);
    const commentAfter = clean(body.comment_after);
    const refAfter = clean(body.ref_after);
    const legacyOffset = body.legacy_offset == null ? 0 : Number(body.legacy_offset);
    if (limit == null
        || (commentAfter && !SAFE_ID.test(commentAfter))
        || (refAfter && !SAFE_ID.test(refAfter))
        || !Number.isInteger(legacyOffset)
        || legacyOffset < 0) {
      return json({ ok: false, error: "invalid_page" }, 400);
    }
    const { data: archiveData, error: archiveError } = await supabase.from("linear_archive")
      .select("*")
      .eq("linear_uuid", linearUuid)
      .eq("client_slug", clientSlug)
      .maybeSingle();
    // Missing and out-of-client targets share one post-auth response.
    if (archiveError) throw new Error("archive_issue_failed");
    if (!archiveData) return json({ ok: false, error: "forbidden" }, 403);
    const archive = archiveData as JsonMap;
    if (!creativeScopeAllowed(auth.role, member, archive.team)) {
      return json({ ok: false, error: "forbidden" }, 403);
    }

    let commentQuery = supabase.from("production_comments")
        .select(COMMENT_SELECT)
        .eq("linear_issue_uuid", linearUuid)
        .order("id", { ascending: true })
        .limit(limit + 1);
    let refQuery = supabase.from("linear_archive_asset_refs")
        .select(REF_PUBLIC_SELECT)
        .eq("linear_uuid", linearUuid)
        .order("ref_id", { ascending: true })
        .limit(limit + 1);
    // "internal" is the staff repair view and intentionally includes both
    // internal and client-visible records. "client" is the exact client-safe
    // subset. This is an audience view, not an ambiguous equality filter.
    if (audience === "client") {
      commentQuery = commentQuery.eq("audience", "client");
      refQuery = refQuery.eq("audience", "client");
    }
    if (commentAfter) commentQuery = commentQuery.gt("id", commentAfter);
    if (refAfter) refQuery = refQuery.gt("ref_id", refAfter);
    const [commentResult, refResult, completeRefs] = await Promise.all([
      commentQuery,
      refQuery,
      completeIssueRefs(supabase, linearUuid, audience),
    ]);
    if (commentResult.error || refResult.error) throw new Error("archive_detail_failed");
    const fetchedRefs = Array.isArray(refResult.data) ? refResult.data as JsonMap[] : [];
    const refsHasMore = fetchedRefs.length > limit;
    const refs = fetchedRefs.slice(0, limit);
    const fetchedComments = Array.isArray(commentResult.data) ? commentResult.data as JsonMap[] : [];
    const commentsHasMore = fetchedComments.length > limit;
    const commentRows = fetchedComments.slice(0, limit);
    // Rewrite the full archive record, not only raw: top-level strings are
    // equally capable of carrying a private upload reference.
    const rewrittenArchive = rewriteArchiveValue(archive, completeRefs) as JsonMap;
    const sanitizedArchive = withoutArchiveComments(rewrittenArchive) as JsonMap;
    const comments = rewriteArchiveValue(commentRows, completeRefs);
    const allLegacyComments = audience === "internal" && Array.isArray(archive.comments)
      ? archive.comments
      : [];
    const legacyPage = allLegacyComments.slice(legacyOffset, legacyOffset + limit);
    const legacyComments = rewriteArchiveValue(legacyPage, completeRefs);
    const legacyHasMore = legacyOffset + legacyPage.length < allLegacyComments.length;
    return json({
      ok: true,
      audience,
      issue: {
        ...sanitizedArchive,
        comments: legacyComments,
      },
      comments,
      asset_refs: refs.map(publicRef),
      comments_has_more: commentsHasMore,
      comments_next_cursor: commentsHasMore && commentRows.length
        ? clean(commentRows[commentRows.length - 1].id)
        : null,
      refs_has_more: refsHasMore,
      refs_next_cursor: refsHasMore && refs.length
        ? clean(refs[refs.length - 1].ref_id)
        : null,
      legacy_comments_has_more: legacyHasMore,
      legacy_comments_next_offset: legacyHasMore ? legacyOffset + legacyPage.length : null,
    });
  } catch (_error) {
    return json({ ok: false, error: "read_failed" }, 500);
  }
});
