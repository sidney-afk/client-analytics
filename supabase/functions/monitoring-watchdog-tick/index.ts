// monitoring-watchdog-tick: the dead-man's switch's primary host, called every
// 15 minutes by Supabase's own timer (pg_cron through pg_net, scheduled by
// migrations/2026-10-09-monitoring-watchdog-tick-schedule.sql). It runs the same
// check as `node scripts/monitoring-watchdog.js --check`; the logic lives in
// ../_shared/monitoring-watchdog-tick.mjs and ../_shared/monitoring-watchdog-core.mjs
// so it is tested in Node. This file only wires it to Deno and the secrets.
//
// Secrets (set by the owner as Edge Function secrets, never in the repo):
//   MONITORING_WATCHDOG_KEY   at least 32 characters; the timer signs its call
//                             with it (the same value is in Vault as
//                             monitoring_watchdog_key)
//   MONITORING_ALERT_WEBHOOK  the alert relay URL; the same value as the GitHub
//                             secret SLACK_ALERT_WEBHOOK the GitHub hosts page with
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by the platform.
import { timingSafeEqual } from "../_shared/staff-role-auth.ts";
import { buildHandler, KEY_HEADER } from "../_shared/monitoring-watchdog-tick.mjs";

Deno.serve(buildHandler({
  keyOk: (req: Request) => {
    const secret = Deno.env.get("MONITORING_WATCHDOG_KEY") || "";
    const given = (req.headers.get(KEY_HEADER) || "").trim();
    return secret.length >= 32 && !!given && timingSafeEqual(given, secret);
  },
  config: () => ({
    supabaseUrl: Deno.env.get("SUPABASE_URL") || "",
    serviceKey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "",
    alertWebhook: Deno.env.get("MONITORING_ALERT_WEBHOOK") || "",
  }),
  fetchImpl: fetch,
  newId: () => crypto.randomUUID(),
  now: () => Date.now(),
}));
