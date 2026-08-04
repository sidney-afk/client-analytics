import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2.49.8";
import { authorizeBrowserWrite, normalizeBrowserWriteClient } from "../_shared/browser-write-auth.ts";
import type { BrowserWritePrincipal } from "../_shared/browser-write-auth.ts";
import {
  mintReviewToken,
  REVIEW_TOKEN_BYTES,
  reviewTokenAction,
} from "../_shared/client-review-token-policy.mjs";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-syncview-key, x-syncview-actor, x-syncview-role",
  "Cache-Control": "no-store",
};

// PostgreSQL unique_violation. A concurrent staff copy can win the insert; its
// token is then the stored one and this request must return that, not retry.
const DUPLICATE_KEY = "23505";
const PROVISION_NOTE = "Auto-provisioned by client-review-link on first staff share";

type AccessRow = { review_token?: unknown } | null;
type ReadResult = { failed: boolean; row: AccessRow };
type WriteResult = { failed: boolean; wrote: boolean };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

function randomTokenBytes(length: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length));
}

async function readAccessRow(supabase: SupabaseClient, slug: string): Promise<ReadResult> {
  const { data, error } = await supabase.from("client_access").select("review_token").eq("slug", slug).maybeSingle();
  if (error) return { failed: true, row: null };
  return { failed: false, row: (data as AccessRow) ?? null };
}

// Provision the one missing token for an already-authorized, already-active
// client. Never rotates: the mint path is INSERT-only, and the repair path is
// guarded on the exact blank value the row was read as.
async function provisionReviewToken(
  supabase: SupabaseClient,
  slug: string,
  decision: { action: string; staleToken: string | null },
): Promise<WriteResult> {
  const minted = mintReviewToken(randomTokenBytes);
  const stamp = new Date().toISOString();

  if (decision.action === "mint") {
    const { error } = await supabase.from("client_access").insert({
      slug,
      review_token: minted,
      token_rotated_at: stamp,
      notes: PROVISION_NOTE,
    });
    if (error) {
      const code = String((error as { code?: string })?.code || "");
      return { failed: code !== DUPLICATE_KEY, wrote: false };
    }
    return { failed: false, wrote: true };
  }

  let repair = supabase
    .from("client_access")
    .update({ review_token: minted, token_rotated_at: stamp, notes: PROVISION_NOTE })
    .eq("slug", slug);
  repair = decision.staleToken === null
    ? repair.is("review_token", null)
    : repair.eq("review_token", decision.staleToken);
  const { data, error } = await repair.select("slug");
  if (error) return { failed: true, wrote: false };
  return { failed: false, wrote: Array.isArray(data) && data.length === 1 };
}

// Minting a credential leaves a trace, but telemetry never decides whether a
// staff member gets their link — and the token value never reaches this row.
async function recordProvisioning(
  supabase: SupabaseClient,
  slug: string,
  principal: BrowserWritePrincipal,
): Promise<void> {
  try {
    await supabase.from("syncview_auth_events").insert({
      surface: "client-review-link",
      client_slug: slug,
      actor: principal.actor,
      role: principal.role,
      ok: true,
      mode: "staff",
      reason: "review_token_provisioned",
      source: "client-review-link",
      payload: { token_bytes: REVIEW_TOKEN_BYTES },
    });
  } catch (_error) {
    // Best effort only.
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const slug = normalizeBrowserWriteClient(body.client || body.slug);
    if (!slug) return json({ ok: false, error: "invalid_client" }, 400);
    const url = Deno.env.get("SUPABASE_URL");
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !key) return json({ ok: false, error: "service_unavailable" }, 503);
    const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const principal = await authorizeBrowserWrite(supabase, req, slug, "client-review-link");
    if (principal.kind !== "staff") return json({ ok: false, error: "staff_required" }, 403);
    const { data: client, error: clientError } = await supabase.from("clients").select("slug,active").eq("slug", slug).maybeSingle();
    if (clientError) return json({ ok: false, error: "authorization_unavailable" }, 503);
    if (!client || client.active !== true) return json({ ok: false, error: "inactive_client" }, 410);

    const stored = await readAccessRow(supabase, slug);
    if (stored.failed) return json({ ok: false, error: "authorization_unavailable" }, 503);
    let decision = reviewTokenAction(stored.row);
    let provisioned = false;

    // Only the one-time B0 seed ever created `client_access` rows, so a client
    // onboarded after it reached this point with nothing to read and the share
    // button failed closed. A verified staff principal asking for an active
    // client's link is exactly when that token should exist: mint the missing
    // one here rather than handing the SMM an error they cannot clear.
    if (decision.action !== "reuse") {
      const write = await provisionReviewToken(supabase, slug, decision);
      if (write.failed) return json({ ok: false, error: "authorization_unavailable" }, 503);
      provisioned = write.wrote;
      const reread = await readAccessRow(supabase, slug);
      if (reread.failed) return json({ ok: false, error: "authorization_unavailable" }, 503);
      decision = reviewTokenAction(reread.row);
    }

    // Still fails closed: a token that could not be read back is never guessed.
    if (decision.action !== "reuse") return json({ ok: false, error: "review_token_missing" }, 409);
    if (provisioned) await recordProvisioning(supabase, slug, principal);
    return json({ ok: true, client: slug, token: decision.token, provisioned });
  } catch (error) {
    const status = Number((error as { status?: number })?.status || 500);
    const code = String((error as { code?: string })?.code || "request_failed");
    return json({ ok: false, error: code }, status);
  }
});
