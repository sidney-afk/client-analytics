'use strict';
/*
 * `description_read` now returns a `media` projection alongside `row.brief`
 * (native-brief-media, still dormant at the flag level: migrations/2026-09-07
 * -native-brief-media.sql seeds native_brief_media off). The browser must
 * prefer `json.media.render_brief` once the server marks that projection
 * `complete: true`, and otherwise fall back to `row.brief` exactly as before
 * -- the ONLY behaviour change scoped for this slice.
 *
 * This executes the SHIPPED `_prodEnsureDescription` handler out of
 * index.html (same extraction pattern as prod-description-scope-gate.js),
 * against two mocked description_read responses.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const INDEX = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

/* Comment-aware brace matcher, same as prod-description-scope-gate.js. */
function grabFunc(signature) {
  const start = INDEX.indexOf(signature);
  if (start < 0) throw new Error('not found: ' + signature);
  let depth = 0, quote = '', comment = '', escaped = false;
  for (let i = INDEX.indexOf('{', start); i < INDEX.length; i++) {
    const c = INDEX[i], n = INDEX[i + 1];
    if (comment === 'line') { if (c === '\n') comment = ''; continue; }
    if (comment === 'block') { if (c === '*' && n === '/') { comment = ''; i++; } continue; }
    if (quote) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === quote) quote = '';
      continue;
    }
    if (c === '/' && n === '/') { comment = 'line'; i++; continue; }
    if (c === '/' && n === '*') { comment = 'block'; i++; continue; }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
    if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return INDEX.slice(start, i + 1);
  }
  throw new Error('unclosed: ' + signature);
}

const row = {
  id: 'media-row',
  team: 'graphics',
  project: 'client-a',
  authorityProject: 'client-a',
  storedClientSlug: 'client-a',
  desc: '',
  descLoaded: false,
  updatedRaw: '2026-09-07T00:00:00Z',
};
let served = null;

function freshCtx() {
  const ctx = {
    console,
    CSS: { escape: v => String(v) },
    document: { getElementById: () => null, querySelector: () => null },
    setTimeout,
    PROD_WRITE_EF_URL: 'https://example.invalid/production-write',
    CAL_SUPABASE_ANON_KEY: 'anon',
    _syncviewStaffVerificationEpoch: 1,
    _prodState: {
      descriptions: new Map(),
      assets: new Map(),
      batchFiles: new Map(),
      batchFilesStatus: new Map(),
      assetRequestTokens: new Map(),
      descriptionRequestTokens: new Map(),
      linearRaw: new Map(),
      deliverables: [row],
      briefsLoaded: true,
    },
    _prodIssue(id) { return String(id) === row.id ? row : null; },
    _prodRender() {},
    _prodAssetDefaultEvidence() { return {}; },
    _syncviewStaffIdentityForHeaders() { return { key: 'staff-a', role: 'creative', team: 'graphics' }; },
    _syncviewStaffIdentitySignature(v) { return JSON.stringify(v || null); },
    _syncviewEfHeaders(v) { return v; },
    fetch() { return Promise.resolve({ ok: true, status: 200, async json() { return served; } }); },
  };
  vm.createContext(ctx);
  vm.runInContext([
    grabFunc('function _prodDescriptionText('),
    grabFunc('function _prodWriteTeam('),
    grabFunc('function _prodIssueScopeSignature('),
    grabFunc('function _prodDescriptionState('),
    grabFunc('function _prodNextDescriptionRequestToken('),
    grabFunc('function _prodSyncDescriptionRow('),
    grabFunc('function _prodAdoptDescriptionValue('),
    grabFunc('function _prodInvalidateScopedReads('),
    grabFunc('async function _prodEnsureDescription('),
    'this.descriptionState = _prodDescriptionState;',
    'this.ensureDescription = _prodEnsureDescription;',
  ].join('\n'), ctx);
  return ctx;
}

(async () => {
  /* ---- 1. media present and complete: the native projection wins -------- */
  {
    const ctx = freshCtx();
    served = {
      ok: true,
      complete: true,
      row: {
        id: 'media-row', client_slug: 'client-a', team: 'graphics',
        brief: 'raw brief with uploads.linear.app URL', updated_at: '2026-09-07T01:00:00Z',
      },
      media: {
        complete: true,
        render_brief: 'native-rendered brief text',
      },
    };
    await ctx.ensureDescription('media-row', true);
    const state = ctx.descriptionState('media-row');
    ok(state.value === 'native-rendered brief text',
      'a complete media projection is adopted over row.brief');
    ok(state.value !== 'raw brief with uploads.linear.app URL',
      'the raw Linear-hosted brief text is not what gets displayed once media.complete is true');
  }

  /* ---- 2. media absent: falls back to row.brief exactly as before ------- */
  {
    const ctx = freshCtx();
    served = {
      ok: true,
      complete: true,
      row: {
        id: 'media-row', client_slug: 'client-a', team: 'graphics',
        brief: 'plain row brief, no media key at all', updated_at: '2026-09-07T02:00:00Z',
      },
    };
    await ctx.ensureDescription('media-row', true);
    const state = ctx.descriptionState('media-row');
    ok(state.value === 'plain row brief, no media key at all',
      'with no media key in the response, row.brief is used unchanged (today\'s behaviour)');
  }

  /* ---- 3. media present but not complete: falls back to row.brief ------- */
  {
    const ctx = freshCtx();
    served = {
      ok: true,
      complete: true,
      row: {
        id: 'media-row', client_slug: 'client-a', team: 'graphics',
        brief: 'row brief while media is still incomplete', updated_at: '2026-09-07T03:00:00Z',
      },
      media: {
        complete: false,
        render_brief: 'should never be shown',
      },
    };
    await ctx.ensureDescription('media-row', true);
    const state = ctx.descriptionState('media-row');
    ok(state.value === 'row brief while media is still incomplete',
      'media.complete === false falls back to row.brief, never the incomplete render_brief');
  }

  /* ---- 4. media present, complete true, but no render_brief string ------ */
  {
    const ctx = freshCtx();
    served = {
      ok: true,
      complete: true,
      row: {
        id: 'media-row', client_slug: 'client-a', team: 'graphics',
        brief: 'row brief when render_brief is null', updated_at: '2026-09-07T04:00:00Z',
      },
      media: {
        complete: true,
        render_brief: null,
      },
    };
    await ctx.ensureDescription('media-row', true);
    const state = ctx.descriptionState('media-row');
    ok(state.value === 'row brief when render_brief is null',
      'media.complete true with a null render_brief (the flag-off shape from projectBriefMedia) still falls back to row.brief');
  }

  console.log(failures === 0
    ? '\nnative brief-media projection preference checks passed'
    : '\n' + failures + ' native brief-media projection check(s) failed');
  process.exit(failures === 0 ? 0 : 1);
})();
