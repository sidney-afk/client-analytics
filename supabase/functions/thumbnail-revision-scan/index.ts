// Supabase Edge Function: thumbnail-revision-scan
//
// Scans pending thumbnail_media_revisions rows and records an "after" snapshot
// when the underlying Google Drive file revision changes.
//
// Required env:
//   THUMBNAIL_REVISION_SCAN_KEY - callers must send it as
//   X-Syncview-Scheduler-Signature. Staff role keys never authorize this job.

import { createClient } from "npm:@supabase/supabase-js@2.49.8";
import {
  normalizeThumbnailRevisionClient,
  scanPendingThumbnailRevisions,
  thumbnailRevisionV2AllowsClient,
  thumbnailRevisionV2Config,
} from "../_shared/thumbnail-revisions.ts";
import { timingSafeEqual } from "../_shared/staff-role-auth.ts";

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-syncview-scheduler-signature",
  "Cache-Control": "no-store",
};

type JsonMap = Record<string, unknown>;
const MAX_BODY_BYTES = 8 * 1024;
const MAX_LIMIT = 50;

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

function clean(v: unknown): string {
  return String(v == null ? "" : v).trim();
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "method" }, 405);

  const key = clean(Deno.env.get("THUMBNAIL_REVISION_SCAN_KEY"));
  if (!key) return json({ ok: false, error: "server_not_configured" }, 503);
  if (!timingSafeEqual(clean(req.headers.get("x-syncview-scheduler-signature")), key)) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }

  let body: JsonMap = {};
  try {
    const declaredBytes = Number(req.headers.get("content-length") || 0);
    if (Number.isFinite(declaredBytes) && declaredBytes > MAX_BODY_BYTES) {
      return json({ ok: false, error: "payload_too_large" }, 413);
    }
    const raw = await req.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
      return json({ ok: false, error: "payload_too_large" }, 413);
    }
    const parsed = JSON.parse(raw || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return json({ ok: false, error: "invalid body" }, 400);
    }
    body = parsed as JsonMap;
  }
  catch (_e) { return json({ ok: false, error: "invalid body" }, 400); }

  const surface = clean(body.surface);
  if (surface && surface !== "calendar" && surface !== "samples") {
    return json({ ok: false, error: "surface" }, 400);
  }
  const limit = body.limit == null || body.limit === "" ? 25 : Number(body.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    return json({ ok: false, error: "limit" }, 400);
  }
  const client = normalizeThumbnailRevisionClient(body.client);
  const sourceId = clean(body.source_id || body.id);
  if (sourceId && !client) return json({ ok: false, error: "client_scope_required" }, 400);
  const rawCheckedBefore = clean(body.checked_before);
  const parsedCheckedBefore = rawCheckedBefore ? Date.parse(rawCheckedBefore) : Date.now();
  if (!Number.isFinite(parsedCheckedBefore)) {
    return json({ ok: false, error: "checked_before" }, 400);
  }
  const checkedBefore = new Date(parsedCheckedBefore).toISOString();

  const url = clean(Deno.env.get("SUPABASE_URL"));
  const serviceKey = clean(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
  if (!url || !serviceKey) return json({ ok: false, error: "server_not_configured" }, 503);

  const supabase = createClient(
    url,
    serviceKey,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  try {
    const config = await thumbnailRevisionV2Config(supabase);
    if (config.mode === "off") return json({ ok: false, error: "feature_disabled" }, 503);
    if ((config.mode === "test" && !client)
      || (client && !thumbnailRevisionV2AllowsClient(config, client))) {
      return json({ ok: false, error: "client_scope_forbidden" }, 403);
    }
    const result = await scanPendingThumbnailRevisions({
      supabase,
      surface,
      client,
      sourceId,
      limit,
      checkedBefore,
    });
    return json({
      ok: true,
      checked: Number(result.checked || 0),
      changed: Number(result.changed || 0),
      unchanged: Number(result.unchanged || 0),
      failed: Number(result.failed || 0),
      skipped: Number(result.skipped || 0),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "scan failed";
    if (msg === "thumbnail revision flag read failed") {
      return json({ ok: false, error: "service_unavailable" }, 503);
    }
    return json({ ok: false, error: "scan_failed" }, 500);
  }
});
