'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const MOCK = read('qa/pto-lifecycle/mock-backend.js');
const HARNESS = read('qa/pto-lifecycle/harness.js');
const SCENARIOS = read('qa/pto-lifecycle/scenarios.js');
const UI = read('qa/pto-lifecycle/ui.js');
const REVIEW = read('qa/pto-lifecycle/review.js');
const RUN = read('qa/pto-lifecycle/run.js');
const LIVE = read('qa/pto-lifecycle/live-drill.js');
const PACKAGE = JSON.parse(read('package.json'));
const WORKFLOW = read('.github/workflows/pto-ui-tests.yml');
const {
  canonicalSourceText,
  ptoSourceSlice,
  validatePublicEvidence,
  validateVisualReviewSchema,
} = require(path.join(
  ROOT,
  'qa',
  'pto-lifecycle',
  'review.js',
));

let passed = 0;
let failed = 0;
function ok(condition, message) {
  if (condition) {
    passed += 1;
    console.log('OK  ' + message);
  } else {
    failed += 1;
    console.log('FAIL ' + message);
  }
}

ok(canonicalSourceText('alpha\r\nbeta\rgamma\n') === 'alpha\nbeta\ngamma\n'
  && /hash\.update\(canonicalSourceText\(text\)\)/.test(RUN)
  && ptoSourceSlice('x pto-wrap y\r\nz\r\n') === ptoSourceSlice('x pto-wrap y\nz\n'),
'PTO evidence source fingerprints are line-ending stable across Windows and CI (incl. the index.html PTO slice)');

ok(PACKAGE.scripts['test:pto-lifecycle'] === 'node qa/pto-lifecycle/run.js'
  && PACKAGE.scripts['test:pto-live-drill'] === 'node qa/pto-lifecycle/live-drill.js',
'package scripts keep mocked and live PTO lifecycle lanes separate');

ok(/qa\/pto-lifecycle\/\*\*/.test(WORKFLOW)
  && /npm run test:pto-lifecycle/.test(WORKFLOW)
  && /--validate-public-evidence/.test(WORKFLOW)
  && !/npm run test:pto-live-drill/.test(WORKFLOW),
'PTO CI runs the mocked lifecycle and committed-evidence gates but can never dispatch the live lane');

ok(/supabase['"], ['"]functions['"], ['"]pto['"], ['"]policy\.js/.test(MOCK)
  && /computePtoBalance/.test(MOCK)
  && /countPtoDays/.test(MOCK)
  && /ptoPolicyToday/.test(MOCK),
'mocked lifecycle derives policy truth from the production PTO policy module');

ok(/TEST PTO Staff Alpha/.test(MOCK)
  && /TEST PTO Staff Beta/.test(MOCK)
  && /SHARED_CREATIVE_KEY/.test(MOCK)
  && /TEST PTO Administrator/.test(MOCK),
'mocked lane carries two same-role synthetic staff personas and one synthetic admin');

for (const requirement of [
  'wellness_request',
  'sick_backdated_request',
  'floating_holiday_request',
  'unpaid_request',
  'quote_near',
  'quote_far',
  'pending_cancel',
  'approve_with_note',
  'deny_with_note',
  'admin_cancel_future_approved',
  'floating_second_blocked',
  'insufficient_balance',
  'inactive_approval_blocked',
  'http_500_retry',
  'connection_drop_lock',
  'post_commit_loss_reconcile',
  'delayed_inflight',
  'hung_request_lock',
  'double_click_single_call',
  'two_tab_stale_then_refresh',
  'sign_out_in_mid_flow',
  'mobile_390',
  'keyboard_only',
  'month_rollover',
  'tenure_rate_change',
  'anniversary_reset',
  'guatemala_evening_boundary',
]) {
  ok(SCENARIOS.includes(`'${requirement}'`), `lifecycle coverage ledger includes ${requirement}`);
}

ok(/page\.screenshot\([\s\S]*animations: 'disabled'[\s\S]*caret: 'hide'/.test(HARNESS)
  && /SYNTHETIC PTO TEST · NO REAL DATA/.test(HARNESS),
'every mocked action/result frame uses deterministic capture and a synthetic-data banner');

ok(/meaningfulTextBlockers/.test(HARNESS)
  && /Node\.TEXT_NODE/.test(HARNESS)
  && /\.header \*, \.kasper-head \*, \.pto-wrap \*, \.pto-admin \*/.test(HARNESS)
  && /\.confirm-overlay\.active \.confirm-box/.test(HARNESS)
  && /button:not\(\[hidden\]\), a\[href\]/.test(HARNESS)
  && /ptoLifecycleClockCue/.test(HARNESS)
  && /setSyntheticClockCue\(page, instant/.test(SCENARIOS)
  && /policy date/.test(SCENARIOS),
'synthetic evidence avoids covering PTO meaning and labels every time-travel checkpoint with its clock');

ok(!/<div class="grid">\\n\\s+\\$\\{flow\.shots/.test(REVIEW),
'generated lifecycle galleries do not introduce whitespace-only lines');

ok(/window\.visualViewport/.test(HARNESS)
  && /viewportLeft/.test(HARNESS)
  && /visualViewport\?\.width \|\| innerWidth/.test(SCENARIOS)
  && /touchscreen\.tap\(point\.x, point\.y\)/.test(UI)
  && /calendar month navigation remains inside the current visual viewport/.test(SCENARIOS),
'mobile screenshots and containment assertions use the real visual viewport');

ok(/screenshot target is visible/.test(HARNESS)
  && /staffRequestRowLocator\(page, \{ \.\.\.mobileRequest, status: 'pending' \}\)/.test(SCENARIOS)
  && /tap open the mobile staff menu/.test(SCENARIOS)
  && /decisionNote: 'TEST mobile approval'/.test(SCENARIOS),
'every requested screenshot target must be visible, including exact mobile result cards');

ok(!/_ptoSetFlagValue/.test(HARNESS)
  && /runtime_flag_read/.test(SCENARIOS)
  && /locator\('#navKasper'\)\.click/.test(HARNESS)
  && /locator\('\[data-kasper-more-trigger\]'\)/.test(HARNESS)
  && /#kasperMoreMenu \.kasper-more-item\[data-kasper-tab="time-off"\]/.test(HARNESS),
'mocked entry uses the normal pto_v1 read, staff menu, and real Kasper More navigation');

ok(/options\.keyboard/.test(HARNESS)
  && /tabToControl\(page, '#headerMenuButton'\)/.test(HARNESS)
  && /tabToControl\(page, '#navKasper'\)/.test(HARNESS)
  && /tabToControl\(page, '\[data-kasper-more-trigger\]'\)/.test(HARNESS)
  && /page\.keyboard\.press\('ArrowDown'\)/.test(HARNESS)
  && /openStaff\(staff, p, \{ keyboard: true \}\)/.test(SCENARIOS)
  && /openAdmin\(admin, p, \{ keyboard: true \}\)/.test(SCENARIOS),
'keyboard-only journey enters staff Time Off and Kasper through natural tab navigation');

ok(/open branded request-type menu/.test(SCENARIOS)
  && /open branded start-date calendar/.test(SCENARIOS)
  && /decrease the quoted day count/.test(SCENARIOS)
  && /tap the mobile calendar next-month arrow/.test(SCENARIOS)
  && /open approved-leave cancellation confirmation/.test(SCENARIOS)
  && /open pending-request cancellation confirmation/.test(SCENARIOS),
'transient branded controls and confirmations receive action-result screenshots');

ok(/expected_visible_result/.test(REVIEW)
  && /visual_verdict/.test(REVIEW)
  && /VISUAL_VERDICTS = new Set\(\['ok', 'warning', 'broken', 'pending_visual_review'\]\)/.test(REVIEW)
  && /REVIEW_ENTRY_KEYS = \['note', 'sha256', 'verdict'\]/.test(REVIEW)
  && /Orphan PTO visual review entry/.test(REVIEW)
  && /reviewed\.sha256 === shot\.sha256/.test(REVIEW)
  && /requires a note for/.test(REVIEW)
  && /readVisualReviewFile/.test(REVIEW)
  && /assertPublicTextSafe/.test(REVIEW)
  && /email address/.test(REVIEW)
  && /role-key literal/.test(REVIEW)
  && /source_tree_sha256/.test(REVIEW)
  && /visual_review_complete/.test(REVIEW)
  && /object-fit:contain/.test(REVIEW),
'review packet records expected visible results, visual verdicts, hashes, and public-text privacy checks');

ok(/sourceTreeFingerprint/.test(RUN)
  && /visual-review\.json/.test(RUN)
  && /file !== 'visual-review\.json'/.test(RUN)
  && /public-stage/.test(RUN)
  && /reviewedCandidate/.test(RUN)
  && /publishReviewedCandidate/.test(RUN)
  && /Private PTO lifecycle candidate is stale for the current source/.test(RUN)
  && /fs\.copyFileSync\(shot\.path, stagedPath\)/.test(RUN)
  && /publishStagedEvidence/.test(RUN)
  && /fs\.renameSync\(publicArtifactDir, backupDir\)/.test(RUN)
  && /visual_review_complete/.test(RUN)
  && /--validate-public-evidence/.test(RUN)
  && /manifest\.json/.test(RUN)
  && /VISUAL_REVIEW\.md/.test(RUN)
  && /if \(updatePublic\) \{\s*publishReviewedCandidate\(\);\s*return;/.test(RUN)
  && !/cleanPrivateDirectory\(publicArtifactDir\)/.test(RUN),
'public evidence publishes the exact reviewed candidate, validates current source, and atomically preserves authored files');

let strictReviewPassed = true;
try {
  validateVisualReviewSchema({
    'synthetic-frame.jpg': {
      sha256: 'a'.repeat(64),
      verdict: 'ok',
      note: '',
    },
  });
} catch (_) {
  strictReviewPassed = false;
}
ok(strictReviewPassed, 'strict visual-review schema accepts a hash-bound object verdict');

for (const [label, value] of [
  ['bare-string verdict', { 'synthetic-frame.jpg': 'ok' }],
  ['warning without note', {
    'synthetic-frame.jpg': { sha256: 'a'.repeat(64), verdict: 'warning', note: '' },
  }],
  ['unexpected field', {
    'synthetic-frame.jpg': {
      sha256: 'a'.repeat(64), verdict: 'ok', note: '', unsafe_extra: 'x',
    },
  }],
]) {
  let rejected = false;
  try {
    validateVisualReviewSchema(value);
  } catch (_) {
    rejected = true;
  }
  ok(rejected, `strict visual-review schema rejects ${label}`);
}

const validatorFixture = fs.mkdtempSync(path.join(os.tmpdir(), 'pto-evidence-validator-'));
try {
  const fixtureScreenshots = path.join(validatorFixture, 'screenshots');
  const fixtureReview = path.join(validatorFixture, 'visual-review.json');
  fs.mkdirSync(fixtureScreenshots);
  const fixtureScreenshot = path.join(fixtureScreenshots, 'synthetic-frame.jpg');
  fs.writeFileSync(fixtureScreenshot, 'synthetic screenshot bytes');
  const fixtureHash = crypto.createHash('sha256')
    .update(fs.readFileSync(fixtureScreenshot))
    .digest('hex');
  const fixtureRelative = 'screenshots/synthetic-frame.jpg';
  const fixtureShot = {
    scenario: 'synthetic-fixture',
    step: 1,
    action: 'show synthetic fixture',
    expected_visible_result: 'Synthetic fixture is visible.',
    persona: 'TEST',
    profile: 'desktop',
    viewport: { width: 1, height: 1 },
    file: fixtureRelative,
    sha256: fixtureHash,
    visual_verdict: 'ok',
    visual_note: '',
  };
  fs.writeFileSync(fixtureReview, JSON.stringify({
    'synthetic-frame.jpg': { sha256: fixtureHash, verdict: 'ok', note: '' },
  }));
  fs.writeFileSync(path.join(validatorFixture, 'manifest.json'), JSON.stringify({
    source_tree_sha256: 'b'.repeat(64),
    screenshot_count: 1,
    visual_review_complete: true,
    visual_verdict_counts: { ok: 1 },
    flows: [{ scenario: 'synthetic-fixture', shots: [fixtureShot] }],
  }));
  fs.writeFileSync(path.join(validatorFixture, 'gallery.html'), fixtureRelative);
  fs.writeFileSync(path.join(validatorFixture, 'VISUAL_REVIEW.md'), fixtureRelative);
  let validPacket = false;
  try {
    validPacket = validatePublicEvidence(validatorFixture, {
      sourceTreeSha256: 'b'.repeat(64),
      visualReviewFile: fixtureReview,
    }).screenshotCount === 1;
  } catch (_) {}
  ok(validPacket, 'no-browser evidence validator accepts a complete current hash-bound packet');

  fs.appendFileSync(fixtureScreenshot, 'tamper');
  let tamperRejected = false;
  try {
    validatePublicEvidence(validatorFixture, {
      sourceTreeSha256: 'b'.repeat(64),
      visualReviewFile: fixtureReview,
    });
  } catch (error) {
    tamperRejected = /hash mismatch/.test(error.message);
  }
  ok(tamperRejected, 'no-browser evidence validator rejects changed screenshot bytes');

  fs.writeFileSync(fixtureScreenshot, 'synthetic screenshot bytes');
  fs.writeFileSync(fixtureReview, JSON.stringify({
    'synthetic-frame.jpg': { sha256: 'c'.repeat(64), verdict: 'ok', note: '' },
  }));
  let staleReviewRejected = false;
  try {
    validatePublicEvidence(validatorFixture, {
      sourceTreeSha256: 'b'.repeat(64),
      visualReviewFile: fixtureReview,
    });
  } catch (error) {
    staleReviewRejected = /visual review does not match/.test(error.message);
  }
  ok(staleReviewRejected, 'no-browser evidence validator rejects a stale review hash');

  fs.writeFileSync(fixtureReview, JSON.stringify({
    'synthetic-frame.jpg': { sha256: fixtureHash, verdict: 'ok', note: '' },
    'orphan-frame.jpg': { sha256: 'd'.repeat(64), verdict: 'ok', note: '' },
  }));
  let orphanReviewRejected = false;
  try {
    validatePublicEvidence(validatorFixture, {
      sourceTreeSha256: 'b'.repeat(64),
      visualReviewFile: fixtureReview,
    });
  } catch (error) {
    orphanReviewRejected = /Orphan PTO visual review entry/.test(error.message);
  }
  ok(orphanReviewRejected, 'no-browser evidence validator rejects orphan review entries');

  fs.writeFileSync(fixtureReview, JSON.stringify({
    'synthetic-frame.jpg': {
      sha256: fixtureHash,
      verdict: 'warning',
      note: 'send to private@example.com',
    },
  }));
  let unsafeReviewRejected = false;
  try {
    validatePublicEvidence(validatorFixture, {
      sourceTreeSha256: 'b'.repeat(64),
      visualReviewFile: fixtureReview,
    });
  } catch (error) {
    unsafeReviewRejected = /privacy validation/.test(error.message);
  }
  ok(unsafeReviewRejected, 'no-browser evidence validator privacy-scans the raw review JSON');
} finally {
  fs.rmSync(validatorFixture, { recursive: true, force: true });
}

ok(/PTO_LIVE_CONFIRM/.test(LIVE)
  && /DISPOSABLE_UNPAID_ONLY/.test(LIVE)
  && /Both live drill identities must be dedicated TEST roster rows/.test(LIVE),
'live lane fails closed without the exact confirmation and dedicated TEST identities');

ok(/locator\('\[data-kasper-more-trigger\]'\)/.test(LIVE)
  && /#kasperMoreMenu \.kasper-more-item\[data-kasper-tab="time-off"\]/.test(LIVE)
  && /released More menu/.test(LIVE),
'live lane reaches Kasper Time Off through the released More menu');

ok(/exactMarkerFilters/.test(LIVE)
  && /member_id=eq\./.test(LIVE)
  && /source=eq\.syncview/.test(LIVE)
  && /note=eq\./.test(LIVE)
  && /method: 'DELETE'/.test(LIVE)
  && /exact disposable request cleanup must leave zero request-row residue/.test(LIVE)
  && /duplicateDetected/.test(LIVE)
  && /finally \{[\s\S]*exactCleanup/.test(LIVE),
'live cleanup is exact member/source/marker scoped even without a response ID, removes duplicates, and runs in finally');

ok(/quoteAttempts >= 4/.test(LIVE)
  && /requestAttempts !== 0/.test(LIVE)
  && /decideAttempts !== 0/.test(LIVE)
  && /blockedOperations/.test(LIVE)
  && /body\.type === 'unpaid'/.test(LIVE)
  && /body\.decision === 'approved'/.test(LIVE)
  && /cancel, adjust, set_start_date/.test(LIVE),
'live lane enforces exact read/action payloads and one request plus one approval write budget');

ok(/pendingReadback/.test(LIVE)
  && /approvedReadback/.test(LIVE)
  && /exactDrillRows/.test(LIVE)
  && /PTO live disposable cleanup failed/.test(LIVE)
  && /PTO live runtime-flag readback failed/.test(LIVE),
'live lane proves pending and approved states and still performs cleanup and flag readback after failures');

ok(/syncview_runtime_flags/.test(LIVE)
  && /JSON\.stringify\(afterRows\[0\]\.value\) === beforeFlag/.test(LIVE)
  && !/(?:insert|update|delete)[\s\S]{0,100}syncview_runtime_flags/i.test(LIVE),
'live lane reads and fingerprints pto_v1 without a flag write');

ok(/PRIVATE_ROOT = path\.join\(ROOT, '\.codex-tmp', 'pto-lifecycle-live'\)/.test(LIVE)
  && /Live screenshots must stay under the private untracked output root/.test(LIVE),
'live screenshots are pinned to an untracked private output root');

const executableHarness = [MOCK, HARNESS, SCENARIOS, REVIEW, RUN, LIVE].join('\n');
ok(!/calendar-upsert|sample-review-upsert/i.test(executableHarness),
'PTO lifecycle harness never references either frozen writer');
ok(!/https?:\/\/[^\s'"]*(?:n8n|linear)/i.test(executableHarness)
  && !/\/functions\/v1\/(?:calendar-upsert|sample-review-upsert)/i.test(executableHarness),
'PTO lifecycle harness has no n8n, Linear, or frozen-writer network route');

console.log(`\npto-lifecycle-harness: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
