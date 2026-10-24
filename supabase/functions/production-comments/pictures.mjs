// People pictures for the Messages inbox and the card Notes (unread badges round 5, session Beacon, 2026-10-24;
// docs/audits/2026-10-23-unread-badges.md). Each staff member's picture is their Slack profile photo
// (team_members.slack_user_id); a client's is the photo of the client's Slack contact
// (client_profiles.slack_mention_user_id), which users.info answers for people in shared channels too.
//
// Read only from Slack, never stored: the links are kept in this function's memory for PICTURES_TTL_MS and handed
// to signed-in staff with their inbox. The bot token is only ever placed in the Authorization header, never in a
// URL, a log line, a response or a stored row. Every failure means "no picture", never a failed inbox.

export const PICTURES_TTL_MS = 6 * 60 * 60 * 1000;
export const PICTURES_WAIT_MS = 1500;     // the inbox waits this long for a cold lookup, then answers without
const LOOKUP_TIMEOUT_MS = 5000;
const MAX_BODY_BYTES = 64 * 1024;
const MAX_LOOKUPS = 80;
const PARALLEL = 8;
const USER_ID = /^[UW][A-Z0-9]{8,}$/;
const SAFE_KEY = /^[A-Za-z0-9_-]{1,80}$/;

const clean = (v) => (typeof v === "string" ? v.trim() : "");

// The photo link from a users.info answer: the 72 px square, https only.
export function photoOf(body) {
  const u = body && body.ok === true && body.user && typeof body.user === "object" ? body.user : null;
  if (!u || u.deleted === true) return "";
  const p = u.profile && typeof u.profile === "object" ? u.profile : {};
  const url = [p.image_72, p.image_48, p.image_192].find((v) => typeof v === "string" && /^https:\/\/[^\s"'<>]{1,580}$/.test(v));
  return url || "";
}

async function boundedJson(response) {
  const reader = response && response.body && response.body.getReader ? response.body.getReader() : null;
  if (!reader) return null;
  const decoder = new TextDecoder(); let size = 0; let text = "";
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > MAX_BODY_BYTES) { await reader.cancel(); return null; }
      text += decoder.decode(next.value, { stream: true });
    }
    const parsed = JSON.parse(text + decoder.decode());
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch (_e) { return null; }
}

async function lookup(fetchImpl, token, userId) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LOOKUP_TIMEOUT_MS);
  try {
    const response = await fetchImpl("https://slack.com/api/users.info?" + new URLSearchParams({ user: userId }).toString(), {
      method: "GET", redirect: "error", signal: controller.signal, headers: { authorization: "Bearer " + token },
    });
    return photoOf(await boundedJson(response));
  } catch (_e) {
    return "";
  } finally {
    clearTimeout(timer);
  }
}

// Who to look up: active staff with a Slack id, and active clients with a Slack contact.
export function picturePlan(staffRows, clientRows) {
  const members = [];
  for (const s of Array.isArray(staffRows) ? staffRows : []) {
    if (!s || s.active === false) continue;
    const id = clean(s.id), slack = clean(s.slack_user_id);
    if (SAFE_KEY.test(id) && USER_ID.test(slack)) members.push({ id, name: clean(s.name), slack });
  }
  const clients = [];
  for (const c of Array.isArray(clientRows) ? clientRows : []) {
    if (!c || c.archived_at) continue;
    const slug = clean(c.slug), slack = clean(c.slack_mention_user_id);
    if (SAFE_KEY.test(slug) && USER_ID.test(slack)) clients.push({ slug, slack });
  }
  return { members, clients };
}

// The answer: { members: { id: url }, names: { lowercased name or unique first name: url }, clients: { slug: url } }.
export async function resolvePictures(plan, token, fetchImpl) {
  const ids = [...new Set([...plan.members.map((m) => m.slack), ...plan.clients.map((c) => c.slack)])].slice(0, MAX_LOOKUPS);
  const photo = new Map();
  for (let i = 0; i < ids.length; i += PARALLEL) {
    const part = ids.slice(i, i + PARALLEL);
    const got = await Promise.all(part.map((id) => lookup(fetchImpl, token, id)));
    part.forEach((id, j) => { if (got[j]) photo.set(id, got[j]); });
  }
  const members = {}, names = {}, clients = {};
  const firsts = new Map();
  for (const m of plan.members) {
    const url = photo.get(m.slack);
    if (!url) continue;
    members[m.id] = url;
    const full = m.name.toLowerCase();
    if (full) names[full] = url;
    const first = full.split(/\s+/)[0];
    if (first) firsts.set(first, firsts.has(first) && firsts.get(first) !== url ? "" : url);
  }
  for (const [first, url] of firsts) if (url && !names[first]) names[first] = url;
  for (const c of plan.clients) { const url = photo.get(c.slack); if (url) clients[c.slug] = url; }
  return { members, names, clients };
}

// One cached answer per function instance; a cold lookup keeps running after the inbox has answered without it.
export function makePictureCache(now = () => Date.now()) {
  let value = null, at = 0, pending = null;
  return {
    async get(load, waitMs = PICTURES_WAIT_MS) {
      if (value && now() - at < PICTURES_TTL_MS) return value;
      if (!pending) {
        pending = load().then((v) => { value = v; at = now(); return v; }, () => null).finally(() => { pending = null; });
      }
      let timer;
      const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve(null), waitMs); });
      const got = await Promise.race([pending, timeout]);
      clearTimeout(timer);
      return got || value || null;
    },
  };
}
