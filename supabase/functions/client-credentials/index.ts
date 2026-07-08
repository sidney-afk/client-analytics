// Supabase Edge Function: client-credentials
//
// Service-role gateway for SyncView's Client Credentials UI. The public anon key
// has no access to public.client_credentials or public.client_credential_events;
// every browser/n8n request must pass the shared staff passphrase in
// X-Syncview-Key. Do not log request bodies here: they can contain client
// passwords and old password history.
//
// Deploy:
//   supabase secrets set CREDENTIALS_STAFF_KEY=<shared staff passphrase>
//   supabase functions deploy client-credentials --project-ref uzltbbrjidmjwwfakwve --no-verify-jwt

import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-syncview-key",
  "Cache-Control": "no-store",
};

const TEXT = new TextEncoder();
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

function timingSafeEqual(a: string, b: string): boolean {
  const aa = TEXT.encode(a || "");
  const bb = TEXT.encode(b || "");
  let diff = aa.length ^ bb.length;
  const max = Math.max(aa.length, bb.length);
  for (let i = 0; i < max; i++) diff |= (aa[i] || 0) ^ (bb[i] || 0);
  return diff === 0;
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
  const handleMatch = raw.match(/@[-._A-Za-z0-9]+/);
  if (handleMatch) handle = handleMatch[0];
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

function parseOnboardingRows(body: JsonMap): ParsedImport[] {
  const known = knownClientLookup(body.known_clients);
  const answers = ((body.answers && typeof body.answers === "object") ? body.answers : ((body.submission && typeof body.submission === "object" && (body.submission as JsonMap).answers && typeof (body.submission as JsonMap).answers === "object") ? (body.submission as JsonMap).answers : {})) as JsonMap;
  const first = clean(body.first_name || answers.first_name || (body.submission as JsonMap | undefined)?.first_name);
  const last = clean(body.last_name || answers.last_name || (body.submission as JsonMap | undefined)?.last_name);
  const rawClient = clean(body.client_name || body.client || answers.client_name || answers.name || [first, last].filter(Boolean).join(" "));
  const explicitSlug = clean(body.client_slug || body.slug || answers.client_slug);
  const target = explicitSlug ? { slug: explicitSlug, name: rawClient || explicitSlug, matched: !!(known.size ? known.has(explicitSlug) : true) } : clientTarget(rawClient, known);
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
  if (!rows.length) return json({ ok: true, imported: 0, credentials: [] });
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
      source: "onboarding",
      raw_import: r.raw,
    }, "onboarding", "onboarding_import");
    saved.push(row);
  }
  return json({ ok: true, imported: saved.length, credentials: saved });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "method" }, 405);

  // Credentials are opened from TWO places: Kasper's tab (he uses the onboarding
  // passphrase ONBOARDING_STAFF_KEY) and the SMM calendar (staff use the shared
  // CREDENTIALS_STAFF_KEY). Accept EITHER key so both audiences get in. (By
  // contrast, onboarding-full accepts only ONBOARDING_STAFF_KEY once it's set, so
  // onboarding stays Kasper-only.)
  const kOnb = (Deno.env.get("ONBOARDING_STAFF_KEY") || "").trim();
  const kStaff = (Deno.env.get("CREDENTIALS_STAFF_KEY") || "").trim();
  if (!kOnb && !kStaff) return json({ ok: false, error: "credentials key not configured" }, 500);
  const supplied = (req.headers.get("x-syncview-key") || "").trim();
  const authed = (!!kOnb && timingSafeEqual(supplied, kOnb)) || (!!kStaff && timingSafeEqual(supplied, kStaff));
  if (!authed) return json({ ok: false, error: "unauthorized" }, 401);

  let body: JsonMap;
  try { body = JSON.parse(await req.text()) as JsonMap; }
  catch (_e) { return json({ ok: false, error: "invalid body" }, 400); }
  const action = clean(body.action);
  const actor = actorFrom(body);
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
