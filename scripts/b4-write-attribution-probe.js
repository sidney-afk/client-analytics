'use strict';

/*
 * B4 write-attribution probe.
 *
 * Exercises every staff write Edge Function against an explicitly confirmed
 * TEST client, verifies actor/role persistence, then restores every touched
 * row and removes the disposable ledger entries.
 *
 * Required:
 *   SUPABASE_SERVICE_ROLE_KEY
 *   B4_ATTRIBUTION_CLIENT=<TEST client slug>
 *   B4_ATTRIBUTION_CONFIRM=TEST_ONLY
 */

const SUPABASE_URL = (process.env.SUPABASE_URL || 'https://uzltbbrjidmjwwfakwve.supabase.co').replace(/\/+$/, '');
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const CLIENT = String(process.env.B4_ATTRIBUTION_CLIENT || '').trim();
const CONFIRM = process.env.B4_ATTRIBUTION_CONFIRM || '';
const ACTOR = 'B4 TEST Operator';
const ROLE = 'smm';
const RUN = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
const CALENDAR_ID = `b4_attr_cal_${RUN}`;
const SAMPLE_ID = `b4_attr_sample_${RUN}`;
const SETTINGS_SOURCE = `b4-attribution-${RUN}`;

if (!SERVICE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required');
if (!CLIENT) throw new Error('B4_ATTRIBUTION_CLIENT is required');
if (CONFIRM !== 'TEST_ONLY') throw new Error('Set B4_ATTRIBUTION_CONFIRM=TEST_ONLY to acknowledge disposable TEST writes');

function enc(value) {
  return encodeURIComponent(String(value));
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value).sort().reduce((out, key) => {
    out[key] = stable(value[key]);
    return out;
  }, {});
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function rest(path, options = {}) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: options.method || 'GET',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch (_error) { body = text; }
  if (!response.ok) throw new Error(`REST ${options.method || 'GET'} ${path} failed: HTTP ${response.status} ${String(text).slice(0, 240)}`);
  return body;
}

async function invoke(name, payload) {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Syncview-Actor': ACTOR,
      'X-Syncview-Role': ROLE,
      'X-Syncview-Source': SETTINGS_SOURCE,
    },
    body: JSON.stringify(payload),
  });
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch (_error) { body = text; }
  if (!response.ok || !body || body.ok !== true) {
    throw new Error(`${name} failed: HTTP ${response.status} ${String(text).slice(0, 240)}`);
  }
  return body;
}

async function one(table, filter) {
  const rows = await rest(`${table}?${filter}&select=*&limit=1`);
  return Array.isArray(rows) ? rows[0] || null : null;
}

async function restoreSingleton(table, key, value, snapshot) {
  await rest(`${table}?${key}=eq.${enc(value)}`, {
    method: 'DELETE',
    headers: { Prefer: 'return=minimal' },
  });
  if (snapshot) {
    await rest(`${table}?on_conflict=${key}`, {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: snapshot,
    });
  }
}

async function poll(label, reader, predicate, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await reader();
    if (predicate(last)) return last;
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  throw new Error(`${label} did not persist before timeout`);
}

function hasAttribution(event, action) {
  return event && event.actor === ACTOR && event.role === ROLE && (!action || event.action === action);
}

async function main() {
  const calendarSnapshot = await one('calendar_posts', `client=eq.${enc(CLIENT)}&id=eq.${enc(CALENDAR_ID)}`);
  const sampleSnapshot = await one('sample_reviews', `client=eq.${enc(CLIENT)}&id=eq.${enc(SAMPLE_ID)}`);
  const templateSnapshot = await one('templates', `client_slug=eq.${enc(CLIENT)}`);
  const promptSnapshot = await one('caption_prompts', `client_slug=eq.${enc(CLIENT)}`);
  assert(!calendarSnapshot, 'generated calendar probe id already exists; refusing to overwrite');
  assert(!sampleSnapshot, 'generated sample probe id already exists; refusing to overwrite');
  const verified = [];
  let settingsEventIds = [];

  try {
    await invoke('calendar-upsert', {
      client: CLIENT,
      post: {
        id: CALENDAR_ID,
        name: 'B4 attribution probe',
        scheduled_date: '2099-01-01',
        status: 'In Progress',
        video_status: 'In Progress',
        graphic_status: 'In Progress',
        caption_status: 'In Progress',
        order_index: 900001,
      },
    });
    const calendarCreate = await poll(
      'calendar-upsert attribution',
      () => one('calendar_post_events', `client=eq.${enc(CLIENT)}&post_id=eq.${enc(CALENDAR_ID)}&action=eq.create&order=id.desc`),
      event => hasAttribution(event, 'create'),
    );
    assert(calendarCreate.source === 'ui', 'calendar-upsert source normalization changed');
    verified.push('calendar-upsert');

    await invoke('calendar-reorder', {
      client: CLIENT,
      items: [{ id: CALENDAR_ID, order_index: 900002 }],
    });
    const calendarReorder = await poll(
      'calendar-reorder attribution',
      () => one('calendar_post_events', `client=eq.${enc(CLIENT)}&post_id=eq.${enc(CALENDAR_ID)}&action=eq.reorder&order=id.desc`),
      event => hasAttribution(event, 'reorder'),
    );
    assert(calendarReorder.source === 'ui', 'calendar-reorder source normalization changed');
    verified.push('calendar-reorder');

    await invoke('sample-review-upsert', {
      client: CLIENT,
      sample: {
        id: SAMPLE_ID,
        name: 'B4 attribution probe',
        status: 'In Progress',
        video_status: 'In Progress',
        graphic_status: 'In Progress',
        order_index: 900001,
      },
    });
    const sampleCreate = await poll(
      'sample-review-upsert attribution',
      () => one('sample_review_events', `client=eq.${enc(CLIENT)}&sample_id=eq.${enc(SAMPLE_ID)}&action=eq.create&order=id.desc`),
      event => hasAttribution(event, 'create'),
    );
    assert(sampleCreate.source === 'ui', 'sample-review-upsert source normalization changed');
    verified.push('sample-review-upsert');

    await invoke('sample-review-reorder', {
      client: CLIENT,
      items: [{ id: SAMPLE_ID, order_index: 900002 }],
    });
    const sampleReorder = await poll(
      'sample-review-reorder attribution',
      () => one('sample_review_events', `client=eq.${enc(CLIENT)}&sample_id=eq.${enc(SAMPLE_ID)}&action=eq.reorder&order=id.desc`),
      event => hasAttribution(event, 'reorder'),
    );
    assert(sampleReorder.source === 'ui', 'sample-review-reorder source normalization changed');
    verified.push('sample-review-reorder');

    await invoke('templates-save', {
      clientName: CLIENT,
      patch: { b4_attribution_probe: RUN },
    });
    const templateEvent = await poll(
      'templates-save attribution',
      () => one('settings_events', `client_slug=eq.${enc(CLIENT)}&surface=eq.templates&source=eq.${enc(SETTINGS_SOURCE)}&order=id.desc`),
      event => hasAttribution(event, 'save'),
    );
    settingsEventIds.push(templateEvent.id);
    assert(Array.isArray(templateEvent.payload && templateEvent.payload.changed_keys), 'templates-save event exposed an unexpected payload');
    verified.push('templates-save');

    await invoke('caption-prompts-save', {
      client: CLIENT,
      prompt: `B4 attribution probe ${RUN}`,
    });
    const promptEvent = await poll(
      'caption-prompts-save attribution',
      () => one('settings_events', `client_slug=eq.${enc(CLIENT)}&surface=eq.caption_prompts&source=eq.${enc(SETTINGS_SOURCE)}&order=id.desc`),
      event => hasAttribution(event, 'save'),
    );
    settingsEventIds.push(promptEvent.id);
    assert(Number(promptEvent.payload && promptEvent.payload.prompt_length) > 0, 'caption-prompts-save event omitted prompt metadata');
    verified.push('caption-prompts-save');
  } finally {
    await rest(`calendar_post_events?client=eq.${enc(CLIENT)}&post_id=eq.${enc(CALENDAR_ID)}`, {
      method: 'DELETE', headers: { Prefer: 'return=minimal' },
    });
    await rest(`calendar_posts?client=eq.${enc(CLIENT)}&id=eq.${enc(CALENDAR_ID)}`, {
      method: 'DELETE', headers: { Prefer: 'return=minimal' },
    });

    await rest(`sample_review_events?client=eq.${enc(CLIENT)}&sample_id=eq.${enc(SAMPLE_ID)}`, {
      method: 'DELETE', headers: { Prefer: 'return=minimal' },
    });
    await rest(`sample_reviews?client=eq.${enc(CLIENT)}&id=eq.${enc(SAMPLE_ID)}`, {
      method: 'DELETE', headers: { Prefer: 'return=minimal' },
    });

    await restoreSingleton('templates', 'client_slug', CLIENT, templateSnapshot);
    await restoreSingleton('caption_prompts', 'client_slug', CLIENT, promptSnapshot);

    if (settingsEventIds.length) {
      await rest(`settings_events?id=in.(${settingsEventIds.map(enc).join(',')})`, {
        method: 'DELETE', headers: { Prefer: 'return=minimal' },
      });
    }
  }

  const cleanup = {
    calendar_rows: await rest(`calendar_posts?client=eq.${enc(CLIENT)}&id=eq.${enc(CALENDAR_ID)}&select=id`),
    calendar_events: await rest(`calendar_post_events?client=eq.${enc(CLIENT)}&post_id=eq.${enc(CALENDAR_ID)}&select=id`),
    sample_rows: await rest(`sample_reviews?client=eq.${enc(CLIENT)}&id=eq.${enc(SAMPLE_ID)}&select=id`),
    sample_events: await rest(`sample_review_events?client=eq.${enc(CLIENT)}&sample_id=eq.${enc(SAMPLE_ID)}&select=id`),
    settings_events: await rest(`settings_events?source=eq.${enc(SETTINGS_SOURCE)}&select=id`),
  };
  assert(!calendarSnapshot && cleanup.calendar_rows.length === 0, 'calendar probe row cleanup failed');
  assert(cleanup.calendar_events.length === 0, 'calendar probe event cleanup failed');
  assert(!sampleSnapshot && cleanup.sample_rows.length === 0, 'sample probe row cleanup failed');
  assert(cleanup.sample_events.length === 0, 'sample probe event cleanup failed');
  assert(cleanup.settings_events.length === 0, 'settings probe event cleanup failed');

  const restoredTemplate = await one('templates', `client_slug=eq.${enc(CLIENT)}`);
  const restoredPrompt = await one('caption_prompts', `client_slug=eq.${enc(CLIENT)}`);
  assert(JSON.stringify(stable(restoredTemplate)) === JSON.stringify(stable(templateSnapshot)), 'template snapshot was not restored exactly');
  assert(JSON.stringify(stable(restoredPrompt)) === JSON.stringify(stable(promptSnapshot)), 'caption prompt snapshot was not restored exactly');

  console.log(JSON.stringify({
    ok: true,
    scope: 'TEST client only',
    verified,
    actor_present: true,
    role_present: true,
    cleanup: 'complete',
  }, null, 2));
}

main().catch(error => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exitCode = 1;
});
