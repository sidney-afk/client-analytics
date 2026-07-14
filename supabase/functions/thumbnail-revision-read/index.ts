// Protected reader for one card's thumbnail revision comparison.
//
// Snapshot objects stay in a private Storage bucket and the raw revision table
// is service-role-only. This gateway binds every read to one exact
// surface/client/card and returns only short-lived signed image URLs plus the
// minimum timestamps needed by the comparison UI.

import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2.49.8";
import {
  matchingRoleForKey,
  timingSafeEqual,
  type StaffRoleKey,
} from "../_shared/staff-role-auth.ts";
import {
  thumbnailRevisionV2AllowsClient,
  thumbnailRevisionV2Config,
} from "../_shared/thumbnail-revisions.ts";

type JsonMap = Record<string, unknown>;
type Member = {
  id: string;
  name: string;
  role: "admin" | "smm" | "editor" | "designer";
  active: boolean;
};

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-syncview-key, x-syncview-actor, x-syncview-role, x-syncview-source, x-syncview-client-token",
  "Cache-Control": "no-store",
};

const BUCKET = "syncview-thumbnail-revisions";
const SIGNED_URL_TTL_SECONDS = 5 * 60;
const MAX_BODY_BYTES = 8 * 1024;
const SURFACE_TABLES: Record<string, string> = {
  calendar: "calendar_posts",
  samples: "sample_reviews",
};
const SAFE_SOURCE_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/;

function json(body: JsonMap, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

function clean(value: unknown): string {
  return String(value == null ? "" : value).trim();
}

function normalizeClient(value: unknown): string {
  let text = clean(value).toLowerCase();
  try {
    text = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  } catch (_error) {
    // Exact ASCII client slugs remain usable if normalization is unavailable.
  }
  text = text.replace(/^dr\.?\s+/, "");
  text = text.replace(/\s+(?:and|&)\s+/g, "&");
  return text.replace(/[^a-z0-9&]+/g, "");
}

function normalizeActor(value: unknown): string {
  let text = clean(value).toLowerCase();
  try {
    text = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  } catch (_error) {
    // Exact ASCII roster names remain usable if normalization is unavailable.
  }
  return text.replace(/[^a-z0-9@.]+/g, "");
}

function roleCompatible(keyRole: StaffRoleKey, memberRole: string): boolean {
  const role = clean(memberRole).toLowerCase();
  if (keyRole === "admin") return role === "admin";
  if (keyRole === "smm") return role === "smm";
  return role === "editor" || role === "designer";
}

async function authorize(
  supabase: SupabaseClient,
  req: Request,
  targetClient: string,
): Promise<"staff" | "client"> {
  const key = clean(req.headers.get("x-syncview-key"));
  const token = clean(req.headers.get("x-syncview-client-token"));
  if (!!key === !!token) throw new Error(key ? "ambiguous_credentials" : "credentials_required");

  if (key) {
    const keyRole = matchingRoleForKey(key);
    if (!keyRole) throw new Error("invalid_staff_key");
    const actor = normalizeActor(req.headers.get("x-syncview-actor"));
    if (!actor) throw new Error("roster_actor_required");

    const { data, error } = await supabase
      .from("team_members")
      .select("id,name,role,active")
      .eq("active", true);
    if (error) throw new Error("roster_lookup_failed");
    const matches = ((data || []) as Member[]).filter((member) =>
      normalizeActor(member.name) === actor && roleCompatible(keyRole, member.role)
    );
    if (matches.length !== 1) throw new Error("roster_actor_not_unique");
    return "staff";
  }

  const { data, error } = await supabase
    .from("client_access")
    .select("slug,review_token");
  if (error) throw new Error("client_auth_failed");
  const matches = ((data || []) as JsonMap[]).filter((row) => {
    const stored = clean(row.review_token);
    return !!stored && timingSafeEqual(token, stored);
  });
  if (matches.length === 0) throw new Error("invalid_client_token");
  if (matches.length !== 1) throw new Error("ambiguous_client_token");
  if (normalizeClient(matches[0].slug) !== targetClient) throw new Error("client_scope_mismatch");
  return "client";
}

function authFailure(error: string): Response | null {
  if (["credentials_required", "ambiguous_credentials", "invalid_staff_key", "invalid_client_token"].includes(error)) {
    return json({ ok: false, error }, 401);
  }
  if (["roster_actor_required", "roster_actor_not_unique", "ambiguous_client_token", "client_scope_mismatch", "inactive_client"].includes(error)) {
    return json({ ok: false, error }, 403);
  }
  if (["roster_lookup_failed", "client_auth_failed", "client_status_lookup_failed"].includes(error)) {
    return json({ ok: false, error: "authorization_unavailable" }, 503);
  }
  return null;
}

async function signedUrl(supabase: SupabaseClient, path: unknown): Promise<string | null> {
  const storagePath = clean(path);
  if (!storagePath) return null;
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS);
  if (error || !data?.signedUrl) throw new Error("snapshot_sign_failed");
  return clean(data.signedUrl);
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  const url = clean(Deno.env.get("SUPABASE_URL"));
  const serviceKey = clean(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
  if (!url || !serviceKey) return json({ ok: false, error: "service_unavailable" }, 503);

  let body: JsonMap;
  try {
    const declaredBytes = Number(req.headers.get("content-length") || 0);
    if (Number.isFinite(declaredBytes) && declaredBytes > MAX_BODY_BYTES) {
      return json({ ok: false, error: "payload_too_large" }, 413);
    }
    const raw = await req.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
      return json({ ok: false, error: "payload_too_large" }, 413);
    }
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return json({ ok: false, error: "invalid_json" }, 400);
    }
    body = parsed as JsonMap;
  } catch (_error) {
    return json({ ok: false, error: "invalid_json" }, 400);
  }

  const surface = clean(body.surface).toLowerCase();
  const table = SURFACE_TABLES[surface];
  const client = normalizeClient(body.client);
  const sourceId = clean(body.source_id);
  if (!table || !client || !sourceId || !SAFE_SOURCE_ID.test(sourceId)) {
    return json({ ok: false, error: "invalid_scope" }, 400);
  }

  const supabase = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const config = await thumbnailRevisionV2Config(supabase);
    if (!thumbnailRevisionV2AllowsClient(config, client)) {
      return json({ ok: false, error: "feature_disabled" }, 503);
    }

    const { data: activeClient, error: clientStatusError } = await supabase
      .from("clients")
      .select("slug")
      .eq("slug", client)
      .eq("active", true)
      .maybeSingle();
    if (clientStatusError) throw new Error("client_status_lookup_failed");
    if (!activeClient) throw new Error("inactive_client");

    const principal = await authorize(supabase, req, client);
    const { data: source, error: sourceError } = await supabase
      .from(table)
      .select("id")
      .eq("client", client)
      .eq("id", sourceId)
      .maybeSingle();
    if (sourceError) throw new Error("source_read_failed");
    if (!source) return json({ ok: false, error: "not_found" }, 404);

    const { data, error } = await supabase
      .from("thumbnail_media_revisions")
      .select("id,status,reason,requested_at,detected_at,baseline_modified_time,baseline_storage_path,latest_modified_time,latest_storage_path")
      .eq("surface", surface)
      .eq("client", client)
      .eq("source_id", sourceId)
      .in("status", ["changed", "pending"])
      .order("requested_at", { ascending: false })
      .limit(20);
    if (error) throw new Error("revision_read_failed");

    const rows = Array.isArray(data) ? data as JsonMap[] : [];
    const changed = rows.find((row) =>
      clean(row.status) === "changed" && clean(row.baseline_storage_path) && clean(row.latest_storage_path)
    );
    const pendingCycle = rows.find((row) =>
      clean(row.status) === "pending" && clean(row.reason) !== "continuous_watch"
    );
    const continuousPending = rows.find((row) =>
      clean(row.status) === "pending" && clean(row.reason) === "continuous_watch"
    );
    const changedRequestedAt = changed ? Date.parse(clean(changed.requested_at)) : NaN;
    const pendingRequestedAt = pendingCycle ? Date.parse(clean(pendingCycle.requested_at)) : NaN;
    const newerPendingCycle = !!pendingCycle && (!changed || (
      Number.isFinite(pendingRequestedAt)
      && (!Number.isFinite(changedRequestedAt) || pendingRequestedAt > changedRequestedAt)
    ));
    // The fresh continuous watcher is an implementation detail, not a new
    // user review cycle: it must not hide the pair that was just completed.
    // A genuinely newer tweak/user cycle does take precedence so an older
    // pair is never mislabeled as that cycle's Current.
    const revision = newerPendingCycle ? pendingCycle : changed || pendingCycle || continuousPending || null;
    if (!revision) {
      console.log(JSON.stringify({ fn: "thumbnail-revision-read", principal, surface, outcome: "none" }));
      return json({ ok: true, available: false, status: "none", revision: null });
    }

    const [baselineUrl, latestUrl] = await Promise.all([
      signedUrl(supabase, revision.baseline_storage_path),
      signedUrl(supabase, revision.latest_storage_path),
    ]);
    const available = clean(revision.status) === "changed" && !!baselineUrl && !!latestUrl;
    console.log(JSON.stringify({ fn: "thumbnail-revision-read", principal, surface, outcome: available ? "changed" : "pending" }));
    return json({
      ok: true,
      available,
      status: available ? "changed" : "pending",
      revision: {
        id: clean(revision.id),
        requested_at: clean(revision.requested_at) || null,
        detected_at: clean(revision.detected_at) || null,
        baseline: baselineUrl
          ? { url: baselineUrl, modified_at: clean(revision.baseline_modified_time) || null }
          : null,
        latest: latestUrl
          ? { url: latestUrl, modified_at: clean(revision.latest_modified_time) || null }
          : null,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "read_failed";
    const authResponse = authFailure(message);
    if (authResponse) return authResponse;
    if (message === "thumbnail revision flag read failed") return json({ ok: false, error: "service_unavailable" }, 503);
    return json({ ok: false, error: "read_failed" }, 500);
  }
});
