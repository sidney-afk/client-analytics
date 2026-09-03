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
const { extractFunction } = require('./helpers/extract-function.js');

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

/* The 105.3 defect verbatim: the gate computed only for one role, so the other
   role silently has none. Look at the text immediately BEFORE each gate call in
   the function, which is where such a guard would sit. */
function gateHiddenBehindRole(body) {
    const parts = String(body || '').split('_prodCanonicalCommentGate');
    for (let i = 1; i < parts.length; i++) {
        const before = parts[i - 1].slice(-140);
        if (/_isClientLink\s*(\?|&&)\s*$/.test(before)) return true;
        if (/_isClientLink\s*\?[^:]*$/.test(before)) return true;
    }
    return false;
}

function survey(name) {
    // extractFunction THROWS on a name it cannot find. A missing twin is the
    // exact drift this suite is for, so it has to arrive as a named failing
    // check, not as a stack trace that says nothing about which twin went.
    let body;
    try { body = extractFunction(INDEX, name); } catch (e) { return null; }
    if (typeof body !== 'string' || !body.length) return null;
    return {
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

/* The detector has to be able to see the defect it is named for, or the six
   clean answers above mean nothing. This is the exact shape 105.3 records
   Samples shipping: `_isClientLink ? _prodCanonicalCommentGate(post, comp) : null`. */
ok(gateHiddenBehindRole('const g = _isClientLink ? _prodCanonicalCommentGate(post, comp) : null;'),
    'the role-guard detector catches the ternary form 105.3 found on Samples');
ok(gateHiddenBehindRole('const g = _isClientLink && _prodCanonicalCommentGate(post, comp);'),
    'and the && form');
ok(!gateHiddenBehindRole('const g = _prodCanonicalCommentGate(post, comp);\nif (_isClientLink && g.linked) {}'),
    'and does NOT fire on a gate computed for everyone and then read per role, which is correct code');

if (failures) {
    console.log('\n' + failures + ' check(s) failed.');
    process.exit(1);
}
console.log('\nComment-family twin parity checks passed');
