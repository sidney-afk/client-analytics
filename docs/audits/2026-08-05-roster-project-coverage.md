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

### Two authorities over one roster cell — and what it costs

`clients.linear_project_ids` is read by two different rules, and they disagree
about a cell whose ids sit under no team key:

| consumer | authority | untagged ids |
|---|---|---|
| `buildProjectIndex` (reconciler, B1, all attribution) | `configuredProjectIds` — **team-blind** | resolves correctly |
| `projectForIntake` (real-client native intake) | `projectIdsForTeam` — **team-aware** | hard 409, intake refused |
| `intakeAttribution` (the stamp) | *was* `projectIdsForTeam` | stamped `needs_attribution` where the reconciler says `resolved` |

`projectForIntake`'s strictness is **deliberate** and documented at the throw
site: real-client intake never guesses a team's project from an untagged list
during a graphics/video split. That guard should stay. What must change is the
stamp, which is compared against the reconciler's output and therefore has to be
computed under the reconciler's rule — a stamp built on a stricter rule than its
comparator is guaranteed to disagree.

### Measured: would production intake be refused for anyone?

Run `31033404394`, using the gateway's **own** `projectIdsForTeam` imported from
`production-write/policy.mjs` rather than a local re-implementation. Refusal is
evaluated for **every** team, not only teams with existing work, because the risk
is the next submission rather than the current backlog.

| | video | graphics |
|---|---|---|
| `intake_refused_missing` | 1 — **`{test: 1}`** | 1 — **`{test: 1}`** |
| `intake_refused_ambiguous` | 0 | 0 |
| …for a team that already has work | 1 — `{test: 1}` | 1 — `{test: 1}`|

**Zero real clients are refused intake on either team.** Every refusal is the
TEST row.

This also disproves a concern raised while enumerating: the *second* client with
untagged ids is **not** at risk. It carries exactly one team-tagged id for both
teams, so `projectIdsForTeam` returns one for each and intake proceeds; its extra
untagged id is inert. The earlier worry that it might hit `project_mapping_missing`
on a first submission for some team was wrong.

**Not a flip blocker.** The divergence is real and worth removing, but its entire
live blast radius is the TEST row.

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
