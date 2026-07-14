// Fail-closed authentication shared by browser-callable service-role writers.
//
// A request must present exactly one credential: a configured SyncView staff
// role key or the review token stored for the exact normalized target client.
// Actor, role, and source attribution are minted here; transport headers/body
// fields never decide the persisted principal.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2.49.8";
import {
  matchingRoleForKey,
  timingSafeEqual,
} from "./staff-role-auth.ts";
import {
  browserWriteCredentialMode,
  cleanWriteAuthValue,
  clientWriteAttribution,
  normalizeWriteClient,
  automationWriteAttribution,
  staffWriteAttribution,
  uniqueClientTokenSlug,
} from "./browser-write-auth-policy.mjs";

export type BrowserWritePrincipal = {
  kind: "staff" | "client";
  actor: string;
  role: string;
  source: string;
};

export class BrowserWriteAuthError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string) {
    super(code);
    this.name = "BrowserWriteAuthError";
    this.status = status;
    this.code = code;
  }
}

export function normalizeBrowserWriteClient(value: unknown): string {
  return normalizeWriteClient(value);
}

export async function authorizeBrowserWrite(
  supabase: SupabaseClient,
  req: Request,
  targetClient: unknown,
  surface: string,
): Promise<BrowserWritePrincipal> {
  const targetSlug = normalizeWriteClient(targetClient);
  if (!targetSlug) throw new BrowserWriteAuthError(400, "invalid_client");

  const staffKey = cleanWriteAuthValue(req.headers.get("x-syncview-key"));
  const clientToken = cleanWriteAuthValue(req.headers.get("x-syncview-client-token"));
  const mode = browserWriteCredentialMode(staffKey, clientToken);
  if (mode === "missing") throw new BrowserWriteAuthError(401, "credentials_required");
  if (mode === "ambiguous") throw new BrowserWriteAuthError(401, "ambiguous_credentials");

  if (mode === "staff") {
    const role = matchingRoleForKey(staffKey);
    const automationKey = cleanWriteAuthValue(Deno.env.get("SYNCVIEW_WRITER_STAFF_KEY"));
    const isAutomation = !!automationKey && timingSafeEqual(staffKey, automationKey);
    const principal = role
      ? staffWriteAttribution(role, surface)
      : isAutomation
      ? automationWriteAttribution(surface)
      : null;
    if (!principal) throw new BrowserWriteAuthError(401, "invalid_staff_key");
    return principal as BrowserWritePrincipal;
  }

  const { data, error } = await supabase
    .from("client_access")
    .select("slug,review_token");
  if (error) throw new BrowserWriteAuthError(503, "authorization_unavailable");

  // A token owns exactly one client. Reject duplicate stored tokens instead of
  // allowing the same opaque bearer value to be replayed against a second
  // target row, then bind that unique match to this request's target slug.
  const storedSlug = uniqueClientTokenSlug(data, clientToken, timingSafeEqual);
  // Keep existence, duplicate-token, and scope mismatch failures
  // indistinguishable to callers.
  if (storedSlug !== targetSlug) throw new BrowserWriteAuthError(401, "invalid_client_token");

  // A retained bearer token must stop authorizing writes as soon as its client
  // is offboarded. client_access is intentionally kept separate from client
  // lifecycle state, so validate the owning client immediately before minting
  // a principal. Keep inactive/missing rows on the same opaque deny path.
  const { data: client, error: clientError } = await supabase
    .from("clients")
    .select("slug,active")
    .eq("slug", storedSlug)
    .maybeSingle();
  if (clientError) throw new BrowserWriteAuthError(503, "authorization_unavailable");
  if (!client || client.active !== true) {
    throw new BrowserWriteAuthError(401, "invalid_client_token");
  }

  const principal = clientWriteAttribution(storedSlug, surface);
  if (!principal) throw new BrowserWriteAuthError(401, "invalid_client_token");
  return principal as BrowserWritePrincipal;
}

export function browserWriteAuthResponse(error: unknown): { status: number; code: string } | null {
  return error instanceof BrowserWriteAuthError
    ? { status: error.status, code: error.code }
    : null;
}
