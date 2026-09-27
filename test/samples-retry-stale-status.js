'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { extractFunction } = require('./helpers/extract-function');

// Drive the shipped save and Retry functions without a browser or network.
const source = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const functions = [
  '_writeUiApplyOverallStatus', '_sxrFlushCardSave', '_sxrRetrySave'
].map(name => (name === '_sxrFlushCardSave' ? 'async ' : '') + extractFunction(source, name)).join('\n');

function harness({ blank = false, statusEdit = false, oldFailure = false } = {}) {
  const blankId = '__sxrblank__offline';
  const id = blank ? blankId : 'sample-offline';
  const initialStatus = statusEdit ? 'Client Approval' : 'In Progress';
  const local = {
    id, asset_url: 'new-asset', video_status: initialStatus,
    graphic_status: 'Approved', status: initialStatus,
    updated_at: '2026-09-26T10:00:00.000Z'
  };
  if (oldFailure) local._saveError = 'Save failed';
  const server = {
    id: blank ? 'sample-created' : id, asset_url: 'old-asset',
    video_status: 'In Progress', graphic_status: 'Approved', status: 'In Progress',
    updated_at: '2026-09-26T10:00:00.000Z'
  };
  const calls = [];
  const statusMessages = [];
  let failNext = !oldFailure;
  const context = {
    sxrState: { client: null, posts: [local] },
    _sxrPendingEdits: oldFailure ? {} : { [id]: statusEdit ? { video_status: initialStatus } : { asset_url: 'new-asset' } },
    _sxrSaveInFlight: Object.create(null),
    _sxrNoLinearPush: new Set(),
    _sxrFailedNewCards: new Set(),
    _sxrLocalRecentSaves: new Map(),
    _sxrRecentSaveFields: new Map(),
    _sxrConflictNotified: new Set(),
    _SXR_ROLLBACK_FIELDS: ['video_status', 'graphic_status', 'status'],
    SXR_REVIEW_COMPONENTS: ['video', 'graphic'],
    sxrClientSlug: () => 'offline',
    _writeUiPrincipalKey: () => 'offline-actor',
    _sxrIsBlankId: value => value.startsWith('__sxrblank__'),
    _sxrMintId: () => 'sample-created',
    _sxrPromoteBlankCard: () => {},
    _sxrBlankSample: () => ({ video_status: 'In Progress', graphic_status: 'Approved' }),
    computeSampleOverallStatus: row => row.video_status,
    _calShouldBumpThumbRevForGraphicStatus: () => false,
    _sxrBumpThumbRev: () => 2,
    _sxrForceThumbRefresh: () => {},
    _sxrSetCardStatus: (_id, state, message) => { statusMessages.push({ state, message }); },
    _sxrCacheWrite: () => true,
    _sxrRenderBody: () => {},
    _sxrApplyClearSentinels: () => {},
    _calStripThumbnailFolderFields: () => {},
    _sxrMigrateShape: () => {},
    _sxrMergePostComments: () => {},
    _sxrStringifyComments: JSON.stringify,
    _sxrCommentsFor: () => [],
    _writeUiAppendRepairRef: () => {},
    _writeUiCompleteSourceRepairRefs: async () => false,
    _writeUiAdoptRepairAck: () => {},
    _writeUiAdoptReplayStatus: () => '',
    _writeUiFailureSentence: () => 'Save failed',
    _sxrPushStatusToLinear: async () => ({ legacy_transport_retired: true }),
    _sxrUpsertFetchPinned: async (_scope, body) => {
      const sent = JSON.parse(JSON.stringify(body.sample));
      calls.push(sent);
      if (failNext) { failNext = false; return { ok: false, status: 503 }; }
      Object.assign(server, sent);
      return { ok: true, json: async () => ({ ok: true, sample: { ...server } }) };
    },
    document: { activeElement: null },
    console: { warn() {} }
  };
  vm.createContext(context);
  vm.runInContext(functions, context);
  return {
    context, calls, server, statusMessages,
    async failFirstSave() { await context._sxrFlushCardSave(id); },
    async retry() {
      const retryId = blank ? 'sample-created' : id;
      context._sxrRetrySave(retryId);
      const active = context._sxrSaveInFlight[retryId];
      assert.ok(active, 'Retry started a save');
      await active;
    }
  };
}

async function main() {
  const stale = harness();
  await stale.failFirstSave();
  assert.equal(stale.calls.length, 1, 'first asset save was attempted');
  stale.server.video_status = 'Client Approval'; // A second tab saved a newer status.
  stale.server.status = 'Client Approval';
  await stale.retry();
  assert.equal(stale.calls.length, 2, 'Retry sent one request');
  assert.equal(stale.calls[1].asset_url, 'new-asset');
  for (const field of ['status', 'video_status', 'graphic_status']) {
    assert.equal(Object.hasOwn(stale.calls[1], field), false, `asset Retry did not resend ${field}`);
  }
  assert.equal(stale.server.video_status, 'Client Approval', 'peer status remains saved');
  assert.equal(stale.server.status, 'Client Approval', 'peer overall status remains saved');

  const intentional = harness({ statusEdit: true });
  await intentional.failFirstSave();
  await intentional.retry();
  assert.equal(intentional.calls[1].video_status, 'Client Approval', 'intentional status Retry keeps the edit');
  assert.equal(intentional.calls[1].status, 'Client Approval', 'intentional status Retry keeps overall status');

  const newCard = harness({ blank: true });
  await newCard.failFirstSave();
  await newCard.retry();
  assert.equal(newCard.calls[1].asset_url, 'new-asset', 'failed new card retries its content');
  assert.equal(newCard.calls[1].video_status, 'In Progress', 'failed new card still sends a full creation payload');
  assert.equal(newCard.calls[1].graphic_status, 'Approved', 'failed new card retains both component states');

  const oldFailure = harness({ oldFailure: true });
  oldFailure.context._sxrRetrySave('sample-offline');
  const unexpectedSave = oldFailure.context._sxrSaveInFlight['sample-offline'];
  if (unexpectedSave) await unexpectedSave;
  assert.equal(oldFailure.calls.length, 0, 'an older failure with no retained edit sends no id-only save');
  assert.equal(oldFailure.statusMessages.at(-1).state, 'error', 'Retry leaves the error visible');
  assert.match(oldFailure.context.sxrState.posts[0]._saveError, /refresh.*edit again/i);
  assert.equal(Object.hasOwn(oldFailure.context._sxrPendingEdits, 'sample-offline'), false, 'no empty bucket remains for background flush');
  console.log('Samples Retry field scope: 4 offline scenarios passed');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
