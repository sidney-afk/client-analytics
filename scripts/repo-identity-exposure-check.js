'use strict';
/*
 * THIS REPOSITORY IS PUBLIC, AND THE ROSTER IS IN IT.
 *
 * Measured 2026-09-02 against the live roster: 45 of the 50 identifying terms
 * on it -- 39 of the 47 client slugs and 6 team-member full names -- appear
 * somewhere in the tree, across 108 files.
 * Nobody decided that; it accumulated one audit, one migration and one ledger
 * entry at a time, each of which had a good local reason to name the client it
 * was about.
 *
 * WHAT THIS SCRIPT IS. A gate against GROWTH, which is the only part that can
 * be handled without an owner decision. It does not remove anything and it
 * cannot: the existing exposure is also in git history, so a repair is a
 * history rewrite (the estate has done one before --
 * docs/ops/GIT_HISTORY_PII_PURGE_2026-07-14.md) plus a judgement call about
 * which audits are worth keeping at all. Both are the owner's.
 *
 * What IS mechanical is stopping it getting worse, and that is what this does:
 * baseline today's count and fail above it.
 *
 * THE SCRIPT NEVER PRINTS WHAT IT FOUND. It reports counts and FILE PATHS and
 * nothing else -- no slug, no name, not in the text output and not in --json.
 * A leak detector whose own output is committed to CI logs, pasted into an
 * issue, or read by a screen-sharing session would be a second copy of exactly
 * the thing it exists to bound. To find the actual match, run the grep it
 * prints, locally.
 *
 * READ-ONLY in both directions. Public key, one roster read, no writes, and it
 * touches only the working tree.
 *
 * TWO MODES, because a tree baseline alone cannot do the job. Review on #1224
 * was right twice: `npm test` never invokes this script, so a change adding a
 * client identifier passes CI and becomes public before the exit status is ever
 * observed; and a baseline of TOTALS cannot see a SWAP -- replacing one
 * already-counted name with a new person's leaves every number where it was.
 *
 *   --diff=<ref>   scan only what a change ADDS (added lines and added file
 *                  paths) against no baseline at all. Anything found is new
 *                  exposure by definition. THIS IS WHAT CI RUNS, per pull
 *                  request, in `.github/workflows/calendar-unit-tests.yml`.
 *   (default)      scan the whole tree and gate on the baseline. The standing
 *                  measurement, for the scheduled watch.
 *
 * FILE PATHS ARE SCANNED TOO, in both modes. A file called
 * `docs/audits/2026-09-02-<client>-audit.md` whose body is generically worded
 * is exactly as public as one that says the name in a sentence, and `git grep`
 * does not look at path text.
 *
 *   node scripts/repo-identity-exposure-check.js [--baseline-files=N] [--diff=<ref>] [--json]
 *
 * Exits 1 above the baseline (or on anything at all in diff mode) so it can
 * gate; 0 otherwise.
 */
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const SUPA_URL = String(process.env.SUPABASE_URL || 'https://uzltbbrjidmjwwfakwve.supabase.co').replace(/\/$/, '');
const SUPA_KEY = String(process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY
  || 'sb_publishable_P4-NdUWJqjtACWZOB6LPEA_8GANHAUA');
const ROOT = path.resolve(__dirname, '..');

const args = process.argv.slice(2);
const asJson = args.includes('--json');
/* `--diff=<ref>` scans only what a change ADDS, against no baseline at all.
   That is what CI runs per pull request; the tree scan below is the standing
   measurement for the scheduled watch. */
const diffArg = args.find(a => a.startsWith('--diff='));
const DIFF_BASE = diffArg ? diffArg.split('=')[1] : null;
const arg = name => {
  const hit = args.find(a => a.startsWith(`--${name}=`));
  return hit ? Number(hit.split('=')[1]) : null;
};
/* Baselines measured 2026-09-02. Deliberately TWO numbers: a file count and a
   term count. Only counting terms lets a new file quietly name six clients as
   long as six others stopped being mentioned; only counting files lets one file
   name the whole roster. */
/* MEASURED, not guessed, and re-measured whenever the roster rules change.
   2026-09-04: 83 files / 44 terms, immediately after `internal` rows left the
   roster. The previous 108/45 was 25 files and one term of silent headroom —
   a real client added later whose slug already appears in the repository could
   have risen into that gap without the ratchet firing, which is the one thing a
   baseline exists to prevent. Raised by review on #1262. */
const BASELINE_FILES = arg('baseline-files') ?? 83;
const BASELINE_TERMS = arg('baseline-terms') ?? 44;

/* THREE FAILURE MEANINGS, THREE EXIT CODES — because the CI job treats them
   differently and must be able to. 1 is a finding and blocks. 2 is "this check
   could not run" (the roster read failed) and is deliberately a warning, since
   an unreachable backend is not evidence of an exposure. 3 is new: the roster
   read WORKED and returned something this script cannot classify, which is not
   an availability problem and must block — otherwise a new `clients.kind` value
   silently switches the gate off and the job still goes green. Raised by review
   on #1262, where the first version of the classification check threw into the
   generic handler and therefore exited 2. */
const EXIT_FINDING = 1;
const EXIT_UNAVAILABLE = 2;
const EXIT_UNCLASSIFIED = 3;

class UnclassifiedRoster extends Error {
  constructor(message) { super(message); this.exitCode = EXIT_UNCLASSIFIED; }
}

/* Short or common slugs would match ordinary English and report noise as
   exposure. A slug this short is also not identifying on its own. */
const MIN_SLUG = 5;
/* `clients` rows that are not people. Naming one of these exposes nobody, and
   gating on them makes the guard fire on ordinary code and documentation — see
   the comment in roster(). Anything outside these plus PERSON_KIND stops the
   run rather than being guessed at. */
const PERSON_KIND = 'client';
const NON_PERSON_KINDS = new Set(['test', 'internal']);

async function roster() {
  const get = async (path) => {
    const res = await fetch(`${SUPA_URL}/rest/v1/${path}`, {
      headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` },
    });
    if (!res.ok) throw new Error(`${path} -> HTTP ${res.status}`);
    const rows = await res.json();
    if (!Array.isArray(rows)) throw new Error(`${path} -> not an array`);
    return rows;
  };
  const [clients, members] = await Promise.all([
    get('clients?select=slug,kind,active&limit=1000'),
    get('team_members?select=name,active&limit=1000'),
  ]);
  const terms = [];
  const unknownKinds = new Set();
  for (const c of clients) {
    const slug = String(c.slug || '').trim();
    const kind = String(c.kind || '').trim();
    /* NOT EVERY ROW IN `clients` IS A PERSON, and a row that is not a person
       cannot be exposed by naming it.

       The TEST client was the first of these: a fixture, named in the code by
       design, and gating on it would ring forever for nobody. `internal` is the
       same shape and was found the hard way on 2026-09-04 — the attribution
       carve-out in `linear-inbound` writes a sentinel slug into `client_slug`
       when it invalidates an ownership claim, and that sentinel is a row in
       this table with `kind: 'internal'`. So the guard failed a docs change
       for quoting a string that has been sitting in `index.html` and
       `linear-inbound/index.ts` on `main` all along. A guard that fails on
       documentation of ordinary code is a guard people learn to route around,
       which is the one thing this tool cannot afford.

       An UNKNOWN kind is a hard failure rather than a silent include or a
       silent skip. Including it would re-create the false positive for whatever
       the next sentinel is called; skipping it would drop a real client out of
       the roster without anyone noticing, which is the failure that matters. */
    if (!NON_PERSON_KINDS.has(kind) && kind !== PERSON_KIND) { unknownKinds.add(kind || '(empty)'); continue; }
    if (slug.length < MIN_SLUG || NON_PERSON_KINDS.has(kind)) continue;
    terms.push({ kind: 'client_slug', term: slug });
  }
  if (unknownKinds.size) {
    /* The kind VALUES are printed; they are a column vocabulary, never a name. */
    throw new UnclassifiedRoster('clients.kind carries value(s) this guard does not classify: '
      + Array.from(unknownKinds).sort().join(', ')
      + ' — classify each as a person or a non-person in NON_PERSON_KINDS before this can gate again');
  }
  for (const m of members) {
    const name = String(m.name || '').trim();
    /* A single given name matches too much prose to be evidence. */
    if (name.split(/\s+/).length < 2) continue;
    terms.push({ kind: 'staff_name', term: name });
  }
  return terms;
}

/* EVERY git call goes through here, and the catch is the point.
   `execFileSync` puts the WHOLE ARGV in its error message, and the argv holds
   the roster term -- so an index error or a bad checkout would have printed a
   client's slug into a CI log, on exactly the path most likely to be pasted
   somewhere. Raised by review on #1224, and it is the sharpest of the four:
   the tool's one guarantee, broken on its error path. The error is REPLACED,
   never re-thrown, so nothing downstream can ever see the original message. */
function git(args, { termInArgs = false } = {}) {
  try {
    // A combined validation diff can exceed Node's 1 MiB default. Keep an
    // explicit finite bound; overflow must still refuse the scan, never clip it.
    return execFileSync('git', ['-C', ROOT, ...args], {
      encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 60000, windowsHide: true,
    });
  } catch (err) {
    if (err && err.status === 1) return null;      // grep/diff: no match is a result
    const code = err && (err.status !== undefined ? err.status : err.code);
    throw new Error(`git ${args[0]} failed (status ${code})`
      + (termInArgs ? ' — message withheld because the argument list carries a roster term' : ''));
  }
}

/* Fixed-string, tracked files only. `git grep -l` answers with file NAMES and
   never the matching line, which is the property this needs rather than a
   convenience. */
function filesContaining(term) {
  const out = git(['grep', '-lI', '-F', '--', term], { termInArgs: true });
  return out === null ? [] : out.split('\n').map(s => s.trim()).filter(Boolean);
}

/* CONTENTS ARE NOT THE ONLY PLACE A NAME LIVES. A file called
   `docs/audits/2026-09-02-<client>-audit.md` whose body is generically worded
   is exactly as public as one that says the name in a sentence, and `git grep`
   does not look at path text. Raised by review on #1224. */
let TRACKED_PATHS = null;
function pathsContaining(term) {
  if (TRACKED_PATHS === null) {
    const out = git(['ls-files']);
    TRACKED_PATHS = out === null ? [] : out.split('\n').map(s => s.trim()).filter(Boolean);
  }
  const needle = term.toLowerCase();
  return TRACKED_PATHS.filter(f => f.toLowerCase().includes(needle));
}

/* DIFF MODE — the answer to "this gate never runs before the change is public".
   Review on #1224 was right twice over: `npm test` never invokes this script at
   all, so a change adding a client identifier passes CI and becomes public
   before the exit status is ever observed; and a baseline of TOTALS cannot see
   a swap -- replacing one already-counted name with a new person's leaves every
   number exactly where it was.
   Scanning the ADDED LINES of a change needs no committed baseline, catches a
   swap exactly, and stays privacy-preserving. So it is what CI runs, and any
   roster term in an added line or an added path fails it. */
function addedLinesContaining(term, base) {
  const out = git(['diff', '--unified=0', base + '...HEAD'], {});
  if (out === null) return [];
  const hits = [];
  let current = null, count = 0;
  const flush = () => { if (current && count) hits.push({ file: current, count }); current = null; count = 0; };
  for (const line of out.split('\n')) {
    if (line.startsWith('+++ b/')) { flush(); current = line.slice(6).trim(); continue; }
    if (line.startsWith('+++ ')) { flush(); current = null; continue; }
    if (!current) continue;
    if (line.startsWith('+') && !line.startsWith('+++') && line.includes(term)) count++;
  }
  flush();
  return hits;
}

function addedPathsContaining(term, base) {
  const out = git(['diff', '--name-only', '--diff-filter=A', base + '...HEAD'], {});
  if (out === null) return [];
  const needle = term.toLowerCase();
  return out.split('\n').map(x => x.trim()).filter(Boolean)
    .filter(f => f.toLowerCase().includes(needle));
}

(async () => {
  const terms = await roster();
  const byFile = new Map();       // file -> {client_slug: n, staff_name: n}
  let matchedTerms = 0;
  const matchedByKind = { client_slug: 0, staff_name: 0 };
  for (const { kind, term } of terms) {
    const found = DIFF_BASE
      ? addedLinesContaining(term, DIFF_BASE).map(h => h.file).concat(addedPathsContaining(term, DIFF_BASE))
      : filesContaining(term).concat(pathsContaining(term));
    const unique = [...new Set(found)];
    if (!unique.length) continue;
    matchedTerms++;
    matchedByKind[kind]++;
    for (const file of unique) {
      if (!byFile.has(file)) byFile.set(file, { client_slug: 0, staff_name: 0 });
      byFile.get(file)[kind]++;
    }
  }

  const files = [...byFile.entries()]
    .map(([file, counts]) => ({ file, ...counts, total: counts.client_slug + counts.staff_name }))
    .sort((a, b) => b.total - a.total || a.file.localeCompare(b.file));
  /* In diff mode the baseline is ZERO: anything a change ADDS is new exposure by
     definition, so there is nothing to tolerate and no number to keep in step. */
  const failed = DIFF_BASE
    ? files.length > 0
    : (files.length > BASELINE_FILES || matchedTerms > BASELINE_TERMS);

  if (asJson) {
    console.log(JSON.stringify({
      mode: DIFF_BASE ? 'diff' : 'tree', diff_base: DIFF_BASE,
      baseline_files: DIFF_BASE ? 0 : BASELINE_FILES, baseline_terms: DIFF_BASE ? 0 : BASELINE_TERMS,
      roster_terms_checked: terms.length,
      matched_terms: matchedTerms, matched_by_kind: matchedByKind,
      files_touched: files.length, files,
    }, null, 2));
  } else {
    console.log(DIFF_BASE
      ? `Repository identity exposure — what this change ADDS, against ${DIFF_BASE}\n`
      : 'Repository identity exposure — this repo is PUBLIC and the roster is in it\n');
    console.log(`  ${'roster terms checked'.padEnd(33)}${terms.length}   (client slugs + staff full names)`);
    console.log(`  ${(DIFF_BASE ? 'terms this change adds' : 'terms found in the tree').padEnd(33)}${matchedTerms}   (${matchedByKind.client_slug} client slugs, ${matchedByKind.staff_name} staff names)`);
    console.log(`  ${'files carrying at least one'.padEnd(33)}${files.length}   ${DIFF_BASE ? '(any is a failure)' : '(baseline ' + BASELINE_FILES + ')'}\n`);
    console.log('  WHERE (counts only — this tool never prints what it matched):');
    for (const f of files.slice(0, 25)) {
      console.log(`    ${String(f.total).padStart(3)}  ${f.file}`);
    }
    if (files.length > 25) console.log(`    …and ${files.length - 25} more files with fewer matches`);
    console.log('');
    if (DIFF_BASE) {
      console.log(failed
        ? `FAIL: this change names a client or a colleague in ${files.length} file(s) — it must not be merged into a public repository ❌`
        : 'This change adds no client slug and no colleague\'s name ✅');
    } else {
      console.log(failed
        ? `FAIL: above the baseline (${files.length} files / ${matchedTerms} terms vs ${BASELINE_FILES} / ${BASELINE_TERMS}) — something new named a client or a colleague ❌`
        : 'At or under the baseline ✅ — the exposure is not growing');
      console.log('');
      console.log('  This gates GROWTH only. It removes nothing, and it cannot: the same strings');
      console.log('  are in git history, so a repair is a history rewrite (see');
      console.log('  docs/ops/GIT_HISTORY_PII_PURGE_2026-07-14.md) plus a judgement call about which');
      console.log('  audits are worth keeping. Both are the owner\'s.');
    }
  }
  process.exit(failed ? EXIT_FINDING : 0);
})().catch(err => {
  console.error('identity exposure check failed:', err.message);
  /* An UnclassifiedRoster carries its own code so the CI job can block on it.
     Everything else is an availability failure and stays a warning. */
  process.exit(err && err.exitCode ? err.exitCode : EXIT_UNAVAILABLE);
});
