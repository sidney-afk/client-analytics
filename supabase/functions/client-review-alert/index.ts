// client-review-alert: the "Notify client" button (Calendar and Samples toolbars).
// Posts ONE general "ready for your review" alert to a client's private Slack
// channel. The logic is in ../_shared/client-review-alert.mjs so it can be
// tested in Node; this file only wires it to Deno, the staff role-key gate,
// Slack and a service-role Supabase client.
//
// Needs, all existing: ROLE_KEY_ADMIN and ROLE_KEY_SMM (the staff keys),
// SLACK_BOT_TOKEN (the same bot the notify function uses) and
// NOTIFY_PREVIEW_SLACK_USER_ID (the owner's DM for the preview action).
// Needs migration 20261014120000_client_review_alerts.sql applied first.
// New and off by default: CLIENT_REVIEW_ALERT_LIVE=1 lets "send" post to a
// client channel. Without it "send" answers sending_not_enabled and posts
// nothing; status and preview still work, so the owner can look first.
// Optional: CLIENT_REVIEW_ALERT_ORIGIN overrides the page address in the link.
import { createClient } from "npm:@supabase/supabase-js@2.49.8";
import { authorizeStaffKey } from "../_shared/staff-role-auth.ts";
import { buildHandler } from "../_shared/client-review-alert.mjs";
import { makeSlack } from "../_shared/client-review-alert-slack.mjs";

Deno.serve(buildHandler({
  authorize: (key: string, roles: string[]) => authorizeStaffKey(key, roles as ("admin" | "smm" | "creative")[]),
  makeClient: () => {
    const url = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !serviceKey) return null;
    return createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  },
  slack: makeSlack(fetch),
  slackToken: () => Deno.env.get("SLACK_BOT_TOKEN") || "",
  previewUserId: () => Deno.env.get("NOTIFY_PREVIEW_SLACK_USER_ID") || "",
  sendingEnabled: () => Deno.env.get("CLIENT_REVIEW_ALERT_LIVE") === "1",
  origin: () => Deno.env.get("CLIENT_REVIEW_ALERT_ORIGIN") || "",
  newId: () => crypto.randomUUID(),
}));
