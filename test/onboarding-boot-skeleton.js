'use strict';
// Onboarding links (?onboarding=, /onboarding_form, ?onboarding_view=) set no
// data-boot-nav, so without an override the default boot rule paints the
// Analytics skeleton before the onboarding page mounts. Guard the override,
// and that the default rule itself is unchanged for every other entry.
const fs = require('fs');
const path = require('path');
const css = fs.readFileSync(path.join(__dirname, '..', 'src/index/010-styles-foundation.css.part'), 'utf8');
const assert = require('assert/strict');
assert(/html\.boot-onboarding \.boot-skeleton-variant,\s*html\.boot-onboarding-view \.boot-skeleton-variant \{ display: none !important; \}/.test(css),
  'onboarding boot classes hide every boot skeleton variant');
assert(/html:not\(\[data-boot-nav\]\) \.boot-skeleton-analytics,/.test(css), 'the default Analytics skeleton rule for staff entries is unchanged');
assert(!/html\.boot-(client|intake|gate)[^{]*\.boot-skeleton-variant/.test(css), 'no other entry gains a skeleton override');
console.log('onboarding-boot-skeleton: 3 checks passed');
