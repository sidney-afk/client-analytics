'use strict';
/*
 * Save-indicator rollout: the reusable modern indicator (_svSaveIndHtml /
 * _svSaveIndApply) is now wired into Samples New (SXR), Samples Old (sm), and
 * Templates — not just the calendar. Verifies each surface renders the icon and
 * drives it from its own status setter, plus the shared "saved" tooltip variant
 * used by Samples-Old's "Saved on device" fallback.
 *
 * Run:  node test/save-indicator-rollout.js   (exit 0 = all good)
 */
const fs = require('fs');
const path = require('path');

const INDEX = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function grabFunc(name) {
  const at = INDEX.indexOf('function ' + name + '(');
  if (at < 0) throw new Error('function not found: ' + name);
  let depth = 0;
  for (let j = INDEX.indexOf('{', at); j < INDEX.length; j++) {
    const c = INDEX[j];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return INDEX.slice(at, j + 1); }
  }
  throw new Error('unbalanced braces: ' + name);
}
let failures = 0;
function check(label, cond) { if (!cond) failures++; console.log(`${cond ? '✓' : '✗ FAIL'}  ${label}`); }

// ── Shared component: saved-with-tooltip variant ─────────────────────────────
function fakeEl() {
  const classes = new Set(); const attrs = {};
  return { hidden: true, _svFadeTimer: null,
    classList: { add:(...c)=>c.forEach(x=>classes.add(x)), remove:(...c)=>c.forEach(x=>classes.delete(x)), contains:x=>classes.has(x), toggle:(x,on)=>{on?classes.add(x):classes.delete(x)} },
    setAttribute:(k,v)=>{attrs[k]=String(v)}, removeAttribute:k=>{delete attrs[k]}, getAttribute:k=>k in attrs?attrs[k]:null,
    _classes:classes, _attrs:attrs };
}
const _svSaveIndApply = new Function('return (' + grabFunc('_svSaveIndApply') + ')')();
{
  const el = fakeEl();
  _svSaveIndApply(el, 'saved', 'Saved on device — will sync');
  check('saved accepts an optional tooltip (Samples-Old "Saved on device")', el._attrs['title'] === 'Saved on device — will sync' && el._classes.has('is-saved'));
  const el2 = fakeEl();
  _svSaveIndApply(el2, 'saved');
  check('saved with no message clears the tooltip', el2._attrs['title'] === undefined && el2._classes.has('is-saved'));
}

// ── Samples New (SXR) ────────────────────────────────────────────────────────
const sxrTitle = grabFunc('_sxrTitleRowHtml');
check('SXR title row wraps the name input + renders the indicator (with error persistence)',
  /cal-title-name-wrap/.test(sxrTitle) && /cal-title-fade/.test(sxrTitle) && /_svSaveIndHtml\(pid, null, p && p\._saveError/.test(sxrTitle));
const sxrStatus = grabFunc('_sxrSetCardStatus');
check('_sxrSetCardStatus drives the reusable indicator',
  /_svSaveIndApply\(document\.querySelector\(`\[data-sv-save-ind=/.test(sxrStatus));
check('_sxrSetCardStatus no longer writes the transient Saving…/Saved TEXT',
  !/textContent = 'Saving…'/.test(sxrStatus) && !/textContent = 'Saved'/.test(sxrStatus));
check('SXR keeps its Save-failed·Retry foot affordance', INDEX.includes('_sxrRetrySave') && INDEX.includes('Save failed · Retry'));

// ── Samples Old (sm) ─────────────────────────────────────────────────────────
check('sm card foot renders the indicator instead of the old text span',
  INDEX.includes('${_svSaveIndHtml(id)}') && !INDEX.includes('<span class="sm-card-saving" data-saving="${id}" hidden></span>'));
const smStatus = grabFunc('_smSetSaving');
check('_smSetSaving drives the reusable indicator by data-sv-save-ind',
  /_svSaveIndApply\(el, 'saving'\)/.test(smStatus) && /data-sv-save-ind=/.test(smStatus));
check('_smSetSaving maps its local fallback to saved + a "Saved on device" tooltip',
  /_svSaveIndApply\(el, 'saved', 'Saved on device/.test(smStatus));
check('_smSetSaving no longer writes the Saving…/Saved TEXT',
  !/textContent = 'Saving…'/.test(smStatus) && !/textContent = 'Saved'/.test(smStatus));

// ── Templates ────────────────────────────────────────────────────────────────
check('templates client header renders the indicator', INDEX.includes("_svSaveIndHtml('templates')"));
const tplStatus = grabFunc('_setTplStatus');
check('_setTplStatus drives the reusable indicator (no more dead tplStatusBadge)',
  /_svSaveIndApply\(document\.querySelector\('\[data-sv-save-ind="templates"\]'\)/.test(tplStatus) && !/getElementById\('tplStatusBadge'\)/.test(tplStatus));
check('_setTplStatus tracks the error message for re-render persistence', /_tplSaveErrorMsg =/.test(tplStatus));
const tplMount = grabFunc('mountTemplatesView');
check('mountTemplatesView restores a persistent save-error onto the header indicator',
  /_tplSaveErrorMsg\) _setTplStatus\('error', _tplSaveErrorMsg\)/.test(tplMount));

if (failures) { console.error(`\n${failures} check(s) failed ❌`); process.exit(1); }
console.log('\nAll save-indicator-rollout checks passed ✅');
