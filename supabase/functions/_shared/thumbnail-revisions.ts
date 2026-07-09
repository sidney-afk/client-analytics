// Shared thumbnail revision archive helpers.
//
// A baseline is captured when a graphic/thumbnail component enters
// "Tweaks Needed". Later scans compare the Drive file's current revision
// metadata to that baseline and attach an "after" snapshot when it changes.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2.49.8";

type JsonMap = Record<string, unknown>;

type Actor = {
  actor?: string | null;
  role?: string | null;
  source?: string | null;
};

type CaptureInput = {
  supabase: SupabaseClient;
  surface: "calendar" | "samples";
  client: string;
  sourceId: string;
  incoming: JsonMap;
  patch: JsonMap;
  existing: JsonMap;
  actor?: Actor;
  now?: string;
};

type ScanInput = {
  supabase: SupabaseClient;
  surface?: string;
  client?: string;
  sourceId?: string;
  limit?: number;
};

type DriveMeta = {
  id: string;
  name?: string;
  mimeType?: string;
  modifiedTime?: string;
  md5Checksum?: string;
  headRevisionId?: string;
  size?: string;
  thumbnailLink?: string;
};

type Snapshot = {
  path: string;
  contentType: string;
  bytes: number;
};

const BUCKET = "syncview-thumbnail-revisions";
const REASON = "graphic_tweaks_needed";
const MAX_BYTES = Math.max(256 * 1024, Number(Deno.env.get("THUMBNAIL_REVISION_MAX_BYTES") || 6 * 1024 * 1024));

function clean(v: unknown): string {
  return String(v == null ? "" : v).trim();
}

function has(o: JsonMap, k: string): boolean {
  return Object.prototype.hasOwnProperty.call(o, k);
}

function sv(o: JsonMap | null | undefined, k: string): string {
  return String(o && o[k] == null ? "" : o ? o[k] : "");
}

function normStatus(v: unknown): string {
  const s = clean(v).toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
  if (s.includes("tweak")) return "Tweaks Needed";
  return clean(v);
}

function addScheme(url: string): string {
  if (!url) return "";
  return /^https?:\/\//i.test(url) ? url : "https://" + url;
}

export function isDriveFolderLink(url: string): boolean {
  const u = clean(url);
  if (!u) return false;
  if (/drive\.google\.com\/(?:drive\/)?(?:u\/\d+\/)?folders\//i.test(u)) return true;
  if (/drive\.google\.com\/folderview\?/i.test(u)) return true;
  return false;
}

export function extractDriveFileId(input: string): string {
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

export function shouldCaptureGraphicTweakBaseline(patch: JsonMap, incoming: JsonMap, existing: JsonMap): boolean {
  if (!has(patch, "graphic_status")) return false;
  const before = normStatus(sv(existing, "graphic_status"));
  const after = normStatus(sv(incoming, "graphic_status"));
  return after === "Tweaks Needed" && before !== "Tweaks Needed";
}

export function shouldScanGraphicTweakResolution(patch: JsonMap, incoming: JsonMap, existing: JsonMap): boolean {
  if (!has(patch, "graphic_status")) return false;
  const before = normStatus(sv(existing, "graphic_status"));
  const after = normStatus(sv(incoming, "graphic_status"));
  return before === "Tweaks Needed" && after !== "Tweaks Needed";
}

function serviceAccountConfigured(): boolean {
  if (clean(Deno.env.get("GOOGLE_SERVICE_ACCOUNT_JSON"))) return true;
  return !!(clean(Deno.env.get("GOOGLE_CLIENT_EMAIL")) && clean(Deno.env.get("GOOGLE_PRIVATE_KEY")));
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
    scope: "https://www.googleapis.com/auth/drive.readonly",
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

async function authedFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const apiKey = clean(Deno.env.get("GOOGLE_DRIVE_API_KEY"));
  if (apiKey) {
    const sep = url.includes("?") ? "&" : "?";
    const resp = await fetch(url + sep + "key=" + encodeURIComponent(apiKey), init);
    if (resp.ok || !serviceAccountConfigured()) return resp;
  }
  const token = await serviceAccountToken();
  const headers = new Headers(init.headers || {});
  headers.set("Authorization", "Bearer " + token);
  return fetch(url, { ...init, headers });
}

async function driveMetadata(fileId: string): Promise<DriveMeta> {
  const fields = "id,name,mimeType,modifiedTime,md5Checksum,headRevisionId,size,thumbnailLink";
  const url = "https://www.googleapis.com/drive/v3/files/" + encodeURIComponent(fileId)
    + "?fields=" + encodeURIComponent(fields)
    + "&supportsAllDrives=true";
  const resp = await authedFetch(url, { headers: { Accept: "application/json" } });
  const body = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const msg = clean((body && (body.error as JsonMap)?.message) || body.error_description) || ("Drive HTTP " + resp.status);
    throw new Error(msg);
  }
  return body as DriveMeta;
}

function safeSegment(v: unknown): string {
  return clean(v).toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 96) || "item";
}

function extFor(contentType: string): string {
  const ct = contentType.toLowerCase();
  if (ct.includes("png")) return "png";
  if (ct.includes("webp")) return "webp";
  if (ct.includes("gif")) return "gif";
  return "jpg";
}

async function imageBytesFrom(resp: Response): Promise<{ bytes: Uint8Array; contentType: string }> {
  const contentType = clean(resp.headers.get("content-type")).split(";")[0] || "image/jpeg";
  if (!resp.ok) throw new Error("snapshot HTTP " + resp.status);
  if (!contentType.toLowerCase().startsWith("image/")) throw new Error("snapshot response was not an image");
  const len = Number(resp.headers.get("content-length") || 0);
  if (len > MAX_BYTES) throw new Error("snapshot too large");
  const buf = new Uint8Array(await resp.arrayBuffer());
  if (buf.byteLength > MAX_BYTES) throw new Error("snapshot too large");
  return { bytes: buf, contentType };
}

async function downloadSnapshot(fileId: string, meta: DriveMeta): Promise<{ bytes: Uint8Array; contentType: string }> {
  const urls = [
    clean(meta.thumbnailLink),
    "https://drive.google.com/thumbnail?id=" + encodeURIComponent(fileId) + "&sz=w1200",
  ].filter(Boolean);

  for (const url of urls) {
    try {
      const resp = await fetch(url, { redirect: "follow" });
      return await imageBytesFrom(resp);
    } catch (_e) {
      // Fall through to the Drive media endpoint.
    }
  }

  const media = "https://www.googleapis.com/drive/v3/files/" + encodeURIComponent(fileId)
    + "?alt=media&supportsAllDrives=true";
  return imageBytesFrom(await authedFetch(media));
}

async function uploadSnapshot(
  supabase: SupabaseClient,
  surface: string,
  client: string,
  sourceId: string,
  phase: "baseline" | "latest",
  meta: DriveMeta,
): Promise<Snapshot | null> {
  const dl = await downloadSnapshot(clean(meta.id), meta);
  const rev = safeSegment(meta.headRevisionId || meta.md5Checksum || meta.modifiedTime || Date.now());
  const path = [
    safeSegment(surface),
    safeSegment(client),
    safeSegment(sourceId),
    phase + "-" + rev + "." + extFor(dl.contentType),
  ].join("/");
  const { error } = await supabase.storage.from(BUCKET).upload(path, dl.bytes, {
    cacheControl: "31536000",
    contentType: dl.contentType,
    upsert: true,
  });
  if (error) throw new Error("snapshot upload failed: " + error.message);
  return { path, contentType: dl.contentType, bytes: dl.bytes.byteLength };
}

function revisionKey(row: JsonMap): string {
  return clean(row.baseline_revision_id || row.latest_revision_id)
    || clean(row.baseline_md5 || row.latest_md5)
    || clean(row.baseline_modified_time || row.latest_modified_time);
}

function metadataKey(meta: DriveMeta): string {
  return clean(meta.headRevisionId) || clean(meta.md5Checksum) || clean(meta.modifiedTime);
}

async function upsertError(
  supabase: SupabaseClient,
  input: CaptureInput,
  thumbnailUrl: string,
  fileId: string,
  message: string,
): Promise<void> {
  await supabase.from("thumbnail_media_revisions").insert({
    surface: input.surface,
    client: input.client,
    source_id: input.sourceId,
    component: "graphic",
    status: "error",
    reason: REASON,
    thumbnail_url: thumbnailUrl,
    drive_file_id: fileId || null,
    requested_at: input.now || new Date().toISOString(),
    requested_by: clean(input.actor?.actor) || null,
    request_role: clean(input.actor?.role) || null,
    error: message.slice(0, 500),
  });
}

export async function captureGraphicTweakBaseline(input: CaptureInput): Promise<{ captured: boolean; reason?: string }> {
  if (!shouldCaptureGraphicTweakBaseline(input.patch, input.incoming, input.existing)) {
    return { captured: false, reason: "not_graphic_tweaks_needed_transition" };
  }

  const thumbnailUrl = clean(input.incoming.thumbnail_url || input.existing.thumbnail_url);
  if (!thumbnailUrl) return { captured: false, reason: "missing_thumbnail_url" };
  if (isDriveFolderLink(thumbnailUrl)) return { captured: false, reason: "folder_link" };

  const fileId = extractDriveFileId(thumbnailUrl);
  if (!fileId) return { captured: false, reason: "not_drive_file" };

  try {
    const existing = await input.supabase.from("thumbnail_media_revisions")
      .select("id,status")
      .eq("surface", input.surface)
      .eq("client", input.client)
      .eq("source_id", input.sourceId)
      .eq("reason", REASON)
      .eq("status", "pending")
      .limit(1)
      .maybeSingle();
    if (existing.data && existing.data.id) {
      await input.supabase.from("thumbnail_media_revisions")
        .update({ last_checked_at: input.now || new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq("id", existing.data.id);
      return { captured: false, reason: "pending_exists" };
    }

    const meta = await driveMetadata(fileId);
    const snap = await uploadSnapshot(input.supabase, input.surface, input.client, input.sourceId, "baseline", meta);
    const now = input.now || new Date().toISOString();
    const { error } = await input.supabase.from("thumbnail_media_revisions").insert({
      surface: input.surface,
      client: input.client,
      source_id: input.sourceId,
      component: "graphic",
      status: "pending",
      reason: REASON,
      thumbnail_url: thumbnailUrl,
      drive_file_id: fileId,
      drive_file_name: clean(meta.name) || null,
      drive_mime_type: clean(meta.mimeType) || null,
      baseline_revision_id: clean(meta.headRevisionId) || null,
      baseline_md5: clean(meta.md5Checksum) || null,
      baseline_modified_time: clean(meta.modifiedTime) || null,
      baseline_storage_path: snap && snap.path,
      baseline_bytes: snap && snap.bytes,
      requested_at: now,
      requested_by: clean(input.actor?.actor) || null,
      request_role: clean(input.actor?.role) || null,
      last_checked_at: now,
    });
    if (error) throw error;
    return { captured: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "thumbnail revision capture failed";
    await upsertError(input.supabase, input, thumbnailUrl, fileId, msg).catch(() => null);
    return { captured: false, reason: msg };
  }
}

export async function scanGraphicTweakResolution(input: CaptureInput): Promise<JsonMap> {
  if (!shouldScanGraphicTweakResolution(input.patch, input.incoming, input.existing)) {
    return { checked: 0, changed: 0, unchanged: 0, failed: 0, skipped: 0, reason: "not_graphic_tweaks_resolved_transition" };
  }
  return await scanPendingThumbnailRevisions({
    supabase: input.supabase,
    surface: input.surface,
    client: input.client,
    sourceId: input.sourceId,
    limit: 1,
  });
}

export async function scanPendingThumbnailRevisions(input: ScanInput): Promise<JsonMap> {
  const limit = Math.min(Math.max(Number(input.limit || 25), 1), 100);
  let query = input.supabase.from("thumbnail_media_revisions")
    .select("*")
    .eq("status", "pending")
    .order("requested_at", { ascending: true })
    .limit(limit);
  if (input.surface) query = query.eq("surface", input.surface);
  if (input.client) query = query.eq("client", input.client);
  if (input.sourceId) query = query.eq("source_id", input.sourceId);

  const { data, error } = await query;
  if (error) throw error;

  const rows = Array.isArray(data) ? data as JsonMap[] : [];
  const out = { checked: 0, changed: 0, unchanged: 0, failed: 0, skipped: 0, items: [] as JsonMap[] };

  for (const row of rows) {
    const id = clean(row.id);
    const fileId = clean(row.drive_file_id);
    out.checked++;
    if (!fileId) {
      out.skipped++;
      await input.supabase.from("thumbnail_media_revisions")
        .update({ status: "skipped", skip_reason: "missing_drive_file_id", updated_at: new Date().toISOString() })
        .eq("id", id);
      out.items.push({ id, status: "skipped" });
      continue;
    }

    try {
      const meta = await driveMetadata(fileId);
      const changed = metadataKey(meta) && metadataKey(meta) !== revisionKey(row);
      if (!changed) {
        out.unchanged++;
        await input.supabase.from("thumbnail_media_revisions")
          .update({
            last_checked_at: new Date().toISOString(),
            latest_revision_id: clean(meta.headRevisionId) || null,
            latest_md5: clean(meta.md5Checksum) || null,
            latest_modified_time: clean(meta.modifiedTime) || null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", id);
        out.items.push({ id, status: "unchanged" });
        continue;
      }

      const snap = await uploadSnapshot(
        input.supabase,
        clean(row.surface),
        clean(row.client),
        clean(row.source_id),
        "latest",
        meta,
      );
      out.changed++;
      await input.supabase.from("thumbnail_media_revisions")
        .update({
          status: "changed",
          latest_revision_id: clean(meta.headRevisionId) || null,
          latest_md5: clean(meta.md5Checksum) || null,
          latest_modified_time: clean(meta.modifiedTime) || null,
          latest_storage_path: snap && snap.path,
          latest_bytes: snap && snap.bytes,
          changed_at: clean(meta.modifiedTime) || new Date().toISOString(),
          detected_at: new Date().toISOString(),
          last_checked_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", id);
      out.items.push({ id, status: "changed" });
    } catch (e) {
      out.failed++;
      const msg = e instanceof Error ? e.message : "scan failed";
      await input.supabase.from("thumbnail_media_revisions")
        .update({ error: msg.slice(0, 500), last_checked_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq("id", id);
      out.items.push({ id, status: "failed", error: msg });
    }
  }

  return out;
}
