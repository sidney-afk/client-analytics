// p11 — §8 concurrency: two surfaces add a comment to the SAME card/component at the same
// time. Both must survive (atomic server-side merge), with no lost message and no tombstone
// resurrection. Drives two concurrent upserts each appending a distinct comment to a shared base.
const Q = require('./lib.js');
const TS = Math.floor(Date.now() / 1000);
const PID = 'p_merge_' + TS;
const now = () => new Date().toISOString();
const mk = (id, body) => ({ id, parent_id: null, author: 'Synchro Social', role: 'smm', is_tweak: false,
  audience: 'internal', body, created_at: now(), updated_at: now(), done: false, done_at: '', done_by: '' });

const C0 = mk('c0_' + TS, 'BASE-' + TS);
const CA = mk('ca_' + TS, 'FROM-A-' + TS);
const CB = mk('cb_' + TS, 'FROM-B-' + TS);

(async () => {
  const S = Q.makeOk('P11 comment-merge');
  const browser = await Q.launch();
  try {
    // base card with one existing comment
    await Q.up({ id: PID, name: 'MERGE ' + TS, platforms: 'youtube', scheduled_date: '2026-06-29',
      caption_status: 'Kasper Approval', video_status: 'Approved', graphic_status: 'Approved', status: 'Kasper Approval',
      thumbnail_url: 'https://via.placeholder.com/320x180.png', asset_url: 'https://example.com/g.mp4',
      caption_tweaks: JSON.stringify([C0]) });
    await Q.pollRaw(PID, r => (r.caption_tweaks || '').includes('BASE-' + TS), 'caption_tweaks');

    // CONCURRENT: surface A appends CA, surface B appends CB — both off the same base [C0].
    await Promise.all([
      Q.up({ id: PID, caption_tweaks: JSON.stringify([C0, CA]) }),
      Q.up({ id: PID, caption_tweaks: JSON.stringify([C0, CB]) }),
    ]);

    // poll until both appear (server merge may take a beat)
    const merged = await Q.pollRaw(PID, r => {
      const t = r.caption_tweaks || '';
      return t.includes('FROM-A-' + TS) && t.includes('FROM-B-' + TS);
    }, 'caption_tweaks', 20000);
    let arr = []; try { arr = JSON.parse(merged.caption_tweaks || '[]'); } catch (e) {}
    const bodies = arr.filter(c => c && !c.deleted).map(c => c.body);
    console.log('merged bodies:', JSON.stringify(bodies));
    S.ok(bodies.includes('BASE-' + TS), 'base comment survives');
    S.ok(bodies.includes('FROM-A-' + TS), 'concurrent comment A survives (no lost message)');
    S.ok(bodies.includes('FROM-B-' + TS), 'concurrent comment B survives (no lost message)');

    // Tombstone CA, then a concurrent write that still carries the old (non-deleted) CA must
    // NOT resurrect it (delete wins by newer updated_at).
    const CAdel = Object.assign({}, CA, { deleted: true, updated_at: now() });
    await new Promise(x => setTimeout(x, 1200));
    await Promise.all([
      Q.up({ id: PID, caption_tweaks: JSON.stringify([C0, CAdel, CB]) }),
      Q.up({ id: PID, caption_tweaks: JSON.stringify([C0, CA, CB]) }),   // stale: CA not deleted
    ]);
    const after = await Q.pollRaw(PID, r => {
      let a = []; try { a = JSON.parse(r.caption_tweaks || '[]'); } catch (e) {}
      const ca = a.find(c => c && c.id === CA.id);
      return ca && ca.deleted;   // wait until the delete wins
    }, 'caption_tweaks', 20000);
    let arr2 = []; try { arr2 = JSON.parse(after.caption_tweaks || '[]'); } catch (e) {}
    const ca = arr2.find(c => c && c.id === CA.id);
    console.log('CA after tombstone race:', JSON.stringify(ca));
    S.ok(ca && ca.deleted === true, 'tombstone wins the race — deleted comment NOT resurrected by a stale write');

    S.ok(true, '(no JS-error surface — pure backend merge probe)');
  } finally {
    await Q.up({ id: PID, status: 'Archived' });
    await browser.close();
  }
  process.exit(S.done());
})();
