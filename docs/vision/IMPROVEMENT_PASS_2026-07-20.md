# Repo-map improvement pass — 2026-07-20

> **Status:** proposal for owner ratification. This document does not rewrite
> `REPO_MAP.md`, `docs/FIND_ANYTHING.md`, or `docs/truth/BRIEFING.md`.
>
> **Owner pin P2:** “Audit the website map itself — is the way the map is built
> the best it can be?”
>
> **Scope:** structure and retrieval quality, not factual accuracy. The current
> map is treated as accurate and CI-enforced. Public-repo hygiene applies.

## Verdict

`REPO_MAP.md` is a strong inventory and an effective drift tripwire. It is not
yet the best locator for a human or an AI session.

Its main weakness is role overload. It simultaneously tries to be:

- a complete structural inventory;
- a runtime architecture summary;
- a safety briefing;
- a test-command catalog;
- a feature glossary; and
- a file-placement guide.

That produces long, frequently changing descriptions in the very document that
should be the most stable and scannable. The map also overlaps with the two
documents beside it:

- `docs/FIND_ANYTHING.md` already owns **question → authoritative document**;
- `docs/truth/BRIEFING.md` already owns **what the system is now and what is
  dangerous**;
- `REPO_MAP.md` should own **path → purpose → next open**.

The recommended change is a reshape, not a split into more prose. Keep one
CI-enforced map, give it a compact front index, normalize every row, move
volatile state out, and add generated inventories only where machines can do
the job better than prose.

## Evaluation

| Dimension | Current quality | Evaluation |
|---|---|---|
| Organization | Good | Major zones are sensible, but the first screen does not provide a complete scan of those zones. Runtime assets appear before the documentation most sessions need. |
| Granularity | Uneven | Some rows describe one file; others describe entire trees, architectures, deploy behavior, and current rollout state in one cell. |
| Navigability | Fair | Headings and tables help, but long cells are hard to skim and there is no task-neutral path index or anchor column. |
| Human retrieval | Fair | A reader can find a known path quickly with browser search, but cannot compare owners, mutability, or next documents consistently. |
| AI retrieval | Fair | Rich prose provides context, but volatile narrative increases token cost and creates competing answers with the briefing/truth layer. |
| Drift resistance | Strong structurally | CI catches top-level and `docs/` directory drift. Narrative claims and deeper inventories are not governed at the same precision. |
| Boundary clarity | Weak | The map, router, and briefing repeat architecture, safety, and operational-state concepts without an explicit ownership contract. |

## The three-document contract

| Document | One job | Contains | Excludes |
|---|---|---|---|
| `docs/FIND_ANYTHING.md` | Route a question | User intent, authoritative destination, register lookup | Directory inventory, current-state summaries |
| `REPO_MAP.md` | Locate an artifact | Stable path, purpose, owner/authority, next open | Live flags, rollout status, incident history, long behavior contracts |
| `docs/truth/BRIEFING.md` | Orient a session safely | Current system shape, laws, live safety, standing hazards, read order | Exhaustive directory listing, “where should this file go?” taxonomy |

This boundary should appear as a short banner near the top of all three
documents. When a fact fits two columns, the owning document carries the fact
and the other document links to it.

## Before and after

### Before — topic chapters with narrative-heavy rows

```text
Repo map
├── Top level
│   ├── index.html — app + routing + authority + write behavior + live caveat
│   ├── root docs and images
│   └── config
├── Runtime asset folders
├── Backend & data
├── Documentation
├── Test & automation entry points
├── Meta
└── Where does a new file go?
```

The structure is understandable, but row size and meaning vary. A path lookup
can return a mini-briefing rather than a locator.

### After — fast index plus normalized zone cards

```text
Repo map
├── Contract banner: router vs map vs briefing
├── 30-second index
│   ├── Runtime
│   ├── Backend/data
│   ├── Tests/assurance
│   ├── Operations
│   ├── Documentation/truth
│   └── Static assets/sister app
├── Zone cards (same six columns in every table)
│   └── Path | Kind | Stable purpose | Authority/owner | Change coupling | Next open
├── Generated detailed inventories
│   ├── package scripts
│   ├── workflow entry points
│   └── deep directory/file index
└── Placement decision table
```

Example row transformation:

| Shape | Path | Content |
|---|---|---|
| Before | `index.html` | A long cell combining application identity, routes, aliases, authority rules, write behavior, and current-state warnings. |
| After | `index.html` | **Kind:** runtime entry. **Purpose:** SyncView SPA shell and surface implementations. **Authority:** code. **Coupling:** production deploy. **Next:** `docs/truth/APP.md`; current authority and safety live in `BRIEFING.md`/`ROLLBACK.md`. |

The after-shape preserves the useful warning — merging can deploy — while
moving route and authority detail to the documents designed to own it.

## Ranked improvement register

Effort: **S** (days), **M** (a few weeks). Impact is retrieval and maintenance
leverage.

| Rank | Finding | Proposed move | Effort | Impact |
|---:|---|---|:---:|:---:|
| 1 | The map, router, and briefing do not declare mutually exclusive jobs. | Add the three-document contract banner and resolve duplicated facts in favor of the named owner. | S | High |
| 2 | There is no complete, compact first-screen index. | Add a 30-second zone index with anchors and one-line “open this when” descriptions. Put docs/truth and operations before served media for session retrieval. | S | High |
| 3 | Row granularity and columns vary by section. | Normalize zone tables to `Path`, `Kind`, `Stable purpose`, `Authority/owner`, `Change coupling`, and `Next open`. Use one row per artifact or cohesive tree. | M | High |
| 4 | Volatile rollout and safety narrative lives in a structural map. | Replace current-state prose with links to `BRIEFING.md`, `ROLLBACK.md`, truth docs, and the assurance ledger. Retain only durable coupling such as “merge deploys.” | S | High |
| 5 | Test commands mix stable discovery with detailed lane semantics already owned by testing docs and `package.json`. | Keep a compact command index; generate command names/descriptions from `package.json`; route gate semantics to `docs/testing/README.md`. | M | Medium |
| 6 | The CI guard proves coarse topology, not the quality of map entries or destinations. | Extend the guard to validate listed paths, unique ownership, required normalized columns, local `Next open` targets, and unlisted top-level/`docs/` zones. | M | High |
| 7 | Deep trees are summarized manually, forcing either omission or prose inflation. | Generate a collapsible machine inventory as a checked artifact or CI output; keep the authored map at zone/artifact level. Do not dump every file into the human front page. | M | Medium |
| 8 | “Where does a new file go?” covers common cases but is not a decision rule. | Convert it to a placement table: artifact type, destination, required companion updates, validation, and explicit anti-destinations. | S | Medium |
| 9 | Cross-repo destinations are prose-only and cost extra interpretation. | Use the vault’s canonical cross-repo citation form consistently and add repository-qualified links where stable. Let the cross-repo freshness guard validate them. | S | Medium |
| 10 | The map has no retrieval performance target of its own. | Add acceptance tests: known path in one open; unknown task routed in two; zone identified from the first screen; no duplicated current-state authority. Run a small human/AI query set before ratification. | S | Medium |

## Proposed information architecture

### 1. Header and contract

Keep the enforcement statement, then add:

> Need an answer? Start in `docs/FIND_ANYTHING.md`. Need current operational
> context? Start in `docs/truth/BRIEFING.md`. Need to locate or place an
> artifact? Use this map.

### 2. Thirty-second index

| Zone | Start here | Use it for |
|---|---|---|
| Runtime | `index.html` | Application entry and served surfaces |
| Backend/data | `supabase/`, `migrations/`, `n8n-backups/` | Owned APIs, schema provenance, workflow rollback anchors |
| Tests/assurance | `test/`, `qa/`, `docs/testing/` | Fast gates, human journeys, proof contracts |
| Operations | `scripts/`, `.github/`, `ROLLBACK.md`, `EXECUTION_LOG.md` | Scheduled work, deploys, recovery, history |
| Documentation/truth | `docs/truth/`, `docs/features/`, `docs/independence/`, `docs/vision/` | Current truth, contracts, programs, owner intent |
| Static/sister assets | runtime asset directories, `thumbnails/` | Served media and the separate tool |

### 3. Normalized zone cards

Use the same columns everywhere. “Authority/owner” names a document or code
boundary, not a person. “Change coupling” uses a small vocabulary:
`deploys`, `CI-only`, `manual apply`, `docs-only`, `served asset`, or
`archive/no runtime`.

### 4. Generated appendices

Machines should own exhaustive facts that already exist in machine-readable
sources. Candidate appendices:

- package command inventory from `package.json`;
- workflow and scheduled-script entry points from `.github/workflows/`;
- deep path inventory for search, omitted from the main reading flow.

Generated sections need clear markers and a CI check; authored explanation
must never be overwritten by a generator.

## Acceptance criteria for a future reshape

1. A reader can name all major repo zones without scrolling past the first
   index.
2. A known file or directory is locatable in one document open.
3. An unknown task is routed to its authoritative document in no more than two
   opens from `FIND_ANYTHING.md`.
4. Every authored map row has the same schema and one stable purpose.
5. No live flag, current authority assignment, incident conclusion, or rollout
   status is owned by the map.
6. Every local link and listed path is machine-checked.
7. The complete offline test suite passes.
8. A cold human and a cold AI session both complete the same representative
   lookup set; median opens and time do not regress.

## Ratification choices

The owner can approve the work in three bounded slices:

1. **Boundary pass:** contract banner, first-screen index, volatile-detail
   relocation.
2. **Schema pass:** normalized zone cards and placement decision table.
3. **Enforcement pass:** stronger map checks, generated appendices, retrieval
   acceptance test.

No slice requires renaming or moving runtime files. The existing map remains
authoritative until a ratified reshape lands in a separate implementation PR.
