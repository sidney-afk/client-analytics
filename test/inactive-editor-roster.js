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

const rosterSql = fs.readFileSync(path.join(__dirname, '..', 'migrations', '2026-09-09-workload-native-roster.sql'), 'utf8');
const activeNames = source.match(/const WL_ALLOWED_EDITORS = new Set\(\[([\s\S]*?)\n    \]\);/);
ok(!/const WL_VIDEO_EDITORS\s*=/.test(source)
    && /into v_roster from public\.team_members tm\s+where tm\.active is true/.test(rosterSql),
    'the capacity roster is server-owned and its SQL excludes inactive members');
ok(activeNames && !/martin/i.test(activeNames[1]), 'Martin is absent from the Workload active-name allowlist');
ok(/WL_INACTIVE_EDITOR_IDS[\s\S]*6b70f1d8-f73e-4222-9a59-944b86da2cc9/.test(source), 'Martin Linear id is marked inactive');
ok(/WL_INACTIVE_EDITORS[\s\S]*'martin'[\s\S]*'martinsynchro'/.test(source), 'Martin name variants are marked inactive');
ok(/function wlIsAllowedEditor\(name, teamKey, teamName\) \{[\s\S]*WL_INACTIVE_EDITORS\.has\(norm\)\) return false;/.test(source), 'current Workload assignment eligibility still rejects inactive editors');
ok(/function _kedPaint\(\) \{[\s\S]{0,900}?const editors = Array\.isArray\(data\.editors\) \? data\.editors : \[\];/.test(source), 'Kasper Editors keeps inactive identities in event-time history instead of applying the current-assignment roster filter');

if (failures) process.exit(1);
console.log('\nInactive editor roster checks passed.');
