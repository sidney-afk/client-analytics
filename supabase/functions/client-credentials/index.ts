// Supabase Edge Function: client-credentials
//
// Service-role gateway for SyncView's Client Credentials UI. The public anon key
// has no access to public.client_credentials or public.client_credential_events;
// every browser/n8n request must pass X-Syncview-Key. Admin and SMM role keys
// are accepted; the historical credentials/onboarding passphrases remain valid
// during migration. Do not log request bodies here: they can contain client
// passwords and old password history.
//
// Deploy:
//   Role secrets are shared with key-verify; keep CREDENTIALS_STAFF_KEY and
//   ONBOARDING_STAFF_KEY unchanged until the documented retirement gate.
//   supabase functions deploy client-credentials --project-ref uzltbbrjidmjwwfakwve --no-verify-jwt

import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";
import { authorizeStaffKey, staffAuthFailureStatus } from "../_shared/staff-role-auth.ts";

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-syncview-key",
  "Cache-Control": "no-store",
};

const PRIVATE_IP = /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.|::1$|fc|fd|localhost)/i;
const ALLOWED_STATUS = new Set(["active", "needs_review", "archived"]);
const ALLOWED_SOURCE = new Set(["manual", "onboarding", "bulk_import"]);
const PLATFORMS = ["instagram", "tiktok", "facebook", "linkedin", "youtube", "x", "twitter", "threads", "pinterest", "website"];

type JsonMap = Record<string, unknown>;
type EventDraft = {
  credential_id?: string | null;
  client_slug?: string | null;
  client_name?: string | null;
  actor?: string | null;
  actor_role?: string | null;
  action: string;
  field?: string | null;
  old_value?: string | null;
  new_value?: string | null;
  ip?: string | null;
  country?: string | null;
  payload?: unknown;
};

type Actor = { name: string; role: string };

type ParsedImport = {
  line: number;
  raw: string;
  client_name: string;
  client_slug: string;
  platform: string;
  label: string;
  handle: string;
  password: string;
  notes: string;
  status: string;
  flags: string[];
};

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

function clean(v: unknown): string {
  return String(v == null ? "" : v).trim();
}

function nullable(v: unknown): string | null {
  const s = clean(v);
  return s ? s : null;
}

function normalizeClient(s: unknown): string {
  let t = clean(s).toLowerCase();
  try { t = t.normalize("NFD").replace(/[\u0300-\u036f]/g, ""); } catch (_e) { /* old runtime fallback */ }
  t = t.replace(/^dr\.?\s+/, "");
  t = t.replace(/\s+(?:and|&)\s+/g, "&");
  return t.replace(/[^a-z0-9&]+/g, "");
}

function normalizePlatform(s: unknown): string {
  let t = clean(s).toLowerCase();
  t = t.replace(/^@+/, "").replace(/\s+/g, "_").replace(/[^a-z0-9_-]/g, "");
  if (t === "ig" || t === "insta") t = "instagram";
  if (t === "tik_tok" || t === "tt") t = "tiktok";
  if (t === "fb") t = "facebook";
  if (t === "yt") t = "youtube";
  return t || "account";
}

function safeStatus(s: unknown): string {
  const v = clean(s) || "active";
  return ALLOWED_STATUS.has(v) ? v : "active";
}

function safeSource(s: unknown): string {
  const v = clean(s) || "manual";
  return ALLOWED_SOURCE.has(v) ? v : "manual";
}

function actorFrom(body: JsonMap): Actor {
  const raw = (body.actor && typeof body.actor === "object") ? body.actor as JsonMap : body;
  const name = clean(raw.name || raw.actor || raw.actor_name) || "Synchro Social";
  const role = clean(raw.role || raw.actor_role) || "staff";
  return { name, role };
}

function ipFrom(req: Request): string | null {
  const h = req.headers;
  const chain = h.get("x-forwarded-for") || h.get("x-real-ip") || h.get("cf-connecting-ip") || "";
  return nullable(chain.split(",")[0]);
}

function countryFrom(req: Request): string | null {
  const h = req.headers;
  const v = h.get("cf-ipcountry") || h.get("x-vercel-ip-country") || h.get("x-country-code") || "";
  const c = clean(v).toUpperCase();
  return /^[A-Z]{2}$/.test(c) ? c : null;
}

function waitUntil(p: Promise<unknown>): void {
  const edge = (globalThis as unknown as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;
  try {
    if (edge && typeof edge.waitUntil === "function") edge.waitUntil(p.catch(() => null));
    else p.catch(() => null);
  } catch (_e) { p.catch(() => null); }
}

async function lookupCountry(ip: string | null): Promise<string | null> {
  if (!ip || PRIVATE_IP.test(ip)) return null;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 1200);
  try {
    const resp = await fetch("https://ipapi.co/" + encodeURIComponent(ip) + "/country/", { signal: ctrl.signal });
    if (!resp.ok) return null;
    const txt = (await resp.text()).trim().toUpperCase();
    return /^[A-Z]{2}$/.test(txt) ? txt : null;
  } catch (_e) {
    return null;
  } finally {
    clearTimeout(t);
  }
}

async function hydrateCountry(supabase: SupabaseClient, eventIds: string[], ip: string | null, currentCountry: string | null): Promise<void> {
  if (currentCountry || !eventIds.length) return;
  const country = await lookupCountry(ip);
  if (!country) return;
  await supabase.from("client_credential_events").update({ country }).in("id", eventIds);
}

async function insertEvents(supabase: SupabaseClient, drafts: EventDraft[], req: Request, actor: Actor): Promise<string[]> {
  if (!drafts.length) return [];
  const ip = ipFrom(req);
  const country = countryFrom(req);
  const rows = drafts.map(e => ({
    credential_id: e.credential_id || null,
    client_slug: e.client_slug || null,
    client_name: e.client_name || null,
    actor: e.actor || actor.name,
    actor_role: e.actor_role || actor.role,
    action: e.action,
    field: e.field || null,
    old_value: e.old_value == null ? null : String(e.old_value),
    new_value: e.new_value == null ? null : String(e.new_value),
    ip,
    country,
    payload: e.payload == null ? null : e.payload,
  }));
  const { data, error } = await supabase.from("client_credential_events").insert(rows).select("id");
  if (error) throw new Error("audit insert failed");
  const ids = (data || []).map((r: { id: string }) => r.id).filter(Boolean);
  if (ids.length && !country) waitUntil(hydrateCountry(supabase, ids, ip, country));
  return ids;
}

async function touchRev(supabase: SupabaseClient, slug: string | null | undefined, name: string | null | undefined): Promise<void> {
  if (!slug) return;
  const { data } = await supabase.from("client_credentials_rev").select("rev").eq("client_slug", slug).maybeSingle();
  const rev = Number((data as { rev?: number } | null)?.rev || 0) + 1;
  await supabase.from("client_credentials_rev").upsert({
    client_slug: slug,
    client_name: name || slug,
    rev,
    updated_at: new Date().toISOString(),
  }, { onConflict: "client_slug" });
}

function materializeCredential(raw: JsonMap, actor: Actor, fallbackSource = "manual"): JsonMap {
  const clientName = clean(raw.client_name || raw.client || raw.name);
  let slug = clean(raw.client_slug || raw.slug);
  if (!slug && clientName) slug = normalizeClient(clientName);
  const platform = normalizePlatform(raw.platform);
  const label = clean(raw.label);
  return {
    id: nullable(raw.id),
    client_slug: slug,
    client_name: clientName || slug,
    platform,
    label,
    handle: nullable(raw.handle),
    password: nullable(raw.password),
    notes: nullable(raw.notes),
    status: safeStatus(raw.status),
    source: safeSource(raw.source || fallbackSource),
    raw_import: nullable(raw.raw_import),
    updated_at: new Date().toISOString(),
    updated_by: actor.name,
    updated_by_role: actor.role,
  };
}

const DIFF_FIELDS = ["client_slug", "client_name", "platform", "label", "handle", "password", "notes", "status", "source", "raw_import"];

function eventPayloadFor(row: JsonMap): JsonMap {
  return {
    client_slug: row.client_slug || null,
    client_name: row.client_name || null,
    platform: row.platform || null,
    label: row.label || "",
    handle: row.handle || null,
    notes: row.notes || null,
    status: row.status || null,
    source: row.source || null,
    raw_import: row.raw_import || null,
    has_password: !!row.password,
  };
}

function knownClientLookup(known: unknown): Map<string, string> {
  const map = new Map<string, string>();
  if (Array.isArray(known)) {
    for (const item of known) {
      const name = clean((item && typeof item === "object") ? (item as JsonMap).name || (item as JsonMap).client_name : item);
      if (!name) continue;
      map.set(normalizeClient(name), name);
    }
  }
  return map;
}

function clientTarget(rawName: string, known: Map<string, string>): { slug: string; name: string; matched: boolean } {
  const norm = normalizeClient(rawName);
  const canonical = norm ? known.get(norm) : "";
  if (canonical) return { slug: norm, name: canonical, matched: true };
  if (norm) return { slug: "unmatched:" + norm, name: rawName || "Unmatched", matched: false };
  return { slug: "unmatched:unknown", name: rawName || "Unmatched", matched: false };
}

async function actionList(supabase: SupabaseClient, body: JsonMap): Promise<Response> {
  const includeArchived = !!body.include_archived;
  let q = supabase.from("client_credentials").select("*").order("client_name", { ascending: true }).order("platform", { ascending: true }).limit(5000);
  const slug = clean(body.client_slug);
  if (slug) q = q.eq("client_slug", slug);
  if (Array.isArray(body.client_slugs) && body.client_slugs.length) q = q.in("client_slug", body.client_slugs.map(clean).filter(Boolean));
  if (!includeArchived) q = q.neq("status", "archived");
  const { data, error } = await q;
  if (error) return json({ ok: false, error: "list failed" }, 500);
  return json({ ok: true, credentials: data || [] });
}

async function actionHistory(supabase: SupabaseClient, body: JsonMap): Promise<Response> {
  let q = supabase.from("client_credential_events").select("*").order("event_at", { ascending: false }).limit(Math.min(Number(body.limit || 500), 1000));
  const id = clean(body.credential_id);
  const slug = clean(body.client_slug);
  if (id) q = q.eq("credential_id", id);
  else if (slug) q = q.eq("client_slug", slug);
  else return json({ ok: false, error: "credential_id or client_slug required" }, 400);
  const { data, error } = await q;
  if (error) return json({ ok: false, error: "history failed" }, 500);
  return json({ ok: true, events: data || [] });
}

async function findExisting(supabase: SupabaseClient, row: JsonMap): Promise<JsonMap | null> {
  if (row.id) {
    const { data } = await supabase.from("client_credentials").select("*").eq("id", row.id).maybeSingle();
    return (data || null) as JsonMap | null;
  }
  const { data } = await supabase.from("client_credentials")
    .select("*")
    .eq("client_slug", row.client_slug)
    .eq("platform", row.platform)
    .eq("label", row.label || "")
    .neq("status", "archived")
    .maybeSingle();
  return (data || null) as JsonMap | null;
}

async function saveOne(supabase: SupabaseClient, req: Request, actor: Actor, input: JsonMap, fallbackSource = "manual", actionName = "upsert"): Promise<JsonMap> {
  const row = materializeCredential(input, actor, fallbackSource);
  if (!row.client_slug || !row.client_name) throw new Error("client required");
  if (!row.platform) throw new Error("platform required");
  const existing = await findExisting(supabase, row);
  let saved: JsonMap | null = null;
  if (existing) {
    const patch: JsonMap = { ...row };
    delete patch.id;
    const { data, error } = await supabase.from("client_credentials").update(patch).eq("id", existing.id).select("*").single();
    if (error) throw new Error("credential save failed");
    saved = data as JsonMap;
    const events: EventDraft[] = [];
    for (const f of DIFF_FIELDS) {
      const oldVal = existing[f] == null ? "" : String(existing[f]);
      const newVal = saved[f] == null ? "" : String(saved[f]);
      if (oldVal !== newVal) {
        events.push({
          credential_id: String(saved.id), client_slug: String(saved.client_slug), client_name: String(saved.client_name),
          action: actionName === "bulk_import" ? "bulk_import" : actionName === "onboarding_import" ? "onboarding_import" : "update",
          field: f, old_value: oldVal, new_value: newVal,
          payload: { platform: saved.platform, label: saved.label || "" },
        });
      }
    }
    if (events.length) await insertEvents(supabase, events, req, actor);
  } else {
    const insert = {
      ...row,
      created_at: new Date().toISOString(),
      created_by: actor.name,
      created_by_role: actor.role,
    };
    delete insert.id;
    const { data, error } = await supabase.from("client_credentials").insert(insert).select("*").single();
    if (error) throw new Error("credential create failed");
    saved = data as JsonMap;
    await insertEvents(supabase, [{
      credential_id: String(saved.id), client_slug: String(saved.client_slug), client_name: String(saved.client_name),
      action: actionName === "bulk_import" ? "bulk_import" : actionName === "onboarding_import" ? "onboarding_import" : "create",
      payload: eventPayloadFor(saved),
    }], req, actor);
  }
  await touchRev(supabase, String(saved.client_slug), String(saved.client_name));
  return saved;
}

async function actionUpsert(supabase: SupabaseClient, req: Request, body: JsonMap, actor: Actor): Promise<Response> {
  const input = ((body.credential && typeof body.credential === "object") ? body.credential : body) as JsonMap;
  try {
    const saved = await saveOne(supabase, req, actor, input, "manual", "upsert");
    return json({ ok: true, credential: saved });
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : "save failed" }, 400);
  }
}

async function actionDelete(supabase: SupabaseClient, req: Request, body: JsonMap, actor: Actor): Promise<Response> {
  const id = clean(body.credential_id || body.id);
  if (!id) return json({ ok: false, error: "credential_id required" }, 400);
  const { data: old, error: readErr } = await supabase.from("client_credentials").select("*").eq("id", id).maybeSingle();
  if (readErr || !old) return json({ ok: false, error: "not found" }, 404);
  const { data: saved, error } = await supabase.from("client_credentials").update({
    status: "archived",
    updated_at: new Date().toISOString(),
    updated_by: actor.name,
    updated_by_role: actor.role,
  }).eq("id", id).select("*").single();
  if (error) return json({ ok: false, error: "delete failed" }, 500);
  await insertEvents(supabase, [{
    credential_id: id,
    client_slug: clean((old as JsonMap).client_slug),
    client_name: clean((old as JsonMap).client_name),
    action: "delete",
    payload: eventPayloadFor(old as JsonMap),
  }], req, actor);
  await touchRev(supabase, clean((old as JsonMap).client_slug), clean((old as JsonMap).client_name));
  return json({ ok: true, credential: saved });
}

async function actionReassign(supabase: SupabaseClient, req: Request, body: JsonMap, actor: Actor): Promise<Response> {
  const id = clean(body.credential_id || body.id);
  const clientName = clean(body.client_name || body.client);
  const clientSlug = clean(body.client_slug || body.slug) || normalizeClient(clientName);
  if (!id || !clientSlug || !clientName) return json({ ok: false, error: "credential_id and client required" }, 400);
  const { data: old, error: readErr } = await supabase.from("client_credentials").select("*").eq("id", id).maybeSingle();
  if (readErr || !old) return json({ ok: false, error: "not found" }, 404);
  const oldRow = old as JsonMap;
  const { data: saved, error } = await supabase.from("client_credentials").update({
    client_slug: clientSlug,
    client_name: clientName,
    status: "active",
    updated_at: new Date().toISOString(),
    updated_by: actor.name,
    updated_by_role: actor.role,
  }).eq("id", id).select("*").single();
  if (error) return json({ ok: false, error: "reassign failed" }, 500);
  await insertEvents(supabase, [{
    credential_id: id,
    client_slug: clientSlug,
    client_name: clientName,
    action: "reassign",
    field: "client",
    old_value: clean(oldRow.client_name) + "|" + clean(oldRow.client_slug),
    new_value: clientName + "|" + clientSlug,
    payload: { from: eventPayloadFor(oldRow), to: eventPayloadFor(saved as JsonMap) },
  }], req, actor);
  await touchRev(supabase, clean(oldRow.client_slug), clean(oldRow.client_name));
  await touchRev(supabase, clientSlug, clientName);
  return json({ ok: true, credential: saved });
}

async function actionReveal(supabase: SupabaseClient, req: Request, body: JsonMap, actor: Actor): Promise<Response> {
  const id = clean(body.credential_id || body.id);
  if (!id) return json({ ok: false, error: "credential_id required" }, 400);
  const { data: row } = await supabase.from("client_credentials").select("id,client_slug,client_name,platform,label").eq("id", id).maybeSingle();
  if (!row) return json({ ok: false, error: "not found" }, 404);
  const r = row as JsonMap;
  await insertEvents(supabase, [{
    credential_id: id,
    client_slug: clean(r.client_slug),
    client_name: clean(r.client_name),
    action: "reveal",
    payload: { platform: r.platform || null, label: r.label || "" },
  }], req, actor);
  return json({ ok: true });
}

function parseBulk(text: string, known: Map<string, string>): ParsedImport[] {
  const seen = new Set<string>();
  return text.split(/\r?\n/).map((line, idx) => ({ line, idx })).filter(x => x.line.trim()).map(({ line, idx }) => {
    const parts = line.split("|").map(s => s.trim());
    const rawClient = parts[0] || "";
    const target = clientTarget(rawClient, known);
    const platform = normalizePlatform(parts[1] || "account");
    const handle = parts[2] || "";
    const password = parts[3] || "";
    const notes = parts.slice(4).join(" | ").trim();
    const label = "";
    const flags: string[] = [];
    if (parts.length < 4) flags.push("format");
    if (!target.matched) flags.push("unknown_client");
    if (!password) flags.push("missing_password");
    const dupeKey = target.slug + "|" + platform + "|" + label;
    if (seen.has(dupeKey)) flags.push("duplicate_in_paste");
    seen.add(dupeKey);
    return {
      line: idx + 1,
      raw: line,
      client_name: target.name,
      client_slug: target.slug,
      platform,
      label,
      handle,
      password,
      notes,
      status: target.matched ? "active" : "needs_review",
      flags,
    };
  });
}

async function markExistingFlags(supabase: SupabaseClient, rows: ParsedImport[]): Promise<void> {
  for (const r of rows) {
    const { data } = await supabase.from("client_credentials")
      .select("id")
      .eq("client_slug", r.client_slug)
      .eq("platform", r.platform)
      .eq("label", r.label || "")
      .neq("status", "archived")
      .maybeSingle();
    if (data && !r.flags.includes("duplicate_existing")) r.flags.push("duplicate_existing");
  }
}

async function actionBulkImport(supabase: SupabaseClient, req: Request, body: JsonMap, actor: Actor): Promise<Response> {
  const text = clean(body.text || body.raw || body.bulk_text);
  const dryRun = body.dry_run !== false;
  const known = knownClientLookup(body.known_clients);
  const rows = parseBulk(text, known);
  await markExistingFlags(supabase, rows);
  if (dryRun) return json({ ok: true, dry_run: true, preview: rows });
  const saved: JsonMap[] = [];
  for (const r of rows) {
    const row = await saveOne(supabase, req, actor, {
      client_slug: r.client_slug,
      client_name: r.client_name,
      platform: r.platform,
      label: r.label,
      handle: r.handle,
      password: r.password,
      notes: r.notes,
      status: r.status,
      source: "bulk_import",
      raw_import: r.raw,
    }, "bulk_import", "bulk_import");
    saved.push(row);
  }
  return json({ ok: true, imported: saved.length, credentials: saved, preview: rows });
}

function extractTextCandidates(obj: unknown, prefix = "", out: string[] = []): string[] {
  if (!obj || typeof obj !== "object") return out;
  for (const [k, v] of Object.entries(obj as JsonMap)) {
    const key = (prefix + " " + k).toLowerCase();
    if (typeof v === "string") {
      if ((key.includes("account") && key.includes("access")) || key.includes("login") || key.includes("password") || key.includes("credential")) out.push(v);
    } else if (v && typeof v === "object") {
      extractTextCandidates(v, key, out);
    }
  }
  return out;
}

function parseAccountLine(line: string, fallbackPlatform = "account"): { platform: string; handle: string; password: string; notes: string } {
  let raw = line.trim();
  let platform = fallbackPlatform;
  const pfx = raw.match(/^([A-Za-z][A-Za-z0-9 _-]{1,24})\s*[:=-]\s*(.+)$/);
  if (pfx) { platform = normalizePlatform(pfx[1]); raw = pfx[2].trim(); }
  for (const p of PLATFORMS) {
    if (new RegExp("\\b" + p + "\\b", "i").test(line)) { platform = normalizePlatform(p); break; }
  }
  let handle = "";
  let password = "";
  /* An EMAIL is matched before a bare @handle. The @-token pattern below finds
     "@example.com" inside "someone@example.com" and drops the local part,
     which silently produced an unusable login: two of the six onboarding
     labels are "Email & Password" (29 of the 90 answers on file). Ordering
     these matters more than either pattern does. */
  const emailMatch = raw.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
  const handleMatch = raw.match(/@[-._A-Za-z0-9]+/);
  if (emailMatch) handle = emailMatch[0];
  else if (handleMatch) handle = handleMatch[0];
  const passMatch = raw.match(/(?:password|pass|pw)\s*[:=-]\s*([^,;\n]+)/i);
  if (passMatch) password = passMatch[1].trim();
  if (!password && raw.includes("/")) {
    const parts = raw.split("/").map(s => s.trim()).filter(Boolean);
    if (!handle && parts[0]) handle = parts[0];
    if (parts[1]) password = parts.slice(1).join(" / ").trim();
  }
  if (!handle) {
    const h = raw.match(/(?:handle|user(?:name)?|account)\s*[:=-]\s*([^,;\n\/]+)/i);
    if (h) handle = h[1].trim();
  }
  return { platform, handle, password, notes: raw };
}

/* ---------------------------------------------------------------------------
 * Labelled onboarding answers.
 *
 * The onboarding form stores each answer as {label, value}. Those are two very
 * different kinds of data and were previously collapsed into one: `clean()` on
 * the array stringified it, so the LABEL -- the reliable half -- was thrown
 * away and the platform had to be guessed from whatever prose the client typed
 * in the value. Measured against the 90 real answers on file, guessing from the
 * value produced platforms like `account` and, once, `i_am_not_sure`; reading
 * the label produces the right platform 90/90.
 *
 * The label also says what KIND of secret the answer is, which matters more
 * than the platform. Exactly six labels exist across every submission, and two
 * of them are not logins:
 *
 *   Instagram / TikTok / Linkedin / Facebook "... Username & Password" -> login
 *   "Instagram Back Up Code"  -> a code. There is no username. Parsing it as
 *                                handle+password yielded 0 of 13.
 *   "YouTube Access"          -> usually a sentence about sending an invite.
 *                                Yielded 1 of 15.
 *
 * Those two were never parse failures; they were the wrong question. Asking the
 * right one per kind is what turns a 38/90 "success rate" into an import where
 * every row is either usable or honestly labelled for a human.
 * ------------------------------------------------------------------------- */
type LabeledAnswer = { label: string; value: string };
type ImportTarget = { slug: string; name: string; matched: boolean };
type LabelFacts = { platform: string; kind: string };
const ONBOARDING_NON_ANSWER = /^(none|n\/?a|na|nil|-+|tbd|pending|unknown|no|yes)$/i;
const ONBOARDING_DEFERRAL = /^(working on|i am not sure|i'm not sure|im not sure|not sure|will send|i will send|let me|i'll|ill send|please let me know|i need to|need to get)/i;
/* A value that answers nothing. Distinguished from an unparseable one because
 * the remedy differs: an unparseable answer needs a human to read it, a missing
 * one needs the CLIENT to be asked again. */
function onboardingIsNonAnswer(text: string): boolean {
  const t = clean(text);
  if (!t) return true;
  if (ONBOARDING_NON_ANSWER.test(t)) return true;
  return ONBOARDING_DEFERRAL.test(t);
}
function onboardingLabelFacts(label: string): LabelFacts {
  const text = clean(label);
  let platform = "account";
  for (const p of PLATFORMS) {
    if (new RegExp("\\b" + p + "\\b", "i").test(text)) { platform = normalizePlatform(p); break; }
  }
  let kind = "login";
  if (/back\s*-?\s*up\s*code|backup\s*code|recovery\s*code/i.test(text)) kind = "backup_code";
  else if (/\baccess\b/i.test(text) && !/password/i.test(text)) kind = "access_note";
  return { platform, kind };
}
function parseLabeledOnboardingEntries(value: unknown): LabeledAnswer[] {
  if (!Array.isArray(value)) return [];
  const out: LabeledAnswer[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const row = entry as JsonMap;
    const label = clean(row.label ?? row.question ?? row.name);
    const text = clean(row.value ?? row.answer ?? row.text);
    if (!label && !text) continue;
    out.push({ label, value: text });
  }
  return out;
}
/* One labelled answer -> one import row. NEVER auto-approved: every row lands
 * needs_review, and `notes` always carries the client's original words so a
 * reviewer can correct any guess made here without going back to the form. */
function onboardingRowFromLabeled(entry: LabeledAnswer, target: ImportTarget, line: number): ParsedImport {
  const facts = onboardingLabelFacts(entry.label);
  const flags: string[] = [];
  if (!target.matched) flags.push("unknown_client");
  let handle = "";
  let password = "";
  // Cleaned here rather than trusted from the caller: parseLabeledOnboardingEntries
  // already trims, but this function is also reachable directly and a credential
  // stored with stray whitespace does not work when someone pastes it.
  const value = clean(entry.value);
  const empty = onboardingIsNonAnswer(value);
  if (empty) {
    flags.push("no_answer");
  } else if (facts.kind === "backup_code") {
    password = value;
    flags.push("backup_code");
  } else if (facts.kind === "access_note") {
    flags.push("access_note");
  } else {
    const parsed = parseAccountLine(value, facts.platform);
    handle = parsed.handle;
    password = parsed.password;
    if (!password) flags.push("needs_review");
  }
  return {
    line,
    raw: value,
    client_name: target.name,
    client_slug: target.matched ? target.slug : "unmatched:" + normalizeClient(target.name),
    platform: facts.platform,
    label: entry.label,
    handle,
    password,
    notes: value,
    status: "needs_review",
    flags,
  };
}

/* The current funnels do not send a credentials array at all. A standard or AI
 * submission carries account access as flat keys on `answers`, one per
 * platform, so the labelled path above would never see them and the older text
 * scan would be left guessing the platform from prose again.
 *
 * Mapping those keys onto the SAME six labels the legacy form used means one
 * parser, one set of rules, and identical behaviour whether a submission came
 * through the legacy form, the current form, or the n8n workflow that posts on
 * submit. It is also what makes the labels reliable for new clients rather
 * than only for the 19 legacy submissions on file. */
const ONBOARDING_ANSWER_LABELS: Record<string, string> = {
  instagram: "Instagram Username & Password",
  instagram_backup: "Instagram Back Up Code",
  instagram_backup_code: "Instagram Back Up Code",
  tiktok: "TikTok Username & Password",
  facebook: "Facebook Email & Password",
  linkedin: "Linkedin Email & Password",
  youtube: "YouTube Access",
};
function labeledEntriesFromAnswers(answers: JsonMap): LabeledAnswer[] {
  const out: LabeledAnswer[] = [];
  if (!answers || typeof answers !== "object") return out;
  for (const [key, label] of Object.entries(ONBOARDING_ANSWER_LABELS)) {
    const value = clean((answers as JsonMap)[key]);
    if (!value) continue;
    if (out.some((row) => row.label === label)) continue;
    out.push({ label, value });
  }
  return out;
}

function parseOnboardingRows(body: JsonMap): ParsedImport[] {
  const known = knownClientLookup(body.known_clients);
  const answers = ((body.answers && typeof body.answers === "object") ? body.answers : ((body.submission && typeof body.submission === "object" && (body.submission as JsonMap).answers && typeof (body.submission as JsonMap).answers === "object") ? (body.submission as JsonMap).answers : {})) as JsonMap;
  const first = clean(body.first_name || answers.first_name || (body.submission as JsonMap | undefined)?.first_name);
  const last = clean(body.last_name || answers.last_name || (body.submission as JsonMap | undefined)?.last_name);
  const rawClient = clean(body.client_name || body.client || answers.client_name || answers.name || [first, last].filter(Boolean).join(" "));
  const explicitSlug = clean(body.client_slug || body.slug || answers.client_slug);
  const target = explicitSlug ? { slug: explicitSlug, name: rawClient || explicitSlug, matched: !!(known.size ? known.has(explicitSlug) : true) } : clientTarget(rawClient, known);
  /* Labelled answers first. This is the shape the onboarding form actually
     stores; the text paths below remain for pasted blocks and for older
     submissions that never carried labels. Taking the first non-empty list
     rather than concatenating keeps a single source per submission -- body and
     answers routinely hold the SAME array, and concatenating imported every
     credential twice. */
  const labeled = [body.credentials, answers.credentials, body.account_access, answers.account_access]
    .map(parseLabeledOnboardingEntries).find(list => list.length)
    || labeledEntriesFromAnswers(answers)
    || [];
  if (labeled.length) {
    return labeled.map((entry, index) => onboardingRowFromLabeled(entry, target, index + 1));
  }
  const direct = [body.account_access, body.logins, body.credentials, answers.account_access, answers.logins, answers.credentials]
    .map(clean).filter(Boolean);
  const candidates = direct.length ? direct : extractTextCandidates(answers).map(clean).filter(Boolean);
  const rows: ParsedImport[] = [];
  let n = 0;
  for (const block of candidates) {
    for (const line of block.split(/\r?\n|\s{2,}|;(?=\s*(?:instagram|tiktok|facebook|linkedin|youtube|@))/i).map(s => s.trim()).filter(Boolean)) {
      const parsed = parseAccountLine(line);
      const flags: string[] = [];
      if (!target.matched) flags.push("unknown_client");
      if (!parsed.password) flags.push("needs_review");
      rows.push({
        line: ++n,
        raw: line,
        client_name: target.name,
        client_slug: target.matched ? target.slug : "unmatched:" + normalizeClient(target.name),
        platform: parsed.platform,
        label: "",
        handle: parsed.handle,
        password: parsed.password,
        notes: parsed.notes,
        status: "needs_review",
        flags,
      });
    }
  }
  return rows;
}

async function actionOnboardingImport(supabase: SupabaseClient, req: Request, body: JsonMap, actor: Actor): Promise<Response> {
  const rows = parseOnboardingRows(body);
  /* WRITES by default; a caller must opt IN to previewing with dry_run:true.
     This is deliberately the opposite of bulk_import, and the reason is
     backward compatibility rather than taste: two deployed n8n workflows
     (syncview-onboarding-submit, syncview-ai-onboarding-submit) call this
     action with no dry_run at all, and both use onError:continueRegularOutput.
     Flipping the default to preview would turn those into SILENT successful
     no-ops -- the workflow sees ok:true and continues while the vault is never
     seeded, which is worse than any error. The browser importer always states
     its intent explicitly in both directions, so it loses nothing here. */
  const dryRun = body.dry_run === true;
  if (!rows.length) return json({ ok: true, dry_run: dryRun, imported: 0, preview: [], credentials: [] });

  /* NEVER overwrite a hand-entered credential (owner ruling 2026-08-20: "I
     don't want you to overwrite credentials that were manually placed in case
     it's more up-to-date").

     saveOne updates in place when it finds a matching client+platform+label,
     so without this an import would silently replace a password someone typed
     -- possibly a NEWER one they set after the client filled in the form, and
     the onboarding answer is by definition the older value. The audit log
     would record the change, but only after the good value was already gone.

     A row this import itself created before may still be refreshed: a client
     who re-submits with a corrected password should update their own row. So
     the rule is narrow -- manual is protected, onboarding-sourced is not.

     Annotated on the PREVIEW as well as enforced on the write, so the reviewer
     sees "already saved by hand" before deciding rather than wondering why a
     row silently did nothing. */
  const annotated: ParsedImport[] = [];
  for (const r of rows) {
    let existingManual = false;
    /* Match on client+platform, NOT client+platform+LABEL.
       Every hand-entered credential in the store carries an EMPTY label, while
       an imported one is labelled from the onboarding question ("Instagram
       Username & Password"). Looking for an exact label match therefore found
       nothing, so the protection never fired -- and worse, the write path
       found nothing either and INSERTED A SECOND ROW. The failure mode was not
       the overwrite the owner feared; it was a duplicate, which is arguably
       worse because neither row then says which one is current.

       A BACKUP CODE is deliberately exempt: it is a genuinely different secret
       from the login for the same platform, so a client can legitimately hold
       both, and blocking it on the presence of a login would lose real data. */
    const isLoginRow = !r.flags.includes("backup_code") && !r.flags.includes("access_note");
    if (isLoginRow && r.client_slug && !r.client_slug.startsWith("unmatched:") && r.platform) {
      const { data: siblings } = await supabase.from("client_credentials")
        .select("id,source,label")
        .eq("client_slug", r.client_slug)
        .eq("platform", r.platform)
        .neq("status", "archived");
      /* ANY non-onboarding sibling protects the login. The earlier version
         also tried to exclude a sibling that looked like a backup code, by
         testing its LABEL -- which review correctly called out as inferring a
         type from data the manual path never records. The manual editor always
         writes an empty label and keeps 2FA/backup notes in the notes field,
         so that test could never match and only lent the rule a precision it
         did not have. Dropped rather than elaborated: a human has curated this
         platform, so the imported login stands aside either way. The backup
         code the owner wanted to keep importable is protected by isLoginRow
         above, which reads OUR OWN classification of the incoming answer
         rather than guessing at an existing row. */
      existingManual = (siblings || []).some((row: JsonMap) => clean(row.source) !== "onboarding");
    }
    annotated.push(existingManual ? { ...r, flags: [...r.flags, "existing_manual"] } : r);
  }
  if (dryRun) return json({ ok: true, dry_run: true, imported: 0, preview: annotated });
  const skipped = annotated.filter((r) => r.flags.includes("existing_manual"));
  const saved: JsonMap[] = [];
  for (const r of annotated.filter((row) => !row.flags.includes("existing_manual"))) {
    const row = await saveOne(supabase, req, actor, {
      client_slug: r.client_slug,
      client_name: r.client_name,
      platform: r.platform,
      label: r.label,
      handle: r.handle,
      password: r.password,
      notes: r.notes,
      status: r.status,
      source: "onboarding",
      raw_import: r.raw,
    }, "onboarding", "onboarding_import");
    saved.push(row);
  }
  return json({
    ok: true,
    imported: saved.length,
    skipped_existing_manual: skipped.length,
    credentials: saved,
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "method" }, 405);

  // Role keys are the primary path: admin and SMM can use credentials, while the
  // creative key cannot. Keep both historical secrets additive during migration
  // so existing Kasper/SMM browsers and backend callers cannot be locked out.
  // X-Syncview-Role is intentionally not an input to this decision.
  const kOnb = (Deno.env.get("ONBOARDING_STAFF_KEY") || "").trim();
  const kStaff = (Deno.env.get("CREDENTIALS_STAFF_KEY") || "").trim();
  const supplied = (req.headers.get("x-syncview-key") || "").trim();
  const auth = authorizeStaffKey(supplied, ["admin", "smm"], [kOnb, kStaff]);
  if (!auth.ok) return json({ ok: false, error: auth.role ? "forbidden" : "unauthorized" }, staffAuthFailureStatus(auth));

  let body: JsonMap;
  try { body = JSON.parse(await req.text()) as JsonMap; }
  catch (_e) { return json({ ok: false, error: "invalid body" }, 400); }
  const action = clean(body.action);
  const actor = actorFrom(body);
  if (auth.via === "role" && auth.role) actor.role = auth.role;
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  try {
    if (action === "list") return await actionList(supabase, body);
    if (action === "history") return await actionHistory(supabase, body);
    if (action === "upsert") return await actionUpsert(supabase, req, body, actor);
    if (action === "delete") return await actionDelete(supabase, req, body, actor);
    if (action === "reassign") return await actionReassign(supabase, req, body, actor);
    if (action === "log_reveal") return await actionReveal(supabase, req, body, actor);
    if (action === "bulk_import") return await actionBulkImport(supabase, req, body, actor);
    if (action === "onboarding_import") return await actionOnboardingImport(supabase, req, body, actor);
    return json({ ok: false, error: "unknown action" }, 400);
  } catch (_e) {
    return json({ ok: false, error: "request failed" }, 500);
  }
});
