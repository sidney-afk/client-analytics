# A4 n8n snapshot status - 2026-07-04

Public-safe status for the A4 settings migration. Raw n8n workflow JSON can contain credential
references and private business configuration, so no raw workflow export is committed to this
public repository.

The A4 implementation does not edit, deactivate, or delete any n8n workflow. These workflows remain
active as the fallback path while the Supabase settings tables and Edge Function writers bake.

| Workflow | ID | Endpoint | Status observed | Notes |
|---|---|---|---|---|
| SyncView Templates - Get | `RhEdtimfMUeogyL2` | `GET /webhook/templates-get` | active | Existing Sheet read fallback. Live shape: `{ ok, templates: { [client_name]: row } }`; observed 5 template rows before backfill. |
| SyncView Templates - Save | `oPX1nH7TxzCITNAz` | `POST /webhook/templates-save` | active | Existing Sheet write fallback. Body shape: `{ clientName, patch }`. |
| SyncView Caption Prompts - Get | `3hZnjXmHdNv4bttw` | `GET /webhook/caption-prompts-get` | active | Existing Sheet read fallback. Live shape: `{ ok, prompts: { [client_slug]: prompt } }`; observed 24 prompt rows before backfill. |
| SyncView Caption Prompts - Save | `RGkuE8d4uJg6CPde` | `POST /webhook/caption-prompts-save` | active | Existing Sheet write fallback. Body shape: `{ client, prompt }`. |

Rollback posture:

- Runtime fallback remains n8n while `syncview_runtime_flags.settings_ef_clients` is
  `{"clients":[]}`.
- No n8n workflow is retired in this PR.
- Caption generation (`generate-caption`) and filming-plan tabs are explicitly out of A4 scope and
  were not touched.
