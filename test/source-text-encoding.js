'use strict';
/*
 * Flip-day tester finding D — mojibake in a live client-attribution badge.
 *
 * The Production list's provisional-attribution badge rendered "Provisional Â·
 * repair" to real users: the source carried U+00C2 U+00B7 (a middle dot that
 * had been through a Latin-1 -> UTF-8 round trip) where U+00B7 belongs. The
 * tester saw one instance; there were six, the other five in the create modal
 * and two toasts, all user-visible.
 *
 * The fault is invisible in a diff, survives review, and only shows up in the
 * rendered page -- so it needs a byte-level guard rather than an eyeball. This
 * suite scans the shipped page (and the edge functions, which format operator
 * text the same way) for every common double-encoding signature.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

/* Each entry is a sequence that is ALWAYS a double-encoding artifact in this
 * codebase's text: the UTF-8 bytes of a common punctuation character read as
 * Latin-1 and re-encoded. "Â" before punctuation, "Ã" before a letter, and the
 * "â€" family cover every case seen in the wild here. */
const MOJIBAKE = [
  { pattern: /Â[ -¿]/g, name: 'Â + punctuation (a C2-prefixed Latin-1 supplement char)' },
  { pattern: /â€[¢™“”˜œ–—]/g, name: 'â€… family (curly quotes, dashes)' },
  { pattern: /Ã[ -¿][a-z]/g, name: 'Ã + accented-letter artifact' },
  { pattern: /�/g, name: 'U+FFFD replacement character (a lossy decode already happened)' },
];

const TARGETS = [
  'index.html',
  'supabase/functions/linear-inbound/index.ts',
  'supabase/functions/calendar-upsert/index.ts',
  'supabase/functions/production-write/index.ts',
];

for (const rel of TARGETS) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) continue;
  const source = fs.readFileSync(abs, 'utf8');
  for (const { pattern, name } of MOJIBAKE) {
    const hits = source.match(pattern) || [];
    if (hits.length) {
      // Name the first offending line so the fix is one jump away.
      const at = source.search(pattern);
      const line = source.slice(0, at).split('\n').length;
      ok(false, `${rel} carries no ${name} (found ${hits.length}, first at line ${line}: ${JSON.stringify(source.slice(at, at + 24))})`);
    } else {
      ok(true, `${rel} carries no ${name}`);
    }
  }
}

/* The positive control: the file DOES use real middle dots, so a scanner that
 * simply found nothing would be vacuous. */
const page = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
ok((page.match(/·/g) || []).length > 50,
  'index.html still uses real U+00B7 middle dots (the scan above is not vacuous)');

if (failures) { console.error(`\n${failures} check(s) failed.`); process.exit(1); }
console.log('\nsource text-encoding checks passed');
