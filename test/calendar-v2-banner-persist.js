'use strict';
/*
 * Calendar v2 — Linear-meta banner persistence regression test.
 *
 * Run:  node test/calendar-v2-banner-persist.js   (exit 0 = all good)
 *
 * The "incomplete sub-issue" / parent-link banners are driven by Linear meta
 * (project / due date / editor) that is NOT on the Supabase row. We persist it
 * so the banner is instant on load and survives a refresh. This extracts the
 * REAL _calHydrateLinearMeta / _calPersistLinearMeta from ../index.html and
 * checks: round-trip, TTL expiry, and hydrate idempotency.
 */
const fs = require('fs');
const path = require('path');
const INDEX = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');

function grabFunc(name) {
  const at = INDEX.indexOf('function ' + name + '(');
  if (at < 0) throw new Error('function not found: ' + name);
  let depth = 0;
  for (let j = INDEX.indexOf('{', at); j < INDEX.length; j++) {
    if (INDEX[j] === '{') depth++;
    else if (INDEX[j] === '}') { depth--; if (depth === 0) return INDEX.slice(at, j + 1); }
  }
  throw new Error('unbalanced: ' + name);
}
function grabConst(name) {
  const m = INDEX.match(new RegExp('^\\s*const ' + name + '\\s*=.*;\\s*$', 'm'));
  if (!m) throw new Error('const not found: ' + name);
  return m[0];
}

const SANDBOX = `
const _calParentLinks = new Set();
const _calLinearMetaByIdent = new Map();
let _calLinearMetaHydrated = false;
const _store = Object.create(null);
const localStorage = {
  getItem(k){ return k in _store ? _store[k] : null; },
  setItem(k,v){ _store[k] = String(v); },
  removeItem(k){ delete _store[k]; }
};
${grabConst('CAL_LINEAR_META_LS_KEY')}
${grabConst('CAL_LINEAR_META_TTL_MS')}
${grabFunc('_calHydrateLinearMeta')}
${grabFunc('_calPersistLinearMeta')}
${grabFunc('_calIdentFromUrl')}
${grabFunc('_calLinearMissingForCard')}
return {
  _calParentLinks, _calLinearMetaByIdent, localStorage, _store,
  CAL_LINEAR_META_LS_KEY, CAL_LINEAR_META_TTL_MS,
  _calHydrateLinearMeta, _calPersistLinearMeta, _calLinearMissingForCard,
  resetHydrated(){ _calLinearMetaHydrated = false; },
};`;
const m = new Function(SANDBOX)();

let pass = 0, fail = 0;
const ok = (cond, label) => { if (cond) { pass++; console.log('  ✅ ' + label); } else { fail++; console.log('  ❌ ' + label); } };

// 1) Round-trip: persist → clear in-memory → hydrate → identical.
m._calParentLinks.add('VID-100');
m._calLinearMetaByIdent.set('GRA-200', { hasProject: false, hasDue: true, hasEditor: false });
m._calLinearMetaByIdent.set('VID-300', { hasProject: true, hasDue: false, hasEditor: true });
m._calPersistLinearMeta();
m._calParentLinks.clear();
m._calLinearMetaByIdent.clear();
m.resetHydrated();
m._calHydrateLinearMeta();
ok(m._calParentLinks.has('VID-100'), 'parent link survives round-trip');
const g = m._calLinearMetaByIdent.get('GRA-200');
ok(g && g.hasProject === false && g.hasDue === true && g.hasEditor === false, 'GRA-200 meta survives exactly');
const v = m._calLinearMetaByIdent.get('VID-300');
ok(v && v.hasProject === true && v.hasDue === false && v.hasEditor === true, 'VID-300 meta survives exactly');

// 2) TTL: a payload older than the TTL is ignored (no stale banners forever).
const stale = JSON.parse(m._store[m.CAL_LINEAR_META_LS_KEY]);
stale.savedAt = Date.now() - (m.CAL_LINEAR_META_TTL_MS + 1000);
m.localStorage.setItem(m.CAL_LINEAR_META_LS_KEY, JSON.stringify(stale));
m._calParentLinks.clear(); m._calLinearMetaByIdent.clear(); m.resetHydrated();
m._calHydrateLinearMeta();
ok(m._calParentLinks.size === 0 && m._calLinearMetaByIdent.size === 0, 'stale (TTL-expired) payload is ignored');

// 3) Idempotent: a second hydrate must not double-apply or throw.
m._calParentLinks.clear(); m._calLinearMetaByIdent.clear(); m.resetHydrated();
const fresh = JSON.parse(m._store[m.CAL_LINEAR_META_LS_KEY]); fresh.savedAt = Date.now();
m.localStorage.setItem(m.CAL_LINEAR_META_LS_KEY, JSON.stringify(fresh));
m._calHydrateLinearMeta();
const sizeAfter1 = m._calLinearMetaByIdent.size;
m._calHydrateLinearMeta(); // guard should make this a no-op
ok(m._calLinearMetaByIdent.size === sizeAfter1, 'second hydrate is a no-op (idempotent)');

// 4) Corrupt payload must not throw.
let threw = false;
try { m.localStorage.setItem(m.CAL_LINEAR_META_LS_KEY, '{not json'); m.resetHydrated(); m._calHydrateLinearMeta(); }
catch { threw = true; }
ok(!threw, 'corrupt localStorage payload is handled gracefully');

// 5) _calLinearMissingForCard consumption (the done-card path sets
//    hasProject:true so only due date / editor are ever flagged).
m._calParentLinks.clear(); m._calLinearMetaByIdent.clear();
m._calLinearMetaByIdent.set('VID-1', { hasProject: true, hasDue: false, hasEditor: false }); // done card: no due, no editor
m._calLinearMetaByIdent.set('VID-2', { hasProject: true, hasDue: true, hasEditor: true });   // complete
m._calLinearMetaByIdent.set('GRA-3', { hasProject: true, hasDue: true, hasEditor: false });  // graphic missing editor
m._calLinearMetaByIdent.set('VID-4', { hasProject: false, hasDue: false, hasEditor: false }); // missing everything
m._calLinearMetaByIdent.set('VID-5', { hasProject: false, hasDue: true, hasEditor: true });   // only project missing
const card = (v, g) => ({ linear_issue_id: v ? ('https://linear.app/x/issue/' + v) : '', graphic_linear_issue_id: g ? ('https://linear.app/x/issue/' + g) : '' });
const r1 = m._calLinearMissingForCard(card('VID-1'));
ok(r1 && r1.comp === 'video' && r1.missing.join(',') === 'due date,editor', 'has project → flags only due date + editor');
const r4 = m._calLinearMissingForCard(card('VID-4'));
ok(r4 && r4.missing.join(',') === 'project,due date,editor', 'no project/due/editor → flags all three (accurate)');
const r5 = m._calLinearMissingForCard(card('VID-5'));
ok(r5 && r5.missing.join(',') === 'project', 'only project missing → flags just "project"');
ok(m._calLinearMissingForCard(card('VID-2')) === null, 'complete sub-issue → no banner');
const r3 = m._calLinearMissingForCard(card('VID-2', 'GRA-3'));
ok(r3 && r3.comp === 'graphic' && r3.missing.join(',') === 'editor', 'falls through to graphic slot when video is complete');
ok(m._calLinearMissingForCard(card('VID-UNKNOWN')) === null, 'no meta yet → no banner (no spurious flag)');
m._calParentLinks.add('VID-1');
ok(m._calLinearMissingForCard(card('VID-1')) === null, 'parent-linked ident is skipped');

console.log(`\n  ${fail === 0 ? 'PASS ✅' : 'FAIL ❌'}  (${pass} passed, ${fail} failed)`);
process.exit(fail === 0 ? 0 : 1);
