'use strict';
/*
 * The gateway's open-work count lives in the DATABASE as of 2026-09-19
 * (`production_native_intake_open_load`), so a disposable fixture that runs
 * intake or the Create Post editor picker has to install it. Without it the
 * gateway refuses — which is the correct behaviour against a database the
 * migration has not been applied to, and the reason the migration is a
 * deployment PREREQUISITE rather than a follow-up.
 *
 * SCOPED TO THE INTAKE LANES ON PURPOSE. The first version of this installed
 * out of `scripts/native-intake-manifest/harness.js`, so every lane on that
 * harness got it — including four that install the REAL
 * `production_deliverables_browser_v1` from `2026-07-23-f34-f53-production-
 * attachments.sql` a moment later, which then failed with `relation ...
 * already exists`. A fixture helper must not install what a lane's own
 * migration chain installs.
 *
 * Two objects, both taken VERBATIM from the repository rather than modelled:
 *
 *  - the browser projection's real `raw_issue_parent_id` CASE. The intake
 *    chains omit that view, and a `language sql` function is parsed and
 *    validated at CREATE time, so the view has to exist first. Only the six
 *    columns these lanes consume are projected; artifact, label and attribution
 *    columns stay outside the fixture. This block was inline in
 *    test/native-intake-editor-projection.js before the count moved into SQL.
 *
 *  - the migration's own function body, located by its declaration and closing
 *    dollar tag. Its `revoke`/`grant` lines are deliberately NOT applied: they
 *    name hosted roles a disposable cluster does not have, and the ACL is what
 *    the deploy preflight proves against the real database.
 *
 * Both seams throw on drift rather than quietly installing something else.
 *
 * `test/native-assignee-eligibility.js` carries an INLINE twin of this inside
 * its `applyChain`, and has to: two other suites read that function's source
 * and re-evaluate it with only `fs`, `path` and `__dirname` bound, so it cannot
 * require this module. Change one, change the other.
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');

function installIntakeOpenLoad(cluster) {
  const view = fs.readFileSync(path.join(ROOT, 'migrations/2026-08-23-attribution-slug-guard-widening.sql'), 'utf8');
  const parentEnd = view.indexOf('END AS raw_issue_parent_id');
  const parentStart = view.lastIndexOf('CASE', parentEnd);
  if (parentStart < 0 || parentEnd < parentStart) throw new Error('browser-view parent expression drift');
  cluster.exec(`create view public.production_deliverables_browser_v1 as
    select d.id,d.assignee_id,d.linear_issue_uuid,d.team,d.status,${view.slice(parentStart, parentEnd + 'END AS raw_issue_parent_id'.length)}
    from public.deliverables d cross join lateral jsonb_to_record(
      case when jsonb_typeof(d.linear_raw)='object' then d.linear_raw else '{}'::jsonb end) root(issue jsonb);`);
  const migration = fs.readFileSync(path.join(ROOT, 'migrations/2026-09-19-native-intake-open-load.sql'), 'utf8');
  const start = migration.indexOf('create function public.production_native_intake_open_load(');
  const end = migration.indexOf('$fn$;', start);
  if (start < 0 || end < start) throw new Error('open-load function seam drift');
  cluster.exec(migration.slice(start, end + '$fn$;'.length));
}

module.exports = { installIntakeOpenLoad };
