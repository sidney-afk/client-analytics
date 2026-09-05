// Pasted description images: the write half of docs/ops/DESCRIPTION_IMAGE_UPLOAD.md.
//
// The browser pastes a screenshot into a SyncLinear description, posts the
// bytes here, and receives a durable public URL it inserts as markdown
// `![alt](https://…)`. That markdown renders in SyncView (#1204) and is
// mirrored to Linear verbatim, where Linear renders it as an image itself.
//
// WHY A FUNCTION AND NOT A BROWSER UPLOAD. Nothing in this estate hands the
// browser a key that can write Storage, and an upload path is the worst place
// to start. Every object in the bucket is created here, under the service
// role, bound to ONE verified active roster member, after the bytes themselves
// (not the label) have been checked.
//
// THE THREE CONDITIONS, all required, all fail-closed (policy.mjs verifyImage):
//   1. the DECLARED content type is on the allowlist;
//   2. the MAGIC BYTES identify a type on the allowlist and the header parses
//      to real pixel dimensions within the ceiling;
//   3. the two AGREE.
// An allowlist applied to a browser-supplied MIME value validates a claim;
// SVG bytes labelled image/png satisfy it. Sniffing NARROWS the set, it never
// widens it. The object is named with a fresh UUID and the extension comes
// from the VERIFIED type, never from the caller's filename or label.

import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2.49.8";
import { matchingRoleForKey, type StaffRoleKey } from "../_shared/staff-role-auth.ts";
import { BUCKET, MAX_BYTES, RATE_LIMIT_PER_HOUR, ROLE_LIMIT_PER_HOUR, verifyImage } from "./policy.mjs";

/* The server-side kill switch. Reverting Pages cannot reach a cached tab or
   a direct authenticated caller, so containment has to live where the write
   does. Fails CLOSED: a missing row, an unreadable row or a malformed value
   all refuse, exactly like quiz_intake_enabled. ROLLBACK.md carries the one
   UPDATE that flips it. */
export const UPLOAD_FLAG = "description_image_upload_enabled";

type JsonMap = Record<string, unknown>;
type Member = {
  id: string;
  name: string;
  role: string;
  team: string | null;
  active: boolean;
};
type Principal = {
  keyRole: StaffRoleKey;
  actorKey: string;
  actorName: string;
  actorRole: string;
};

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": [
    "accept",
    "authorization",
    "apikey",
    "content-type",
    "x-syncview-key",
    "x-syncview-actor",
    "x-syncview-role",
    "x-syncview-source",
    "x-syncview-image-client",
    "x-syncview-image-issue",
  ].join(", "),
  "Cache-Control": "no-store",
};

/* Descriptions are admin/SMM everywhere in the estate (policy.mjs beside
   production-write, staffOperationAllowed), so an image that only a
   description can carry is admin/SMM too. A creative key is authenticated
   but refused, with a 403 that names the rule. */
const UPLOAD_ROLES: ReadonlySet<StaffRoleKey> = new Set<StaffRoleKey>(["admin", "smm"]);

class UploadError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

function json(body: JsonMap, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

function clean(value: unknown): string {
  return String(value == null ? "" : value).trim();
}

function normalizeActor(value: unknown): string {
  let text = clean(value).toLowerCase();
  try {
    text = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  } catch (_error) {
    // Exact ASCII roster names remain usable if normalization is unavailable.
  }
  return text.replace(/[^a-z0-9@.]+/g, "");
}

function roleCompatible(keyRole: StaffRoleKey, memberRole: string): boolean {
  const role = clean(memberRole).toLowerCase();
  if (keyRole === "admin") return role === "admin";
  if (keyRole === "smm") return role === "smm";
  return role === "editor" || role === "designer";
}

/* A slug or an issue id travels in a header so the body can stay raw bytes.
   Both are attribution only -- neither gates the write -- so they are
   bounded and otherwise accepted as given. */
function attributionHeader(req: Request, name: string): string | null {
  const value = clean(req.headers.get(name)).slice(0, 160);
  return value ? value : null;
}

async function authorize(supabase: SupabaseClient, req: Request): Promise<Principal> {
  const key = clean(req.headers.get("x-syncview-key"));
  if (!key) throw new UploadError(401, "credentials_required");
  const keyRole = matchingRoleForKey(key);
  if (!keyRole) throw new UploadError(401, "invalid_staff_key");
  const requestedActor = normalizeActor(req.headers.get("x-syncview-actor"));
  if (!requestedActor) throw new UploadError(403, "roster_actor_required");

  const { data, error } = await supabase
    .from("team_members")
    .select("id,name,role,team,active")
    .eq("active", true);
  if (error) throw new UploadError(503, "authorization_unavailable");
  const matches = ((data || []) as Member[]).filter((member) =>
    normalizeActor(member.name) === requestedActor && roleCompatible(keyRole, member.role)
  );
  if (matches.length !== 1) throw new UploadError(403, "roster_actor_not_unique");
  /* Authenticated as one real person FIRST, then refused by role, so a
     creative gets a 403 that names the rule rather than a 401 that reads as a
     bad key and signs them out. */
  if (!UPLOAD_ROLES.has(keyRole)) throw new UploadError(403, "operation_forbidden");
  const member = matches[0];
  return {
    keyRole,
    actorKey: `member:${clean(member.id)}`,
    actorName: clean(member.name),
    actorRole: clean(member.role).toLowerCase(),
  };
}

async function uploadEnabled(supabase: SupabaseClient): Promise<boolean> {
  try {
    const { data, error } = await supabase.from("syncview_runtime_flags")
      .select("value")
      .eq("key", UPLOAD_FLAG)
      .maybeSingle();
    if (error || !data) return false;
    const value = (data as { value: unknown }).value;
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    return !!parsed && (parsed as Record<string, unknown>).enabled === true;
  } catch (_error) {
    return false;
  }
}

/* RESERVE, THEN COUNT. The ledger row is written BEFORE the object, and the
   count that decides the rate limit includes the caller's own row. Two
   requests racing at the ceiling therefore both see a total above it and
   both withdraw; a count taken before the insert would let every concurrent
   request through on the same stale number -- which is exactly what a
   dropped folder of ten screenshots does, since the browser starts every
   file without awaiting. Raised by Codex on #1310. Over-refusal at the
   boundary is the accepted cost; the bound itself cannot be exceeded. */
async function reserveLedgerRow(
  supabase: SupabaseClient,
  row: Record<string, unknown>,
): Promise<string> {
  const { data, error } = await supabase.from("description_images")
    .insert(row)
    .select("id")
    .single();
  if (error || !data) throw new UploadError(503, "ledger_write_failed");
  const id = clean((data as { id: unknown }).id);
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  /* Two counts, both including this row. The per-actor one is the everyday
     bound. The per-ROLE one is the bound a stolen key cannot dodge: the actor
     header is caller-chosen, the role secret is not, and `actor_role` is the
     role that secret resolved to (admin or smm here), so it is server-derived
     rather than claimed. Codex on #1310, round two. */
  const [actorCount, roleCount] = await Promise.all([
    supabase.from("description_images")
      .select("id", { count: "exact", head: true })
      .eq("actor_key", String(row.actor_key))
      .gte("created_at", since),
    supabase.from("description_images")
      .select("id", { count: "exact", head: true })
      .eq("actor_role", String(row.actor_role))
      .gte("created_at", since),
  ]);
  /* The ledger IS the limiter. If it cannot be read the write cannot be
     bounded, so the reservation is withdrawn and the write does not happen. */
  if (actorCount.error || roleCount.error) {
    await supabase.from("description_images").delete().eq("id", id);
    throw new UploadError(503, "rate_limit_unavailable");
  }
  if ((actorCount.count || 0) > RATE_LIMIT_PER_HOUR || (roleCount.count || 0) > ROLE_LIMIT_PER_HOUR) {
    await supabase.from("description_images").delete().eq("id", id);
    throw new UploadError(429, "rate_limited");
  }
  return id;
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  const url = clean(Deno.env.get("SUPABASE_URL"));
  const serviceKey = clean(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
  if (!url || !serviceKey) return json({ ok: false, error: "service_unavailable" }, 503);
  const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

  if (!(await uploadEnabled(supabase))) return json({ ok: false, error: "upload_disabled" }, 503);

  let principal: Principal;
  try {
    principal = await authorize(supabase, req);
  } catch (error) {
    if (error instanceof UploadError) return json({ ok: false, error: error.code }, error.status);
    return json({ ok: false, error: "authorization_unavailable" }, 503);
  }

  /* Refuse an oversize upload from its declared length, before buffering it.
     The exact byte count is checked again below on what actually arrived. */
  const declaredBytes = Number(req.headers.get("content-length") || 0);
  if (Number.isFinite(declaredBytes) && declaredBytes > MAX_BYTES) {
    return json({ ok: false, error: "image_too_large", max_bytes: MAX_BYTES }, 413);
  }

  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await req.arrayBuffer());
  } catch (_error) {
    return json({ ok: false, error: "invalid_body" }, 400);
  }

  const verdict = verifyImage(clean(req.headers.get("content-type")), bytes);
  if (!verdict.ok) return json({ ok: false, error: verdict.error, max_bytes: MAX_BYTES }, verdict.status);

  /* The path and its public URL are known before any byte is written, so the
     ledger row can be reserved first and the object created second. No row,
     no object: an object the ledger does not know about is one the rate
     limit cannot count and the audit trail cannot explain. */
  const storagePath = `${crypto.randomUUID()}.${verdict.extension}`;
  const { data: publicData } = supabase.storage.from(BUCKET).getPublicUrl(storagePath);
  const publicUrl = clean(publicData && publicData.publicUrl);
  if (!publicUrl.startsWith("https://")) return json({ ok: false, error: "public_url_unavailable" }, 503);

  let ledgerId: string;
  try {
    ledgerId = await reserveLedgerRow(supabase, {
      storage_path: storagePath,
      public_url: publicUrl,
      mime_type: verdict.mime,
      byte_length: bytes.byteLength,
      width: verdict.width,
      height: verdict.height,
      actor_key: principal.actorKey,
      actor_name: principal.actorName,
      actor_role: principal.actorRole,
      client_slug: attributionHeader(req, "x-syncview-image-client"),
      deliverable_id: attributionHeader(req, "x-syncview-image-issue"),
    });
  } catch (error) {
    if (error instanceof UploadError) {
      return json({ ok: false, error: error.code, per_hour: RATE_LIMIT_PER_HOUR }, error.status);
    }
    return json({ ok: false, error: "ledger_write_failed" }, 503);
  }

  const { error: uploadError } = await supabase.storage.from(BUCKET).upload(storagePath, bytes, {
    contentType: verdict.mime,
    cacheControl: "31536000",
    upsert: false,
  });
  if (uploadError) {
    /* The reservation is withdrawn with the object it was for, so a failed
       write neither counts against the actor nor leaves a row pointing at
       nothing. */
    await supabase.from("description_images").delete().eq("id", ledgerId);
    return json({ ok: false, error: "storage_write_failed" }, 503);
  }

  return json({
    ok: true,
    url: publicUrl,
    mime_type: verdict.mime,
    byte_length: bytes.byteLength,
    width: verdict.width,
    height: verdict.height,
  });
});
