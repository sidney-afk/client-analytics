'use strict';
/*
 * REGRESSION GUARD: a Higgsfield create that Higgsfield did not clearly refuse
 * stays counted, so asking again cannot start and pay for a second job
 * (OPEN_REPAIRS 398, Digger bug archaeology 2026-10-10).
 *
 * The connector recorded every non-success answer, and a success with no job
 * id, as submit_failed, which the ten-minute duplicate check and the monthly
 * budget both skip. A 5xx from a gateway that timed out after Higgsfield took
 * the job then read as "refused", and the same request sent again started a
 * second paid job. Now only a 4xx (or a missing API key) is submit_failed;
 * the rest is submit_unknown, which both checks count.
 *
 * Static checks (the connector runs under Deno, not in this unit lane).
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'supabase/functions/higgsfield-mcp/index.ts'), 'utf8');
const sql = fs.readFileSync(path.join(ROOT, 'migrations/2026-09-28-higgsfield-team-connector.sql'), 'utf8');

const at = src.indexOf('const res = await hf("POST", id, inputs);');
assert.ok(at > 0, 'the create call is where this test expects it');
const branch = src.slice(at, src.indexOf('await client.from("hf_generations").update({ request_id: requestId', at));
assert.ok(/const refused = \(res\.status >= 400 && res\.status < 500\) \|\| !Deno\.env\.get\("HIGGSFIELD_KEY"\);/.test(branch),
  'only a 4xx (or no API key) counts as a refusal');
assert.ok(/status: refused \? "submit_failed" : "submit_unknown"/.test(branch), 'anything else is recorded as submit_unknown');
assert.ok(/do not send it again/.test(branch), 'and the person is told not to send it again');
assert.ok(!/status: "submit_failed", error: why/.test(branch), 'the unconditional submit_failed is gone');

// submit_unknown must stay inside both counts.
for (const m of sql.matchAll(/status not in \(([^)]*)\)/g)) assert.ok(!/submit_unknown/.test(m[1]), 'the database duplicate and budget checks count submit_unknown');
for (const m of src.matchAll(/!\[([^\]]*)\]\.includes\(String\(r\.status\)\)/g)) assert.ok(!/submit_unknown/.test(m[1]), 'the connector\'s own spend sum counts submit_unknown');

console.log('higgsfield-create-unconfirmed: an unconfirmed Higgsfield create stays counted, so it cannot be paid for twice ✅');
