'use strict';
/*
 * Every ROUTINES row in the deploy preflight carries an implicit fifth
 * element: `securityDefiner`, defaulting to true. The 2026-09-18 seed
 * migration defines production_native_label_empty_state as a plain
 * `language sql immutable` function, and its row had no fifth element, so the
 * live preflight failed with CONTRACT_MISMATCH on a database that matched the
 * migration exactly. The gate was wrong, not the database.
 *
 * This suite reads each cited migration file, finds the routine's own
 * `create [or replace] function` header, and requires the row's definer
 * expectation to match whether that header says `security definer`.
 */
const fs = require('fs');
const path = require('path');
const { ROUTINES } = require('../scripts/linear-exit-deploy-preflight.js');

let checks = 0; let failures = 0;
function ok(cond, msg) { checks += 1; if (!cond) { failures += 1; console.log('  FAIL ' + msg); } else { console.log('  ok  ' + msg); } }

function headerFor(source, name) {
  const re = new RegExp('create\\s+(?:or\\s+replace\\s+)?function\\s+public\\.' + name + '\\s*\\(', 'gi');
  let last = null; let m;
  while ((m = re.exec(source)) !== null) last = m.index;
  if (last === null) return null;
  const asIdx = source.slice(last).search(/\sas\s*\$/i);
  return asIdx < 0 ? source.slice(last, last + 600) : source.slice(last, last + asIdx);
}

const root = path.join(__dirname, '..');
for (const row of ROUTINES) {
  const [signature, file, name, , securityDefiner = true] = row;
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  const header = headerFor(source, name);
  ok(header !== null, `${signature}: definition found in ${file}`);
  if (header === null) continue;
  const declaresDefiner = /security\s+definer/i.test(header);
  ok(declaresDefiner === securityDefiner,
    `${signature}: preflight expects securityDefiner=${securityDefiner}, ${file} declares ${declaresDefiner}`);
}
console.log(JSON.stringify({ marker: failures ? 'LINEAR_EXIT_PREFLIGHT_DEFINER_PINS_FAIL' : 'LINEAR_EXIT_PREFLIGHT_DEFINER_PINS_OK', routines: ROUTINES.length, checks, failures }));
process.exit(failures ? 1 : 0);
