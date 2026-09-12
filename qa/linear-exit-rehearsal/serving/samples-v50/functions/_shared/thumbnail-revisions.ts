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
  checkedBefore?: string;
};

export type ThumbnailRevisionV2Config = {
  mode: "off" | "test" | "on";
  clients: string[];
  activeClients: string[];
};

type DriveMeta = {
  id: string;
  name?: string;
  mimeType?: string;
  modifiedTime?: string;
  md5Checksum?: string;
  headRevisionId?: string;
  size?: string;
};

type Snapshot = {
  path: string;
  contentType: string;
  bytes: number;
};

const BUCKET = "syncview-thumbnail-revisions";
const REASON = "graphic_tweaks_needed";
const CONTINUOUS_REASON = "continuous_watch";
const MAX_BYTES = Math.max(256 * 1024, Number(Deno.env.get("THUMBNAIL_REVISION_MAX_BYTES") || 6 * 1024 * 1024));
const SOURCE_TABLES: Record<string, string> = {
  calendar: "calendar_posts",
  samples: "sample_reviews",
};
const DRIVE_TOKEN_REFRESH_MARGIN_MS = 60 * 1000;
let driveAccessTokenCache: { value: string; expiresAt: number } | null = null;
let driveAccessTokenPromise: Promise<string> | null = null;

function clean(v: unknown): string {
  return String(v == null ? "" : v).trim();
}

export function normalizeThumbnailRevisionClient(v: unknown): string {
  let text = clean(v).toLowerCase();
  try { text = text.normalize("NFD").replace(/[\u0300-\u036f]/g, ""); } catch (_e) {}
  text = text.replace(/^dr\.?\s+/, "");
  text = text.replace(/\s+(?:and|&)\s+/g, "&");
  return text.replace(/[^a-z0-9&]+/g, "");
}

export async function thumbnailRevisionV2Config(
  supabase: SupabaseClient,
): Promise<ThumbnailRevisionV2Config> {
  const [flagRead, activeRead] = await Promise.all([
    supabase.from("syncview_runtime_flags")
      .select("value")
      .eq("key", "thumbnail_revision_v2")
      .maybeSingle(),
    supabase.from("clients").select("slug").eq("active", true),
  ]);
  if (flagRead.error || activeRead.error) throw new Error("thumbnail revision flag read failed");
  const data = flagRead.data;
  const value = data && typeof data.value === "object" && data.value !== null
    ? data.value as JsonMap
    : {};
  const rawMode = clean(value.mode).toLowerCase();
  const mode: "off" | "test" | "on" = rawMode === "on" ? "on" : rawMode === "test" ? "test" : "off";
  const clients = Array.isArray(value.clients)
    ? [...new Set(value.clients.map(normalizeThumbnailRevisionClient).filter(Boolean))]
    : [];
  const activeClients = [...new Set(((activeRead.data || []) as JsonMap[])
    .map((row) => normalizeThumbnailRevisionClient(row.slug)).filter(Boolean))];
  return { mode, clients, activeClients };
}

export function thumbnailRevisionV2AllowsClient(config: ThumbnailRevisionV2Config, client: unknown): boolean {
  const slug = normalizeThumbnailRevisionClient(client);
  if (!slug || !config.activeClients.includes(slug)) return false;
  if (config.mode === "on") return true;
  if (config.mode !== "test") return false;
  return config.clients.includes(slug);
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

async function mintServiceAccountToken(): Promise<string> {
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
  const value = String(body.access_token);
  const reportedExpiresIn = Number(body.expires_in);
  const expiresInSeconds = Number.isFinite(reportedExpiresIn) && reportedExpiresIn > 0
    ? Math.max(60, reportedExpiresIn)
    : 3600;
  driveAccessTokenCache = {
    value,
    expiresAt: Date.now() + expiresInSeconds * 1000,
  };
  return value;
}

async function serviceAccountToken(): Promise<string> {
  const now = Date.now();
  if (driveAccessTokenCache
    && driveAccessTokenCache.expiresAt - DRIVE_TOKEN_REFRESH_MARGIN_MS > now) {
    return driveAccessTokenCache.value;
  }
  if (!driveAccessTokenPromise) {
    driveAccessTokenPromise = mintServiceAccountToken();
  }
  try {
    return await driveAccessTokenPromise;
  } finally {
    driveAccessTokenPromise = null;
  }
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
  const fields = "id,name,mimeType,modifiedTime,md5Checksum,headRevisionId,size";
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
  if (ct.includes("avif")) return "avif";
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
  if (!clean(meta.mimeType).toLowerCase().startsWith("image/")) {
    throw new Error("Drive file is not an image");
  }
  // Drive thumbnailLink and drive.google.com/thumbnail can lag behind the
  // revision metadata that triggered this scan. Archive the authenticated
  // original so "Current" and the advanced metadata always refer to the same
  // bytes; if the original cannot be fetched, defer instead of saving a stale
  // preview as evidence.
  const media = "https://www.googleapis.com/drive/v3/files/" + encodeURIComponent(fileId)
    + "?alt=media&supportsAllDrives=true";
  return imageBytesFrom(await authedFetch(media, {
    cache: "no-store",
    headers: { Accept: "image/*", "Cache-Control": "no-cache" },
  }));
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
  // Fail closed before any Drive read, Storage upload, or revision-table write.
  // The runtime flag is the one-step rollback for the entire v2 path, not just
  // delivery of completed comparisons.
  try {
    const config = await thumbnailRevisionV2Config(input.supabase);
    if (!thumbnailRevisionV2AllowsClient(config, input.client)) {
      return { captured: false, reason: "feature_disabled" };
    }
  } catch (_error) {
    return { captured: false, reason: "feature_config_unavailable" };
  }

  const thumbnailUrl = clean(input.incoming.thumbnail_url || input.existing.thumbnail_url);
  if (!thumbnailUrl) return { captured: false, reason: "missing_thumbnail_url" };
  if (isDriveFolderLink(thumbnailUrl)) return { captured: false, reason: "folder_link" };

  const fileId = extractDriveFileId(thumbnailUrl);
  if (!fileId) return { captured: false, reason: "not_drive_file" };

  try {
    const existing = await input.supabase.from("thumbnail_media_revisions")
      .select("id,status,requested_at")
      .eq("surface", input.surface)
      .eq("client", input.client)
      .eq("source_id", input.sourceId)
      .eq("reason", REASON)
      .eq("status", "pending")
      .limit(1)
      .maybeSingle();
    if (existing.data && existing.data.id) {
      const cycleAt = input.now || new Date().toISOString();
      const existingAt = Date.parse(clean(existing.data.requested_at));
      const nextAt = Date.parse(cycleAt);
      if (Number.isFinite(existingAt) && Number.isFinite(nextAt) && existingAt < nextAt) {
        // A real transition into a new Tweaks cycle supersedes a leftover
        // pending row from an older cycle (including rows stranded before this
        // rollout). A same/newer row is preserved for concurrent retry safety.
        const { data: superseded, error: supersedeError } = await input.supabase.from("thumbnail_media_revisions")
          .update({
            status: "skipped",
            skip_reason: "superseded_by_new_tweak_cycle",
            last_checked_at: cycleAt,
            updated_at: cycleAt,
          })
          .eq("id", existing.data.id)
          .eq("status", "pending")
          .select("id")
          .maybeSingle();
        if (supersedeError || !superseded) {
          return { captured: false, reason: "pending_supersede_failed" };
        }
      } else {
        await input.supabase.from("thumbnail_media_revisions")
          .update({ last_checked_at: cycleAt, updated_at: cycleAt })
          .eq("id", existing.data.id);
        return { captured: false, reason: "pending_exists" };
      }
    }

    const firstMeta = await driveMetadata(fileId);
    const captured = await verifiedSnapshot(
      input.supabase,
      input.surface,
      input.client,
      input.sourceId,
      "baseline",
      fileId,
      firstMeta,
    );
    const meta = captured.meta;
    const snap = captured.snapshot;
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

    // The database write trigger creates the lightweight continuous watcher.
    // Reuse this exact snapshot as its initial Current baseline so the
    // scheduled scanner can detect a replacement even if no later status save
    // occurs in SyncView.
    await input.supabase.from("thumbnail_media_revisions")
      .update({
        thumbnail_url: thumbnailUrl,
        drive_file_id: fileId,
        drive_file_name: clean(meta.name) || null,
        drive_mime_type: clean(meta.mimeType) || null,
        baseline_revision_id: clean(meta.headRevisionId) || null,
        baseline_md5: clean(meta.md5Checksum) || null,
        baseline_modified_time: clean(meta.modifiedTime) || null,
        baseline_storage_path: snap && snap.path,
        baseline_bytes: snap && snap.bytes,
        last_checked_at: now,
        updated_at: now,
      })
      .eq("surface", input.surface)
      .eq("client", input.client)
      .eq("source_id", input.sourceId)
      .eq("reason", CONTINUOUS_REASON)
      .eq("status", "pending")
      .is("baseline_storage_path", null);
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
  const config = await thumbnailRevisionV2Config(input.supabase);
  if (!thumbnailRevisionV2AllowsClient(config, input.client)) {
    return { checked: 0, changed: 0, unchanged: 0, failed: 0, skipped: 0, reason: "feature_disabled" };
  }
  const result = await scanPendingThumbnailRevisions({
    supabase: input.supabase,
    surface: input.surface,
    client: input.client,
    sourceId: input.sourceId,
    limit: 1,
  });
  if (Number(result.checked || 0) > 0
    && Number(result.unchanged || 0) === Number(result.checked || 0)
    && Number(result.changed || 0) === 0
    && Number(result.failed || 0) === 0
    && Number(result.skipped || 0) === 0) {
    const table = SOURCE_TABLES[input.surface];
    const cutoff = input.now || new Date().toISOString();
    if (table) {
      const { data: source, error } = await input.supabase.from(table)
        .select("graphic_status")
        .eq("client", input.client)
        .eq("id", input.sourceId)
        .maybeSingle();
      // A delayed resolution task must never retire a baseline from a newer
      // re-entry into Tweaks. On read failure, preserve the pending row so the
      // next successful scan can retry safely.
      if (!error && source && normStatus((source as JsonMap).graphic_status) !== "Tweaks Needed") {
        await input.supabase.from("thumbnail_media_revisions")
          .update({
            status: "skipped",
            skip_reason: "no_thumbnail_change",
            last_checked_at: cutoff,
            updated_at: cutoff,
          })
          .eq("surface", input.surface)
          .eq("client", input.client)
          .eq("source_id", input.sourceId)
          .eq("reason", REASON)
          .eq("status", "pending")
          .lte("requested_at", cutoff);
      }
    }
  }
  return result;
}

async function activeClient(supabase: SupabaseClient, client: string): Promise<boolean> {
  const { data, error } = await supabase.from("clients")
    .select("slug")
    .eq("slug", client)
    .eq("active", true)
    .maybeSingle();
  if (error) throw new Error("client activity read failed");
  return !!data;
}

async function sourceThumbnail(
  supabase: SupabaseClient,
  surface: string,
  client: string,
  sourceId: string,
): Promise<{ url: string; fileId: string; archived: boolean } | null> {
  const table = SOURCE_TABLES[surface];
  if (!table) throw new Error("invalid revision surface");
  const { data, error } = await supabase.from(table)
    .select("id,thumbnail_url,status")
    .eq("client", client)
    .eq("id", sourceId)
    .maybeSingle();
  if (error) throw new Error("source thumbnail read failed");
  if (!data) return null;
  const row = data as JsonMap;
  const url = clean(row.thumbnail_url);
  return {
    url,
    fileId: extractDriveFileId(url),
    archived: clean(row.status).toLowerCase() === "archived",
  };
}

async function verifiedSnapshot(
  supabase: SupabaseClient,
  surface: string,
  client: string,
  sourceId: string,
  phase: "baseline" | "latest",
  fileId: string,
  firstMeta: DriveMeta,
): Promise<{ meta: DriveMeta; snapshot: Snapshot }> {
  const expectedKey = metadataKey(firstMeta);
  if (!expectedKey) throw new Error("Drive revision metadata unavailable");
  const snapshot = await uploadSnapshot(supabase, surface, client, sourceId, phase, firstMeta);
  if (!snapshot) throw new Error("snapshot upload failed");
  const verifiedMeta = await driveMetadata(fileId);
  if (!metadataKey(verifiedMeta) || metadataKey(verifiedMeta) !== expectedKey) {
    throw new Error("Drive revision changed during snapshot");
  }
  return { meta: verifiedMeta, snapshot };
}

async function adoptPendingTweakBaseline(
  supabase: SupabaseClient,
  watch: JsonMap,
): Promise<JsonMap> {
  if (clean(watch.baseline_storage_path)) return watch;
  const { data, error } = await supabase.from("thumbnail_media_revisions")
    .select("thumbnail_url,drive_file_id,drive_file_name,drive_mime_type,baseline_revision_id,baseline_md5,baseline_modified_time,baseline_storage_path,baseline_bytes")
    .eq("surface", clean(watch.surface))
    .eq("client", clean(watch.client))
    .eq("source_id", clean(watch.source_id))
    .eq("reason", REASON)
    .eq("status", "pending")
    .not("baseline_storage_path", "is", null)
    .order("requested_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error("tweak baseline read failed");
  if (!data) return watch;
  const baseline = data as JsonMap;
  const now = new Date().toISOString();
  const patch = {
    thumbnail_url: clean(baseline.thumbnail_url),
    drive_file_id: clean(baseline.drive_file_id) || null,
    drive_file_name: clean(baseline.drive_file_name) || null,
    drive_mime_type: clean(baseline.drive_mime_type) || null,
    baseline_revision_id: clean(baseline.baseline_revision_id) || null,
    baseline_md5: clean(baseline.baseline_md5) || null,
    baseline_modified_time: clean(baseline.baseline_modified_time) || null,
    baseline_storage_path: clean(baseline.baseline_storage_path),
    baseline_bytes: Number(baseline.baseline_bytes || 0) || null,
    updated_at: now,
  };
  const { data: adopted, error: updateError } = await supabase.from("thumbnail_media_revisions")
    .update(patch)
    .eq("id", clean(watch.id))
    .eq("reason", CONTINUOUS_REASON)
    .eq("status", "pending")
    .is("baseline_storage_path", null)
    .select("id")
    .maybeSingle();
  if (updateError) throw new Error("continuous baseline adoption failed");
  return adopted ? { ...watch, ...patch } : watch;
}

async function initializeContinuousWatch(
  supabase: SupabaseClient,
  watch: JsonMap,
  source: { url: string; fileId: string },
  firstMeta: DriveMeta,
): Promise<boolean> {
  const captured = await verifiedSnapshot(
    supabase,
    clean(watch.surface),
    clean(watch.client),
    clean(watch.source_id),
    "baseline",
    source.fileId,
    firstMeta,
  );
  const verify = await sourceThumbnail(
    supabase,
    clean(watch.surface),
    clean(watch.client),
    clean(watch.source_id),
  );
  if (!verify || verify.archived || verify.url !== source.url || verify.fileId !== source.fileId) return false;
  const now = new Date().toISOString();
  const { data, error } = await supabase.from("thumbnail_media_revisions")
    .update({
      thumbnail_url: source.url,
      drive_file_id: source.fileId,
      drive_file_name: clean(captured.meta.name) || null,
      drive_mime_type: clean(captured.meta.mimeType) || null,
      baseline_revision_id: clean(captured.meta.headRevisionId) || null,
      baseline_md5: clean(captured.meta.md5Checksum) || null,
      baseline_modified_time: clean(captured.meta.modifiedTime) || null,
      baseline_storage_path: captured.snapshot.path,
      baseline_bytes: captured.snapshot.bytes,
      last_checked_at: now,
      error: null,
      updated_at: now,
    })
    .eq("id", clean(watch.id))
    .eq("reason", CONTINUOUS_REASON)
    .eq("status", "pending")
    .is("baseline_storage_path", null)
    .select("id")
    .maybeSingle();
  if (error) throw new Error("continuous baseline initialization failed");
  return !!data;
}

export async function scanPendingThumbnailRevisions(input: ScanInput): Promise<JsonMap> {
  const limit = Math.min(Math.max(Number(input.limit || 25), 1), 50);
  const { error: backfillError } = await input.supabase.rpc("syncview_thumbnail_revision_backfill", {
    p_surface: clean(input.surface) || null,
    p_client: clean(input.client) || null,
    p_source_id: clean(input.sourceId) || null,
    p_limit: limit,
  });
  if (backfillError) throw new Error("continuous watch backfill failed");

  let query = input.supabase.from("thumbnail_media_revisions")
    .select("*")
    .eq("status", "pending")
    .eq("reason", CONTINUOUS_REASON)
    .order("last_checked_at", { ascending: true, nullsFirst: true })
    .order("requested_at", { ascending: true })
    .limit(limit);
  if (input.surface) query = query.eq("surface", input.surface);
  if (input.client) query = query.eq("client", input.client);
  if (input.sourceId) query = query.eq("source_id", input.sourceId);
  if (input.checkedBefore) {
    query = query.or(`last_checked_at.is.null,last_checked_at.lt.${input.checkedBefore}`);
  }

  const { data, error } = await query;
  if (error) throw error;

  const rows = Array.isArray(data) ? data as JsonMap[] : [];
  const out = { checked: 0, changed: 0, unchanged: 0, failed: 0, skipped: 0, items: [] as JsonMap[] };
  const activeClients = new Map<string, boolean>();

  for (const originalRow of rows) {
    let row = originalRow;
    const id = clean(row.id);
    const surface = clean(row.surface);
    const client = clean(row.client);
    const sourceId = clean(row.source_id);
    out.checked++;

    try {
      if (!activeClients.has(client)) activeClients.set(client, await activeClient(input.supabase, client));
      const source = await sourceThumbnail(input.supabase, surface, client, sourceId);
      if (!activeClients.get(client) || !source || source.archived || !source.url || !source.fileId) {
        out.skipped++;
        const now = new Date().toISOString();
        await input.supabase.from("thumbnail_media_revisions")
          .update({
            status: "skipped",
            skip_reason: !activeClients.get(client) ? "inactive_client" : "source_not_active_drive_thumbnail",
            last_checked_at: now,
            updated_at: now,
          })
          .eq("id", id)
          .eq("status", "pending");
        out.items.push({ id, status: "skipped" });
        continue;
      }

      row = await adoptPendingTweakBaseline(input.supabase, row);
      const meta = await driveMetadata(source.fileId);
      if (!metadataKey(meta)) throw new Error("Drive revision metadata unavailable");

      if (!clean(row.baseline_storage_path) || !revisionKey(row)) {
        const initialized = await initializeContinuousWatch(input.supabase, row, source, meta);
        if (initialized) {
          out.unchanged++;
          out.items.push({ id, status: "initialized" });
        } else {
          out.skipped++;
          const checkedAt = new Date().toISOString();
          await input.supabase.from("thumbnail_media_revisions")
            .update({ last_checked_at: checkedAt, updated_at: checkedAt })
            .eq("id", id)
            .eq("status", "pending");
          out.items.push({ id, status: "stale_source" });
        }
        continue;
      }

      const mediaChanged = clean(row.thumbnail_url) !== source.url
        || clean(row.drive_file_id) !== source.fileId;
      const changed = mediaChanged || metadataKey(meta) !== revisionKey(row);
      if (!changed) {
        out.unchanged++;
        const checkedAt = new Date().toISOString();
        await input.supabase.from("thumbnail_media_revisions")
          .update({
            last_checked_at: checkedAt,
            error: null,
            updated_at: checkedAt,
          })
          .eq("id", id)
          .eq("status", "pending");
        out.items.push({ id, status: "unchanged" });
        continue;
      }

      const captured = await verifiedSnapshot(
        input.supabase,
        surface,
        client,
        sourceId,
        "latest",
        source.fileId,
        meta,
      );
      const { data: thumbRev, error: rotateError } = await input.supabase.rpc(
        "syncview_thumbnail_revision_rotate",
        {
          p_watch_id: id,
          p_surface: surface,
          p_client: client,
          p_source_id: sourceId,
          p_expected_thumbnail_url: source.url,
          p_expected_drive_file_id: source.fileId,
          p_latest_file_name: clean(captured.meta.name) || null,
          p_latest_mime_type: clean(captured.meta.mimeType) || null,
          p_latest_revision_id: clean(captured.meta.headRevisionId) || null,
          p_latest_md5: clean(captured.meta.md5Checksum) || null,
          p_latest_modified_time: clean(captured.meta.modifiedTime) || null,
          p_latest_storage_path: captured.snapshot.path,
          p_latest_bytes: captured.snapshot.bytes,
        },
      );
      if (rotateError) throw new Error("revision rotation failed");
      if (!clean(thumbRev)) {
        out.skipped++;
        const checkedAt = new Date().toISOString();
        await input.supabase.from("thumbnail_media_revisions")
          .update({ last_checked_at: checkedAt, updated_at: checkedAt })
          .eq("id", id)
          .eq("status", "pending");
        out.items.push({ id, status: "stale_source" });
        continue;
      }
      out.changed++;
      out.items.push({ id, status: "changed", thumb_rev: thumbRev });
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
