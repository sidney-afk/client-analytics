'use strict';

/*
 * A4 settings migration helper.
 *
 * Backfill:
 *   node scripts/a4-settings-backfill-parity.js --backfill
 *
 * Parity (TEST client only):
 *   node scripts/a4-settings-backfill-parity.js --parity
 *
 * Required env:
 *   SUPABASE_SERVICE_ROLE_KEY
 *   SYNCVIEW_STAFF_KEY (for --parity Edge writer calls)
 *
 * Optional:
 *   SUPABASE_URL (defaults to the live SyncView project)
 */

const SUPA_URL = process.env.SUPABASE_URL || 'https://uzltbbrjidmjwwfakwve.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const STAFF_KEY = String(process.env.SYNCVIEW_STAFF_KEY || '').trim();
const TEST_CLIENT_NAME = 'Sidney Laruel';
const TEST_CLIENT_SLUG = routeSlug(TEST_CLIENT_NAME);

const TEMPLATES_GET_URL = 'https://synchrosocial.app.n8n.cloud/webhook/templates-get';
const TEMPLATES_SAVE_N8N_URL = 'https://synchrosocial.app.n8n.cloud/webhook/templates-save';
const TEMPLATES_SAVE_EF_URL = `${SUPA_URL}/functions/v1/templates-save`;
const CAPTION_PROMPTS_GET_URL = 'https://synchrosocial.app.n8n.cloud/webhook/caption-prompts-get';
const CAPTION_PROMPTS_SAVE_N8N_URL = 'https://synchrosocial.app.n8n.cloud/webhook/caption-prompts-save';
const CAPTION_PROMPTS_SAVE_EF_URL = `${SUPA_URL}/functions/v1/caption-prompts-save`;
const TEMPLATE_FIELDS = [
  'filming_plans_link',
  'reels_subtitle_font',
  'reels_subtitle_main_color',
  'reels_subtitle_highlight_color',
  'reels_reference_link',
  'reels_preferences',
  'reels_editor_folder_link',
  'reels_subtitle_highlight_off',
  'thumbnails_title_font',
  'thumbnails_title_color',
  'thumbnails_highlight_color',
  'thumbnails_photos_link',
  'thumbnails_canva_link',
  'thumbnails_color_sets',
  'thumbnails_preferences',
  'thumbnails_highlight_off',
];

function routeSlug(name) {
  let s = String(name || '').toLowerCase().trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  s = s.replace(/^dr\.?\s+/, '');
  s = s.replace(/\s+(?:and|&)\s+/g, '&');
  s = s.replace(/[^a-z0-9&]+/g, '');
  return s;
}

function supaHeaders(extra) {
  if (!SERVICE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required');
  return Object.assign({
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    'Content-Type': 'application/json',
  }, extra || {});
}

async function getJson(url, opts) {
  const resp = await fetch(url, opts);
  const text = await resp.text();
  let json;
  try { json = text ? JSON.parse(text) : {}; } catch (e) { throw new Error(`${url} returned non-JSON: ${text.slice(0, 120)}`); }
  if (!resp.ok) throw new Error(`${url} HTTP ${resp.status}: ${JSON.stringify(json).slice(0, 160)}`);
  return json;
}

async function fetchTemplatesFromN8n() {
  const json = await getJson(`${TEMPLATES_GET_URL}?_t=${Date.now()}`);
  if (!json || json.ok !== true || !json.templates || typeof json.templates !== 'object') throw new Error('templates-get returned unexpected shape');
  return json.templates;
}

async function fetchPromptsFromN8n() {
  const json = await getJson(`${CAPTION_PROMPTS_GET_URL}?_t=${Date.now()}`);
  if (!json || json.ok !== true || !json.prompts || typeof json.prompts !== 'object') throw new Error('caption-prompts-get returned unexpected shape');
  return json.prompts;
}

async function upsertTemplate(slug, data, updatedBy) {
  const body = { client_slug: slug, data, updated_by: updatedBy || 'a4-backfill', updated_at: new Date().toISOString() };
  const rows = await getJson(`${SUPA_URL}/rest/v1/templates?on_conflict=client_slug`, {
    method: 'POST',
    headers: supaHeaders({ Prefer: 'resolution=merge-duplicates,return=representation' }),
    body: JSON.stringify(body),
  });
  return Array.isArray(rows) ? rows[0] : rows;
}

async function upsertPrompt(slug, prompt, updatedBy) {
  const body = { client_slug: slug, prompt: String(prompt == null ? '' : prompt), updated_by: updatedBy || 'a4-backfill', updated_at: new Date().toISOString() };
  const rows = await getJson(`${SUPA_URL}/rest/v1/caption_prompts?on_conflict=client_slug`, {
    method: 'POST',
    headers: supaHeaders({ Prefer: 'resolution=merge-duplicates,return=representation' }),
    body: JSON.stringify(body),
  });
  return Array.isArray(rows) ? rows[0] : rows;
}

async function fetchTemplateRow(slug) {
  const rows = await getJson(`${SUPA_URL}/rest/v1/templates?select=client_slug,data,updated_at&client_slug=eq.${encodeURIComponent(slug)}&limit=1`, {
    headers: supaHeaders({ Accept: 'application/json' }),
  });
  return Array.isArray(rows) ? rows[0] || null : null;
}

async function fetchPromptRow(slug) {
  const rows = await getJson(`${SUPA_URL}/rest/v1/caption_prompts?select=client_slug,prompt,updated_at&client_slug=eq.${encodeURIComponent(slug)}&limit=1`, {
    headers: supaHeaders({ Accept: 'application/json' }),
  });
  return Array.isArray(rows) ? rows[0] || null : null;
}

async function deleteTemplateRow(slug) {
  await getJson(`${SUPA_URL}/rest/v1/templates?client_slug=eq.${encodeURIComponent(slug)}`, {
    method: 'DELETE',
    headers: supaHeaders({ Prefer: 'return=representation' }),
  });
}

async function deletePromptRow(slug) {
  await getJson(`${SUPA_URL}/rest/v1/caption_prompts?client_slug=eq.${encodeURIComponent(slug)}`, {
    method: 'DELETE',
    headers: supaHeaders({ Prefer: 'return=representation' }),
  });
}

function compactTemplate(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) {
    if (k === 'row_number' || k === 'updated_at') continue;
    out[k] = String(v == null ? '' : v);
  }
  return out;
}

function stableStringify(obj) {
  return JSON.stringify(Object.keys(obj || {}).sort().map(k => [k, String(obj[k] == null ? '' : obj[k])]));
}

function assertEqual(label, a, b) {
  const ja = typeof a === 'object' && a ? stableStringify(a) : JSON.stringify(a);
  const jb = typeof b === 'object' && b ? stableStringify(b) : JSON.stringify(b);
  if (ja !== jb) throw new Error(`${label} mismatch\nold=${ja}\nnew=${jb}`);
}

async function backfill() {
  const templates = await fetchTemplatesFromN8n();
  const prompts = await fetchPromptsFromN8n();
  const expectedTemplates = {};
  const expectedPrompts = {};

  let templateCount = 0;
  for (const [clientName, raw] of Object.entries(templates)) {
    const slug = routeSlug(clientName);
    if (!slug) continue;
    const data = compactTemplate(Object.assign({}, raw, { client_name: String((raw && raw.client_name) || clientName) }));
    expectedTemplates[slug] = data;
    await upsertTemplate(slug, data, 'a4-backfill');
    templateCount++;
  }

  let promptCount = 0;
  for (const [slugRaw, prompt] of Object.entries(prompts)) {
    const slug = routeSlug(slugRaw);
    if (!slug) continue;
    expectedPrompts[slug] = String(prompt == null ? '' : prompt);
    await upsertPrompt(slug, expectedPrompts[slug], 'a4-backfill');
    promptCount++;
  }

  const dbTemplates = await getJson(`${SUPA_URL}/rest/v1/templates?select=client_slug,data`, { headers: supaHeaders({ Accept: 'application/json' }) });
  const dbPrompts = await getJson(`${SUPA_URL}/rest/v1/caption_prompts?select=client_slug,prompt`, { headers: supaHeaders({ Accept: 'application/json' }) });
  const dbTemplateMap = Object.fromEntries((Array.isArray(dbTemplates) ? dbTemplates : []).map(r => [r.client_slug, compactTemplate(r.data || {})]));
  const dbPromptMap = Object.fromEntries((Array.isArray(dbPrompts) ? dbPrompts : []).map(r => [r.client_slug, String(r.prompt || '')]));
  const templateMismatches = Object.keys(expectedTemplates).filter(slug => stableStringify(expectedTemplates[slug]) !== stableStringify(dbTemplateMap[slug]));
  const promptMismatches = Object.keys(expectedPrompts).filter(slug => expectedPrompts[slug] !== dbPromptMap[slug]);
  if (templateMismatches.length || promptMismatches.length) {
    throw new Error(`backfill value verification failed: templates=${templateMismatches.join(',') || 'ok'} prompts=${promptMismatches.join(',') || 'ok'}`);
  }

  console.log(JSON.stringify({
    ok: true,
    backfill: {
      templatesFromN8n: templateCount,
      templatesInSupabase: Array.isArray(dbTemplates) ? dbTemplates.length : null,
      templateValuesMatched: true,
      promptsFromN8n: promptCount,
      promptsInSupabase: Array.isArray(dbPrompts) ? dbPrompts.length : null,
      promptValuesMatched: true,
    },
  }, null, 2));
}

async function postJson(url, body, headers) {
  return getJson(url, {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json' }, headers || {}),
    body: JSON.stringify(body),
  });
}

async function restoreTemplate(originalRow, originalN8nTemplate) {
  const restoreData = { client_name: TEST_CLIENT_NAME };
  for (const field of TEMPLATE_FIELDS) restoreData[field] = String((originalN8nTemplate && originalN8nTemplate[field]) || '');
  await postJson(TEMPLATES_SAVE_N8N_URL, { clientName: TEST_CLIENT_NAME, patch: restoreData });
  if (originalRow) await upsertTemplate(TEST_CLIENT_SLUG, originalRow.data || restoreData, 'a4-parity-restore');
  else await deleteTemplateRow(TEST_CLIENT_SLUG);
}

async function restorePrompt(originalRow, originalPrompt) {
  await postJson(CAPTION_PROMPTS_SAVE_N8N_URL, { client: TEST_CLIENT_SLUG, prompt: String(originalPrompt || '') });
  if (originalRow) await upsertPrompt(TEST_CLIENT_SLUG, originalRow.prompt || '', 'a4-parity-restore');
  else await deletePromptRow(TEST_CLIENT_SLUG);
}

async function parity() {
  if (!STAFF_KEY) throw new Error('SYNCVIEW_STAFF_KEY is required for protected Edge writer parity');
  const templatesBefore = await fetchTemplatesFromN8n();
  const promptsBefore = await fetchPromptsFromN8n();
  const originalTemplate = templatesBefore[TEST_CLIENT_NAME] || null;
  const originalPrompt = promptsBefore[TEST_CLIENT_SLUG] || '';
  const originalTemplateRow = await fetchTemplateRow(TEST_CLIENT_SLUG);
  const originalPromptRow = await fetchPromptRow(TEST_CLIENT_SLUG);

  const templatePatch = {
    client_name: TEST_CLIENT_NAME,
    reels_preferences: `A4 parity templates ${Date.now()}`,
    thumbnails_preferences: `A4 parity thumbs ${Date.now()}`,
  };
  const promptText = `A4 parity caption prompt ${Date.now()}`;

  try {
    const oldTemplateResp = await postJson(TEMPLATES_SAVE_N8N_URL, { clientName: TEST_CLIENT_NAME, patch: templatePatch });
    if (!oldTemplateResp || oldTemplateResp.ok !== true || !oldTemplateResp.template) throw new Error('n8n templates-save unexpected response');
    const efTemplateResp = await postJson(TEMPLATES_SAVE_EF_URL, { clientName: TEST_CLIENT_NAME, patch: templatePatch }, {
      'X-Syncview-Key': STAFF_KEY,
      'X-Syncview-Source': 'parity',
    });
    if (!efTemplateResp || efTemplateResp.ok !== true || !efTemplateResp.template) throw new Error('EF templates-save unexpected response');

    const oldTemplateComparable = compactTemplate(oldTemplateResp.template);
    const efTemplateComparable = compactTemplate(efTemplateResp.template);
    for (const key of Object.keys(templatePatch)) assertEqual(`templates.${key}`, oldTemplateComparable[key] || '', efTemplateComparable[key] || '');

    const oldPromptResp = await postJson(CAPTION_PROMPTS_SAVE_N8N_URL, { client: TEST_CLIENT_SLUG, prompt: promptText });
    if (!oldPromptResp || oldPromptResp.ok !== true) throw new Error('n8n caption-prompts-save unexpected response');
    const efPromptResp = await postJson(CAPTION_PROMPTS_SAVE_EF_URL, { client: TEST_CLIENT_SLUG, prompt: promptText }, {
      'X-Syncview-Key': STAFF_KEY,
      'X-Syncview-Source': 'parity',
    });
    if (!efPromptResp || efPromptResp.ok !== true) throw new Error('EF caption-prompts-save unexpected response');
    assertEqual('caption prompt text', String(oldPromptResp.prompt || promptText), String(efPromptResp.prompt || ''));

    console.log(JSON.stringify({
      ok: true,
      parity: {
        client: TEST_CLIENT_SLUG,
        templatesSave: 'PASS',
        captionPromptsSave: 'PASS',
      },
    }, null, 2));
  } finally {
    await restoreTemplate(originalTemplateRow, originalTemplate);
    await restorePrompt(originalPromptRow, originalPrompt);
  }
}

(async () => {
  const backfillMode = process.argv.includes('--backfill');
  const parityMode = process.argv.includes('--parity');
  if (!backfillMode && !parityMode) {
    console.error('Usage: node scripts/a4-settings-backfill-parity.js --backfill [--parity]');
    process.exit(2);
  }
  if (backfillMode) await backfill();
  if (parityMode) await parity();
})().catch(e => {
  console.error(e && e.stack ? e.stack : e);
  process.exit(1);
});
