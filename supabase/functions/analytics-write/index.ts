// analytics-write — the server-to-server door into the Supabase mirror of the
// Sheets (docs/plans/2026-09-24-sheets-to-supabase.md, Phase 1).
//
// Callers: n8n (after its existing Sheet write, once the owner approves that
// edit), the daily Clients Info copy, and scripts/sheets-mirror-backfill.js.
// Not browser-callable: no CORS surface, and every request needs the
// dedicated ANALYTICS_MIRROR_WRITE_KEY in X-Analytics-Mirror-Key, checked
// before the body is parsed or a service-role client exists.
//
// Off by default: analytics_mirror_write_enabled must be {"enabled": true}.
//
// Rows are upserted on their fingerprint (row_hash + row_occurrence; the
// Market Research Briefs tab on its own id), so a retried call or a backfill
// run after n8n started writing never double-counts. Every call leaves one
// receipt row.
//
// client_profiles: the Sheet copy is one-way for now. It is refused outright
// when client_profiles_authority says "syncview". While the Sheet is the main
// copy, a row edited in SyncView (already written to the Sheet) is skipped only
// while the Sheet still matches it, and with complete=true a client missing
// from the Sheet is archived, never deleted.
import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2.49.8";
import { timingSafeEqual } from "../_shared/staff-role-auth.ts";
import {
  DATASETS,
  MAX_BODY_BYTES,
  MAX_ROWS_PER_CALL,
  prepareRows,
  rowHashes,
  WRITE_SOURCES,
} from "../_shared/sheets-mirror.mjs";

type JsonMap = Record<string, unknown>;
const CHUNK = 500;

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}

function clean(v: unknown): string {
  return String(v == null ? "" : v).trim();
}

function requireWriteKey(req: Request): boolean {
  const secret = Deno.env.get("ANALYTICS_MIRROR_WRITE_KEY") || "";
  const given = clean(req.headers.get("x-analytics-mirror-key"));
  return secret.length >= 32 && !!given && timingSafeEqual(given, secret);
}

async function flagValue(supabase: SupabaseClient, key: string): Promise<JsonMap> {
  const { data, error } = await supabase.from("syncview_runtime_flags").select("value").eq("key", key).maybeSingle();
  if (error) throw error;
  return data && typeof data.value === "object" ? data.value as JsonMap : {};
}

// Identical rows already stored by OTHER calls, per fingerprint. A call is
// (run_id, run_part), so a retry of this call does not count its own rows.
async function priorCounts(
  supabase: SupabaseClient,
  table: string,
  hashes: string[],
  runId: string,
  runPart: number,
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  for (let i = 0; i < hashes.length; i += 200) {
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase.from(table).select("row_hash,run_id,run_part")
        .in("row_hash", hashes.slice(i, i + 200)).order("seq").range(from, from + 999);
      if (error) throw error;
      for (const r of data || []) {
        if (r.run_id === runId && r.run_part === runPart) continue;
        counts.set(r.row_hash as string, (counts.get(r.row_hash as string) || 0) + 1);
      }
      if (!data || data.length < 1000) break;
    }
  }
  return counts;
}

async function writeProfiles(supabase: SupabaseClient, records: JsonMap[], complete: boolean): Promise<number> {
  const { data: existing, error } = await supabase.from("client_profiles").select("*");
  if (error) throw error;
  // A row edited in SyncView was written to the Sheet first (client-profile-
  // write), so while the Sheet is the main copy it keeps following the Sheet:
  // it is left alone only while the Sheet still says the same thing, which
  // keeps its "edited in SyncView" marker; a later Sheet edit wins.
  const byslug = new Map((existing || []).map(r => [r.slug as string, r as JsonMap]));
  const same = (a: unknown, b: unknown) => String(a == null ? "" : a).trim() === String(b == null ? "" : b).trim();
  const unchangedEdit = (r: JsonMap) => {
    const cur = byslug.get(r.slug as string);
    if (!cur || cur.source !== "syncview" || cur.archived_at) return false;
    return Object.keys(r).filter(k => k !== "slug" && k !== "extra").every(k => same(r[k], cur[k]));
  };
  const now = new Date().toISOString();
  const rows = records
    .filter(r => !unchangedEdit(r))
    .map(r => ({ ...r, source: "sheet", sheet_synced_at: now, updated_at: now, updated_by: "sheet-copy", archived_at: null }));
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error: e } = await supabase.from("client_profiles").upsert(rows.slice(i, i + CHUNK), { onConflict: "slug" });
    if (e) throw e;
  }
  if (complete) {
    const present = new Set(records.map(r => r.slug as string));
    const gone = (existing || [])
      .filter(r => !present.has(r.slug as string))
      .map(r => r.slug as string);
    if (gone.length) {
      const { error: e } = await supabase.from("client_profiles")
        .update({ archived_at: now, updated_at: now, updated_by: "sheet-copy" })
        .in("slug", gone).is("archived_at", null);
      if (e) throw e;
    }
  }
  return rows.length;
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
  if (!requireWriteKey(req)) return json({ ok: false, error: "unauthorized" }, 401);
  const declared = Number(req.headers.get("content-length") || "0");
  if (declared > MAX_BODY_BYTES) return json({ ok: false, error: "body_too_large" }, 413);
  try {
    const raw = await req.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) return json({ ok: false, error: "body_too_large" }, 413);
    let body: JsonMap;
    try { body = JSON.parse(raw) as JsonMap; } catch (_e) { return json({ ok: false, error: "bad_json" }, 400); }

    const dataset = clean(body.dataset);
    const source = clean(body.source);
    const runId = clean(body.run_id);
    const rows = Array.isArray(body.rows) ? body.rows as JsonMap[] : null;
    const complete = body.complete === true;
    const runPart = body.run_part == null ? 0 : Number(body.run_part);
    const fullSnapshot = body.full_snapshot === true;
    if (!(dataset in DATASETS)) return json({ ok: false, error: "unknown_dataset" }, 400);
    if (!(WRITE_SOURCES as readonly string[]).includes(source)) return json({ ok: false, error: "unknown_source" }, 400);
    if (!runId || runId.length > 200) return json({ ok: false, error: "bad_run_id" }, 400);
    if (!rows) return json({ ok: false, error: "missing_rows" }, 400);
    if (!Number.isInteger(runPart) || runPart < 0 || runPart > 1_000_000) return json({ ok: false, error: "bad_run_part" }, 400);
    // Only a whole-dataset copy may claim to cover every client.
    if (fullSnapshot && (source === "n8n" || !complete)) return json({ ok: false, error: "full_snapshot_not_allowed" }, 400);
    if (rows.length > MAX_ROWS_PER_CALL) return json({ ok: false, error: "too_many_rows", max: MAX_ROWS_PER_CALL }, 413);
    if (dataset === "client_profiles" && source !== "sheet-copy" && source !== "sheet-backfill") {
      return json({ ok: false, error: "client_profiles_sheet_copy_only" }, 400);
    }

    const url = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !serviceKey) return json({ ok: false, error: "server_not_configured" }, 500);
    const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

    if ((await flagValue(supabase, "analytics_mirror_write_enabled")).enabled !== true) {
      return json({ ok: false, error: "mirror_write_disabled" }, 503);
    }
    if (dataset === "client_profiles" && clean((await flagValue(supabase, "client_profiles_authority")).source) !== "sheet") {
      return json({ ok: false, error: "client_profiles_owned_by_syncview" }, 409);
    }

    const spec = DATASETS[dataset as keyof typeof DATASETS];
    const prior = spec.key === "hash" && source !== "sheet-backfill"
      ? await priorCounts(supabase, spec.table, await rowHashes(dataset, rows), runId, runPart)
      : null;
    const { records, rejected } = await prepareRows(dataset, rows, { source, runId, runPart, priorCounts: prior });
    let written = 0;
    if (dataset === "client_profiles") {
      written = await writeProfiles(supabase, records as JsonMap[], complete && rejected.length === 0);
    } else {
      const onConflict = spec.key === "id" ? "id" : "row_hash,row_occurrence";
      for (let i = 0; i < records.length; i += CHUNK) {
        const { error } = await supabase.from(spec.table).upsert(records.slice(i, i + CHUNK), {
          onConflict,
          // A repeated row keeps its first arrival (and its place in order);
          // a brief with a known id is updated in place, as the Sheet does.
          ignoreDuplicates: spec.key !== "id",
        });
        if (error) throw error;
        written += Math.min(CHUNK, records.length - i);
      }
    }

    const slugs = [...new Set((records as JsonMap[]).map(r => (r.client_slug || r.slug) as string))].sort();
    const { error: receiptError } = await supabase.from("analytics_ingest_receipts").insert({
      dataset,
      source,
      run_id: runId,
      rows_received: rows.length,
      rows_written: written,
      client_slugs: slugs,
      run_part: runPart,
      complete: complete && rejected.length === 0,
      full_snapshot: fullSnapshot && rejected.length === 0,
    });
    if (receiptError) throw receiptError;

    return json({ ok: true, dataset, rows_received: rows.length, rows_written: written, rejected });
  } catch (e) {
    console.error("analytics-write failed", e instanceof Error ? e.message : String(e));
    return json({ ok: false, error: "write_failed" }, 500);
  }
});
