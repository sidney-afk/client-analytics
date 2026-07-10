# SMM Weekly Reports

Hidden weekly-report flow for social media managers and Kasper.

## URLs

- SMM form: `https://syncview.synchrosocial.com/#smm-weekly-report`
- Kasper viewer: `https://syncview.synchrosocial.com/#smm-weekly-reports`
- Kasper viewer with a week preselected: `https://syncview.synchrosocial.com/#smm-weekly-reports?week=2026-07-06`

These routes intentionally bypass the staff password gate. There is no login, by request.

## Data Model

Run `migrations/2026-07-10-smm-weekly-reports.sql` in the Supabase SQL editor.

Tables:

- `public.social_media_managers`
  - Supabase roster table that n8n keeps synced from the Google Sheet `Social Media Managers` tab.
  - The app reads this table through the `smm-weekly-reports` Edge Function.
- `public.smm_weekly_reports`
  - One immutable submission per SMM, client, and Monday-start week.
  - The unique key is `(week_start_date, smm_slug, client_slug)`.
  - `week_end_date` is generated from `week_start_date + 6`.

Writes are done by the Edge Function using the Supabase service role key. The browser can read through the public function and the open RLS read policies.

## Edge Function

Function: `supabase/functions/smm-weekly-reports/index.ts`

Deploy:

```bash
supabase functions deploy smm-weekly-reports --project-ref uzltbbrjidmjwwfakwve --no-verify-jwt
```

Supported calls:

- `GET /functions/v1/smm-weekly-reports?action=options`
  - Returns active SMMs and the current Monday week start.
- `GET /functions/v1/smm-weekly-reports?action=reports&week=YYYY-MM-DD&smm=<slug>`
  - Returns reports plus available weeks.
- `POST /functions/v1/smm-weekly-reports`
  - `{ "action": "submit", "report": { ... } }`
  - Inserts one immutable report.
- `POST /functions/v1/smm-weekly-reports`
  - `{ "action": "sync_managers", "replace": true, "managers": [...] }`
  - Used by n8n to sync the SMM roster from Google Sheets.

## n8n Workflow 1: Manager Sync

Purpose: keep `public.social_media_managers` ready for the form dropdown while Google Sheets is still the source.

Recommended workflow name: `SyncView SMM Reports - Manager Sync`

Nodes:

1. Schedule Trigger
   - Daily is enough. Hourly is fine if the roster changes often.
2. Google Sheets
   - Spreadsheet: the existing SyncView source sheet.
   - Sheet/tab: `Social Media Managers`.
   - Operation: read rows.
3. Code
   - Normalize rows into unique SMMs.
4. HTTP Request
   - POST to `https://uzltbbrjidmjwwfakwve.supabase.co/functions/v1/smm-weekly-reports`
   - JSON body from the Code node.

Code node shape:

```js
const byName = new Map();

for (const item of items) {
  const row = item.json || {};
  const name = String(
    row.social_media_manager ||
    row.smm_name ||
    row.smm ||
    row.name ||
    ''
  ).trim();

  if (!name) continue;

  const key = name.toLowerCase();
  const client = String(row.client || row.client_name || '').trim();
  const existing = byName.get(key) || {
    name,
    email: String(row.email || '').trim(),
    source: 'google_sheet',
    source_row_count: 0,
    source_clients: [],
  };

  existing.source_row_count += 1;
  if (client && !existing.source_clients.includes(client)) existing.source_clients.push(client);
  if (!existing.email && row.email) existing.email = String(row.email).trim();
  byName.set(key, existing);
}

return [{
  json: {
    action: 'sync_managers',
    replace: true,
    managers: Array.from(byName.values()),
  },
}];
```

HTTP Request body:

```json
{
  "action": "sync_managers",
  "replace": true,
  "managers": "={{ $json.managers }}"
}
```

## n8n Workflow 2: Weekly Reminder Email

Purpose: send Kasper the same reminder link every week. The page always loads current Supabase data, so the email does not need to contain report content.

Recommended workflow name: `SyncView SMM Reports - Weekly Reminder`

Nodes:

1. Schedule Trigger
   - Weekly, Monday morning.
2. Gmail
   - Use the same Gmail credential pattern as the existing Sales Intake workflow.
   - Send to Kasper.
   - Subject: `SMM weekly reports`
   - Body:

```html
<p>Weekly SMM reports are ready to review here:</p>
<p><a href="https://syncview.synchrosocial.com/#smm-weekly-reports">Open SMM weekly reports</a></p>
```

Optional improvement: add a Code node before Gmail to compute the current Monday date and link directly to `#smm-weekly-reports?week=YYYY-MM-DD`.

## Review Notes

- The form does not allow editing after submit.
- Duplicate submissions for the same SMM/client/week return `409 already_submitted`.
- Kasper's page is read-only.
- The app reads the current client roster from the same client search source used elsewhere in SyncView.
- The SMM roster reads from Supabase, so when Google Sheets is removed later, only the n8n roster sync source needs to change.
