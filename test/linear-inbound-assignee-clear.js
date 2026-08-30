'use strict';
/*
 * OPEN_REPAIRS item 77 — linear-inbound could not see a CLEARED assignee.
 *
 * Linear's webhook carries the *Id SCALAR twin of every relation and omits the
 * relation OBJECT when it is null: a cleared assignee arrives as `assignee`
 * ABSENT with `assigneeId: null`. The apply block's assignee gate keyed on the
 * relation name alone, so it never fired for a clear -- 25 live unassignments
 * delivered on 2026-08-28, zero applied. The parent gate one block below has
 * always accepted both forms.
 *
 * This suite EXECUTES the shipped gate block, sliced out of the edge function
 * and de-typed (the slice carries only `as JsonMap` casts), against payload
 * shapes measured from 40 real captured webhooks. The updated_from half of the
 * fix (detect-only records must carry payload.updatedFrom, because a clear is
 * an absent key and the record is otherwise unable to say what changed) is
 * pinned at source level in the same run -- weaker than execution, and paired
 * here deliberately rather than left to a grep in someone's head.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const ROOT = path.resolve(__dirname, '..');
const source = fs.readFileSync(
  path.join(ROOT, 'supabase', 'functions', 'linear-inbound', 'index.ts'), 'utf8');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

/* ---- slice the gate block: from its `if (` through the balanced close ---- */
const gateMarker = 'if (has(issue, "assignee") || has(issue, "assigneeId")) {';
const gateStart = source.indexOf(gateMarker);
ok(gateStart >= 0, 'the two-key assignee gate exists in the shipped source');
let depth = 0, gateEnd = -1;
for (let i = source.indexOf('{', gateStart); i < source.length; i++) {
  const ch = source[i];
  if (ch === '{') depth++;
  else if (ch === '}' && --depth === 0) { gateEnd = i + 1; break; }
}
ok(gateEnd > gateStart, 'the gate block closes');
let block = source.slice(gateStart, gateEnd)
  .replace(/ as JsonMap/g, '');
ok(!/:\s*[A-Z][A-Za-z]*(\s*\|)?/.test(block.replace(/"[^"]*"/g, '')),
  'the de-typed slice carries no remaining type annotations (the wrap below would not parse them)');

const harness = new Function('deps', `
  const { has, clean, resolveAssignee, linearRawWithFlag, postAnomalyAlert,
          supabase, existing, payload, issue } = deps;
  const row = {};
  const eventPayload = {};
  let eventAction = 'noop';
  return (async () => {
    ${block}
    return { row, eventPayload, eventAction };
  })();
`);

const MEMBER = 'member-uuid-1';
function deps(issue) {
  const alerts = [];
  return {
    has: (obj, key) => Object.prototype.hasOwnProperty.call(obj || {}, key),
    clean: v => String(v == null ? '' : v).trim(),
    resolveAssignee: async (_supabase, assignee) => {
      if (!assignee) return { id: null };
      const id = String(assignee.id || '').trim();
      if (id === 'linear-user-known') return { id: MEMBER };
      return { id: null, unknown: { linear_user_id: id } };
    },
    linearRawWithFlag: () => ({ flagged: true }),
    postAnomalyAlert: async (kind) => { alerts.push(kind); },
    supabase: {},
    existing: { id: 'del_x' },
    payload: {},
    issue,
    alerts,
  };
}

(async () => {
  /* 1. The clear that was never applied: relation absent, scalar null. */
  {
    const d = deps({ assigneeId: null, title: 'x' });
    const out = await harness(d);
    ok(out.row.assignee_id === '',
      'CLEAR (assignee absent, assigneeId null) now empties row.assignee_id');
    ok(d.alerts.length === 0, 'a clear raises no unknown-assignee anomaly');
  }
  /* 2. The normal reassign, unchanged: relation object present. */
  {
    const out = await harness(deps({ assignee: { id: 'linear-user-known' }, assigneeId: 'linear-user-known' }));
    ok(out.row.assignee_id === MEMBER, 'a relation-object reassign still resolves to the member');
    ok(out.eventAction === 'assign', 'and still stamps the assign action');
  }
  /* 3. The trap the naive fix falls into: relation ABSENT but scalar SET.
   *    Measured once in the 40 captured payloads. A gate that treats
   *    absent-relation as null would CLEAR a real assignment here. */
  {
    const out = await harness(deps({ assigneeId: 'linear-user-known' }));
    ok(out.row.assignee_id === MEMBER,
      'scalar-only NON-null id resolves as an assignment, never as a clear');
  }
  /* 4. Neither key: the gate says nothing about assignment and must not fire. */
  {
    const out = await harness(deps({ title: 'unrelated' }));
    ok(!('assignee_id' in out.row),
      'a payload carrying neither key leaves the assignee untouched');
  }
  /* 5. Unknown scalar id keeps the existing unknown-assignee contract. */
  {
    const d = deps({ assigneeId: 'linear-user-mystery' });
    const out = await harness(d);
    ok(out.row.assignee_id === '' && d.alerts.includes('unknown_assignee'),
      'an unknown scalar id clears and raises the same anomaly an unknown relation always did');
  }

  /* 6. Second half, source-pinned: the detect-only record carries updatedFrom. */
  const detectCall = source.slice(source.indexOf('await recordDetectOnly(supabase, existing, {'),
                                  source.indexOf('return { ok: true, detect_only: true };'));
  ok(/updated_from:/.test(detectCall) && /payload\.updatedFrom/.test(detectCall),
    'the issue-shaped detect-only record includes updated_from from payload.updatedFrom');

  if (failures) { console.error(`\n${failures} check(s) failed.`); process.exit(1); }
  console.log('\nlinear-inbound assignee-clear checks passed');
})();
