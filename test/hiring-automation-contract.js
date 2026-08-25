'use strict';

// Offline contract for the server-to-server bridge used by the isolated n8n
// hiring workflows. This function is deliberately not browser-callable and
// must never become a hidden mailer or a broad service-role passthrough.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SOURCE = fs.readFileSync(path.join(ROOT, 'supabase/functions/hiring-automation/index.ts'), 'utf8');
const CONFIG = fs.readFileSync(path.join(ROOT, 'supabase/config.toml'), 'utf8');
const AUTHORIZE_SQL = fs.readFileSync(path.join(ROOT, 'migrations/2026-08-25-hiring-invite-send-authorization.sql'), 'utf8');
let failed = 0;

function ok(value, message) {
  if (value) console.log('  ok  ' + message);
  else { failed++; console.error('FAIL  ' + message); }
}

const serveAt = SOURCE.indexOf('Deno.serve');
const handler = serveAt >= 0 ? SOURCE.slice(serveAt) : '';

ok(/\[functions\.hiring-automation\]\s*verify_jwt = false/s.test(CONFIG),
  'the private bridge has an explicit transport posture in Supabase config');
ok(/Deno\.env\.get\("HIRING_AUTOMATION_KEY"\)/.test(SOURCE)
  && /x-hiring-automation-key/.test(SOURCE)
  && /constantTimeEqual/.test(SOURCE),
  'every bridge request needs the dedicated server-to-server key');
ok(handler.indexOf('requireAutomationKey(req)') < handler.indexOf('await bodyOf(req)')
  && handler.indexOf('requireAutomationKey(req)') < handler.indexOf('serviceClient()'),
  'authentication happens before parsing applicant data or constructing a service-role client');
ok(!/Access-Control-Allow-Origin|Access-Control-Allow-Headers|OPTIONS/.test(SOURCE),
  'the bridge exposes no browser CORS surface');
ok(/new TextEncoder\(\)\.encode\(raw\)\.byteLength/.test(SOURCE)
  && /content-length/.test(SOURCE),
  'the private request limit is enforced in UTF-8 bytes and rejects an oversized declared body before parsing');
ok(/\["capture_application", "claim_invite", "authorize_invite_send", "record_invite", "record_booking"\]/.test(SOURCE) === false
  && /action === "capture_application"/.test(handler)
  && /action === "claim_invite"/.test(handler)
  && /action === "authorize_invite_send"/.test(handler)
  && /action === "record_invite"/.test(handler)
  && /action === "record_booking"/.test(handler),
  'the bridge accepts only the five bounded capture/delivery receipt actions');
ok(/APPLICATION_EVENT_SLUG = "client-success-content-manager-application"/.test(SOURCE)
  && /INTERVIEW_EVENT_SLUG = "client-success-content-manager-interview"/.test(SOURCE)
  && /p_source_event_slug: APPLICATION_EVENT_SLUG/.test(SOURCE)
  && /p_source_event_slug: INTERVIEW_EVENT_SLUG/.test(SOURCE),
  'application and booking writes are pinned to the two dedicated iClosed events');
ok(/normalizedAnswers\(body\.answers\)/.test(SOURCE)
  && /value\.length < 10/.test(SOURCE)
  && /requiredUrl\(body, "videoUrl"\)/.test(SOURCE)
  && /requiredTimestamp\(body, "sourceUpdatedAt"\)/.test(SOURCE),
  'capture rejects partial submissions before reaching the database RPC');
ok(/hiring_capture_application_v1/.test(SOURCE)
  && /hiring_claim_next_invite_v1/.test(SOURCE)
  && /hiring_authorize_invite_send_v1/.test(SOURCE)
  && /hiring_record_invite_result_v1/.test(SOURCE)
  && /hiring_record_interview_booking_v1/.test(SOURCE),
  'the bridge may call only the five dedicated hiring RPC contracts');
ok(/DISPATCHER_WORKER_ID = "hiring-invite-dispatch-v1"/.test(SOURCE)
  && /p_worker_id: DISPATCHER_WORKER_ID/.test(SOURCE)
  && /missing_provider_receipt/.test(SOURCE),
  'the dispatcher worker identity is server-owned and the database receipt gate is surfaced safely');
const claimStart = SOURCE.indexOf('async function claimInvite');
const authorizeStart = SOURCE.indexOf('async function authorizeInviteSend');
const claimSource = claimStart >= 0 && authorizeStart > claimStart ? SOURCE.slice(claimStart, authorizeStart) : '';
ok(!/recipient:|subject:|body:|interviewEventUrl:/.test(claimSource)
  && /authorized: true/.test(SOURCE)
  && /recipient: requiredEmail\(row, "recipient_email"\)/.test(SOURCE),
  'only the single-use pre-send authorization releases the durable email envelope to n8n');
ok(/create or replace function public\.hiring_authorize_invite_send_v1/.test(AUTHORIZE_SQL)
  && /value = '\{"enabled": true\}'::jsonb/.test(AUTHORIZE_SQL)
  && /for share/.test(AUTHORIZE_SQL)
  && /send_authorized_at/.test(AUTHORIZE_SQL)
  && /send_already_authorized/.test(AUTHORIZE_SQL)
  && /hiring_invite_jobs_require_send_auth/.test(AUTHORIZE_SQL)
  && /send_not_authorized/.test(AUTHORIZE_SQL)
  && /return query select false/.test(AUTHORIZE_SQL),
  'the pre-send SQL gate uses a strict flag, a claim-scoped one-shot marker, a sent-state trigger, and a no-send requeue result');
ok(!/\bfetch\s*\(/.test(SOURCE),
  'the bridge never calls email, messaging, or iClosed providers directly');

console.log(failed
  ? `\nhiring-automation-contract: ${failed} failed`
  : '\nHiring automation contract checks passed');
process.exit(failed ? 1 : 0);
