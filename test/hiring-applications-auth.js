'use strict';

// Offline source/auth contract for the browser-callable hiring API. It must
// remain admin-only and queue delivery rather than impersonating a mailer.
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SOURCE = fs.readFileSync(path.join(ROOT, 'supabase/functions/hiring-applications/index.ts'), 'utf8');
const SHARED = path.join(ROOT, 'supabase/functions/_shared/staff-role-auth.ts');
let failed = 0;

function ok(value, message) {
  if (value) console.log('  ok  ' + message);
  else { failed++; console.error('FAIL  ' + message); }
}

const serveAt = SOURCE.indexOf('Deno.serve');
const handler = serveAt >= 0 ? SOURCE.slice(serveAt) : '';

ok(SOURCE.includes('../_shared/staff-role-auth.ts'), 'the hiring API uses the shared staff role-key gate');
ok(/"Access-Control-Allow-Origin": "https:\/\/syncview\.synchrosocial\.com"/.test(SOURCE)
  && /"Access-Control-Allow-Methods": "POST, OPTIONS"/.test(SOURCE)
  && /x-syncview-key, x-syncview-actor, x-syncview-role/.test(SOURCE),
  'CORS is pinned to SyncView and allows the browser’s staff headers');
ok(/authorizeStaffKey\(clean\(req\.headers\.get\("x-syncview-key"\)\), \["admin"\]\)/.test(handler)
  && /staffAuthFailureStatus\(auth\)/.test(handler),
  'only an admin role key may use the hiring API, with 401/403 distinctions');
ok(handler.indexOf('const auth = authorizeStaffKey') < handler.indexOf('await requestBody(req)')
  && handler.indexOf('const auth = authorizeStaffKey') < handler.indexOf('const db = serviceClient()'),
  'the handler authenticates before parsing JSON or constructing a service-role client');
ok(!/req\.headers\.get\(["']x-syncview-role["']\)/i.test(SOURCE)
  && !/req\.headers\.get\(["']x-syncview-actor["']\)/i.test(SOURCE),
  'spoofable actor/role headers never participate in authorization or audit attribution');
ok(/\["list", "detail", "set_status", "queue_invite", "retry_invite"\]/.test(SOURCE),
  'the browser API exposes only the bounded review actions');
ok(/configuredInterviewEventUrl\(\)/.test(SOURCE)
  && /p_recipient_email: preview\.recipient/.test(SOURCE)
  && /p_interview_event_url: interviewUrl/.test(SOURCE),
  'recipient and interview link are built server-side rather than accepted from the browser');
ok(/if \(!await invitesEnabled\(db\)\)/.test(SOURCE)
  && /feature_disabled/.test(SOURCE)
  && /interview_event_not_configured/.test(SOURCE),
  'the queue action fails closed when delivery or the known interview event is not configured');
ok(!/\bfetch\s*\(/.test(SOURCE) && !/gmail|sendgrid|mailgun/i.test(SOURCE),
  'the Edge Function does not call an email provider or send an invitation itself');
ok(/hiring_queue_interview_invite_v1/.test(SOURCE)
  && /hiring_retry_failed_invite_v1/.test(SOURCE)
  && /RETRYABLE_FAILURE_CODES/.test(SOURCE)
  && /retry_available/.test(SOURCE)
  && /state_conflict/.test(SOURCE),
  'the UI API uses durable queue/retry RPCs, exposes only bounded recovery data, and reports stale writes as conflicts');

// Exercise the real shared helper with dummy-only secrets. This proves the
// role matrix without reading a live staff key or touching a backend.
const helperUrl = pathToFileURL(SHARED).href + '?hiring-applications-auth';
const runner = `
  const { authorizeStaffKey, staffAuthFailureStatus } = await import(${JSON.stringify(helperUrl)});
  const secrets = { ROLE_KEY_ADMIN: 'dummy-admin', ROLE_KEY_SMM: 'dummy-smm', ROLE_KEY_CREATIVE: 'dummy-creative' };
  const getSecret = name => secrets[name];
  const check = key => { const auth = authorizeStaffKey(key, ['admin'], [], getSecret); return { ...auth, status: auth.ok ? 200 : staffAuthFailureStatus(auth) }; };
  process.stdout.write(JSON.stringify({ admin: check('dummy-admin'), smm: check('dummy-smm'), creative: check('dummy-creative'), wrong: check('wrong') }));
`;
const child = spawnSync(process.execPath, [
  '--no-warnings', '--experimental-strip-types', '--input-type=module', '--eval', runner,
], { encoding: 'utf8' });
ok(child.status === 0, child.status === 0
  ? 'shared role-key helper executed with dummy-only secrets'
  : `could not execute shared helper: ${child.stderr || child.stdout}`);
if (child.status === 0) {
  const matrix = JSON.parse(child.stdout);
  ok(matrix.admin.ok && matrix.admin.status === 200, 'admin role key is allowed');
  ok(!matrix.smm.ok && matrix.smm.status === 403 && !matrix.creative.ok && matrix.creative.status === 403,
    'SMM and Creative role keys are forbidden, not silently permitted');
  ok(!matrix.wrong.ok && matrix.wrong.status === 401, 'an unknown key is rejected as unauthorized');
}

console.log(failed
  ? `\nhiring-applications-auth: ${failed} failed`
  : '\nHiring applications auth checks passed');
process.exit(failed ? 1 : 0);
