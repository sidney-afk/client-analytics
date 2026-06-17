// BACKUP — n8n workflow "SyncView Calendar — Linear Status Sync" (id: MJbMZ789B5ExZz9x)
// Captured: 2026-06-17, BEFORE adding the parallel Workload fast-path branch.
// ROLLBACK target (pre-change live version): activeVersionId 1e4d000c-6851-420c-a3dc-91c0cc9b7f4e
//   → n8n MCP publish_workflow with that versionId, or n8n UI version history → republish.
// The LIVE key in the node below is REDACTED here ([REDACTED-LINEAR-KEY]); never commit the real key.
//
// CHANGE BEING MADE (additive, isolated):
//   New parallel branch off the existing webhook "Receive Linear Event":
//     Receive Linear Event ──▶ Plan Workload Row (Code) ──▶ Upsert Workload (HTTP → Supabase workload_issues)
//   The existing "Handle Linear Event" node + its connection are UNCHANGED. Both new nodes use
//   onError:continueRegularOutput so a workload-branch failure can never halt the calendar status sync.
//   The new branch needs NO Linear key — the Linear webhook payload (body.data) already includes the
//   fully-resolved issue (assignee, state, team, project, dueDate, title, parentId).
//
// ---- EXISTING node "Handle Linear Event" (unchanged by this work; shown for the snapshot) ----

const body = ($input.first() && $input.first().json && $input.first().json.body) || {};
if (body.type !== 'Issue') return [{ json: { ok: true, skipped: 'not an issue event' } }];
const action = body.action;
const issueId = (body.data && body.data.id) || '';
if (!issueId) return [{ json: { ok: true, skipped: 'no issue id' } }];
if (action === 'create') return [{ json: { ok: true, skipped: 'card creation handled by frontend' } }];
const LINEAR_KEY = '[REDACTED-LINEAR-KEY]';
const GET_URL = 'https://synchrosocial.app.n8n.cloud/webhook/calendar-get';
const UPSERT_URL = 'https://synchrosocial.app.n8n.cloud/webhook/calendar-upsert-post';
const SUPA_URL = 'https://uzltbbrjidmjwwfakwve.supabase.co/rest/v1/calendar_posts';
const SUPA_KEY = 'sb_publishable_P4-NdUWJqjtACWZOB6LPEA_8GANHAUA';
// … (status-mapping + Supabase candidate read + calendar upsert logic unchanged; see live workflow
//     or n8n-backups/linear-status-sync.2026-06-15.pre-targeted-read.json for the earlier snapshot) …
// This file documents the rollback point + the additive change; the full unchanged body is preserved
// in n8n's own version history (the authoritative rollback) under activeVersionId above.
