# SyncView glossary

Plain-English meanings for the terms used in this repository. For what is active **today**, read [State of things](STATE_OF_THINGS.md); dated plans can describe an earlier system. [Find anything](FIND_ANYTHING.md) points to the detailed owner of each topic.

## Plans and names

| Term | Meaning |
| --- | --- |
| **SyncView** | The web app where the team now plans, reviews, and manages production work. |
| **SyncLinear / Production** | The staff work screen. “SyncLinear” is a retained name from when it mirrored Linear; the app calls the screen `production` internally. |
| **Submit** | The app's intake form; its internal route is still called `linear` for compatibility. |
| **Calendar** | The content-planning screen and its posts. |
| **Samples / SXR** | The sample-review area and its client review flow. |
| **Workload** | The screen for planning work and deadlines across the production team. |
| **SMM** | Social media manager, the staff role that plans and coordinates client content. |
| **PTO** | Paid time off; the app has a separate staff request and approval tracker. |
| **Track A** | The earlier project that moved selected interactive saves from n8n webhooks into server functions. |
| **Track B** | The project that built SyncView's own production records and work screens so the team could leave Linear. Linear is now retired as a work surface. |
| **B5** | The final Linear-exit cleanup and acceptance stage named in older Track B plans; check current state before following a B5 instruction. |
| **C3** | A planned modularization step: turn the app's always-loaded shared code into JavaScript modules with explicit boundaries. It is a plan, not a live switch. |
| **F27** | The protected release and recovery system for the core production write functions. Its manual lane checks the exact reviewed source and a captured prior version. |
| **F42** | The historical card and comment import effort; remaining import instructions are guarded, manual operations. |
| **Step 7** | The old Linear-exit name for credential revocation. The [current state](STATE_OF_THINGS.md) records it as done. |
| **F-number / D-number** | An `F` number identifies a finding or repair; a `D` number identifies an owner decision. The [router](FIND_ANYTHING.md) says where each register lives. |
| **OQ / KQ** | Question numbers in the company Atlas for decisions or facts a person still needs to answer. |
| **OPEN_REPAIRS** | The numbered record of known defects and their evidence; an entry can describe work that is already complete, so compare it with current state. |

## How work moves

| Term | Meaning |
| --- | --- |
| **Source of truth** | The place whose value wins when two copies disagree. Which place wins can differ by screen and field. |
| **Authority** | The system or role allowed to decide and save a particular change. A screen being visible does not grant write authority. |
| **Native** | Data or work handled by SyncView's own database and server paths instead of the former Linear work path. |
| **Mirror** | A copy kept in step with another source. It can look full even when updates have stopped, so freshness needs proof. |
| **Crosswalk** | A stored link between records that represent the same work in different parts of the system. |
| **Reconciler** | A repeated job that compares records and identifies or repairs differences. A green run needs a complete read to prove completeness. |
| **Outbox** | A durable queue of work or delivery attempts that may need retry or reconciliation. |
| **Receipt** | A saved record that an operation was accepted, refused, or completed; it supports safe retry and audit. |
| **CAS (compare and swap)** | A save that succeeds only if the record still has the version the editor read, preventing a late save from overwriting someone else's work. |
| **Fence** | A guard that stops old or delayed work from crossing a cutover or ownership boundary. |
| **Parity** | Measured agreement between old and new records or behavior for the same defined cases. A matching count alone is not enough. |
| **Cutover / flip** | The deliberate point when a new path becomes the live path. A “team flip” changed which system held that team's production authority. |
| **Fallback** | A second path used when the preferred path cannot finish; its own safety and current availability must be checked. |
| **Runtime flag / feature flag** | A stored switch that can enable, disable, or route behavior without changing the web page code. |
| **Dark lane** | Code that exists but is deliberately kept off by a flag or allowlist until its release checks pass. |
| **Gateway** | A server endpoint that checks a request and decides whether to perform a write. |
| **Webhook** | An HTTP address one system calls to ask another system to do work. |

## Checks and evidence

| Term | Meaning |
| --- | --- |
| **Gate** | A required check or decision before a later action can proceed. A passing gate proves only what it actually checked. |
| **Lane** | One named path through a workflow, test, or release, with its own inputs and result. |
| **Offline test** | A test using invented data and mocked network responses, with no route to the live service. |
| **QA** | Quality assurance: the checks and human review used to find defects before or after a release. |
| **Disposable database test** | A test against a temporary database that can be thrown away after the check. |
| **Live read** | A read from the real running system. It observes current state but does not itself prove a write works. |
| **Source-only finding** | A conclusion from reading code or documents; it does not claim a browser or live-system reproduction. |
| **Dry run** | A preview of what an operation would do, without applying the proposed change. Check that a particular tool truly honors this mode. |
| **Canary / TEST drill** | A deliberately limited trial on the designated test scope before wider use. It is not evidence that every real client works. |
| **Assurance ledger** | The record of which user journeys have recent positive proof, and when that proof expires. |
| **Quality tier** | The promised level of reliability and response for a part of the app, from Tier 0 client essentials to Tier 3 internal documentation and tools. |
| **CI** | Automatic checks run when a branch or pull request changes; a green result covers only the jobs that ran. |
| **Boot** | What the page does while opening and deciding which screen and data to show. |
| **Fingerprint** | A calculated digest of exact source bytes used to compare reviewed code with a release or backup. |
| **Attestation** | An explicit record that the required person or process approved a particular action and its exact inputs. |

## Releases and the tools behind them

| Term | Meaning |
| --- | --- |
| **Branch / pull request (PR)** | A separate proposed set of changes and its review page. It does not change the deployed app by itself. |
| **Draft PR** | A PR open for review while further checks or decisions remain. |
| **Main** | The repository branch from which GitHub Pages publishes the current web page. Merging page code there makes it live. |
| **Commit SHA** | The unique identifier for one exact saved version of the repository. |
| **Build output / fragment** | The served `index.html` is generated from smaller `src/index/` source parts; the parts are the files to edit. |
| **Rollback** | A prepared return to the previous working behavior after a release goes wrong. Restoring code may not restore changed data. |
| **Sealed bundle** | A captured, checked copy of the prior server-function source used for an exact recovery. |
| **GitHub Pages** | The service that publishes this repository's web page from `main`. |
| **Supabase / Postgres** | The service and database that store SyncView's records and run its database rules. |
| **Edge Function** | Server-side code that receives an app request and can validate, read, or save data. |
| **Migration** | A versioned database change file. Having the file in the repo does not mean it has been applied to the live database. |
| **RLS (row-level security)** | Database rules that decide which rows a caller can see or change after that caller has access to the table. |
| **Publishable key** | A key intended for browser use; it identifies the project but does not by itself authorize privileged data access. |
| **Service-role key** | A powerful server secret that bypasses ordinary row restrictions. It must stay out of browser code and public artifacts. |
| **Client review token** | The secret in a client's review link that binds the visit to the intended review access. |
| **n8n** | The workflow service used for automations and some older app paths. |
| **Linear** | The former work tracker. Historical documents still mention its projects, issues, and sync jobs. |

For detailed current contracts, use [the truth-doc index](truth/README.md), [the testing map](testing/README.md), [the quality tiers](QUALITY_TIERS.md), and [the C3 plan](plans/2026-09-24-modularization-c3-plan.md).
