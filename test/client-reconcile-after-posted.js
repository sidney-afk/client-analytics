'use strict';
/* Reproduces the 2026-09-23 refusal loop: a client's approve committed, the
   card later moved to Posted, and the browser's repair journal kept asking
   production-write (reconcile_only) whether that approve landed. The gateway
   judged the question against the card's CURRENT status (posted -> approved)
   and answered 403 operation_forbidden on every calendar refresh, so the
   journal row could never clear. A reconcile writes nothing; only a real
   write should face the transition gate. */
const fs = require('fs');
const path = require('path');

let failures = 0;
const ok = (cond, msg) => { if (cond) console.log('ok - ' + msg); else { failures++; console.error('not ok - ' + msg); } };

(async () => {
  const policy = await import(path.join(__dirname, '..', 'supabase/functions/production-write/policy.mjs'));
  const edge = fs.readFileSync(path.join(__dirname, '..', 'supabase/functions/production-write/index.ts'), 'utf8');

  // The refusal itself: the transition gate refuses approved on a posted card.
  ok(!policy.clientOperationAllowed('status', 'posted', 'approved'),
    'a client still cannot move a posted card to approved');

  const start = edge.indexOf('async function handleEntityOperation(');
  const end = edge.indexOf('\nasync function ensureBatch(', start);
  const handler = edge.slice(start, end);
  const gate = handler.match(/if \(operation === "status"\s*&& principal\.kind === "client"[\s\S]*?clientOperationAllowed\(operation, existing\.status, nextStatus\)\) \{/);
  ok(!!gate, 'handleEntityOperation keeps the client transition gate');
  ok(!!gate && /body\.reconcile_only !== true/.test(gate[0]),
    'a reconcile-only receipt read is not judged against the current status');
  ok(!!gate && handler.indexOf(gate[0]) < handler.indexOf('body.reconcile_only === true'),
    'the gate still runs before the reconcile branch for real writes');

  // Reconcile still bounds what a client may ask about.
  const rStart = edge.indexOf('async function reconcileEntityOperation(');
  const rEnd = edge.indexOf('\nfunction configuredTestProjectIds(', rStart);
  const reconcile = edge.slice(rStart, rEnd);
  ok(/principal\.kind === "client"[\s\S]{0,120}clientOperationAllowed\("status", "client_approval", nextStatus\)[\s\S]{0,60}operation_forbidden/.test(reconcile),
    'reconcile refuses a client status outside approved/tweak');
  ok(!policy.clientOperationAllowed('status', 'client_approval', 'posted')
    && !policy.clientOperationAllowed('status', 'client_approval', 'smm_approval'),
    'a client can never reconcile toward a staff-only status');

  if (failures) { console.error(`\n${failures} check(s) failed`); process.exit(1); }
  console.log('\nclient reconcile-after-posted checks passed');
})().catch(e => { console.error(e); process.exit(1); });
