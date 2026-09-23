// Minimal provider adapter. It has no scheduler and is only called by notify.
// Untrusted text is escaped in SQL before it reaches this adapter. `parse:none`,
// `link_names:false`, and `mrkdwn:false` are defense in depth for client posts.
export type SlackPostResult =
  | { kind: "sent"; messageId: string }
  | { kind: "retryable"; code: string }
  | { kind: "blocked"; code: string }
  | { kind: "unknown"; code: string };

const SLACK_TS = /^\d{10,}\.[0-9]{6}$/;
const MAX_RESPONSE_BYTES = 16 * 1024;

async function boundedBody(response: Response): Promise<Record<string, unknown> | null> {
  const reader = response.body?.getReader();
  if (!reader) return null;
  const decoder = new TextDecoder(); let size = 0; let text = "";
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > MAX_RESPONSE_BYTES) { await reader.cancel(); return null; }
      text += decoder.decode(next.value, { stream: true });
    }
    const parsed = JSON.parse(text + decoder.decode());
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch { return null; }
}

export async function postSlackChannelMessage(
  token: string,
  channel: string,
  text: string,
  clientMsgId: string,
  allowMentions = false,
  fetchImpl: typeof fetch = fetch,
  blocks?: Record<string, unknown>[],
  attachments?: Record<string, unknown>[],
): Promise<SlackPostResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  let response: Response;
  try {
    response = await fetchImpl("https://slack.com/api/chat.postMessage", {
      method: "POST", redirect: "error", signal: controller.signal,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({ channel, text, client_msg_id: clientMsgId, parse: "none", link_names: false, mrkdwn: allowMentions, unfurl_links: false, unfurl_media: false, ...(attachments ? { attachments } : blocks ? { blocks } : {}) }),
    });
  } catch {
    clearTimeout(timer);
    return { kind: "unknown", code: "slack_transport_unconfirmed" };
  }
  const body = await boundedBody(response);
  clearTimeout(timer);
  if (response.ok && body?.ok === true && body.channel === channel && typeof body.ts === "string" && SLACK_TS.test(body.ts)) {
    return { kind: "sent", messageId: body.ts };
  }
  // A 429 is a pre-acceptance rate refusal. The SQL receipt schedules its
  // bounded retry. Any 5xx or malformed body may be an accepted post without a
  // usable receipt, so it is explicitly unknown rather than duplicate-retried.
  if (response.status === 429 || body?.error === "ratelimited") return { kind: "retryable", code: "slack_rate_limited" };
  if (response.status >= 500 || !body) return { kind: "unknown", code: "slack_response_unconfirmed" };
  return { kind: "blocked", code: "slack_api_rejected" };
}

// Owner-only preview: posts into one person's direct message with the bot,
// never into a channel. A user id (U…/W…) is the only accepted target, and the
// reply must come back from a DM conversation (D…) or it counts as refused.
export async function postSlackDirectPreview(
  token: string,
  userId: string,
  text: string,
  blocks: Record<string, unknown>[],
  fetchImpl: typeof fetch = fetch,
  attachments?: Record<string, unknown>[],
): Promise<SlackPostResult> {
  if (!/^[UW][A-Z0-9]{8,}$/.test(userId)) return { kind: "blocked", code: "preview_target_not_a_user" };
  let response: Response;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    response = await fetchImpl("https://slack.com/api/chat.postMessage", {
      method: "POST", redirect: "error", signal: controller.signal,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({ channel: userId, text, ...(attachments ? { attachments } : { blocks }), parse: "none", link_names: false, mrkdwn: false, unfurl_links: false, unfurl_media: false }),
    });
  } catch {
    clearTimeout(timer);
    return { kind: "unknown", code: "slack_transport_unconfirmed" };
  }
  const body = await boundedBody(response);
  clearTimeout(timer);
  if (response.ok && body?.ok === true && typeof body.channel === "string" && body.channel.startsWith("D")
      && typeof body.ts === "string" && SLACK_TS.test(body.ts)) return { kind: "sent", messageId: body.ts };
  return { kind: "blocked", code: typeof body?.error === "string" && /^[a-z_]{1,60}$/.test(body.error) ? "slack_" + body.error : "slack_api_rejected" };
}
