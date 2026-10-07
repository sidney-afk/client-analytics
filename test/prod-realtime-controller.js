'use strict';
/*
 * prod-realtime-controller.js -- the Production tab's live-update controller
 * (src/index/260-production-refresh-boot.js.part, _prodRtCreate), driven with
 * a mocked supabase-js channel and a fake clock. Pins: status transitions,
 * debounce + coalesce, echo suppression, the poll interval switch, catch-up
 * on re-subscribe, retry of a declined refresh, hidden-tab deferral, teardown.
 */
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'src/index/260-production-refresh-boot.js.part'), 'utf8');
const a = src.indexOf('/* PROD_RT_CONTROLLER_BEGIN */');
const b = src.indexOf('/* PROD_RT_CONTROLLER_END */');
assert.ok(a > 0 && b > a, 'controller markers present');
const _prodRtCreate = new Function(src.slice(a, b) + '\nreturn _prodRtCreate;')();

// The wiring the page relies on.
// Through the on-demand Workload area, which registers its own client.
assert.ok(/getClient: \(\) => svArea\('workload'\)\.then\(wl => wl\.v2Client\(\), \(\) => null\)/.test(src)
  && /v2Client: _wlV2Client,/.test(fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8')), 'reuses the shared supabase-js client');
assert.ok(/refresh: \(o\) => _prodDeltaRefresh\(\{ full: !!\(o && o\.full\) \}\)/.test(src), 'events feed the existing delta refresh');
const stale = Number((fs.readFileSync(path.join(__dirname, '..', 'src/index/250-production-controls-data.js.part'), 'utf8').match(/const PROD_STALE_AFTER_MS = (\d+);/) || [])[1]);
const slow = Number((src.match(/const PROD_RT_SLOW_POLL_MS = (\d+);/) || [])[1]);
assert.ok(slow > 0 && stale > 0 && slow <= stale - 30000, 'slow poll keeps a 30 s margin under the stale threshold (no degraded flicker)');
assert.ok(/const PROD_RT_FLAG_KEY = 'prod_realtime';/.test(src) && /localStorage\.getItem\(PROD_RT_LOCAL_KEY\) === 'off'/.test(src), 'kill switch: runtime flag + per-browser override');
assert.ok(/_prodRtFlagOn = !\(value && value\.enabled === false\);/.test(src), 'flag defaults ON; only explicit enabled:false turns it off');
assert.ok(/window\.prodRtStatus = \(\) => _prodRt\.status\(\)/.test(src), 'console helper exposed');
assert.ok(/if \(!_prodRtActive\(\)\) _prodRt\.stop\(\);/.test(src), 'leaving Production tears the channel down');
assert.ok(/if \(!failures\) return _prodRt\.pollInterval\(\);/.test(src), 'poll cadence follows realtime status');

function harness(opts) {
  const o = opts || {};
  let now = 1000;
  let timers = [];
  let seq = 0;
  const calls = [];
  const commentCalls = [];
  const pollChanges = [];
  const env = { active: true, hidden: false, refreshResult: true, enabled: true };
  const local = { deliverables: new Map(), batches: new Map() };
  const channel = { handlers: [], statusCb: null, name: '' };
  const client = {
    removed: 0,
    channel(name) {
      channel.name = name;
      channel.names = (channel.names || []).concat(name);
      const api = {
        on(kind, filter, cb) { channel.handlers.push({ kind, table: filter.table, cb }); return api; },
        subscribe(cb) { channel.statusCb = cb; return api; }
      };
      return api;
    },
    removeChannel() { this.removed++; }
  };
  const rt = _prodRtCreate({
    debounceMs: 300, retryMs: 2000, slowPollMs: 90000, fastPollMs: 30000,
    setTimeout(fn, ms) { const id = ++seq; timers.push({ id, at: now + ms, fn }); return id; },
    clearTimeout(id) { timers = timers.filter(t => t.id !== id); },
    now: () => now,
    hidden: () => env.hidden,
    active: () => env.active,
    enabled: () => env.enabled,
    getClient: () => (o.noClient ? null : client),
    refresh(x) { calls.push(x); return env.refreshResult; },
    refreshComments(ids) { commentCalls.push(ids.slice()); },
    localRow: (table, id) => local[table] ? local[table].get(id) || null : null,
    onPollChange: (ms) => pollChanges.push(ms)
  });
  async function advance(ms) {
    const until = now + ms;
    for (;;) {
      timers.sort((x, y) => x.at - y.at);
      const t = timers[0];
      if (!t || t.at > until) break;
      timers.shift();
      now = t.at;
      await t.fn();
      await Promise.resolve();
    }
    now = until;
  }
  const emit = (table, payload) => channel.handlers.filter(h => h.table === table).forEach(h => h.cb(payload));
  const status = (s) => channel.statusCb(s);
  return { rt, env, local, channel, client, calls, commentCalls, pollChanges, advance, emit, status };
}

(async () => {
  let n = 0;
  const ok = (c, m) => { assert.ok(c, m); n++; };

  // 1. Subscribe + status transitions + poll interval switch.
  {
    const h = harness();
    ok(h.rt.status().status === 'idle' && h.rt.pollInterval() === 30000, 'idle polls fast');
    await h.rt.start();
    ok(h.channel.name === 'production_live', 'channel opened');
    ok(['deliverables', 'batches', 'deliverable_events'].every(t => h.channel.handlers.some(x => x.table === t && x.kind === 'postgres_changes')), 'three tables subscribed');
    ok(h.rt.status().status === 'connecting' && h.rt.pollInterval() === 30000, 'connecting still polls fast');
    h.status('SUBSCRIBED');
    ok(h.rt.status().live === true && h.rt.pollInterval() === 90000, 'SUBSCRIBED slows the poll');
    ok(h.pollChanges.join() === '90000', 'poll change reported');
    ok(h.calls.length === 0, 'first SUBSCRIBED does not refresh');
    for (const bad of ['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED']) {
      h.status(bad);
      ok(h.rt.status().live === false && h.rt.pollInterval() === 30000 && h.rt.status().lastProblem === bad, bad + ' restores the fast poll');
      h.status('SUBSCRIBED');
      ok(h.rt.pollInterval() === 90000, 'resubscribe after ' + bad + ' slows again');
    }
    ok(h.pollChanges.join() === '90000,30000,90000,30000,90000,30000,90000', 'every switch reported once');
    // 2. Catch-up on re-subscribe: coalesced into one full refresh.
    await h.advance(300);
    ok(h.calls.length === 1 && h.calls[0].full === true, 'resubscribe runs one full catch-up (coalesced)');
    ok(h.rt.status().catchups === 3, 'three catch-ups counted');
  }

  // 3. Debounce + coalesce + echo suppression.
  {
    const h = harness();
    await h.rt.start(); h.status('SUBSCRIBED');
    h.local.deliverables.set('d1', { id: 'd1', updated_at: 't1' });
    h.emit('deliverables', { eventType: 'UPDATE', new: { id: 'd1', updated_at: 't1' } });
    await h.advance(1000);
    ok(h.calls.length === 0 && h.rt.status().echoesIgnored === 1, 'own-write echo ignored');
    for (let i = 0; i < 10; i++) h.emit('deliverables', { eventType: 'UPDATE', new: { id: 'd' + i, updated_at: 't2' } });
    await h.advance(299);
    ok(h.calls.length === 0, 'debounced: nothing before 300 ms');
    await h.advance(1);
    ok(h.calls.length === 1 && h.calls[0].full === false, 'burst coalesced into one delta refresh');
    h.emit('deliverables', { eventType: 'UPDATE', new: { id: 'd9', updated_at: 't3' } });
    h.emit('batches', { eventType: 'UPDATE', new: { id: 'b1', updated_at: 'x' } });
    await h.advance(300);
    ok(h.calls.length === 2 && h.calls[1].full === true, 'a batch change upgrades the coalesced read to full');
    h.emit('deliverables', { eventType: 'DELETE', new: {}, old: { id: 'd1' } });
    await h.advance(300);
    ok(h.calls.length === 3 && h.calls[2].full === true, 'a delete forces a full read');
    h.local.batches.set('b2', { id: 'b2', updated_at: 'u' });
    h.emit('batches', { eventType: 'UPDATE', new: { id: 'b2', updated_at: 'u' } });
    await h.advance(300);
    ok(h.calls.length === 3, 'batch echo ignored');
    h.emit('deliverable_events', { eventType: 'INSERT', new: { id: 'e1', deliverable_id: 'd1' } });
    await h.advance(300);
    ok(h.calls.length === 4 && h.calls[3].full === true, 'deliverable_events trigger a full refresh (propagated renames keep updated_at)');

    // 4. A declined refresh (null) is retried, not dropped.
    h.env.refreshResult = null;
    h.emit('deliverables', { eventType: 'UPDATE', new: { id: 'dz', updated_at: 'q' } });
    await h.advance(300);
    ok(h.calls.length === 5 && h.rt.status().retries === 1, 'declined refresh counted');
    h.env.refreshResult = true;
    await h.advance(2000);
    ok(h.calls.length === 6 && h.rt.status().pending === false, 'declined refresh retried');

    // 5. Hidden tab defers; resume runs it.
    h.env.hidden = true;
    h.emit('deliverables', { eventType: 'UPDATE', new: { id: 'dh', updated_at: 'h' } });
    await h.advance(5000);
    ok(h.calls.length === 6 && h.rt.status().pending === true, 'hidden tab holds the read');
    h.env.hidden = false; h.rt.resume();
    await h.advance(0);
    ok(h.calls.length === 7, 'shown tab runs the held read');

    // 6. Teardown: channel removed, late CLOSED ignored, fast poll restored.
    h.emit('deliverables', { eventType: 'UPDATE', new: { id: 'dt', updated_at: 'z' } });
    const cb = h.channel.statusCb;
    h.rt.stop();
    ok(h.client.removed === 1 && h.rt.status().status === 'idle' && h.rt.pollInterval() === 30000, 'stop removes the channel');
    cb('CLOSED');
    ok(h.rt.status().status === 'idle' && h.rt.status().lastProblem !== 'CLOSED', 'late CLOSED from old channel ignored');
    await h.advance(1000);
    ok(h.calls.length === 7, 'pending read cleared on teardown');
    await h.rt.start();
    h.channel.statusCb('SUBSCRIBED');
    await h.advance(300);
    ok(h.calls.length === 7, 'reopening: first SUBSCRIBED is not a catch-up');
  }

  // 7. Propagated rename: same updated_at, new title -> not an echo, full read.
  {
    const h = harness();
    await h.rt.start(); h.status('SUBSCRIBED');
    h.local.deliverables.set('r1', { id: 'r1', updated_at: 't1', title: 'Old' });
    h.emit('deliverables', { eventType: 'UPDATE', new: { id: 'r1', updated_at: 't1', title: 'New' } });
    await h.advance(300);
    ok(h.rt.status().echoesIgnored === 0 && h.calls.length === 1 && h.calls[0].full === true, 'rename with kept updated_at is not an echo and forces a full read');
  }

  // 8. Kill switch: disabled never subscribes, stays on the 30 s poll; turning
  //    it off while live tears the channel down.
  {
    const h = harness();
    h.env.enabled = false;
    await h.rt.start();
    ok(h.channel.handlers.length === 0 && h.rt.status().status === 'disabled' && h.rt.pollInterval() === 30000, 'disabled: no channel, fast poll');
    h.env.enabled = true;
    await h.rt.start(); h.status('SUBSCRIBED');
    ok(h.rt.pollInterval() === 90000, 're-enabled goes live');
    h.env.enabled = false;
    h.rt.start();
    ok(h.client.removed === 1 && h.rt.status().status === 'disabled' && h.rt.pollInterval() === 30000 && h.pollChanges.slice(-1)[0] === 30000, 'kill while live removes the channel and restores 30 s');
  }

  // 9. Inactive surface and missing client.
  {
    const h = harness({ noClient: true });
    await h.rt.start();
    ok(h.rt.status().status === 'idle' && h.rt.pollInterval() === 30000, 'no client: stays idle on the fast poll');
    const h2 = harness();
    h2.env.active = false;
    await h2.rt.start();
    ok(h2.channel.handlers.length === 0, 'inactive surface never subscribes');
  }

  // 10. COMMENTS GO LIVE (2026-10-06 findings, item 2). The comment tables are
  //     closed to the browser key; the migration stamps
  //     deliverables.comments_changed_at (updated_at held still). That UPDATE
  //     re-reads only the work item's thread -- never a board refresh.
  {
    const h = harness();
    await h.rt.start(); h.status('SUBSCRIBED');
    h.local.deliverables.set('c1', { id: 'c1', updated_at: 't1', title: 'A', status: 'In Progress' });
    h.emit('deliverables', { eventType: 'UPDATE', new: { id: 'c1', updated_at: 't1', title: 'A', status: 'In Progress', comments_changed_at: '2026-10-06T10:00:00.100Z' } });
    await h.advance(299);
    ok(h.commentCalls.length === 0, 'comment signal is debounced like every other event');
    await h.advance(1);
    ok(h.commentCalls.length === 1 && h.commentCalls[0].join() === 'c1', 'a comment stamp re-reads exactly that thread');
    ok(h.calls.length === 0 && h.rt.status().echoesIgnored === 1, 'and is not a board refresh (the row itself is unchanged, so it is an echo)');
    // The same stamp again (a later unrelated event on the row) does not re-read.
    h.emit('deliverables', { eventType: 'UPDATE', new: { id: 'c1', updated_at: 't1', title: 'A', status: 'In Progress', comments_changed_at: '2026-10-06T10:00:00.100Z' } });
    await h.advance(300);
    ok(h.commentCalls.length === 1, 'an unchanged stamp does not re-read the thread');
    // Two comments on two items inside one window: one read each, one batch.
    h.emit('deliverables', { eventType: 'UPDATE', new: { id: 'c1', updated_at: 't1', comments_changed_at: '2026-10-06T10:00:05Z' } });
    h.emit('deliverables', { eventType: 'UPDATE', new: { id: 'c2', updated_at: 't9', comments_changed_at: '2026-10-06T10:00:05Z' } });
    await h.advance(300);
    ok(h.commentCalls.length === 2 && h.commentCalls[1].sort().join() === 'c1,c2', 'two threads in one window are one flush');
    // Hidden tab holds the comment read; resume runs it.
    h.env.hidden = true;
    h.emit('deliverables', { eventType: 'UPDATE', new: { id: 'c1', updated_at: 't1', comments_changed_at: '2026-10-06T10:01:00Z' } });
    await h.advance(2000);
    ok(h.commentCalls.length === 2, 'hidden tab holds the comment read');
    h.env.hidden = false; h.rt.resume();
    await h.advance(0);
    ok(h.commentCalls.length === 3 && h.commentCalls[2].join() === 'c1', 'shown tab runs the held comment read');
    // Before the migration is applied the column is absent: nothing new happens.
    h.emit('deliverables', { eventType: 'UPDATE', new: { id: 'c3', updated_at: 'tx' } });
    await h.advance(300);
    ok(h.commentCalls.length === 3, 'no comments_changed_at column, no comment read');
    // A delete never counts as a comment.
    h.emit('deliverables', { eventType: 'DELETE', new: {}, old: { id: 'c1' } });
    await h.advance(300);
    ok(h.commentCalls.length === 3, 'a delete is not a comment signal');
    ok(h.rt.status().commentSignals === 4, 'comment signals counted (' + h.rt.status().commentSignals + ')');
    h.emit('deliverables', { eventType: 'UPDATE', new: { id: 'c1', updated_at: 't1', comments_changed_at: '2026-10-06T10:02:00Z' } });
    h.rt.stop();
    await h.advance(1000);
    ok(h.commentCalls.length === 3, 'teardown drops a pending comment read');
  }

  // 11. RE-SUBSCRIBE AFTER A DROP (item 5): CHANNEL_ERROR / TIMED_OUT replace
  //     the channel after a backoff, on a fresh topic, and the new channel's
  //     SUBSCRIBED runs one catch-up.
  {
    const h = harness();
    await h.rt.start(); h.status('SUBSCRIBED');
    h.status('CHANNEL_ERROR');
    ok(h.rt.status().reconnectPending === true, 'CHANNEL_ERROR schedules a re-subscribe');
    await h.advance(999);
    ok(h.client.removed === 0, 'not before the first backoff step (1 s)');
    await h.advance(1);
    ok(h.client.removed === 1 && h.channel.name === 'production_live~1' && h.rt.status().reconnects === 1,
      'after 1 s the failed channel is removed and a new one opened on a fresh topic');
    h.status('TIMED_OUT');
    await h.advance(1999);
    ok(h.rt.status().reconnects === 1, 'the next step waits 2 s');
    await h.advance(1);
    ok(h.rt.status().reconnects === 2 && h.channel.name === 'production_live~2', '...then replaces it again');
    const before = h.calls.length;
    h.status('SUBSCRIBED');
    await h.advance(300);
    ok(h.calls.length === before + 1 && h.calls[h.calls.length - 1].full === true, 'the new channel catches up with one full read');
    ok(h.rt.status().reconnectPending === false && h.rt.pollInterval() === 90000, 'and is live again, on the slow poll');
    // Backoff resets after a success.
    h.status('CHANNEL_ERROR');
    await h.advance(1000);
    ok(h.rt.status().reconnects === 3, 'after a success the backoff starts again at 1 s');
    // Back online: at once, not after the backoff.
    h.status('CHANNEL_ERROR');
    h.rt.online();
    await h.advance(0);
    ok(h.rt.status().reconnects === 4, 'coming back online re-subscribes at once');
    // A late callback from a replaced channel is ignored.
    const stale = h.channel.statusCb;
    h.status('SUBSCRIBED');
    h.status('CHANNEL_ERROR');
    await h.advance(1000);
    const nowReconnects = h.rt.status().reconnects;
    stale('CHANNEL_ERROR');
    ok(h.rt.status().reconnects === nowReconnects, 'late status from a replaced channel is ignored');
    // Teardown cancels a pending retry.
    h.status('TIMED_OUT');
    h.rt.stop();
    await h.advance(60000);
    ok(h.rt.status().status === 'idle' && h.rt.status().reconnectPending === false, 'stop cancels a pending re-subscribe');
    // A plain CLOSED (our own teardown reports it) never re-subscribes.
    const h2 = harness();
    await h2.rt.start(); h2.status('SUBSCRIBED'); h2.status('CLOSED');
    await h2.advance(60000);
    ok(h2.rt.status().reconnects === 0, 'CLOSED alone does not start a re-subscribe loop');
  }

  // 12. Page wiring for the two additions.
  ok(/refreshComments: \(ids\) => \{[\s\S]{0,400}?_prodComments\.refresh\(open\)/.test(src),
    'the page re-reads only the open thread on a comment signal');
  ok(/window\.addEventListener\('online', \(\) => \{ if \(_prodRtActive\(\)\) _prodRt\.online\(\); \}\);/.test(src),
    'the page re-subscribes when the browser comes back online');

  console.log('prod-realtime-controller: ' + n + ' assertions passed');
})().catch((e) => { console.error(e); process.exit(1); });
