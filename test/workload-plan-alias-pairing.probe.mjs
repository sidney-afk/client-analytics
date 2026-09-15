/*
 * PROBE, not a CI lane. Covers `planAliasPairs` / `pairedPlanAliases` in
 * `supabase/functions/workload-plan/index.ts` — the pairing the degraded
 * `list` path builds for itself so a saved work day stored under one identity
 * namespace still reaches a board keyed on the other (OPEN_REPAIRS 210).
 *
 * WHY IT IS A PROBE. It needs the function compiled to JS, and this repo has
 * no Deno or esbuild in its dev dependencies. Run it by compiling the function
 * first (`npx esbuild@0.23.1 <index.ts> --format=esm --outfile=probe.mjs`),
 * stubbing the npm: and ../_shared imports, and exporting the two functions.
 * That is exactly how it was run on 2026-09-15 before deploying v14.
 *
 * IT EARNED ITS KEEP. Case 3 caught a real hole in the first draft: the
 * bounded read cannot see a SECOND deliverable claiming the same Linear id,
 * because that row is not in the answer being returned, so the pairing would
 * have aliased on unproven evidence and could have handed a saved day to the
 * wrong card. The confirmation pass exists because this failed.
 */
import { planAliasPairs, pairedPlanAliases } from './probe.mjs';
let fails = 0;
const ok = (name, cond) => { console.log((cond ? '  ok  ' : 'FAIL  ') + name); if (!cond) fails++; };

const fakeDb = (rows, errOn) => ({
  from: () => ({
    select: () => ({
      in: (col, chunk) => {
        if (errOn === col) return Promise.resolve({ error: { message: 'boom' }, data: null });
        const key = col === 'id' ? 'id' : 'linear_issue_uuid';
        return Promise.resolve({ error: null, data: rows.filter(r => chunk.includes(r[key])) });
      },
    }),
  }),
});

const DEL = [
  { id: 'del_a', linear_issue_uuid: 'uuid-a', client_slug: 'acme' },
  { id: 'del_b', linear_issue_uuid: 'uuid-b', client_slug: 'acme' },
  { id: 'del_c', linear_issue_uuid: 'uuid-c', client_slug: 'other' },
  { id: 'del_d1', linear_issue_uuid: 'uuid-dup', client_slug: 'acme' },
  { id: 'del_d2', linear_issue_uuid: 'uuid-dup', client_slug: 'acme' },
];
const plan = (id, client, date) => ({ issue_id: id, client, plan_date: date, updated_at: 't' });

// 1. a natively-keyed override reaches a Linear-keyed board, and vice versa
{
  const plans = [plan('del_a', 'acme', '2026-09-16'), plan('uuid-b', 'acme', '2026-09-17')];
  const pairs = await planAliasPairs(fakeDb(DEL), plans);
  const out = pairedPlanAliases(plans, pairs);
  const ids = out.plans.map(p => p.issue_id).sort();
  ok('both namespaces are emitted for both stored shapes',
    JSON.stringify(ids) === JSON.stringify(['del_a', 'del_b', 'uuid-a', 'uuid-b']));
  ok('the alias carries the same day', out.plans.every(p => p.plan_date === (p.issue_id.includes('a') ? '2026-09-16' : '2026-09-17')));
  ok('nothing is reported unmatched', out.unaliased === 0);
}

// 2. client drift is refused AND reported, never re-keyed
{
  const plans = [plan('del_c', 'acme', '2026-09-16')];
  const pairs = await planAliasPairs(fakeDb(DEL), plans);
  const out = pairedPlanAliases(plans, pairs);
  ok('a drifted override is never moved onto the other client\'s card',
    out.plans.length === 1 && out.plans[0].issue_id === 'del_c');
  ok('and it is counted as DRIFT, not as a match failure', out.drifted === 1 && out.unaliased === 0);
}

// 3. an ambiguous pairing aliases neither side
{
  const plans = [plan('del_d1', 'acme', '2026-09-16')];
  const pairs = await planAliasPairs(fakeDb(DEL), plans);
  const out = pairedPlanAliases(plans, pairs);
  ok('two cards claiming one Linear id alias neither', out.plans.length === 1 && out.unaliased === 0);
}

// 4. a card with no twin is not a fault
{
  const plans = [plan('uuid-legacy-only', 'acme', '2026-09-16')];
  const pairs = await planAliasPairs(fakeDb(DEL), plans);
  const out = pairedPlanAliases(plans, pairs);
  ok('a single-identity card raises no warning', out.plans.length === 1 && out.unaliased === 0);
}

// 5. both halves already stored: no duplicate, no warning
{
  const plans = [plan('del_a', 'acme', '2026-09-16'), plan('uuid-a', 'acme', '2026-09-16')];
  const pairs = await planAliasPairs(fakeDb(DEL), plans);
  const out = pairedPlanAliases(plans, pairs);
  ok('an override stored under both names is not duplicated', out.plans.length === 2 && out.unaliased === 0);
}

// 6. a failed lookup is null, never a half map
{
  const plans = [plan('del_a', 'acme', '2026-09-16')];
  ok('a failed read returns null rather than a partial pairing',
    (await planAliasPairs(fakeDb(DEL, 'id'), plans)) === null
    && (await planAliasPairs(fakeDb(DEL, 'linear_issue_uuid'), plans)) === null);
}

// 7. client comparison uses the same normalizer as the stored key
{
  const rows = [{ id: 'del_n', linear_issue_uuid: 'uuid-n', client_slug: 'Acme-Studio' }];
  const plans = [plan('del_n', 'acmestudio', '2026-09-16')];
  const pairs = await planAliasPairs(fakeDb(rows), plans);
  const out = pairedPlanAliases(plans, pairs);
  ok('a slug and a stored client key compare after the same normalization',
    out.plans.length === 2 && out.unaliased === 0);
}

// 8. empty input
{
  const pairs = await planAliasPairs(fakeDb(DEL), []);
  ok('no overrides means an empty map, not a failure', pairs instanceof Map && pairs.size === 0);
}

// 9. two saved days claiming one alias is a real fault and IS reported
{
  const plans = [plan('del_a', 'acme', '2026-09-16'), plan('del_a2', 'acme', '2026-09-17')];
  const rows = [
    { id: 'del_a', linear_issue_uuid: 'uuid-a', client_slug: 'acme' },
    { id: 'del_a2', linear_issue_uuid: 'uuid-a', client_slug: 'acme' },
  ];
  // Pairing refuses the ambiguity outright, so nothing is aliased either way.
  const pairs = await planAliasPairs(fakeDb(rows), plans);
  const out = pairedPlanAliases(plans, pairs);
  ok('an ambiguous claim aliases neither and invents no alias', out.plans.length === 2);
  // And when a collision reaches the emitter directly, it is counted as a fault.
  const forced = new Map([['x1', { id: 'twin', client: 'acme' }], ['x2', { id: 'twin', client: 'acme' }]]);
  const collided = pairedPlanAliases([plan('x1', 'acme', '2026-09-16'), plan('x2', 'acme', '2026-09-17')], forced);
  ok('two saved days claiming one alias reports a match failure',
    collided.unaliased === 1 && collided.drifted === 0 && collided.plans.length === 3);
}

console.log(fails ? `\n${fails} check(s) failed` : '\nall alias checks passed');
process.exit(fails ? 1 : 0);
