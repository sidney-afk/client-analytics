// Supabase Edge Function: thumbnail-revision-scan
//
// Scans pending thumbnail_media_revisions rows and records an "after" snapshot
// when the underlying Google Drive file revision changes.
//
// Optional env:
//   THUMBNAIL_REVISION_SCAN_KEY - if set, callers must send X-Syncview-Key.

import { createClient } from "npm:@supabase/supabase-js@2.49.8";
import { scanPendingThumbnailRevisions } from "../_shared/thumbnail-revisions.ts";

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-syncview-key",
  "Cache-Control": "no-store",
};

type JsonMap = Record<string, unknown>;

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
  if (key && clean(req.headers.get("x-syncview-key")) !== key) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }

  let body: JsonMap = {};
  try { body = JSON.parse(await req.text() || "{}") as JsonMap; }
  catch (_e) { return json({ ok: false, error: "invalid body" }, 400); }

  const surface = clean(body.surface);
  if (surface && surface !== "calendar" && surface !== "samples") {
    return json({ ok: false, error: "surface" }, 400);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  try {
    const result = await scanPendingThumbnailRevisions({
      supabase,
      surface,
      client: clean(body.client),
      sourceId: clean(body.source_id || body.id),
      limit: Number(body.limit || 25),
    });
    return json({ ok: true, ...result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "scan failed";
    return json({ ok: false, error: msg }, 500);
  }
});
