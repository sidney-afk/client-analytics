// Supabase Edge Function: calendar-card-write
//
// The native writer for a Calendar card's own fields, replacing the frozen
// calendar-upsert (docs/ops/CALENDAR_UPSERT_RETIREMENT_PLAN.md, step 1). Same
// request ({ client, post, comments_base_at }) and same answers ({ ok, post } or
// { ok:false, conflict?, error }) as calendar-upsert, so no caller changes shape.
// The guards and the event ledger are in logic.mjs, ported from the live writer.
//
// What is different from calendar-upsert:
//   * A staff key is required (authorizeBrowserWrite). A client review-link
//     token is refused for now: client links move last, with calendar-upsert
//     kept as their fallback (owner decision, 2026-10-16).
//   * The function reads its own roster switch, calendar_card_write_clients,
//     and refuses a client it does not list. A page that routes wrongly is
//     refused out loud instead of writing.
//   * Its log line says fn: calendar-card-write, so the two writers' traffic
//     can be told apart while both run.
//   * A save that carries a caption tells the caption history trigger how the
//     caption changed (typed, redo with its note, restored), as a header on its
//     own write (captionOriginHeader in logic.mjs).
//
// Required env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and the staff role
// key secrets the shared write auth reads.

import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2.49.8";
import {
  authorizeBrowserWrite,
  browserWriteAuthResponse,
  normalizeBrowserWriteClient,
} from "../_shared/browser-write-auth.ts";
import {
  captureGraphicTweakBaseline,
  scanGraphicTweakResolution,
  shouldScanGraphicTweakResolution,
  thumbnailRevisionV2AllowsClient,
  thumbnailRevisionV2Config,
} from "../_shared/thumbnail-revisions.ts";
import {
  applyGuards,
  buildEvents,
  buildIncoming,
  CAPTION_ORIGIN_HEADER,
  captionOriginHeader,
  clean,
  commentRpcArgs,
  FLAG_KEY,
  has,
  ledgerSource,
  mintThumbRev,
  pastWriteDeadline,
  responsePayload,
  rosterAllows,
  scalarPayloadForExisting,
  stripPrivate,
  updatePayload,
} from "./logic.mjs";

const FN = "calendar-card-write";

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-syncview-key, x-syncview-actor, x-syncview-role, x-syncview-source, x-syncview-client-token",
  "Access-Control-Max-Age": "7200",
  "Cache-Control": "no-store",
};

type JsonMap = Record<string, unknown>;
type Row = Record<string, string | null>;
type ExistingRow = Record<string, unknown>;
type Actor = { actor: string | null; role: string | null; source: string };

class Refusal extends Error {
  constructor(readonly status: number, readonly code: string) {
    super(code);
  }
}

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

function isoNow(): string {
  return new Date().toISOString();
}

function waitUntil(p: Promise<unknown>): void {
  const edge = (globalThis as unknown as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;
  try {
    if (edge && typeof edge.waitUntil === "function") edge.waitUntil(p.catch(() => null));
    else p.catch(() => null);
  } catch (_e) {
    p.catch(() => null);
  }
}

/* The ledger keeps the live writer's attribution: the display name and role the
   page sends, which the staff key has just vouched for. */
function ledgerActor(req: Request): Actor {
  return {
    actor: clean(req.headers.get("x-syncview-actor")) || null,
    role: clean(req.headers.get("x-syncview-role")) || null,
    source: ledgerSource(req.headers.get("x-syncview-source")),
  };
}

async function assertRosterAllows(supabase: SupabaseClient, client: string): Promise<void> {
  const { data, error } = await supabase.from("syncview_runtime_flags")
    .select("value")
    .eq("key", FLAG_KEY)
    .maybeSingle();
  if (error) throw new Refusal(503, "switch_unreadable");
  if (!rosterAllows(data && (data as JsonMap).value, client)) throw new Refusal(403, "client_not_enabled");
}

async function readExisting(supabase: SupabaseClient, client: string, id: string): Promise<{ row: ExistingRow; failed: boolean }> {
  const { data, error } = await supabase.from("calendar_posts")
    .select("*")
    .eq("client", client)
    .eq("id", id)
    .maybeSingle();
  if (error) return { row: {}, failed: true };
  return { row: (data || {}) as ExistingRow, failed: false };
}

async function readLinkTwins(supabase: SupabaseClient, client: string, incomingLink: string): Promise<ExistingRow[]> {
  const link = incomingLink.trim() || "__no_link__";
  const { data, error } = await supabase.from("calendar_posts")
    .select("*")
    .eq("client", client)
    .eq("linear_issue_id", link);
  if (error || !Array.isArray(data)) return [];
  return data as ExistingRow[];
}

async function writeCalendarRow(supabase: SupabaseClient, client: string, row: Row, existsAlready: boolean): Promise<void> {
  if (existsAlready) {
    const args = commentRpcArgs(client, row);
    if (args) {
      const { error } = await supabase.rpc("calendar_merge_comments", args);
      if (error) throw new Error("comment merge failed");
    }
    const patch = updatePayload(client, scalarPayloadForExisting(row));
    const { error } = await supabase.from("calendar_posts")
      .update(patch)
      .eq("client", client)
      .eq("id", row.id);
    if (error) throw new Error("calendar update failed");
  } else {
    const insert = updatePayload(client, row);
    const { error } = await supabase.from("calendar_posts").insert(insert);
    if (error) throw new Error("calendar create failed");
  }
}

async function insertEvents(supabase: SupabaseClient, events: JsonMap[]): Promise<void> {
  if (!events.length) return;
  const { error } = await supabase.from("calendar_post_events").insert(events);
  if (error) throw error;
}

Deno.serve(async (req: Request) => {
  const started = Date.now();
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "method" }, 405);

  let body: JsonMap;
  try { body = JSON.parse(await req.text()) as JsonMap; }
  catch (_e) { return json({ ok: false, error: "invalid body" }, 400); }

  const now = isoNow();
  const actor = ledgerActor(req);
  let client = "";
  let id = "";
  let outcome = "error";

  // Caption history: how this save changed the caption rides on this function's own writes (logic.mjs).
  const captionOrigin = captionOriginHeader(body, actor);
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    {
      auth: { persistSession: false, autoRefreshToken: false },
      ...(captionOrigin ? { global: { headers: { [CAPTION_ORIGIN_HEADER]: captionOrigin } } } : {}),
    },
  );

  try {
    const built = buildIncoming(body, now, normalizeBrowserWriteClient) as { client: string; row: JsonMap };
    client = built.client;
    id = clean(built.row.id);
    const principal = await authorizeBrowserWrite(supabase, req, client, FN);
    if (principal.kind !== "staff") throw new Refusal(403, "client_path_not_enabled");
    await assertRosterAllows(supabase, client);

    const existingRead = await readExisting(supabase, client, id);
    const incomingLink = has(built.row, "linear_issue_id") ? clean(built.row.linear_issue_id) : "";
    const twins = await readLinkTwins(supabase, client, incomingLink);
    const guarded = applyGuards(built.row, existingRead.row, twins, existingRead.failed, Date.now()) as JsonMap;
    if (guarded._conflict === true) {
      outcome = guarded.conflict ? "conflict" : "read_failure";
      return json(guarded);
    }
    // Presence is intentional: rewriting the same Drive link is the signal used
    // when the file behind it changed. Do not reduce this to a value comparison.
    const mints = has(built.row, "thumbnail_url") || has(built.row, "asset_url") ||
      shouldScanGraphicTweakResolution(built.row, guarded, existingRead.row);
    if (mints) {
      let v2Enabled = false;
      try {
        v2Enabled = thumbnailRevisionV2AllowsClient(await thumbnailRevisionV2Config(supabase), client);
      } catch (error) {
        console.warn("calendar-card-write thumbnail_revision_v2 flag unavailable", error);
      }
      if (v2Enabled) guarded.thumb_rev = mintThumbRev(existingRead.row.thumb_rev, now);
    }
    const post = stripPrivate(guarded) as Row;
    const existsAlready = !!(existingRead.row && existingRead.row.id);
    // Too slow to still be wanted: the page has given up or is about to. Nothing is written (logic.mjs).
    if (pastWriteDeadline(started, Date.now())) throw new Refusal(503, "too_late");
    await writeCalendarRow(supabase, client, post, existsAlready);

    const shared = {
      supabase,
      surface: "calendar" as const,
      client,
      sourceId: id,
      incoming: post,
      patch: built.row,
      existing: existingRead.row,
      actor,
      now: isoNow(),
    };
    waitUntil(captureGraphicTweakBaseline(shared));
    waitUntil(scanGraphicTweakResolution({ ...shared, now: isoNow() }));

    const events = buildEvents(client, post, built.row, existingRead.row, actor, isoNow());
    waitUntil(insertEvents(supabase, events));

    outcome = "ok";
    return json({ ok: true, post: responsePayload(post) });
  } catch (e) {
    outcome = "error";
    if (e instanceof Refusal) {
      outcome = "refused";
      return json({ ok: false, error: e.code }, e.status);
    }
    const auth = browserWriteAuthResponse(e);
    if (auth) {
      outcome = "denied";
      return json({ ok: false, error: auth.code }, auth.status);
    }
    const msg = e instanceof Error ? e.message : "request failed";
    const status = msg.indexOf("phantom-row guard") === 0 ? 400 : 500;
    return json({ ok: false, error: msg }, status);
  } finally {
    console.log(JSON.stringify({
      fn: FN,
      action: "upsert",
      client,
      id,
      actor: actor.actor,
      role: actor.role,
      source: actor.source,
      outcome,
      ms: Date.now() - started,
    }));
  }
});
