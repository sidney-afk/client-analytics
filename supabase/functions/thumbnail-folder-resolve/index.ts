// Supabase Edge Function: thumbnail-folder-resolve
//
// Resolves the parent Google Drive folder for a card thumbnail file URL and
// stores it back onto calendar_posts or sample_reviews. Browser callers provide
// the surface/client/id/thumbnail_url they just saved; this function rereads the
// row first and refuses stale writes when the stored thumbnail_url differs.
//
// A second action, folder_preview (carousel preview, OPEN_REPAIRS 710): given a Drive FOLDER link on a card
// of a client listed in the runtime flag carousel_preview_v1 (or any client, for a listed staff "viewers" member
// holding a real staff role key), it lists the folder with the API key only (so a
// folder that is not shared "Anyone with the link" reads as not_shared, never through the service account), picks
// the first IMAGE by name, and answers { state, count, has_video, first_file_id }. Cached in
// carousel_folder_preview_cache. No token or signed address ever leaves the function: the page draws the image from
// Drive's public thumbnail address for that file id, which works only for a shared file.
//
// Required env:
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//   GOOGLE_DRIVE_API_KEY
//
// Optional env fallback for authenticated Drive metadata. API keys can read
// public file metadata, but Google can omit parent folders from unauthenticated
// responses.
//   GOOGLE_SERVICE_ACCOUNT_JSON
//   or GOOGLE_CLIENT_EMAIL + GOOGLE_PRIVATE_KEY

import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2.49.8";
import { authorizeStaffKey } from "../_shared/staff-role-auth.ts";

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-syncview-key, x-syncview-actor, x-syncview-role, x-syncview-source, x-syncview-client-token",
  "Cache-Control": "no-store",
};

const SURFACES: Record<string, string> = {
  calendar: "calendar_posts",
  samples: "sample_reviews",
};

type JsonMap = Record<string, unknown>;
type ResolvePatch = {
  thumbnail_folder_url: string;
  thumbnail_folder_id: string;
  thumbnail_file_id: string;
  thumbnail_folder_resolved_at: string;
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

function addScheme(url: string): string {
  if (!url) return "";
  return /^https?:\/\//i.test(url) ? url : "https://" + url;
}

function hostOf(url: string): string {
  try { return new URL(addScheme(url)).hostname.replace(/^www\./, ""); }
  catch (_e) { return ""; }
}

function isDriveFolderLink(url: string): boolean {
  const u = clean(url);
  if (!u) return false;
  if (/drive\.google\.com\/(?:drive\/)?(?:u\/\d+\/)?folders\//i.test(u)) return true;
  if (/drive\.google\.com\/folderview\?/i.test(u)) return true;
  return false;
}

function extractDriveFileId(input: string): string {
  const raw = clean(input);
  if (!raw || isDriveFolderLink(raw)) return "";

  if (/^[A-Za-z0-9_-]{20,}$/.test(raw) && raw.indexOf("/") === -1) return raw;

  let url: URL;
  try { url = new URL(addScheme(raw)); }
  catch (_e) { return ""; }

  if (!/(^|\.)drive\.google\.com$/i.test(url.hostname) && !/(^|\.)docs\.google\.com$/i.test(url.hostname)) {
    return "";
  }

  let m = url.pathname.match(/\/file\/d\/([A-Za-z0-9_-]+)/i);
  if (m) return m[1];
  m = url.pathname.match(/\/(?:document|spreadsheets|presentation|drawings|forms)\/d\/([A-Za-z0-9_-]+)/i);
  if (m) return m[1];
  const id = url.searchParams.get("id");
  return id && /^[A-Za-z0-9_-]{20,}$/.test(id) ? id : "";
}

function folderUrl(id: string): string {
  return id ? "https://drive.google.com/drive/folders/" + encodeURIComponent(id) : "";
}

function blankPatch(): ResolvePatch {
  return {
    thumbnail_folder_url: "",
    thumbnail_folder_id: "",
    thumbnail_file_id: "",
    thumbnail_folder_resolved_at: new Date().toISOString(),
  };
}

async function serviceAccountToken(): Promise<string> {
  const rawJson = clean(Deno.env.get("GOOGLE_SERVICE_ACCOUNT_JSON"));
  const creds = rawJson
    ? JSON.parse(rawJson) as JsonMap
    : {
        client_email: clean(Deno.env.get("GOOGLE_CLIENT_EMAIL")),
        private_key: clean(Deno.env.get("GOOGLE_PRIVATE_KEY")),
        token_uri: "https://oauth2.googleapis.com/token",
      };

  const email = clean(creds.client_email);
  const privateKey = clean(creds.private_key).replace(/\\n/g, "\n");
  const tokenUri = clean(creds.token_uri) || "https://oauth2.googleapis.com/token";
  if (!email || !privateKey) throw new Error("Drive credentials not configured");

  const enc = new TextEncoder();
  const b64url = (s: string | Uint8Array) => {
    const bytes = typeof s === "string" ? enc.encode(s) : s;
    let bin = "";
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  };

  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64url(JSON.stringify({
    iss: email,
    scope: "https://www.googleapis.com/auth/drive.metadata.readonly",
    aud: tokenUri,
    exp: now + 3600,
    iat: now,
  }));
  const unsigned = header + "." + claim;

  const pkcs8 = privateKey
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replace(/\s+/g, "");
  const keyBytes = Uint8Array.from(atob(pkcs8), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey(
    "pkcs8",
    keyBytes,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, enc.encode(unsigned)));
  const assertion = unsigned + "." + b64url(sig);

  const resp = await fetch(tokenUri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }).toString(),
  });
  const body = await resp.json().catch(() => ({}));
  if (!resp.ok || !body.access_token) throw new Error("Drive token failed");
  return String(body.access_token);
}

function serviceAccountConfigured(): boolean {
  if (clean(Deno.env.get("GOOGLE_SERVICE_ACCOUNT_JSON"))) return true;
  return !!(clean(Deno.env.get("GOOGLE_CLIENT_EMAIL")) && clean(Deno.env.get("GOOGLE_PRIVATE_KEY")));
}

async function fetchDriveParents(fileId: string): Promise<string[]> {
  const apiKey = clean(Deno.env.get("GOOGLE_DRIVE_API_KEY"));
  const baseUrl = "https://www.googleapis.com/drive/v3/files/" + encodeURIComponent(fileId)
    + "?fields=id,parents&supportsAllDrives=true";

  const requestParents = async (url: string, headers: Record<string, string>): Promise<string[]> => {
    const resp = await fetch(url, { headers });
    const body = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      const msg = clean((body && (body.error as JsonMap)?.message) || body.error_description) || ("Drive HTTP " + resp.status);
      throw new Error(msg);
    }
    return Array.isArray(body.parents) ? body.parents.map(clean).filter(Boolean) : [];
  };

  if (apiKey) {
    try {
      const parents = await requestParents(baseUrl + "&key=" + encodeURIComponent(apiKey), { Accept: "application/json" });
      if (parents.length || !serviceAccountConfigured()) return parents;
    } catch (e) {
      if (!serviceAccountConfigured()) throw e;
    }
  }

  return requestParents(baseUrl, {
    Accept: "application/json",
    Authorization: "Bearer " + await serviceAccountToken(),
  });
}

async function readCurrent(supabase: SupabaseClient, table: string, client: string, id: string): Promise<JsonMap | null> {
  const { data, error } = await supabase.from(table)
    .select("client,id,thumbnail_url")
    .eq("client", client)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error("row read failed");
  return data as JsonMap | null;
}

async function writePatch(
  supabase: SupabaseClient,
  table: string,
  client: string,
  id: string,
  patch: ResolvePatch,
): Promise<void> {
  const { error } = await supabase.from(table)
    .update(patch)
    .eq("client", client)
    .eq("id", id);
  if (error) throw new Error("folder update failed");
}

/* ---- folder_preview (carousel preview) ---------------------------------------------------------------------- */
const PREVIEW_FLAG_KEY = "carousel_preview_v1";
const PREVIEW_TTL_MS: Record<string, number> = { ok: 15 * 60_000, empty: 60_000, no_images: 5 * 60_000, not_shared: 30_000, error: 15_000 };
const IMAGE_NAME_RE = /\.(png|jpe?g|webp|gif|heic|avif)$/i;

function slugOf(v: unknown): string {
  return clean(v).toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export function driveFolderId(input: string): string {
  const raw = clean(input);
  if (/^[A-Za-z0-9_-]{15,}$/.test(raw)) return raw;
  if (!isDriveFolderLink(raw)) return "";
  let url: URL;
  try { url = new URL(addScheme(raw)); } catch (_e) { return ""; }
  const m = url.pathname.match(/\/folders\/([A-Za-z0-9_-]+)/i);
  if (m) return m[1];
  const id = url.searchParams.get("id");
  return id && /^[A-Za-z0-9_-]{15,}$/.test(id) ? id : "";
}

// Names the way a person reads them: 2.png before 10.png, 01.png before 02.png.
export function sortByName<T extends { name: string }>(files: T[]): T[] {
  return files.slice().sort((a, b) => a.name.localeCompare(b.name, "en", { numeric: true, sensitivity: "base" }));
}

export type PreviewAnswer = { state: string; count: number; has_video: boolean; first_file_id: string };

// Pure: what a folder listing means. Images are image/* files (or an image file name); videos are noted, never previewed.
export function judgeListing(files: Array<{ id: string; name: string; mimeType: string }>): PreviewAnswer {
  if (!files.length) return { state: "empty", count: 0, has_video: false, first_file_id: "" };
  const images = sortByName(files.filter(f => /^image\//i.test(f.mimeType) || IMAGE_NAME_RE.test(f.name)));
  const hasVideo = files.some(f => /^video\//i.test(f.mimeType));
  if (!images.length) return { state: "no_images", count: 0, has_video: hasVideo, first_file_id: "" };
  return { state: "ok", count: images.length, has_video: hasVideo, first_file_id: images[0].id };
}

async function listFolderPublic(folderId: string): Promise<PreviewAnswer> {
  const apiKey = clean(Deno.env.get("GOOGLE_DRIVE_API_KEY"));
  if (!apiKey) throw new Error("Drive key not configured");
  const files: Array<{ id: string; name: string; mimeType: string }> = [];
  let pageToken = "";
  for (let page = 0; page < 5; page++) {
    const qs = new URLSearchParams({
      q: `'${folderId}' in parents and trashed=false`,
      fields: "nextPageToken,files(id,name,mimeType)",
      pageSize: "200",
      supportsAllDrives: "true",
      includeItemsFromAllDrives: "true",
      key: apiKey,
    });
    if (pageToken) qs.set("pageToken", pageToken);
    const resp = await fetch("https://www.googleapis.com/drive/v3/files?" + qs.toString(), { headers: { Accept: "application/json" } });
    const body = await resp.json().catch(() => ({}));
    // The API key alone reads only what is shared with anyone who has the link: a private folder answers 404 or 403.
    if (resp.status === 404 || resp.status === 403 || resp.status === 401) return { state: "not_shared", count: 0, has_video: false, first_file_id: "" };
    if (!resp.ok) throw new Error("Drive HTTP " + resp.status);
    for (const f of (Array.isArray(body.files) ? body.files : []) as JsonMap[]) {
      files.push({ id: clean(f.id), name: clean(f.name), mimeType: clean(f.mimeType) });
    }
    pageToken = clean(body.nextPageToken);
    if (!pageToken) break;
  }
  return judgeListing(files);
}

// Pure: the flag value { "clients": [...], "viewers": [...] }. A listed client is allowed for anyone; a listed VIEWER
// (a staff member, by roster name or id) is allowed for every client. { "all": true } is deliberately not honoured.
export function clientListed(value: unknown, client: string): boolean {
  if (!value || typeof value !== "object") return false;
  const list = Array.isArray((value as JsonMap).clients) ? (value as JsonMap).clients as unknown[] : [];
  const slug = slugOf(client);
  return !!slug && list.some(x => typeof x === "string" && slugOf(x) === slug);
}
export function viewerListed(value: unknown, actor: string): boolean {
  if (!value || typeof value !== "object") return false;
  const list = Array.isArray((value as JsonMap).viewers) ? (value as JsonMap).viewers as unknown[] : [];
  const who = clean(actor).toLowerCase();
  return !!who && list.some(x => typeof x === "string" && clean(x) !== "*" && clean(x).toLowerCase() === who);
}

async function previewAllowed(supabase: SupabaseClient, client: string, req: Request): Promise<boolean> {
  const { data, error } = await supabase.from("syncview_runtime_flags").select("value").eq("key", PREVIEW_FLAG_KEY).maybeSingle();
  if (error || !data || !data.value || typeof data.value !== "object") return false;
  if (clientListed(data.value, client)) return true;
  // A listed staff viewer previewing any client: the role key must be a real one (the secret decides, as everywhere);
  // the actor header only says WHICH staff member, it never grants anything by itself.
  const key = clean(req.headers.get("x-syncview-key"));
  if (!key || !viewerListed(data.value, clean(req.headers.get("x-syncview-actor")))) return false;
  return authorizeStaffKey(key, ["admin", "smm", "creative"]).ok;
}

async function folderPreview(body: JsonMap, req: Request): Promise<Response> {
  const client = clean(body.client);
  const folderId = driveFolderId(clean(body.folder_url) || clean(body.folder_id));
  if (!client || !folderId) return json({ ok: false, error: "client and folder required" }, 400);
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  if (!await previewAllowed(supabase, client, req)) return json({ ok: true, enabled: false });

  const cached = await supabase.from("carousel_folder_preview_cache")
    .select("state,image_count,has_video,first_file_id,checked_at").eq("folder_id", folderId).maybeSingle();
  const row = cached.data as JsonMap | null;
  if (row && !body.refresh) {
    const age = Date.now() - Date.parse(clean(row.checked_at));
    if (isFinite(age) && age < (PREVIEW_TTL_MS[clean(row.state)] ?? 60_000)) {
      return json({ ok: true, enabled: true, cached: true, state: clean(row.state), count: Number(row.image_count) || 0, has_video: !!row.has_video, first_file_id: clean(row.first_file_id) });
    }
  }
  let answer: PreviewAnswer;
  try { answer = await listFolderPublic(folderId); }
  catch (_e) {
    // A failed read is not cached as an answer about the folder; the page keeps today's folder card.
    return json({ ok: true, enabled: true, state: "error", count: 0, has_video: false, first_file_id: "" });
  }
  await supabase.from("carousel_folder_preview_cache").upsert({
    folder_id: folderId, client: slugOf(client), state: answer.state, image_count: answer.count,
    has_video: answer.has_video, first_file_id: answer.first_file_id, checked_at: new Date().toISOString(),
  }, { onConflict: "folder_id" });
  return json({ ok: true, enabled: true, state: answer.state, count: answer.count, has_video: answer.has_video, first_file_id: answer.first_file_id });
}

Deno.serve(async (req: Request) => {
  const started = Date.now();
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "method" }, 405);

  let body: JsonMap;
  try { body = JSON.parse(await req.text()) as JsonMap; }
  catch (_e) { return json({ ok: false, error: "invalid body" }, 400); }

  if (clean(body.action) === "folder_preview") {
    try { return await folderPreview(body, req); }
    catch (_e) { return json({ ok: false, error: "preview failed" }, 500); }
  }

  const surface = clean(body.surface).toLowerCase();
  const table = SURFACES[surface];
  const client = clean(body.client);
  const id = clean(body.id);
  const thumbnailUrl = clean(body.thumbnail_url);
  let outcome = "error";

  try {
    if (!table) return json({ ok: false, error: "surface" }, 400);
    if (!client || !id) return json({ ok: false, error: "client and id required" }, 400);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );

    const current = await readCurrent(supabase, table, client, id);
    if (!current) {
      outcome = "not_found";
      return json({ ok: true, resolved: false, skipped: "not_found" });
    }
    if (clean(current.thumbnail_url) !== thumbnailUrl) {
      outcome = "stale";
      return json({ ok: true, resolved: false, skipped: "stale" });
    }

    if (!thumbnailUrl || isDriveFolderLink(thumbnailUrl)) {
      const patch = blankPatch();
      await writePatch(supabase, table, client, id, patch);
      outcome = "cleared";
      return json({ ok: true, resolved: false, cleared: true, fields: patch });
    }

    const fileId = extractDriveFileId(thumbnailUrl);
    if (!fileId) {
      const patch = blankPatch();
      await writePatch(supabase, table, client, id, patch);
      outcome = "non_drive";
      return json({ ok: true, resolved: false, cleared: true, fields: patch });
    }

    const parents = await fetchDriveParents(fileId);
    const folderId = parents[0] || "";
    const patch: ResolvePatch = {
      thumbnail_folder_url: folderUrl(folderId),
      thumbnail_folder_id: folderId,
      thumbnail_file_id: fileId,
      thumbnail_folder_resolved_at: new Date().toISOString(),
    };
    await writePatch(supabase, table, client, id, patch);
    outcome = folderId ? "resolved" : "no_parent";
    return json({ ok: true, resolved: !!folderId, fields: patch });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "request failed";
    return json({ ok: false, error: msg }, 500);
  } finally {
    console.log(JSON.stringify({
      fn: "thumbnail-folder-resolve",
      surface,
      client,
      id,
      outcome,
      host: hostOf(thumbnailUrl),
      ms: Date.now() - started,
    }));
  }
});
