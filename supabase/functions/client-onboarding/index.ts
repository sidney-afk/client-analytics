// client-onboarding: one client's onboarding checklist and resources, for the
// Clients tab (admin only, reads and writes). The logic lives in
// ../_shared/client-onboarding.mjs so it can be tested in Node; this file only
// wires it to Deno, the staff role-key gate and a service-role Supabase client.
// Needs migrations/2026-10-03-onboarding-checklist-tables.sql applied first;
// "Create client" also needs 2026-10-08-create-client.sql (until then it answers
// create_not_installed and writes nothing).
import { createClient } from "npm:@supabase/supabase-js@2.49.8";
import { authorizeStaffKey } from "../_shared/staff-role-auth.ts";
import { buildHandler } from "../_shared/client-onboarding.mjs";
import { makeStore } from "../_shared/roster-handlers.mjs";
import { copyToSheet } from "../_shared/roster-sheet-copy.mjs";

Deno.serve(buildHandler({
  authorize: (key: string, roles: string[]) => authorizeStaffKey(key, roles as ("admin" | "smm" | "creative")[]),
  makeClient: () => {
    const url = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !serviceKey) return null;
    return createClient(url, serviceKey, { auth: { persistSession: false } });
  },
  newId: () => crypto.randomUUID(),
  // After a real "Create client", the same best-effort Sheet copy client-profile-write runs.
  copyToSheet: (db: unknown) => copyToSheet({ store: makeStore(db), env: Deno.env, fetchFn: fetch }),
}));
