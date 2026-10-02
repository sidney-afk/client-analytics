// The read-only Sheet copy: after SyncView's database has taken a roster
// change, the same change is written to the Clients Info or Social Media
// Managers tab so the Sheet stays a faithful, read-only mirror until the last
// reader has moved (docs/plans/2026-10-02-roster-native.md).
//
// Plain JavaScript with every outside thing passed in (env, fetch, the small
// store below), so test/roster-native.js runs it end to end in Node against a
// fake Google. Used by roster-write and client-profile-write.
//
// Never throws to the caller: a copy that cannot be made leaves its outbox row
// pending (retried on the next call or by the copy_to_sheet action) and the
// database change stands. The Sheet id comes from the CLIENTS_INFO_SHEET_ID
// secret; no spreadsheet id is in this repository.
import {
  clientSlug, collapseOutbox, columnLetter, managerRows, planSheetCopy, planSheetRemove, profileToSheetObject, SMM_HEADERS, sheetRange,
} from './roster-native.mjs';

const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
export const SHEET_ID_SECRET = 'CLIENTS_INFO_SHEET_ID';
export const MAX_ATTEMPTS = 10;

export class SheetError extends Error {
  constructor(code, status = 0) { super(code); this.code = code; this.status = status; }
}
const clean = v => String(v == null ? '' : v).trim();

export function serviceAccount(env) {
  const raw = clean(env.get('GOOGLE_SERVICE_ACCOUNT_JSON'));
  let c = {};
  if (raw) { try { c = JSON.parse(raw); } catch (_e) { return null; } }
  else c = { client_email: env.get('GOOGLE_CLIENT_EMAIL'), private_key: env.get('GOOGLE_PRIVATE_KEY') };
  const email = clean(c.client_email);
  const key = clean(c.private_key).replace(/\\n/g, '\n');
  if (!email || !key) return null;
  return { email, key, tokenUri: clean(c.token_uri) || 'https://oauth2.googleapis.com/token' };
}

export async function googleToken(sa, fetchFn) {
  const enc = new TextEncoder();
  const b64url = s => {
    const bytes = typeof s === 'string' ? enc.encode(s) : s;
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  };
  const now = Math.floor(Date.now() / 1000);
  const unsigned = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' })) + '.' +
    b64url(JSON.stringify({ iss: sa.email, scope: SHEETS_SCOPE, aud: sa.tokenUri, exp: now + 600, iat: now }));
  const pkcs8 = sa.key.replace('-----BEGIN PRIVATE KEY-----', '').replace('-----END PRIVATE KEY-----', '').replace(/\s+/g, '');
  const key = await crypto.subtle.importKey('pkcs8', Uint8Array.from(atob(pkcs8), c => c.charCodeAt(0)),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, enc.encode(unsigned)));
  const resp = await fetchFn(sa.tokenUri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: unsigned + '.' + b64url(sig) }).toString(),
  });
  const out = await resp.json().catch(() => ({}));
  if (!resp.ok || !out.access_token) throw new SheetError('sheet_auth_failed', resp.status);
  return String(out.access_token);
}

async function readTab(sheetId, token, tab, fetchFn) {
  const url = 'https://sheets.googleapis.com/v4/spreadsheets/' + encodeURIComponent(sheetId) + '/values/' +
    encodeURIComponent(sheetRange(tab, 'A1:ZZ')) + '?valueRenderOption=FORMATTED_VALUE&majorDimension=ROWS';
  const resp = await fetchFn(url, { headers: { Authorization: 'Bearer ' + token } });
  if (resp.status === 403 || resp.status === 404) throw new SheetError('sheet_not_shared', resp.status);
  if (!resp.ok) throw new SheetError('sheet_read_failed', resp.status);
  const out = await resp.json();
  return Array.isArray(out.values) ? out.values : [];
}

async function writeTab(sheetId, token, entry, fetchFn) {
  const base = 'https://sheets.googleapis.com/v4/spreadsheets/' + encodeURIComponent(sheetId);
  const auth = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
  const check = resp => {
    if (resp.status === 403) throw new SheetError('sheet_not_editable', resp.status);
    if (!resp.ok) throw new SheetError('sheet_write_failed', resp.status);
  };
  if (entry.updates.length) {
    // RAW: the text goes in exactly as typed, never parsed as a formula.
    check(await fetchFn(base + '/values:batchUpdate', {
      method: 'POST', headers: auth,
      body: JSON.stringify({ valueInputOption: 'RAW', data: entry.updates.map(u => ({ range: u.range, values: [[u.value]] })) }),
    }));
  }
  if (entry.appends.length) {
    check(await fetchFn(base + '/values/' + encodeURIComponent(sheetRange(entry.tab, 'A1')) + ':append?valueInputOption=RAW&insertDataOption=INSERT_ROWS', {
      method: 'POST', headers: auth, body: JSON.stringify({ values: entry.appends }),
    }));
  }
  if (entry.deletes.length) {
    // An archived client's row leaves the mirror, so the daily roster job (which
    // reads this tab) cannot bring it back. Highest row first, so earlier row
    // numbers stay valid; done after every cell write and append.
    const metaResp = await fetchFn(base + '?fields=sheets.properties(sheetId,title)', { headers: { Authorization: 'Bearer ' + token } });
    if (!metaResp.ok) throw new SheetError('sheet_read_failed', metaResp.status);
    const meta = await metaResp.json();
    const tabInfo = (meta.sheets || []).map(x => x.properties || {}).find(pr => pr.title === entry.tab);
    if (!tabInfo || typeof tabInfo.sheetId !== 'number') throw new SheetError('sheet_tab_missing');
    const rows = [...new Set(entry.deletes)].sort((a, b) => b - a);
    check(await fetchFn(base + ':batchUpdate', {
      method: 'POST', headers: auth,
      body: JSON.stringify({ requests: rows.map(r => ({ deleteDimension: { range: { sheetId: tabInfo.sheetId, dimension: 'ROWS', startIndex: r - 1, endIndex: r } } })) }),
    }));
  }
}

// store: { authority() -> 'sheet'|'syncview'|'', pending(limit) -> [{id,tab,client_slug,client_name}],
//          profile(slug) -> row|null, managers() -> [...], markDone(ids), markFailed(ids, code),
//          hasNewer(tab, slug, afterId) -> bool, requeue(group) }
// One read and one write per tab per call, however many clients are queued
// (Google allows about 60 requests a minute per account), so a full resync of
// the whole roster is a handful of requests.
export async function copyToSheet({ store, env, fetchFn, limit = 50 }) {
  const sa = serviceAccount(env);
  const sheetId = clean(env.get(SHEET_ID_SECRET));
  const summary = { configured: !!(sa && sheetId), done: 0, failed: 0, pending: 0 };
  let groups = [];
  try {
    // The Sheet is only ever written FROM the database while the database is
    // the main copy. After a rollback to "sheet" nothing queued may overwrite it.
    if (await store.authority() !== 'syncview') {
      summary.refused = 'authority_not_syncview';
      summary.pending = collapseOutbox(await store.pending(limit)).length;
      return summary;
    }
    groups = collapseOutbox(await store.pending(limit));
    if (!summary.configured) { summary.pending = groups.length; return summary; }
    if (!groups.length) return summary;
    const token = await googleToken(sa, fetchFn);
    const tabs = new Map();
    const fail = async (g, code) => { summary.failed++; await store.markFailed(g.ids, code).catch(() => {}); };
    let managers = null;
    for (const g of groups) {
      try {
        let wanted;
        if (g.tab === 'Clients Info') {
          const row = await store.profile(g.client_slug);
          if (!row) { await store.markDone(g.ids); summary.done++; continue; }
          if (row.archived_at) {
            if (!tabs.has(g.tab)) tabs.set(g.tab, { tab: g.tab, values: await readTab(sheetId, token, g.tab, fetchFn), updates: [], appends: [], deletes: [], members: [] });
            const gone = planSheetRemove(tabs.get(g.tab).values, g.client_slug);
            if (!gone.ok) throw new SheetError(gone.error);
            if (gone.row) {
              tabs.get(g.tab).deletes.push(gone.row);
              tabs.get(g.tab).values[gone.row - 1] = []; // same row numbers for the cell writes still to come
            }
            tabs.get(g.tab).members.push(g);
            continue;
          }
          wanted = profileToSheetObject(row);
        } else {
          if (!managers) managers = managerRows(await store.managers());
          const mine = managers.filter(r => clientSlug(r.client_name) === g.client_slug);
          wanted = mine.length
            ? { client_name: mine[0].client_name, social_media_manager: mine[0].social_media_manager, slack_profile_url: mine[0].slack_profile_url }
            : { client_name: g.client_name, social_media_manager: '', slack_profile_url: '' };
          for (const h of Object.keys(wanted)) if (!SMM_HEADERS.includes(h)) delete wanted[h];
        }
        if (!tabs.has(g.tab)) tabs.set(g.tab, { tab: g.tab, values: await readTab(sheetId, token, g.tab, fetchFn), updates: [], appends: [], deletes: [], members: [] });
        const entry = tabs.get(g.tab);
        const plan = planSheetCopy(entry.values, g.tab, g.client_slug, wanted, columnLetter, sheetRange);
        if (!plan.ok) throw new SheetError(plan.error);
        // Keep the in-memory copy of the tab current so later clients in this
        // call see earlier ones (an appended row is not appended twice).
        if (plan.op === 'update') {
          const headers = (entry.values[0] || []).map(h => clean(h));
          for (const u of plan.updates) {
            const row = entry.values[plan.sheet_row - 1];
            while (row.length < headers.length) row.push('');
            row[headers.indexOf(u.field)] = u.value;
            entry.updates.push(u);
          }
        } else {
          entry.values.push(plan.row);
          entry.appends.push(plan.row);
        }
        entry.members.push(g);
      } catch (e) {
        await fail(g, e instanceof SheetError ? e.code : 'sheet_copy_failed');
      }
    }
    for (const entry of tabs.values()) {
      try {
        await writeTab(sheetId, token, entry, fetchFn);
        for (const g of entry.members) {
          // A change queued while this call was running may have been written by
          // another call BEFORE our (older) values landed. Queue one more copy
          // so the last write is always the newest state.
          if (await store.hasNewer(g.tab, g.client_slug, Math.max(...g.ids))) await store.requeue(g);
          await store.markDone(g.ids);
          summary.done++;
        }
      } catch (e) {
        for (const g of entry.members) await fail(g, e instanceof SheetError ? e.code : 'sheet_copy_failed');
      }
    }
  } catch (e) {
    summary.error = e instanceof SheetError ? e.code : 'sheet_copy_failed';
    summary.failed = Math.max(summary.failed, groups.length - summary.done);
    if (groups.length) await store.markFailed(groups.flatMap(g => g.ids), summary.error).catch(() => {});
  }
  return summary;
}
