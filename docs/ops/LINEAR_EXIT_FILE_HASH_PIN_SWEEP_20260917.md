# Every file-hash pin, and whether anything running enforces it — 2026-09-17

Task five. Head `32480a22`. **Denominator: 497 distinct file-hash pins.**
Nothing here is fixed; two pins were repaired earlier today under tasks one and
two and are marked as such.

A pin counts as **enforced by a running gate** only if the code that checks it is
reachable — through `require`/`import` — from a suite in the unit lane
(`unitPlan().files`, 548 files), which is what CI executes. "Deferred only"
means the sole checker sits behind one of the 61 deferred suites. "Nothing"
means no suite in the repository reaches it at all.

## The answer, in one table

| | count | of 497 |
|---|---|---|
| pins that MATCH the current tree | 391 | |
| pins that are STALE | **46** | |
| targets that are private run output, never in the tree | 22 | expected |
| targets that do not resolve to a file | 19 | |
| hash constants that pin something other than a file | 19 | correctly excluded |

Of the **437** pins that resolve to a file in the tree:

| enforcement | pins | of which stale |
|---|---|---|
| unit lane (CI runs it) | 258 | **0** |
| deferred suites only | 5 | 0 |
| **nothing** | **174** | **46** |

**Every single stale pin is one that nothing running enforces. Not one stale pin
is under a gate CI executes.** That is the whole finding: staleness and absence
of enforcement are the same population here, which is what you would expect if
pins only ever go stale where nothing is watching.

## The 4 script-constant file pins — all four currently match

These are the pins written as a constant beside a path in a module, and they are
the ones that fail closed at runtime.

| module | constant | pins the bytes of | state | gate |
|---|---|---|---|---|
| `linear-exit-admission-preflight.js` | `CONTRACT_SHA` | `di/LINEAR_EXIT_ADMISSION_SCHEMA_CONTRACT_20260912.json` | matches | unit lane |
| `linear-exit-atomic-writer-bound-bundle.js` | `BUILDER_SHA256` | **`scripts/linear-exit-observed-full-install-plan.js`** | matches **as of today** | deferred only |
| `linear-exit-b9-catalog-derive.js` | `OPTOUT_PREREQUISITE_SHA` | `migrations/2026-09-14-team-members-auto-assign-opt-out.sql` | matches | **nothing** |
| `linear-exit-backup-observed-baseline.js` | `ARTIFACT_SHA` | `di/LINEAR_EXIT_BACKUP_TABLE_BASELINE_20260911.json` | matches | deferred only |

Two of the four deserve a note:

- `BUILDER_SHA256` is the pin repaired under task two. It was stale from
  `03d18fb3` until today, it pins **another file's** bytes, and its only gate is
  a `throw` reachable from one deferred suite. See §7d of the world-literal
  sweep.
- `OPTOUT_PREREQUISITE_SHA` pins a migration read via `git show` at a fixed ref,
  and **no suite reaches the code that checks it** — `linear-exit-b9-catalog-derive.js`
  is a tool, not a tested module. It happens to match. Nothing would tell us if
  it stopped.

## The 46 stale pins: all of them live in dated receipt artifacts

Grouped by the artifact that holds them, with how many of that artifact's file
pins still match:

| artifact | stale | matching | gate |
|---|---|---|---|
| `LINEAR_EXIT_INSTALL_OPERATOR_PG17_20260914.json` | 9 | 22 | nothing |
| `LINEAR_EXIT_OBSERVED_FULL_PIPELINE_20260913.json` | 7 | 21 | nothing |
| `LINEAR_EXIT_CONTROL_CURRENT_PUBLIC_PROOF_20260913.json` | 7 | 13 | nothing |
| `LINEAR_EXIT_CONTROL_RETIREMENT_PROOF_20260913.json` | 6 | 32 | nothing |
| `LINEAR_EXIT_CONTROL_RECOVERY_PROOF_20260912.json` | 5 | 7 | nothing |
| `LINEAR_EXIT_NATIVE_ONLINE_SEQUENCE_PG17_20260914.json` | 3 | 8 | nothing |
| `LINEAR_EXIT_NATIVE_PREINSTALL_BACKUP_PG17_20260913.json` | 3 | 6 | nothing |
| `LINEAR_EXIT_UPSTREAM_SIGNOFF_20260911.json` | 3 | 1 | nothing |
| `LINEAR_EXIT_RETIREMENT_SWITCH_PG17_20260913.json` | 2 | 18 | nothing |
| `LINEAR_EXIT_OBSERVED_INSTALL_TARGET_V1.json` | 1 | — | nothing |

**A dated receipt going stale is not, by itself, a defect.** These files record
what was true when a proof ran; the tree has moved since, which is the point of
dating them. Two things follow anyway, and they are the reason this table exists:

1. **A receipt whose pins no longer match cannot be re-verified.** It is a
   statement about a past tree, and nothing can now confirm it described the run
   it claims to. That matters for `LINEAR_EXIT_CONTROL_*_PROOF_*` and
   `LINEAR_EXIT_INSTALL_OPERATOR_PG17_20260914.json`, which are the receipts the
   exit leans on.
2. **`LINEAR_EXIT_OBSERVED_FULL_PIPELINE_20260913.json` is the one to watch.**
   Its 2026-09-17 successor *is* enforced — the operator's `SOURCE_PIN` loop
   reads it and refuses on any mismatch — so the pattern is already known to
   work. The 09-13 file is its predecessor, left byte-identical on purpose, and
   7 of its 28 pins have since gone stale.

## Not counted, and why

- **22 targets are private run output** (`*.private.json`, `RESULT.txt`,
  `*.private-error.log`). They live in a per-run proof directory, never in the
  tree. Not defects.
- **19 targets do not resolve**, mostly artifact entries naming a file by bare
  name where more than one directory could match, plus a few paths that no
  longer exist. Worth a look, but not a pin-staleness question.
- **19 hash constants pin something that is not a file** and are excluded by
  name-correspondence rather than guessed at. The clearest example is
  `scripts/linear-exit-install-maintenance.js` `PRIVATE_CATALOG_SHA`, which pins
  `j.sha(j.canonical(r[0].maintenance_catalog))` — a **runtime query result**.
  An earlier pass of this sweep bound it to the only path constant in the file
  and reported it stale. It is not a file pin at all. Also in this group:
  `linear-exit-install-profiles.js` `OLD`/`SETTLED` (catalog hashes),
  `f27-mirror-outbox-snapshot.js`'s two receipt hashes, and
  `linear-exit-complete-application-data.js` `INVENTORY_SHA256`.

## The method's own limit, stated

Enforcement is decided by a `require`/`import` graph over `scripts/` and
`test/`, plus, for artifact entries, by finding modules that mention the
artifact's path as a string. **That string search cannot tell code from a
comment.** It initially credited
`docs/independence/LINEAR_EXIT_OBSERVED_INSTALL_TARGET_V1.json` with a unit-lane
gate on the strength of two *comments* naming it; no code reads that file, and
its row above says `nothing`. Corrected there, and the consequence is general:

**the "unit lane" column is an upper bound on enforcement.** Where this sweep is
wrong, it is wrong in the direction of claiming more protection than exists,
never less. The 258 could be smaller. The 46 stale pins under no gate cannot be
larger for this reason.

---

Public-safety: no client slug, staff name, share token or credential appears
here; only repository paths and hashes of committed files.
