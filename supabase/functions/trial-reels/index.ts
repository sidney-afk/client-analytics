// Supabase Edge Function: trial-reels
//
// One video, several versions (A to G) that differ in the text hook, each posted as an Instagram trial reel, the
// winner kept after 24 h. This is the SyncView half: the card's switch, each version's Frame.io link, each
// reviewer's answer, the trial timer and the winner. Plan: docs/features/TRIAL_REELS_PLAN.md (approved as #2352).
// The rules are in logic.mjs.
//
// What it never does:
//   * write the card's status: the page calls today's saves (Approve to Kasper, Kasper's approve, the client's
//     approve) when a stage is finished, so every existing rule, notification and sync runs unchanged;
//   * write the card's one link (deliverables.file_url and, through the existing projection, calendar_posts.asset_url):
//     that stays today's Production attach (production-write "attachment"). For the version that is on the card it
//     only checks that the card already carries the same link, then copies it;
//   * touch any Section 4 function, the drift robot or the projection triggers.
//
// Who may call: a staff key for everything; a client review link for read and answer only, with its review token
// when the page has one and without one when it has none (owner, Q5: the client link works like today), and only for
// a client that the page switch trial_reels_pages lists (today: the test client only).
//
// Required env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and the staff role key secrets the shared write auth reads.

import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2.49.8";
import {
  authorizeBrowserWrite,
  BrowserWriteAuthError,
  browserWriteAuthResponse,
  normalizeBrowserWriteClient,
} from "../_shared/browser-write-auth.ts";
import {
  ACTIONS,
  answerPatches,
  clean,
  CLIENT_ACTIONS,
  dropPatch,
  FLAG_KEY,
  flagAllows,
  LETTERS,
  ledgerRows,
  linkPatch,
  readShape,
  trialPatches,
  winnerPatches,
} from "./logic.mjs";

const FN = "trial-reels";

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-syncview-key, x-syncview-actor, x-syncview-role, x-syncview-source, x-syncview-client-token",
  "Access-Control-Max-Age": "7200",
  "Cache-Control": "no-store",
};

type JsonMap = Record<string, unknown>;
type Version = Record<string, unknown> & { id: string; letter: string; status: string };
type Change = { id: string; letter: string; from: string; patch: JsonMap };
type Principal = { kind: "staff" | "client"; actor: string; role: string; source: string };

class Refusal extends Error {
  constructor(readonly status: number, readonly code: string) {
    super(code);
  }
}

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

async function assertSwitchOn(supabase: SupabaseClient, client: string): Promise<void> {
  const { data, error } = await supabase.from("syncview_runtime_flags").select("value").eq("key", FLAG_KEY).maybeSingle();
  if (error) throw new Refusal(503, "switch_unreadable");
  if (!flagAllows(data && (data as JsonMap).value, client)) throw new Refusal(403, "not_enabled");
}

/* Staff key, or a client review token, through the shared auth. A client link with no token at all is let through
   for read and answer only (owner, Q5), and only because the switch check below names its client. */
async function principalFor(supabase: SupabaseClient, req: Request, client: string, action: string): Promise<Principal> {
  try {
    return await authorizeBrowserWrite(supabase, req, client, FN) as Principal;
  } catch (e) {
    if (e instanceof BrowserWriteAuthError && e.code === "credentials_required" && CLIENT_ACTIONS.includes(action)) {
      return { kind: "client", actor: "client:" + client, role: "client", source: FN };
    }
    throw e;
  }
}

async function readCard(supabase: SupabaseClient, client: string, postId: string): Promise<JsonMap> {
  const { data, error } = await supabase.from("calendar_posts")
    .select("id,client,video_status,asset_url,video_deliverable_id")
    .eq("client", client).eq("id", postId).maybeSingle();
  if (error) throw new Refusal(503, "card_unreadable");
  if (!data) throw new Refusal(404, "card_not_found");
  return data as JsonMap;
}

/* The card's one link, as Production shows it today: the video sub-issue's file_url, or the card's own link when the
   sub-issue has none or there is no sub-issue. */
async function mainLink(supabase: SupabaseClient, card: JsonMap): Promise<string> {
  const deliverableId = clean(card.video_deliverable_id, 80);
  if (deliverableId) {
    const { data, error } = await supabase.from("deliverables").select("file_url").eq("id", deliverableId).maybeSingle();
    if (error) throw new Refusal(503, "deliverable_unreadable");
    const fileUrl = clean(data && (data as JsonMap).file_url, 2048);
    if (fileUrl) return fileUrl;
  }
  return clean(card.asset_url, 2048);
}

async function readVersions(supabase: SupabaseClient, client: string, postId: string): Promise<Version[]> {
  const { data, error } = await supabase.from("studio_trial_versions").select("*").eq("post_id", postId).ilike("client", client);
  if (error) throw new Refusal(503, "versions_unreadable");
  return ((data || []) as Version[]).filter((v) => LETTERS.includes(String(v.letter)));
}

async function readSwitch(supabase: SupabaseClient, client: string, postId: string): Promise<JsonMap | null> {
  const { data, error } = await supabase.from("trial_reel_cards").select("*").eq("client", client).eq("post_id", postId).maybeSingle();
  if (error) throw new Refusal(503, "switch_row_unreadable");
  return (data || null) as JsonMap | null;
}

/* Each patch is written only if the row has not changed since it was read (updated_at), so the studio's writes and
   ours can never silently undo each other. A row that moved answers conflict and nothing more is written. */
async function applyChanges(supabase: SupabaseClient, versions: Version[], changes: Change[], now: string): Promise<void> {
  for (const c of changes) {
    const before = versions.find((v) => v.id === c.id);
    let q = supabase.from("studio_trial_versions").update({ ...c.patch, updated_at: now }).eq("id", c.id);
    if (before && before.updated_at) q = q.eq("updated_at", before.updated_at as string);
    const { data, error } = await q.select("id");
    if (error) throw new Refusal(500, "write_failed");
    if (!Array.isArray(data) || data.length !== 1) throw new Refusal(409, "conflict");
  }
}

Deno.serve(async (req: Request) => {
  const started = Date.now();
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "method" }, 405);

  let body: JsonMap;
  try { body = JSON.parse(await req.text()) as JsonMap; }
  catch (_e) { return json({ ok: false, error: "invalid body" }, 400); }

  const action = clean(body.action, 40).toLowerCase();
  const client = normalizeBrowserWriteClient(body.client);
  const postId = clean(body.post_id, 120);
  let outcome = "error";
  let principal: Principal | null = null;
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    if (!ACTIONS.includes(action)) throw new Refusal(400, "unknown_action");
    if (!client) throw new Refusal(400, "invalid_client");
    if (!postId) throw new Refusal(400, "post_id_required");
    principal = await principalFor(supabase, req, client, action);
    if (principal.kind === "client" && !CLIENT_ACTIONS.includes(action)) throw new Refusal(403, "staff_only");
    await assertSwitchOn(supabase, client);

    const card = await readCard(supabase, client, postId);
    const sw = await readSwitch(supabase, client, postId);
    const now = new Date().toISOString();

    if (action === "switch_set") {
      const enabled = body.enabled === true;
      const row = { client, post_id: postId, enabled, updated_at: now, updated_by: principal.actor };
      const { error } = sw
        ? await supabase.from("trial_reel_cards").update(row).eq("client", client).eq("post_id", postId)
        : await supabase.from("trial_reel_cards").insert({ ...row, created_at: now });
      if (error) throw new Refusal(500, "write_failed");
      await supabase.from("calendar_post_events").insert({
        client, post_id: postId, ts: now, actor: principal.actor, role: principal.role, action: enabled ? "trial_on" : "trial_off",
        component: "video", source: FN, payload: null,
      });
      outcome = "ok";
      return json({ ok: true, enabled });
    }

    // Everything else is about the versions of a card whose switch is on.
    if (!sw || sw.enabled !== true) throw new Refusal(409, "trial_reels_off");
    const versions = await readVersions(supabase, client, postId);
    const link = await mainLink(supabase, card);
    const shape = () => readShape(versions, { client: principal!.kind === "client", mainLink: link, cardStatus: card.video_status });

    if (action === "read") {
      outcome = "ok";
      return json({ ok: true, enabled: true, winner_letter: sw.winner_letter || null, ...shape() });
    }

    const letter = clean(body.letter, 1).toUpperCase();
    let changes: Change[] = [];
    let extra: JsonMap = {};

    if (action === "answer") {
      // A client link answers only as the client; staff say which stage they answer for.
      const stage = principal.kind === "client" ? "client" : clean(body.stage, 10).toLowerCase();
      const r = answerPatches(versions, { stage, kind: clean(body.kind, 20).toLowerCase(), letter, note: body.note }, now);
      if (r.error) throw new Refusal(400, r.error);
      changes = r.patches as Change[];
    } else if (action === "version_link_set") {
      const r = linkPatch(versions, letter, body.link, link);
      if (r.error) throw new Refusal(r.error === "attach_first" ? 409 : 400, r.error);
      const v = versions.find((x) => x.letter === letter)!;
      if (r.patch) changes = [{ id: v.id, letter, from: v.status, patch: r.patch }];
      extra = { restarted: !!r.restarted };
    } else if (action === "version_drop" || action === "version_restore") {
      const r = dropPatch(versions, letter, action === "version_restore");
      if (r.error) throw new Refusal(400, r.error);
      const v = versions.find((x) => x.letter === letter)!;
      if (r.patch) changes = [{ id: v.id, letter, from: v.status, patch: r.patch }];
    } else if (action === "trial_start") {
      const r = trialPatches(versions, Date.now());
      if (r.error) throw new Refusal(400, r.error);
      changes = r.patches as Change[];
    } else if (action === "winner_set") {
      const r = winnerPatches(versions, letter, link);
      if (r.error) throw new Refusal(r.error === "attach_first" ? 409 : 400, r.error);
      changes = r.patches as Change[];
    }

    await applyChanges(supabase, versions, changes, now);
    if (action === "winner_set") {
      const { error } = await supabase.from("trial_reel_cards").update({ winner_letter: letter, updated_at: now, updated_by: principal.actor })
        .eq("client", client).eq("post_id", postId);
      if (error) throw new Refusal(500, "write_failed");
    }
    if (changes.length) {
      const rows = ledgerRows(client, postId, changes, principal, now, action === "answer" ? clean(body.kind, 20).toLowerCase() : action);
      const { error } = await supabase.from("calendar_post_events").insert(rows);
      if (error) console.warn(JSON.stringify({ fn: FN, ledger: "insert_failed", post_id: postId }));
    }
    // Read back what the page should now show.
    const after = await readVersions(supabase, client, postId);
    const fresh = readShape(after, { client: principal.kind === "client", mainLink: link, cardStatus: card.video_status });
    outcome = "ok";
    return json({ ok: true, changed: changes.map((c) => c.letter), ...extra, ...fresh });
  } catch (e) {
    if (e instanceof Refusal) {
      outcome = "refused:" + e.code;
      return json({ ok: false, error: e.code }, e.status);
    }
    const auth = browserWriteAuthResponse(e);
    if (auth) {
      outcome = "denied:" + auth.code;
      return json({ ok: false, error: auth.code }, auth.status);
    }
    outcome = "error";
    return json({ ok: false, error: "request_failed" }, 500);
  } finally {
    console.log(JSON.stringify({ fn: FN, action, client, post_id: postId, who: principal ? principal.role : null, outcome, ms: Date.now() - started }));
  }
});
