// roster-read -- the server-to-server door for READING the client roster
// (Clients Info) and who manages each client (Social Media Managers) from
// SyncView's database (docs/plans/2026-10-02-roster-native.md).
//
// Callers: the n8n workflows that read those two Sheet tabs today, once the
// owner approves each edit. Not browser-callable: no CORS surface, and every
// request needs ROSTER_SERVICE_KEY in X-Roster-Key, checked before the body is
// parsed or a service-role client exists.
//
// Actions (POST JSON): status | clients | managers. clients and managers take
// format "json" (default) or "csv"; the csv has the Sheet's own headers and
// quoting so a reader that parses the Sheet's CSV today parses this unchanged.
// Every answer says which copy is the main one (authority: "sheet" or
// "syncview"). Never returns a review token; never returns linear_api_key.
//
// Deploy: the "Deploy one allowlisted Edge Function" lane, JWT off.
import { createClient } from "npm:@supabase/supabase-js@2.49.8";
import { handleRosterRead } from "../_shared/roster-handlers.mjs";

Deno.serve((req: Request): Promise<Response> =>
  handleRosterRead(req, {
    env: Deno.env,
    fetchFn: fetch,
    getSupabase: () => createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } }),
  }));
