'use strict';
/*
 * F44 Linear Submit durability harness.
 *
 * Runs the real browser submit helpers extracted from index.html. Fetch and
 * storage are controlled at their boundaries so regressions cannot silently
 * clear a draft, accept a phantom 200, duplicate a receipt, or erase edits
 * made by another tab while a create is in flight.
 */
const fs = require('fs');
const path = require('path');
const { webcrypto } = require('crypto');
const { TextEncoder } = require('util');

const INDEX = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');

const FUNCTION_NAMES = [
  '_linearStableJson',
  '_linearPayloadHash',
  '_linearStorageError',
  '_linearDraftSnapshot',
  '_linearReceiptStoreRead',
  '_linearReceiptStoreWrite',
  '_linearTargetForTeam',
  '_linearSelectedTeams',
  '_linearReceiptKey',
  '_linearUuid',
  '_linearResponseParentId',
  '_linearConfirmedCreate',
  '_linearSafeReceiptRef',
  '_linearReceiptFailure',
  '_linearCreateError',
  '_linearRecoveryIdText',
  '_linearPrepareReceipts',
  '_linearAwaitCreate',
  '_linearApplyReceiptOutcomes',
  '_linearCompareRemove',
  '_linearRestoreSubmitButtons',
  'submitLinearForm',
  '_submitLinearFormOnce',
];

function functionStart(name) {
  let at = INDEX.indexOf('function ' + name + '(');
  if (at < 0) throw new Error('function not found: ' + name);
  if (INDEX.slice(at - 6, at) === 'async ') at -= 6;
  return at;
}

const FUNCTION_STARTS = FUNCTION_NAMES.map(functionStart);
const LAST_FUNCTION_END = INDEX.indexOf('\n\n    /* After the Linear form is submitted', FUNCTION_STARTS.at(-1));
if (LAST_FUNCTION_END < 0) throw new Error('last submit function boundary not found');
const FUNCTIONS = FUNCTION_NAMES.map((name, index) => INDEX.slice(
  FUNCTION_STARTS[index],
  index + 1 < FUNCTION_STARTS.length ? FUNCTION_STARTS[index + 1] : LAST_FUNCTION_END
)).join('\n\n');

const LINEAR_FORM_KEY = 'syncview_linear_form';
const LAST_LINK_KEY = 'syncview_last_link';
const LINEAR_RECEIPTS_KEY = 'syncview_linear_intake_receipts_v1';
const VIDEO_URL = 'https://example.test/video-form';
const GRAPHICS_URL = 'https://example.test/graphic-form';
const LOG_URL = 'https://example.test/log-linear-submission';
const IDS = {
  video: '11111111-1111-4111-8111-111111111111',
  graphics: '22222222-2222-4222-8222-222222222222',
};

function response(json, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => json };
}

function createdResponse(options, id) {
  const body = JSON.parse(options.body);
  const children = body.videos.map((_, index) => {
    const prefix = body.team === 'video' ? '3' : '4';
    return `${prefix}${String(index + 1).padStart(7, '0')}-1111-4111-8111-111111111111`;
  });
  return response({
    ok: true,
    status: 'created',
    ledger_status: 'created',
    team: body.team,
    payload_hash: body.payload_hash,
    receipt_key: body.receipt_key,
    idempotency_key: body.idempotency_key,
    receipt_id: 'receipt_' + body.team,
    parent: { id: id || IDS[body.team] },
    child_issue_ids: children,
  });
}

function storeWithDraft() {
  const data = new Map([
    [LINEAR_FORM_KEY, JSON.stringify({ client: 'Acme', notes: 'Keep me' })],
    [LAST_LINK_KEY, 'https://drive.example/raw'],
  ]);
  return {
    failSet: false,
    failKeys: new Set(),
    getItem(key) { return data.has(key) ? data.get(key) : null; },
    setItem(key, value) {
      if (this.failSet || this.failKeys.has(key)) throw new Error('storage unavailable');
      data.set(key, String(value));
    },
    removeItem(key) { data.delete(key); },
    has(key) { return data.has(key); },
    snapshot() { return new Map(data); },
  };
}

function makeButton(text, primary) {
  const label = primary ? { textContent: text } : null;
  return {
    disabled: false,
    textContent: primary ? '' : text,
    querySelector: selector => selector === '.linear-submit-primary-label' ? label : null,
    label,
  };
}

function makeHarness(fetchImpl, options = {}) {
  const storage = options.storage || storeWithDraft();
  const status = { textContent: '' };
  const buttons = {
    linearSubmitBtnVideo: makeButton('Video issue only', false),
    linearSubmitBtnThumbnail: makeButton('Thumbnail issue only', false),
    linearSubmitBtnBoth: makeButton('Create Linears', true),
  };
  const elements = {
    linearClientSearch: { value: options.client || 'Acme' },
    linearNotes: { value: options.notes || 'Notes' },
    linearGeneralDrive: { value: options.generalDrive || 'https://drive.example/general' },
    vid_main_1: { value: options.mainCam || 'https://drive.example/main' },
    vid_side_1: { value: '' },
    vid_audio_1: { value: '' },
    linearStatus: status,
    ...buttons,
  };
  const calls = {
    fetches: [],
    calendarJobs: [],
    calendarWrites: [],
    nav: [],
    notify: [],
    saves: 0,
    titles: 0,
    todays: 0,
    dueDates: 0,
  };
  const planUrl = options.planUrl == null ? 'https://docs.example/filming-plan' : options.planUrl;
  const env = {
    crypto: webcrypto,
    TextEncoder,
    AbortController,
    planUrl,
    document: {
      getElementById: id => elements[id] || null,
      querySelectorAll: selector => selector === '[id^="videoCard_"]' ? [{ id: 'videoCard_1' }] : [],
    },
    localStorage: storage,
    fetch: (url, fetchOptions = {}) => {
      calls.fetches.push({ url, options: fetchOptions });
      return fetchImpl(url, fetchOptions);
    },
    buildLinearTitle: () => {
      calls.titles++;
      return options.title || 'Acme - 14 Jul 2026';
    },
    wlTodayISO: () => {
      calls.todays++;
      return options.today || '2026-07-14';
    },
    wlAddWorkingDays: () => {
      calls.dueDates++;
      return options.dueDate || '2026-07-21';
    },
    saveLinearForm: () => {
      calls.saves++;
      const saved = {
        client: elements.linearClientSearch.value,
        filmingPlans: env.planUrl,
        generalDrive: elements.linearGeneralDrive.value,
        notes: elements.linearNotes.value,
        videos: [{
          main_cam: elements.vid_main_1.value,
          side_cam: elements.vid_side_1.value,
          audio: elements.vid_audio_1.value,
        }],
      };
      storage.setItem(LINEAR_FORM_KEY, JSON.stringify(saved));
      return saved;
    },
    calCardJobCreate: (...args) => {
      const job = { id: 'job-' + (calls.calendarJobs.length + 1) };
      calls.calendarJobs.push({ args, job });
      return job;
    },
    writeCards: (...args) => {
      calls.calendarWrites.push(args);
      return Promise.resolve();
    },
    navTo: page => calls.nav.push(page),
    showNotify: (...args) => calls.notify.push(args),
  };

  const create = new Function('env', `
    const globalThis = { crypto: env.crypto };
    const TextEncoder = env.TextEncoder;
    const AbortController = env.AbortController;
    const VIDEO_FORM_WEBHOOK = ${JSON.stringify(VIDEO_URL)};
    const GRAPHIC_FORM_WEBHOOK = ${JSON.stringify(GRAPHICS_URL)};
    const LOG_SUBMISSION_WEBHOOK = ${JSON.stringify(LOG_URL)};
    const LINEAR_FORM_KEY = ${JSON.stringify(LINEAR_FORM_KEY)};
    const LAST_LINK_KEY = ${JSON.stringify(LAST_LINK_KEY)};
    const LINEAR_RECEIPTS_KEY = ${JSON.stringify(LINEAR_RECEIPTS_KEY)};
    const LINEAR_SUBMIT_TIMEOUT_MS = ${Number(options.timeoutMs || 25)};
    let linearSubmitInFlight = null;
    let linearJustCreated = false;
    let _linearResolvedPlanUrl = env.planUrl;
    const document = env.document;
    const localStorage = env.localStorage;
    const fetch = env.fetch;
    const buildLinearTitle = env.buildLinearTitle;
    const wlTodayISO = env.wlTodayISO;
    const wlAddWorkingDays = env.wlAddWorkingDays;
    const saveLinearForm = env.saveLinearForm;
    const _calCardJobCreate = env.calCardJobCreate;
    const _writeLinearVideoCardsToCalendar = env.writeCards;
    const navTo = env.navTo;
    const showNotify = env.showNotify;
    ${FUNCTIONS}
    return {
      submitLinearForm,
      setPlanUrl: value => { _linearResolvedPlanUrl = value; env.planUrl = value; },
      state: () => ({ linearJustCreated, inFlight: !!linearSubmitInFlight })
    };
  `);

  return { api: create(env), storage, status, buttons, calls, elements };
}

async function until(check) {
  for (let i = 0; i < 50; i++) {
    if (check()) return;
    await new Promise(resolve => setImmediate(resolve));
  }
  throw new Error('condition did not become true');
}

async function settleTicks(count = 2) {
  for (let i = 0; i < count; i++) await new Promise(resolve => setImmediate(resolve));
}

function receiptStore(storage) {
  const raw = storage.getItem(LINEAR_RECEIPTS_KEY);
  return raw ? JSON.parse(raw) : null;
}

let passed = 0;
let failed = 0;
function ok(condition, label) {
  if (condition) { passed++; console.log('  PASS ' + label); }
  else { failed++; console.log('  FAIL ' + label); }
}

(async () => {
  console.log('\nF44: early HTTP 200 without durable confirmation');
  {
    let createCalls = 0;
    let createBody = null;
    const h = makeHarness(async (url, options) => {
      if (url === LOG_URL) return response({ ok: true });
      createCalls++;
      createBody = JSON.parse(options.body);
      return response({ message: 'Workflow was started' });
    });
    const result = await h.api.submitLinearForm('video');
    ok(result.ok === false && createCalls === 1, 'bare 200 is rejected as unconfirmed');
    ok(/not confirmed/i.test(h.status.textContent), 'UI explains that creation was not confirmed');
    ok(h.storage.has(LINEAR_FORM_KEY) && h.storage.has(LAST_LINK_KEY) && h.storage.has(LINEAR_RECEIPTS_KEY), 'draft, link, and durable receipt survive the false 200');
    ok(h.calls.calendarJobs.length === 0 && h.calls.nav.length === 0, 'no phantom calendar job or navigation');
    ok(h.status.textContent.includes('Recovery ID: ' + createBody.receipt_key), 'unconfirmed 200 exposes the full receipt key as a Recovery ID');
    ok(!h.buttons.linearSubmitBtnVideo.disabled && h.buttons.linearSubmitBtnVideo.textContent === 'Video issue only', 'buttons and labels are restored for retry');
  }

  console.log('\nF44: specific preflight failure reaches the editor');
  {
    let createBody = null;
    const h = makeHarness(async (url, options) => {
      if (url === LOG_URL) return response({ ok: true });
      createBody = JSON.parse(options.body);
      return response({ ok: false, status: 'failed', error: 'no SMM credential for Acme' });
    });
    const result = await h.api.submitLinearForm('video');
    ok(result.ok === false && /no SMM credential for Acme/.test(h.status.textContent), 'specific server error is shown instead of green success');
    ok(h.storage.has(LINEAR_FORM_KEY) && h.calls.calendarJobs.length === 0, 'server failure keeps draft and creates no phantom job');
    ok(h.status.textContent.includes(createBody.receipt_key), 'server failure exposes its full Recovery ID');
  }

  console.log('\nF44: receipt persistence fails closed before any network send');
  {
    let fetchCalls = 0;
    const h = makeHarness(async () => { fetchCalls++; return response({ ok: true }); });
    h.storage.failSet = true;
    const result = await h.api.submitLinearForm('video');
    ok(result.ok === false && fetchCalls === 0, 'storage failure sends neither telemetry nor create request');
    ok(/No create request was sent/i.test(h.status.textContent) && !/still saved/i.test(h.status.textContent), 'UI does not claim an unverified draft or receipt is saved');
    ok(!h.buttons.linearSubmitBtnVideo.disabled, 'storage failure restores the submit controls');
  }

  console.log('\nF44: empty filming plan fails client preflight before the network');
  {
    const bodies = [];
    const h = makeHarness(async (url, options) => {
      if (url === LOG_URL) return response({ ok: true });
      bodies.push(JSON.parse(options.body));
      return createdResponse(options);
    }, { planUrl: '' });
    const blocked = await h.api.submitLinearForm('video');
    ok(blocked.ok === false && h.calls.fetches.length === 0 && /filming plan/i.test(h.status.textContent), 'empty resolved plan sends neither telemetry nor create request');
    ok(!h.storage.has(LINEAR_RECEIPTS_KEY) && h.calls.saves === 0 && h.calls.calendarJobs.length === 0, 'client preflight happens before draft snapshot, receipt creation, or phantom work');

    h.api.setPlanUrl('https://docs.example/fixed-plan');
    const created = await h.api.submitLinearForm('video');
    ok(created.ok === true && bodies.length === 1 && bodies[0].filmingPlans === 'https://docs.example/fixed-plan', 'fixed plan creates the first real receipt and sends exactly one create request');
    ok(h.calls.calendarJobs.length === 1 && h.calls.nav.length === 1, 'strictly confirmed first request produces exactly one calendar job and navigation');
  }

  console.log('\nF44: video then both reuses one canonical payload receipt');
  {
    const bodies = [];
    const h = makeHarness(async (url, options) => {
      if (url === LOG_URL) return response({ ok: true });
      const body = JSON.parse(options.body);
      bodies.push(body);
      if (bodies.length === 1) return response({ ok: false, status: 'failed', error: 'temporary create failure' });
      return createdResponse(options);
    });
    const first = await h.api.submitLinearForm('video');
    const second = await h.api.submitLinearForm('both');
    const retryVideo = bodies.find((body, index) => index > 0 && body.team === 'video');
    const graphics = bodies.find(body => body.team === 'graphics');
    ok(first.ok === false && second.ok === true && bodies.length === 3, 'retry expands the existing receipt to both teams without extra sends');
    ok(retryVideo.payload_hash === bodies[0].payload_hash && retryVideo.receipt_key === bodies[0].receipt_key, 'video hash and key remain identical when UI mode changes to both');
    ok(graphics.payload_hash === bodies[0].payload_hash && graphics.receipt_key !== bodies[0].receipt_key, 'graphics shares the payload hash but gets its own team key');
    const canonicalKeys = Object.keys(bodies[0]).filter(key => !['team', 'payload_hash', 'receipt_key', 'idempotency_key'].includes(key)).sort();
    ok(JSON.stringify(canonicalKeys) === JSON.stringify(['clientName', 'filmingPlans', 'notes', 'title', 'videos']), 'canonical payload excludes UI mode and transport metadata');
  }

  console.log('\nF44: existing server receipt remains immutable after payload edits');
  {
    const bodies = [];
    const h = makeHarness(async (url, options) => {
      if (url === LOG_URL) return response({ ok: true });
      const body = JSON.parse(options.body);
      bodies.push(body);
      if (bodies.length === 1) return response({ ok: false, status: 'failed', error: 'mapping failed' });
      return createdResponse(options);
    }, { planUrl: 'https://docs.example/original-plan' });
    await h.api.submitLinearForm('video');
    h.api.setPlanUrl('https://docs.example/changed-plan');
    await h.api.submitLinearForm('video');
    ok(bodies[1].receipt_key === bodies[0].receipt_key
      && bodies[1].payload_hash === bodies[0].payload_hash
      && bodies[1].filmingPlans === bodies[0].filmingPlans,
    'changed current input cannot replace an existing receipt or its immutable payload');
  }

  console.log('\nF44: lingering all-created receipt cannot confirm a newer draft locally');
  {
    let phase = 'seed';
    const newDraftBodies = [];
    const h = makeHarness(async (url, options) => {
      if (url === LOG_URL) return response({ ok: true });
      if (phase === 'seed') return response({ ok: false, status: 'failed', error: 'seed local receipt' });
      newDraftBodies.push(JSON.parse(options.body));
      if (phase === 'unconfirmed') return response({ message: 'workflow started' });
      return createdResponse(options);
    });

    await h.api.submitLinearForm('video');
    const seeded = receiptStore(h.storage);
    seeded.receipts.video.status = 'created';
    seeded.receipts.video.parent_id = IDS.video;
    const originalKey = seeded.receipts.video.receipt_key;
    h.storage.setItem(LINEAR_RECEIPTS_KEY, JSON.stringify(seeded));

    // Change only the saved link. The canonical payload/hash therefore stays
    // identical, but this is still a newer draft snapshot that must be sent.
    h.storage.setItem(LAST_LINK_KEY, 'https://drive.example/new-draft-link');
    phase = 'unconfirmed';
    const unconfirmed = await h.api.submitLinearForm('video');
    ok(unconfirmed.ok === false && newDraftBodies.length === 1, 'new draft sends instead of accepting the lingering local-created result');
    ok(newDraftBodies[0].receipt_key === originalKey, 'same canonical hash/key is reset to pending and checked with the server');
    ok(h.calls.calendarJobs.length === 0 && h.calls.nav.length === 0 && h.api.state().linearJustCreated === false, 'unconfirmed duplicate readback cannot navigate, enqueue work, or turn green');

    phase = 'confirmed';
    const confirmed = await h.api.submitLinearForm('video');
    ok(confirmed.ok === true && newDraftBodies.length === 2 && newDraftBodies[1].receipt_key === originalKey, 'retry awaits exact server confirmation for the same receipt key');
    ok(h.calls.calendarJobs.length === 1 && h.calls.nav.length === 1, 'one exact confirmation produces exactly one calendar result and navigation');
  }

  console.log('\nF44: reload on a later day reuses the exact saved envelope');
  {
    const storage = storeWithDraft();
    let firstBody = null;
    const dayOne = makeHarness(async (url, options) => {
      if (url === LOG_URL) return response({ ok: true });
      firstBody = JSON.parse(options.body);
      return response({ ok: false, status: 'failed', error: 'retry tomorrow' });
    }, { storage, title: 'Acme - 14 Jul 2026', today: '2026-07-14', dueDate: '2026-07-21' });
    await dayOne.api.submitLinearForm('video');

    let secondBody = null;
    const nextDay = makeHarness(async (url, options) => {
      if (url === LOG_URL) return response({ ok: true });
      secondBody = JSON.parse(options.body);
      return createdResponse(options);
    }, { storage, title: 'Acme - 15 Jul 2026', today: '2026-07-15', dueDate: '2026-07-22' });
    const result = await nextDay.api.submitLinearForm('video');
    ok(result.ok === true && secondBody.receipt_key === firstBody.receipt_key && secondBody.payload_hash === firstBody.payload_hash, 'reload retries the original idempotency key and hash');
    ok(secondBody.title === firstBody.title && secondBody.videos[0].dueDate === firstBody.videos[0].dueDate, 'title and due date are not regenerated on the next day');
    ok(nextDay.calls.titles === 0 && nextDay.calls.todays === 0 && nextDay.calls.dueDates === 0, 'saved payload bypasses every volatile payload builder');
  }

  console.log('\nF44: stale or identifier-free success responses fail closed');
  {
    const wrongHash = makeHarness(async (url, options) => {
      if (url === LOG_URL) return response({ ok: true });
      const body = JSON.parse(options.body);
      const created = await createdResponse(options).json();
      created.payload_hash = body.payload_hash.replace(/^./, body.payload_hash[0] === '0' ? '1' : '0');
      return response(created);
    });
    const wrongResult = await wrongHash.api.submitLinearForm('video');
    ok(wrongResult.ok === false && /stale or mismatched/i.test(wrongHash.status.textContent), 'wrong response hash is rejected');

    const urlOnly = makeHarness(async (url, options) => {
      if (url === LOG_URL) return response({ ok: true });
      const body = JSON.parse(options.body);
      return response({
        ok: true,
        status: 'created',
        ledger_status: 'created',
        team: body.team,
        payload_hash: body.payload_hash,
        receipt_key: body.receipt_key,
        idempotency_key: body.idempotency_key,
        parent: { url: 'https://linear.app/issue/VID-1' },
      });
    });
    const urlResult = await urlOnly.api.submitLinearForm('video');
    ok(urlResult.ok === false && urlOnly.calls.calendarJobs.length === 0, 'URL-only or missing parent UUID cannot report success');

    const missingChildren = makeHarness(async (url, options) => {
      if (url === LOG_URL) return response({ ok: true });
      const created = await createdResponse(options).json();
      created.child_issue_ids = [];
      return response(created);
    });
    const missingChildrenResult = await missingChildren.api.submitLinearForm('video');
    ok(missingChildrenResult.ok === false && missingChildren.calls.calendarJobs.length === 0, 'incomplete child readback cannot report success');

    const missingLedger = makeHarness(async (url, options) => {
      if (url === LOG_URL) return response({ ok: true });
      const created = await createdResponse(options).json();
      delete created.ledger_status;
      return response(created);
    });
    const missingLedgerResult = await missingLedger.api.submitLinearForm('video');
    ok(missingLedgerResult.ok === false, 'response must confirm the authoritative ledger reached created');
  }

  console.log('\nF44: post-network receipt write failure exposes recovery identity');
  {
    const storage = storeWithDraft();
    let createBody = null;
    const h = makeHarness(async (url, options) => {
      if (url === LOG_URL) return response({ ok: true });
      createBody = JSON.parse(options.body);
      storage.failKeys.add(LINEAR_RECEIPTS_KEY);
      return createdResponse(options);
    }, { storage });
    const result = await h.api.submitLinearForm('video');
    ok(result.ok === false && result.storage_error === true, 'post-network storage failure cannot report green success');
    ok(h.status.textContent.includes('Recovery ID: ' + createBody.receipt_key), 'post-network storage error exposes the full exact Recovery ID');
    ok(h.calls.calendarJobs.length === 0 && h.calls.nav.length === 0, 'unpersisted result cannot start calendar work or navigate');
  }

  console.log('\nF44: both-team submission remains locked until every team settles');
  {
    let createCalls = 0;
    let finishGraphics = null;
    let graphicsKey = '';
    const h = makeHarness((url, options) => {
      if (url === LOG_URL) return Promise.resolve(response({ ok: true }));
      createCalls++;
      const body = JSON.parse(options.body);
      if (body.team === 'video') return Promise.resolve(createdResponse(options));
      graphicsKey = body.receipt_key;
      return new Promise(resolve => {
        finishGraphics = () => resolve(response({ ok: false, status: 'failed', error: 'no SMM credential for Acme' }));
      });
    });
    const first = h.api.submitLinearForm('both');
    const second = h.api.submitLinearForm('both');
    let settled = false;
    first.then(() => { settled = true; });
    ok(first === second, 'double-click shares the full multi-team in-flight promise');
    await until(() => typeof finishGraphics === 'function');
    await settleTicks();
    ok(createCalls === 2 && !settled && h.api.state().inFlight, 'lock stays active after video succeeds while graphics is unresolved');
    finishGraphics();
    const result = await first;
    const store = receiptStore(h.storage);
    ok(result.ok === false && result.partial === true && /Video: created; Graphics: no SMM credential for Acme/.test(h.status.textContent), 'UI reports the exact per-team partial result');
    ok(h.status.textContent.includes('Graphics Recovery ID: ' + graphicsKey), 'partial result exposes the unresolved team full Recovery ID');
    ok(store.receipts.video.status === 'created' && store.receipts.graphics.status === 'failed', 'durable receipt records created and failed teams separately');
    ok(h.calls.calendarJobs.length === 0 && h.calls.nav.length === 0, 'partial result cannot enqueue calendar work or navigate');
  }

  console.log('\nF44: late response after timeout cannot create a phantom result');
  {
    let attempt = 0;
    let firstOptions = null;
    let finishOld = null;
    const bodies = [];
    const h = makeHarness((url, options) => {
      if (url === LOG_URL) return Promise.resolve(response({ ok: true }));
      attempt++;
      bodies.push(JSON.parse(options.body));
      if (attempt === 1) {
        firstOptions = options;
        return new Promise(resolve => { finishOld = () => resolve(createdResponse(firstOptions)); });
      }
      return Promise.resolve(createdResponse(options));
    }, { timeoutMs: 12 });
    const timedOut = await h.api.submitLinearForm('video');
    ok(timedOut.ok === false && /timed out/i.test(h.status.textContent), 'bounded timeout is visible and retryable');
    ok(h.status.textContent.includes('Recovery ID: ' + bodies[0].receipt_key), 'timeout exposes the full exact Recovery ID');
    finishOld();
    await settleTicks(3);
    ok(h.calls.calendarJobs.length === 0 && h.calls.nav.length === 0, 'late confirmation after abort has no local success side effects');
    const retried = await h.api.submitLinearForm('video');
    ok(retried.ok === true && bodies[1].receipt_key === bodies[0].receipt_key && bodies[1].payload_hash === bodies[0].payload_hash, 'retry uses the same receipt key and hash after a late response');
    ok(h.calls.calendarJobs.length === 1 && h.calls.nav.length === 1, 'only the confirmed retry enqueues calendar work and navigates');
  }

  console.log('\nF44: in-flight edits from this or another tab are never deleted');
  {
    let finishCreate = null;
    const h = makeHarness((url, options) => {
      if (url === LOG_URL) return Promise.resolve(response({ ok: true }));
      return new Promise(resolve => { finishCreate = () => resolve(createdResponse(options)); });
    });
    const request = h.api.submitLinearForm('video');
    await until(() => typeof finishCreate === 'function');
    const newerDraft = JSON.stringify({ client: 'Acme', notes: 'new edits while submitting' });
    const newerLink = 'https://drive.example/newer-link';
    h.storage.setItem(LINEAR_FORM_KEY, newerDraft);
    h.storage.setItem(LAST_LINK_KEY, newerLink);
    finishCreate();
    const result = await request;
    ok(result.ok === true && h.storage.getItem(LINEAR_FORM_KEY) === newerDraft, 'success compare-and-delete preserves a newer form draft');
    ok(h.storage.getItem(LAST_LINK_KEY) === newerLink, 'success compare-and-delete preserves a newer pasted link');
  }

  console.log('\nF44: exact confirmed creation is the only cleanup path');
  {
    let createBody = null;
    const h = makeHarness(async (url, options) => {
      if (url === LOG_URL) return response({ ok: true });
      createBody = JSON.parse(options.body);
      return createdResponse(options);
    });
    const result = await h.api.submitLinearForm('video');
    ok(result.ok === true && h.api.state().linearJustCreated === true, 'exact receipt and real parent UUID enable success state');
    ok(!h.storage.has(LINEAR_FORM_KEY) && !h.storage.has(LAST_LINK_KEY) && !h.storage.has(LINEAR_RECEIPTS_KEY), 'confirmed success clears only the submitted recovery records');
    ok(h.calls.calendarJobs.length === 1 && h.calls.calendarWrites.length === 1 && h.calls.nav[0] === 'linear', 'confirmed success starts one durable calendar job then navigates');
    ok(createBody && createBody.team === 'video' && /^[a-f0-9]{64}$/.test(createBody.payload_hash), 'create request carries team and SHA-256 payload hash');
    ok(createBody && createBody.idempotency_key === 'linear-intake-v1:video:' + createBody.payload_hash, 'idempotency key is deterministic from team and canonical hash');
  }

  console.log('\n' + (failed ? `${failed} failed, ${passed} passed` : `All ${passed} checks passed`));
  process.exit(failed ? 1 : 0);
})().catch(error => {
  console.error(error);
  process.exit(1);
});
