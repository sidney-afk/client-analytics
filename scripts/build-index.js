'use strict';
/*
 * build-index.js — assembles index.html from src/index/ fragments.
 *
 * Reads src/index/manifest.txt (one fragment filename per line, in
 * concatenation order), reads each fragment as a raw Buffer directly from
 * src/index/, concatenates them with NO separators, and writes the result to
 * index.html at the repository root. It never decodes, trims, reformats or
 * adds/removes bytes: the output is exactly the concatenation of the listed
 * fragment bytes, in listed order.
 *
 * It also (re)generates the navigation map at src/index/INDEX.md — one row
 * per manifest fragment, in manifest order:
 *
 *   Order | Fragment | Lines | Banner
 *
 * Line count = the number of LF-delimited lines in the fragment, plus one
 * more if the fragment has trailing bytes after the last LF (a final
 * unterminated but nonempty line). An empty fragment counts as 0 lines.
 *
 * Banner = the fragment's first "banner" comment, found by scanning the
 * fragment's raw text for the EARLIEST of these three standalone forms
 * (whichever starts first, source order):
 *   1. an HTML comment `<!-- ... -->` whose `<!--` is standalone (only
 *      whitespace precedes it on its line);
 *   2. a block comment `/* ... *(/` whose opener is standalone the same way;
 *   3. a "decorated" `//` line comment — a `//` line whose content contains
 *      a run of 3+ repeated decoration characters from `-=─*#` (this is what
 *      separates a section banner like `// ── Foo ──` from an ordinary
 *      explanatory `//` remark, which is never a banner).
 * From the winning comment, take its first nonempty line of text (for a
 * multi-line HTML/block comment, the first nonempty line inside it; for a
 * decorated `//` banner, that line's own text, or the next `//` line's text
 * if the banner line carries only decoration), strip leading/trailing
 * decoration/comment punctuation and whitespace, strip ISO-ish timestamps,
 * and escape Markdown table characters. A fragment with no such comment gets
 * an em dash (—). This rule needs no source edits to fragments that lack a
 * banner — it is a narrow "best guess", not a fragment content requirement.
 *
 * manifest.txt and INDEX.md are metadata: never part of the assembled output
 * and never subject to fragment coverage checks.
 *
 * Usage: node scripts/build-index.js
 */

const fs = require('fs');
const path = require('path');
const { readModuleList, servedBytes } = require('./index-modules');

const ROOT = path.resolve(__dirname, '..');
const SRC_DIR = path.join(ROOT, 'src', 'index');
const MANIFEST_PATH = path.join(SRC_DIR, 'manifest.txt');
const OUTPUT_PATH = path.join(ROOT, 'index.html');
const INDEX_MD_PATH = path.join(SRC_DIR, 'INDEX.md');

function fail(message) {
  console.error('build-index: ' + message);
  process.exit(1);
}

function readManifest() {
  if (!fs.existsSync(MANIFEST_PATH)) fail('manifest not found at src/index/manifest.txt');
  const raw = fs.readFileSync(MANIFEST_PATH, 'utf8');
  return raw.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0);
}

function validateManifest(entries) {
  const seen = new Set();
  for (const entry of entries) {
    if (entry.includes('/') || entry.includes('\\') || entry === '..' || entry.includes('..')) {
      fail('out-of-folder fragment path in manifest: ' + entry);
    }
    if (seen.has(entry)) fail('duplicate fragment in manifest: ' + entry);
    seen.add(entry);
    const fragPath = path.join(SRC_DIR, entry);
    if (path.dirname(fragPath) !== SRC_DIR) fail('out-of-folder fragment path in manifest: ' + entry);
    if (!fs.existsSync(fragPath)) fail('missing fragment listed in manifest: ' + entry);
  }

  const onDisk = fs.readdirSync(SRC_DIR).filter((f) => f.endsWith('.part'));
  for (const f of onDisk) {
    if (!seen.has(f)) fail('unlisted fragment present in src/index/ but not in manifest.txt: ' + f);
  }
}

function countLines(buf) {
  let count = 0;
  let lastNewlineEnd = 0;
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] === 0x0a) {
      count++;
      lastNewlineEnd = i + 1;
    }
  }
  if (lastNewlineEnd < buf.length) count++;
  return count;
}

function isStandaloneAt(text, idx) {
  let i = idx;
  while (i > 0 && text[i - 1] !== '\n') i--;
  return /^[ \t]*$/.test(text.slice(i, idx));
}

function firstStandalone(text, token) {
  let i = -1;
  while ((i = text.indexOf(token, i + 1)) !== -1) {
    if (isStandaloneAt(text, i)) return i;
  }
  return -1;
}

function stripDecoration(line) {
  return line.replace(/^[\s*\-=─#>]+/, '').replace(/[\s*\-=─#<]+$/, '').trim();
}

function stripTimestamps(text) {
  return text.replace(/\b\d{4}-\d{2}-\d{2}(?:[T ][\d:]+Z?)?\b/g, '').replace(/\s{2,}/g, ' ').trim();
}

function escapeMarkdownTableText(text) {
  return text.replace(/\\/g, '\\\\').replace(/\|/g, '\\|');
}

function extractDelimitedBanner(text, openIdx, openTok, closeTok) {
  const closeIdx = text.indexOf(closeTok, openIdx + openTok.length);
  const body = closeIdx === -1 ? text.slice(openIdx + openTok.length) : text.slice(openIdx + openTok.length, closeIdx);
  for (const rawLine of body.split('\n')) {
    const stripped = stripDecoration(rawLine.trim());
    if (stripped) return stripped;
  }
  return null;
}

function extractLineBanner(text, startIdx) {
  const firstLineEnd = text.indexOf('\n', startIdx);
  const firstLine = firstLineEnd === -1 ? text.slice(startIdx) : text.slice(startIdx, firstLineEnd);
  let content = stripDecoration(firstLine.replace(/^[ \t]*\/\//, '').trim());
  if (content) return content;

  let cursor = firstLineEnd;
  while (cursor !== -1) {
    const nextEnd = text.indexOf('\n', cursor + 1);
    const nextLine = nextEnd === -1 ? text.slice(cursor + 1) : text.slice(cursor + 1, nextEnd);
    if (!/^[ \t]*\/\//.test(nextLine)) break;
    const stripped = stripDecoration(nextLine.replace(/^[ \t]*\/\//, '').trim());
    if (stripped) return stripped;
    cursor = nextEnd;
  }
  return null;
}

function extractBanner(buf) {
  const text = buf.toString('utf8');

  const htmlIdx = firstStandalone(text, '<!--');
  const blockIdx = firstStandalone(text, '/*');
  const lineMatch = /^[ \t]*\/\/.*[-=─*#]{3,}.*$/m.exec(text);
  const lineIdx = lineMatch ? lineMatch.index : -1;

  const candidates = [
    htmlIdx === -1 ? null : { type: 'html', idx: htmlIdx },
    blockIdx === -1 ? null : { type: 'block', idx: blockIdx },
    lineIdx === -1 ? null : { type: 'line', idx: lineIdx },
  ].filter(Boolean);
  if (candidates.length === 0) return '—';

  candidates.sort((a, b) => a.idx - b.idx);
  const winner = candidates[0];

  let banner = null;
  if (winner.type === 'html') banner = extractDelimitedBanner(text, winner.idx, '<!--', '-->');
  else if (winner.type === 'block') banner = extractDelimitedBanner(text, winner.idx, '/*', '*/');
  else banner = extractLineBanner(text, winner.idx);

  if (!banner) return '—';
  const cleaned = escapeMarkdownTableText(stripTimestamps(banner));
  return cleaned || '—';
}

function buildIndexMd(entries, fragmentBufs) {
  const rows = entries.map((entry, i) => {
    const buf = fragmentBufs[i];
    const lines = countLines(buf);
    const banner = extractBanner(buf);
    return `| ${i + 1} | \`${entry}\` | ${lines} | ${banner} |`;
  });
  return [
    '<!-- Generated by `npm run build:index`. Do not hand-edit — edit the fragments -->',
    '<!-- under src/index/ and rerun `npm run build:index`; see the derivation rule -->',
    '<!-- documented at the top of scripts/build-index.js. -->',
    '',
    '# src/index/ fragment map',
    '',
    '| Order | Fragment | Lines | Banner |',
    '|---|---|---|---|',
    ...rows,
    '',
  ].join('\n');
}

function main() {
  const entries = readManifest();
  if (entries.length === 0) fail('manifest is empty');
  validateManifest(entries);

  const fragmentBufs = entries.map((entry) => fs.readFileSync(path.join(SRC_DIR, entry)));
  // Fragments listed in modules.txt are written as ES modules; the page gets
  // them with their import header and export footer removed (see
  // scripts/index-modules.js). INDEX.md still describes the fragment as written.
  const modules = readModuleList(SRC_DIR);
  for (const m of modules) if (!entries.includes(m)) fail('modules.txt lists a fragment that is not in the manifest: ' + m);
  const assembled = Buffer.concat(entries.map((entry, i) => servedBytes(entry, fragmentBufs[i], modules)));
  fs.writeFileSync(OUTPUT_PATH, assembled);

  const indexMd = buildIndexMd(entries, fragmentBufs);
  fs.writeFileSync(INDEX_MD_PATH, indexMd);

  console.log('build-index: wrote index.html (' + assembled.length + ' bytes) from ' + entries.length + ' fragment(s)');
  console.log('build-index: wrote src/index/INDEX.md');
}

main();
