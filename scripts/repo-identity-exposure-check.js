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
const BASELINE_FILES = arg('baseline-files') ?? 108;
const BASELINE_TERMS = arg('baseline-terms') ?? 45;

/* Short or common slugs would match ordinary English and report noise as
   exposure. A slug this short is also not identifying on its own. */
const MIN_SLUG = 5;

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
  for (const c of clients) {
    const slug = String(c.slug || '').trim();
    /* The TEST client is excluded on purpose: it is a fixture, it is named in
       the code by design, and gating on it would ring forever for nobody. */
    if (slug.length < MIN_SLUG || c.kind === 'test') continue;
    terms.push({ kind: 'client_slug', term: slug });
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
    return execFileSync('git', ['-C', ROOT, ...args], { encoding: 'utf8' });
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
  process.exit(failed ? 1 : 0);
})().catch(err => { console.error('identity exposure check failed:', err.message); process.exit(2); });
