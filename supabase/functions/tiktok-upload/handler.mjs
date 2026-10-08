// The tiktok-upload Edge Function's actions, with every outside thing passed in, so the whole flow runs under
// Node against a fake Post For Me and a fake table (test/tiktok-upload-source.js, test/tiktok-upload-browser.js).
// index.ts only wires the real ones: supabase-js for the table, fetch for Post For Me and Google.
//
// pfm(method, path, body?) -> { ok, status, data }   never throws (status 0 = network failure or timeout)
// store: get(id) -> row|null, insert(row), save(row), list(limit) -> rows (newest sort_at first),
//        profiles() -> [{ slug, display_name, postforme_account_id }], copy(rows) -> number of rows added
//        (rows whose id is already there are kept as they are)
//        dueOpen(limit) -> open rows whose time has come, least recently asked first (the safety net)
//        byPostId(postId) -> row|null
// readSheet: () -> values (the TikTokUpload tab, first row = headers), or null when no Sheet is configured
// webhookUrl: the URL Post For Me should POST results to (admin webhook_status / webhook_register)
import {
  applyCreateResponse, applyResults, buildCreate, expectedAccountId, findClientProfile, needsRefresh, planSheetCopy,
  platformMismatch, publicRow, refreshCandidates, resultState, retryPlan, sameSecret, sweepCandidates, WEBHOOK_EVENT, webhookFor,
} from '../_shared/tiktok-queue.mjs';

export const LIST_LIMIT = 100;
export const REFRESH_PER_LIST = 10;
export const SWEEP_LIMIT = 25;
export const COPY_CHUNK = 200;

const clean = (v) => String(v == null ? '' : v).trim();
const reply = (status, body) => ({ status, body });

const OPEN_STATUSES = ['queued', 'uploading', 'processing', 'scheduled'];

// Post For Me's result webhook. No staff key: the request proves itself with the webhook's secret.
// expectedSecret() -> the secret Post For Me holds for this URL, or null when it cannot be found.
// Always 2xx for anything that is not a bad secret, so Post For Me does not retry events we choose to ignore.
export async function handleResultWebhook(args) {
  const { secret, body, expectedSecret, store, now } = args;
  const nowIso = new Date(typeof now === 'function' ? now() : Date.now()).toISOString();
  const expected = await expectedSecret();
  if (!expected) return reply(503, { ok: false, error: 'webhook_not_configured' });
  if (!sameSecret(secret, expected)) return reply(401, { ok: false, error: 'bad_secret' });
  const event = body && typeof body === 'object' ? body : {};
  if (clean(event.event_type) !== WEBHOOK_EVENT) return reply(200, { ok: true, ignored: 'event_type' });
  const data = event.data && typeof event.data === 'object' ? event.data : {};
  const postId = clean(data.post_id);
  if (!postId) return reply(200, { ok: true, ignored: 'no_post_id' });
  const row = await store.byPostId(postId);
  // Not a TikTok queue post (an Instagram post on the same Post For Me account, or an older one): nothing to do.
  if (!row) return reply(200, { ok: true, matched: false });
  const next = { ...applyResults(row, { data: [{ ...data, post_id: postId }] }, nowIso), last_checked_at: nowIso };
  await store.save(next);
  return reply(200, { ok: true, matched: true, status: next.status });
}

export async function handleTiktokUpload(args) {
  const { body, role, actor, pfm, store, readSheet, now, webhookUrl } = args;
  const input = body && typeof body === 'object' ? body : {};
  const action = clean(input.action);
  const nowMs = () => (typeof now === 'function' ? now() : Date.now());
  const nowIso = () => new Date(nowMs()).toISOString();

  // Asks Post For Me how a post went; saves the answer when the row can still change.
  const refresh = async (row) => {
    let adopted = false;
    if (!row.upload_post_id && OPEN_STATUSES.includes(row.status)) {
      // A row that never got its post id back: the direct submit sent the row id as external_id.
      const look = await pfm('GET', '/social-posts?external_id=' + encodeURIComponent(row.id));
      const list = look.ok && look.data && Array.isArray(look.data.data) ? look.data.data : null;
      const hit = list ? list.find((x) => x && x.id && String(x.external_id || '') === row.id) : null;
      if (!hit) {
        // Nothing to ask about yet (or a row from before Post For Me): note the try so others go first.
        if (list) { try { await store.save({ ...row, last_checked_at: nowIso() }); } catch {} }
        return { row, pfm: null };
      }
      row = applyCreateResponse(row, hit, nowIso());
      adopted = true;
    }
    if (!row.upload_post_id) return { row, pfm: null };
    const r = await pfm('GET', '/social-post-results?post_id=' + encodeURIComponent(row.upload_post_id));
    const at = nowIso();
    if (!r.ok) {
      // The found post id is worth keeping even when the result lookup failed.
      if (adopted) { try { await store.save(row); } catch {} }
      return { row, pfm: { state: 'unknown' } };
    }
    const state = resultState(r.data, row.upload_post_id);
    if (!needsRefresh(row)) {
      if (adopted) { const kept = { ...row, last_checked_at: at }; try { await store.save(kept); return { row: kept, pfm: state }; } catch {} }
      return { row, pfm: state };
    }
    const next = { ...applyResults(row, r.data, at), last_checked_at: at };
    try { await store.save(next); } catch { return { row, pfm: state }; }
    return { row: next, pfm: state };
  };

  // Sends a built post to Post For Me and stores the answer on the row.
  const send = async (row, postBody) => {
    const created = await pfm('POST', '/social-posts', postBody);
    const answer = created.ok ? created.data : { message: (created.data && (created.data.message || created.data.error)) || ('Post For Me answered ' + created.status) };
    const next = applyCreateResponse(row, answer, nowIso());
    await store.save(next);
    return next;
  };
  const created = (row) => reply(200, { ok: row.status !== 'failed', id: row.id, status: row.status, scheduled_for: publicRow(row).scheduled_for, error: row.error || undefined, row: publicRow(row) });

  if (action === 'mint') {
    const r = await pfm('POST', '/media/create-upload-url');
    const uploadUrl = clean(r.data && r.data.upload_url), mediaUrl = clean(r.data && r.data.media_url);
    if (!r.ok || !uploadUrl || !mediaUrl) return reply(502, { ok: false, error: 'Post For Me did not return an upload url' });
    return reply(200, { ok: true, upload_url: uploadUrl, media_url: mediaUrl });
  }

  if (action === 'create') {
    const built = buildCreate(input, nowMs(), actor);
    if (!built.ok) return reply(400, { ok: false, error: built.error });
    const row = built.row;
    // Same idempotency key twice = the same post, never two.
    const existing = await store.get(row.id);
    if (existing && existing.upload_post_id) return created(existing);

    // The account must be the one on file for this client: a caller cannot swap in another client's account.
    const expected = expectedAccountId(findClientProfile(await store.profiles(), row.client));
    if (!expected) return reply(409, { ok: false, error: 'The synced Clients Info copy has no TikTok account for this client.' });
    if (expected !== row.profile) return reply(403, { ok: false, error: 'That account is not the one on file for this client.' });

    // Post For Me must say this account is a TikTok one. Fail closed on anything else.
    const acct = await pfm('GET', '/social-accounts/' + encodeURIComponent(row.profile));
    if (!acct.ok) {
      return acct.status === 404
        ? reply(400, { ok: false, error: 'Post For Me does not know that account id.' })
        : reply(502, { ok: false, error: 'Could not check the account with Post For Me. Try again.' });
    }
    const mismatch = platformMismatch(acct.data);
    if (mismatch) return reply(400, { ok: false, error: mismatch });

    if (existing) {
      // An earlier attempt with this key never got a post id back. If Post For Me did accept it, adopt it.
      const found = await pfm('GET', '/social-posts?external_id=' + encodeURIComponent(row.id));
      if (!found.ok) return reply(502, { ok: false, error: 'Could not check Post For Me for an earlier attempt. Try again.' });
      const list = found.data && Array.isArray(found.data.data) ? found.data.data : [];
      const hit = list.find((x) => x && x.id && String(x.external_id || '') === row.id);
      if (hit) {
        const adopted = applyCreateResponse({ ...existing }, hit, nowIso());
        await store.save(adopted);
        return created(adopted);
      }
      await store.save({ ...existing, ...row, created_at: existing.created_at });
    } else {
      await store.insert(row);
    }
    return created(await send(row, built.postBody));
  }

  // The safety net: ask Post For Me about open rows whose time has come, wherever they sit in the queue.
  const sweep = async (pageRows, limit) => {
    const due = sweepCandidates((await store.dueOpen(limit)).concat(refreshCandidates(pageRows || [], nowMs(), limit)), nowMs(), limit);
    const fresh = new Map();
    await Promise.all(due.map(async (r) => { fresh.set(r.id, (await refresh(r)).row); }));
    return fresh;
  };

  if (action === 'list') {
    const rows = await store.list(LIST_LIMIT);
    const fresh = await sweep(rows, REFRESH_PER_LIST);
    return reply(200, { ok: true, rows: rows.map((r) => publicRow(fresh.get(r.id) || r)) });
  }

  if (action === 'refresh_due') {
    const fresh = await sweep([], SWEEP_LIMIT);
    const after = [...fresh.values()];
    return reply(200, { ok: true, checked: after.length, still_open: after.filter((r) => OPEN_STATUSES.includes(r.status)).length,
      posted: after.filter((r) => r.status === 'posted').length, failed: after.filter((r) => r.status === 'failed').length });
  }

  if (action === 'webhook_status' || action === 'webhook_register' || action === 'webhook_remove') {
    if (role !== 'admin') return reply(403, { ok: false, error: 'admin key required' });
    const listed = await pfm('GET', '/webhooks');
    if (!listed.ok) return reply(502, { ok: false, error: 'Could not read the webhooks from Post For Me.' });
    const all = Array.isArray(listed.data && listed.data.data) ? listed.data.data : (Array.isArray(listed.data) ? listed.data : []);
    // Never the secrets: ids, urls and events only.
    const shown = (w) => ({ id: w.id, url: w.url, event_types: w.event_types || [], points_here: w.url === webhookUrl });
    if (action === 'webhook_status') return reply(200, { ok: true, webhook_url: webhookUrl, webhooks: all.map(shown) });
    if (action === 'webhook_register') {
      const mine = webhookFor(all, webhookUrl);
      if (mine) return reply(200, { ok: true, created: false, webhook: shown(mine) });
      const made = await pfm('POST', '/webhooks', { url: webhookUrl, event_types: [WEBHOOK_EVENT] });
      if (!made.ok || !made.data || !made.data.id) return reply(502, { ok: false, error: 'Post For Me did not create the webhook.' });
      return reply(200, { ok: true, created: true, webhook: shown(made.data) });
    }
    const id = clean(input.id);
    const target = all.find((w) => w && w.id === id);
    if (!target) return reply(404, { ok: false, error: 'No Post For Me webhook with that id.' });
    if (target.url === webhookUrl) return reply(409, { ok: false, error: 'That is this function\'s own webhook; it is not removed from here.' });
    const gone = await pfm('DELETE', '/webhooks/' + encodeURIComponent(id));
    if (!gone.ok) return reply(502, { ok: false, error: 'Post For Me did not remove the webhook.' });
    return reply(200, { ok: true, removed: shown(target) });
  }

  if (action === 'status' || action === 'retry') {
    const id = clean(input.id);
    if (!id) return reply(400, { ok: false, error: 'id required' });
    const row = await store.get(id);
    if (action === 'status') {
      if (!row) return reply(404, { ok: false, row: null, pfm: null });
      const out = await refresh(row);
      return reply(200, { ok: true, row: publicRow(out.row), pfm: out.pfm });
    }
    const plan = retryPlan(row, nowMs());
    if (!plan.ok) return reply(plan.code === 'not_found' ? 404 : 409, { ok: false, code: plan.code, error: plan.error });
    await store.save(plan.row);
    const next = await send(plan.row, plan.postBody);
    return reply(200, { ok: next.status !== 'failed', error: next.error || undefined, row: publicRow(next) });
  }

  if (action === 'import_sheet') {
    if (role !== 'admin') return reply(403, { ok: false, error: 'admin key required' });
    const values = await readSheet();
    if (values == null) return reply(503, { ok: false, error: 'sheet_not_configured' });
    const plan = planSheetCopy(values, nowIso());
    if (!plan.ok) return reply(422, { ok: false, error: plan.error });
    const counts = { ...plan.counts, copied: 0, already_here: 0 };
    if (input.dry_run === true) return reply(200, { ok: true, dry_run: true, counts });
    for (let i = 0; i < plan.rows.length; i += COPY_CHUNK) {
      const chunk = plan.rows.slice(i, i + COPY_CHUNK);
      const added = await store.copy(chunk);
      counts.copied += added;
      counts.already_here += chunk.length - added;
    }
    return reply(200, { ok: true, counts });
  }

  return reply(400, { ok: false, error: 'unknown action' });
}
