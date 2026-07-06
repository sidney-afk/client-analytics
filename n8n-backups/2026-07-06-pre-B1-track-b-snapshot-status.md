# Track B B1 pre-snapshot status - 2026-07-06

Public-safe status only. Raw workflow JSON, Supabase rows, and secrets are not committed to this
public repo.

## Git

- Tag: `pre-B1-track-b-2026-07-06`
- Target commit: `f7d77561c823335964e6d78dd854b0086957884d`

## n8n

- B1 does not edit any n8n workflow.
- The weekly backup workflow was hardened on 2026-07-06 so its workflow export covers all 120
  live workflows, including `MJbMZ789B5ExZz9x`.
- No raw n8n workflow JSON is committed here.

## Supabase

Private JSON snapshots were written outside the public repo. The private artifact includes row
counts and checksums for the pre-B1 tables; raw rows and local storage paths are intentionally not
committed here.

## Linear

The B1 Linear pull is read-only and must run from an environment variable key. At snapshot time,
the dry-run evidence had not run yet; the later private B1 artifacts hold the approved dry-run and
backfill verification evidence.
