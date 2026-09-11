'use strict';
// Direct invocation only; no npm-script or automatic live-probe registration.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { root } = require('./source-harness');
const { compare } = require('./compare');
const { runChecks } = require('./checks');
const { runContracts } = require('./contracts');
const { discrepancySnapshot } = require('./fixtures');
function provenance() {
  const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
  const paths = ['index.html', 'supabase/functions/workload-plan/index.ts',
    'supabase/functions/linear-outbound/mapping.mjs',
    'migrations/2026-09-02-workload-native-view.sql', 'test/helpers/extract-function.js',
    ...fs.readdirSync(__dirname).filter(f => f.endsWith('.js')).sort().map(f => 'qa/workload-consistency/' + f)];
  const files = Object.fromEntries(paths.map(p => [p, sha256(fs.readFileSync(path.join(root, p)))]));
  return { testedAt: new Date().toISOString(),
    head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    trackedTreeDirty: Boolean(execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: root, encoding: 'utf8' }).trim()),
    toolFilesTracked: execFileSync('git', ['ls-files', 'qa/workload-consistency/*.js'], { cwd: root, encoding: 'utf8' }).trim().split('\n').filter(Boolean).length === paths.filter(p => p.startsWith('qa/')).length,
    files, sourceSetSha256: sha256(JSON.stringify(files)),
    servingRevision: 'UNPROVEN', deployedEdgeRevision: 'UNPROVEN' };
}
async function main() {
  const args = process.argv.slice(2);
  if (args.length > 2 || (args.length && !['--contracts', '--compare'].includes(args[0]))
      || (args[0] === '--compare' && args.length !== 2) || (args[0] === '--contracts' && args.length !== 1)) {
    throw new Error('INVALID_ARGUMENTS');
  }
  const evidence = { evidence: 'OFFLINE_TEST', provenance: provenance() };
  if (args[0] === '--compare') {
    const file = path.resolve(args[1]);
    const relative = path.relative(root, file);
    // Raw snapshots belong outside the public repository, including symlinks.
    const realRelative = path.relative(root, fs.realpathSync(file));
    if ((!relative.startsWith('..' + path.sep) && !path.isAbsolute(relative))
        || (!realRelative.startsWith('..' + path.sep) && !path.isAbsolute(realRelative))) throw new Error('PRIVATE_INPUT_OUTSIDE_REPOSITORY_REQUIRED');
    const bytes = fs.readFileSync(file);
    evidence.inputSha256 = crypto.createHash('sha256').update(bytes).digest('hex');
    evidence.comparison = compare(JSON.parse(bytes.toString('utf8')));
    console.log(JSON.stringify(evidence, null, 2));
    const informational = new Set(['native_only', 'legitimate_workload_exclusion', 'intentional_date_semantics']);
    process.exitCode = Object.keys(evidence.comparison.counts).some(code => !informational.has(code)) ? 1 : 0;
    return;
  }
  evidence.results = args[0] === '--contracts' ? await runContracts() : await runChecks();
  if (!args.length) evidence.syntheticComparison = compare(discrepancySnapshot());
  evidence.counts = evidence.results.reduce((out, result) => { out[result.verdict] = (out[result.verdict] || 0) + 1; return out; }, {});
  console.log(JSON.stringify(evidence, null, 2));
  process.exitCode = evidence.results.some(result => result.verdict !== 'PASS') ? 1 : 0;
}
if (require.main === module) main().catch(() => {
  // Never expose JSON parse excerpts, input paths, row values or stack traces.
  console.error(JSON.stringify({ evidence: 'UNPROVEN', failureClass: 'input_or_harness_error' }));
  process.exitCode = 2;
});
module.exports = { provenance };
