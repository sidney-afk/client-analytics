// Linking Post for Me accounts to clients automatically, with a person as the backstop (L1 of
// docs/plans/2026-11-trial-and-posting/combined.md, Sidney's D4 as relayed on 2026-11-02; OPEN_REPAIRS 666).
// Pure and dependency-free: client-profile-write fetches and saves; this decides. Unit-tested in
// test/postforme-accounts.js.
//
// Post for Me's account list carries each client's social access_token and refresh_token. safeAccount copies
// named fields OUT (a whitelist); nothing else of the raw answer may be kept, logged, returned or stored.
//
// An account links only on an exact, unique match, never a partial or fuzzy one:
//   - it is connected, and on no client in any slot;
//   - its username (trimmed, no leading @, lower case) equals exactly one client's saved handle for that network
//     (archived clients count, so a match with one makes it ambiguous); for YouTube the saved youtube_channel_id
//     may instead equal the account's user_id exactly (a UC... channel id);
//   - that client's slot is empty, and no other account in the same run wants that slot.
// Anything else is "needs a person", with the reason. A filled slot is never overwritten.

const SPC = /^spc_[A-Za-z0-9]{6,80}$/;

// network -> the slot it fills and the saved handle it matches on (null: nothing to match on).
const NETWORKS = Object.freeze({
  tiktok: { field: 'postforme_account_id', handle: 'tiktok_handle' },
  tiktok_business: { field: 'postforme_account_id', handle: 'tiktok_handle' },
  instagram: { field: 'postforme_instagram_account_id', handle: 'instagram_handle' },
  youtube: { field: 'postforme_youtube_account_id', handle: 'youtube_channel_id' },
  facebook: { field: 'postforme_facebook_account_id', handle: null },
  linkedin: { field: 'postforme_linkedin_account_id', handle: null },
});
const SLOT_FIELDS = Object.freeze(['postforme_account_id', 'postforme_instagram_account_id', 'postforme_facebook_account_id',
  'postforme_youtube_account_id', 'postforme_linkedin_account_id']);

const str = v => (v == null ? '' : String(v)).trim();

// The only fields of a Post for Me account SyncView keeps. Returns null for anything without a spc_ id.
export function safeAccount(a) {
  if (!a || typeof a !== 'object') return null;
  const id = str(a.id);
  if (!SPC.test(id)) return null;
  const meta = a.metadata && typeof a.metadata === 'object' ? a.metadata : {};
  return {
    id,
    platform: str(a.platform).toLowerCase(),
    username: str(a.username),
    user_id: str(a.user_id),
    display_name: str(meta.display_name),
    status: str(a.status).toLowerCase(),
    external_id: str(a.external_id),
  };
}

export function normalizeHandle(v) {
  return str(v).replace(/^@/, '').toLowerCase();
}

function slotValue(p, field) {
  return field === 'postforme_account_id' ? str(p.postforme_account_id) : str(p.extra && p.extra[field]);
}

// accounts: safeAccount() results. profiles: every client_profiles row (archived included), with the handle
// columns, postforme_account_id, extra and archived_at.
export function planLinks(accounts, profiles) {
  const rows = Array.isArray(profiles) ? profiles : [];
  const onClient = new Set();
  for (const p of rows) for (const f of SLOT_FIELDS) { const v = slotValue(p, f); if (v) onClient.add(v); }
  const person = (a, reason, candidates) => ({ account_id: a.id, network: a.platform, username: a.username, reason, ...(candidates ? { candidates } : {}) });
  const needs = [];
  const wanted = [];
  let alreadyLinked = 0;
  const list = (Array.isArray(accounts) ? accounts : []).filter(Boolean);
  for (const a of list) {
    if (onClient.has(a.id)) { alreadyLinked++; continue; }
    const net = NETWORKS[a.platform];
    if (!net) { needs.push(person(a, 'network_not_supported')); continue; }
    if (a.status !== 'connected') { needs.push(person(a, 'not_connected')); continue; }
    if (!net.handle) { needs.push(person(a, 'no_saved_handle_for_network')); continue; }
    const user = normalizeHandle(a.username);
    const hits = rows.filter(p => {
      const saved = str(p[net.handle]);
      if (!saved) return false;
      if (user && normalizeHandle(saved) === user) return true;
      return a.platform === 'youtube' && !!a.user_id && saved === a.user_id;
    });
    if (!hits.length) { needs.push(person(a, 'no_client_matches')); continue; }
    if (hits.length > 1) { needs.push(person(a, 'several_clients_match', hits.map(p => p.slug).sort())); continue; }
    const p = hits[0];
    if (p.archived_at) { needs.push(person(a, 'only_an_archived_client_matches', [p.slug])); continue; }
    if (slotValue(p, net.field)) { needs.push(person(a, 'slot_holds_another_account', [p.slug])); continue; }
    const match = user && normalizeHandle(p[net.handle]) === user ? net.handle : 'youtube_channel_id=user_id';
    wanted.push({ account: a, slug: p.slug, field: net.field, match });
  }
  // Two accounts for one slot: neither links.
  const bySlot = new Map();
  for (const w of wanted) { const k = w.slug + ' ' + w.field; bySlot.set(k, (bySlot.get(k) || 0) + 1); }
  const links = [];
  for (const w of wanted) {
    if (bySlot.get(w.slug + ' ' + w.field) > 1) { needs.push(person(w.account, 'several_accounts_match', [w.slug])); continue; }
    links.push({ slug: w.slug, field: w.field, account_id: w.account.id, network: w.account.platform, username: w.account.username, match: w.match });
  }
  return { accounts: list.length, already_linked: alreadyLinked, links, needs_person: needs };
}

// { slug: { field: account_id, ... } }, so each client is saved once.
export function changesByClient(links) {
  const out = {};
  for (const l of links || []) (out[l.slug] = out[l.slug] || {})[l.field] = l.account_id;
  return out;
}

// The accounts the Post tab may OFFER for ONE client and ONE network (session Fbpage, OPEN_REPAIRS 711). Nothing here
// links an account by itself: this only decides which accounts are plausibly the client's, and a person picks.
// An account is offered when it is
//   - the account already saved on the client in that network's slot (always listed first, even if it is
//     disconnected or gone from Post for Me, so the page can say so), or
//   - connected, of that network, saved on NO client in any slot (archived included), and EITHER its external_id
//     equals the client's slug or full display name (the team sets it when sending a Post for Me connect link; this is
//     how a LinkedIn company page, whose display name is the company's, reaches its client) OR its display name
//     contains the client's full display name (case, accents and punctuation ignored in both).
// Anything else is never offered. accounts: safeAccount() results; profiles: every client_profiles row (with
// display_name). Never mutates.
export const NETWORK_SLOTS = Object.freeze({
  tiktok: { field: 'postforme_account_id', platforms: ['tiktok', 'tiktok_business'] },
  instagram: { field: 'postforme_instagram_account_id', platforms: ['instagram'] },
  facebook: { field: 'postforme_facebook_account_id', platforms: ['facebook'] },
  youtube: { field: 'postforme_youtube_account_id', platforms: ['youtube'] },
  linkedin: { field: 'postforme_linkedin_account_id', platforms: ['linkedin'] },
});

export function foldName(v) {
  return str(v).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}
// The account's own name contains the client's full display name. An empty client name matches nothing.
export function nameContainsClient(accountName, clientName) {
  const c = foldName(clientName);
  return c.length >= 3 && foldName(accountName).includes(c);
}

// The account's external_id is the client's slug or full display name (equal after folding; at least 3 letters).
export function externalIdIsClient(externalId, profile) {
  const e = foldName(externalId);
  return e.length >= 3 && !!profile && (e === foldName(profile.slug) || e === foldName(profile.display_name));
}

export function accountChoices(accounts, profiles, slug, network) {
  const slot = NETWORK_SLOTS[network];
  if (!slot) return { saved_id: '', accounts: [] };
  const rows = Array.isArray(profiles) ? profiles : [];
  const mine = rows.find(p => p && p.slug === slug) || null;
  const list = (Array.isArray(accounts) ? accounts : []).filter(Boolean);
  const byId = new Map(list.map(a => [a.id, a]));
  const onSomeClient = new Set();
  for (const p of rows) for (const f of SLOT_FIELDS) { const v = slotValue(p, f); if (v) onSomeClient.add(v); }
  const savedId = mine ? slotValue(mine, slot.field) : '';
  const nameOf = a => a.display_name || a.username || '';
  const shape = (a, saved) => ({ id: a.id, name: nameOf(a), handle: a.username && a.username !== nameOf(a) ? a.username : '', connected: a.status === 'connected', saved });
  const out = [];
  if (savedId) { const a = byId.get(savedId); out.push(a ? shape(a, true) : { id: savedId, name: '', handle: '', connected: false, saved: true }); }
  if (mine && !mine.archived_at) for (const a of list) {
    if (!slot.platforms.includes(a.platform) || a.status !== 'connected' || onSomeClient.has(a.id)) continue;
    // Match on the display name; the username only when Post for Me reports no display name.
    if (externalIdIsClient(a.external_id, mine) || nameContainsClient(a.display_name || a.username, mine.display_name)) out.push(shape(a, false));
  }
  return { saved_id: savedId, accounts: out };
}

export const PAGE_SIZE = 50;
export const MAX_PAGES = 40; // 2,000 accounts; past it the list is treated as incomplete

// One run. deps (all async):
//   fetchPage(offset, limit) -> raw Post for Me accounts (array), or null when Post for Me could not be read;
//   readProfiles()           -> every client_profiles row (archived included);
//   saveClient(row, changes) -> { ok } or { ok: false, error }; the caller's save path (network check, the version
//                               in row.updated_at, a history row naming the automatic link);
//   copySheet()              -> sends the queued Sheet copy once.
// Raw accounts are projected to safe fields at once and never leave this function.
export async function runAccountSync(deps, { dryRun = false } = {}) {
  const accounts = [];
  let complete = false;
  for (let page = 0; page < MAX_PAGES; page++) {
    const got = await deps.fetchPage(page * PAGE_SIZE, PAGE_SIZE);
    if (!Array.isArray(got)) return { ok: false, error: 'postforme_unreachable' };
    for (const a of got) { const s = safeAccount(a); if (s) accounts.push(s); }
    if (got.length < PAGE_SIZE) { complete = true; break; }
  }
  // Without the whole list a match that looks unique may not be (another account could want the same slot).
  if (!complete) return { ok: false, error: 'postforme_list_incomplete' };
  const profiles = await deps.readProfiles();
  const plan = planLinks(accounts, profiles);
  const out = { ok: true, dry_run: !!dryRun, accounts: plan.accounts, already_linked: plan.already_linked, linked: [], needs_person: plan.needs_person.slice() };
  if (dryRun) { out.linked = plan.links; return out; }
  const grouped = changesByClient(plan.links);
  for (const [slug, changes] of Object.entries(grouped)) {
    const row = profiles.find(p => p.slug === slug);
    const mine = plan.links.filter(l => l.slug === slug);
    const res = await deps.saveClient(row, changes);
    if (res && res.ok) out.linked.push(...mine);
    else for (const l of mine) out.needs_person.push({ account_id: l.account_id, network: l.network, username: l.username, reason: 'save_refused:' + ((res && res.error) || 'unknown'), candidates: [slug] });
  }
  if (out.linked.length) out.sheet_copy = await deps.copySheet();
  return out;
}
