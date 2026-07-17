// Supabase Edge Function: thumbnail-folder-resolve
//
// Resolves the parent Google Drive folder for a card thumbnail file URL and
// stores it back onto calendar_posts or sample_reviews. Browser callers provide
// the surface/client/id/thumbnail_url they just saved; this function rereads the
// row first and refuses stale writes when the stored thumbnail_url differs.
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

Deno.serve(async (req: Request) => {
  const started = Date.now();
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "method" }, 405);

  let body: JsonMap;
  try { body = JSON.parse(await req.text()) as JsonMap; }
  catch (_e) { return json({ ok: false, error: "invalid body" }, 400); }

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
