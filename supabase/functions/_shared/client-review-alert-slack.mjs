// The Slack calls client-review-alert makes, with fetch injected so they
// can be tested without a network. The bot token is only ever placed in the
// Authorization header: it is never put in a URL, a log line, a response or a
// stored row.
//
//   channelInfo   conversations.info: the channel's name, and whether the bot is in it.
//   postChannel   chat.postMessage into the client's private channel.
//   postDirect    chat.postMessage into ONE person's direct message (the preview).
//                 Only a user id (U... or W...) is accepted, and the answer must
//                 come back from a direct conversation (D...) or it is refused.
//   userInfo      users.info: the display name of the person a message will tag,
//                 for the confirm box only. Never stored.
//   channelHasMember  conversations.members (one page of up to 1000): is the
//                 tagged person in the client's channel? Unknown past one page.

const SLACK_TS = /^\d{10,}\.[0-9]{6}$/;
const MAX_RESPONSE_BYTES = 16 * 1024;
const TIMEOUT_MS = 5000;
const USER_ID = /^[UW][A-Z0-9]{8,}$/;

async function boundedBody(response) {
  const reader = response.body && response.body.getReader();
  if (!reader) return null;
  const decoder = new TextDecoder(); let size = 0; let text = '';
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > MAX_RESPONSE_BYTES) { await reader.cancel(); return null; }
      text += decoder.decode(next.value, { stream: true });
    }
    const parsed = JSON.parse(text + decoder.decode());
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch (_e) { return null; }
}

// Slack error name -> the short code the page turns into a sentence.
export function mapSlackError(error) {
  switch (String(error || '')) {
    case 'not_in_channel':
    case 'channel_not_found': return 'bot_not_in_channel';
    case 'is_archived': return 'channel_archived';
    case 'ratelimited': return 'slack_rate_limited';
    case 'invalid_auth': case 'not_authed': case 'token_revoked': case 'token_expired':
    case 'account_inactive': case 'missing_scope': case 'no_permission': return 'slack_not_authorised';
    default: return 'slack_rejected';
  }
}

async function call(fetchImpl, token, method, payload, asQuery) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let response;
  try {
    response = await fetchImpl('https://slack.com/api/' + method + (asQuery ? '?' + new URLSearchParams(payload).toString() : ''), {
      method: asQuery ? 'GET' : 'POST', redirect: 'error', signal: controller.signal,
      headers: { authorization: 'Bearer ' + token, ...(asQuery ? {} : { 'content-type': 'application/json; charset=utf-8' }) },
      ...(asQuery ? {} : { body: JSON.stringify(payload) }),
    });
  } catch (_e) {
    clearTimeout(timer);
    return { transport: false };
  }
  const body = await boundedBody(response);
  clearTimeout(timer);
  return { transport: true, response, body };
}

export function makeSlack(fetchImpl = fetch) {
  return {
    async channelInfo(token, channelId) {
      const r = await call(fetchImpl, token, 'conversations.info', { channel: channelId }, true);
      if (!r.transport || !r.body) return { ok: false, code: 'slack_unreachable' };
      if (r.body.ok === true && r.body.channel && typeof r.body.channel === 'object') {
        const c = r.body.channel;
        return { ok: true, name: typeof c.name === 'string' ? c.name.slice(0, 80) : null, member: c.is_member === true };
      }
      return { ok: false, code: mapSlackError(r.body.error) };
    },

    async userInfo(token, userId) {
      if (!USER_ID.test(String(userId || ''))) return { ok: false, code: 'bad_user' };
      const r = await call(fetchImpl, token, 'users.info', { user: userId }, true);
      if (!r.transport || !r.body) return { ok: false, code: 'slack_unreachable' };
      if (r.body.ok === true && r.body.user && typeof r.body.user === 'object') {
        const u = r.body.user; const p = u.profile && typeof u.profile === 'object' ? u.profile : {};
        const pick = [p.display_name, p.real_name, u.real_name, u.name].find((v) => typeof v === 'string' && v.trim());
        return { ok: true, name: pick ? pick.trim().slice(0, 80) : null, deleted: u.deleted === true };
      }
      return { ok: false, code: mapSlackError(r.body.error) };
    },

    async channelHasMember(token, channelId, userId) {
      const r = await call(fetchImpl, token, 'conversations.members', { channel: channelId, limit: '1000' }, true);
      if (!r.transport || !r.body) return { ok: false, code: 'slack_unreachable' };
      if (r.body.ok === true && Array.isArray(r.body.members)) {
        if (r.body.members.includes(userId)) return { ok: true, member: true };
        const more = r.body.response_metadata && r.body.response_metadata.next_cursor;
        return more ? { ok: false, code: 'too_many_members' } : { ok: true, member: false };
      }
      return { ok: false, code: mapSlackError(r.body.error) };
    },

    async postChannel(token, channelId, message, clientMsgId) {
      const r = await call(fetchImpl, token, 'chat.postMessage', {
        channel: channelId, text: message.text, blocks: message.blocks, client_msg_id: clientMsgId,
        parse: 'none', link_names: false, mrkdwn: true, unfurl_links: false, unfurl_media: false,
      });
      if (!r.transport) return { kind: 'unknown', code: 'slack_unconfirmed' };
      const { response, body } = r;
      if (response.ok && body && body.ok === true && body.channel === channelId && typeof body.ts === 'string' && SLACK_TS.test(body.ts)) {
        return { kind: 'sent', messageId: body.ts };
      }
      if (response.status === 429 || (body && body.error === 'ratelimited')) return { kind: 'failed', code: 'slack_rate_limited' };
      // A 5xx or an unreadable answer may still be an accepted post.
      if (response.status >= 500 || !body) return { kind: 'unknown', code: 'slack_unconfirmed' };
      return { kind: 'failed', code: mapSlackError(body.error) };
    },

    async postDirect(token, userId, message) {
      if (!USER_ID.test(String(userId || ''))) return { kind: 'failed', code: 'preview_target' };
      const r = await call(fetchImpl, token, 'chat.postMessage', {
        channel: userId, text: message.text, blocks: message.blocks,
        parse: 'none', link_names: false, mrkdwn: true, unfurl_links: false, unfurl_media: false,
      });
      if (!r.transport) return { kind: 'unknown', code: 'slack_unconfirmed' };
      const { response, body } = r;
      if (response.ok && body && body.ok === true && typeof body.channel === 'string' && body.channel.startsWith('D')
          && typeof body.ts === 'string' && SLACK_TS.test(body.ts)) return { kind: 'sent', messageId: body.ts };
      return { kind: 'failed', code: body ? mapSlackError(body.error) : 'slack_unconfirmed' };
    },
  };
}
