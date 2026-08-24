// Supabase Edge Function: kasper-ad-performance-read
//
// Admin-only read API for Kasper's Ad Performance panel (Kasper tab > More >
// Analytics). Reads three tables (service role; none have anon/authenticated
// access) and returns:
//   - rows: daily campaign-level spend/click/booking counts
//   - summary: a server-computed summary over `rows` — CPC, landing-page-view
//     rate, conversion rate, cost-per-booking (both including and excluding
//     cancelled bookings) — derived here, never stored, so it can never drift
//     from the underlying counts.
//   - by_ad: daily spend/click/booking counts broken out by ad_name
//   - leads: one row per iClosed booking with its current HubSpot funnel
//     status (iclosed_status, lifecyclestage). This carries real PII (lead
//     name + email) — the finally-block below logs counts only, never a
//     row's name, email, or identity.
//   - unfinished_leads: people who started the acquisition-calendar booking
//     flow but never finished it (potential/qualified, still armed for
//     follow-up), mirrored from n8n's booking_recovery Data Table. Real PII
//     (name/email/phone) — logged as counts only, same as leads.
//
// Deploy: supabase functions deploy kasper-ad-performance-read --project-ref uzltbbrjidmjwwfakwve --no-verify-jwt
// Deliberate-manual: no CI deploy path yet, matching workload-plan's first-release
// precedent.

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

type ByAdRow = {
  date: string;
  ad_name: string;
  spend: number;
  impressions: number;
  clicks: number;
  landing_page_views: number;
  bookings_all: number;
  bookings_held: number;
};

type LeadRow = {
  iclosed_booking_id: string;
  booked_date: string;
  call_date: string | null;
  ad_name: string | null;
  lead_name: string;
  lead_email: string;
  cancelled: boolean;
  iclosed_status: string | null;
  hubspot_lifecyclestage: string | null;
  hubspot_contact_id: string | null;
};

type UnfinishedLeadRow = {
  lead_key: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  iclosed_status: string | null;
  captured_at: string;
  follow_up_due_at: string | null;
  email_sent_at: string | null;
  sms_sent_at: string | null;
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
  // real ad spend, booking volume, and lead PII, so only the admin role key
  // opens it.
  const given = (req.headers.get("x-syncview-key") || "").trim();
  const auth = authorizeStaffKey(given, ["admin"]);
  if (!auth.ok) return json({ ok: false, error: auth.role ? "forbidden" : "unauthorized" }, staffAuthFailureStatus(auth));

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const [dailyResult, byAdResult, leadsResult, unfinishedLeadsResult] = await Promise.all([
    supabase
      .from("kasper_ad_performance_daily")
      .select("date,spend,impressions,clicks,landing_page_views,bookings_all,bookings_held")
      .order("date", { ascending: true }),
    supabase
      .from("kasper_ad_performance_by_ad_daily")
      .select("date,ad_name,spend,impressions,clicks,landing_page_views,bookings_all,bookings_held")
      .order("date", { ascending: true }),
    supabase
      .from("kasper_ad_leads")
      .select("iclosed_booking_id,booked_date,call_date,ad_name,lead_name,lead_email,cancelled,iclosed_status,hubspot_lifecyclestage,hubspot_contact_id")
      .order("booked_date", { ascending: false }),
    supabase
      .from("kasper_ad_unfinished_leads")
      .select("lead_key,first_name,last_name,email,phone,iclosed_status,captured_at,follow_up_due_at,email_sent_at,sms_sent_at")
      .order("captured_at", { ascending: false }),
  ]);

  if (dailyResult.error) return json({ ok: false, error: dailyResult.error.message }, 500);
  if (byAdResult.error) return json({ ok: false, error: byAdResult.error.message }, 500);
  if (leadsResult.error) return json({ ok: false, error: leadsResult.error.message }, 500);
  if (unfinishedLeadsResult.error) return json({ ok: false, error: unfinishedLeadsResult.error.message }, 500);

  const rows = (dailyResult.data || []) as DailyRow[];
  const byAd = (byAdResult.data || []) as ByAdRow[];
  const leads = (leadsResult.data || []) as LeadRow[];
  const unfinishedLeads = (unfinishedLeadsResult.data || []) as UnfinishedLeadRow[];

  // Aggregate-only: counts only, never a lead's name, email, phone, or identity.
  console.log(JSON.stringify({ fn: "kasper-ad-performance-read", rows: rows.length, by_ad: byAd.length, leads: leads.length, unfinished_leads: unfinishedLeads.length }));

  return json({ ok: true, rows, summary: summarize(rows), by_ad: byAd, leads, unfinished_leads: unfinishedLeads });
});
