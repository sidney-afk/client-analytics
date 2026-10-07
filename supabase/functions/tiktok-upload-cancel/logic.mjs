// Pure logic for the tiktok-upload-cancel Edge Function: cancel a scheduled TikTok post in Post For Me FIRST,
// and only then mark its queue row cancelled. Every outside thing (Post For Me, the queue Sheet) is passed in,
// so test/tiktok-upload-cancel-source.js and test/tiktok-cancel-browser.js run it in Node against fakes.
//
// Why this exists: the n8n "TikTok Upload, Cancel" workflow only flips the TikTokUpload Sheet row to
// cancelled. Nothing told Post For Me, so a "cancelled" post still went out at its scheduled time.
//
// The rule: the row says Cancelled only when Post For Me no longer holds a post that can publish.
//   - Post For Me says the post is processing or processed  -> already_posted, row untouched.
//   - Post For Me refuses, times out or still has the post  -> cancel_failed,  row untouched.
//   - Post For Me has no such post (deleted now or earlier) and no result says it went out -> row cancelled.

import { columnLetter, sheetRange } from '../_shared/roster-native.mjs';

export const TAB = 'TikTokUpload';
// Post For Me post statuses (SocialPostDto.status): draft, scheduled, processing, processed.
export const PFM_GONE_OUT = Object.freeze(['processing', 'processed']);
export const PFM_CANCELLABLE = Object.freeze(['draft', 'scheduled']);
export const ROW_CANCELLABLE = Object.freeze(['scheduled', 'queued', 'uploading', 'processing']);

export const MESSAGES = Object.freeze({
  cancelled: 'Cancelled. Post For Me will not publish it.',
  already_cancelled: 'This upload was already cancelled.',
  already_posted: 'Already posted, could not cancel.',
  cancel_failed: 'Cancel failed, try again.',
  queue_update_failed: 'Cancel failed, try again. Post For Me no longer has the post, but the queue did not update.',
  not_found: 'That upload is not in the queue.',
  not_cancellable: 'Only a scheduled or queued upload can be cancelled.',
});
const STATUS = Object.freeze({
  cancelled: 200, already_cancelled: 200, already_posted: 409, cancel_failed: 502,
  queue_update_failed: 502, not_found: 404, not_cancellable: 409,
});

const clean = (v) => String(v == null ? '' : v).trim();

export function outcome(code, extra = {}) {
  return { status: STATUS[code], body: { ok: code === 'cancelled' || code === 'already_cancelled', code, message: MESSAGES[code], ...extra } };
}

// Did any Post For Me result for this post say it went out?
export function resultsSayPosted(resp, postId) {
  const list = Array.isArray(resp) ? resp : Array.isArray(resp && resp.data) ? resp.data : [];
  return list.some((x) => x && typeof x === 'object' && x.success === true && (!x.post_id || String(x.post_id) === postId));
}

// The Post For Me post created for a queue row that never got its post id back (the direct submit sends the
// row id as external_id).
export function findByExternalId(resp, rowId) {
  const list = Array.isArray(resp && resp.data) ? resp.data : Array.isArray(resp) ? resp : [];
  const hit = list.find((x) => x && x.id && String(x.external_id || '') === rowId);
  return hit ? String(hit.id) : '';
}

// pfm(method, path) -> { ok, status, data }, never throws (status 0 = network failure or timeout).
// sheet: { find(id) -> { row, rowNumber } | null, markCancelled(found, nowIso) -> void (throws on failure) }.
export async function cancelTiktokUpload({ id, pfm, sheet, nowIso }) {
  const rowId = clean(id);
  if (!rowId) return { status: 400, body: { ok: false, code: 'bad_request', message: 'id required' } };
  const found = await sheet.find(rowId);
  if (!found) return outcome('not_found');
  const row = found.row;
  const rowStatus = clean(row.status).toLowerCase();
  if (rowStatus === 'cancelled' || rowStatus === 'canceled') return outcome('already_cancelled');
  if (rowStatus === 'posted') return outcome('already_posted');
  if (!ROW_CANCELLABLE.includes(rowStatus)) return outcome('not_cancellable');

  let postId = clean(row.upload_post_id);
  if (!postId) {
    const look = await pfm('GET', '/social-posts?external_id=' + encodeURIComponent(rowId));
    if (!look.ok) return outcome('cancel_failed', { detail: 'post_lookup_failed' });
    postId = findByExternalId(look.data, rowId);
    // No post id and nothing in Post For Me yet: the submit may still be on its way, so this is not a cancel.
    if (!postId) return outcome('cancel_failed', { detail: 'post_not_in_post_for_me_yet' });
  }
  const path = '/social-posts/' + encodeURIComponent(postId);

  // Post For Me holds no post with this id. Cancelled, unless a result says it already went out.
  const goneOrPosted = async () => {
    const res = await pfm('GET', '/social-post-results?post_id=' + encodeURIComponent(postId));
    if (!res.ok) return outcome('cancel_failed', { detail: 'result_lookup_failed' });
    if (resultsSayPosted(res.data, postId)) return outcome('already_posted');
    return null;
  };

  const before = await pfm('GET', path);
  if (before.status === 404) {
    const stop = await goneOrPosted();
    if (stop) return stop;
  } else if (!before.ok) {
    return outcome('cancel_failed', { detail: 'post_read_failed' });
  } else {
    const pfmStatus = clean(before.data && before.data.status).toLowerCase();
    if (PFM_GONE_OUT.includes(pfmStatus)) return outcome('already_posted');
    if (!PFM_CANCELLABLE.includes(pfmStatus)) return outcome('cancel_failed', { detail: 'unknown_post_status' });

    const del = await pfm('DELETE', path);
    if (!del.ok && del.status !== 404) {
      // A refusal can mean it started publishing in the meantime: ask once more so the message is right.
      const again = await pfm('GET', path);
      if (again.ok && PFM_GONE_OUT.includes(clean(again.data && again.data.status).toLowerCase())) return outcome('already_posted');
      return outcome('cancel_failed', { detail: 'delete_refused' });
    }
    // Prove it is gone before the queue may say so.
    const after = await pfm('GET', path);
    if (after.status !== 404) {
      if (after.ok && PFM_GONE_OUT.includes(clean(after.data && after.data.status).toLowerCase())) return outcome('already_posted');
      return outcome('cancel_failed', { detail: 'still_in_post_for_me' });
    }
    const stop = await goneOrPosted();
    if (stop) return stop;
  }

  try {
    await sheet.markCancelled(found, nowIso);
  } catch (_e) {
    return outcome('queue_update_failed');
  }
  return outcome('cancelled', { row: { id: rowId, status: 'cancelled', updated_at: nowIso } });
}

// ---- The queue Sheet (TikTokUpload tab), read and written with a Google service account ----------------

export function locateRow(values, rowId) {
  const header = (values[0] || []).map((h) => clean(h));
  const col = (name) => header.indexOf(name);
  const idCol = col('id');
  if (idCol < 0) throw new Error('sheet_header_missing_id');
  for (let i = 1; i < values.length; i++) {
    const cells = values[i] || [];
    if (clean(cells[idCol]) !== rowId) continue;
    const row = {};
    header.forEach((h, j) => { if (h) row[h] = cells[j] == null ? '' : String(cells[j]); });
    return { row, rowNumber: i + 1, header };
  }
  return null;
}

// Only status, error and updated_at change; every other cell stays as it is.
export function cancelUpdates(found, nowIso, tab = TAB) {
  const out = [];
  const set = (name, value) => {
    const j = found.header.indexOf(name);
    if (j >= 0) out.push({ range: sheetRange(tab, columnLetter(j) + found.rowNumber), values: [[value]] });
  };
  set('status', 'cancelled');
  set('error', '');
  set('updated_at', nowIso);
  if (!out.length || !found.header.includes('status')) throw new Error('sheet_header_missing_status');
  return out;
}

export function sheetQueue({ sheetId, token, fetchFn, tab = TAB }) {
  const base = 'https://sheets.googleapis.com/v4/spreadsheets/' + encodeURIComponent(sheetId);
  return {
    async find(rowId) {
      const resp = await fetchFn(base + '/values/' + encodeURIComponent(sheetRange(tab, 'A1:ZZ')) + '?valueRenderOption=UNFORMATTED_VALUE&majorDimension=ROWS',
        { headers: { Authorization: 'Bearer ' + token } });
      if (!resp.ok) throw new Error('sheet_read_failed_' + resp.status);
      const out = await resp.json();
      return locateRow(Array.isArray(out.values) ? out.values : [], rowId);
    },
    async markCancelled(found, nowIso) {
      const resp = await fetchFn(base + '/values:batchUpdate', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ valueInputOption: 'RAW', data: cancelUpdates(found, nowIso, tab) }),
      });
      if (!resp.ok) throw new Error('sheet_write_failed_' + resp.status);
    },
  };
}
