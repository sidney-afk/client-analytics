// Pure rules for analytics-weekly-slack-post (no I/O, tested offline): the switch, and the Slack message.
import { mentionIdOf } from "./client-review-alert.mjs";

export const FLAG_KEY = "analytics_weekly_slack_post";
export const MODES = Object.freeze(["off", "allow_list", "all"]);

// The switch: only an exact "allow_list" or "all" turns posting on. A missing row, a bad value or a
// failed read is off.
export function modeOf(flagValue) {
  const m = flagValue && typeof flagValue === "object" ? flagValue.mode : undefined;
  return m === "allow_list" || m === "all" ? m : "off";
}

// Slack mrkdwn escaping: only & < > are special. The caption-derived text is escaped as a whole, so a caption
// that contains <!channel> or <@U...> reaches the channel as plain characters and notifies nobody.
export const escapeSlack = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Same tagging as the Notify client button (client-review-alert.mjs buildMessage): when the profile names ONE valid
// Slack member id, the message STARTS with <@id> (in the notification text and in the block) so the client gets a
// real notification; with no id, or one that is not a member id, the message is unchanged. The id is checked
// before it is written inside < >.
export function buildSlackMessage(text, mentionUserId) {
  const id = mentionIdOf(mentionUserId);
  const tag = id ? `<@${id}> ` : "";
  return {
    text: tag + String(text),
    blocks: [{ type: "section", text: { type: "mrkdwn", text: tag + escapeSlack(text) } }],
  };
}
