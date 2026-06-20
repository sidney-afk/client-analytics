// p16 — §6/§9 concurrency: a card is ARCHIVED on SMM while KASPER ACTS on it (approves).
// _kasperPersistPost writes the whole row (status recomputed from components), so if it lands
// AFTER the archive's partial {status:'Archived'} write, it could clobber the archive
// (resurrect the card). Observes the race outcome + asserts no corruption / no JS errors /
// queue consistency. Tries both orderings.
const Q = require('./lib.js');

async function runOnce(label, S, browser, kas, archiveFirst) {
  const pid = 'p_avk_' + (archiveFirst ? 'af_' : 'ka_') + Math.floor(Date.now() / 1000);
  await Q.seedCaptionCard(pid, 'Kasper Approval');
  await Q.pollRow(pid, x => x.caption_status === 'Kasper Approval');
  await Q.kasperLoadHas(kas, pid);
  // Fire archive + Kasper approve as concurrently as possible.
  if (archiveFirst) {
    const p1 = Q.archive(pid);
    const p2 = Q.kasperApprove(kas, pid, 'caption');
    await Promise.all([p1, Promise.resolve(p2)]);
  } else {
    const p2 = Q.kasperApprove(kas, pid, 'caption');
    const p1 = Q.archive(pid);
    await Promise.all([Promise.resolve(p2), p1]);
  }
  // Let both writes settle (n8n mirror lag), then read final state.
  await new Promise(x => setTimeout(x, 8000));
  const row = await Q.rawRow(pid, 'status,caption_status');
  // queue membership on reload must MATCH the backend (archived ⇒ gone)
  const gone = await Q.kasperGoneFromQueue(kas, pid);
  const isArchived = String(row.status).toLowerCase() === 'archived';
  console.log(`  [${label}] final status=${row.status} caption=${row.caption_status} | goneFromQueue=${gone}`);
  // Consistency: if backend says Archived, the card must be gone from the queue (no phantom).
  // If NOT archived (approve won the race), that is an ARCHIVE-LOST outcome — flag it.
  S.ok(!isArchived || gone, `[${label}] no phantom: archived ⇒ gone from queue`);
  S.ok(isArchived, `[${label}] archive SURVIVES the racing Kasper write (status=${row.status}; non-archived = archive lost)`);
  await Q.archive(pid); // ensure cleanup regardless of outcome
  return { status: row.status, caption: row.caption_status, gone };
}

(async () => {
  const S = Q.makeOk('P16 archive-vs-kasper');
  const browser = await Q.launch();
  const kas = await Q.kasperPage(browser);
  try {
    await runOnce('archive-then-approve', S, browser, kas, true);
    await runOnce('approve-then-archive', S, browser, kas, false);
    S.ok(kas._errs.length === 0, 'no JS errors on Kasper through the races (' + JSON.stringify(kas._errs.slice(0,4)) + ')');
  } finally { await browser.close(); }
  process.exit(S.done());
})();
