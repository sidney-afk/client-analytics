'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.join(__dirname, '..');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const templatesFn = fs.readFileSync(path.join(root, 'supabase/functions/templates-save/index.ts'), 'utf8');
const promptsFn = fs.readFileSync(path.join(root, 'supabase/functions/caption-prompts-save/index.ts'), 'utf8');
const config = fs.readFileSync(path.join(root, 'supabase/config.toml'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'migrations/2026-07-04-a4-settings-edge-functions.sql'), 'utf8');

assert(index.includes("const SETTINGS_EF_FLAG_KEY = 'settings_ef_clients';"), 'frontend must use settings_ef_clients');
assert(index.includes('TEMPLATES_SAVE_EF_URL'), 'templates EF URL missing');
assert(index.includes('CAPTION_PROMPTS_SAVE_EF_URL'), 'caption prompts EF URL missing');
assert(index.includes('_tplLoadFromSupabase'), 'templates Supabase overlay helper missing');
assert(index.includes('_calLoadCaptionPromptsFromSupabase'), 'caption prompts Supabase overlay helper missing');
assert(!index.includes('webhook/templates-get') && !index.includes('webhook/templates-save'), 'templates must not use the retired n8n sheet webhooks');
assert(index.includes('const live = await _tplLoadFromSupabase();'), 'templates must load from Supabase only');
assert(!index.includes('_tplLoadFromN8n'), 'templates must not keep an n8n loader');
/* n8n exit PR 3: the table is the one source; n8n caption-prompts-get is an error-only fallback
   after a browser last-known-good copy, and the flag no longer filters which rows are read. */
assert(index.includes('prompts = await _calLoadCaptionPromptsFromSupabase();')
  && index.includes('prompts = _calCaptionPromptsLkgRead();')
  && index.includes('prompts = await _calLoadCaptionPromptsFromN8n();')
  && index.indexOf('prompts = await _calLoadCaptionPromptsFromSupabase();') < index.indexOf('prompts = _calCaptionPromptsLkgRead();')
  && index.indexOf('prompts = _calCaptionPromptsLkgRead();') < index.indexOf('prompts = await _calLoadCaptionPromptsFromN8n();'),
  'caption prompts must load from the table first, then the saved copy, then n8n only on error');
assert(!index.includes('_settingsUseEf'), 'caption prompt rows must no longer be gated by settings_ef_clients');
assert(index.includes('const writeUrl = TEMPLATES_SAVE_EF_URL;'), 'templates write must always use the Edge Function');
assert(index.includes('await _settingsAssertSavingOn(client);') && index.includes('const writeUrl = CAPTION_PROMPTS_SAVE_EF_URL;')
  && !index.includes('CAPTION_PROMPTS_SAVE_URL') && !index.includes('webhook/caption-prompts-save'),
  'caption prompt write must ask settings_ef_clients afresh and go to the function only, never n8n');
assert(index.includes("const GENERATE_CAPTION_URL       = 'https://synchrosocial.app.n8n.cloud/webhook/generate-caption';"), 'caption generation URL must remain n8n');

assert(migration.includes('create table if not exists public.templates'), 'templates table migration missing');
assert(migration.includes('create table if not exists public.caption_prompts'), 'caption_prompts table migration missing');
assert(migration.includes("values ('settings_ef_clients'"), 'settings flag seed missing');
assert(migration.includes('alter publication supabase_realtime add table public.templates'), 'templates realtime publication missing');
assert(migration.includes('alter publication supabase_realtime add table public.caption_prompts'), 'caption_prompts realtime publication missing');

assert(templatesFn.includes('.from("templates")'), 'templates-save must write templates table');
assert(!templatesFn.includes('generate-caption'), 'templates-save must not touch caption generation');
assert(promptsFn.includes('.from("caption_prompts")'), 'caption-prompts-save must write caption_prompts table');
assert(!promptsFn.includes('generate-caption'), 'caption-prompts-save must not touch caption generation');

assert(config.includes('[functions.templates-save]'), 'templates-save config missing');
assert(config.includes('[functions.caption-prompts-save]'), 'caption-prompts-save config missing');

console.log('A4 settings Edge Function source checks passed');
