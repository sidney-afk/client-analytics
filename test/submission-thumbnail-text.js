'use strict';
/*
 * SUBMIT-TAB THUMBNAIL TEXT — the restored generator, and the eight gates that
 * make restoring it safe.
 *
 * OWNER RULING 2026-08-17 retired the original: "there should never be a
 * description done by AI", issued after his own test post produced "Sidney
 * Laruel center frame, confident direct gaze, bold text overlay with name and
 * date, clean gradient background in deep navy and gold tones" — invented, about
 * a real client, sitting on the designer's card as if it were the brief.
 *
 * OWNER RULING 2026-08-20 restores it, narrowed: "I want to keep it as
 * before... I just don't want that to affect a parent issue or a video issue. I
 * just want it to work when someone submits it through the submit tab."
 *
 * The measured cause of the 2026-08-17 failure was NOT the model. The two
 * clients with real filming plans that day received grounded, plan-quoting
 * text; both failures had an effectively empty plan (7 bytes, and 374 bytes of
 * unfilled template) and the old code called the model anyway with nothing to
 * work from. So the gates that matter most are the plan-substance floor and the
 * grounding filter — and those two are EXECUTED here against the real source,
 * not merely grepped, because a grounding predicate that silently passes
 * everything would be invisible to a source pin.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const edge = fs.readFileSync(path.join(ROOT, 'supabase', 'functions', 'production-write', 'index.ts'), 'utf8');
const drill = fs.readFileSync(path.join(ROOT, 'scripts', 'production-write-drill.js'), 'utf8');
let failures = 0;

function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

// ---------------------------------------------------------------------------
// EXECUTE the grounding logic against the real source.
// ---------------------------------------------------------------------------
function extract(startMarker, endMarker) {
  const start = edge.indexOf(startMarker);
  if (start < 0) throw new Error('missing source marker: ' + startMarker);
  const end = edge.indexOf(endMarker, start);
  if (end <= start) throw new Error('missing end marker after: ' + startMarker);
  return edge.slice(start, end);
}

const stopwordsSrc = extract('const THUMBNAIL_TEXT_STOPWORDS = new Set([', ']);') + ']);';
const helpersSrc = extract('function normalizedPlanText(', '\nasync function submissionThumbnailText(');
// The two helpers carry only trivial annotations; strip them so Node can run
// the REAL bodies rather than a re-typed copy that could drift from them.
const runnable = (stopwordsSrc + '\n' + helpersSrc)
  .replace(/\(value: string\)/g, '(value)')
  .replace(/\(text: string, plan: string\)/g, '(text, plan)')
  .replace(/\): string \{/g, ') {')
  .replace(/\): boolean \{/g, ') {');
const sandbox = { lower: value => String(value == null ? '' : value).trim().toLowerCase() };
vm.createContext(sandbox);
vm.runInContext(runnable + '\nthis.normalizedPlanText = normalizedPlanText; this.thumbnailTextGrounded = thumbnailTextGrounded;', sandbox);
const { normalizedPlanText, thumbnailTextGrounded } = sandbox;

ok(typeof thumbnailTextGrounded === 'function' && typeof normalizedPlanText === 'function',
  'the real grounding helpers extract and execute (the harness is not vacuous)');

// A realistic filming-plan excerpt. Nothing here mentions navy, gradients,
// gold tones, wardrobe or camera framing.
const PLAN = normalizedPlanText(`
  Video 1: Can a hairstyle really lift your face? Rocco explains how a
  well-chosen haircut changes the apparent shape of the jaw and cheekbones.
  Video 2: The truth about Motiva's blue layer — what the implant shell is
  actually made of and why patients ask about it.
  Video 3: Recovery week by week after a deep plane facelift.
`);

// THE EXACT TEXT THAT CAUSED THE RETIREMENT must not survive.
ok(thumbnailTextGrounded(
  'Sidney Laruel center frame, confident direct gaze, bold text overlay with name and date, clean gradient background in deep navy and gold tones',
  PLAN) === false,
'the 2026-08-17 invented art-direction brief FAILS the grounding filter');
ok(thumbnailTextGrounded('clean gradient background', PLAN) === false,
  'invented art direction fails even when short enough to clear the length cap');
ok(thumbnailTextGrounded('deep navy and gold tones', PLAN) === false,
  'a colour palette the plan never mentions is refused');

// Genuine, plan-derived thumbnail text must pass.
ok(thumbnailTextGrounded('Can a Hairstyle Lift Your Face?', PLAN) === true,
  'text drawn from the plan passes');
ok(thumbnailTextGrounded("The Truth About Motiva's Blue Layer", PLAN) === true,
  'punctuation and possessives do not break grounding');
ok(thumbnailTextGrounded('Facelift Recovery, Week By Week', PLAN) === true,
  'reordered plan wording passes — this is thumbnail text, not a quote');
ok(thumbnailTextGrounded('HAIRSTYLE AND JAW SHAPE', PLAN) === true,
  'grounding is case-insensitive');
ok(thumbnailTextGrounded('Jaw And Cheekbone Shape', PLAN) === true,
  'a singular inside the plan\'s plural is accepted (cheekbone inside cheekbones)');
// The containment test is deliberately ONE-DIRECTIONAL: the plan may be longer
// than the word, never shorter. "explains" in the plan does not license
// "explained" in the output. That is conservative on purpose — it costs an
// occasional true line, and it is what stops a model reaching a hair past what
// the plan actually says.
ok(thumbnailTextGrounded('Recovery Explained', PLAN) === false,
  'a different inflection than the plan uses is refused — grounding errs toward silence');

// One invented word is enough to refuse the whole line.
ok(thumbnailTextGrounded('Hairstyle Secrets In Tokyo', PLAN) === false,
  'a single word the plan never uses refuses the entire line');

// Vacuous passes are impossible.
ok(thumbnailTextGrounded('The Best Of It', PLAN) === false,
  'a line of nothing but stopwords and short words cannot pass vacuously');
ok(thumbnailTextGrounded('', PLAN) === false, 'empty text is never grounded');
ok(thumbnailTextGrounded('Hairstyle', '') === false,
  'an empty plan grounds nothing');

// ---------------------------------------------------------------------------
// The gates, pinned against the real function body.
// ---------------------------------------------------------------------------
const fnStart = edge.indexOf('async function submissionThumbnailText(');
const fnEnd = edge.indexOf('\ntype ProductionCreateScope', fnStart);
const fn = edge.slice(fnStart, fnEnd);
ok(fnStart > 0 && fnEnd > fnStart, 'the restored function is present and bounded');

ok(/if \(gate\.skipGeneration\) return empty;/.test(fn), 'gate: the test-principal skip flag short-circuits');
ok(/if \(lower\(gate\.surface\) !== "submission"\) return empty;/.test(fn),
  'gate 1: SUBMIT TAB ONLY — the calendar surface that caused the 2026-08-17 incident is excluded');
ok(/if \(gate\.appendToBatch === true\) return empty;/.test(fn), 'gate 2: new batches only, never appends');
ok(/normalizeTeam\(item\.team\) === "graphics"/.test(fn)
  && /!clean\(item\.brief\)/.test(fn)
  && /!clean\(existingById\.get\(deliverableIds\[index\]\)\?\.brief\)/.test(fn),
'gate 3: graphics children only, and only where no human brief already exists');
ok(/if \(clean\(gate\.planStatus\) !== "resolved_server"\) return empty;/.test(fn),
  'gate 4: only a protected server-resolved filming-plan mapping qualifies');
ok(/if \(clean\(planText\)\.length < MIN_PLAN_CHARS\) return empty;/.test(fn),
  'gate 5: an empty or stub filming plan refuses — the condition whose absence caused the retirement');
ok(/!thumbnailTextGrounded\(title, plan\)/.test(fn), 'gate 6: ungrounded lines are dropped');
ok(/title\.length > MAX_THUMBNAIL_TEXT_CHARS/.test(fn), 'gate 7: art-direction paragraphs are dropped');

// Gate 8 is the one that must be true STRUCTURALLY, not by inspection: a
// generator that can throw can refuse a submission, which is exactly what the
// retired version did.
ok(!/\bthrow\b/.test(fn), 'gate 8: the generator contains no throw — it can never fail a submission');
ok(!/GatewayError/.test(fn), 'gate 8: it cannot raise a gateway error either');
const returns = fn.match(/return [a-zA-Z]+/g) || [];
ok(returns.length > 0 && returns.every(r => r === 'return empty' || r === 'return resolved'),
  'gate 8: every exit returns a map — empty on any failure, resolved on success');

// No fallback text: an item the model skipped keeps its empty brief.
ok(/if \(title\) resolved\.set\(index, title\);/.test(fn)
  && !/`Video \$\{/.test(fn),
'a skipped or refused item stays honestly empty — no "Video N" fallback returns');

// Provider hygiene.
ok(/Deno\.env\.get\("GRAPHIC_TITLE_API_KEY"\)/.test(fn) && /if \(!apiKey\) return empty;/.test(fn),
  'a missing provider key disables the feature silently instead of erroring');
ok(!/sk-ant|x-api-key":\s*"/i.test(edge), 'no provider key literal is committed');
ok(/const THUMBNAIL_TEXT_SYSTEM_PROMPT = \[/.test(edge)
  && /system: THUMBNAIL_TEXT_SYSTEM_PROMPT,/.test(fn)
  && !/Deno\.env\.get\("GRAPHIC_TITLE_PROMPT"\)/.test(edge),
'the instruction is in-repo and reviewable; the drifted GRAPHIC_TITLE_PROMPT secret is no longer read');

// ---------------------------------------------------------------------------
// The call site: parent and video legs must be structurally unreachable.
// ---------------------------------------------------------------------------
const intakeStart = edge.indexOf('async function handleIntakeCreate(');
const intake = edge.slice(intakeStart);
ok(/const thumbnailText = await submissionThumbnailText\(/.test(intake)
  && /planStatus: clean\(intakePlan\.status\),/.test(intake)
  && /skipGeneration: skipGraphicGeneration,/.test(intake),
'the intake wires the generator with the live plan status and the skip flag');
ok(/const brief = existingBrief \|\| sourceBrief\s*\n\s*\|\| \(team === "graphics" \? clean\(thumbnailText\.get\(index\)\) : ""\);/.test(intake),
  'generated text is LAST in the brief expression and reaches graphics items only');
// The batch row is the parent issue's source. It must not read any item brief.
const batchRowStart = intake.indexOf('const batchRow: JsonMap = {');
const batchRow = intake.slice(batchRowStart, intake.indexOf('};', batchRowStart));
ok(batchRowStart > 0 && !/thumbnailText|brief/.test(batchRow),
  'the batch row — which becomes the PARENT issue — never reads generated text or any brief');
ok(!/thumbnailText/.test(intake.slice(intake.indexOf('description: intakePlan.description'))) ||
   intake.indexOf('const brief = existingBrief') < intake.indexOf('description: intakePlan.description'),
'the parent description still comes from the filming-plan link, not the generator');

// ---------------------------------------------------------------------------
// The nightly drill assertion the retirement left unreachable.
// ---------------------------------------------------------------------------
ok(!/row\.brief === 'Video 1' && issue\.description === 'Video 1'/.test(drill),
  'the drill no longer asserts the deleted "Video 1" fallback brief');
ok(/assert\(!clean\(row\.brief\), 'graphics brief should be empty when generation is skipped'\)/.test(drill)
  && /skipped graphics generation should leave the Linear description empty/.test(drill),
'the drill now asserts an EMPTY brief under skip_graphic_generation, so a generator that fires anyway still fails it');

if (failures) {
  console.error(`\n${failures} submission thumbnail-text check(s) failed.`);
  process.exit(1);
}
console.log('\nSubmission thumbnail-text checks passed.');
