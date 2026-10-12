'use strict';
// The legacy Production fast lane is live-reading. This branch's PR must not
// start it; unrelated and scheduled lanes keep their existing policy.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const workflow=fs.readFileSync(path.join(__dirname,'../.github/workflows/production-polish-gate.yml'),'utf8');
const job=workflow.split('\n  production-polish:\n')[1]?.split('\n  production-polish-interaction:')[0];
const condition=job?.match(/^    if: (.+)$/m)?.[1].replace('needs.schedule-guard.outputs.run','run');
assert(condition,'Production fast job condition missing');
const run=(event,branch,allowed='true')=>vm.runInNewContext(condition,{run:allowed,github:{event_name:event,head_ref:branch}},{timeout:100});
assert.equal(run('pull_request','prism/staff-tabs-grid'),false,'Phone grid PR would start unscoped live Production tests');
assert.equal(run('pull_request','another-source-branch'),true,'Unrelated PR policy changed');
assert.equal(run('push',''),true,'Main push policy changed');
assert.equal(run('schedule',''),true,'Scheduled policy changed');
assert.equal(run('schedule','','false'),false,'Schedule fallback guard bypassed');
console.log('phone-tabs-ci-read-boundary: protected PR cannot start live Production fast lane; other event policies preserved');
