// Supabase Edge Function: kasper-ad-performance-read
//
// Admin-only read API for Kasper's Ad Performance panel (Kasper tab > More >
// Analytics). Reads public.kasper_ad_performance_daily (service role; the
// table has no anon/authenticated access) and returns the daily rows plus a
// computed summary — CPC, landing-page-view rate, and cost-per-booking (both
// including and excluding cancelled bookings) are derived here, never stored,
// so they can never drift from the underlying counts.
//
// Deploy: supabase functions deploy kasper-ad-performance-read --project-ref uzltbbrjidmjwwfakwve --no-verify-jwt
// (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are auto-injected; no secrets needed.)
// Deliberate-manual: no CI deploy path yet, matching workload-plan's first-release
// precedent — the operator deploys and reads back before this joins CI.

import { createClient } from "npm:@supabase/supabase-js@2";
import { authorizeStaffKey, staffAuthFailureStatus } from "../_shared/staff-role-auth.ts";

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-syncview-key, x-syncview-actor, x-syncview-role",
  "Cache-Control": "no-store",
};

type DailyRow = {
  date: string;
  spend: number;
  impressions: number;
  clicks: number;
  landing_page_views: number;
  bookings_all: number;
  bookings_held: number;
};

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

// Guards every division below: 0/0 must render as "no data yet", never NaN or Infinity.
function safeDivide(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}

function summarize(rows: DailyRow[]) {
  const totals = rows.reduce((acc, r) => ({
    spend: acc.spend + Number(r.spend || 0),
    impressions: acc.impressions + Number(r.impressions || 0),
    clicks: acc.clicks + Number(r.clicks || 0),
    landing_page_views: acc.landing_page_views + Number(r.landing_page_views || 0),
    bookings_all: acc.bookings_all + Number(r.bookings_all || 0),
    bookings_held: acc.bookings_held + Number(r.bookings_held || 0),
  }), { spend: 0, impressions: 0, clicks: 0, landing_page_views: 0, bookings_all: 0, bookings_held: 0 });

  return {
    ...totals,
    cpc: safeDivide(totals.spend, totals.clicks),
    landing_page_view_rate: safeDivide(totals.landing_page_views, totals.clicks),
    conversion_rate: safeDivide(totals.bookings_all, totals.landing_page_views),
    cost_per_booking_all: safeDivide(totals.spend, totals.bookings_all),
    cost_per_booking_held: safeDivide(totals.spend, totals.bookings_held),
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "GET") return json({ ok: false, error: "method_not_allowed" }, 405);

  // Kasper-gated: same admin-only pattern as onboarding-full — this exposes
  // real ad spend and booking volume, so only the admin role key opens it.
  const given = (req.headers.get("x-syncview-key") || "").trim();
  const auth = authorizeStaffKey(given, ["admin"]);
  if (!auth.ok) return json({ ok: false, error: auth.role ? "forbidden" : "unauthorized" }, staffAuthFailureStatus(auth));

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data, error } = await supabase
    .from("kasper_ad_performance_daily")
    .select("date,spend,impressions,clicks,landing_page_views,bookings_all,bookings_held")
    .order("date", { ascending: true });
  if (error) return json({ ok: false, error: error.message }, 500);

  const rows = (data || []) as DailyRow[];
  return json({ ok: true, rows, summary: summarize(rows) });
});
