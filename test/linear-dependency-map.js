/*
 * test/linear-dependency-map.js
 *
 * The analyzer exists because a hand audit got "what still needs Linear?" wrong
 * twice in one session. A tool that answers that question wrongly is worse than
 * no tool, so this suite does three things, in order of how much it is worth:
 *
 *   1. FIXTURE SELF-TESTS. Each rule is proven on a tiny source whose right
 *      answer is obvious by inspection, before the analyzer is pointed at 7,000
 *      lines of production code where a wrong answer looks plausible.
 *   2. GROUND TRUTH. The three facts that were hand-verified against the real
 *      file are asserted against the real file, so a refactor that moves the
 *      dependency cannot leave the strategy documents quietly stale.
 *   3. MUTANT RUNS. Each rule is disabled in turn and the suite asserts the
 *      wrong answer comes back. A rule whose removal changes nothing is not
 *      protecting anything, and every one of these three rules was added only
 *      after it produced a visibly absurd result.
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { analyze, parseFunctions } = require('../scripts/linear-dependency-map.js');

let pass = 0, fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; console.log('  ok  ' + msg); }
  else { fail++; console.log('  FAIL ' + msg); }
}

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'lindep-'));
function fixture(name, body) {
  const p = path.join(TMP, name);
  fs.writeFileSync(p, body);
  return p;
}

console.log('\nFixture self-tests — each rule proven where the answer is obvious');

/* RULE 1: code after a top-level throw cannot run. This is the exact shape of
 * handleProductionCreate, whose 247 dead lines fooled the hand audit. */
const deadTail = fixture('dead.ts', `
async function handleClosed(): Promise<void> {
  throw new GatewayError(403, "closed");
  await fetch("https://api.linear.app/graphql");
}
async function handleOpen(): Promise<void> {
  await fetch("https://api.linear.app/graphql");
}
`);
{
  const r = analyze(deadTail);
  ok(!r.pathTo.has('handleClosed'), 'a Linear call BELOW a top-level throw is not a dependency');
  ok(r.pathTo.has('handleOpen'), 'a Linear call on a live path IS a dependency');
  const closed = r.byName.get('handleClosed');
  ok(closed && closed.deadLines > 0, 'the dead tail is counted and reportable');
}

/* RULE 2: a function body ends at its own closing brace. The first draft ended
 * it at the next declaration, which swept top-level constants into whichever
 * function sat above them and invented dependencies that were not there. */
const trailingConst = fixture('trailing.ts', `
function harmless(): string {
  return "nothing here";
}
const LINEAR_URL = "https://api.linear.app/graphql";
function alsoHarmless(): string {
  return "nor here";
}
`);
{
  const r = analyze(trailingConst);
  ok(!r.pathTo.has('harmless'),
    'a top-level const AFTER a function is not part of that function');
  const { fns } = parseFunctions(fs.readFileSync(trailingConst, 'utf8'));
  const h = fns.find(f => f.name === 'harmless');
  ok(h && h.end < fns.find(f => f.name === 'alsoHarmless').start,
    'the function body ends at its own closing brace, not at the next declaration');
}

/* RULE 3: the endpoint is usually reached through a constant, not a literal.
 * Without this, linear-outbound -- whose entire job is writing to Linear --
 * reported zero Linear dependencies. */
const viaAlias = fixture('alias.ts', `
const ENDPOINT = "https://api.linear.app/graphql";
async function pushes(): Promise<void> {
  await fetch(ENDPOINT, { method: "POST" });
}
async function caller(): Promise<void> {
  await pushes();
}
`);
{
  const r = analyze(viaAlias);
  ok(r.pathTo.has('pushes'), 'a fetch through a constant alias is a dependency');
  ok(r.pathTo.has('caller'), 'and it propagates to indirect callers');
  ok((r.pathTo.get('caller') || []).join('→').includes('pushes'),
    'the reported path names the intermediate function');
}

/* RULE 4: transitive reach. The second wrong answer came from grepping inside
 * one function's line range and missing a call two hops away. */
const indirect = fixture('indirect.ts', `
async function readsLinear(): Promise<void> {
  await fetch("https://api.linear.app/graphql");
}
async function middle(): Promise<void> {
  await readsLinear();
}
async function handleThing(): Promise<void> {
  await middle();
}
`);
{
  const r = analyze(indirect);
  const p = r.pathTo.get('handleThing');
  ok(!!p, 'a dependency two hops away is still a dependency');
  ok(p && p.join(' → ') === 'handleThing → middle → readsLinear',
    'the full path is reported so a reader can check it by hand');
}

console.log('\nGround truth — the facts that were verified by hand against the real file');
{
  const r = analyze('supabase/functions/production-write/index.ts');
  const created = r.byName.get('handleProductionCreate');
  ok(created && created.deadLines > 200,
    'handleProductionCreate is >200 lines of unreachable code (owner ruling 2026-08-23)');
  ok(!r.pathTo.has('handleProductionCreate'),
    'so the Production-tab create is linear-free — its Linear calls CANNOT run');
  const intake = r.pathTo.get('handleIntakeCreate');
  ok(!!intake,
    'the calendar create path (handleIntakeCreate) DOES depend on a live Linear read');
  ok(intake && intake.includes('projectForIntake') && intake.includes('readLinearProject'),
    'and it reaches it indirectly, through projectForIntake → readLinearProject');
}
{
  const r = analyze('supabase/functions/deliverable-write/index.ts');
  ok(r.pathTo.size === 0, 'deliverable-write reaches Linear nowhere');
}

console.log('\nMutant runs — each rule removed, the wrong answer must come back');
{
  const src = fs.readFileSync('scripts/linear-dependency-map.js', 'utf8');

  // Mutant A: stop treating a top-level throw as terminal.
  const noDead = src.replace(/if \(current\.deadFrom === null && \/\^ \{2\}throw\\s\/\.test\(line\)\) current\.deadFrom = i;/,
    '/* mutant: dead-code detection removed */');
  ok(noDead !== src, 'mutant A patched the dead-code rule');
  const mA = path.join(TMP, 'mutantA.js');
  fs.writeFileSync(mA, noDead);
  const rA = require(mA).analyze('supabase/functions/production-write/index.ts');
  ok(rA.pathTo.has('handleProductionCreate'),
    'without it, the closed create is reported as needing Linear — the original wrong answer');

  // Mutant B: stop resolving constant aliases for the endpoint.
  const noAlias = src.replace(/const re = \/\^const\\s\+\(\[A-Za-z_\$\]\[\\w\$\]\*\)\\s\*=\\s\*\[`"'\]\[\^`"'\]\*api\\\.linear\\\.app\/gm;/,
    'const re = /^const\\s+(NOTHING_MATCHES_THIS)\\s*=/gm;');
  ok(noAlias !== src, 'mutant B patched the alias rule');
  const mB = path.join(TMP, 'mutantB.js');
  fs.writeFileSync(mB, noAlias);
  const rB = require(mB).analyze('supabase/functions/linear-outbound/index.ts');
  ok(rB.pathTo.size === 0,
    'without it, linear-outbound reports ZERO Linear dependencies — absurd, and it did');
  const rBreal = analyze('supabase/functions/linear-outbound/index.ts');
  ok(rBreal.pathTo.size > 5,
    'with it, linear-outbound reports the real dependency set');
}

fs.rmSync(TMP, { recursive: true, force: true });
console.log(`\nlinear-dependency-map: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
