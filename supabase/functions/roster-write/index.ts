// roster-write -- the server-to-server door for WRITING the client roster and
// manager assignments to SyncView's database (docs/plans/2026-10-02-roster-native.md).
//
// Callers: n8n (Onboarding: Append Client Row, the Slack Creative Channel
// Finalizer, Manager Sync), once the owner approves each edit. Not
// browser-callable: no CORS surface, and every request needs ROSTER_SERVICE_KEY
// in X-Roster-Key, checked before the body is parsed or a service-role client
// exists.
//
// Natively writing actions (refused with "authority_not_syncview" until the
// owner flips client_profiles_authority to "syncview"; the database itself
// enforces that): upsert_client, set_client_fields (optional compare-and-set
// "expect"), assign_manager. Every write is recorded (who, what, from, to) and
// then copied to the Sheet, which stays a read-only mirror: a copy that cannot
// be made stays queued, and the database change stands. copy_to_sheet retries
// the queue; queue_full_copy queues the whole roster (the first catch-up after
// the switch, or the way back); status says which copy is the main one.
//
// sync_managers is the opposite door: the daily Manager Sync while the Sheet is
// still the main copy (it now also carries each manager's Slack id). It refuses
// once the database is the main copy.
//
// Deploy: the "Deploy one allowlisted Edge Function" lane, JWT off.
import { createClient } from "npm:@supabase/supabase-js@2.49.8";
import { handleRosterWrite } from "../_shared/roster-handlers.mjs";

Deno.serve((req: Request): Promise<Response> =>
  handleRosterWrite(req, {
    env: Deno.env,
    fetchFn: fetch,
    getSupabase: () => createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } }),
  }));
