# 2026-08-05 — Roster project coverage, measured against live data

**Status:** measured read-only, nothing changed. First run:
`monitoring-cutover-proof` run `31013883264`, `roster-coverage` lane.

The TEST client's missing Graphics project id was not a test-fixture quirk. The
same lookup decides ownership for every real client, and nothing pages when it
misses. This is the pre-flip check on live data.

---

## What the counters mean, and why one of them is weak

`buildProjectIndex` (`scripts/f200-attribution.js`) resolves a Linear project to
a client via `configuredProjectIds`, which **ignores which team key an id sits
under**. A bare or unteamed shape still attributes correctly. That makes the two
counters very different in strength:

| counter | strength | what it means |
|---|---|---|
| `clients_with_work_and_no_registered_project` | **weak** | no id filed under *that team's* key. Tidiness, not breakage — attribution still resolves. |
| `clients_with_work_whose_issues_name_an_unregistered_project` | **strong** | the client's issues name a project in **no** client's registered set. Those rows resolve `direct_project_unmapped` and land unattributed. **This is the defect.** |

Reading the first result through the weak counter alone would have overstated
it. The first run also could not separate the shared TEST row from a paying
client, which is the only distinction that matters here — so every counter is
now also reported per `clients.kind`.

## First measurement

Whole active roster, `deliverables_checked: 4832`.

| | count |
|---|---:|
| active clients | 34 (33 `client`, 1 `test`) |
| active clients with no registered projects at all | 0 |
| active clients with ids under no team key | 2 |
| deliverables whose client is not on the active roster | 39 |
| clients with at least one gap | 1 |

Per team:

| | video | graphics |
|---|---:|---:|
| clients with work | 34 | 34 |
| …and no project under that team's key (**weak**) | 1 | 1 |
| …whose issues name an unregistered project (**strong**) | 0 | **1** |
| distinct unregistered project ids seen | 0 | **1** |
| deliverables on unregistered projects | 0 | **23** |

**Video is clean on the strong counter.** The whole finding is on **Graphics**:
one client, one unregistered Linear project, **23 deliverables** currently
resolving to `direct_project_unmapped`.

`clients_with_at_least_one_gap: 1` means a single client accounts for every
number above — the weak counts on both teams and the strong count on Graphics
are the same row. The by-kind split (added after this run) is what says whether
that row is the TEST client or a real one; the first run predates it.

## Why this is worth acting on before the flip

Graphics is the team being moved to SyncView authority. A client whose Graphics
project is unregistered has its Graphics work landing unattributed *today*, and
the flip does not fix it — it changes which direction the resulting diffs are
counted in. 23 rows is small enough to fix with one cell edit and large enough
that leaving it means the soak reads against a client whose ownership is already
wrong.

The fix is the same two-minute edit as
`docs/ops/TEST_CLIENT_GRAPHICS_PROJECT_MAPPING.md` Step 2, on a different row.

## Public-repo posture

The script prints counts and team keys only. `assertAggregateOnly` re-checks the
rendered report against every slug, name, id and Linear project id it read, and
refuses to emit if any appears — so a future edit that starts naming a client
fails the run instead of leaking. There is no `--apply` and no mutating HTTP
method; the lane is read-only by construction.
