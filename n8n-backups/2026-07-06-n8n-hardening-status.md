# n8n hardening status - 2026-07-06

Raw workflow JSON is not committed because this repository is public.

Private backup folder:
`C:\Users\Sidney\Documents\Codex\private-backups\2026-07-06-n8n-hardening`

## Pre-edit snapshots

| Workflow | ID | Active before | Version before | Private backup SHA-256 |
|---|---|---:|---|---|
| SyncView Calendar - Linear Status Sync | `MJbMZ789B5ExZz9x` | true | `afb31a5f-4b49-4cbc-83f3-8fcf7749bf3b` | `784348571fd3c11bf138c7687a709b0fccb870729c1f86befb6a8664b98696e0` |
| SyncView - Weekly Backup | `jlVfbg0Njxf1It7h` | true | `3cf46301-606e-48a2-ba8e-557020b800c1` | `b9cb05eb9a9bb4736ef17d81358180e4e07062888e61a8201f6ba3e4144064fa` |

## Edits applied

| Workflow | Change | Readback evidence |
|---|---|---|
| `MJbMZ789B5ExZz9x` | Fixed `Handle Sample Linear Event` slugify regex to the calendar handler's safe `\u0300-\u036f` range. | Stored node code hash changed from `517f82fad936c8865148f858b96f1af89baa0e4dc59948fc43983c00098213a8` to `6bb2df802bd950a295706cd6f94c05a79124b5fea508e93ebd21220e69eb8a6a`; readback matched intended code and compiled successfully. |
| `MJbMZ789B5ExZz9x` | Added the minimal `Plan Workload Row` cycle-only guard: `Issue` update events without `updatedFrom.stateId` return no workload row. Create/remove behavior stays intact. | Stored node code hash changed from `2d83db5014099f69979197cefaee2745a2843c5b1a0cc813a1105f24872e1be9` to `1f555e6af4057362d114c4aec6d0b8cd9295b3ef38155b0ac795c25194b722f1`; readback matched intended code. Local readback harness: cycle-only update returned 0 rows, status update returned 1 row, remove returned 1 row. |
| `jlVfbg0Njxf1It7h` | Removed the inactive-only workflow export filter from `Export n8n Workflows`; it now keeps only `excludePinnedData=true` with `returnAll=true`. | Readback version `8b341e89-108c-4b30-b096-cf6da7fdc2f4`; post-edit private backup SHA-256 `aa587a89d6acac287d9178b1de4d33251038507ca2cd8d3f9b4a85365e723198`. REST inventory count is 120 workflows total: 75 active, 45 inactive, including `MJbMZ789B5ExZz9x`. |

Final `MJbMZ789B5ExZz9x` readback: active, version `655b6aa5-e571-451e-8f65-f4fcf78aff02`, settings unchanged (`executionOrder=v1`, `availableInMCP=true`, `binaryMode=separate`, `errorWorkflow=itqDXSl2ybsRSAiQ`).
