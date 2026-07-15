#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const source = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

let failures = 0;
function ok(condition, message) {
    if (condition) console.log('\u2713 ' + message);
    else { console.error('\u2717 ' + message); failures++; }
}

const activeRoster = source.match(/const WL_VIDEO_EDITORS = \[([\s\S]*?)\n    \];/);
const activeNames = source.match(/const WL_ALLOWED_EDITORS = new Set\(\[([\s\S]*?)\n    \]\);/);
ok(activeRoster && !/Martin/i.test(activeRoster[1]), 'Martin is absent from the Workload video roster');
ok(activeNames && !/martin/i.test(activeNames[1]), 'Martin is absent from the Workload active-name allowlist');
ok(/WL_INACTIVE_EDITOR_IDS[\s\S]*6b70f1d8-f73e-4222-9a59-944b86da2cc9/.test(source), 'Martin Linear id is marked inactive');
ok(/WL_INACTIVE_EDITORS[\s\S]*'martin'[\s\S]*'martinsynchro'/.test(source), 'Martin name variants are marked inactive');
ok(/const editors = \(Array\.isArray\(data\.editors\)[\s\S]*\.filter\(ed => !wlIsInactiveEditor/.test(source), 'Kasper Editors filters inactive editors before rendering cached or fresh data');

if (failures) process.exit(1);
console.log('\nInactive editor roster checks passed.');
