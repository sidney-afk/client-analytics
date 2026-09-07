'use strict';
const assert = require('node:assert/strict');
const { CLIENTS, MEMBERS, clone } = require('./mock-backend');
const ui = require('./ui');
const NATIVE = '00000000-0000-4000-8000-000000000201';
async function production(h, b, role = 'admin') {
  const s = await h.session(b, role); await h.open(s, 'production');
  await s.page.locator(`[data-prod-row="${NATIVE}"]`).click();
  await s.page.locator('[data-prod-prop="status"]').waitFor(); return s;
}
module.exports = function register(add) {
  add('editor-smm-handoff', 'video', 'Kasper Approval', false, async (h, b, step) => {
    b.staffKeyFamilies = true;
    const chooseSmm = async page => {
      await ui.sheet(page);
      await ui.card(page).locator('[data-substatus-comp="video"] .cal-fld-substatus-trigger').click();
      const choice = page.locator('.cal-fld-status-menu.open').getByRole('button', { name: 'For SMM Approval', exact: true });
      assert.equal(await choice.isEnabled(), true, 'editor has a visible enabled SMM handoff');
      await choice.click();
    };
    await step('kasper-requests-editor-change', async () => {
      const k = await ui.reviewer(h, b, 'video'); const panel = await ui.review(k.page, 'video', true), start = b.records.length;
      await panel.locator('.cal-review-textarea').fill('Fictional change for the video editor');
      await panel.locator('.cal-review-tweak-btn').click(); await ui.accepted(b, start);
      assert.equal(b.rows[0].video_status, 'Tweaks Needed');
      assert.equal(b.native[0].status, 'tweak');
      await ui.fresh(h, b, 'video', 'Tweaks Needed', { kasper: true, client: false });
      const client = await h.session(b, 'client'); await h.open(client);
      await client.page.locator('.cal-review-wrap').waitFor();
      assert.equal(await client.page.locator('.cal-fld-substatus-trigger:visible,[data-prod-prop]:visible').count(), 0,
        'client cannot use staff status handoffs');
      await client.context.close();
    });
    await step('editor-send-refused', async () => {
      const editor = await h.session(b, 'editor'); await h.open(editor); await ui.pill(editor.page, 'video', 'Tweaks Needed');
      await ui.notes(editor.page); await editor.page.getByText('Fictional change for the video editor', { exact: true }).waitFor();
      await ui.closeNotes(editor.page);
      const identity = await editor.page.evaluate(() => JSON.parse(localStorage.getItem('syncview_staff_identity_v1')));
      assert.equal(identity.role, 'creative'); assert.equal(identity.member.role, 'editor');
      const before = clone(b.rows[0]), nativeBefore = clone(b.native[0]), start = b.records.length;
      b.arm('reject', 'status'); await chooseSmm(editor.page);
      await ui.until(() => b.records.slice(start).some(r => r.session === 'editor' && r.action === 'status' && r.outcome === 'rejected'), 'editor refusal recorded');
      const failedSave = ui.card(editor.page).locator('.cal-card-saving.is-error');
      await failedSave.waitFor(); assert.match(await failedSave.textContent(), /Save failed.*Retry/);
      assert.equal(b.records.slice(start).find(r => r.session === 'editor' && r.action === 'status').staff_key_role, 'creative');
      await editor.context.close();
      assert.deepEqual(b.rows[0], before); assert.deepEqual(b.native[0], nativeBefore);
      await ui.fresh(h, b, 'video', 'Tweaks Needed');
      step.observe({ editor_identity: 'creative-key/editor-member', refused_editor_handoff: 'PRESERVED' });
    });
    await step('editor-sends-smm', async () => {
      const editor = await h.session(b, 'editor'); await h.open(editor); const start = b.records.length;
      await chooseSmm(editor.page); await ui.accepted(b, start, 'status'); await ui.accepted(b, start);
      await ui.pill(editor.page, 'video', 'For SMM Approval');
      assert(b.records.slice(start).some(r => r.session === 'editor' && r.action === 'status' && r.outcome === 'accepted'));
      assert.equal(b.records.slice(start).find(r => r.session === 'editor' && r.action === 'status').staff_key_role, 'creative');
      assert.equal(b.native[0].status, 'smm_approval');
      await ui.fresh(h, b, 'video', 'For SMM Approval', { kasper: false, client: false });
    });
    await step('smm-reviews-sends-kasper', async () => {
      const smm = await h.session(b, 'smm'); await h.open(smm); const panel = await ui.review(smm.page, 'video'), start = b.records.length;
      await panel.locator('.cal-review-approve-main').click();
      await smm.page.locator('#resolveDestOverlay.active').waitFor();
      const checklist = smm.page.locator('#resolveDestChecklist input[type="checkbox"]');
      for (let i = 0; i < await checklist.count(); i++) await checklist.nth(i).check();
      await smm.page.locator('#resolveDestKasper').click();
      await ui.accepted(b, start); await ui.queue(smm.page, 'client', false);
      assert.equal(b.rows[0].video_status, 'Kasper Approval'); assert.equal(b.native[0].status, 'kasper_approval');
      assert(b.records.slice(start).some(r => r.session === 'smm' && r.outcome === 'accepted'));
      await ui.fresh(h, b, 'video', 'Kasper Approval', { kasper: true, client: false });
      assert.deepEqual(b.records.filter(r => r.action === 'status' && r.outcome === 'accepted').map(r => [r.session, r.body.status]),
        [['admin', 'tweak'], ['editor', 'smm_approval'], ['smm', 'kasper_approval']], 'exact actors own the accepted native handoff sequence');
      step.observe({ normal_handoff: 'EDITOR_TO_SMM_TO_KASPER', second_context_persistence: true, media_fix_quality: 'NOT_EVALUATED' });
    });
  });
  add('controls', 'video', 'In Progress', false, async (h, b, step) => {
    const s = await production(h, b), p = s.page;
    await step('status-due-assignee', async () => {
      let start = b.records.length;
      await p.locator('[data-prod-prop="status"]').click();
      await p.locator('[data-prod-pick]').filter({ hasText: 'Tweak Needed' }).click();
      await ui.accepted(b, start, 'status');
      await ui.until(async () => (await p.locator('[data-prod-prop="status"]').innerText()).includes('Tweak Needed'), 'status displays saved result');
      start = b.records.length; await p.locator('[data-prod-prop="due"]').click();
      const day = p.locator('[data-prod-day]').first(); const due = await day.getAttribute('data-prod-day');
      await day.click(); await ui.accepted(b, start, 'due');
      assert.equal(b.native[0].due_date, due);
      const displayedDue = await p.locator('[data-prod-prop="due"]').innerText();
      assert(!displayedDue.includes('Add due date'), 'due date visibly saved');
      start = b.records.length; await p.locator('[data-prod-prop="assignee"]').click();
      await p.locator('[data-prod-pick]').filter({ hasText: 'Fixture alternate editor' }).click();
      await ui.accepted(b, start, 'assignee');
      await ui.until(async () => (await p.locator('[data-prod-prop="assignee"]').innerText()).includes('Fixture alternate editor'), 'assignee visibly saved');
      const fresh = await production(h, b);
      assert((await fresh.page.locator('[data-prod-prop="status"]').innerText()).includes('Tweak Needed'));
      assert.equal(await fresh.page.locator('[data-prod-prop="due"]').innerText(), displayedDue);
      assert((await fresh.page.locator('[data-prod-prop="assignee"]').innerText()).includes('Fixture alternate editor'));
      // Explicit transport assumption: an independently delivered server projection.
      // This does not certify the real gateway/mirror writes this card column.
      Object.assign(b.rows[0], { video_status: 'Tweaks Needed', status: 'Tweaks Needed', updated_at: b.stamp() });
      await ui.fresh(h, b, 'video', 'Tweaks Needed');
    });
    await step('role-and-anonymous-controls', async () => {
      const editor = await production(h, b, 'editor');
      assert.equal(await editor.page.locator('[data-prod-prop="assignee"]').getAttribute('aria-disabled'), 'true', 'creative cannot reassign');
      const c = await h.session(b, 'client'); await h.open(c); await c.page.locator('.cal-review-wrap').waitFor();
      assert.equal(await c.page.locator('[data-prod-prop]:visible,.cal-fld-substatus-trigger:visible,.cal-card-del:visible').count(), 0, 'anonymous client has no staff controls');
    });
  });
  add('stale-version', 'video', 'In Progress', false, async (h, b, step) => {
    const a = await production(h, b), stale = await production(h, b);
    await step('stale-status-rejected', async () => {
      let start = b.records.length;
      await a.page.locator('[data-prod-prop="status"]').click();
      await a.page.locator('[data-prod-pick]').filter({ hasText: 'Tweak Needed' }).click(); await ui.accepted(b, start, 'status');
      const saved = clone(b.native[0]); start = b.records.length;
      await stale.page.locator('[data-prod-prop="status"]').click();
      await stale.page.locator('[data-prod-pick]').filter({ hasText: 'For SMM Approval' }).click();
      await ui.until(() => b.records.slice(start).some(r => r.outcome === 'conflict'), 'stale CAS rejected');
      assert.deepEqual(b.native[0], saved, 'stale attempt must not overwrite');
      await ui.until(async () => /changed elsewhere/.test(await stale.page.locator('#prodToast.show').innerText()), 'conflict is visible');
      const f = await production(h, b); assert((await f.page.locator('[data-prod-prop="status"]').innerText()).includes('Tweak Needed'));
    });
  });
  add('comments', 'video', 'Client Approval', false, async (h, b, step) => {
    const s = await production(h, b), p = s.page; let root;
    const submit = async text => { const start = b.records.length; await p.locator('[data-prod-comment-input]').fill(text);
      await p.locator('.prod-composer-submit').click(); await ui.accepted(b, start, 'comment'); };
    await step('internal-root-and-projection', async () => {
      await submit('Fictional internal root'); root = b.comments[0].id;
      await p.locator(`[data-prod-comment-id="${root}"]`).filter({ hasText: 'Fictional internal root' }).waitFor();
      assert.equal(b.native[0].status, 'client_approval', 'plain note does not change status');
      const staff = await h.session(b); await h.open(staff); await ui.notes(staff.page);
      await staff.page.getByText('Fictional internal root', { exact: true }).waitFor();
      const client = await h.session(b, 'client'); await h.open(client); await ui.review(client.page, 'video');
      assert(!(await client.page.locator('body').innerText()).includes('Fictional internal root'), 'internal text excluded from client view');
      assert.equal(await p.locator('[data-prod-comment-form] button').filter({ hasText: 'Client-visible' }).count(), 0,
        'Calendar-linked Production composer does not offer unsupported client audience');
    });
    await step('reply-edit', async () => {
      await p.locator(`[data-prod-comment-id="${root}"]`).getByRole('button', { name: 'Reply', exact: true }).click();
      await submit('Fictional reply'); assert.equal(b.comments[1].parent_id, root); assert.equal(b.comments[1].audience, 'internal');
      await p.locator(`[data-prod-comment-id="${root}"]`).getByRole('button', { name: 'Edit', exact: true }).click();
      await submit('Fictional edited root'); assert.equal(b.comments.length, 2, 'edit does not append a second root');
      await p.locator(`[data-prod-comment-id="${root}"]`).filter({ hasText: 'Fictional edited root' }).waitFor();
    });
    await step('resolve-reopen-delete', async () => {
      for (const [label, predicate] of [['Resolve', c => !!c.resolved_at], ['Reopen', c => !c.resolved_at], ['Delete', c => !!c.deleted_at]]) {
        const start = b.records.length;
        await p.locator(`[data-prod-comment-id="${root}"]`).getByRole('button', { name: label, exact: true }).click();
        await ui.accepted(b, start, 'comment'); assert(predicate(b.comments.find(c => c.id === root)), `${label} persisted`);
      }
      await p.locator(`[data-prod-comment-id="${root}"]`).filter({ hasText: 'Comment deleted.' }).waitFor();
      const f = await production(h, b); await f.page.locator(`[data-prod-comment-id="${root}"]`).filter({ hasText: 'Comment deleted.' }).waitFor();
      assert.equal(b.native[0].status, 'client_approval', 'comment lifecycle does not change status');
    });
    await step('client-note-production-projection', async () => {
      const c = await h.session(b, 'client'); await h.open(c);
      const panel = await ui.review(c.page, 'video'), start = b.records.length;
      await panel.locator('.cal-review-textarea').fill('Fictional client plain note');
      await panel.locator('.cal-review-comment-btn').click(); await ui.accepted(b, start);
      const staff = await h.session(b); await h.open(staff); await ui.notes(staff.page);
      await staff.page.getByText('Fictional client plain note', { exact: true }).waitFor();
      step.observe({ client_note_calendar_visible: true,
        client_note_native_requests: b.records.slice(start).filter(r => r.session === 'client' && r.action === 'comment').length,
        projection_assumption: 'NO_IMPLICIT_SERVER_IMPORT', backend_projection: 'UNPROVEN' });
      const canonicalBefore = JSON.stringify(b.comments);
      b.source = h.source; b.feedbackReader = true; b.omitFeedback = true;
      const missing = await production(h, b);
      await missing.page.locator('[data-prod-feedback-state="incomplete"]').waitFor();
      assert.equal(await missing.page.locator('.prod-comment').filter({ hasText: 'Fictional client plain note' }).count(), 0,
        'negative control: missing feedback still fails note visibility');
      b.omitFeedback = false;
      const mirror = await production(h, b);
      const sourceNote = mirror.page.locator('.prod-feedback-source .prod-comment').filter({ hasText: 'Fictional client plain note' });
      await sourceNote.waitFor();
      await mirror.page.getByText('From the original card', { exact: true }).waitFor();
      assert.match(await sourceNote.textContent(), /Read-only here; manage on the original Calendar card/);
      assert.equal(await sourceNote.getByRole('button').count(), 0, 'source note has no canonical write actions');
      assert.equal(JSON.stringify(b.comments), canonicalBefore, 'reader imports no canonical comments');
      assert(b.records.some(r => r.feedback_reader?.status === 200 && r.feedback_reader.reads.includes('calendar_posts')));
      step.observe({ projection_assumption: 'NO_IMPLICIT_SERVER_IMPORT', backend_projection: 'ACTUAL_HANDLER_SYNTHETIC_TRANSPORT',
        missing_feedback_negative: 'PASS', source_note_read_only: true, canonical_imports: 0 });
    });
  });
  for (const [id, fault] of [['rejected-save', 'reject'], ['lost-response', 'lost'], ['duplicate-click', 'hold']]) {
    add(id, 'video', 'Kasper Approval', false, async (h, b, step) => {
      const s = await ui.reviewer(h, b, 'video'); const p = s.page;
      await step(id, async () => {
        const panel = await ui.review(p, 'video', true), start = b.records.length;
        b.arm(fault);
        if (id === 'duplicate-click') {
          await panel.locator('.cal-review-approve-btn').dblclick();
          await ui.until(() => b.holds.length === 1, 'approval transport is held'); b.release();
        } else await panel.locator('.cal-review-approve-btn').click();
        if (fault === 'reject') {
          await ui.until(() => b.records.slice(start).some(r => r.outcome === 'rejected'), 'rejection reached the document');
          await p.locator('.cal-review-panel-err').first().waitFor();
          assert.equal(b.records.slice(start).filter(r => r.outcome === 'accepted').length, 0);
          await ui.queue(p, 'kasper', true);
          await ui.fresh(h, b, 'video', 'Kasper Approval', { kasper: true, client: false });
        } else {
          await ui.accepted(b, start); await ui.queue(p, 'kasper', false);
          assert.equal(b.records.slice(start).filter(r => r.action === 'status' && r.outcome === 'accepted').length, 1,
            'one accepted approval effect');
          if (fault === 'lost') assert(b.records.slice(start).some(r => r.outcome === 'replayed'), 'response loss retried the same receipt');
          await ui.fresh(h, b, 'video', 'Client Approval', { kasper: false, client: true });
        }
      });
    });
  }
  add('undo-reopen', 'video', 'Kasper Approval', false, async (h, b, step) => {
    const s = await ui.reviewer(h, b, 'video'), p = s.page;
    await step('kasper-undo', async () => {
      const panel = await ui.review(p, 'video', true); let start = b.records.length;
      await panel.locator('.cal-review-approve-btn').click(); await ui.accepted(b, start); await ui.queue(p, 'kasper', false);
      start = b.records.length; await p.getByRole('button', { name: 'Undo', exact: true }).click();
      await ui.accepted(b, start); await ui.queue(p, 'kasper', true);
      assert(!b.rows[0].kasper_approved_at, 'undo removes approval stamp');
      await ui.fresh(h, b, 'video', 'Kasper Approval', { kasper: true, client: false });
    });
    await step('request-resolve-reopen', async () => {
      const panel = await ui.review(p, 'video', true); let start = b.records.length;
      await panel.locator('.cal-review-textarea').fill('Fictional reopen adjustment');
      await panel.locator('.cal-review-tweak-btn').click(); await ui.accepted(b, start);
      const staff = await h.session(b); const sp = await h.open(staff);
      start = b.records.length; await ui.resolve(sp); await ui.accepted(b, start);
      await ui.notes(sp);
      await sp.locator('#calCommentsOverlay .cal-comments-hist').click();
      const reopen = sp.getByRole('button', { name: 'Reopen', exact: true }).last();
      await reopen.locator('xpath=ancestor::*[@data-cm-row]').hover(); start = b.records.length;
      await reopen.click(); await ui.accepted(b, start);
      assert(JSON.parse(b.rows[0].video_tweaks).some(c => c.is_tweak && !c.done), 'reopened request persists');
      step.observe({ reopened_request_persisted: true, status_after_reopen: b.rows[0].video_status,
        status_expectation: 'Tweaks Needed', contract_status: 'BEHAVIOR_QUESTION' });
      await ui.closeNotes(sp); await ui.pill(sp, 'video', 'Tweaks Needed');
      await ui.fresh(h, b, 'video', 'Tweaks Needed', { kasper: true });
    });
  });
  add('cache', 'video', 'Kasper Approval', false, async (h, b, step) => {
    const retained = await ui.reviewer(h, b, 'video'); await ui.queue(retained.page, 'kasper', true);
    await step('retained-and-cold-kasper', async () => {
      // Cold context goes DIRECTLY to the saved review URL. No roster priming.
      // A fictional roster addition must not be hidden by a hardcoded name seed.
      const fresh = await h.session(b, 'admin'); await h.open(fresh, 'kasper');
      await fresh.page.locator('#kasperReviewBody').waitFor();
      await retained.page.reload();
      await ui.until(() => b.records.filter(r => r.action === 'read:calendar_posts').length >= 3, 'all contexts read fixture rows');
      await Promise.all([retained.page, fresh.page].map(p => p.waitForFunction(() => !_kasperState.loading)));
      const retainedCount = await retained.page.locator(`.kcard[data-kasper-pid="${ui.ID}"]`).count();
      const freshCount = await fresh.page.locator(`.kcard[data-kasper-pid="${ui.ID}"]`).count();
      step.observe({ retained_queue_count: retainedCount, fresh_queue_count: freshCount, expected_queue_count: 1 });
      assert.equal(retainedCount, 1, 'retained-cache reload keeps eligible card');
      assert.equal(freshCount, 1, 'fresh-context Kasper entry shows eligible card');
    });
  });
  add('delayed-refresh', 'video', 'For SMM Approval', false, async (h, b, step) => {
    const s = await h.session(b), p = await h.open(s); await ui.card(p).waitFor();
    await step('late-read-after-approval', async () => {
      // Hold the snapshot returned to the app's real subscription callback.
      b.arm('hold', 'read:calendar_posts');
      await p.evaluate(() => window.__lifecycleDeliverEvent({ table: 'calendar_posts', eventType: 'UPDATE', new: { id: 'fixture-card-alpha' } }));
      await ui.until(() => b.holds.length === 1, 'real subscription schedules a held read', 15000);
      const panel = await ui.review(p, 'video'); const start = b.records.length;
      await panel.locator('.cal-review-approve-main').click(); await ui.accepted(b, start);
      await ui.queue(p, 'smm', false); b.release();
      await p.waitForTimeout(800); await ui.sheet(p); await ui.pill(p, 'video', 'Kasper Approval');
      await ui.fresh(h, b, 'video', 'Kasper Approval', { kasper: true });
    });
  });
  for (const id of ['switch-client', 'navigate-saving']) add(id, 'video', 'For SMM Approval', false, async (h, b, step) => {
    const s = await h.session(b), p = await h.open(s);
    await step(id, async () => {
      const panel = await ui.review(p, 'video'), start = b.records.length;
      b.arm('hold'); await panel.locator('.cal-review-approve-main').click();
      await ui.until(() => b.holds.length === 1, 'save held');
      if (id === 'switch-client') {
        await p.locator('.cal-tab-add').click();
        await p.locator('#calClientSearchInput').fill(CLIENTS[1].display_name);
        await p.getByText(CLIENTS[1].display_name, { exact: true }).last().click();
        await ui.until(() => p.url().includes(CLIENTS[1].slug), 'other client selected');
      } else await p.locator('#navProd').click();
      b.release(); await ui.accepted(b, start);
      assert(!b.records.some(r => r.outcome === 'wrong-client'), 'no wrong-client write');
      assert(b.records.slice(start).filter(r => r.action === 'calendar-upsert').every(r => r.body.client === CLIENTS[0].slug), 'source-client pinned on wire');
      if (id === 'switch-client') assert.equal(await ui.card(p).count(), 0, 'late save cannot repaint the wrong client');
      await ui.fresh(h, b, 'video', 'Kasper Approval', { kasper: true });
    });
  });
  add('archive-race', 'video', 'Kasper Approval', false, async (h, b, step) => {
    const k = await ui.reviewer(h, b, 'video'), staff = await h.session(b), sp = await h.open(staff);
    await step('archive-during-approval', async () => {
      const panel = await ui.review(k.page, 'video', true), start = b.records.length;
      b.arm('hold'); await panel.locator('.cal-review-approve-btn').click();
      await ui.until(() => b.holds.length === 1, 'approval held before acceptance');
      await ui.card(sp).hover(); await ui.card(sp).locator('.cal-card-del').click();
      await sp.locator('#confirmOverlay.active').waitFor(); await sp.locator('#confirmYes').click();
      await ui.accepted(b, start); b.release();
      await ui.until(() => b.records.slice(start).some(r => r.outcome === 'conflict'), 'archive fence rejects late approval');
      assert.equal(b.rows[0].status, 'Archived', 'archive remains authoritative in fixture');
      await ui.card(sp).waitFor({ state: 'detached' });
      await k.page.locator('.cal-review-panel-err').first().waitFor();
      const f = await h.session(b); await h.open(f); await f.page.locator('#calStrip').waitFor();
      assert.equal(await ui.card(f.page).count(), 0, 'fresh page cannot resurrect archived card');
    });
  });
  for (const id of ['touch', 'keyboard']) add(id, 'video', 'Client Approval', false, async (h, b, step) => {
    const s = await h.session(b, 'client', { mobile: id === 'touch' }), p = await h.open(s);
    await step(id, async () => {
      const c = p.locator('.cal-review-card'), start = b.records.length;
      await c.waitFor();
      if (id === 'touch') {
        await c.locator('.kcard-expand-btn').tap();
        await c.locator('.cal-review-approve-btn').tap();
      } else {
        await ui.tabTo(p, '.cal-review-card .kcard-expand-btn'); await p.keyboard.press('Enter');
        await ui.tabTo(p, '.cal-review-textarea'); await p.keyboard.type('Fictional keyboard note');
        await ui.tabTo(p, '.cal-review-comment-btn'); await p.keyboard.press('Enter');
      }
      await ui.accepted(b, start);
      await ui.fresh(h, b, 'video', id === 'touch' ? 'Approved' : 'Client Approval', { client: id !== 'touch' });
    });
  });
  add('network-guard', 'video', 'Client Approval', false, async (h, b, step) => {
    const s = await h.session(b, 'client'), p = await h.open(s);
    await p.locator('.cal-review-wrap').waitFor();
    await step('negative-controls', async () => {
      assert.equal(b.blocked.length, 0, 'normal boot needs no unexpected request');
      const rejected = await p.evaluate(async () => {
        let http = false, worker = false, shared = false, service = false;
        try { await fetch('https://unexpected.invalid/probe'); } catch { http = true; }
        try { new Worker('https://unexpected.invalid/worker.js'); } catch { worker = true; }
        try { new SharedWorker('https://unexpected.invalid/shared.js'); } catch { shared = true; }
        try { await navigator.serviceWorker.register('/unexpected-worker.js'); } catch { service = true; }
        const socket = await new Promise(resolve => { const ws = new WebSocket('wss://unexpected.invalid/probe'); ws.onclose = () => resolve(true); ws.onerror = () => resolve(true); setTimeout(() => resolve(false), 2000); });
        return { http, worker, shared, service, socket, workers: window.__lifecycleWorkerBlocks };
      });
      assert.deepEqual(rejected, { http: true, worker: true, shared: true, service: true, socket: true, workers: 3 });
      assert.equal(b.blocked.length, 1); assert.equal(s.sockets.length, 1);
      step.observe({ negative_http: 1, negative_websocket: 1, negative_workers: 3 });
      s.sockets.splice(0);
      // Remove only the exact proven negative-control rejection from fatal tally.
      b.expectedBlocked = b.blocked.splice(0);
    });
  });
};
