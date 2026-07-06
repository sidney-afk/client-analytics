# 2026-07-06 — Templates-Save n8n whitelist: add multi-link `*_link_list` columns

## What changed
Workflow **"SyncView Templates — Save"** (`oPX1nH7TxzCITNAz`), node **"Build Row
From Patch"**. Its `ALLOWED` column whitelist gained three additive keys so the
Templates "multiple links per link field" feature (PR #697) persists on the n8n
(Google Sheet) path, not only the A4 Edge-Function path:

- `reels_reference_link_list`
- `thumbnails_photos_link_list`
- `thumbnails_canva_link_list`

No other node changed. The Google Sheets **"Upsert Template Row"** node already
uses `autoMapInputData` + `handlingExtraData: insertInNewColumn`, so the new
columns are auto-created in the Templates sheet on first write. The **"SyncView
Templates — Get"** workflow returns every column (no whitelist), so reads surface
them and the front-end renders one row per link.

## Why
The whitelist silently dropped any column not on it. The new `*_link_list`
columns were not listed, so multi-link edits on unflagged (n8n) clients kept only
the legacy first link — the extra links never persisted. Flagged clients that
route settings writes to the `templates-save` Edge Function were unaffected (the
EF stores arbitrary string keys, which is also why `thumbnails_color_sets` has
always worked).

## Versions
- Pre-change active version: `f56c6e1c-ca4f-410e-93d5-572366d7c17c`
- Post-change active version: `dc1f9c59-2c51-460f-a223-19407abce7df`

## Rollback (one step)
Restore the `ALLOWED` array in "Build Row From Patch" to its pre-change value
(remove the three `*_link_list` keys) and publish — or republish pre-change
version `f56c6e1c-…`. The change is purely additive (it only lets more columns
through the writer), so reverting cannot lose existing template data; any
auto-created sheet columns can be left in place, dormant.

Raw workflow JSON is not committed here (public repo — ROLLBACK rule 8); a
structural pre-change snapshot of the whitelist is kept in the private session
backup. No credentials are inline in this workflow (webhook requires no auth; the
Google Sheets node uses a stored credential reference, not an inline key).
