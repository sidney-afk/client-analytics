#!/usr/bin/env node
'use strict';
/* A plain note written on the review page (kind review-comment) used to be
   saved to the card row only. On a card whose comments live in production it
   then had no production row; the client typed it again in Notes and the
   second copy got a new id. Real data: one card-list note id plus one
   production note with another id and a later time, same words. The review
   note must go through the gateway write (_calAppendComment) with its own id. */
const fs = require('fs');
const path = require('path');
const { extractFunction } = require('./helpers/extract-function.js');
const INDEX = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
let failures = 0;
const ok = (c, m) => { console.log((c ? '  ok  ' : 'FAIL  ') + m); if (!c) failures++; };

async function run(linked, comp) {
  const calls = [];
  const store = { c_mvfmnt0w_6bfz9: { id: 'c_mvfmnt0w_6bfz9', pid: 'p1', comp, kind: 'review-comment', surface: 'review', parent_id: null, body: 'Same q', audience: 'client', state: 'sending' } };
  const env = {
    calState: { posts: [{ id: 'p1' }] },
    _prodCanonicalCommentGate: () => ({ linked }),
    _noteOutboxGet: id => store[id], _noteOutboxSet: (id, v) => Object.assign(store[id], v), _noteOutboxDrop: id => { delete store[id]; },
    _noteOutboxLive: new Set(), _noteOutboxChains: new Map(), _noteOutboxRepaint: () => {},
    _calAppendComment: async (pid, parent, body, o) => { calls.push(['gateway', o.id]); return true; },
    _calReviewCommentSend: async e => { calls.push(['cardrow', e.id]); return true; },
    _writeUiComponentHasWorkItem: () => true, _calFindCompForCommentId: () => comp,
    _writeUiFailureSentence: e => String(e), _writeUiRecordFailure: () => {}
  };
  const names = Object.keys(env);
  const src = extractFunction(INDEX, '_noteReviewGoesToGateway') + '\n' + extractFunction(INDEX, '_noteOutboxSend') + '; return _noteOutboxSend;';
  const send = new Function(...names, src)(...names.map(n => env[n]));
  await send('c_mvfmnt0w_6bfz9');
  return calls;
}
(async () => {
  let c = await run(true, 'video');
  ok(c.length === 1 && c[0][0] === 'gateway' && c[0][1] === 'c_mvfmnt0w_6bfz9', 'linked card: review note goes through the gateway with its own id');
  c = await run(false, 'video');
  ok(c.length === 1 && c[0][0] === 'cardrow', 'unlinked card: unchanged card-row save');
  c = await run(true, 'caption');
  ok(c.length === 1 && c[0][0] === 'cardrow', 'caption/title: unchanged');
  process.exit(failures ? 1 : 0);
})();
