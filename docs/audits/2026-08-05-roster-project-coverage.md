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

## Measurement — no real client is affected

Two runs. The first (`31013883264`) could not tell the shared TEST row from a
paying client; the second (`31014675948`) splits every counter by
`clients.kind`. Whole active roster, 4,834 deliverables.

| | count |
|---|---:|
| active clients | 34 (33 `client`, 1 `test`) |
| active clients with no registered projects at all | 0 |
| active clients with ids under no team key | 2 |
| deliverables whose client is not on the active roster | 39 |
| **clients with at least one gap** | **1 — and it is `kind: test`** |

Per team, by kind:

| | video | graphics |
|---|---:|---:|
| clients with work | 34 | 34 |
| …and no project under that team's key (**weak**) | 1 (`test`) | 1 (`test`) |
| …whose issues name an unregistered project (**strong**) | 0 | 1 (`test`) |
| deliverables on unregistered projects | 0 | 24 (`test`) |

**`clients_with_at_least_one_gap_by_kind: { test: 1 }`. Every real client on the
roster has a registered Linear project for each team it has work in.** The only
row with a gap is the TEST client, and the 24 affected Graphics deliverables are
its own nightly-drill fixtures — the same missing entry
`docs/ops/TEST_CLIENT_GRAPHICS_PROJECT_MAPPING.md` describes.

This is a clean negative result, and it is the answer to "is the TEST client the
only row where a second team was added and the list was not updated?" — yes.

### A correction worth recording

The first run was reported as a finding against a real client. It was not. The
numbers were identical; what was missing was the kind split, without which
`clients_with_at_least_one_gap: 1` reads as "one client is affected" when the
truthful reading was "the test row is affected". An aggregate that cannot
separate a test fixture from a paying client is not a safe pre-flip check, and
the instrument had to be fixed before its output meant anything.

### Still worth a glance

`active_clients_with_ids_under_no_team_key: 2` — two clients have project ids
filed under no recognised team key. Attribution still resolves for them
(`configuredProjectIds` ignores team keys), so this is untidy rather than
broken. No action required; recorded so a future reader does not rediscover it
as a fault.

## Public-repo posture

The script prints counts and team keys only. `assertAggregateOnly` re-checks the
rendered report against every slug, name, id and Linear project id it read, and
refuses to emit if any appears — so a future edit that starts naming a client
fails the run instead of leaking. There is no `--apply` and no mutating HTTP
method; the lane is read-only by construction.
