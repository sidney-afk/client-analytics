# Frozen anonymous writer composition feasibility

**SOURCE_ONLY; private staged composition produced, not deployed.** Toolkit
rebased onto `d12d761d309cc0bc98bbefb597afa3c62516b54e`; the 38 modeled controls
passed again after rebase. Original candidate
`b60a9705492002830eed60ece874e0686fc4b538` has the same two handler/shared adapter
bytes as `d1442f65c4da6dc4e5ef8f155e1465f564cafa5e`. This bounded preparation
does not replace repository writer files, captured source, credentials, flags,
SQL, n8n graphs, browser callers or JWT settings. No live/TEST writes occurred.

## Exact composition

The captured Calendar v48 and Samples v49 each contain their entrypoint and
`_shared/thumbnail-revisions.ts`, with `verify_jwt=false`. Their dated closure
hashes are in [September 6 readback](2026-09-06-linear-exit-live-boundary.json).
These captures were read locally; serving was not refreshed today.

Directly deploying candidate repository handlers is incompatible: both call
`authorizeBrowserWrite` before ordinary/native work and return 401 to an
existing tokenless caller. They also normalize client names and replace the
captured `actorFrom`/event attribution. Merely deleting one authentication call
would therefore fail to preserve the exact serving contract.

`scripts/frozen-native-writer-composition.js` reads exact pinned private
captures and emits a new separate private staging directory. Five reversible
additions per captured entrypoint import the shared adapter, read exact marked
native requests, take the terminal materialization branch after `buildIncoming`,
return explicit native unknown/unretained failures, and suppress private native
request fields in native logs. Inverting these exact additions reproduces every
captured byte. `actorFrom`, `clean(body.client)`, semantic event roles, guards,
ordinary parser, comment merge/scalar writer, thumbnail/event tails and CORS
remain unchanged. The repository writer files remain byte-identical to b60.

| File / symbols | Required source and role |
|---|---|
| `calendar-upsert/index.ts`: `Deno.serve`, `buildIncoming`, unchanged `actorFrom` | Captured v48 plus five native seams; terminal calendar RPC branch before `readExisting`, `writeCalendarRow`, comment/event/thumbnail effects. |
| `sample-review-upsert/index.ts`: same handler seams and unchanged `actorFrom` | Captured v49 plus five native seams; terminal samples RPC branch before `readExisting`, `writeSampleRow`, comment/event/thumbnail effects. |
| `_shared/native-card-materialization.mjs`: `nativeCardSource`, `readNativeCardRequest`, `materializeNativeCard`, `nativeCardUnretained`, `nativeCardUnknown` | Exact existing candidate helper; raw UTF-8/size bound, one RPC, full current-row validation, honest held/unknown outcomes, no fallback. |
| `_shared/thumbnail-revisions.ts` | Exact captured helper, already equal to candidate. No auth helper is added. |
| `production_card_materialize(p_surface,p_source,p_raw_body)` | Existing service-only SQL in `2026-09-06-native-card-materialization-boundary.sql`, unchanged. The source marker chooses protocol; it does not create a principal, native intake, receipt or accepted child. |

The RPC requires one exact accepted `production_intake_manifests` owner,
current `batches`/`deliverables`, original parent/child `mirror_outbox` receipts,
matching native epochs and complete expected children, current lifecycle/
`production_card_provenance`, F27 admission/fences/rollback state and exact
creation payload. Fresh creation also requires its existing dormant
`native_card_materialization` admission/coverage contract. Stored actor
provenance comes from accepted manifests/receipts, never caller headers.
An absent manifest stays held even with a forged native marker/actor/role.
This is accepted-work materialization compatibility under the frozen endpoint,
not a new anonymous intake authority or verified caller identity.

## Pinned source and reproducibility

| Artifact | SHA-256 |
|---|---|
| Captured Calendar entry v48 | `414976024b7651afd03ddd9bc6b18eba3b97951fa3ed6bc98c05c0fc3256e389` |
| Captured Samples entry v49 | `d95eb9760a77305397ad045556cd160b2b12f125b23b1ca92f97acfa225b71c6` |
| Staged Calendar entry | `9a7ce69b6df75e67de9c9e5fc099ac5e4dace2128f6b2fda905befddf838e292` |
| Staged Samples entry | `57b2d02ecd9593b98cc1238cea7daf75b2a923ac8e47464df4a96cfa90585b96` |
| Unchanged thumbnail helper | `8e8478cb8812688656fb5dee5fe022dd32090722da9db78f12556459de81cb51` |
| Existing native adapter | `7f3185bba428d18d4f773a9014dffd3bdff49873354b55391f8d72f27a98de74` |

The builder requires absolute `FROZEN_WRITER_CAPTURE_ROOT` pointing to private
`<slug>/functions/<slug>/index.ts` closures and a new
`FROZEN_WRITER_OUTPUT` outside this repository. It rejects changed inputs,
changed adapter/helper bytes, existing output and in-repository output. Run
`node scripts/frozen-native-writer-composition.js` to prepare only; it emits a
private four-file source tree and hash receipt, with no deployment command.
Each individual writer closure consists of its entrypoint plus both shared
helpers. Preserve captured input and output separately.

With the same explicit private capture binding,
`node test/frozen-native-writer-composition.js` passed **38 actual complete
handler/model-boundary checks**, zero external requests. Dated and composed
handlers produce identical responses and SDK effects for anonymous rename,
client approval, tweak/note and Kasper approval; failed reads still prevent
writes. Native exact raw text reaches only the materialization RPC. Forged
marker/actor with a missing-manifest reply stays held; unavailable/malformed/
lost replies stay unknown; created/replayed receipts return the complete
current row without legacy writes. Both exact repository handlers demonstrate
the 401 tokenless counterexample. Inputs changed by one byte and unsafe output
choices refuse. Without private captures the test reports an explicit handler
SKIP after its input-pin negative; CI does not acquire private source.

SDK/RPC outcomes in those 38 controls are modeled. The earlier HTTP/SQL
lane includes dated derived-source controls in
`scripts/native-card-materialization/http-edge.mjs` and `http-lane.mjs`; its
historical 42-group result is separate. That earlier three-seam graft is not
this five-seam staged release artifact. Do not transfer its SQL certificate
to this exact composition without rerunning against these pinned bytes.

### September 7 exact staged HTTP/SQL subset

One bounded run against the existing owned disposable loopback PostgreSQL
fixture passed **42 total groups, 64 loopback requests, zero external attempts**.
The fixture was initially stopped; this run started and stopped it successfully
and retained its synthetic database/private evidence. No live system was used.

Four groups directly exercised these exact staged anonymous handlers: each
surface's paired capture/staged edit-and-native-replay group, plus each staged
surface's ordinary approval/note/tweak group. The paired group reproduces the
old captured native overwrite, then proves that the staged handler returns the
current edited row without changing SQL facts. The broader create/refusal/
ownership matrix in the same 42-group lane still targets repository-auth
handlers. **42 is not a count of exact staged-only groups.** Current serving,
complete staged negative/lifecycle/unknown-outcome matrices and release remain
held; do not promote the broader lane's evidence to those uncovered routes.

The narrow test-tool changes in `http-edge.mjs` and `http-lane.mjs` accept an
optional `staged: {path, sha256}` beside each private dated-capture config entry.
They hash-check the absolute staged entry and load its own shared files without
applying the earlier derived graft. The runner verified all four staged files
against `COMPOSITION.private.json` before and after the run. Every loaded file
and proof source was also pinned and checked stable during the lane. The private
report labels both staged routes `EXACT_STAGED_FROZEN_COMPOSITION` with identical
original/loaded entry hashes matching the table above; historical test names
containing "derived" are unchanged and do not identify a different source here.

Private report SHA-256:
`829919dbcadd0307f4abaa6fc3c8db800705588cef45c08e87ad8789a4ef8b58`.
Test-tool source hashes: `http-edge.mjs`
`78b219b642bbff8559f6f4e6f2bd7c2b1fb1697828956c0cca65a33aa3252207`;
`http-lane.mjs`
`3d7b0dad517f8e494e39d40d1c6663e0999ca23577beef4e43f6f5e265e80cff`.
This establishes a concrete exact-source rehearsal path and the four bounded
staged groups. No full37 restore or broad suite was repeated.

## Remaining release and recovery work

1. Independently review this exact composition and extend its direct staged
   HTTP/SQL subset to untrusted/missing manifests, changed ownership,
   lifecycle holds and unknown responses. The four direct staged groups above
   close ordinary anonymous effects and accepted current-row replay only;
   the model-boundary and repository-auth negatives keep their distinct scope.
2. Preserve compatible authenticated schema/data custody for both materialization
   owners, original manifests/receipts, provenance/journal, card rows and all
   existing F27 dependencies under the current selected37 recovery contract.
   Installation order and current schema/catalog verification remain the
   owning G0-G10 release packet; this four-file list is not a migration order.
3. Verify both old n8n entrypoints' exact raw-body forwarding and terminal
   status/body return before any legacy write tail. Sanitized graph descriptions
   and reserialized JSON are insufficient. Nothing here edits those graphs.
4. Read back current serving source/JWT immediately before an approved release.
   Drift from the pinned captures stops composition; do not blindly graft or
   overwrite newer source. Keep the existing tokenless rules and
   `verify_jwt=false`; run designated anonymous client/staff canaries only after
   separate exact release approval. Header absence must not introduce a 401.
5. Withdrawal now changes no live behavior. After accepted native work exists,
   do not restore an old full-row handler that can replay original creation over
   current edits. Hold new admission while preserving this terminal compatible
   reader/receipt behavior and recover forward under the owning materialization
   contract. Do not regate review links, clear receipts or reverse authority.

Anonymous abuse accounting, current serving equality, real client journeys,
legacy n8n coverage and global provider independence remain unproven. The
staged composition closes one concrete source-feasibility gap, not G3/G6.
