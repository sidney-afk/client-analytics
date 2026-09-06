# Native card creation compatibility boundary — 2026-09-06

Status: **G3 automatic creation remains held.** This is bounded evidence and a proposed implementation contract under the existing canonical G0–G10 plan, not a second execution plan. No writer, migration, workflow, flag or client data was changed.

## Decision and evidence

A creation-specific compatibility path is feasible without re-gating anonymous authentication. The retained native browser jobs already mark their HTTP requests differently from ordinary edits. **An Edge-Function-only repair is insufficient:** a fresh read of both published n8n fallback graphs proves they write directly to the card tables and discard that distinction.

Source citations below are pinned to `df0cc8db384ed7bb0ada84469a5103062a7611f0`. This document is prepared on later integration `d07d06d843c0a0b61d1d26b1eb2aec00d9dddf26`; line drift does not change the cited authority. Full AGENTS and its frozen writer directive were read; the two commits have identical AGENTS bytes.

| Actual entry or retained work | Pinned symbol / line in index.html | Compatibility consequence |
|---|---|---|
| Submit native intake | Submit context:47905; _runNativeIntakeJob:48160; _writeNativeSubmissionCardsToCalendar:47995 | Uses submission-native. Accepted result precedes separate card POST. |
| Calendar and Samples Create Post, new batch or append | Native dialog payload/context:41281–41297; shared materializer:48008–48054 | Uses calendar-native / samples-native. Samples has the same materializer, not another job owner. |
| Retained native job | _linearIntakeWrite:46919; recovery serialization:47016–47040; materializer fallback:48032 | Same persisted intent/result. Context-less Samples may use submission-native; endpoint and manifest must decide surface, not marker spelling alone. |
| Native identity | _linearIntakeItems:47155–47179; _linearIntakeValidateResult:47938–47991 | Deterministic p_native card IDs and exact video/graphics child IDs. Card POST omits intake request ID, original fingerprint and epoch. |
| Creation replay response | _writeNativeSubmissionCardsToCalendar:48055–48080 | Existing browser adopts returned post/sample over its initial row. A matched creation replay can return the actual current card while preserving human edits. |
| Calendar fill existing component | _calFillWriteCardLink:38102 | calendar-component-fill; only the selected slot and its provider URL. Keep outside full-card creation adapter. |
| Blank card promotion | _calMintId:28896; Calendar save:39553–39570; _sxrMintId:64683; Samples save:64984–65009 | p_ / sr_ identity, ordinary ui/default save. Keep unchanged. |
| Calendar spreadsheet import / provider import | _calRunImport:34485; _calRunLinearImport:33630; _calBulkUpsertPosts:34028 | Random p_ IDs, ui/default upsert. Provider import has its existing authority check. Neither establishes native acceptance. |
| Older provider submission card jobs | _writeLinearVideoCardsToCalendar:48325; id selection:48463–48465; POST:48489; CAL_CARD_JOBS_KEY:48535; resume:48579 | p_lin_ or random ID, no native child IDs, ui/default. Do not absorb into native manifest ownership. Current resume has its existing authority gate; old code remains a separate legacy risk. |
| Ordinary staff/client edits and queued saves | _calUpsertHeaders:25395; _sxrWriteHeaders:62449; Calendar save / Samples save; Kasper persistence:76726 / 69067 | ui/default, unlike native materialization. This protocol must not alter their auth, body projection or intended edit behavior. |

The historical `5765cfe80b7ca9844bab79a55fd75784bf9cb693` browser already has the same three native markers (context lines40928/46944; shared materializer47034; actual two POSTs47092/47093). This is evidence for that retained version, not every browser ever shipped.

The raw native card payload is an initial full row: blank content and In Progress statuses, exact returned child IDs and optional provider URLs. Its order_index depends on current browser cache or current time (48009–48012), so it is **not** a stable accepted-intent fingerprint. Do not replace existing request fingerprints with a whole-row hash or infer creation from blank field values.

## Published fallback graph read — no execution

[Machine-readable evidence](2026-09-06-native-card-compatibility-evidence.json) records the exact versions and MCP-returned graph hashes. Observed 2026-09-06 01:40:22Z: both workflows active, both published graphs explicitly sameAsDraft, 17 reachable nodes each.

| Endpoint | Published version | Actual reachable write path |
|---|---|---|
| calendar-upsert-post | 7ef44971-5c6b-46d7-b7d1-68a504913d28 | Webhook ordinal1 → Build Row ordinal2 → reads13/14 → guard3/8 → branch4. Sheet write5 runs alongside database branch9/10. Existing row:15→comment helper16→strip17→direct calendar_posts update11. Missing row: direct calendar_posts create12. |
| sample-review-upsert | b139f56e-e6ea-474f-bf3a-87ac80e88d91 | Webhook1→Build Row2→read3→guard4/5→prepare7/8→branch9. Existing:10→comment RPC11→strip12→direct sample_reviews update13. Missing: direct create14. Response and event paths follow. |

Both Build Row nodes read the webhook **body**, whitelist fields and mint a fresh updated_at. Their whitelists omit video_deliverable_id and graphic_deliverable_id. Neither graph reads x-syncview-source or calls either frozen upsert EF. The Calendar helper was not traversed: direct scalar writes and the separate create branch already prove the bypass. The connector graph is sanitized source, not a raw export or execution result.

Browser wrappers trigger routing initialization **without awaiting it** (_calUpsertFetch:27353; _sxrUpsertFetch:62455). Empty or failed flag reads select n8n (_calFetchUpsertFlagOnce:25134–25145; Samples:62401–62412). A healthy observed cohort cannot prove this path unreachable.

Captured frozen Calendar v48 / Samples v49 source (prior private capture; no fresh serving fetch here) reads the raw header in actorFrom, then normalizes all three native markers to ui. Its Supabase client does not propagate that raw header. Existing writes split comment RPC and scalar update. Thus a SQL trigger cannot recover the erased operation purpose, and a late initial-row job is indistinguishable there from a human edit with the same values. **Current EF serving equality is not newly proven in this pass.**

## Finite proposed amendment for coordinator review

1. **One service-only materialization RPC and durable receipt owner.** Resolve exact client, endpoint surface and deterministic card ID against one immutable intake manifest; validate the complete expected VIDEO/GRAPHICS children, batch, roles, original native epochs and existing receipt fingerprints. No title-based ownership, selected-child union, newly invented epoch, or acceptance from a caller-supplied source/actor string. Provider-era, conflicting and pre-manifest cases do not create cards.

2. **Create or read back atomically, with retained provenance.** Under a per-card admission lock then card-first/children lock order compatible with the crosswalk binder, recheck F27 holds/generations, complete expected cardinality and reciprocal bindings. A never-created card may be inserted only with original accepted fields plus safe presentation ordering, in the same transaction as its immutable creation receipt/provenance. A prior matched creation returns its current row. Archive/deletion provenance forbids automatic recreation; absent trustworthy lifetime provenance stays held. Two concurrent attempts, a gateway retry, binder activity and journal/provenance failure must not leave half a card or a falsely complete receipt.

3. **Two HTTP boundaries, one meaning.** A narrow branch in each exact frozen EF, **before actor-source normalization, guards or any card/comment/thumbnail side effects**, recognizes only the documented native markers, preserves the raw body and calls that RPC. The proposed n8n counterpart branches immediately after each webhook and **before Build Row**, forwarding only marked native creation attempts to the same contract. Its response is terminal for that branch: no old comment RPC, scalar write, Sheets write or event branch runs afterward. Missing, malformed or failed adapter responses stay errors/held work, never fallback success. All unmarked/ui/linear/reconcile/fill/import traffic retains its existing graph and anonymous auth.

4. **Do not acknowledge a discarded human change.** Exact native projection validation precedes a replay: changed body/title/linkage/target is a conflict, not a 200 that drops it. The header selects a protocol; it is neither authentication nor proof of acceptance. Mutable order_index is excluded from immutable intent identity and cannot reorder an already-created card. A valid replay returns the actual current row, not the first creation snapshot. A ui request with the same visible values remains an ordinary edit. Current/old browser reaction to archived/deleted terminal outcomes needs explicit preservation tests before enabling creation.

5. **Preserve unknown ingress before refusing it.** _linearIntakeDiscardTerminallyRefused:48221–48276 deletes a recovery-only copy after four qualifying failures; an HTTP/network refusal alone is not durable conservation. A service-only append-only ingress/quarantine record must durably retain the exact received creation body, endpoint scope, claimed marker, content hash, received timestamp and outcome before a bounded unknown/pre-manifest refusal. Claimed headers are explicitly unverified; accepted actor/epoch comes only from a matched manifest. No background adoption based merely on partial children. A compact card body cannot reconstruct an original submission's missing media/batch intent: pre-manifest full-intent recovery must use an actual authenticated receipt/request log or coordinated private browser export. If no server boundary received the job before browser expiry, the server cannot promise to preserve it. This remains a migration/continuity gate, not grounds to loosen auth or silently accept unknown work.

6. **Receipt and ingress storage are new durable authorities.** Design one explicitly named owner (e.g. production_card_materialization_receipts for matched outcomes and production_card_materialization_ingress for held raw attempts), immutable records, no cascading loss, honest attribution, private service-only access, bounded abuse handling and retention at least the history contract. Existing production_card_provenance remains lifecycle evidence, not guessed acceptance. Include all new schema, grants, triggers, functions and data in a new explicit recovery corpus/schema artifact; do not silently redefine history-v6's35-table promise. No auto-prune. Rollback preserves these records and created cards.

This is permission to **design** that contract, not approval to install it. No native card RPC, ledger or ingress route has been implemented or installed by this pass.

## Owner action, staged order and abort gates

The narrow n8n amendment still requires **explicit same-request owner approval** under the owner's task constraints; this requirement does not come from the frozen-auth paragraph in AGENTS. Prepare it against a fresh private raw export and verified published version of only these two workflows; preserve unrelated nodes/fields and active state. First implement and independently prove SQL/EF adapters in disposable fixtures, then obtain the reviewed workflow amendment and owner approval, then stage deployment/readback in the canonical plan's ordered release. Do not enable server automatic creation while either old transport still bypasses the identity protocol. Anonymous clients continue their existing view/approve/comment/tweak flows during preparation and additive deployment; prove their exact old route remains byte/behavior compatible, not merely that an auth guard was omitted.

Required finite tests before approval:
- Actual retained Calendar/Samples native-job payloads: first accepted create, lost response, retry after rename/status/note/media/reorder, identical human rename-back via ui, archived and deleted card; exact current-row replay, no silent lost edit or resurrection.
- Changed client/card/child/team/body/actor claim; mixed or missing expected children; F27 hold/epoch drift; concurrent gateway/materializer/binder; injected journal/provenance/receipt failure all remain atomic and visible.
- Same native job through healthy EF, cold routing and failed-flag n8n route; native branch reaches one RPC and no Sheets/scalar/event tail. Ordinary anonymous approval/comment/tweak and unmarked staff/import/fill traffic preserve prior behavior.
- Four background failures then browser copy removal: held ingress and any available original accepted manifest remain recoverable; full-intent absence stays explicitly unresolved. Ingress persistence failure never returns an acknowledgement claiming durable receipt.
- Actual protocol receipts, ingress, tombstones and human-edited cards survive trigger-aware restore with external egress disabled. Prove normal client failure continuity and alert delivery separately.

Abort on version drift, any branch still reaching old full-row writers, failed ingress conservation, ambiguous identity, unexpected provider/Sheets egress, anonymous client regression or incomplete recovery corpus. Stop only progression to automatic creation; do not freeze clients.

Rollback must be tested before enabling: restoring either old n8n version while automatic-created cards exist reopens the original overwrite hazard. First stop new automatic creation while preserving client writes and durable debt, **retain the compatible native branch/receipt reader**, and use a forward-compatible inverse that preserves this protection. The original version is a forensic restore point, not automatically a safe operational inverse. EF auth stays frozen; receipt/provenance/ingress data is never dropped as rollback.
