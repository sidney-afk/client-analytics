'use strict';
/*
 * THE THREE SHARED SLOTS RESOLVE ACROSS THE POST, NOT ACROSS ONE BATCH ROW.
 *
 * OWNER REPORT, 2026-09-05: he set the Frame folder on a post PARENT and it did
 * not appear on any sub-issue; the sub-issues showed Raw footage and that did
 * not appear on the parent. "The way it should behave is if someone uploads the
 * frame folder from anywhere, sub-issue or parent issue, it should appear
 * everywhere, and same for the raw footage."
 *
 * MEASURED LIVE THAT DAY, over all 6,330 browser-visible deliverables:
 *   - of 1,136 posts (a parent uuid carrying at least one child), 109 span more
 *     than one `batches` row; 107 of those have a real parent deliverable row;
 *   - on the reported post the parent is a B1 row on the mirror batch
 *     `b1_b_...` and all 32 sub-issues are native rows on `bat_...`;
 *   - 41 of the 109 have a canonical row that also serves another post.
 * So the parent and its children were reading and writing two different rows.
 *
 * WHY THE 2026-09-01 BORROW DID NOT COVER IT, and why this file replaces
 * test/parent-batch-asset-borrow.js rather than sitting beside it:
 *   - that borrow ran only DOWNWARD (`raw_issue_parent_id` = THIS row's uuid),
 *     so a sub-issue never reached the parent's batch under any condition;
 *   - it was gated on the reader's own batch carrying NONE of the three, so the
 *     owner's own Frame-folder save switched it off and took the children's Raw
 *     footage off the parent with it.
 * Both of those behaviours were pinned by the old suite, which is why the old
 * suite is gone: its assertions described the defect.
 *
 * Still strictly a READ, and strictly the three POST-level slots.
 * `deliverable_file` is per-row and is never resolved across the post.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const GATEWAY = fs.readFileSync(
  path.join(ROOT, 'supabase/functions/production-write/index.ts'), 'utf8');
const VIEW_MIGRATION = fs.readFileSync(
  path.join(ROOT, 'migrations/2026-08-23-attribution-slug-guard-widening.sql'), 'utf8');

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

/* ---- 1. The resolution, cut out of the shipped source and executed ------ */

/* Lifted verbatim rather than re-typed, as in test/filming-plan-from-client.js,
   so an edit to those lines runs through these assertions instead of quietly
   diverging from a copy kept here. */
const blockStart = snapshot.indexOf(
  '  const deliverableClient = clean(deliverable.client_slug) || clean(batch.client_slug);');
const blockEnd = snapshot.indexOf('  // The canonical file if the deliverable has one');
if (blockStart < 0 || blockEnd < 0 || blockEnd < blockStart) {
  console.error('FAIL  could not locate the post-resolution block in assetSnapshot');
  process.exit(1);
}
const RESOLVE = snapshot.slice(blockStart, blockEnd)
  /* The TypeScript-only annotations in the block; nothing else is changed. If
     the block grows an annotation this list does not cover, `new Function`
     throws a SyntaxError and this suite fails loudly -- which is the right
     failure, because it means the lifted source is no longer being executed. */
  .replace(/ as JsonMap\[\]/g, '')
  .replace(/: JsonMap\[\]/g, '')
  .replace(/: JsonMap/g, '')
  .replace(/\(field: string\)/g, '(field)')
  .replace(/\(resolved: \{ from: string \}\)/g, '(resolved)')
  .replace(/new Set<string>\(\)/g, 'new Set()')
  .replace(/: Set<string> \| null/g, '')
  .replace(/: Record<string, \{ id: string; updated_at: string \} \| null>/g, '')
  .replace(/exclusiveBatchIds!\./g, 'exclusiveBatchIds.');

const clean = v => String(v == null ? '' : v).trim();
const parseJson = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const LINEAR_UUID_SHAPE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/;

const PLAN = 'https://docs.google.com/document/d/post-plan';
const FOOTAGE = 'https://www.dropbox.com/scl/fo/footage/AAA?rlkey=k1';
const FRAME = 'https://f.io/_frame';

function runResolve({ ownBatch, deliverable, roster, siblingBatches, occupants,
                     rosterError, siblingError, occupantsError }) {
  const queries = [];
  let viewCalls = 0;
  const supabase = {
    from(table) {
      const q = { table, filters: {} };
      const chain = {
        select() { return chain; },
        eq(col, val) { q.filters[col] = val; return chain; },
        in(col, val) { q.filters[col] = val; return chain; },
        or(expr) { q.or = expr; return chain; },
        not(col) { q.filters['not:' + col] = true; return chain; },
        order(col, opts) { q.order = col; q.orderOpts = opts; return chain; },
        limit(n) { q.limit = n; return chain; },
        then(resolve) {
          queries.push(q);
          /* Branching on the table NAME is deliberate. The first version of the
             2026-09-01 borrow asked the `deliverables` TABLE for
             raw_issue_parent_id, which the view derives and the table does not
             carry -- PostgREST 42703, swallowed by the guard, read silently
             dead. A fake that answers whichever table it is handed would not
             have caught that, and would not catch it again here. */
          if (table === 'production_deliverables_browser_v1') {
            /* Two different reads hit this view: the post ROSTER first, then
               the OCCUPANTS of the candidate batches. Answering both from one
               fixture would let a test pass while the code asked the wrong
               question, so they are told apart by call order the same way the
               code issues them. */
            viewCalls += 1;
            if (viewCalls === 1) {
              return resolve(rosterError
                ? { data: null, error: new Error('x') }
                : { data: roster, error: null });
            }
            return resolve(occupantsError
              ? { data: null, error: new Error('x') }
              : { data: occupants || [], error: null });
          }
          if (table === 'batches') {
            return resolve(siblingError
              ? { data: null, error: new Error('x') }
              : { data: siblingBatches, error: null });
          }
          throw new Error('the resolution queried an unexpected table: ' + table);
        },
      };
      return chain;
    },
  };
  const body = `return (async () => {
    let batch = ownBatch;
    const batchId = clean(batch.id || '');
    const BATCH_ASSET_COLUMNS = 'x';
${RESOLVE}
    return { postFilmingPlan, postRawFootage, postDeliveryFolder, orderedBatches,
             postWriteTargets, exclusiveFallbackId, exclusiveBatchIds };
  })();`;
  const fn = new Function(
    'clean', 'parseJson', 'LINEAR_UUID_SHAPE', 'POST_ROW_LOOKUP_LIMIT',
    'ownBatch', 'deliverable', 'supabase', body);
  return fn(clean, parseJson, LINEAR_UUID_SHAPE, 200, ownBatch, deliverable, supabase)
    .then(out => ({ ...out, queries }));
}

// The owner's shape: a B1 parent on a mirror batch, native children elsewhere.
const PARENT = { linear_issue_uuid: 'a18ced04-uuid', client_slug: 'acme' };
const CHILD = {
  linear_issue_uuid: 'child-uuid',
  client_slug: 'acme',
  linear_raw: { issue: { parent: { id: 'a18ced04-uuid' } } },
};
const MIRROR = { id: 'b1_b_mirror', client_slug: 'acme', delivery_folder_url: FRAME };
const NATIVE = { id: 'bat_native', client_slug: 'acme', filming_doc_url: PLAN, footage_folder_url: FOOTAGE };

(async () => {
  {
    // THE REPORT, parent half.
    const out = await runResolve({
      ownBatch: MIRROR, deliverable: PARENT,
      roster: [{ batch_id: 'b1_b_mirror' }, { batch_id: 'bat_native' }],
      siblingBatches: [NATIVE],
    });
    ok(out.postRawFootage.value === FOOTAGE,
      "THE REPORT (parent): a parent whose own batch already carries the Frame folder still sees the Raw footage that lives on its children's batch -- the 2026-09-01 borrow switched off in exactly this case, which is what the owner's own save did to him");
    ok(out.postDeliveryFolder.value === FRAME,
      'and keeps the Frame folder its own row holds: resolution is PER SLOT, so one link on each of two rows shows both, not whichever row won');
    ok(out.postFilmingPlan.value === PLAN,
      "and picks up the post's filming plan from the same native row");
  }

  {
    // THE REPORT, child half -- the direction that did not exist at all.
    const out = await runResolve({
      ownBatch: NATIVE, deliverable: CHILD,
      roster: [{ batch_id: 'bat_native' }, { batch_id: 'b1_b_mirror' }],
      siblingBatches: [MIRROR],
    });
    ok(out.postDeliveryFolder.value === FRAME,
      "THE REPORT (sub-issue): a child now sees the Frame folder its PARENT saved onto another batch row -- there was previously no upward or sideways read at any layer, so this could never have appeared");
    ok(out.postRawFootage.value === FOOTAGE,
      'while still showing the raw footage on its own row');
  }

  {
    // Determinism is the correctness argument: same answer from either seat.
    const fromParent = await runResolve({
      ownBatch: MIRROR, deliverable: PARENT,
      roster: [{ batch_id: 'b1_b_mirror' }, { batch_id: 'bat_native' }],
      siblingBatches: [NATIVE],
    });
    const fromChild = await runResolve({
      ownBatch: NATIVE, deliverable: CHILD,
      roster: [{ batch_id: 'bat_native' }, { batch_id: 'b1_b_mirror' }],
      siblingBatches: [MIRROR],
    });
    ok(fromParent.postRawFootage.value === fromChild.postRawFootage.value
      && fromParent.postDeliveryFolder.value === fromChild.postDeliveryFolder.value
      && fromParent.postFilmingPlan.value === fromChild.postFilmingPlan.value,
      'EVERY SEAT OF THE POST RESOLVES THE SAME THREE VALUES -- this is the property the owner asked for, and it does not depend on the tie-break picking the "right" row, only the SAME row');
    ok(fromParent.postWriteTargets.raw_footage.id === fromChild.postWriteTargets.raw_footage.id
      && fromParent.postWriteTargets.delivery_folder.id === fromChild.postWriteTargets.delivery_folder.id,
      'and both seats name the same write target for each slot, so a link typed from either one lands where the other reads it -- which is what stops a NEW split being made by editing a value you were shown from elsewhere');
    ok(fromParent.postWriteTargets.raw_footage.id === 'bat_native'
      && fromParent.postWriteTargets.delivery_folder.id === 'b1_b_mirror',
      'THE PER-SLOT RULE: each slot is written where ITS OWN value already lives, not where the panel as a whole points -- aiming both at one row would send the Frame folder editor at a row whose column is empty, so clearing the link on screen would write a blank over a blank and the value would simply come back');
    ok(fromParent.postWriteTargets.delivery_folder.updated_at !== undefined,
      'and the CAS clock travels with the target, since comparing one row\'s updated_at against another row\'s fails its CAS forever');
  }

  {
    // Two rows holding a DIFFERENT value for the same slot must not answer
    // per-seat: that is the divergence this whole change exists to end.
    const A = { id: 'bat_aaa', client_slug: 'acme', delivery_folder_url: 'https://f.io/_a' };
    const B = { id: 'bat_bbb', client_slug: 'acme', delivery_folder_url: 'https://f.io/_b' };
    const seatA = await runResolve({
      ownBatch: A, deliverable: PARENT,
      roster: [{ batch_id: 'bat_aaa' }, { batch_id: 'bat_bbb' }], siblingBatches: [B],
    });
    const seatB = await runResolve({
      ownBatch: B, deliverable: CHILD,
      roster: [{ batch_id: 'bat_bbb' }, { batch_id: 'bat_aaa' }], siblingBatches: [A],
    });
    ok(seatA.postDeliveryFolder.value === seatB.postDeliveryFolder.value
      && seatA.postDeliveryFolder.value === 'https://f.io/_a',
      'on genuinely divergent values both seats still answer identically, by id order -- an own-batch-first preference would have answered per seat and never converged');
  }

  {
    const out = await runResolve({
      ownBatch: { id: 'b1_b_only', client_slug: 'acme', footage_folder_url: FOOTAGE },
      deliverable: PARENT, roster: [{ batch_id: 'b1_b_only' }], siblingBatches: [],
    });
    ok(out.queries.length === 1 && out.postRawFootage.value === FOOTAGE,
      'a post that sits on ONE batch row -- 1,027 of the 1,136 measured -- reads its own row and makes no second query, so the common case pays nothing');
  }

  {
    const out = await runResolve({
      ownBatch: MIRROR, deliverable: { client_slug: 'acme', linear_issue_uuid: '' },
      roster: [{ batch_id: 'bat_native' }], siblingBatches: [NATIVE],
    });
    ok(out.queries.length === 0 && out.postDeliveryFolder.value === FRAME,
      'a row with no resolvable post key asks nothing and falls back to its own batch -- an unpinned roster query is the one shape this must never make');
  }

  {
    const out = await runResolve({
      ownBatch: MIRROR, deliverable: PARENT,
      roster: [{ batch_id: 'bat_native' }], siblingBatches: [NATIVE], rosterError: true,
    });
    ok(out.postDeliveryFolder.value === FRAME && out.postRawFootage.value === '',
      'a failed roster read degrades to exactly what this row showed before, rather than 503-ing a question the row already answered or blanking a link it holds');
  }

  {
    const out = await runResolve({
      ownBatch: MIRROR, deliverable: PARENT,
      roster: [{ batch_id: 'bat_native' }], siblingBatches: [NATIVE], siblingError: true,
    });
    ok(out.postDeliveryFolder.value === FRAME && out.postFilmingPlan.value === '',
      'and a failed sibling batch read does the same');
  }

  {
    const out = await runResolve({
      ownBatch: MIRROR, deliverable: PARENT,
      roster: [{ batch_id: 'b1_b_mirror' }, { batch_id: 'bat_native' }],
      siblingBatches: [NATIVE],
    });
    ok(out.queries[0].table === 'production_deliverables_browser_v1',
      'the post roster is read from the VIEW, the only place raw_issue_parent_id exists -- asking the table answers 42703, and the swallow above would report that as "this post has one batch row"');
    ok(out.queries[0].filters.client_slug === 'acme'
      && /a18ced04-uuid/.test(String(out.queries[0].or || '')),
      "the roster is found by the post's uuid AND pinned to its client, with the client pin OUTSIDE the or() group so it is ANDed with it and no other client's row is reachable");
    ok(out.queries[0].order === 'id' && out.queries[0].limit === 200,
      'and it is ORDERED and BOUNDED, so a post that ever exceeds the cap truncates to the same rows from every seat -- an incomplete answer that is at least a consistent one');
    ok(out.queries[1].table === 'batches' && out.queries[1].filters.client_slug === 'acme',
      'the batch read is pinned to the same client a second time, rather than trusting the ids the roster returned');
  }

  {
    const out = await runResolve({
      ownBatch: { id: 'zz_late', client_slug: 'acme' }, deliverable: PARENT,
      roster: [{ batch_id: 'zz_late' }, { batch_id: 'bat_native' }, { batch_id: 'b1_b_mirror' }],
      siblingBatches: [MIRROR, NATIVE],
    });
    ok(clean(out.orderedBatches[0].id) === 'bat_native',
      'a native bat_ row sorts ahead of every mirror and stray row -- the same tie-break the browser projection already applies to competing parent claims, so two files carry one rule');
  }

  {
    /* A BUCKET SHARED WITH ANOTHER POST IS NEVER OFFERED AS A TARGET.
       73 of 1,127 batch rows measured 2026-09-05 hold more than one post; one
       holds seven. Naming one as a write target would put a link saved here on
       posts nobody was looking at, while the editor says "shared by the whole
       post". Raised by review on #1287 before this reached a deploy. */
    const EMPTY_A = { id: 'bat_shared', client_slug: 'acme' };
    const EMPTY_B = { id: 'b1_b_own', client_slug: 'acme' };
    const out = await runResolve({
      ownBatch: EMPTY_B, deliverable: PARENT,
      roster: [{ batch_id: 'b1_b_own' }, { batch_id: 'bat_shared' }],
      siblingBatches: [EMPTY_A],
      // bat_shared also carries a row belonging to a DIFFERENT post.
      occupants: [
        { batch_id: 'bat_shared', raw_issue_parent_id: 'someone-else-uuid' },
        { batch_id: 'bat_shared', raw_issue_parent_id: 'a18ced04-uuid' },
        { batch_id: 'b1_b_own', raw_issue_parent_id: 'a18ced04-uuid' },
      ],
    });
    ok(out.exclusiveFallbackId === 'b1_b_own',
      'with every slot empty, the target is the first bucket in canonical order that belongs to this post ALONE -- the native row sorts first but carries another post, so it is passed over');
    ok(out.postWriteTargets.raw_footage.id === 'b1_b_own',
      'and each empty slot takes that same exclusive bucket');
  }

  {
    const out = await runResolve({
      ownBatch: { id: 'b1_b_own', client_slug: 'acme' }, deliverable: PARENT,
      roster: [{ batch_id: 'b1_b_own' }, { batch_id: 'bat_shared' }],
      siblingBatches: [{ id: 'bat_shared', client_slug: 'acme' }],
      occupants: [
        { batch_id: 'bat_shared', raw_issue_parent_id: 'someone-else-uuid' },
        { batch_id: 'b1_b_own', raw_issue_parent_id: 'other-post-too' },
      ],
    });
    ok(out.exclusiveFallbackId === '' && out.postWriteTargets.raw_footage === null,
      'when NO bucket of the post is exclusive, nothing is offered at all and the browser writes the row it is already on -- exactly what shipped before any of this');
  }

  {
    const out = await runResolve({
      ownBatch: { id: 'b1_b_own', client_slug: 'acme' }, deliverable: PARENT,
      roster: [{ batch_id: 'b1_b_own' }, { batch_id: 'bat_shared' }],
      siblingBatches: [{ id: 'bat_shared', client_slug: 'acme' }],
      occupants: [], occupantsError: true,
    });
    ok(out.exclusiveBatchIds === null && out.postWriteTargets.raw_footage === null,
      'and a failed exclusivity read leaves it UNKNOWN, which offers no target rather than guessing one -- a wrong guess here writes a client link onto an unrelated post');
  }

  {
    const out = await runResolve({
      ownBatch: { id: 'bat_only', client_slug: 'acme' }, deliverable: PARENT,
      roster: [{ batch_id: 'bat_only' }], siblingBatches: [],
    });
    ok(out.postWriteTargets.raw_footage.id === 'bat_only' && out.queries.length === 1,
      'a post on ONE bucket names that bucket without asking about exclusivity -- there is no other row a write could reach, and the common case pays nothing');
  }

  {
    const SHARED_WITH_VALUE = { id: 'bat_shared', client_slug: 'acme', footage_folder_url: FOOTAGE };
    const out = await runResolve({
      ownBatch: { id: 'b1_b_own', client_slug: 'acme' }, deliverable: PARENT,
      roster: [{ batch_id: 'b1_b_own' }, { batch_id: 'bat_shared' }],
      siblingBatches: [SHARED_WITH_VALUE],
      occupants: [{ batch_id: 'bat_shared', raw_issue_parent_id: 'someone-else-uuid' }],
    });
    ok(out.postWriteTargets.raw_footage.id === 'bat_shared',
      'a slot whose value ALREADY lives on a shared bucket is still written there: that row is what every seat displays and is already shared with whatever else sits in it, so editing it exposes nothing new -- refusing would make the value on screen uneditable');
  }

  /* ---- 2. The bounds, and what is never resolved across the post -------- */

  ok(!/deliverable_file/.test(RESOLVE) && !/file_url/.test(RESOLVE),
    "the resolution never touches deliverable_file: that slot is per-row, and one sub-issue's finished file is not the post's");

  ok(/const POST_ROW_LOOKUP_LIMIT = 200;/.test(GATEWAY),
    'the roster read is bounded by a named constant rather than an inline number');

  /* The post key reaches this code only because the caller selects the whole
     row. A narrowed projection there would switch resolution off silently --
     every split post would go back to disagreeing, with nothing failing. */
  const reader = grabFunc(GATEWAY, 'handleAssetAccessRead');
  ok(/\.from\("deliverables"\)\s*\n?\s*\.select\("\*"\)/.test(reader),
    'the asset read still loads the whole deliverable row, which is the only reason linear_raw and linear_issue_uuid reach the resolution at all');

  ok(snapshot.indexOf('const postFilmingPlan') < snapshot.indexOf('let filmingPlan = clean(')
    || snapshot.indexOf('let filmingPlan = postFilmingPlan.value;') > 0,
    "the post's own filming plan is resolved BEFORE the client fallback, so a batch that names its own plan still wins over the client's standing one");

  /* ---- 3. The JS post key and the SQL view must not drift --------------- */

  const sqlGuard = /\(\(\(root\.issue -> 'parent'::text\) ->> 'id'::text\) ~ '(\^\[A-Za-z0-9\]\[A-Za-z0-9_-\]\{0,99\}\$)'::text\)/
    .exec(VIEW_MIGRATION);
  ok(!!sqlGuard,
    "the view still derives raw_issue_parent_id from linear_raw -> issue -> parent -> id under a character class");
  ok(!!sqlGuard && sqlGuard[1] === LINEAR_UUID_SHAPE.source.replace(/\\/g, ''),
    'and the gateway guards the post key with the IDENTICAL character class -- the JS reads the same JSON path the SQL does, so the two derivations cannot answer differently about the same row');
  ok(/parseJson\(parseJson\(parseJson\(deliverable\.linear_raw\)\.issue\)\.parent\)\.id/.test(snapshot),
    'and it reads that exact path, rather than a second query for a column the view already derives from it');

  console.log(failures === 0
    ? '\npost asset resolution checks passed'
    : '\n' + failures + ' post asset resolution check(s) failed');
  process.exit(failures === 0 ? 0 : 1);
})();
