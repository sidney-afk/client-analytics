'use strict';
/*
 * linear-import-optional-graphics.js — an OPTIONAL field must not be able to
 * destroy the required one's work.
 *
 * Both Linear pull-in dialogs (Import from Linear, and Bulk Linear sync) take a
 * required video-parent link and an optional thumbnail-parent link, and ask the
 * `linear-subissues` endpoint for both at once. The two answers were fetched
 * with `Promise.all`, which rejects the moment ANY member rejects — so a
 * thumbnail parent that answered a 502, or any body `r.json()` could not parse,
 * threw away a video parent that had already come back cleanly and dropped the
 * person back on the start screen to paste both links again.
 *
 * The tell that this was an oversight rather than a policy: eight lines further
 * down, the same optional half answering `{ ok: false }` was already tolerated
 * — the import carried on with no thumbnails paired. One optional field, two
 * failure shapes, two different amounts of damage.
 *
 * Both shapes now cost the same thing: the graphics half is dropped, the video
 * import proceeds, and the person is TOLD the thumbnail link was not read, so
 * a screen with no thumbnails on it is not misread as "that parent has none".
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

function grab(signature) {
  const start = source.indexOf(signature);
  assert(start >= 0, 'missing ' + signature);
  const brace = source.indexOf('{', start);
  let depth = 0, quote = '', escaped = false, line = false, block = false;
  for (let i = brace; i < source.length; i++) {
    const ch = source[i], next = source[i + 1];
    if (line) { if (ch === '\n') line = false; continue; }
    if (block) { if (ch === '*' && next === '/') { block = false; i++; } continue; }
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '/' && next === '/') { line = true; i++; continue; }
    if (ch === '/' && next === '*') { block = true; i++; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (!depth) return source.slice(start, i + 1); }
  }
  throw new Error('unterminated ' + signature);
}

const VIDEO_OK = {
  ok: true,
  parent: { id: 'VID-100', title: 'Launch batch' },
  subIssues: [
    { id: 'v1', title: 'Video 1', identifier: 'VID-101' },
    { id: 'v2', title: 'Video 2', identifier: 'VID-102' },
  ],
};

/* Each lane: the two functions are the same shape with different names, and the
   defect was in both, so both are driven rather than one being read off the
   other. */
const LANES = [
  {
    name: 'Import from Linear',
    signature: 'async function _calLinearImportFetch(',
    inputs: { calLinearImportUrl: '', calLinearImportGraphicUrl: '' },
    modal: 'calLinearImportModal',
    proceeded: 'pick',
    restarted: 'start',
    stubs: ctx => {
      ctx._calRenderLinearSubPick = (parent, subs, graphicParent) => {
        ctx.seen.push({ what: 'pick', parent, subs, graphicParent });
      };
      ctx._calRenderLinearImportStart = (prefill, err) => {
        ctx.seen.push({ what: 'start', prefill, err });
      };
    },
  },
  {
    name: 'Bulk Linear sync',
    signature: 'async function _calBulkLinkFetch(',
    inputs: { calBulkLinkUrl: '', calBulkLinkGraphicUrl: '' },
    modal: 'calBulkLinkModal',
    proceeded: 'match',
    restarted: 'start',
    stubs: ctx => {
      ctx._calBulkLinkSubs = null;
      ctx._calBulkLinkParent = null;
      ctx._calBulkLinkGraphicParent = null;
      ctx._calBulkLinkAutoMatch = () => {};
      ctx._calRenderBulkLinkMatch = prefill => {
        ctx.seen.push({
          what: 'match', prefill,
          subs: ctx._calBulkLinkSubs,
          parent: ctx._calBulkLinkParent,
          graphicParent: ctx._calBulkLinkGraphicParent,
        });
      };
      ctx._calRenderBulkLinkStart = (prefill, err) => {
        ctx.seen.push({ what: 'start', prefill, err });
      };
    },
  },
];

async function run(lane, graphicAnswer, graphicUrl) {
  const ids = Object.keys(lane.inputs);
  const values = { [ids[0]]: 'https://linear.app/t/issue/VID-100', [ids[1]]: graphicUrl };
  const ctx = {
    seen: [],
    notified: [],
    console,
    Promise, Map, String, Number, Boolean, Object, Array, JSON, Error,
    LINEAR_SUBISSUES_URL: 'https://example.invalid/linear-subissues',
    _calSubNum: s => Number(String(s.title || '').replace(/\D+/g, '') || 0),
    showNotify: (title, message) => ctx.notified.push({ title, message }),
    document: {
      getElementById: id => {
        if (id === lane.modal) return { set innerHTML(v) {} };
        if (Object.prototype.hasOwnProperty.call(values, id)) return { value: values[id] };
        return null;
      },
    },
    fetch: (url, options) => {
      const body = JSON.parse(options.body);
      const isGraphic = /GRA/.test(body.url);
      if (!isGraphic) return Promise.resolve({ json: () => Promise.resolve(VIDEO_OK) });
      return typeof graphicAnswer === 'function'
        ? graphicAnswer()
        : Promise.resolve({ json: () => Promise.resolve(graphicAnswer) });
    },
  };
  lane.stubs(ctx);
  vm.createContext(ctx);
  vm.runInContext(grab(lane.signature) + ';this.__run = ' + lane.signature.replace(/^async function /, '').replace(/\($/, '') + ';', ctx);
  await ctx.__run();
  return ctx;
}

const GRAPHIC_URL = 'https://linear.app/t/issue/GRA-200';
const GRAPHIC_OK = {
  ok: true,
  parent: { id: 'GRA-200', title: 'Launch thumbnails' },
  subIssues: [{ id: 'g1', title: 'Video 1', identifier: 'GRA-201' }],
};

/* The failure shapes an optional half can present. `rejects` and `unparseable`
   are the two that used to take the video parent down with them; `refused` is
   the one that was already tolerated and is here as the control the other two
   must now match. */
const SHAPES = [
  { label: 'a 502 with no body the browser can parse',
    answer: () => Promise.resolve({ json: () => Promise.reject(new SyntaxError('Unexpected token < in JSON')) }) },
  { label: 'a connection that never completes',
    answer: () => Promise.reject(new TypeError('Failed to fetch')) },
  { label: 'a refusal the endpoint reports properly', answer: { ok: false, error: 'issue not found' } },
  { label: 'an empty body', answer: null },
];

(async () => {
  for (const lane of LANES) {
    for (const shape of SHAPES) {
      const ctx = await run(lane, shape.answer, GRAPHIC_URL);
      const proceeded = ctx.seen.find(row => row.what === lane.proceeded);
      const restarted = ctx.seen.find(row => row.what === lane.restarted);
      assert(proceeded,
        lane.name + ': ' + shape.label + ' on the OPTIONAL thumbnail link threw away a video parent'
          + ' that had already been fetched cleanly'
          + (restarted ? ' (it went back to the start screen with "' + restarted.err + '")' : ''));
      assert(!restarted,
        lane.name + ': ' + shape.label + ' still sent the person back to the start screen');
      assert(proceeded.subs && proceeded.subs.length === 2,
        lane.name + ': ' + shape.label + ' lost the video sub-issues');
      assert(!proceeded.graphicParent,
        lane.name + ': ' + shape.label + ' invented a thumbnail parent out of a failed read');
      assert(proceeded.subs.every(sub => !sub._graphicMatch),
        lane.name + ': ' + shape.label + ' paired a sub-issue to a thumbnail it never read');
      assert(ctx.notified.some(n => /thumbnail parent not read/i.test(n.title)),
        lane.name + ': ' + shape.label + ' dropped the thumbnail half in silence, so a screen with'
          + ' no thumbnails reads as "that parent has none" rather than "we could not read it"');
      assert(ctx.notified.every(n => !/video/i.test(n.title)),
        lane.name + ': ' + shape.label + ' reported the VIDEO half as failed, which it did not');
      console.log('  ok  ' + lane.name + ': ' + shape.label + ' costs the thumbnail half and nothing else');
    }

    /* NOT VACUOUS in three directions: a good graphics answer is still paired,
       no thumbnail link means no notice at all, and a failure of the REQUIRED
       half still stops the import. */
    const good = await run(lane, GRAPHIC_OK, GRAPHIC_URL);
    const goodRow = good.seen.find(row => row.what === lane.proceeded);
    assert(goodRow && goodRow.graphicParent && goodRow.graphicParent.id === 'GRA-200',
      lane.name + ': a thumbnail parent that reads fine is still carried through');
    assert(goodRow.subs[0]._graphicMatch && goodRow.subs[0]._graphicMatch.id === 'g1',
      lane.name + ': and still paired by title');
    assert(good.notified.length === 0,
      lane.name + ': a successful read must not warn about anything');

    const none = await run(lane, GRAPHIC_OK, '');
    assert(none.notified.length === 0,
      lane.name + ': leaving the optional link empty is not a failure and is not announced');
    assert(none.seen.find(row => row.what === lane.proceeded),
      lane.name + ': and the video-only import still proceeds');

    const videoDown = await run({
      ...lane,
      stubs: ctx => {
        lane.stubs(ctx);
        const inner = ctx.fetch;
        ctx.fetch = (url, options) => (/VID/.test(JSON.parse(options.body).url)
          ? Promise.reject(new TypeError('Failed to fetch'))
          : inner(url, options));
      },
    }, GRAPHIC_OK, GRAPHIC_URL);
    assert(videoDown.seen.find(row => row.what === lane.restarted),
      lane.name + ': the REQUIRED half failing must still stop the import — the tolerance is for the'
        + ' optional field only, and a blanket catch would have hidden this too');
    assert(!videoDown.seen.find(row => row.what === lane.proceeded),
      lane.name + ': and must not proceed with no video parent');
    console.log('  ok  ' + lane.name + ': a good thumbnail read, an absent one, and a dead VIDEO parent all behave');
  }
  console.log('\nLinear import optional-graphics tolerance verified');
})().catch(err => { console.error(err); process.exit(1); });
