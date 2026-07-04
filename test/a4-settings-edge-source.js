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
assert(index.includes('_tplLoadFromSupabase'), 'templates must prefer Supabase reads');
assert(index.includes('_calLoadCaptionPromptsFromSupabase'), 'caption prompts must prefer Supabase reads');
assert(index.includes('_settingsWriteUrlForClient(name, TEMPLATES_SAVE_EF_URL, TEMPLATES_SAVE_URL)'), 'templates write must be flag-routed with n8n fallback');
assert(index.includes('_settingsWriteUrlForClient(client, CAPTION_PROMPTS_SAVE_EF_URL, CAPTION_PROMPTS_SAVE_URL)'), 'caption prompt write must be flag-routed with n8n fallback');
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
