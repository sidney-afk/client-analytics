#!/usr/bin/env node
'use strict';
/*
 * Client resource census (Stage 2.3 of docs/plans/2026-10-01-onboarding-checklist-and-profile.md).
 *
 * READ ONLY, COUNTS ONLY. For the active clients it reports, per resource, how
 * many have it and how many are missing it, and which onboarding steps the
 * system could tick by itself (the detector behind the "auto" steps). It never
 * prints a client name, slug, token, credential, channel id, handle, email or
 * link, because the only thing the query returns is numbers.
 *
 * It reads the base tables only, so it works before the checklist tables
 * (migration 2026-10-03-onboarding-checklist-tables.sql) are applied; it also
 * says whether they are installed.
 *
 *   SUPABASE_ACCESS_TOKEN=... node scripts/client-resource-census.js [--json]
 *   node scripts/client-resource-census.js --print-sql      (no network)
 *
 * The one query is a single SELECT; validateReadOnly() refuses anything else
 * before it is sent, and the Management API call is a plain POST of that text.
 */

const PROJECT_REF_DEFAULT = 'uzltbbrjidmjwwfakwve';
const ROUTING_LISTS = ['sample_review_ef_clients', 'calendar_upsert_ef_clients', 'settings_ef_clients', 'write_ui_reroute_clients'];

// The Templates page rule (qa/dawn/templates-coverage.js hasThumbnailLink): a link list wins when it
// holds anything, otherwise the single field; a slot counts only when it is an http(s) link.
const CANVA_RULE = `case
      when coalesce(t.data->>'thumbnails_canva_link_list', '') ~ '^\\s*\\[\\s*[^\\]\\s]'
        then coalesce(t.data->>'thumbnails_canva_link_list', '') ~* '"\\s*https?://'
      else coalesce(t.data->>'thumbnails_canva_link', '') ~* '^\\s*https?://'
    end`;

const blank = (col) => `btrim(coalesce(${col}, '')) <> ''`;

// Resource -> boolean SQL for one active client (alias c = clients row, p = its profile row).
const RESOURCES = [
  { key: 'roster_row', label: 'Roster row', expr: 'true' },
  { key: 'profile', label: 'Client profile', expr: 'p.slug is not null' },
  { key: 'review_token', label: 'Review token (never printed)', expr: "exists (select 1 from public.client_access a where a.slug = c.slug and " + blank('a.review_token') + ')' },
  { key: 'email', label: 'Email', expr: 'p.slug is not null and ' + blank('p.email') },
  { key: 'instagram_handle', label: 'Instagram handle', expr: 'p.slug is not null and ' + blank('p.instagram_handle') },
  { key: 'tiktok_handle', label: 'TikTok handle', expr: 'p.slug is not null and ' + blank('p.tiktok_handle') },
  { key: 'youtube_channel', label: 'YouTube channel id', expr: 'p.slug is not null and ' + blank('p.youtube_channel_id') },
  { key: 'any_social_handle', label: 'At least one social handle', expr: 'p.slug is not null and (' + [blank('p.instagram_handle'), blank('p.tiktok_handle'), blank('p.youtube_channel_id')].join(' or ') + ')' },
  { key: 'competitors', label: 'Competitors', expr: 'p.slug is not null and ' + blank('p.competitors') },
  { key: 'keywords', label: 'Keywords', expr: 'p.slug is not null and ' + blank('p.keywords') },
  { key: 'description', label: 'Content description', expr: 'p.slug is not null and ' + blank('p.content_description') },
  { key: 'creative_channel', label: 'Creative Slack channel id', expr: 'p.slug is not null and ' + blank('p.creative_channel_id') },
  { key: 'client_channel', label: 'Client Slack channel id', expr: 'p.slug is not null and ' + blank('p.slack_channel_id') },
  { key: 'postforme_tiktok', label: 'Post For Me TikTok account', expr: 'p.slug is not null and ' + blank('p.postforme_account_id') },
  { key: 'filming_plan_link', label: 'Filming plan link', expr: 'exists (select 1 from public.filming_plans fp where fp.client_slug = c.slug and ' + blank('fp.doc_url') + ')' },
  { key: 'templates_row', label: 'Templates row', expr: 'exists (select 1 from public.templates t where t.client_slug = c.slug)' },
  { key: 'canva_link', label: 'Thumbnail Canva link (any http link, the Templates page rule)', expr: 'exists (select 1 from public.templates t where t.client_slug = c.slug and ' + CANVA_RULE + ')' },
  { key: 'credentials_vault', label: 'Logins vault (never printed)', expr: 'exists (select 1 from public.client_credentials cc where cc.client_slug = c.slug)' },
  { key: 'onboarding_form', label: 'Onboarding form answers (standard, AI or old Notion form)', expr: 'exists (select 1 from public.client_onboarding o where o.slug = c.slug) or exists (select 1 from public.ai_client_onboarding o where o.slug = c.slug) or exists (select 1 from public.legacy_onboarding o where o.slug = c.slug)' },
  { key: 'calendar_cards', label: 'Calendar cards', expr: 'exists (select 1 from public.calendar_posts cp where cp.client = c.slug)' },
  { key: 'sample_reviews', label: 'Sample reviews', expr: 'exists (select 1 from public.sample_reviews sr where sr.client = c.slug)' },
  { key: 'analytics_metrics', label: 'Analytics metrics', expr: 'exists (select 1 from public.analytics_metrics am where am.client_slug = c.slug)' },
];
for (const list of ROUTING_LISTS) {
  RESOURCES.push({
    key: 'routing_' + list,
    label: 'Routing list ' + list,
    expr: `exists (select 1 from public.syncview_runtime_flags f where f.key = '${list}' and (f.value->'clients') ? c.slug)`,
  });
}
RESOURCES.push({
  key: 'routing_all_four',
  label: 'Enrolled in all four routing lists',
  expr: '(select count(*) from public.syncview_runtime_flags f where f.key in (' + ROUTING_LISTS.map((l) => `'${l}'`).join(', ') + ') and (f.value->\'clients\') ? c.slug) = ' + ROUTING_LISTS.length,
});

// Onboarding step -> resource the system can read to tick it by itself.
const DETECTORS = [
  ['roster_row_created', 'profile'],
  ['social_handle_saved', 'any_social_handle'],
  ['routing_enrolled', 'routing_all_four'],
  ['review_token_present', 'review_token'],
  ['research_done', 'keywords'],
  ['client_channel_created', 'client_channel'],
  ['creative_channel_created', 'creative_channel'],
  ['filming_plan_linked', 'filming_plan_link'],
  ['templates_and_canva', 'canva_link'],
  ['onboarding_form_received', 'onboarding_form'],
  ['first_card_created', 'calendar_cards'],
  ['samples_started', 'sample_reviews'],
  ['metrics_appearing', 'analytics_metrics'],
  ['social_posting_ids', 'postforme_tiktok'],
];

function buildQuery() {
  const cols = RESOURCES.map((r, i) => `  (${r.expr}) as r${i}`).join(',\n');
  const aggs = RESOURCES.map((r, i) => `'${r.key}', jsonb_build_object('have', count(*) filter (where r${i}), 'missing', count(*) filter (where not r${i}))`).join(',\n    ');
  const listAggs = ROUTING_LISTS.map((l) => `'${l}', jsonb_build_object(
      'entries', (select count(*) from jsonb_array_elements_text(coalesce((select f.value->'clients' from public.syncview_runtime_flags f where f.key = '${l}'), '[]'::jsonb))),
      'not_an_active_roster_row', (select count(*) from jsonb_array_elements_text(coalesce((select f.value->'clients' from public.syncview_runtime_flags f where f.key = '${l}'), '[]'::jsonb)) e
                                    where not exists (select 1 from public.clients x where x.slug = e and x.active)))`).join(',\n    ');
  return `with u as (
  select
${cols}
  from public.clients c
  left join public.client_profiles p on p.slug = c.slug and p.archived_at is null
  where c.active and c.kind = 'client'
)
select jsonb_build_object(
  'active_clients', (select count(*) from u),
  'active_test_clients', (select count(*) from public.clients where active and kind = 'test'),
  'inactive_roster_rows', (select count(*) from public.clients where not active),
  'resources', (select jsonb_build_object(
    ${aggs}) from u),
  'routing_lists', jsonb_build_object(
    ${listAggs}),
  'checklist_installed', (to_regclass('public.onboarding_steps') is not null and to_regclass('public.client_onboarding_progress') is not null)
) as census`;
}

const FORBIDDEN = /\b(insert|update|delete|drop|alter|create|grant|revoke|truncate|call|copy|do|execute|vacuum|set|reset|lock|comment|merge)\b/i;
function validateReadOnly(sql) {
  const text = String(sql).replace(/'[^']*'/g, "''"); // ignore string literals
  if (!/^\s*(with|select)\b/i.test(text)) throw new Error('census_query_not_a_select');
  if (text.includes(';')) throw new Error('census_query_has_multiple_statements');
  if (FORBIDDEN.test(text)) throw new Error('census_query_not_read_only');
  return true;
}

function shape(census) {
  if (!census || typeof census !== 'object' || typeof census.active_clients !== 'number' || !census.resources) {
    throw new Error('census_response_invalid');
  }
  const res = census.resources;
  const detectors = DETECTORS.map(([step, resource]) => {
    const r = res[resource];
    if (!r) throw new Error('census_detector_resource_missing');
    return { step, resource, can_tick: r.have, still_open: r.missing };
  });
  return {
    active_clients: census.active_clients,
    active_test_clients: census.active_test_clients,
    inactive_roster_rows: census.inactive_roster_rows,
    resources: RESOURCES.map((r) => ({ key: r.key, label: r.label, have: res[r.key].have, missing: res[r.key].missing })),
    routing_lists: census.routing_lists,
    detectors,
    checklist_installed: census.checklist_installed === true,
  };
}

function formatText(c) {
  const lines = [];
  lines.push(`Active clients: ${c.active_clients} (test clients: ${c.active_test_clients}, inactive roster rows: ${c.inactive_roster_rows})`);
  lines.push(`Onboarding checklist tables installed: ${c.checklist_installed ? 'yes' : 'no'}`);
  lines.push('', 'Resource: have / missing');
  for (const r of c.resources) lines.push(`  ${r.label}: ${r.have} / ${r.missing}`);
  lines.push('', 'Routing lists: entries, of which not an active roster row');
  for (const [k, v] of Object.entries(c.routing_lists)) lines.push(`  ${k}: ${v.entries}, ${v.not_an_active_roster_row}`);
  lines.push('', 'Steps the system can tick by itself: can tick / still open');
  for (const d of c.detectors) lines.push(`  ${d.step}: ${d.can_tick} / ${d.still_open}`);
  return lines.join('\n');
}

async function readCensus({ token, projectRef, fetchImpl = globalThis.fetch }) {
  if (!token || !/^[a-z0-9]{20}$/.test(projectRef || '')) throw new Error('census_config_missing');
  const query = buildQuery();
  validateReadOnly(query);
  const response = await fetchImpl(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
    method: 'POST',
    redirect: 'error',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  if (!response.ok) throw new Error('census_read_failed_http_' + response.status);
  const rows = await response.json();
  return shape(Array.isArray(rows) && rows[0] ? rows[0].census : null);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--print-sql')) { console.log(buildQuery()); return; }
  try {
    const census = await readCensus({
      token: String(process.env.SUPABASE_ACCESS_TOKEN || '').trim(),
      projectRef: String(process.env.PROJECT_REF || PROJECT_REF_DEFAULT).trim(),
    });
    console.log(args.includes('--json') ? JSON.stringify(census, null, 2) : formatText(census));
    console.log(`CLIENT_RESOURCE_CENSUS_OK active_clients=${census.active_clients}`);
  } catch (e) {
    console.error('CLIENT_RESOURCE_CENSUS_FAILED ' + (e && e.message ? e.message : 'unknown'));
    process.exit(1);
  }
}

module.exports = { RESOURCES, DETECTORS, ROUTING_LISTS, buildQuery, validateReadOnly, shape, formatText, readCensus };
if (require.main === module) main();
