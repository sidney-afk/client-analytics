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
 *   node scripts/repo-identity-exposure-check.js [--baseline-files=N] [--json]
 *
 * Exits 1 above the baseline so it can gate; 0 at or below it.
 */
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const SUPA_URL = String(process.env.SUPABASE_URL || 'https://uzltbbrjidmjwwfakwve.supabase.co').replace(/\/$/, '');
const SUPA_KEY = String(process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY
  || 'sb_publishable_P4-NdUWJqjtACWZOB6LPEA_8GANHAUA');
const ROOT = path.resolve(__dirname, '..');

const args = process.argv.slice(2);
const asJson = args.includes('--json');
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

/* Fixed-string, whole-tree, tracked files only. `git grep -l` answers with file
   names and never the matching line, which is the property this needs. */
function filesContaining(term) {
  try {
    const out = execFileSync('git', ['-C', ROOT, 'grep', '-lI', '-F', '--', term], { encoding: 'utf8' });
    return out.split('\n').map(s => s.trim()).filter(Boolean);
  } catch (err) {
    // git grep exits 1 with no output when there is no match. That is a result.
    if (err && err.status === 1) return [];
    throw err;
  }
}

(async () => {
  const terms = await roster();
  const byFile = new Map();       // file -> {client_slug: n, staff_name: n}
  let matchedTerms = 0;
  const matchedByKind = { client_slug: 0, staff_name: 0 };
  for (const { kind, term } of terms) {
    const files = filesContaining(term);
    if (!files.length) continue;
    matchedTerms++;
    matchedByKind[kind]++;
    for (const file of files) {
      if (!byFile.has(file)) byFile.set(file, { client_slug: 0, staff_name: 0 });
      byFile.get(file)[kind]++;
    }
  }

  const files = [...byFile.entries()]
    .map(([file, counts]) => ({ file, ...counts, total: counts.client_slug + counts.staff_name }))
    .sort((a, b) => b.total - a.total || a.file.localeCompare(b.file));
  const failed = files.length > BASELINE_FILES || matchedTerms > BASELINE_TERMS;

  if (asJson) {
    console.log(JSON.stringify({
      baseline_files: BASELINE_FILES, baseline_terms: BASELINE_TERMS,
      roster_terms_checked: terms.length,
      matched_terms: matchedTerms, matched_by_kind: matchedByKind,
      files_touched: files.length, files,
    }, null, 2));
  } else {
    console.log('Repository identity exposure — this repo is PUBLIC and the roster is in it\n');
    console.log(`  roster terms checked               ${terms.length}   (client slugs + staff full names)`);
    console.log(`  terms found in the tree            ${matchedTerms}   (${matchedByKind.client_slug} client slugs, ${matchedByKind.staff_name} staff names)`);
    console.log(`  files carrying at least one        ${files.length}   (baseline ${BASELINE_FILES})\n`);
    console.log('  WHERE (counts only — this tool never prints what it matched):');
    for (const f of files.slice(0, 25)) {
      console.log(`    ${String(f.total).padStart(3)}  ${f.file}`);
    }
    if (files.length > 25) console.log(`    …and ${files.length - 25} more files with fewer matches`);
    console.log('');
    console.log(failed
      ? `FAIL: above the baseline (${files.length} files / ${matchedTerms} terms vs ${BASELINE_FILES} / ${BASELINE_TERMS}) — something new named a client or a colleague ❌`
      : `At or under the baseline ✅ — the exposure is not growing`);
    console.log('');
    console.log('  This gates GROWTH only. It removes nothing, and it cannot: the same strings');
    console.log('  are in git history, so a repair is a history rewrite (see');
    console.log('  docs/ops/GIT_HISTORY_PII_PURGE_2026-07-14.md) plus a judgement call about which');
    console.log('  audits are worth keeping. Both are the owner\'s.');
  }
  process.exit(failed ? 1 : 0);
})().catch(err => { console.error('identity exposure check failed:', err.message); process.exit(2); });
