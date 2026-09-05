'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Store, open, snap, panel, SOURCE, OUT, ID, body, newer, Harness, ui } = require('./run');
const { CLIENTS, MEMBERS, clone } = require('./mock-backend');
const report = { status: 'INCOMPLETE', groups: [], source: SOURCE };
function pass(name) { report.groups.push(name); console.log('PASS ' + name); }
async function owned(s) { return s.page.evaluate(() => Object.fromEntries(Object.keys(localStorage).filter(k => k.startsWith('syncview_review_draft_v1:')).map(k => [k,localStorage.getItem(k)]))); }
function commentIds(writes) {
  const result = [];
  for (const write of writes) {
    const wire = write.body.post || write.body.sample;
    if (wire) for (const comp of ['video','graphic','caption','title']) {
      let rows; try { rows = JSON.parse(wire[comp + '_tweaks'] || 'null'); } catch { continue; }
      if (Array.isArray(rows)) result.push(...rows.filter(r => r.body === body).map(r => r.id));
    }
  }
  return [...new Set(result)];
}
async function main() {
  const h = await new Harness(SOURCE,OUT).start(); report.browser = h.browser.version();
  try {
    for (const surface of ['calendar','samples','kasper']) {
      const b = new Store(surface,'note','accepted-timeout');
      const s = await open(h,b,surface), p = await panel(s,surface);
      await p.locator('.cal-review-textarea').fill(body); await p.locator('.cal-review-comment-btn').click();
      await ui.until(async () => !(await snap(s,surface)).saving && b.feedbackWrites.length > 0, 'ambiguous note settles');
      const firstIds = commentIds(b.feedbackWrites); assert.equal(firstIds.length,1);
      const storageState = await s.context.storageState(); await s.context.close();
      b.feedbackFault = null;
      const fresh = await open(h,b,surface,storageState); const before = b.feedbackWrites.length;
      assert.equal((await snap(fresh,surface)).originalVisible,true);
      await fresh.page.getByRole('button',{name:surface==='samples'?'Retry note save':'Retry earlier feedback',exact:true}).click();
      await ui.until(async()=>b.feedbackWrites.length>before && !(await snap(fresh,surface)).saving,'explicit existing-writer retry settles');
      assert.deepEqual(commentIds(b.feedbackWrites),firstIds,'ambiguous retry keeps exactly the original comment identity');
      const rows = JSON.parse(b.rows[0].video_tweaks);
      assert.equal(rows.filter(r=>r.body===body).length,1,'synthetic source receiver has one logical note');
      assert.equal(b.blocked.length,0); assert.deepEqual(h.sessions.flatMap(s=>s.errors),[]);
      pass(surface + ': visible ambiguous-note recovery and explicit stable-ID retry through existing writer');
      await h.closeSessions();
    }
    for (const surface of ['calendar','samples','kasper']) {
      const b = new Store(surface,'note','reject'), s=await open(h,b,surface), p=await panel(s,surface);
      await s.page.evaluate(()=>{
        window.__draftStorageSet=Storage.prototype.setItem;
        Storage.prototype.setItem=function(k,v){ if(String(k).startsWith('syncview_review_draft_v1:')) throw new DOMException('Synthetic quota','QuotaExceededError'); return window.__draftStorageSet.call(this,k,v); };
      });
      await p.locator('.cal-review-textarea').fill(body);
      assert.equal(await p.locator('.cal-review-textarea').inputValue(),body);
      assert.ok((await p.innerText()).includes('Keep this tab open'));
      await p.locator('.cal-review-comment-btn').click();
      assert.equal(b.feedbackWrites.length,0,'storage-denied capture does not clear or dispatch');
      assert.equal(await p.locator('.cal-review-textarea').inputValue(),body);
      for (const width of [360,768,1440]) for(const theme of ['light','dark']) {
        await s.page.setViewportSize({width,height:900});
        await s.page.evaluate(t=>document.documentElement.dataset.theme=t,theme);
        const warning=p.locator('[data-review-draft-key]'); const box=await warning.boundingBox();
        assert.ok(box && box.width>0 && box.x>=-1 && box.x+box.width<=width+1,'storage warning stays in viewport');
      }
      await s.page.evaluate(()=>{Storage.prototype.setItem=window.__draftStorageSet;});
      await p.locator('.cal-review-textarea').fill(newer);
      const snapshot=await s.context.storageState(); await s.context.close();
      const fresh=await open(h,b,surface,snapshot);
      assert.equal(await (await panel(fresh,surface)).locator('.cal-review-textarea').inputValue(),newer);
      assert.equal(b.feedbackWrites.length,0); assert.equal(b.blocked.length,0); assert.deepEqual(h.sessions.flatMap(s=>s.errors),[]);
      pass(surface+': storage denial preserves visible text/error; restored storage and fresh context recover newer unsent draft');
      await h.closeSessions();
    }
    // Same card ID in another client makes accidental unscoped bindings visible.
    for(const surface of ['calendar','samples']) {
      const b=new Store(surface,'note','reject'); const beta=clone(b.rows[0]); beta.client=CLIENTS[1].slug; b.rows.push(beta);
      const s=await open(h,b,surface); await (await panel(s,surface)).locator('.cal-review-textarea').fill(body);
      const before=await owned(s);
      const url=h.url('client','calendar',CLIENTS[1]);
      await s.page.goto(surface==='samples'?url.replace('v=calendar','v=sample-reviews&sxr=1'):url,{waitUntil:'domcontentloaded'});
      assert.equal(await (await panel(s,surface)).locator('.cal-review-textarea').inputValue(),'');
      assert.deepEqual(await owned(s),before); assert.equal(b.feedbackWrites.length,0);
      const original=h.url('client'); await s.page.goto(surface==='samples'?original.replace('v=calendar','v=sample-reviews&sxr=1'):original,{waitUntil:'domcontentloaded'});
      assert.equal(await (await panel(s,surface)).locator('.cal-review-textarea').inputValue(),body);
      assert.equal(b.blocked.length,0); assert.deepEqual(h.sessions.flatMap(s=>s.errors),[]);
      pass(surface+': same-ID client replacement cannot restore or replay another client draft'); await h.closeSessions();
    }
    const b=new Store('kasper','note','reject'), s=await open(h,b,'kasper');
    await (await panel(s,'kasper')).locator('.cal-review-textarea').fill(body);
    const before=await owned(s), initial=MEMBERS.find(m=>m.role==='admin');
    const change=async member=>s.page.evaluate(member=>{
      _syncviewStaffIdentitySave({key:'fictional-lifecycle-key',role:member.role,member});
      _syncviewStaffIdentityVerified=true; _kasperPaintReview();
    },member);
    await change({...initial,id:'00000000-0000-4000-8000-000000000199',name:'Fixture other admin'});
    assert.equal(await (await panel(s,'kasper')).locator('.cal-review-textarea').inputValue(),'');
    assert.deepEqual(await owned(s),before); assert.equal(b.feedbackWrites.length,0);
    await change(initial);
    assert.equal(await (await panel(s,'kasper')).locator('.cal-review-textarea').inputValue(),body);
    assert.deepEqual(await owned(s),before); assert.equal(b.feedbackWrites.length,0);
    assert.equal(b.blocked.length,0); assert.deepEqual(h.sessions.flatMap(s=>s.errors),[]);
    pass('Kasper: same-client same-role actor replacement preserves exact private draft without claim or replay');
    await h.closeSessions();
    for (const fault of ['held-reject','held-success']) for (const identityPath of ['setter','storage-event']) {
      const backend=new Store('kasper','note',fault), session=await open(h,backend,'kasper');
      const input=(await panel(session,'kasper')).locator('.cal-review-textarea');
      await input.fill(body); await (await panel(session,'kasper')).locator('.cal-review-comment-btn').click();
      await ui.until(()=>backend.pending.length===1,'original actor source request held');
      const switchActor=async member=>{
        if(identityPath==='setter') return session.page.evaluate(member=>{
          _syncviewStaffIdentitySave({key:'fictional-lifecycle-key',role:member.role,member});
          _syncviewStaffIdentityVerified=true; _kasperPaintReview();
        },member);
        await session.page.evaluate(member=>{
          const newValue=JSON.stringify({key:'fictional-lifecycle-key',role:member.role,member});
          localStorage.setItem(SYNCVIEW_STAFF_IDENTITY_KEY,newValue);
          _syncviewStaffIdentityStorageChanged({key:SYNCVIEW_STAFF_IDENTITY_KEY,newValue,storageArea:localStorage});
        },member);
        await ui.until(()=>session.page.evaluate(id=>_syncviewStaffIdentityValid() && _syncviewStaffIdentityLoad().member.id===id,member.id),'actual replacement identity verification');
        await session.page.evaluate(()=>_kasperPaintReview());
      };
      const replacement={...initial,id:'00000000-0000-4000-8000-000000000199',name:'Fixture other admin'};
      MEMBERS.push(replacement);
      await switchActor(replacement);
      assert.equal((await snap(session,'kasper')).originalVisible,false,'unconfirmed private feedback is not another actor discussion');
      await (await panel(session,'kasper')).locator('.cal-review-textarea').fill(newer);
      backend.release();
      await ui.until(()=>backend.feedbackWrites[0].outcome!=='held','original writer receipt settles');
      await session.page.waitForTimeout(100);
      assert.equal(await (await panel(session,'kasper')).locator('.cal-review-textarea').inputValue(),newer,'late original receipt cannot clear or restore over new actor text');
      await switchActor(initial);
      assert.equal((await snap(session,'kasper')).newerVisible,false);
      assert.equal((await snap(session,'kasper')).originalVisible,fault==='held-reject');
      assert.equal(backend.feedbackWrites.length,1,'actor replacement does not replay feedback');
      assert.equal(backend.blocked.length,0); assert.deepEqual(h.sessions.flatMap(s=>s.errors),[]);
      pass('Kasper: '+fault+' after '+identityPath+' same-client actor replacement settles only its captured owner');
      await h.closeSessions();
    }
    for (const surface of ['calendar','kasper']) {
      const backend=new Store(surface,'note','accepted-timeout'), session=await open(h,backend,surface);
      await (await panel(session,surface)).locator('.cal-review-textarea').fill(body);
      await (await panel(session,surface)).locator('.cal-review-comment-btn').click();
      await ui.until(async()=>backend.feedbackWrites.length>0 && !(await snap(session,surface)).saving,'ambiguous initial note');
      const originalIds=commentIds(backend.feedbackWrites), snapshot=await session.context.storageState();
      assert.equal(originalIds.length,1); await session.context.close();
      const edited=JSON.parse(backend.rows[0].video_tweaks);
      edited.find(row=>row.id===originalIds[0]).body='Fictional later edit under original ID';
      backend.rows[0].video_tweaks=JSON.stringify(edited); backend.feedbackFault=null;
      const fresh=await open(h,backend,surface,snapshot), before=backend.feedbackWrites.length;
      await fresh.page.getByRole('button',{name:'Retry earlier feedback',exact:true}).click();
      await ui.until(async()=>backend.feedbackWrites.length>before && !(await snap(fresh,surface)).saving,'changed-body retry settles');
      assert.equal(JSON.stringify(backend.rows).includes(body),false,'source has only the later edit');
      assert.equal((await snap(fresh,surface)).originalVisible,true,'generic card success cannot retire a missing original body');
      const drafts=Object.values(await owned(fresh)).map(JSON.parse);
      assert.ok(drafts.some(draft=>draft.attempt?.id===originalIds[0] && draft.attempt.text===body));
      assert.equal(backend.blocked.length,0); assert.deepEqual(h.sessions.flatMap(s=>s.errors),[]);
      pass(surface+': same-ID changed-body retry retains original captured feedback until exact acknowledgment');
      await h.closeSessions();
    }
    report.status='PASS';
  } finally { await h.close(); fs.writeFileSync(path.join(OUT,'behavior-private.json'),JSON.stringify(report,null,2)+'\n'); }
}
main().catch(error=>{console.error(error.stack);process.exitCode=1;});
