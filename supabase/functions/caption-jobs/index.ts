// Supabase Edge Function: caption-jobs
//
// Replaces the n8n webhooks `caption-job-status` (GET) and `caption-job-update` (POST) that track a caption
// generation's progress (docs/plans/2026-09-30-n8n-exit-phase-2.md, step B). The AI generation itself stays on
// n8n; it writes progress here and the Calendar page reads it here.
//
//   GET  ?client=<slug>[&postId=..][&jobId=..]   { ok, jobs: [{ jobId, client, postId, status, stage, caption,
//                                                   error, cancel_requested, started_at, updated_at }] }
//   POST { jobId, client?, postId?, status?, stage?, caption?, error?, cancel_requested?, started_at? }
//                                                 { ok: true }   (only the keys sent are written)
//
// Auth: a staff role key (X-Syncview-Key), the same as the other staff functions. The n8n workflow sends it too.
//
// Required env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, a staff role key secret (ROLE_KEY_ADMIN / ROLE_KEY_SMM /
// ROLE_KEY_CREATIVE).

import { createClient } from "npm:@supabase/supabase-js@2.49.8";
import { authorizeStaffKey, staffAuthFailureStatus } from "../_shared/staff-role-auth.ts";
import { buildPatch, pruneCutoffIso, selectJobs, STATUS_LIMIT } from "./jobs.mjs";

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-syncview-key, x-syncview-actor, x-syncview-role, x-syncview-source",
  "Cache-Control": "no-store",
};

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}
const clean = (v: unknown): string => String(v == null ? "" : v).trim();

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "GET" && req.method !== "POST") return json({ ok: false, error: "method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!supabaseUrl || !serviceKey) return json({ ok: false, error: "server not configured" }, 500);

  const auth = authorizeStaffKey(clean(req.headers.get("x-syncview-key")), ["admin", "smm", "creative"]);
  if (!auth.ok) return json({ ok: false, error: "unauthorized" }, staffAuthFailureStatus(auth));

  const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  try {
    if (req.method === "GET") {
      const url = new URL(req.url);
      const client = clean(url.searchParams.get("client"));
      if (!client) return json({ ok: true, jobs: [] });
      const { data, error } = await db
        .from("caption_jobs")
        .select("job_id,client,post_id,status,stage,caption,error,cancel_requested,started_at,updated_at")
        .eq("client", client)
        .order("updated_at", { ascending: false })
        .limit(STATUS_LIMIT);
      if (error) throw error;
      const jobs = selectJobs(data || [], { postId: url.searchParams.get("postId"), jobId: url.searchParams.get("jobId") }, Date.now());
      return json({ ok: true, jobs });
    }

    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const built = buildPatch(body, new Date().toISOString());
    if (!built.ok) return json({ ok: false, error: built.error }, 400);
    const { error } = await db.from("caption_jobs").upsert(built.patch, { onConflict: "job_id" });
    if (error) throw error;
    // Old rows are dropped after the answer is decided; a failure here never fails the save.
    await db.from("caption_jobs").delete().lt("updated_at", pruneCutoffIso(Date.now())).then(() => {}, () => {});
    return json({ ok: true });
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
