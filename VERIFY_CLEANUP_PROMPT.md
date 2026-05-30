# Verification prompt — re-check the Sonia calendar cleanup

Paste the block below as the first message in a **new** Claude Code session
(same repo, same n8n MCP + Google Sheets access). It's a **read-only audit** —
it must not delete, archive, or modify anything.

---

You are auditing the result of a previous cleanup. **Do not modify, delete, or
archive anything — this is read-only.** If you find a problem, report it and stop;
do not try to fix it without my go-ahead.

Background: in a prior session we removed "phantom" rows from the
`Calendar_soniachopra` tab of Google Sheet `1Gsn5xLImJyMhBMCNjK_tigpoUfcSFnvxTQLkk-A9Yps`.
Phantoms were rows that had `status == "Archived"` AND **no content** in any of
these columns: `caption`, `name`, `asset_url`, `thumbnail_url`, `linear_issue_id`.
They carried post IDs belonging to Danielle Robin and Chelsey Scaffidi (cross-tab
echoes), not Sonia's own posts. We deleted 226 of them, leaving 8 real rows.

Please verify everything is still good:

1. **Pull fresh data** for all three tabs — `Calendar_soniachopra`,
   `Calendar_daniellerobin`, `Calendar_chelseyscaffidi` — using the existing
   n8n "calendar-get" webhook (or read the sheet via the n8n Google Sheets node).
   Use the `row_number` each read returns as the literal sheet row.

2. **Confirm Sonia's tab is clean:**
   - Total data rows == **8**.
   - **0 phantom rows** remain (apply the `status==Archived` + empty-content rule above).
   - Every remaining row has real content. List each surviving row's
     `row_number`, `id`, and a snippet of `name`/`caption` so I can eyeball them.
   - Expected survivors from last time were sheet rows **2–8 and 36** (row numbers
     will have shifted down after deletion — that's fine; just confirm the same 8
     posts by `id`).

3. **Confirm collateral safety:**
   - Danielle's and Chelsey's tabs still have their full, original row counts and
     their real comments intact (we never touched those tabs — confirm that's true).
   - Spot-check that any comment IDs still present on Sonia's 8 rows (if any) are
     genuinely Sonia's, not leftover Danielle/Chelsey echoes.

4. **Report** a short pass/fail summary:
   - ✅ / ❌ Sonia tab == 8 rows, 0 phantoms
   - ✅ / ❌ Danielle & Chelsey tabs unchanged
   - Any anomalies, with row numbers and IDs.

Do **not** rebuild or run the "Hard Delete Range" workflow — it's archived on
purpose. If a regression is found (phantoms reappeared, real rows missing), stop
and tell me what you found before doing anything.
