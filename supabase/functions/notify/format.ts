// Rich Slack layout for creative-channel notifications. Pure: no network, no
// database. The sender (index.ts) and the owner-only preview both call it, so
// what the preview shows is exactly what a channel would receive.
//
// Safety: every stored value goes through slackSafe(), which swaps < > & for
// lookalike glyphs (the same substitution the SQL builder already uses), so no
// value can form a Slack link, a user/channel mention or a special command.
// Every text object is `verbatim: true`, so Slack never auto-links bare
// "@here"/"#channel" words either. This layout never mentions anyone.

export type NotifyVariant = "compact" | "card" | "line";
export const NOTIFY_VARIANTS: NotifyVariant[] = ["compact", "card", "line"];
export type StatusKind = "status_smm_approval" | "status_tweak";

export type NotifyInput = {
  status?: StatusKind | null;            // absent for a comment on its own
  title: string;
  clientName?: string | null;
  deliverableId: string;
  clientSlug?: string | null;
  cardId?: string | null;                // calendar_posts.id when origin is calendar
  comment?: { author?: string | null; body: string } | null;
};
export type SlackAttachment = { color: string; fallback: string; blocks: Record<string, unknown>[] };
// `attachments`, when present, is what is posted: the same blocks wrapped in one
// attachment so Slack draws a coloured bar down the left edge. The plain line
// then rides as the attachment's `fallback` (notification-only) and no
// top-level text is sent, or Slack would draw it above the card as a duplicate.
export type SlackMessage = { text: string; blocks: Record<string, unknown>[]; attachments?: SlackAttachment[] };

const SITE = "https://syncview.synchrosocial.com/";
const TITLE_CAP = 140;
const COMMENT_CAP = 1200;
const FALLBACK_COMMENT_CAP = 160;

export function slackSafe(value: unknown): string {
  return String(value == null ? "" : value)
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "")
    .replace(/</g, "‹").replace(/>/g, "›").replace(/&/g, "＆");
}
function oneLine(value: string): string { return value.replace(/\s+/g, " ").trim(); }
function cap(value: string, max: number): string {
  const chars = Array.from(value);
  return chars.length <= max ? value : chars.slice(0, max - 1).join("").trimEnd() + "…";
}
// Bold spans break on a stray asterisk, so titles swap it for a lookalike.
function boldSafe(value: string): string { return value.replace(/\*/g, "∗"); }

export function productionUrl(deliverableId: string): string {
  return SITE + "?" + new URLSearchParams({ prod: "1", d: deliverableId }).toString() + "#production";
}
// The staff calendar's card deep link: #calendar/<slug>/<cardId>, the same
// shape the review-history and dashboard "open card" links build.
export function calendarUrl(clientSlug?: string | null, cardId?: string | null): string | null {
  if (!clientSlug || !cardId) return null;
  return SITE + "#calendar/" + encodeURIComponent(clientSlug) + "/" + encodeURIComponent(cardId);
}

// Card colours, owner-picked: the left bar says what happened at a glance. A
// merged status + comment post takes the status colour.
const STATUS: Record<StatusKind | "comment", { label: string; emoji: string; color: string }> = {
  status_tweak: { label: "Needs tweaks", emoji: "🔧", color: "#F2994A" },
  status_smm_approval: { label: "Ready for SMM approval", emoji: "✅", color: "#B45CD6" },
  comment: { label: "New comment", emoji: "💬", color: "#9AA0A6" },
};
export function cardColor(input: Pick<NotifyInput, "status">): string { return STATUS[input.status || "comment"].color; }

function prepared(input: NotifyInput) {
  const title = cap(oneLine(slackSafe(input.title)) || "Untitled", TITLE_CAP);
  const client = cap(oneLine(slackSafe(input.clientName || "")), 80);
  const status = STATUS[input.status || "comment"];
  const body = input.comment ? cap(slackSafe(input.comment.body).trim(), COMMENT_CAP) : "";
  const author = input.comment ? cap(oneLine(slackSafe(input.comment.author || "")) || "Someone", 80) : "";
  const prod = productionUrl(input.deliverableId);
  const cal = calendarUrl(input.clientSlug, input.cardId);
  return { title, client, status, body, author, prod, cal };
}

// The notification/lock-screen line. Slack shows `text` when blocks cannot be
// drawn (phones, email digests), so it reads on its own and carries no markup.
export function fallbackText(input: NotifyInput): string {
  const p = prepared(input);
  let line = p.status.label + ": " + p.title + (p.client ? " (" + p.client + ")" : "");
  if (p.body) line += " · " + p.author + ": " + cap(oneLine(p.body), FALLBACK_COMMENT_CAP);
  return line;
}

function mrkdwn(text: string) { return { type: "mrkdwn", text, verbatim: true }; }
function quote(body: string): string { return body.split("\n").map(l => "> " + l).join("\n"); }

export function formatNotification(input: NotifyInput, variant: NotifyVariant): SlackMessage {
  const p = prepared(input);
  const links = [`<${p.prod}|Open in SyncLinear>`].concat(p.cal ? [`<${p.cal}|Open on calendar>`] : []);
  const text = fallbackText(input);
  const commentBlock = p.body ? mrkdwn("*" + boldSafe(p.author) + "* commented:\n" + quote(p.body)) : null;
  let blocks: Record<string, unknown>[];
  if (variant === "card") {
    blocks = [
      { type: "header", text: { type: "plain_text", text: cap(p.title, 140), emoji: true } },
      { type: "section", fields: [
        mrkdwn("*Client*\n" + (p.client || "Unknown")),
        mrkdwn("*Status*\n" + p.status.emoji + " " + p.status.label),
      ] },
    ];
    if (commentBlock) blocks.push({ type: "section", text: commentBlock });
    const buttons = [{ type: "button", text: { type: "plain_text", text: "Open in SyncLinear" }, url: p.prod }];
    if (p.cal) buttons.push({ type: "button", text: { type: "plain_text", text: "Open on calendar" }, url: p.cal });
    blocks.push({ type: "actions", elements: buttons });
    return { text, blocks, attachments: [{ color: p.status.color, fallback: text, blocks }] };
  } else if (variant === "line") {
    let line = p.status.emoji + " *" + p.status.label + "* · *" + boldSafe(p.title) + "*" + (p.client ? " · " + p.client : "");
    if (p.body) line += "\n" + quote(p.body) + "\n_" + p.author + "_";
    line += "\n" + links.join("  ·  ");
    blocks = [{ type: "section", text: mrkdwn(line) }];
  } else {
    blocks = [{ type: "section", text: mrkdwn(
      "*" + boldSafe(p.title) + "*" + (p.client ? "  ·  " + p.client : "") + "\n" + p.status.emoji + " *" + p.status.label + "*") }];
    if (commentBlock) blocks.push({ type: "section", text: commentBlock });
    blocks.push({ type: "context", elements: [mrkdwn(links.join("  ·  "))] });
  }
  return { text, blocks };
}

export function isNotifyVariant(value: unknown): value is NotifyVariant {
  return typeof value === "string" && (NOTIFY_VARIANTS as string[]).includes(value);
}
