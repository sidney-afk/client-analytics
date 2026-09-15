# Urgent notification links - preparation review

This is repository/captured-source verification, not proof of a deployed sender or a delivered Slack message. No messages were sent, and no n8n workflow was changed.

| Alert path | Existing link behavior | Evidence and limit |
| --- | --- | --- |
| Native editor urgent, including urgent actions from Calendar/Samples review queues | SQL message contains editor mention, title and “needs tweaks”; no URL | `migrations/2026-09-09-native-notification-outbox.sql`, urgent enqueue; `supabase/functions/notify/index.ts` previously forwarded this text verbatim. Missing website link is a preparation defect. |
| Reviewer urgent approval reminder | Website review tab, with fixed website-origin fallback | Captured `n8n-backups/send-urgent-kasper-slack.2026-09-10.published.json`, Parse & Validate. Captured source and read-only current published graph agree on website-only text; delivery not exercised. |
| Legacy editor urgent | Current published template includes BOTH a website production-card link and a separate Linear link | Read-only current n8n graph captured privately on 2026-09-14; active version equals draft. Template uses `SyncView: <website>` followed by `Linear: <issue>`. No message sent. The Linear URL is also used for assignee lookup; preserve that input while preparing removal of only the rendered Linear line. |
| Native status/comment notifications | Separate nonurgent templates; unchanged by this preparation | Same SQL owner and sender. This bounded change does not alter their text, recipients or triggers. |

The prepared sender change appends a fixed-origin website production-card link only to a validated, already-claimed urgent intent. It uses the stored deliverable ID and the application `_prodLinkFor` query shape (`prod=1`, `d`, `#production`), never a caller URL. An already-correct link is retained. Claim identity, sending state, attempt, channel and original message must match the read intent. Lookup failure records a known pre-send retryable outcome without contacting Slack.

The existing SQL owner grants service-role SELECT on notification intents. No SQL owner, trigger, recipient selection, Slack deduplication key or delivery receipt protocol changes. This adds a read before native urgent delivery; it does not remove the existing race between claim and external delivery. Edge deployment closure review is required before deployment. Legacy editor requires a separate text-only workflow preparation to remove its rendered Linear line, preserving its existing website link and Linear lookup input. No live workflow is edited. Read-only active-template verification is not a delivered-message test.

Private asset decisions are separate: `drive-fourteen-owner-decisions-20260914.private.md` and `.json` in the private review evidence directory. They contain nine deliverable references and five thumbnail references: seven with historical snapshot metadata, two with alternatives only, five with no verified rescue. No historical bytes or current-original equivalence were proven; no substitutions/deletions were performed.

Offline verification: native urgent actual-handler fixture passed link/duplicate/nonurgent cases and 11 refusal controls with zero external calls; existing health-handler and native notification source suites passed. `deno check` ratchet for notify reports zero errors.

`prepare-urgent-editor-website-only.js` prepares an exact one-line change against the captured editor code. Its unit fixture proves the existing website text, recipient node, graph and settings stay unchanged, and unexpected/duplicate/already-changed templates refuse. A private patch containing the original node hash and proposed node was generated from the current read-only capture. The immutable capture is unchanged. This is not automatically part of the website installation lane; native sender activation can supersede the legacy path without modifying the Linear account. No n8n write occurred.
