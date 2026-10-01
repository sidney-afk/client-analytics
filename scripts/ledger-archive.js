#!/usr/bin/env node
'use strict';
/*
 * ledger-archive.js -- move old entries out of the two long ledgers without
 * changing a word of them.
 *
 *   node scripts/ledger-archive.js log            # what would move (EXECUTION_LOG.md)
 *   node scripts/ledger-archive.js repairs        # what would move (docs/ops/OPEN_REPAIRS.md)
 *   node scripts/ledger-archive.js log --apply    # do it
 *   node scripts/ledger-archive.js log --check    # verify links, anchors and the word-for-word rebuild
 *   options: --cutoff=YYYY-MM-DD (default: today minus 60 days; entries dated BEFORE it move)
 *            --keep=<heading or heading start> (repeatable) leaves that entry where it is. Used for entries
 *            whose lines the identity gate would flag as new in a new file: the gate has no exemption for a
 *            move between ledgers and this tool does not widen it.
 *
 * An entry is one "## " section. Its date is the first YYYY-MM-DD in its
 * heading. A heading with no date never moves (the tool cannot tell its age).
 * Each moved entry goes, verbatim, into <archive dir>/<YYYY-MM>.md, and the main
 * file keeps ONE line in its place: the heading text plus a link to the entry.
 * Entry numbers and headings are never edited, so "OPEN_REPAIRS 215" still
 * names the same entry and the summary line still carries the number.
 *
 * rebuild() puts every summary line back to the verbatim entry; the test and
 * --check use it to prove nothing was lost or changed.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const LEDGERS = {
  log: { file: 'EXECUTION_LOG.md', dir: 'docs/ops/execution-log-archive', title: 'Execution log archive' },
  repairs: { file: 'docs/ops/OPEN_REPAIRS.md', dir: 'docs/ops/repairs-archive', title: 'Open repairs archive' },
};
const MARK = '- Archived entry: ';
const LINK = /\(\[read it\]\(([^)#]+)#([^)]+)\)\)$/;

// GitHub's heading anchor: lower case, drop punctuation, spaces to hyphens.
function slugOf(text) {
  return text.trim().toLowerCase().replace(/[^\p{L}\p{N}\p{M}\- _]/gu, '').replace(/ /g, '-');
}

// Split into { pre: lines before the first entry, entries: [{ heading, lines }] }.
// "## " inside a code fence is not a heading.
function parse(text) {
  const lines = text.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  const pre = []; const entries = []; let fence = false; let cur = null;
  for (const line of lines) {
    if (/^(```|~~~)/.test(line)) fence = !fence;
    if (!fence && line.startsWith('## ')) { cur = { heading: line.slice(3), lines: [line] }; entries.push(cur); continue; }
    (cur ? cur.lines : pre).push(line);
  }
  return { pre, entries };
}
const join = lines => lines.join('\n') + '\n';

function dateOf(heading) { const m = heading.match(/20\d\d-\d\d-\d\d/); return m ? m[0] : null; }

// slug -> entry, with GitHub's -1, -2 suffix for repeated headings.
function anchors(entries) {
  const seen = new Map(); const out = new Map();
  for (const e of entries) {
    const base = slugOf(e.heading); const n = seen.get(base) || 0; seen.set(base, n + 1);
    out.set(n ? base + '-' + n : base, e);
  }
  return out;
}

function archiveHeader(cfg, month) {
  return [
    '# ' + cfg.title + ', ' + month, '',
    'Entries moved here word for word from `' + cfg.file + '`. Nothing in them was edited. The main file keeps one line per moved entry that links here.',
    'Moved by `scripts/ledger-archive.js`; `node scripts/ledger-archive.js ' + (cfg === LEDGERS.log ? 'log' : 'repairs') + ' --check` proves the move lost nothing.', '',
  ];
}

// Plan and (optionally) write. Returns what moved.
function archive(kind, opts = {}) {
  const cfg = LEDGERS[kind]; const root = opts.root || ROOT;
  const file = path.join(root, cfg.file); const cutoff = opts.cutoff;
  const { pre, entries } = parse(fs.readFileSync(file, 'utf8'));
  const byMonth = new Map(); const main = [...pre]; let moved = 0;
  for (const e of entries) {
    const d = dateOf(e.heading);
    const held = (opts.keep || []).some(k => e.heading === k || e.heading.startsWith(k + ' '));
    if (held || !d || d >= cutoff) { main.push(...e.lines); continue; }
    const month = d.slice(0, 7);
    if (!byMonth.has(month)) byMonth.set(month, []);
    byMonth.get(month).push(e); moved++;
    main.push({ summary: e });
  }
  // Rewrite main with summary lines once the anchors are known.
  const archFile = month => path.join(root, cfg.dir, month + '.md');
  const slugsByMonth = new Map();
  for (const [month, list] of byMonth) {
    const p = archFile(month);
    let have = { pre: archiveHeader(cfg, month), entries: [] };
    if (fs.existsSync(p)) have = parse(fs.readFileSync(p, 'utf8'));
    const all = have.entries.concat(list);
    slugsByMonth.set(month, [...anchors(all)].filter(([, e]) => list.includes(e)));
    if (opts.apply) {
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, join([...have.pre, ...all.flatMap(e => e.lines)]));
    }
  }
  const out = [];
  for (const piece of main) {
    if (typeof piece === 'string') { out.push(piece); continue; }
    const e = piece.summary; const month = dateOf(e.heading).slice(0, 7);
    const slug = slugsByMonth.get(month).find(([, x]) => x === e)[0];
    out.push(MARK + e.heading + ' ([read it](' + path.posix.relative(path.posix.dirname(cfg.file), cfg.dir) + '/' + month + '.md#' + slug + '))');
  }
  if (opts.apply && moved) fs.writeFileSync(file, join(out));
  return { moved, months: [...byMonth].map(([m, l]) => [m, l.length]) };
}

// Put every summary line back to the verbatim entry. Returns the full text, or
// throws if a link or anchor does not resolve.
function rebuild(kind, root = ROOT) {
  const cfg = LEDGERS[kind];
  const lines = fs.readFileSync(path.join(root, cfg.file), 'utf8').split('\n');
  const trailing = lines[lines.length - 1] === ''; if (trailing) lines.pop();
  const cache = new Map(); const out = [];
  for (const line of lines) {
    if (!line.startsWith(MARK)) { out.push(line); continue; }
    const m = line.match(LINK); if (!m) throw new Error('unreadable summary line: ' + line.slice(0, 100));
    const target = path.posix.join(path.posix.dirname(cfg.file), m[1]);
    if (!cache.has(target)) {
      const p = path.join(root, target);
      if (!fs.existsSync(p)) throw new Error('link target missing: ' + target);
      cache.set(target, anchors(parse(fs.readFileSync(p, 'utf8')).entries));
    }
    const e = cache.get(target).get(m[2]);
    if (!e) throw new Error('anchor #' + m[2] + ' not found in ' + target);
    if (line !== MARK + e.heading + ' ([read it](' + m[1] + '#' + m[2] + '))') throw new Error('summary line does not match its entry heading: ' + line.slice(0, 100));
    out.push(...e.lines);
  }
  return out.join('\n') + (trailing ? '\n' : '');
}

module.exports = { slugOf, parse, anchors, dateOf, archive, rebuild, LEDGERS, MARK };

if (require.main === module) {
  const kind = process.argv[2]; const flags = process.argv.slice(3);
  if (!LEDGERS[kind]) { console.error('usage: ledger-archive.js log|repairs [--apply|--check] [--cutoff=YYYY-MM-DD]'); process.exit(2); }
  if (flags.includes('--check')) {
    const text = rebuild(kind);
    const names = parse(text).entries.map(e => e.heading);
    console.log(kind + ': ' + names.length + ' entries rebuild cleanly from the main file plus its archive; every link and anchor resolves');
    process.exit(0);
  }
  const keep = flags.filter(f => f.startsWith('--keep=')).map(f => f.slice(7));
  const arg = flags.find(f => f.startsWith('--cutoff='));
  let cutoff = arg && arg.slice(9);
  if (!cutoff) { const d = new Date(); d.setUTCDate(d.getUTCDate() - 60); cutoff = d.toISOString().slice(0, 10); }
  const r = archive(kind, { cutoff, keep, apply: flags.includes('--apply') });
  console.log((flags.includes('--apply') ? 'moved ' : 'would move ') + r.moved + ' ' + kind + ' entries dated before ' + cutoff + (r.months.length ? ': ' + r.months.map(([m, n]) => m + ' ' + n).join(', ') : ''));
}
