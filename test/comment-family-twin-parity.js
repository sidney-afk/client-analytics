#!/usr/bin/env node
'use strict';
/**
 * The comment family, on both surfaces, checked against itself.
 *
 * OPEN_REPAIRS 105.3 recorded the shape: *"when one operation in a family
 * routes differently from its siblings, that difference is the bug"* — ADD was
 * the only comment operation without the fallback its siblings had, on BOTH
 * surfaces, and on Samples the staff add specifically computed the gate only
 * `_isClientLink ? … : null`, so staff never had one at all.
 *
 * OPEN_REPAIRS 117 recorded the other half: *"This is the third time this repo
 * has repaired one of these two surfaces and not its twin."* Item 87.3 wrote
 * the prediction down a month earlier — *"whatever is done here must also be
 * checked against the Samples twin"* — and the next repair missed the twin
 * anyway. A prediction in prose has now failed three times; this is the same
 * prediction as a check.
 *
 * The calendar and Samples comment surfaces are twins by construction: the same
 * six operations, the same canonical-vs-legacy routing decision, the same
 * `_prodCanonicalCommentGate`. So the two failure modes above are both
 * ASYMMETRIES, and asymmetry is checkable without deciding which predicate is
 * correct — which matters, because 105.3 also records that the right predicate
 * DIFFERS by operation (`.linked` is right for a read and too wide for a write).
 * This suite therefore never asserts "use this predicate". It asserts that the
 * twins answer the same three questions the same way, and that no member hides
 * its gate behind the reader's role.
 *
 * This is the client's path. A member that loses its fallback is a client who
 * cannot leave a note, and the last three times that happened nobody found out
 * until the client said so.
 */
const fs = require('fs');
const path = require('path');
const { extractFunction, stripNonCode } = require('./helpers/extract-function.js');

const INDEX = fs.readFileSync(path.join(path.resolve(__dirname, '..'), 'index.html'), 'utf8');

let failures = 0;
function ok(cond, msg) {
    console.log((cond ? '  ok  ' : 'FAIL  ') + msg);
    if (!cond) failures++;
}

/* The family. Each row is one operation and its two implementations. A row
   whose twin is missing is the drift this suite exists to catch, so a missing
   name fails rather than being skipped. */
const FAMILY = [
    { op: 'render the composer', cal: '_calComposerHtml', sxr: '_sxrComposerHtml' },
    { op: 'add a comment', cal: '_calAppendComment', sxr: '_sxrAppendComment' },
    { op: 'edit a comment', cal: '_calSaveCommentEdit', sxr: '_sxrSaveCommentEdit' },
    { op: 'resolve / unresolve', cal: '_calToggleCommentDone', sxr: '_sxrToggleCommentDone' },
    { op: 'delete a comment', cal: '_calDeleteComment', sxr: '_sxrDeleteComment' },
    { op: 'resolve the last tweak', cal: '_calResolveLastTweak', sxr: '_sxrResolveLastTweak' },
];

const GATE = /_prodCanonicalCommentGate\s*\(/;
const BRANCHES_ON_LINKED = /\.linked\b/;

/* The 105.3 defect: the gate computed only for one role, so the other role
   silently has none. The first version of this detector matched only `?:` and
   `&&` immediately before the call — Codex pointed out on #1255 that the
   statement form
       let gate = null; if (_isClientLink) gate = _prodCanonicalCommentGate(…);
   is the same defect and walked straight past it, while the other checks still
   saw a gate call and a later `.linked` and stayed green.
   So this works out the SPAN each `if (_isClientLink…)` guards — its braced
   block, or the single statement that follows — and flags a gate call inside
   one, as well as the two expression forms. */
/* EVERY `if`, and then ask whether ITS CONDITION mentions the role — not only
   the ifs that happen to start with it. Codex on #1255: the first version
   required `_isClientLink` to be the opening token, so
   `if (ready && _isClientLink) canonicalGate = _prodCanonicalCommentGate(…)`
   walked straight past while every other check stayed green. */
function roleGuardedSpans(code) {
    const spans = [];
    const re = /\bif\s*\(/g;
    let m;
    while ((m = re.exec(code))) {
        // Walk the balanced condition, then decide whether it depends on the role.
        let i = code.indexOf('(', m.index);
        const condStart = i;
        let depth = 0;
        for (; i < code.length; i++) {
            if (code[i] === '(') depth++;
            else if (code[i] === ')') { depth--; if (depth === 0) { i++; break; } }
        }
        if (!/_isClientLink\b/.test(code.slice(condStart, i))) continue;
        while (i < code.length && /\s/.test(code[i])) i++;
        if (code[i] === '{') {
            let d = 0;
            for (let j = i; j < code.length; j++) {
                if (code[j] === '{') d++;
                else if (code[j] === '}') { d--; if (d === 0) { spans.push([i, j]); break; } }
            }
        } else {
            const end = code.indexOf(';', i);
            spans.push([i, end < 0 ? code.length : end]);
        }
    }
    return spans;
}

/* EVERY conditional expression, as three facts: the condition, the true branch
   and the false branch.

   The regex this replaced could only read a ternary forwards — it required the
   gate call to follow the `?` with no `:` in between — so it saw
       _isClientLink ? _prodCanonicalCommentGate(…) : null
   and walked straight past its mirror image
       !_isClientLink ? null : _prodCanonicalCommentGate(…)
   which is the identical defect written the other way round. Codex caught that
   on #1255. A negated condition is not a rarer shape than a plain one, and a
   detector that only reads one of the two directions is a detector that reports
   clean on half the defects it exists for — the recurring failure this whole
   suite is a response to.

   Bracket depth is tracked in all three walks, so a nested ternary, an object
   literal's `:` and an argument list's `,` cannot be mistaken for this
   expression's own punctuation. `??` and `?.` are not conditionals and are
   skipped. Input is already comment- and string-free (see stripNonCode), so a
   `?` in prose or a URL never reaches here. */
function ternaryBranches(code) {
    const out = [];
    for (let i = 0; i < code.length; i++) {
        if (code[i] !== '?') continue;
        if (code[i + 1] === '?') { i++; continue; }          // `??`
        if (code[i + 1] === '.') continue;                    // `?.`
        if (code[i - 1] === '?') continue;                    // tail of `??`
        // The condition: back to the nearest boundary this expression sits on.
        let d = 0, s = i - 1;
        for (; s >= 0; s--) {
            const c = code[s];
            if (c === ')' || c === ']' || c === '}') d++;
            else if (c === '(' || c === '[' || c === '{') { if (d === 0) break; d--; }
            else if (d === 0 && (c === ';' || c === ',' || c === '=' || c === ':' || c === '?')) break;
        }
        const cond = code.slice(s + 1, i);
        // This `?`'s own `:` — nested ternaries consume theirs first.
        let nested = 0, d2 = 0, colon = -1;
        for (let j = i + 1; j < code.length; j++) {
            const c = code[j];
            if (c === '(' || c === '[' || c === '{') d2++;
            else if (c === ')' || c === ']' || c === '}') { if (d2 === 0) break; d2--; }
            else if (d2 !== 0) continue;
            else if (c === '?' && code[j + 1] !== '.' && code[j + 1] !== '?' && code[j - 1] !== '?') nested++;
            else if (c === ':') { if (!nested) { colon = j; break; } nested--; }
            else if (c === ';') break;
        }
        if (colon < 0) continue;
        // The false branch runs to the end of the expression.
        let e = colon + 1, d3 = 0;
        for (; e < code.length; e++) {
            const c = code[e];
            if (c === '(' || c === '[' || c === '{') d3++;
            else if (c === ')' || c === ']' || c === '}') { if (d3 === 0) break; d3--; }
            else if (d3 === 0 && (c === ';' || c === ',')) break;
        }
        out.push({ cond, whenTrue: [i, colon], whenFalse: [colon, e] });
    }
    return out;
}

function gateHiddenBehindRole(body) {
    const code = String(body || '');
    const calls = [];
    const gre = /_prodCanonicalCommentGate\s*\(/g;
    let g;
    while ((g = gre.exec(code))) calls.push(g.index);
    if (!calls.length) return false;
    const inSpan = ([a, b]) => calls.some(at => at > a && at < b);

    /* Conditional EXPRESSION, both directions. The defect is not "a ternary
       mentions the role" — `_isClientLink ? gateA(…) : gateB(…)` computes a
       gate for everyone and is fine — it is that ONE branch gets a gate and the
       other silently gets none. So compare the branches rather than looking at
       just one of them. */
    for (const t of ternaryBranches(code)) {
        if (!/_isClientLink\b/.test(t.cond)) continue;
        if (inSpan(t.whenTrue) !== inSpan(t.whenFalse)) return true;
    }

    /* Short-circuit: `… && _isClientLink && _prodCanonicalCommentGate(…)`. The
       role does not have to be the token immediately before the call, so this
       asks whether the condition ENDING at the call mentions it at all. */
    const parts = code.split('_prodCanonicalCommentGate');
    for (let i = 1; i < parts.length; i++) {
        const before = parts[i - 1].slice(-200);
        if (/&&\s*$/.test(before) && /_isClientLink\b[^;{}]*&&\s*$/.test(before)) return true;
    }

    /* Statement form: `if (_isClientLink) gate = _prodCanonicalCommentGate(…)`. */
    return roleGuardedSpans(code).some(inSpan);
}

function survey(name) {
    // extractFunction THROWS on a name it cannot find. A missing twin is the
    // exact drift this suite is for, so it has to arrive as a named failing
    // check, not as a stack trace that says nothing about which twin went.
    let raw;
    try { raw = extractFunction(INDEX, name); } catch (e) { return null; }
    if (typeof raw !== 'string' || !raw.length) return null;
    /* Match over CODE, never over comments. Caught by Codex on this PR:
       `_calAppendComment` carries a block comment that quotes
       `_prodCanonicalCommentGate(post, comp).linked` verbatim while explaining
       the routing rule, so deleting the real call left every assertion here
       green. A suite that reads a comment as behaviour is asserting that
       somebody wrote a sentence. */
    const body = stripNonCode(raw);
    return {
        raw,
        body,
        gate: GATE.test(body),
        linked: BRANCHES_ON_LINKED.test(body),
        roleHidden: gateHiddenBehindRole(body),
    };
}

for (const row of FAMILY) {
    const a = survey(row.cal);
    const b = survey(row.sxr);

    ok(!!a, `${row.op}: the calendar side (${row.cal}) exists`);
    ok(!!b, `${row.op}: the Samples twin (${row.sxr}) exists`);
    if (!a || !b) continue;

    // Symmetry first — it is the durable assertion. A future change that
    // legitimately removes the gate from one twin must remove it from both,
    // or explain itself here.
    ok(a.gate === b.gate,
        `${row.op}: both sides consult the canonical gate, or neither does (cal=${a.gate} sxr=${b.gate})`);
    ok(a.linked === b.linked,
        `${row.op}: both sides branch on whether the card is linked (cal=${a.linked} sxr=${b.linked})`);

    // Then the absolute floor: today every member routes, and losing that is
    // the client-facing lockout, not a style change.
    ok(a.gate && b.gate, `${row.op}: neither side routes blind`);
    ok(a.linked && b.linked, `${row.op}: neither side lost its legacy fallback decision`);

    // And the 105.3 defect itself, on both sides.
    ok(!a.roleHidden, `${row.op}: the calendar gate is not computed only for one role`);
    ok(!b.roleHidden, `${row.op}: the Samples gate is not computed only for one role`);
}

/* ---- THE ROSTER ITSELF ------------------------------------------------- */

/* A hand-written list of six pairs rots the moment someone adds a seventh
   operation to one surface — which is the drift this suite exists for, arriving
   through the suite's own blind spot. So the roster is checked against the
   code: every function that consults the gate must be either a FAMILY member or
   on an explicit, reasoned exclusion list. A new caller fails until somebody
   classifies it, which is the point. */
const EXCLUDED = {
    _prodCanonicalCommentGate: 'the gate itself',
    _writeUiCardCommentLifecycle: 'shared write-UI plumbing, not a per-surface operation',
    _writeUiCurrentCardCommentForResolve: 'the same, on the resolve path',
    /* Samples-only, and deliberately NOT asserted as missing twins: the two
       surfaces read differently on a client link. `_sxrCommentsForView`
       consults the gate and fails closed on an unready or unauthorised thread,
       while `_calCommentsForView` filters an already-loaded list by audience.
       Whether that difference is correct is a real question and it is recorded
       in OPEN_REPAIRS 139 rather than answered by an assertion here — this
       suite checks symmetry it can justify, not symmetry it assumes. */
    _sxrCommentsForView: 'Samples client read consults the gate; the calendar twin filters instead — open question, OPEN_REPAIRS 139',
    _sxrCommentsForAction: 'Samples-only; the calendar has no _calCommentsForAction at all — same open question',
    _sxrPostLinearComment: 'the Samples transport 105.3 repaired; the calendar gates one level up, in _calAppendComment',
};

function gateCallers() {
    const code = stripNonCode(INDEX);
    const decls = [];
    /* Named declarations AND assigned function expressions. Codex on #1255:
       index.html already defines `_cal*` / `_sxr*` operations as arrow
       functions, and a seventh written as
           const _calFoo = () => _prodCanonicalCommentGate(…)
       would have been attributed by the binary search to whatever named
       function happened to precede it — and if that one was already rostered
       or excluded, the promised unclassified-caller failure would never fire. */
    /* Anchored at the module's TOP-LEVEL indent (four spaces), which is where
       every one of these operations is declared. Without that anchor an inner
       `const chosen = …` inside a function body counts as a declaration and
       steals the attribution from the function it lives in — measured, not
       hypothetical: it moved `_calResolveLastTweak`'s gate call onto a local
       variable the first time this regex was widened. */
    const dre = new RegExp(
        // `function` declarations at ANY indent: some live inside a block —
        // `_prodCanonicalCommentGate` itself is declared at eight spaces, and
        // anchoring this half to the top level attributed its own definition to
        // whatever preceded it.
        '\\n[ \\t]*(?:async\\s+)?function\\s+([A-Za-z_$][A-Za-z0-9_$]*)\\s*\\('
        // Assigned function expressions only at the module's TOP-LEVEL indent,
        // which is where an operation would be written. Allowing them at any
        // indent lets an inner `const chosen = …` inside a function body steal
        // the attribution from the function it lives in — measured, not
        // hypothetical: it moved `_calResolveLastTweak`'s gate call onto a
        // local variable the first time this was widened.
        + '|\\n {4}(?:const|let|var) ([A-Za-z_$][A-Za-z0-9_$]*)\\s*=\\s*(?:async\\s*)?(?:function\\b|\\([^)]*\\)\\s*=>|[A-Za-z_$][A-Za-z0-9_$]*\\s*=>)',
        'g');
    let m;
    while ((m = dre.exec(code))) decls.push({ at: m.index, name: m[1] || m[2] });
    const names = new Set();
    const gre = /_prodCanonicalCommentGate\s*\(/g;
    while ((m = gre.exec(code))) {
        const at = m.index;
        let lo = 0, hi = decls.length - 1, best = null;
        while (lo <= hi) {
            const mid = (lo + hi) >> 1;
            if (decls[mid].at < at) { best = decls[mid]; lo = mid + 1; } else hi = mid - 1;
        }
        if (best) names.add(best.name);
    }
    return names;
}

const callers = gateCallers();
ok(callers.size >= 12, 'the gate has callers to enumerate at all (found ' + callers.size + ')');
const rostered = new Set(FAMILY.flatMap(r => [r.cal, r.sxr]));
for (const name of Array.from(callers).sort()) {
    ok(rostered.has(name) || Object.prototype.hasOwnProperty.call(EXCLUDED, name),
        name + ' consults the gate and is either in the family roster or explicitly excluded');
}
for (const row of FAMILY) {
    ok(callers.has(row.cal) && callers.has(row.sxr),
        row.op + ': both roster entries really are gate callers, so the roster has not rotted');
}

/* ---- WHY THE CALENDAR MAY READ WITHOUT ASKING THE GATE ------------------ */

/* The exclusion list above says the calendar client read does not consult the
   gate while the Samples one does. That is not a hole, and the reason is an
   invariant worth pinning: the calendar has no canonical comment store at all
   (there is no `_calCanonicalCommentsFor`), so the card column IS its
   projection of canonical state. Four of the five write operations keep it in
   step by calling `_writeUiPersistCanonicalCommentProjection` after a canonical
   write; ADD keeps it in step itself, writing the card column through
   `_calPendingEdits` + `_calStringifyComments` + `_calWatchNoteSave` — the same
   mechanism the projection uses.

   If one of those stopped, the calendar's client would silently read a stale
   copy of a thread that had moved on canonically, with nothing anywhere to
   report it. That is the same shape as OPEN_REPAIRS 101 and it is why this is
   asserted rather than trusted. */
const PROJECTORS = ['_calSaveCommentEdit', '_calToggleCommentDone',
    '_calDeleteComment', '_calResolveLastTweak'];
for (const name of PROJECTORS) {
    const f = survey(name);
    ok(f && /_writeUiPersistCanonicalCommentProjection/.test(f.body),
        name + ' projects canonical state back onto the card column the client reads');
}
const addF = survey('_calAppendComment');
ok(addF && /_calPendingEdits/.test(addF.body) && /_calStringifyComments/.test(addF.body)
    && /_calWatchNoteSave/.test(addF.body),
    '_calAppendComment writes that column itself, which is why it needs no projection call');
ok(!/function _calCanonicalCommentsFor\s*\(/.test(INDEX),
    'and the calendar still has no canonical comment store — if one appears, this reasoning has to be redone');

/* The stripper is now load-bearing: if it stopped removing comments, every
   answer above could be satisfied by prose. Asserted against the real body
   that produced the hole rather than a synthetic one. */
const appendRaw = extractFunction(INDEX, '_calAppendComment');
ok((appendRaw.match(/_prodCanonicalCommentGate/g) || []).length === 2,
    '_calAppendComment mentions the gate twice in its raw text — once in code, once in a comment');
ok((stripNonCode(appendRaw).match(/_prodCanonicalCommentGate/g) || []).length === 1,
    'and exactly one of those survives the strip, which is the call');
ok(stripNonCode(appendRaw).length === appendRaw.length,
    'the strip preserves length, so offsets still line up with the source');
ok(/const g = a \+ b;/.test(stripNonCode('const g = a + b; // _prodCanonicalCommentGate(x)')),
    'a line comment is removed and the code before it kept');
ok(!/gate/.test(stripNonCode('const s = "_prodCanonicalCommentGate";')),
    'a string body is removed too — a token in a string is not a call either');
ok(/keep/.test(stripNonCode('const t = `a ${keep} b`;')),
    'but code inside a template placeholder survives, because it IS code');
/* Codex on this PR: the frame was popped by the FIRST `}` inside a `${ … }`,
   so a nested object closed the interpolation early and the executable code
   after it was blanked — a gate call sitting there would have been invisible.
   Braces are counted now, as extractFunction has always done. */
ok(/\+ keep/.test(stripNonCode('`${foo({x: 1}) + keep}`')),
    'a nested object inside an interpolation does not end it early');
ok(/: z/.test(stripNonCode('`${x ? `${y}` : z} tail`')),
    'and neither does a nested template inside one');
ok(!/tail/.test(stripNonCode('`${x} tail`')),
    'while the template text around the placeholder is still removed');
ok(/\.test\(y\)/.test(stripNonCode('`${x}${/re/.test(y)}`')),
    'a later interpolation starting with a regex does not swallow the code after it');

/* The detector has to be able to see the defect it is named for, or the six
   clean answers above mean nothing. This is the exact shape 105.3 records
   Samples shipping: `_isClientLink ? _prodCanonicalCommentGate(post, comp) : null`. */
ok(gateHiddenBehindRole('const g = _isClientLink ? _prodCanonicalCommentGate(post, comp) : null;'),
    'the role-guard detector catches the ternary form 105.3 found on Samples');
ok(gateHiddenBehindRole('const g = _isClientLink && _prodCanonicalCommentGate(post, comp);'),
    'and the && form');
ok(!gateHiddenBehindRole('const g = _prodCanonicalCommentGate(post, comp);\nif (_isClientLink && g.linked) {}'),
    'and does NOT fire on a gate computed for everyone and then read per role, which is correct code');
ok(gateHiddenBehindRole('let g = null; if (_isClientLink) g = _prodCanonicalCommentGate(post, comp);'),
    'the STATEMENT form is caught too — same defect, and it walked past the first detector');
ok(gateHiddenBehindRole('let g = null;\nif (_isClientLink) {\n  g = _prodCanonicalCommentGate(post, comp);\n}'),
    'and the braced statement form');
ok(!gateHiddenBehindRole('if (_isClientLink) { render(); }\nconst g = _prodCanonicalCommentGate(post, comp);'),
    'while a role-guarded block that does something ELSE, with the gate outside it, is correct code');
ok(gateHiddenBehindRole('let g = null; if (ready && _isClientLink) g = _prodCanonicalCommentGate(post, comp);'),
    'a COMPOUND condition is caught — the role does not have to be the first token');
ok(gateHiddenBehindRole('const g = ready && _isClientLink ? _prodCanonicalCommentGate(post, comp) : null;'),
    'and so is the compound ternary');
ok(!gateHiddenBehindRole('if (ready && post) { const g = _prodCanonicalCommentGate(post, comp); }'),
    'while a guard that does not mention the role at all is left alone');
ok(!gateHiddenBehindRole('if (!post) return;\nconst g = _prodCanonicalCommentGate(post, comp);\nif (_isClientLink) x();'),
    'and a role check AFTER the gate is correct code, not a hidden gate');

/* THE MIRROR IMAGE, which the regex form could not read at all (Codex, #1255).
   A negated condition puts the gate in the FALSE branch; the defect is
   identical and a detector blind to it reports clean on half of them. */
ok(gateHiddenBehindRole('const g = !_isClientLink ? null : _prodCanonicalCommentGate(post, comp);'),
    'the gate hidden in a ternary FALSE branch is caught — the same defect, mirrored');
ok(gateHiddenBehindRole('const g = (!ready || !_isClientLink) ? null : _prodCanonicalCommentGate(post, comp);'),
    'and the compound negated form');
ok(gateHiddenBehindRole('const g = _isClientLink ? _prodCanonicalCommentGate(post, comp) : fallback(post);'),
    'a non-null other branch does not excuse it — that branch still has no gate');
ok(!gateHiddenBehindRole('const g = _isClientLink ? _prodCanonicalCommentGate(post, comp) : _prodCanonicalCommentGate(post, comp, true);'),
    'while a ternary that gates BOTH roles is correct code, not a hidden gate');
ok(!gateHiddenBehindRole('const label = _isClientLink ? "client" : "staff";\nconst g = _prodCanonicalCommentGate(post, comp);'),
    'and a role ternary that chooses something else entirely leaves the gate alone');
/* Punctuation the walker has to survive, or it reads the wrong branch. */
ok(gateHiddenBehindRole('const g = _isClientLink ? (ready ? _prodCanonicalCommentGate(post, comp) : null) : null;'),
    'a nested ternary does not steal the outer one\'s colon');
ok(!gateHiddenBehindRole('const o = { a: _isClientLink ? 1 : 2 };\nconst g = _prodCanonicalCommentGate(post, comp);'),
    'an object literal colon inside a branch is not mistaken for the ternary\'s own');
ok(!gateHiddenBehindRole('const g = f(_isClientLink ? 1 : 2, _prodCanonicalCommentGate(post, comp));'),
    'and a later argument is outside the branch, not inside the false one');
ok(!gateHiddenBehindRole('const n = a ?? b;\nconst m = obj?.x;\nconst g = _prodCanonicalCommentGate(post, comp);\nif (_isClientLink) y();'),
    '`??` and `?.` are not conditionals and do not invent a branch');

if (failures) {
    console.log('\n' + failures + ' check(s) failed.');
    process.exit(1);
}
console.log('\nComment-family twin parity checks passed');
