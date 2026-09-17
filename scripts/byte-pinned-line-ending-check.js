'use strict';
/*
 * THE WHITESPACE CHECK CANNOT SEE THESE FILES. THAT IS WHY THIS EXISTS.
 *
 * `git diff --check` is the repo's whitespace gate. It is a linter for
 * whitespace in ADDED lines, and it honours `.gitattributes`. Both of those
 * facts combine badly on the handful of paths this estate pins as exact bytes:
 *
 *   qa/linear-exit-rehearsal/serving/samples-v50/**            -text
 *   qa/linear-exit-rehearsal/serving/sql/calendar-merge-comments.sql
 *                                              -text whitespace=cr-at-eol
 *
 * Those pins exist because the files are CAPTURED EVIDENCE of what a server
 * actually served, CR bytes included. `-text` tells git not to normalize them;
 * `whitespace=cr-at-eol` tells the checker that a CR at end of line is not an
 * error there. The pin that protects the bytes is the same pin that blinds the
 * gate to them.
 *
 * MEASURED 2026-09-16, on this branch, as a real reproduction and not a
 * theory. Flipping every CRLF to LF in
 * `qa/linear-exit-rehearsal/serving/sql/calendar-merge-comments.sql` changed
 * 13 lines and dropped 13 bytes. `git diff --check` printed nothing and exited
 * 0. Only `git diff --stat` showed anything at all, and what it showed -- "13
 * insertions, 13 deletions" -- looks like an ordinary edit, not like evidence
 * being silently rewritten by a checkout on a machine with
 * core.autocrlf=true.
 *
 * WHAT THIS SCRIPT ASSERTS. For every byte-pinned file a change touches: its
 * line-ending composition (CRLF count, lone LF count, lone CR count) must be
 * the same on both sides of the diff. A capture's line endings are part of the
 * capture. Content may legitimately change when the evidence is re-captured;
 * line endings changing WITHOUT the content changing is never legitimate, and
 * line endings changing at all on a pinned path is something a reviewer has to
 * see rather than have normalized away underneath them.
 *
 * DRIVEN OFF `.gitattributes` ITSELF, never off a list in here. A second list
 * of pinned paths would be one more thing to forget to update, and it would
 * drift from the pins it is supposed to be shadowing. The set is resolved with
 * `git check-attr`, so this script is correct by construction the day someone
 * adds a new `-text` pin and does not think about this file.
 *
 * TWO MODES.
 *
 *   --diff=<ref>   compare each touched byte-pinned file against <ref>. This is
 *                  the gate. It reads COMMITTED work, like
 *                  repo-identity-exposure-check.js does, so commit first.
 *   (default)      inventory every byte-pinned file in the tree and print its
 *                  composition. Always exits 0. The standing measurement.
 *
 * ESCAPE HATCH, deliberately explicit. A genuine re-capture that legitimately
 * changes line endings is acknowledged per path with
 * `--accept-recapture=<path>`, repeatable. There is no blanket flag and no
 * environment variable, because the whole point is that a person named the
 * file.
 *
 * READ-ONLY. It runs git plumbing and reads blobs. It writes nothing and it
 * touches neither the working tree nor the index.
 */

const cp = require('child_process');

function git(args, opts = {}) {
  const r = cp.spawnSync('git', args, { maxBuffer: 1 << 28, ...opts });
  if (r.status !== 0) {
    const msg = (r.stderr || Buffer.alloc(0)).toString('utf8').trim();
    throw new Error('git ' + args.join(' ') + ' failed: ' + (msg || 'exit ' + r.status));
  }
  return r.stdout;
}

function gitText(args, opts) {
  return git(args, opts).toString('utf8');
}

/* Byte-pinned == `-text` (text: unset), or an explicit cr-at-eol whitespace
 * pin. Resolved by git so glob semantics are git's, not a reimplementation. */
function bytePinned(paths) {
  if (!paths.length) return [];
  const input = paths.join('\0') + '\0';
  const out = gitText(['check-attr', '--stdin', '-z', 'text', 'whitespace'], { input });
  const fields = out.split('\0');
  const state = new Map();
  for (let i = 0; i + 2 < fields.length; i += 3) {
    const [path, attr, value] = [fields[i], fields[i + 1], fields[i + 2]];
    if (!path) continue;
    const s = state.get(path) || {};
    s[attr] = value;
    state.set(path, s);
  }
  const pinned = [];
  for (const [path, s] of state) {
    if (s.text === 'unset' || (s.whitespace || '').split(',').includes('cr-at-eol')) pinned.push(path);
  }
  return pinned.sort();
}

function compose(buf) {
  if (buf.includes(0)) return null; /* real binary: line endings are not a concept */
  let crlf = 0, lf = 0, cr = 0;
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] === 0x0a) { if (i > 0 && buf[i - 1] === 0x0d) crlf++; else lf++; }
    else if (buf[i] === 0x0d && buf[i + 1] !== 0x0a) cr++;
  }
  return { crlf, lf, cr, bytes: buf.length };
}

function sameComposition(a, b) {
  return a.crlf === b.crlf && a.lf === b.lf && a.cr === b.cr;
}

function describe(c) {
  return c.crlf + ' CRLF, ' + c.lf + ' LF, ' + c.cr + ' lone CR, ' + c.bytes + ' bytes';
}

function blobAt(ref, path) {
  const r = cp.spawnSync('git', ['cat-file', 'blob', ref + ':' + path], { maxBuffer: 1 << 28 });
  return r.status === 0 ? r.stdout : null;
}

function main(argv) {
  let base = null, json = false;
  const accepted = new Set();
  for (const arg of argv) {
    if (arg.startsWith('--diff=')) base = arg.slice(7);
    else if (arg.startsWith('--accept-recapture=')) accepted.add(arg.slice(19));
    else if (arg === '--json') json = true;
    else { process.stderr.write('unknown argument: ' + arg + '\n'); return 2; }
  }

  const tracked = gitText(['ls-files', '-z']).split('\0').filter(Boolean);
  const pinned = new Set(bytePinned(tracked));

  if (!base) {
    const rows = [];
    for (const path of [...pinned].sort()) {
      const c = compose(blobAt('HEAD', path) || Buffer.alloc(0));
      rows.push({ path, composition: c });
    }
    if (json) process.stdout.write(JSON.stringify({ mode: 'inventory', pinned: rows.length, rows }, null, 2) + '\n');
    else {
      process.stdout.write(rows.length + ' byte-pinned file(s) under .gitattributes -text / cr-at-eol pins\n');
      for (const r of rows) process.stdout.write('  ' + r.path + ': ' + (r.composition ? describe(r.composition) : 'binary') + '\n');
    }
    return 0;
  }

  const changed = gitText(['diff', '--name-only', '-z', base + '...HEAD'])
    .split('\0').filter(Boolean).filter((p) => pinned.has(p));

  const findings = [], notes = [];
  for (const path of changed) {
    const before = blobAt(base, path), after = blobAt('HEAD', path);
    if (before === null) { notes.push({ path, note: 'added on this branch; nothing pinned to compare against' }); continue; }
    if (after === null) { notes.push({ path, note: 'deleted on this branch' }); continue; }
    const b = compose(before), a = compose(after);
    if (!b || !a) { notes.push({ path, note: 'binary content; line endings not applicable' }); continue; }
    if (sameComposition(b, a)) continue;
    if (accepted.has(path)) { notes.push({ path, note: 'line endings changed; accepted as a re-capture by --accept-recapture' }); continue; }
    findings.push({
      path,
      before: b,
      after: a,
      content_identical_apart_from_line_endings:
        before.toString('binary').replace(/\r\n/g, '\n') === after.toString('binary').replace(/\r\n/g, '\n'),
    });
  }

  if (json) {
    process.stdout.write(JSON.stringify({ mode: 'diff', base, pinned: pinned.size, examined: changed.length, findings, notes }, null, 2) + '\n');
  } else {
    process.stdout.write('byte-pinned line endings vs ' + base + ': ' + pinned.size + ' pinned, ' + changed.length + ' touched by this change\n');
    /* Notes are counted, not listed: on a branch that adds 90-odd pinned files
     * a per-file note buries the one line that matters. --json has them all. */
    const byNote = new Map();
    for (const n of notes) byNote.set(n.note, (byNote.get(n.note) || 0) + 1);
    for (const [note, n] of byNote) process.stdout.write('  note  ' + n + ' file(s): ' + note + '\n');
    for (const f of findings) {
      process.stdout.write('  FAIL  ' + f.path + '\n');
      process.stdout.write('        was ' + describe(f.before) + '\n');
      process.stdout.write('        now ' + describe(f.after) + '\n');
      process.stdout.write('        ' + (f.content_identical_apart_from_line_endings
        ? 'Content is otherwise IDENTICAL. This is a line-ending flip, not an edit -- almost'
          + ' certainly a checkout with core.autocrlf=true, never something to commit.'
        : 'Content changed too. If this is a deliberate re-capture, re-run with'
          + ' --accept-recapture=' + f.path) + '\n');
    }
    if (!findings.length) process.stdout.write('  OK    no byte-pinned file changed its line-ending composition\n');
  }
  return findings.length ? 1 : 0;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));
module.exports = { bytePinned, compose, sameComposition, main };
