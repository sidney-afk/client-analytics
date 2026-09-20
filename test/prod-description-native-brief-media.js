'use strict';
/*
 * `description_read` now returns a `media` projection alongside `row.brief`
 * (native-brief-media, still dormant at the flag level: migrations/2026-09-07
 * -native-brief-media.sql seeds native_brief_media off). The browser prefers
 * `json.media.render_brief` for the READ-ONLY display once the server marks
 * that projection `complete: true`, and otherwise falls back to `row.brief`
 * exactly as before -- the scoped behaviour change for this slice.
 *
 * `render_brief` rewrites image references to short-lived (5-minute) signed
 * storage URLs (native-brief-media.mjs). Those must never reach the editable
 * draft or the save payload -- doing so would persist an expiring signed URL
 * into the canonical `brief` field on an unrelated edit, permanently
 * breaking the images once the URL expires and losing the original Linear
 * URL. So the projection is carried on its own field (`renderValue`,
 * read only by the display line) while `state.value`/`state.draft`/
 * `state.baseline` -- what editing and saving actually use -- are always
 * seeded from `row.brief`, untouched.
 *
 * This executes the SHIPPED `_prodEnsureDescription` and
 * `_prodDescriptionState` handlers out of index.html (same extraction
 * pattern as prod-description-scope-gate.js), against mocked
 * description_read responses.
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
    Date,
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
  /* ---- 1. media present and complete: DISPLAY prefers render_brief ------ */
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
        expires_at: new Date(Date.now() + 285000).toISOString(),
      },
    };
    await ctx.ensureDescription('media-row', true);
    const state = ctx.descriptionState('media-row');
    ok(state.renderValue === 'native-rendered brief text',
      'a complete media projection lands as the display-only renderValue');
  }

  /* ---- 2. THE BUG CODEX FOUND: the edit draft/save value must be row.brief, never render_brief ---- */
  {
    const ctx = freshCtx();
    served = {
      ok: true,
      complete: true,
      row: {
        id: 'media-row', client_slug: 'client-a', team: 'graphics',
        brief: 'CANONICAL brief with the real Linear image URL', updated_at: '2026-09-07T01:30:00Z',
      },
      media: {
        complete: true,
        render_brief: 'PROJECTED brief with a 5-minute signed storage URL',
        expires_at: new Date(Date.now() + 285000).toISOString(),
      },
    };
    await ctx.ensureDescription('media-row', true);
    const state = ctx.descriptionState('media-row');
    ok(state.value === 'CANONICAL brief with the real Linear image URL',
      'state.value (what _prodBeginDescriptionEdit copies into the edit draft) is row.brief, never render_brief');
    ok(state.draft === 'CANONICAL brief with the real Linear image URL',
      '_prodAdoptDescriptionValue seeds the draft itself from row.brief -- opening and re-saving an unrelated edit cannot persist a temporary signed URL over the canonical brief');
    ok(state.baseline === 'CANONICAL brief with the real Linear image URL',
      'the save-conflict baseline is likewise row.brief, not the projection');
    ok(state.renderValue === 'PROJECTED brief with a 5-minute signed storage URL',
      'the projection still exists, but only on the side-channel the read-only display draws from');
  }

  /* ---- 3. media absent: renderValue stays empty, falls back to row.brief exactly as before ---- */
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
    ok(state.value === 'plain row brief, no media key at all' && state.renderValue === '',
      'with no media key in the response, row.brief is used unchanged and renderValue stays empty (today\'s behaviour)');
  }

  /* ---- 4. media present but not complete: falls back to row.brief -------- */
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
    ok(state.value === 'row brief while media is still incomplete' && state.renderValue === '',
      'media.complete === false falls back to row.brief for both value and display, never the incomplete render_brief');
  }

  /* ---- 5. media complete true but no render_brief string ---------------- */
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
    ok(state.value === 'row brief when render_brief is null' && state.renderValue === '',
      'media.complete true with a null render_brief (the flag-off shape from projectBriefMedia) still falls back to row.brief');
  }

  /* ---- 6. signed URLs expire: the projection is dropped at USE time, and the next ensure actually re-fetches --- */
  {
    const ctx = freshCtx();
    served = {
      ok: true,
      complete: true,
      row: {
        id: 'media-row', client_slug: 'client-a', team: 'graphics',
        brief: 'canonical text, unaffected by expiry', updated_at: '2026-09-07T05:00:00Z',
      },
      media: {
        complete: true,
        render_brief: 'projected text with a signed URL about to expire',
        expires_at: new Date(Date.now() - 1000).toISOString(), // already expired
      },
    };
    await ctx.ensureDescription('media-row', true);
    const state = ctx.descriptionState('media-row');
    ok(state.renderValue === '',
      'a renderValue whose signed URLs already expired is dropped the moment the state is read, before it can be drawn');
    ok(state.value === 'canonical text, unaffected by expiry',
      'row.brief is untouched by the projection expiring -- it was never overwritten to begin with');
    ok(state.status === 'stale',
      'expiry marks the state stale so the next render\'s ensure (force=false, called on every detail-panel paint) does not short-circuit on "ready" and actually re-reads instead of silently keeping expired signed URLs');
  }

  /* ---- 7. an unexpired renderValue survives a plain re-read of the state -- */
  {
    const ctx = freshCtx();
    served = {
      ok: true,
      complete: true,
      row: {
        id: 'media-row', client_slug: 'client-a', team: 'graphics',
        brief: 'canonical text, projection still fresh', updated_at: '2026-09-07T06:00:00Z',
      },
      media: {
        complete: true,
        render_brief: 'projected text, well within its 5 minutes',
        expires_at: new Date(Date.now() + 285000).toISOString(),
      },
    };
    await ctx.ensureDescription('media-row', true);
    const state = ctx.descriptionState('media-row');
    ok(state.renderValue === 'projected text, well within its 5 minutes' && state.status === 'ready',
      'a renderValue that has not expired yet is not dropped on an ordinary read');
  }

  console.log(failures === 0
    ? '\nnative brief-media projection checks passed'
    : '\n' + failures + ' native brief-media projection check(s) failed');
  process.exit(failures === 0 ? 0 : 1);
})();
