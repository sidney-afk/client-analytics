# Native intake project-mapping readiness

`production-write` must resolve exactly one Linear project for each client/team
pair before native Submit intake can mirror the resulting deliverables. The
readiness inventory is deliberately separate from the gateway and is
read-only: it cannot update `clients.linear_project_ids` or mutate Linear.

## Resolution model

The inventory discovers owner-review candidates; the gateway itself accepts
only step 1 for real-client creates:

1. A team-tagged `clients.linear_project_ids` entry is checked first. The
   durable shape is `{ "video": "<id>", "graphics": "<id>" }`; one Linear
   project can appear under both keys when it belongs to both teams. A direct
   recognized ID object or explicit `{team,id}` entry is also accepted; unknown
   nested metadata is never interpreted as a project ID.
2. If only transitional untagged IDs are populated, the report considers only
   those projects as migration candidates and validates their actual team.
   Exactly one is `configured`; zero is `missing`; more than one is
   `ambiguous`.
3. If no IDs are configured, the report matches active Linear projects by normalized
   exact client display name and team. One is `exact_match`; zero is `missing`;
   more than one is `ambiguous`.

Steps 2 and 3 never authorize `production-write`; a missing persisted team tag
returns `project_mapping_missing`. The default roster scope is active rows
whose `kind` is `client`, for the `video` and `graphics` teams. TEST intake remains governed by the gateway's
separate server-only TEST-project configuration.

## Run the dry-run

Provide a Supabase service role only for the read-only Clients REST request and
a read-capable Linear key only for the projects query:

```powershell
$env:SUPABASE_SERVICE_ROLE_KEY = '<private>'
$env:LINEAR_READ_API_KEY = '<private>'
node scripts/production-write-project-mapping.js --public-json artifacts/project-mapping-readiness.json
```

The public report contains aggregate counts only by default. To make unresolved
rows comparable across runs without exposing a client name or Linear ID, set a
private, stable `PROJECT_MAPPING_HASH_KEY`; the report then includes keyed
client pseudonyms. Do not publish or rotate that key with an evidence file.

For offline review, `--clients-json` and `--projects-json` replace the two live
reads. These inputs can contain private data and must not be committed.

## Optional private plan

Add `--private-plan <absolute-private-path>` to emit a human-reviewable plan.
The tool refuses to put this file anywhere inside the repository. This plan can
contain client names and Linear project IDs and must remain in private storage.
It proposes a patch only when every requested team resolves exactly once;
ambiguous or missing pairs are marked for manual review.

The plan is not executable by this program. `--apply` and `--write` are rejected,
and the implementation contains only a Supabase `GET` plus a Linear GraphQL
query. Mapping changes remain an owner-run, separately reviewed data operation,
not a runtime-flag flip. That separate operation was completed and recorded on
current main in #819; this inventory remains read-only.

## Green gate

Native production intake is mapping-ready only when
`production_ready_team_mappings` equals `total_team_mappings` for the intended
active-client roster. Zero `ambiguous` / `missing` discovery rows is not enough:
untagged and exact-name matches remain owner migration candidates and do not
authorize the gateway. Keep the public aggregate as reviewer evidence and the
private plan outside the repository. Persisted, team-tagged mappings are the
production gate.

### Current public-safe readiness

The 2026-07-12 read-only discovery run covered 31 active real-client rows and 62 required
team mappings; its 0/62 result was the pre-operation baseline. The separately reviewed
2026-07-13 #819 operation resolved that baseline and populated team-tagged mappings for all
31 active real-client rows. Independent readback is now **62/62 production-ready**: 31/31
Video mappings, 31/31 Graphics mappings, zero value mismatches, and zero skipped rows. Of
those clients, 28 use one verified shared project and three use separate per-team projects.
No client names or project IDs are reproduced here. The operation changed configuration
only and left all runtime flags unchanged; it did not deploy or enable native intake.
