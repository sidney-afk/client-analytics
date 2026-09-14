# What this installation changes

This is the owner's before/after guide, not authorization to install.

Today, parts of the website still use Linear to keep work items, comments and follow-up actions in sync. The preparation adds the website's own save records and background work queue, so those actions can eventually work independently. Approve, comment and urgent buttons should keep their familiar behavior: save the right information, preserve normal expected alerts and add no surprise messages.

Before installation, the current website, backend and Linear connections keep working under their existing settings. The verified database recovery copy protects the public database; external file custody is tracked separately.

After the separately approved dormant release:

| Piece | What changes | What stays as it is |
|---|---|---|
| Database | Adds reviewed save, receipt, recovery, diagnostics and retirement machinery | Existing data and current authority are preserved; installing a retirement function does not call it |
| Website | Merging publishes the reviewed browser through Pages | Existing links and access remain; this is a live browser release, not a hidden database-only step |
| Backend functions | The chosen deployment replaces only its named functions, with source fingerprints checked | No implied deployment of the separate Calendar/Samples composer, follow-up worker or diagnostics function |
| New notification sender / gateway wake | Remain dormant until separately accepted | No new sender tests/messages during preparation or dormant release; existing expected alerts are preserved |
| New follow-up supervisor | Remains stopped until its worker and independent observer are accepted | No new background schedule is installed |
| New reconcile apply / census schedules | Remain dormant; manual operations need separate approval | Do not reset already-active legacy flags |
| Retirement / native reopen | Remain uncalled | Linear workers, inbound/outbound connections and authority stay in their recorded pre-install state |

The owner scope is website-side independence only. Do not retire Linear, cancel it, stop its unrelated workflows or disconnect its integrations on installation day or as an assumed later step. Website-side native capabilities require their own approved acceptance; this does not require retiring Linear itself. Unavailable assets remain explicitly tracked.

The existing manual Edge release requires the selected commit already on main. Therefore “deploy that lane before merging” is not available. The proposed order is SQL preparation, authorized merge (which also publishes Pages and can deploy eight staff functions), then the pinned manual Edge release. The interval between browser publication and the manual release must be explicitly accepted or a different release mechanism separately reviewed. Nothing in this guide approves that interval.

See [installation-day steps](LINEAR_EXIT_INSTALLATION_DAY_20260914.md), [canonical release separation](LINEAR_EXIT_RELEASE_MATRIX_20260912.md).

## Exact new controls

| Control | Dormant | After separate acceptance |
|---|---|---|
| NOTIFY_WAKE_ENABLED | Gateway leaves durable notification intents pending without waking sender | Gateway requests one post-commit send; send failures do not change saved-write success |
| notify endpoint / runner configuration | No new scheduled/manual calls | Approved runner can claim/send configured notifications; preserve existing normal alerts |
| LINEAR_EXIT_SUPERVISOR_ENABLED plus --run | No new follow-up loop | Private follow-up tasks are processed; independent observer still required |
| client-signoff dry_run | Report only | Explicit dry_run=false permits verified reconciliation writes |
| OUTBOX_DEBT_CENSUS_ENABLED | Automatic census skipped, host heartbeat retained | Automatic debt census and its existing alerts run |
| SYNCVIEW_RETIREMENT_CENSUS_ENABLED | Automatic census skipped | Do not enable for this website-only scope |

Website-side connections must be accepted individually: saves and comments to the native write gateway, reads to native comment/archive readers, approved native notifications instead of website reliance on a provider relay, and follow-up effects to the private worker. Deploying SQL alone disconnects none of these. The existing Edge lane does not include the separate Calendar/Samples atomic bundle or follow-up endpoint; their deployment is not inferred from a 13-function receipt. Preserve currently active intake/assignment/label and Linear flags until an exact website-side transition is approved.
