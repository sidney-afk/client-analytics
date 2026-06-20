// p14 — §10.3 EXHAUSTIVE transition-pair coverage. Walks each of the 33 actor hand-off
// adjacencies through the REAL handlers (Kasper handlers, client review handlers, SMM
// upsert/resolve = the status control's write) on the caption component (video/graphic pinned
// Approved so overall tracks caption). After every step: poll the backend caption_status and,
// where relevant, assert Kasper-queue membership. Continue-on-error; per-pair + summary report.
const G = require('../golden_lib.js');
const Q = require('./lib.js');

const okc = (s) => s; // alias
let totalPass = 0, totalFail = 0;
const results = [];

// --- action dispatch: returns after firing; caller polls for expected status ---
async function fire(kas, cli, pid, act) {
  switch (act) {
    case 'submit_smm':      return G.up({ id: pid, caption_status: 'For SMM Approval' });
    case 'send_kasper':     return G.up({ id: pid, caption_status: 'Kasper Approval' });
    case 'kasper_approve':  await ensureKasper(kas, pid); return G.kasperApprove(kas, pid, 'caption');
    case 'kasper_request':  await ensureKasper(kas, pid); return G.kasperRequest(kas, pid, 'caption', 'Kasper: tweak caption');
    case 'kasper_aat':      await ensureKasper(kas, pid); return G.kasperApproveAfterTweaks(kas, pid, 'caption', 'Kasper: fix then ship');
    case 'kasper_undo':     await new Promise(x => setTimeout(x, 600)); return G.kasperUndoViaToast(kas);
    case 'smm_resolve_kasper': return G.smmResolveCaptionTweak(pid, 'Kasper Approval');
    case 'smm_resolve_client': return G.smmResolveCaptionTweak(pid, 'Client Approval');
    case 'client_approve':  await G.clientHasCaption(cli, pid, 'Client Approval'); return G.clientApproveCaption(cli, pid);
    case 'client_request':  await G.clientHasCaption(cli, pid, 'Client Approval'); return G.clientRequestCaption(cli, pid, 'Client: please change');
    case 'archive':         return G.archive(pid);
    case 'mark_posted':     return G.smmMarkPosted(pid);
    default: throw new Error('unknown act ' + act);
  }
}
async function ensureKasper(kas, pid) {
  // load the card into _kasperState so the real handler can resolve it
  const has = await G.kasperLoadHas(kas, pid);
  return has;
}

// --- the 33 pairs (P26 noted unreachable: undo only via toast right after a Kasper approve) ---
const PAIRS = [
  // SMM-origin
  { id: 'P32', seed: 'In Progress',     steps: [['submit_smm','For SMM Approval'],['archive','Archived']] },
  { id: 'P33', seed: 'In Progress',     steps: [['submit_smm','For SMM Approval'],['send_kasper','Kasper Approval','Q']] },
  { id: 'P28', seed: 'In Progress',     steps: [['send_kasper','Kasper Approval','Q'],['kasper_aat','Tweaks Needed']] },
  { id: 'P29', seed: 'In Progress',     steps: [['send_kasper','Kasper Approval','Q'],['kasper_approve','Client Approval']] },
  { id: 'P30', seed: 'In Progress',     steps: [['send_kasper','Kasper Approval','Q'],['kasper_request','Tweaks Needed']] },
  { id: 'P31', seed: 'In Progress',     steps: [['send_kasper','Kasper Approval','Q'],['archive','Archived','GONE']] },
  // Kasper-origin (seed at Kasper Approval)
  { id: 'P6',  seed: 'Kasper Approval', steps: [['kasper_aat','Tweaks Needed'],['archive','Archived']] },
  { id: 'P7',  seed: 'Kasper Approval', steps: [['kasper_aat','Tweaks Needed'],['smm_resolve_kasper','Kasper Approval','Q']] },
  { id: 'P8',  seed: 'Kasper Approval', steps: [['kasper_aat','Tweaks Needed'],['smm_resolve_client','Client Approval']] },
  { id: 'P9',  seed: 'Kasper Approval', steps: [['kasper_approve','Client Approval'],['client_approve','Approved']] },
  { id: 'P10', seed: 'Kasper Approval', steps: [['kasper_approve','Client Approval'],['client_request','Tweaks Needed']] },
  { id: 'P11', seed: 'Kasper Approval', steps: [['kasper_approve','Client Approval'],['kasper_undo','Kasper Approval','Q']] },
  { id: 'P12', seed: 'Kasper Approval', steps: [['kasper_approve','Client Approval'],['archive','Archived']] },
  { id: 'P13', seed: 'Kasper Approval', steps: [['kasper_request','Tweaks Needed'],['archive','Archived','GONE']] },
  { id: 'P14', seed: 'Kasper Approval', steps: [['kasper_request','Tweaks Needed'],['smm_resolve_kasper','Kasper Approval','Q']] },
  { id: 'P15', seed: 'Kasper Approval', steps: [['kasper_request','Tweaks Needed'],['smm_resolve_client','Client Approval']] },
  // undo branches (approve -> undo -> B)
  { id: 'P16', seed: 'Kasper Approval', steps: [['kasper_approve','Client Approval'],['kasper_undo','Kasper Approval','Q'],['kasper_aat','Tweaks Needed']] },
  { id: 'P17', seed: 'Kasper Approval', steps: [['kasper_approve','Client Approval'],['kasper_undo','Kasper Approval','Q'],['kasper_approve','Client Approval']] },
  { id: 'P18', seed: 'Kasper Approval', steps: [['kasper_approve','Client Approval'],['kasper_undo','Kasper Approval','Q'],['kasper_request','Tweaks Needed']] },
  { id: 'P19', seed: 'Kasper Approval', steps: [['kasper_approve','Client Approval'],['kasper_undo','Kasper Approval','Q'],['archive','Archived']] },
  // SMM-resolve branches (request -> resolve -> B)
  { id: 'P20', seed: 'Kasper Approval', steps: [['kasper_request','Tweaks Needed'],['smm_resolve_kasper','Kasper Approval','Q'],['kasper_aat','Tweaks Needed']] },
  { id: 'P21', seed: 'Kasper Approval', steps: [['kasper_request','Tweaks Needed'],['smm_resolve_kasper','Kasper Approval','Q'],['kasper_approve','Client Approval']] },
  { id: 'P22', seed: 'Kasper Approval', steps: [['kasper_request','Tweaks Needed'],['smm_resolve_kasper','Kasper Approval','Q'],['kasper_request','Tweaks Needed']] },
  { id: 'P23', seed: 'Kasper Approval', steps: [['kasper_request','Tweaks Needed'],['smm_resolve_kasper','Kasper Approval','Q'],['archive','Archived']] },
  { id: 'P24', seed: 'Kasper Approval', steps: [['kasper_request','Tweaks Needed'],['smm_resolve_client','Client Approval'],['client_approve','Approved']] },
  { id: 'P25', seed: 'Kasper Approval', steps: [['kasper_request','Tweaks Needed'],['smm_resolve_client','Client Approval'],['client_request','Tweaks Needed']] },
  { id: 'P27', seed: 'Kasper Approval', steps: [['kasper_request','Tweaks Needed'],['smm_resolve_client','Client Approval'],['archive','Archived']] },
  // client-origin (seed at Client Approval)
  { id: 'P1',  seed: 'Client Approval', steps: [['client_approve','Approved'],['archive','Archived']] },
  { id: 'P2',  seed: 'Client Approval', steps: [['client_approve','Approved'],['mark_posted','Posted']] },
  { id: 'P3',  seed: 'Client Approval', steps: [['client_request','Tweaks Needed'],['archive','Archived']] },
  { id: 'P4',  seed: 'Client Approval', steps: [['client_request','Tweaks Needed'],['smm_resolve_kasper','Kasper Approval','Q']] },
  { id: 'P5',  seed: 'Client Approval', steps: [['client_request','Tweaks Needed'],['smm_resolve_client','Client Approval']] },
];

(async () => {
  const browser = await Q.launch();
  const kas = await G.kasperPage(browser);
  const cli = await G.clientPage(browser);
  for (const pair of PAIRS) {
    const pid = 'p_pair_' + pair.id.toLowerCase() + '_' + Math.floor(Date.now() / 1000);
    let pass = 0, fail = 0; const log = [];
    try {
      await G.seedCaptionCard(pid, pair.seed);
      await G.pollRow(pid, x => x.caption_status === pair.seed, 12000);
      for (const [act, expect, queueFlag] of pair.steps) {
        const r = await fire(kas, cli, pid, act);
        const row = await G.pollRow(pid, x => (act === 'archive' ? true : x.caption_status === expect) , 16000);
        const got = (expect === 'Archived') ? (await Q.rawRow(pid, 'status')).status : row.caption_status;
        const good = (expect === 'Archived') ? (got === 'Archived') : (row.caption_status === expect);
        if (good) { pass++; } else { fail++; }
        log.push(`${good ? '✅' : '❌'} ${act} → ${expect} (got ${got}${typeof r === 'string' && r.startsWith('ERR') ? ' | ' + r : ''})`);
        if (queueFlag === 'Q') {
          const inQ = await G.kasperLoadHas(kas, pid);
          if (inQ) pass++; else fail++;
          log.push(`${inQ ? '✅' : '❌'} ${act}: card in Kasper queue`);
        } else if (queueFlag === 'GONE') {
          const gone = await G.kasperGoneFromQueue(kas, pid);
          if (gone) pass++; else fail++;
          log.push(`${gone ? '✅' : '❌'} ${act}: card gone from Kasper queue`);
        }
      }
    } catch (e) { fail++; log.push('❌ EXC ' + e.message); }
    finally { await G.archive(pid); }
    totalPass += pass; totalFail += fail;
    results.push({ id: pair.id, pass, fail });
    console.log(`\n[${pair.id}] seed=${pair.seed}  pass=${pass} fail=${fail}`);
    log.forEach(l => console.log('   ' + l));
  }
  // JS-error check on both pages
  const kErr = kas._errs.length, cErr = cli._errs.length;
  console.log('\n=== KASPER JS errors:', kErr, JSON.stringify(kas._errs.slice(0,4)));
  console.log('=== CLIENT JS errors:', cErr, JSON.stringify(cli._errs.slice(0,4)));
  if (kErr) totalFail++; if (cErr) totalFail++;
  console.log('\n=== PAIR SUMMARY ===');
  console.log(results.map(r => `${r.id}:${r.fail ? 'FAIL(' + r.fail + ')' : 'ok'}`).join('  '));
  console.log('NOTE: P26 (resolve→client ▶ undo) is unreachable by design — undo exists only via the toast right after a Kasper approve.');
  console.log(`\nP14 PAIRS TOTAL: pass=${totalPass} fail=${totalFail} ${totalFail ? '❌' : '✅'}`);
  await browser.close();
  process.exit(totalFail ? 1 : 0);
})();
