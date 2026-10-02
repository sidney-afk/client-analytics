// client-hubspot-sync: keeps each client's HubSpot deal, contract state and payment
// state in client_sales_state (step 2.3b of
// docs/plans/2026-10-01-onboarding-checklist-and-profile.md). Read only toward
// HubSpot, never through n8n. The logic lives in ../_shared/client-hubspot-sync.mjs
// so it can be tested in Node; this file only wires it to Deno, the staff role-key
// gate, the timer key and a service-role Supabase client.
//
// Secrets (set by the owner as Edge Function secrets, never in the repo):
//   HUBSPOT_READ_TOKEN   a read-only HubSpot private app token
//   HUBSPOT_SYNC_KEY     at least 32 characters; the daily timer signs its call with it
// Needs migrations/2026-10-03-onboarding-checklist-tables.sql and
// migrations/2026-10-04-client-hubspot-sync.sql applied first. Switch: the
// syncview_runtime_flags row client_hubspot_sync (default off).
import { createClient } from "npm:@supabase/supabase-js@2.49.8";
import { authorizeStaffKey, timingSafeEqual } from "../_shared/staff-role-auth.ts";
import { buildHandler, makeHubspot } from "../_shared/client-hubspot-sync.mjs";

Deno.serve(buildHandler({
  authorize: (key: string, roles: string[]) => authorizeStaffKey(key, roles as ("admin" | "smm" | "creative")[]),
  tickKeyOk: (req: Request) => {
    const secret = Deno.env.get("HUBSPOT_SYNC_KEY") || "";
    const given = (req.headers.get("x-hubspot-sync-key") || "").trim();
    return secret.length >= 32 && !!given && timingSafeEqual(given, secret);
  },
  makeClient: () => {
    const url = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !serviceKey) return null;
    return createClient(url, serviceKey, { auth: { persistSession: false } });
  },
  makeHubspot: () => {
    const token = (Deno.env.get("HUBSPOT_READ_TOKEN") || "").trim();
    return token ? makeHubspot(fetch, token) : null;
  },
  newId: () => crypto.randomUUID(),
  now: () => Date.now(),
}));
