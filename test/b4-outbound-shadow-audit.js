'use strict';

const fs = require('fs');
const path = require('path');
const {
  classifyDiff,
  classifyRepair,
  summarizeShadow,
} = require('../scripts/b4-outbound-shadow-audit');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else {
    failures++;
    console.error('FAIL  ' + message);
  }
}

const sampleIds = new Set(['sample-deliverable']);
ok(classifyDiff(
  { id: 'sample-deliverable' },
  { reason: 'outbound_state_mismatch', actual: 'posted' },
  sampleIds,
).disposition === 'expected_explainable', 'sample posted clamp is explainable');
ok(classifyDiff(
  { id: 'ordinary-deliverable' },
  { reason: 'outbound_title_mismatch', actual: 'different' },
  sampleIds,
).disposition === 'unexpected', 'ordinary field mismatch remains unexpected');
ok(classifyRepair({ reason: 'outbound_assignee_mapping_missing' }).disposition === 'expected_explainable',
  'unknown assignee linkage is an explainable repair row');

const plan = {
  summary: { entities_checked: 3, deliverables_checked: 2, batches_checked: 1 },
  results: [
    {
      id: 'clean-deliverable', entity: 'deliverable', team: 'video', identifier: 'VID-1',
      row: { client_slug: 'fixture-one' }, diffs: [], repairs: [], outbound_intents: [],
    },
    {
      id: 'sample-deliverable', entity: 'deliverable', team: 'graphics', identifier: 'GRA-1',
      row: { client_slug: 'fixture-two' },
      diffs: [{ field: 'status', expected: 'approved', actual: 'posted', reason: 'outbound_state_mismatch' }],
      repairs: [{ field: 'assignee_id', reason: 'outbound_assignee_mapping_missing' }],
      outbound_intents: [{ operation: 'status', payload: { status: 'approved' } }],
    },
    {
      id: 'batch-one', entity: 'batch', team: 'video', identifier: 'VID-2',
      row: { client_slug: 'fixture-three' },
      diffs: [{ field: 'title', expected: 'Local', actual: 'Remote', reason: 'outbound_batch_title_mismatch' }],
      tolerated: [{ field: 'parent', reason: 'tolerated_historical', operation: 'parent' }],
      repairs: [], outbound_intents: [{ operation: 'title', payload: { title: 'Local' } }],
    },
  ],
};
const data = {
  sampleReviews: [{ video_deliverable_id: 'sample-deliverable', graphic_deliverable_id: null }],
};
const summary = summarizeShadow(plan, data, new Set(['fixture-one', 'fixture-two', 'fixture-three']), 2);
ok(summary.public.roster.active_real_clients === 3
  && summary.public.roster.test_clients_excluded === 2,
'summary derives roster and excluded-TEST counts from inputs');
ok(summary.public.divergences.total === 2
  && summary.public.divergences.expected_explainable === 1
  && summary.public.divergences.unexpected === 1,
'summary separates explainable and unexpected divergences');
ok(summary.public.intended_writes.total === 2
  && summary.public.intended_writes.expected_explainable === 1
  && summary.public.intended_writes.unexpected === 1,
'summary classifies intended writes by their matching divergence');
ok(summary.public.by_team.video.entities_checked === 2
  && summary.public.by_team.graphics.entities_checked === 1,
'summary preserves aggregate team coverage without client names');
ok(summary.public.tolerated_historical.total === 1
  && summary.public.tolerated_historical.by_operation.parent === 1
  && summary.public.coverage.clients_with_tolerated_historical === 1,
'summary keeps historical suppression visible without turning it into an intended write');

const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'b4-outbound-shadow-audit.js'), 'utf8');
ok(/B4_CONFIRM_READ_ONLY_SHADOW/.test(source), 'live audit requires explicit read-only confirmation');
ok(/linear_outbound_enabled must be off or shadow/.test(source)
  && /prod_authority must remain linear\/linear/.test(source),
'live audit accepts only the D-28 off/shadow soak modes and Linear team authority');
ok(/data\.prodAuthority = \{ video: 'syncview', graphics: 'syncview' \}/.test(source),
  'authority override exists only in the in-memory classifier data');
ok(!/supabaseRpc|supabaseInsert|linearGraphql|\bmutation\s+[A-Za-z]/.test(source),
  'audit source has no backend RPC, insert helper, or Linear mutation');
ok(/private evidence path must be outside the repository/.test(source),
  'row-level evidence is forced outside the public repository');
ok(/outbox_high_water_before/.test(source) && /linear_mutation_calls: 0/.test(source),
  'report proves queue immutability and zero Linear mutation calls');

if (failures) {
  console.error(`\n${failures} B4 outbound shadow audit check(s) failed`);
  process.exit(1);
}
console.log('\nB4 outbound shadow audit checks passed');
