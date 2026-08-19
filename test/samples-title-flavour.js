'use strict';
/*
 * Samples titles say they are samples (owner ruling 2026-08-19: "the title of
 * the parent issue and the sub issues should mention that it's a sample, so
 * Sample Video 1 and Sample Thumbnail 1").
 *
 * The prefix rides the SAME value at every layer that the purpose/origin
 * agreement rides, so a title can never disagree with the batch it lands in:
 *   browser  -> _linearIntakeItems / _linearIntakeBatchTitle take the surface
 *   gateway  -> the row builder and append planner take intakePurpose / the
 *               batch's purpose
 *   RPC (v6) -> the expected-title check derives the prefix from
 *               coalesce(v_batch.purpose, 'calendar')
 *
 * The transition case is load-bearing: the first live samples batch predates
 * the ruling and its children read 'Video 1' / 'Thumbnail 1'. The base-ordinal
 * count therefore accepts the optional prefix, so that batch's next append is
 * 'Sample Video 2' -- numbering continues, it does not restart at 1.
 */

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const edge = fs.readFileSync(path.join(ROOT, 'supabase', 'functions', 'production-write', 'index.ts'), 'utf8');
const v6 = fs.readFileSync(path.join(ROOT, 'migrations', '2026-08-19-production-intake-append-v6.sql'), 'utf8');
const v5 = fs.readFileSync(path.join(ROOT, 'migrations', '2026-08-19-production-intake-append-v5.sql'), 'utf8');
let failures = 0;
function ok(value, label) {
  if (value) console.log('  ok  ' + label);
  else { failures++; console.error('FAIL  ' + label); }
}

function extract(name) {
  const marker = 'function ' + name + '(';
  let start = source.indexOf(marker);
  if (start < 0) throw new Error('missing ' + name);
  if (source.slice(start - 6, start) === 'async ') start -= 6;
  const brace = source.indexOf('{', start);
  let depth = 0, quote = '', escaped = false, line = false, block = false;
  for (let i = brace; i < source.length; i++) {
    const ch = source[i];
    if (line) { if (ch === '\n') line = false; continue; }
    if (block) { if (ch === '*' && source[i + 1] === '/') { block = false; i++; } continue; }
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '/' && source[i + 1] === '/') { line = true; i++; continue; }
    if (ch === '/' && source[i + 1] === '*') { block = true; i++; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error('unclosed ' + name);
}

(async () => {
  const policy = await import(pathToFileURL(path.join(
    ROOT, 'supabase', 'functions', 'production-write', 'policy.mjs',
  )).href);

  // --- the append planner, executed ----------------------------------------
  const transitionBatch = [
    { id: 'old-v', team: 'video', card_id: 'c1', title: 'Video 1', sort_key: 0 },
    { id: 'old-g', team: 'graphics', card_id: 'c1', title: 'Thumbnail 1', sort_key: 0 },
  ];
  const pair = [
    { team: 'video', card_id: 'c2' },
    { team: 'graphics', card_id: 'c2' },
  ];
  const samples = policy.planAppendIntakeItems(transitionBatch, pair, ['nv', 'ng'], 'samples');
  ok(samples[0].title === 'Sample Video 2' && samples[1].title === 'Sample Thumbnail 2',
  'a samples-batch append is titled Sample Video / Sample Thumbnail');
  ok(samples[0]._intake_ordinal === 2,
  'the TRANSITION batch (pre-ruling unprefixed children) continues at 2 -- numbering never restarts');

  const prefixedBatch = [
    { id: 's-v', team: 'video', card_id: 'c1', title: 'Sample Video 3', sort_key: 2 },
  ];
  const next = policy.planAppendIntakeItems(prefixedBatch, pair, ['nv', 'ng'], 'samples');
  ok(next[0].title === 'Sample Video 4' && next[0]._intake_ordinal === 4,
  'prefixed titles advance the base ordinal too');

  const calendar = policy.planAppendIntakeItems(transitionBatch, pair, ['nv', 'ng'], 'calendar');
  ok(calendar[0].title === 'Video 2' && calendar[1].title === 'Thumbnail 2',
  'a calendar batch is byte-identical to before');
  const legacyCall = policy.planAppendIntakeItems(transitionBatch, pair, ['nv', 'ng']);
  ok(legacyCall[0].title === 'Video 2',
  'a caller that never passes purpose gets calendar behaviour -- the param is safely optional');

  // --- the browser items builder, executed ----------------------------------
  const items = new Function('PROD_CREATED_STATUS', '_linearVideoBrief',
    extract('_linearIntakeItems') + ' return _linearIntakeItems;')('in_progress', () => '');
  const sxrItems = items('both', [{ number: 1 }], 'req_abc123', 'sxr');
  ok(sxrItems[0].title === 'Sample Video 1',
  'the samples dialog sends Sample Video 1');
  ok(!('title' in sxrItems[1]),
  'the graphics half still carries no title -- the gateway composes it, same as the calendar');
  const calItems = items('both', [{ number: 1 }], 'req_abc123', 'calendar');
  ok(calItems[0].title === 'Video 1',
  'the calendar dialog is unchanged');

  // --- the batch / parent-issue name ----------------------------------------
  const RealDate = Date;
  const batchTitle = new Function('Date', extract('_linearIntakeBatchTitle') + ' return _linearIntakeBatchTitle;')(RealDate);
  ok(/ · Samples · /.test(batchTitle('Doug Cartwright', 'sxr')),
  'a samples batch name (and therefore the Linear PARENT title) says Samples');
  ok(!/Samples/.test(batchTitle('Doug Cartwright', 'calendar')) && !/Samples/.test(batchTitle('Doug Cartwright')),
  'calendar batch names are unchanged, with or without the new argument');

  // --- the gateway row builder ----------------------------------------------
  ok(/const intakeTitlePrefix = intakePurpose === "samples" \? "Sample " : "";/.test(edge)
    && /`\$\{intakeTitlePrefix\}Video \$\{videoNumber\}`/.test(edge)
    && /`\$\{intakeTitlePrefix\}Thumbnail \$\{videoNumber\}`/.test(edge),
  'the gateway derives the title prefix from intakePurpose -- the same value that stamps purpose and origin');
  ok(/planAppendIntakeItems\(appendBatchRows, items, deliverableIds,\s*\n?\s*clean\(appendBatch && \(appendBatch as JsonMap\)\.purpose\)\)/.test(edge),
  'the append planner receives the BATCH\'s purpose, not the surface');

  // --- v6: one flavour change, nothing else ----------------------------------
  ok(/coalesce\(v_batch\.purpose, 'calendar'\) = 'samples' then 'Sample ' else ''/.test(v6),
  'the RPC derives the prefix from the batch purpose');
  ok(/\(\?:Sample \)\?\(\?:Video\|Thumbnail\)/.test(v6),
  'the RPC base-ordinal count accepts the optional prefix (the transition batch)');
  function fnBody(text) { return text.slice(text.indexOf('begin;')); }
  const strip = text => text.split('\n').filter(line => !/^\s*--/.test(line)).map(l => l.trim());
  // Line-set diff instead of whitespace-sensitive string surgery: every line
  // that differs between v5 and v6 must be one of the KNOWN title edits.
  const a = strip(fnBody(v5));
  const b = strip(fnBody(v6));
  const count = list => { const m = new Map(); for (const l of list) m.set(l, (m.get(l) || 0) + 1); return m; };
  const ca = count(a), cb = count(b);
  const removed = [...ca].filter(([l, n]) => (cb.get(l) || 0) < n).map(([l]) => l);
  const added = [...cb].filter(([l, n]) => (ca.get(l) || 0) < n).map(([l]) => l);
  const expectedRemoved = new Set([
    "select coalesce(max(substring(d.title from '^(?:Video|Thumbnail) ([1-9][0-9]*)$')::integer), 0)",
    "and d.title ~ '^(?:Video|Thumbnail) [1-9][0-9]*$'",
    "or item->>'title' is distinct from (case",
    "end)",
  ]);
  const expectedAdded = new Set([
    "select coalesce(max(substring(d.title from '^(?:Sample )?(?:Video|Thumbnail) ([1-9][0-9]*)$')::integer), 0)",
    "and d.title ~ '^(?:Sample )?(?:Video|Thumbnail) [1-9][0-9]*$'",
    "or item->>'title' is distinct from (",
    "(case when coalesce(v_batch.purpose, 'calendar') = 'samples' then 'Sample ' else '' end)",
    "|| (case",
    "end)",
    ")",
  ]);
  ok(removed.length > 0 && removed.every(l => expectedRemoved.has(l))
    && added.length > 0 && added.every(l => expectedAdded.has(l)),
  'every line that differs from the applied v5 is one of the known title edits -- nothing rode along'
    + (removed.every(l => expectedRemoved.has(l)) && added.every(l => expectedAdded.has(l)) ? ''
      : ' [unexpected: ' + JSON.stringify({ removed: removed.filter(l => !expectedRemoved.has(l)), added: added.filter(l => !expectedAdded.has(l)) }) + ']'));
  ok(/SUPERSEDES migrations\/2026-08-19-production-intake-append-v5\.sql/.test(v6),
  'v6 names the migration it supersedes');

  if (failures) process.exit(1);
  console.log('\nSamples title flavour checks passed');
})().catch(error => { console.error('threw: ' + error.message); process.exit(1); });
