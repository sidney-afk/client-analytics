// Pure rules for syncview-session (SyncView v2 login pass). No I/O, so
// test/syncview-session.js can exercise every branch offline.
//
// The function turns a Supabase guest (anonymous) login into a SyncView
// session by writing two claims into that guest's app_metadata, which only the
// service role can write and which Supabase copies into every access token:
//   svc_scope  "staff" | "client"
//   svc_client the verified client slug (client sessions), "" for staff
//   svc_role   the staff role key (staff sessions), "" for clients
//   svc_expires_at  ISO time the stamp stops counting (STAMP_TTL_MS)
// Row rules must require svc_scope (and svc_client for client rows) AND an
// unexpired svc_expires_at, never is_anonymous or the authenticated role alone.
// Design record: docs/ops/SYNCVIEW_SESSION.md.

export const SESSION_VERSION = 1;
/** How long a stamp is valid. A refresh keeps app_metadata, so the expiry is
 *  what bounds a stamp after its key or token is revoked or its client is
 *  offboarded: every row rule must also require svc_expires_at > now(), and v2
 *  re-runs this function (re-checking the credential) before it lapses. */
export const STAMP_TTL_MS = 8 * 60 * 60 * 1000;

/** The bearer token of the caller's own guest login. */
export function bearerToken(header) {
  const m = /^Bearer\s+(.+)$/i.exec(String(header || "").trim());
  return m ? m[1].trim() : "";
}

/** Only a guest (anonymous) Supabase user may be stamped. Returns a refusal code or "". */
export function guestRefusal(user) {
  if (!user || typeof user !== "object" || !user.id) return "session_required";
  if (user.is_anonymous !== true) return "guest_session_required";
  return "";
}

/** The app_metadata patch for a verified principal. Every key is always written,
 *  so a guest re-stamped from client to staff (or to another client) keeps no
 *  stale scope. Returns null for anything that is not a verified principal. */
export function sessionClaims(principal, now) {
  if (!principal || typeof principal !== "object") return null;
  const stamped = new Date(now).toISOString();
  const expires = new Date(now + STAMP_TTL_MS).toISOString();
  if (principal.kind === "staff") {
    const role = String(principal.role || "").trim();
    if (!["admin", "smm", "creative"].includes(role)) return null;
    return { svc_scope: "staff", svc_client: "", svc_role: role, svc_version: SESSION_VERSION, svc_stamped_at: stamped, svc_expires_at: expires };
  }
  if (principal.kind === "client") {
    const slug = String(principal.slug || "").trim();
    if (!slug) return null;
    return { svc_scope: "client", svc_client: slug, svc_role: "", svc_version: SESSION_VERSION, svc_stamped_at: stamped, svc_expires_at: expires };
  }
  return null;
}
