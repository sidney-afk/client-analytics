'use strict';

// Offline guard for the private Hiring Process tab. The applicant form lives
// in iClosed, but its copied answers/videos must never move through the public
// Sales Intake transport or browser persistence layer.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SOURCE = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const start = SOURCE.indexOf('HIRING PROCESS (Kasper > More > Pipeline & Admin)');
const end = SOURCE.indexOf('function _siSerialize()', start);
const HIRING = start >= 0 && end > start ? SOURCE.slice(start, end) : '';

let failed = 0;
function ok(value, message) {
  if (value) console.log('  ok  ' + message);
  else { failed++; console.error('FAIL  ' + message); }
}

function functionSource(name) {
  const match = new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`).exec(SOURCE);
  if (!match) return '';
  const open = SOURCE.indexOf('{', match.index);
  let depth = 0;
  let quote = '';
  let escaped = false;
  for (let index = open; index < SOURCE.length; index++) {
    const char = SOURCE[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === "'" || char === '`') { quote = char; continue; }
    if (char === '{') depth++;
    else if (char === '}' && --depth === 0) return SOURCE.slice(match.index, index + 1);
  }
  return '';
}

ok(HIRING.length > 3000, 'the Hiring Process module is present as its own bounded UI surface');
ok(/const HIRING_APPLICATIONS_EF_URL = CAL_SUPABASE_URL \+ '\/functions\/v1\/hiring-applications';/.test(HIRING),
  'the browser calls the dedicated hiring Edge Function, not a public webhook');
ok(/key: 'hiring-process', label: 'Hiring Process'/.test(SOURCE)
  && /Pipeline & Admin', keys: \['sales-intake', 'hiring-process', 'onboarding', 'quiz-leads', 'client-credentials'\]/.test(SOURCE),
  'Hiring Process appears under Kasper > More > Pipeline & Admin after Sales Intake');
ok(/if \(capability === 'hiring'\) return role === 'admin';/.test(SOURCE)
  && /_syncviewRequireStaffIdentity\('hiring'\)/.test(HIRING)
  && /hiring-process' && !_syncviewStaffCan\('hiring'\)/.test(SOURCE),
  'the tab is admin-only in capability, request, and deep-link paths');
ok(/_syncviewEfHeaders\(\{ 'Content-Type': 'application\/json' \}, HIRING_APPLICATIONS_EF_URL\)/.test(HIRING),
  'the browser sends the existing staff-identity headers to the protected Edge Function');
ok(!HIRING.includes('SALES_INTAKE_SUBMIT_URL') && !HIRING.includes('_obPost('),
  'Hiring Process does not reuse Sales Intake’s unauthenticated n8n transport');
ok(!/localStorage|sessionStorage/.test(HIRING),
  'application answers, videos, and email previews are never persisted in browser storage');
ok(/data-hp-id="\$\{_hpEsc\(id\)\}" onclick="_hpSelect\(this\.dataset\.hpId\)"/.test(HIRING)
  && /const clean = _hpApplicationId\(id\);/.test(HIRING),
  'application identifiers are UUID-validated and never interpolated into executable click handlers');
ok(/AbortController/.test(HIRING) && /_hpState\.sending/.test(HIRING)
  && /disabled aria-disabled/.test(HIRING),
  'detail/action requests are abortable and duplicate clicks are disabled while an action is in flight');
ok(/Open applicant video/.test(HIRING) && /Open in iClosed/.test(HIRING)
  && /Interview invitation preview/.test(HIRING) && /Send interview invite/.test(HIRING)
  && /Retry interview invite/.test(HIRING),
  'the review detail exposes the video, original iClosed record, preview, and bounded invite/retry actions');
ok(/detail\.invites_enabled === true/.test(HIRING)
  && /Interview invitations are not enabled yet/.test(HIRING),
  'outbound invitation controls fail closed until the server-side kill switch is enabled');
ok(/action: 'queue_invite'/.test(HIRING)
  && /action: 'retry_invite'/.test(HIRING)
  && /detail\.retry_available === true/.test(HIRING)
  && /window\.confirm\('Retry this interview invitation/.test(HIRING)
  && /window\.confirm\('Mark this applicant as not moving forward/.test(HIRING)
  && /fetch\(HIRING_APPLICATIONS_EF_URL, \{/.test(HIRING)
  && (HIRING.match(/\bfetch\s*\(/g) || []).length === 1,
  'the browser confirms terminal/retry actions, uses the Edge Function, and never sends email or calls iClosed directly');

const goto = functionSource('_kasperGotoTab');
const render = functionSource('_kasperRenderTab');
ok(/tab === 'hiring-process' && !_syncviewStaffCan\('hiring'\)/.test(goto)
  && /tab === 'hiring-process' && !_syncviewStaffCan\('hiring'\)/.test(render),
  'stored navigation and direct hash routing cannot bypass the Hiring Process admin gate');

console.log(failed
  ? `\nhiring-process-ui: ${failed} failed`
  : '\nHiring Process UI checks passed');
process.exit(failed ? 1 : 0);
