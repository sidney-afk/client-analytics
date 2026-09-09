'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { VERDICTS, assessRetirement } = require('../scripts/syncview-retirement-census');

let failures = 0;
function ok(condition, message) {
  if (!condition) { console.error('FAIL syncview-retirement-admission:', message); failures++; }
}

const root = path.join(__dirname, '..');
const migrationPath = path.join(root, 'migrations', '2026-09-09-syncview-retirement-admission.sql');
const migration = fs.readFileSync(migrationPath, 'utf8');

// The boundary must sit at the one table every ordinary status/comment/due/etc.
// write reaches. A client-side flag or an outbound-worker condition cannot
// establish this property because it misses stale tabs and new RPC callers.
ok(/create trigger zzz_syncview_retirement_admission_guard\s+before insert on public\.mirror_outbox/i.test(migration),
  'retirement has a BEFORE INSERT mirror_outbox admission trigger');
ok(/raise exception 'syncview_retirement_admission_closed:%', new\.operation/i.test(migration),
  'ordinary admission fails loudly rather than becoming hidden skipped debt');
ok(/lock table public\.mirror_outbox in share row exclusive mode;/i.test(migration)
  && /high_water_outbox_id/i.test(migration) && /syncview_retirement_drain_required/i.test(migration),
  'activation serializes writers, requires a drain, and records the actual high-water');
ok(/production_syncview_retirement_typed_native_receipt\(new\)/.test(migration)
  && /new\.status\s*=\s*'skipped'/.test(migration) === false,
  'retirement only recognizes typed native work and never reclassifies a receipt itself');
ok(/_native_intake_epoch/.test(migration) && /_native_assignment_epoch/.test(migration)
  && /_native_label_catalog_version/.test(migration),
  'intake, assignment, and label native receipts each retain their own typed proof');
ok(/production_syncview_retirement_f27_drill_receipt/.test(migration)
  && /f27_drill_rollback_id is not null/i.test(migration)
  && /p_row\.test_only=true and p_row\.legacy_parity=false/i.test(migration),
  'F27 drill is a narrow TEST-only exception, not a provider or general TEST bypass');
ok(/track_b_f27_hold_guard/.test(migration) && /zz_native_intake_receipt_guard/.test(migration)
  && /zzz_native_assignment_receipt_guard/.test(migration) && /zzz_native_label_receipt_guard/.test(migration),
  'installation refuses to run without the existing F27 and native receipt guards');
ok(/ordinary_by_operation/.test(migration) && /ordinary_post_cutoff_total/.test(migration)
  && /nonterminal_total/.test(migration),
  'aggregate census proves operations cannot grow past the recorded high-water');

const dormant = assessRetirement({ contract: 'syncview-retirement-admission-v1', mode: 'active' });
ok(dormant.ok && dormant.verdict === VERDICTS.DORMANT, 'unactivated installed contract is dormant and healthy');
const retired = assessRetirement({ contract: 'syncview-retirement-admission-v1', mode: 'retired', high_water_outbox_id: 42,
  ordinary_post_cutoff: {}, ordinary_post_cutoff_total: 0, nonterminal_total: 0, native_post_cutoff_total: 4, f27_post_cutoff_total: 1 });
ok(retired.ok && retired.verdict === VERDICTS.RETIRED, 'typed native/F27 receipts after high-water do not masquerade as ordinary debt');
const violation = assessRetirement({ contract: 'syncview-retirement-admission-v1', mode: 'retired', high_water_outbox_id: 42,
  ordinary_post_cutoff: { status: 1, comment: 2 }, ordinary_post_cutoff_total: 3, nonterminal_total: 3, native_post_cutoff_total: 0, f27_post_cutoff_total: 0 });
ok(!violation.ok && violation.verdict === VERDICTS.VIOLATION, 'any ordinary post-cutoff operation is a failure');
const mismatch = assessRetirement({ contract: 'syncview-retirement-admission-v1', mode: 'retired', high_water_outbox_id: 42,
  ordinary_post_cutoff: { due: 1 }, ordinary_post_cutoff_total: 0, nonterminal_total: 0, native_post_cutoff_total: 0, f27_post_cutoff_total: 0 });
ok(!mismatch.ok && mismatch.verdict === VERDICTS.UNREADABLE, 'a malformed census cannot report a clean boundary');
assert.equal(VERDICTS.VIOLATION, 'violation');

console.log(failures ? `syncview-retirement-admission: ${failures} check(s) failed` : 'syncview-retirement-admission checks passed');
process.exit(failures ? 1 : 0);
