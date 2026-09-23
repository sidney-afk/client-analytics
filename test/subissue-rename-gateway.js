'use strict';
/*
 * subissue-rename-gateway.js — release 2 of the card/sub-issue rename
 * (docs/ops/RENAME_PLAN.md, OPEN_REPAIRS 242): production-write `title`.
 *
 * Owner decisions pinned here:
 *   - admins, SMMs and editors can rename sub-issues; editors only the ones
 *     they can already edit (their team AND assigned to them, like status);
 *   - clients cannot;
 *   - only the NAME changes: the numbered prefix is recomposed by the one
 *     shared rule, and a free-form title never gains a number;
 *   - the card follows through the database outbox, never from the gateway.
 * The browser gate (_prodRoleCanWrite) must agree with the gateway's, or the
 * page offers a control the gateway refuses.
 */
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

(async () => {
  const policy = await import(pathToFileURL(path.join(ROOT, 'supabase/functions/production-write/policy.mjs')).href);
  let n = 0;
  const is = (a, b, m) => { assert.equal(a, b, m); n++; };

  is(policy.OPERATIONS.includes('title'), true, 'title is a gateway operation');
  is(policy.normalizeOperation('TITLE'), 'title', 'title normalizes');

  const own = { actorMemberId: 'm1', targetAssigneeId: 'm1' };
  const other = { actorMemberId: 'm1', targetAssigneeId: 'm2' };
  is(policy.staffOperationAllowed('admin', 'title', '', 'video'), true, 'admin renames');
  is(policy.staffOperationAllowed('smm', 'title', '', 'graphics'), true, 'smm renames');
  is(policy.staffOperationAllowed('creative', 'title', 'video', 'video', '', own), true, 'editor renames own assigned sub-issue');
  is(policy.staffOperationAllowed('creative', 'title', 'video', 'video', '', other), false, 'editor cannot rename someone else\'s');
  is(policy.staffOperationAllowed('creative', 'title', 'video', 'graphics', '', own), false, 'editor cannot rename another team\'s');
  is(policy.staffOperationAllowed('creative', 'title', '', 'video', '', own), false, 'no team, no rename');
  is(policy.staffOperationAllowed('creative', 'status', 'video', 'video', 'in_progress', other), false, 'status scope unchanged');
  is(policy.clientOperationAllowed('title', 'client_approval', ''), false, 'client cannot rename');

  const src = read('supabase/functions/production-write/index.ts');
  const surface = src.slice(src.indexOf('function assertSurfaceOperation'), src.indexOf('function assertSurfaceOperation') + 6000);
  assert.ok(/if \(operation === "title"\) \{[\s\S]{0,300}if \(surface !== "production"\) throw new GatewayError\(400, "invalid_surface_operation"\);/.test(surface),
    'title is a SyncLinear-only operation'); n++;
  const branch = src.slice(src.indexOf('} else if (operation === "title") {'), src.indexOf('} else if (operation === "title") {') + 2500);
  assert.ok(branch.length > 100, 'title branch present'); n++;
  assert.ok(/renameTitle\(existing\.title, nameValue\)/.test(branch), 'title composed by the shared rule from the stored title'); n++;
  assert.ok(/fingerprintPatch = \{ name: titleCleanName\(nameValue\) \}/.test(branch), 'retry fingerprint is the name, not the composed title'); n++;
  assert.ok(/entity !== "deliverable"/.test(branch), 'batches are not renamed here'); n++;
  const branchCode = branch.slice(0, branch.indexOf('} else {')).replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/calendar_posts|sample_reviews|\.from\(/.test(branchCode), 'the gateway never writes the card itself'); n++;
  assert.ok(/from "\.\.\/_shared\/title-name-rule\.mjs"/.test(src), 'imports the shared rule'); n++;

  const gate = read('src/index/220-production-attribution-views.js.part');
  assert.ok(/if \(operation === 'title'\) return _prodCreativeOwnsTarget\(issue\);/.test(gate), 'browser editor gate mirrors the gateway'); n++;
  const adopt = read('src/index/230-production-create-comments.js.part');
  assert.ok(/\['status', 'status_at', 'due_date', 'title',/.test(adopt), 'the page adopts the renamed title from the gateway row'); n++;
  const hook = read('src/index/260-production-refresh-boot.js.part');
  assert.ok(hook.includes('+ _prodDetailTitleHtml(d)'), 'issue page title goes through the rename control'); n++;

  console.log('subissue-rename-gateway: ' + n + ' checks passed ✅');
})().catch((e) => { console.error(e); process.exit(1); });
