'use strict';
/*
 * The filming plan slot answers from the CLIENT when the batch has no copy.
 *
 * OWNER QUESTION, 2026-09-01, on a screen where the row read `Missing`:
 * "I thought the asset in SyncLinear for the filming plan takes the filming
 * plan from that client from Supabase, which she does have one, so isn't that
 * how it's working?"
 *
 * It was not. `batches.filming_doc_url` is written in exactly ONE place -- the
 * intake create path, which copies the client's plan onto the batch at creation
 * -- and nothing ever re-reads it. A batch made any other way (the calendar,
 * the samples tab, a backfill, or anything predating the intake path) carries
 * an empty column forever, so the panel said `Missing` about a plan the client
 * demonstrably has, often with the URL sitting in the batch description a few
 * lines below. Measured 2026-08-30 (WIRED-PARITY item 30): 1,340 live
 * deliverables are in a batch whose own description carries the filming-plan
 * URL the row called Missing.
 *
 * THE FIX IS A READ, NOT A WRITE, and that distinction is the whole safety
 * argument. The filming plan is the owner's standing write exception -- refused
 * in three independent places -- so deriving it cannot overwrite a value some
 * seat typed, because no seat can type one. This file asserts the derivation
 * AND that all three refusals are still in place, since a read-side fallback is
 * exactly the change someone would later "finish" by adding a writer.
 *
 * THE BATCH COLUMN STILL WINS when it is set. A batch that names its own plan
 * was told to, and one client can run more than one shoot.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const INDEX = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
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

/* ---- 1. THE DERIVATION ITSELF, executed rather than described ------------ */

/* `assetSnapshot` is Deno TypeScript against a Supabase client, so it cannot be
   imported here. Rather than hand-copy the precedence into this file -- a mirror
   that passes forever once the real one drifts -- the resolution block is CUT
   OUT OF THE SHIPPED SOURCE and run verbatim against fakes. If someone edits
   those lines, these assertions run the edit. */
const snapshot = grabFunc(GATEWAY, 'assetSnapshot');
const blockStart = snapshot.indexOf('  let filmingPlan = postFilmingPlan.value;');
const blockEnd = snapshot.indexOf('  const values: Record<string, unknown> = {');
if (blockStart < 0 || blockEnd < 0 || blockEnd < blockStart) {
  console.error('FAIL  could not locate the filming-plan resolution block in assetSnapshot');
  process.exit(1);
}
const RESOLUTION = snapshot.slice(blockStart, blockEnd);

// Nothing TypeScript-only may appear in the block, or this stops being a real
// execution and quietly becomes a syntax error the runner reports as a crash.
const runResolution = new Function('clean', 'batch', 'postFilmingPlan', 'supabase', 'clientFilmingPlanUrl',
  'return (async () => {\n' + RESOLUTION + '\nreturn { filmingPlan, filmingPlanFromClient };\n})();');

const clean = v => String(v == null ? '' : v).trim();
async function resolveFilmingPlan(batchColumn, clientPlan, clientSlug) {
  const calls = [];
  const out = await runResolution(
    clean,
    { filming_doc_url: batchColumn, client_slug: clientSlug === undefined ? 'acme' : clientSlug },
    /* Since 2026-09-05 the batch column reaches this block already resolved
       ACROSS THE POST -- `batch.filming_doc_url` if this row's own batch has
       one, otherwise the same column off another batch row of the same post
       (see test/post-asset-resolution.js). The precedence asserted here is
       unchanged and is the NEXT one down: whatever the post resolved, else the
       client's standing plan. Feeding the post value in as the input keeps this
       suite about that decision alone. */
    { value: clean(batchColumn), from: clean(batchColumn) ? 'bat_x' : '' },
    { fake: true },
    async (_supabase, slug) => { calls.push(slug); return clean(clientPlan); },
  );
  return { ...out, calls };
}

const BATCH_URL = 'https://docs.google.com/document/d/batch-own-plan';
const CLIENT_URL = 'https://docs.google.com/document/d/client-standing-plan';

(async () => {
  let r = await resolveFilmingPlan('', CLIENT_URL);
  ok(r.filmingPlan === CLIENT_URL && r.filmingPlanFromClient === true,
    "THE REPORT: a batch with no plan of its own now answers with the CLIENT's plan instead of `Missing`");
  ok(r.calls.length === 1 && r.calls[0] === 'acme',
    'and it asks for THAT batch\'s client, once');

  r = await resolveFilmingPlan(BATCH_URL, CLIENT_URL);
  ok(r.filmingPlan === BATCH_URL && r.filmingPlanFromClient === false,
    'a batch that names its own plan keeps it -- the specific is never replaced by the general, and one client can run more than one shoot');
  ok(r.calls.length === 0,
    'and the client is never queried for it: one extra read per EMPTY row, not per row');

  r = await resolveFilmingPlan('   ', CLIENT_URL);
  ok(r.filmingPlan === CLIENT_URL && r.filmingPlanFromClient === true,
    'a whitespace-only column is empty, not a plan -- it is `clean`ed before the decision, not truthiness-tested');

  r = await resolveFilmingPlan('', '');
  ok(r.filmingPlan === '' && r.filmingPlanFromClient === false,
    'a client with no plan on file still reports nothing, and does not claim a derived source for a blank');

  r = await resolveFilmingPlan('', CLIENT_URL, '');
  ok(r.filmingPlan === '' && r.filmingPlanFromClient === false && r.calls.length === 0,
    'a batch with no client_slug is not looked up at all -- an unscoped filming-plan query is the one shape this must never make');

/* ---- 2. The shipped function has that exact shape ----------------------- */

ok(/let filmingPlan = postFilmingPlan\.value;/.test(snapshot),
  "the plan the POST resolved is read first -- `batch.filming_doc_url` where this row's own batch has one, else the same column off another batch row of the post");
ok(/if \(!filmingPlan && batchClient\) \{/.test(snapshot),
  'the client lookup is reached ONLY when the batch column is empty -- one extra query per empty row, never per row');
ok(/await clientFilmingPlanUrl\(supabase, batchClient\)/.test(snapshot),
  'and it reuses the same service-side helper the intake path uses, rather than a second query that could drift from it');
ok(snapshot.indexOf('let filmingPlan = postFilmingPlan.value;') < snapshot.indexOf('const values'),
  'the resolution happens before `values` is built, so the probe and the evidence row both see the resolved URL');
ok(/filming_plan: filmingPlan,/.test(snapshot),
  'and `values.filming_plan` carries the resolved value rather than the raw column');

/* The batch row already selected client_slug for other reasons. If that ever
   drops out of the projection the fallback silently stops firing, which would
   look exactly like the bug this fixes. */
/* The column list became a named constant on 2026-09-01, when a second query
   started reading the same shape; `updated_at` joined it on 2026-09-05 as the
   CAS clock the browser writes the post's canonical row against. Asserting the
   constant's VALUE keeps this about the same fact -- client_slug is still
   selected, and every batch read takes exactly the columns this fallback and
   that write target need. */
ok(/const BATCH_ASSET_COLUMNS =\s*\n?\s*"id,client_slug,team,updated_at,filming_doc_url,footage_folder_url,delivery_folder_url";/.test(GATEWAY),
  'the batch projection still carries client_slug, which the fallback needs and which no error would announce the loss of');
ok((snapshot.match(/BATCH_ASSET_COLUMNS/g) || []).length >= 2,
  'and both batch reads use that one list, so a column added for one of them cannot go missing from the other');

/* ---- 3. A derived value says it is derived ----------------------------- */

ok(/filmingPlanFromClient\s*\?\s*\{ source: "client_plan" \}/.test(snapshot.replace(/\s+/g, ' '))
  || /\{ source: "client_plan" \}/.test(snapshot),
  'the derived case reports `source: "client_plan"`, the same way a borrowed deliverable file already reports its card');
ok(!/source: "batch"/.test(snapshot),
  'and the ORDINARY case reports no source -- relabelling every row in the estate to say what it has always meant is not an improvement');
ok(/'deliverable','calendar_card','samples_card','client_plan'/.test(INDEX),
  'the browser accepts `client_plan` in the closed source vocabulary, so the value is not dropped on the way to the page');
ok(/asset\.source === 'client_plan'/.test(INDEX)
  && /prod-asset-origin">from the client</.test(INDEX),
  'and renders it as "from the client" -- this slot has no Edit control, so the label is the only place the reader can learn where the link came from');

/* ---- 4. STILL NOT WRITABLE. Three refusals, none touched --------------- */

ok(!/BATCH_ASSET_SLOTS[\s\S]{0,400}filming/.test(GATEWAY),
  'the filming plan is still absent from BATCH_ASSET_SLOTS, so the gateway accepts no write naming it');
ok(/\{ key: 'filming_plan', label: 'Filming plan' \}/.test(INDEX),
  "and still has no `write` key in PROD_ASSET_SPECS, so the browser renders no Edit control at all rather than a disabled one");
ok(/batch_asset_slot_unsupported/.test(INDEX),
  'the refusal for a slot the UI never offers is still classified as a malformed request, not as a permission the reader lacks');

/* The helper is shared now. Both callers want the same one fact, and both must
   keep degrading to a blank: an unestablished plan is not an absent plan. */
const helper = grabFunc(GATEWAY, 'clientFilmingPlanUrl');
ok(/\.eq\("client_slug", clientSlug\)/.test(helper) && /maybeSingle\(\)/.test(helper),
  'the helper still resolves by client slug service-side -- filming plan Doc URLs are unreadable to every browser key');
ok(/return "";/.test(helper) && !/throw/.test(helper),
  'and still returns a blank on every failure rather than throwing, so a lookup blip cannot 503 the whole asset panel');
ok(!/intakeFilmingPlanForClient/.test(GATEWAY),
  'the old intake-only name is gone rather than left aliased, since a name that says `intake` on a shared helper is the next reader misled');

  /* ---- 5. SYNTHETIC BATCH PARENTS reach this through the borrow ----------
     Raised by review on this PR as a gap: a synthetic parent returns early from
     `_prodEnsureAssets`, and the browser projection deliberately seeds its four
     slots from a batch row whose asset columns the browser key cannot read --
     both true, and both the reason the panel does not render the parent's own
     asset state at all. It renders the CHILD's. `_prodBatchAssetSource` picks a
     readable child of the same batch, the render loop ensures THAT id, and the
     panel is called with `batchAssetSource || d`. The three post-level slots --
     filming plan, raw footage, frame folder -- come off the shared batch row,
     so the child's answer IS the parent's, and the client fallback added here
     rides in with it for free.
     Asserted rather than argued, because the whole gateway-side fix reaches
     that surface only through this borrow, and a refactor that dropped it would
     silently re-open the bug on 199 rows with nothing failing. The residual
     case is unchanged and deliberate: with NO qualifying child the parent keeps
     the honest `Unavailable` hedge rather than inventing an answer. */
  ok(/_prodAssetsPanelHTML\(batchAssetSource \|\| d,/.test(INDEX),
    'a synthetic batch parent renders the panel against the borrowed CHILD, so the client fallback reaches it without a parent-scoped read');
  ok(/if \(batchAssetSource\) _prodEnsureAssets\(batchAssetSource\.id, false\)/.test(INDEX),
    'and the render loop ensures that child, so the read carrying the derived plan is actually asked for');

  console.log(failures === 0
    ? '\nfilming plan from client checks passed'
    : '\n' + failures + ' filming plan check(s) failed');
  process.exit(failures === 0 ? 0 : 1);
})();
