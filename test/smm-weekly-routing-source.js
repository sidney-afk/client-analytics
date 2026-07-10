'use strict';

const fs = require('fs');
const path = require('path');

const INDEX = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');

function ok(cond, msg) {
  if (!cond) {
    console.error('FAIL smm-weekly-routing-source:', msg);
    process.exit(1);
  }
}

function grabFunc(name) {
  const at = INDEX.indexOf('function ' + name + '(');
  if (at < 0) throw new Error('function not found: ' + name);
  let depth = 0;
  for (let i = INDEX.indexOf('{', at); i < INDEX.length; i++) {
    const c = INDEX[i];
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return INDEX.slice(at, i + 1);
    }
  }
  throw new Error('unbalanced function: ' + name);
}

const gateStart = INDEX.indexOf('<script>');
const gateEnd = INDEX.indexOf('</script>', gateStart);
const GATE = INDEX.slice(gateStart, gateEnd);
const navTo = grabFunc('navTo');

ok(/const SMM_WEEKLY_ROUTES = \['smm-weekly-report', 'smm-weekly-reports'\];/.test(INDEX),
  'weekly report route list must stay explicit');
ok(/var RESTORABLE_FAST = FAST\.filter/.test(GATE),
  'boot gate must split direct fast routes from restorable routes');
ok(/RESTORABLE_FAST\.indexOf\(nav\) >= 0/.test(GATE),
  'boot gate must restore only restorable fast routes');
ok(/localStorage\.removeItem\('syncview_nav'\)/.test(GATE),
  'boot gate must clear old saved weekly report routes');
ok(/const RESTORABLE_FAST_TABS = FAST_TABS\.filter\(tab => !_isSmmWeeklyRoute\(tab\)\);/.test(INDEX),
  'app router must split direct fast tabs from restorable tabs');
ok(/RESTORABLE_FAST_TABS\.includes\(restoreFastNav\)/.test(INDEX),
  'app router fallback must use restorable tabs only');
ok(/let savedNav = localStorage\.getItem\(NAV_KEY\);[\s\S]{0,160}savedNav = null;/.test(INDEX),
  'app router must sanitize old saved weekly report routes');
ok(/if \(_isSmmWeeklyRoute\(page\)\)[\s\S]{0,180}localStorage\.removeItem\(NAV_KEY\)[\s\S]{0,180}else \{[\s\S]{0,80}localStorage\.setItem\(NAV_KEY, page\)/.test(navTo),
  'navTo must not persist weekly report pages as the last tab');
ok(/classList\.toggle\('smm-weekly-mode', _isSmmWeeklyRoute\(page\)\)/.test(navTo),
  'weekly chrome mode should use the shared route helper');

console.log('smm-weekly-routing-source checks passed');
