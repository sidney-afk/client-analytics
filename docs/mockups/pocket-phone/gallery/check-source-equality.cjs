// Optional source proof against a separate checkout of this PR's merge base.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const candidate = path.resolve(__dirname, '../../../..');
const base = process.argv[2];
if (!base) throw new Error('Supply a checkout of the PR merge base.');
const git = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
if (git(base, ['rev-parse', 'HEAD']) !== git(candidate, ['merge-base', 'origin/main', 'HEAD']))
  throw new Error('The baseline checkout must match the PR merge base.');
const files = git(base, ['ls-files', '-z']).split('\0').filter(Boolean);
const allowed = new Set(['REPO_MAP.md', 'docs/FIND_ANYTHING.md']);
const compared = files.filter(f => !allowed.has(f));
const differences = compared.filter(f => !fs.readFileSync(path.join(base, f)).equals(fs.readFileSync(path.join(candidate, f))));
console.log(`SOURCE_EQUALITY: ${compared.length} existing files compared byte for byte; ${differences.length} differences outside the two documentation index edits.`);
process.exitCode = differences.length ? 1 : 0;
