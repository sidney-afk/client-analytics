'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
const files = {
  calendarUpsert: read('supabase/functions/calendar-upsert/index.ts'),
  calendarReorder: read('supabase/functions/calendar-reorder/index.ts'),
  sampleUpsert: read('supabase/functions/sample-review-upsert/index.ts'),
  sampleReorder: read('supabase/functions/sample-review-reorder/index.ts'),
  templates: read('supabase/functions/templates-save/index.ts'),
  prompts: read('supabase/functions/caption-prompts-save/index.ts'),
};
const migration = read('migrations/2026-07-11-b4-write-attribution.sql');

function ok(value, message) {
  if (!value) {
    console.error('FAIL b4-write-attribution-source:', message);
    process.exit(1);
  }
}

Object.entries(files).forEach(([name, source]) => {
  ok(source.includes('x-syncview-key'), `${name} CORS must allow the stored role key`);
  ok(source.includes('x-syncview-actor'), `${name} must accept actor attribution`);
  ok(source.includes('x-syncview-role'), `${name} must accept role attribution`);
});

ok(/function actorFrom\(req: Request, body: JsonMap\): Actor/.test(files.calendarUpsert),
  'calendar upsert must retain its header/body attribution resolver');
ok(/buildEvents\([^;]+actor/.test(files.calendarUpsert)
  && /actor: actor\.actor/.test(files.calendarUpsert)
  && /role: extra\.role === undefined \? actor\.role/.test(files.calendarUpsert),
  'calendar upsert events must persist actor and role');

ok(/function actorFrom\(req: Request, body: JsonMap\): Actor/.test(files.sampleUpsert),
  'sample upsert must resolve attribution from headers/body');
ok(/buildEvents\(client, sample, built\.row, existingRead\.row, actor,/.test(files.sampleUpsert),
  'sample upsert must pass request attribution into event construction');
ok(/actor: actor\.actor/.test(files.sampleUpsert)
  && /role: extra\.role === undefined \? actor\.role/.test(files.sampleUpsert)
  && /source: actor\.source/.test(files.sampleUpsert),
  'sample upsert events must persist actor, role, and source');

for (const [name, source, ledger] of [
  ['calendar reorder', files.calendarReorder, 'calendar_post_events'],
  ['sample reorder', files.sampleReorder, 'sample_review_events'],
]) {
  ok(source.includes('function actorFrom(req: Request, body: JsonMap): Actor'),
    `${name} must resolve request attribution`);
  ok(source.includes(`from("${ledger}").insert(events)`),
    `${name} must append to its card event ledger`);
  ok(source.includes('action: "reorder"')
    && source.includes('actor: actor.actor')
    && source.includes('role: actor.role'),
    `${name} reorder events must carry actor and role`);
}

ok(migration.includes('create table if not exists public.settings_events'),
  'settings event ledger migration missing');
ok(migration.includes('revoke all on public.settings_events from anon')
  && migration.includes('grant select, insert, update, delete on table public.settings_events to service_role'),
  'settings event ledger must remain service-role-only');

for (const [name, source, surface] of [
  ['templates', files.templates, 'templates'],
  ['caption prompts', files.prompts, 'caption_prompts'],
]) {
  ok(source.includes('function actorFrom(req: Request)'),
    `${name} must resolve request attribution`);
  ok(source.includes('from("settings_events").insert({'),
    `${name} must append a settings event`);
  ok(source.includes(`surface: "${surface}"`)
    && source.includes('actor: actor.actor')
    && source.includes('role: actor.role'),
    `${name} settings event must carry actor and role`);
}

ok(!files.templates.includes('payload: { data:')
  && !files.prompts.includes('payload: { prompt:'),
  'settings event payloads must not copy setting content');

console.log('B4 write-attribution source checks passed');
