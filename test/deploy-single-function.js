'use strict';
// The one-function deploy lane: its allowlist must never include a gated
// function, it is dispatch-only, and it deploys and attests exactly one slug.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const wf = fs.readFileSync(path.join(ROOT, '.github/workflows/deploy-single-function.yml'), 'utf8');
const preview = fs.readFileSync(path.join(ROOT, '.github/workflows/native-notification-preview.yml'), 'utf8');

const EXPECTED = ['analytics-market-research-collect', 'analytics-metrics-collect', 'analytics-read', 'analytics-top-videos-collect', 'analytics-write', 'brain', 'caption-jobs', 'client-hubspot-sync', 'client-onboarding', 'client-profile-write', 'filming-plan-tabs', 'higgsfield-mcp', 'instagram-upload', 'notify', 'roster-read', 'roster-write', 'syncview-session', 'tiktok-upload', 'tiktok-upload-cancel', 'workload-plan', 'write-diagnostics'];
// These stay on their own gated lanes (Section 4 sealed bundle, pinned inbound
// bundle), and the two client writers are FROZEN by owner directive (AGENTS.md):
// their repo source re-gates client links, so deploying it 401s every client.
const GATED = ['production-write', 'deliverable-write', 'batch-write', 'linear-outbound', 'linear-inbound',
  'calendar-upsert', 'sample-review-upsert'];

const choice = (wf.match(/options:\s*\[([^\]]*)\]/) || [])[1];
assert(choice, 'function input is a choice list');
const options = choice.split(',').map(s => s.trim()).filter(Boolean);
const guard = (wf.match(/case "\$DEPLOY_FUNCTION" in\s*\n\s*([^)]+)\)/) || [])[1];
assert(guard, 'the shell re-checks the allowlist');
const guarded = guard.split('|').map(s => s.trim());
const loop = (wf.match(/for fn in ([^;]+); do/) || [])[1];
assert(loop, 'deploy step lists its slugs');
const looped = loop.trim().split(/\s+/);

for (const [name, list] of [['choice', options], ['shell guard', guarded], ['deploy loop', looped]]) {
  assert.deepEqual([...list].sort(), [...EXPECTED].sort(), name + ' matches the reviewed allowlist');
  for (const gated of GATED) assert(!list.includes(gated), name + ' must never include gated ' + gated);
}
for (const gated of GATED) assert(!new RegExp('\\b' + gated + '\\b').test(wf.replace(/^#.*$/gm, '').replace(/^\s*#.*$/gm, '')), gated + ' appears nowhere outside comments');
for (const slug of EXPECTED) assert(fs.existsSync(path.join(ROOT, 'supabase/functions', slug, 'index.ts')), slug + ' exists');

assert(/^on:\n  workflow_dispatch:\n/m.test(wf) && !/^  (push|schedule|pull_request):/m.test(wf), 'dispatch only');
assert(wf.includes('environment: production'), 'runs in the protected production Environment');
assert(wf.includes('^[0-9a-f]{40}$') && wf.includes('git merge-base --is-ancestor "$DEPLOY_COMMIT" origin/main'), 'exact main-ancestor SHA');
assert(wf.indexOf('merge-base --is-ancestor') < wf.indexOf('ref: ${{ env.DEPLOY_COMMIT }}'), 'ancestry proven before the dispatched tree is checked out');
assert(!/^    env:[\s\S]*?SUPABASE_ACCESS_TOKEN[\s\S]*?steps:/m.test(wf), 'token is never job-wide');
assert.equal((wf.match(/supabase functions deploy/g) || []).length, 1, 'one deploy command');
assert(wf.includes('--no-verify-jwt') && wf.includes('test "$deployed" = 1'), 'exactly one function, no JWT verification');
// Server-side bundling: no Docker image pull (ghcr rate limits failed this lane),
// and the post-deploy fingerprint still proves live source == committed bytes.
assert(/supabase functions deploy "\$fn" --project-ref "\$PROJECT_REF" --no-verify-jwt --use-api\n/.test(wf) && !wf.includes('--use-docker'), 'bundles server-side with --use-api, never Docker');
assert(wf.includes('scripts/ef-fingerprint.js "$DEPLOY_COMMIT" --slugs="$DEPLOY_FUNCTION" --format=json') && wf.includes('x.result!=="PASS"'), 'attests that one function');
assert(!/always\(\)/.test(wf.replace(/^\s*#.*$/gm, "")), 'attestation is never produced after a failed step');
assert(!/secrets\.(?!SUPABASE_ACCESS_TOKEN\b)/.test(wf), 'uses no secret besides the existing access token');

// client-onboarding must not deploy before its checklist migration is applied.
assert(wf.includes("inputs.function == 'client-onboarding'") && wf.includes('client_onboarding_set_step(text,text,text,text,text,text,text,timestamptz,text)'), 'client-onboarding has a schema preflight');
assert(wf.indexOf('Refuse client-onboarding until') < wf.indexOf('name: Deploy the one selected function'), 'schema preflight runs before the deploy');

// client-hubspot-sync must not deploy before its database functions exist.
assert(wf.includes("inputs.function == 'client-hubspot-sync'") && wf.includes('client_sales_state_apply(text,text,text,text,text,text,text,text,text)'), 'client-hubspot-sync has a schema preflight');
assert(wf.indexOf('Refuse client-hubspot-sync until') < wf.indexOf('name: Deploy the one selected function'), 'hubspot schema preflight runs before the deploy');

// Preview lane: dispatch-only, existing secrets, slug typed at dispatch, counts only.
assert(/^on:\n  workflow_dispatch:\n/m.test(preview) && !/^  (push|schedule):/m.test(preview), 'preview is dispatch only');
assert(preview.includes('"action":"preview"') || preview.includes('action:"preview"'), 'calls the preview action');
assert(preview.includes('secrets.NATIVE_NOTIFICATION_RUNNER_KEY') && preview.includes('secrets.NATIVE_NOTIFICATION_NOTIFY_URL'), 'existing runner secrets');
assert(!/echo "\$response"|cat .*response/.test(preview), 'never prints the raw response');

console.log('DEPLOY_SINGLE_FUNCTION_OK: allowlist ' + EXPECTED.length + ', gated refused ' + GATED.length + ', dispatch-only, one deploy, one attestation');
