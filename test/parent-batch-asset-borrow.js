'use strict';
/*
 * A post parent shows the post's assets, even when its own batch row is empty.
 *
 * OWNER REPORT, 2026-09-01: on a post parent every asset row read `Missing`,
 * "but like if I go to a sub issue you can see that the filming plan is present
 * in the sub-issue, so that's weird". It is weird, and the cause is in the data
 * rather than in the panel.
 *
 * MEASURED THAT DAY against the live browser projection:
 *   - the parent is a B1-backfilled row (`b1_d_...`) whose batch_id is the B1
 *     MIRROR batch (`b1_b_...`), which carries no asset columns at all;
 *   - its children are native rows (`del_...`) on the NATIVE batch (`bat_...`),
 *     which is where the filming plan and the folder links actually live;
 *   - 5,729 of 6,230 live deliverables sit on a `b1_b_` batch, and 5,679 rows
 *     are themselves `b1_d_` rows. This is the estate's normal shape.
 * So the parent and its children answer from DIFFERENT batch rows, and the
 * parent's one is blank. The read was truthful and useless.
 *
 * WHY THE EXISTING BORROW DID NOT COVER IT. The browser already borrows a
 * child's asset read for a batch parent -- `_prodBatchAssetSource` -- but it
 * requires `syntheticBatchParent === true` and returns null for anything else.
 * A REAL parent deliverable like this one never qualifies. Doing the borrow in
 * `assetSnapshot` instead fixes every reader of the asset read at once, and the
 * browser borrow keeps working for the synthetic case it was written for.
 *
 * Strictly a READ, and strictly the three POST-level slots. `deliverable_file`
 * is per-row and is never borrowed.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const GATEWAY = fs.readFileSync(
  path.join(ROOT, 'supabase/functions/production-write/index.ts'), 'utf8');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

function grabFunc(source, name) {
  const at = source.indexOf('function ' + name + '(');
  if (at < 0) throw new Error('function not found: ' + name);
  let depth = 0, quote = '', escaped = false, comment = '';
  for (let j = source.indexOf('{', at); j < source.length; j++) {
    const c = source[j], next = source[j + 1];
    if (comment) {
      if (comment === 'line' && c === '\n') comment = '';
      else if (comment === 'block' && c === '*' && next === '/') { comment = ''; j++; }
      continue;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === quote) quote = '';
      continue;
    }
    if (c === '/' && next === '/') { comment = 'line'; j++; continue; }
    if (c === '/' && next === '*') { comment = 'block'; j++; continue; }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return source.slice(at, j + 1); }
  }
  throw new Error('unclosed ' + name);
}

const snapshot = grabFunc(GATEWAY, 'assetSnapshot');

/* ---- 1. The borrow, cut out of the shipped source and executed ---------- */

/* As in test/filming-plan-from-client.js: the block is lifted verbatim rather
   than re-typed here, so an edit to those lines runs through these assertions
   instead of quietly diverging from a copy. */
const blockStart = snapshot.indexOf('  const parentLinearUuid = clean(deliverable.linear_issue_uuid);');
const blockEnd = snapshot.indexOf('  // The canonical file if the deliverable has one');
if (blockStart < 0 || blockEnd < 0 || blockEnd < blockStart) {
  console.error('FAIL  could not locate the parent-borrow block in assetSnapshot');
  process.exit(1);
}
const BORROW = snapshot.slice(blockStart, blockEnd)
  // The TypeScript-only annotations in the block; nothing else is changed.
  .replace(/ as JsonMap\[\]/g, '').replace(/: JsonMap/g, '');

const clean = v => String(v == null ? '' : v).trim();
const batchCarriesAssets = row => !!(clean(row.filming_doc_url)
  || clean(row.footage_folder_url) || clean(row.delivery_folder_url));

const NATIVE_PLAN = 'https://docs.google.com/document/d/native-batch-plan';

function runBorrow({ ownBatch, deliverable, children, childBatches, kidsError, childError }) {
  const queries = [];
  const supabase = {
    from(table) {
      const q = { table, filters: {} };
      const chain = {
        select() { return chain; },
        eq(col, val) { q.filters[col] = val; return chain; },
        in(col, val) { q.filters[col] = val; return chain; },
        not(col) { q.filters['not:' + col] = true; return chain; },
        limit(n) { q.limit = n; return chain; },
        then(resolve) {
          queries.push(q);
          if (table === 'deliverables') {
            return resolve(kidsError ? { data: null, error: new Error('x') } : { data: children, error: null });
          }
          return resolve(childError ? { data: null, error: new Error('x') } : { data: childBatches, error: null });
        },
      };
      return chain;
    },
  };
  const body = `return (async () => {
    let batch = ownBatch;
    const batchId = clean(batch.id || '');
    const BATCH_ASSET_COLUMNS = 'x';
    const CHILD_BATCH_LOOKUP_LIMIT = 50;
${BORROW}
    return batch;
  })();`;
  const fn = new Function('clean', 'batchCarriesAssets', 'ownBatch', 'deliverable', 'supabase', body);
  return fn(clean, batchCarriesAssets, ownBatch, deliverable, supabase)
    .then(batch => ({ batch, queries }));
}

const PARENT = { linear_issue_uuid: 'a18ced04-uuid', client_slug: 'acme' };
const B1_BATCH = { id: 'b1_b_mirror', client_slug: 'acme', team: 'video' };
const NATIVE_BATCH = { id: 'bat_native', client_slug: 'acme', filming_doc_url: NATIVE_PLAN };

(async () => {
  {
    const { batch, queries } = await runBorrow({
      ownBatch: B1_BATCH, deliverable: PARENT,
      children: [{ batch_id: 'bat_native' }], childBatches: [NATIVE_BATCH],
    });
    ok(clean(batch.filming_doc_url) === NATIVE_PLAN,
      "THE REPORT: a parent on an empty B1 mirror batch now answers with the post's real filming plan, the one its sub-issue was already showing");
    ok(clean(batch.id || '') === '' && clean(batch.team || '') === '',
      "and borrows ONLY the links -- the child batch's id and team do not ride along, so the response still describes the row that was asked about");
    ok(queries[0].filters.raw_issue_parent_id === 'a18ced04-uuid'
      && queries[0].filters.client_slug === 'acme',
      'the children are found by this parent\'s Linear uuid AND pinned to its client, so the borrow cannot cross a client boundary');
    ok(queries[1].filters.client_slug === 'acme',
      'and the batch read is pinned to the same client a second time, rather than trusting the ids the first query returned');
  }

  {
    const OWN = { id: 'bat_own', client_slug: 'acme', filming_doc_url: 'https://docs.google.com/document/d/own' };
    const { batch, queries } = await runBorrow({
      ownBatch: OWN, deliverable: PARENT,
      children: [{ batch_id: 'bat_native' }], childBatches: [NATIVE_BATCH],
    });
    ok(clean(batch.filming_doc_url).endsWith('/own'),
      "a row whose OWN batch carries a link keeps it -- the borrow never overrides a value the post already has");
    ok(queries.length === 0,
      'and asks nothing: the extra reads happen only on the rows that are blank today, not on every row');
  }

  {
    const { batch, queries } = await runBorrow({
      ownBatch: B1_BATCH, deliverable: { linear_issue_uuid: '', client_slug: 'acme' },
      children: [{ batch_id: 'bat_native' }], childBatches: [NATIVE_BATCH],
    });
    ok(!batchCarriesAssets(batch) && queries.length === 0,
      'a row with no Linear uuid is not looked up at all -- an unpinned child query is the one shape this must never make');
  }

  {
    const { batch } = await runBorrow({
      ownBatch: B1_BATCH, deliverable: PARENT,
      children: [{ batch_id: 'bat_native' }], childBatches: [NATIVE_BATCH], kidsError: true,
    });
    ok(!batchCarriesAssets(batch),
      'a failed child lookup falls back to the blank this row showed before, rather than 503-ing a read the row itself already answered');
  }

  {
    const { batch } = await runBorrow({
      ownBatch: B1_BATCH, deliverable: PARENT,
      children: [{ batch_id: 'bat_a' }, { batch_id: 'bat_b' }],
      childBatches: [{ id: 'bat_a', client_slug: 'acme' }, NATIVE_BATCH],
    });
    ok(clean(batch.filming_doc_url) === NATIVE_PLAN,
      'with several child batches it takes the first that actually CARRIES links, not merely the first that exists');
  }

  {
    const { queries } = await runBorrow({
      ownBatch: { id: 'b1_b_mirror', client_slug: 'acme' }, deliverable: PARENT,
      children: [{ batch_id: 'b1_b_mirror' }], childBatches: [],
    });
    ok(queries.length === 1,
      "a child sharing this row's own batch id is excluded, so the borrow cannot re-read the empty batch it just rejected");
  }

  /* ---- 2. The bound, and what is never borrowed ------------------------- */

  ok(/\.limit\(CHILD_BATCH_LOOKUP_LIMIT\)/.test(snapshot)
    && /const CHILD_BATCH_LOOKUP_LIMIT = 50;/.test(GATEWAY),
    'the child read is bounded -- a post is tens of rows, and an unbounded read here would scale with the batch');
  ok(!/deliverable_file/.test(BORROW) && !/file_url/.test(BORROW),
    'the borrow never touches deliverable_file: that slot is per-row, and one child\'s finished file is not the parent\'s');
  /* The borrow keys on `deliverable.linear_issue_uuid`, which reaches it only
     because the caller selects the whole row. A narrowed projection there would
     switch this off silently -- every parent would go back to Missing with
     nothing failing anywhere. */
  const reader = grabFunc(GATEWAY, 'handleAssetAccessRead');
  ok(/\.from\("deliverables"\)\s*\n?\s*\.select\("\*"\)/.test(reader),
    'the asset read still loads the whole deliverable row, which is the only reason linear_issue_uuid reaches the borrow at all');

  ok(snapshot.indexOf('parentLinearUuid') < snapshot.indexOf('let filmingPlan = clean('),
    "the borrow runs BEFORE the client filming-plan fallback, so a post's own plan still wins over the client's standing one");

  console.log(failures === 0
    ? '\nparent batch asset borrow checks passed'
    : '\n' + failures + ' parent batch asset check(s) failed');
  process.exit(failures === 0 ? 0 : 1);
})();
