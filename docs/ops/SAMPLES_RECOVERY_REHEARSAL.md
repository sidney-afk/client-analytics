# Samples reader recovery rehearsal

Status: preparatory, local synthetic evidence only; not a deployment authorization.
This is a bounded compatibility inverse for reviewed Samples PR #1269, not a
whole-source revert. The reviewed PR head stays unchanged and draft. Monitoring
integration, client continuity, owner approval and live release proof remain gates.

## Pinned source and drift

- Reviewed candidate: `a3f86c96e99b0d1ff3e93d6ac9f8e2ee496f8ca5`.
- Coordinator-pinned baseline: `a4925097aad2be1d8b4710e56da1220a19c850c5`.
- Remote main moved to `27889a8dc3ecb0935d3771a5b733680a7397d9fc` during preparation.
  The baseline was not silently advanced. No new migration audit was performed.
- Immutable combined assembly, source compatibility checked only:
  `37c1c453bbd3b4e590606a2a3332e505b2414bd2`.
  Its checkout was read, never edited. No combined browser replay is claimed.

The actual baseline document reproduces failed-primary plus HTTP-500 fallback
as successful empty data. A second real-browser negative control shows it cannot
display the candidate's owned recovery records; returning forward restores them.
These failures prohibit using that whole document as the inverse. A source tree
revert alone is not a local-work recovery procedure.

## Concrete artifact

`scripts/samples-recovery-build.js` reads pinned Git objects and writes new
`forward.html`, `recovery.html`, `recovery.patch`, and `manifest.json` files in an explicit output
directory. Existing output files cause failure; it never overwrites `index.html`,
pushes, merges or deploys. The generated HTML stays private/untracked.

The sole substituted function is `_sxrFetchPosts`. It stops invoking the new
count-aware primary reader and uses the baseline paginator already present in
the candidate. This paginator is checked byte-for-byte against the pinned
baseline. Every result is scoped and shape-validated, nonempty and explicitly
non-authoritative. Existing strict fallback HTTP, envelope, error and shape
checks remain. Empty/failed reads cannot certify emptiness.

The loader, ownership and per-field acknowledgement records, cache protection,
save engine, privacy cleanup and retry affordances remain present. All other
HTML bytes are unchanged. This deliberately retains the compatibility code
needed to consume unfinished work. It does not stop or change existing writer
routes, authentication, permissions, approvals, comments or either team's native
authority. The frozen anonymous-client writer contract remains untouched.

| Phase | Visible behavior | Code and data boundary |
|---|---|---|
| Forward | Complete primary reads can refresh the board and verified cache, including genuine emptiness. Local debt remains visible. | Reviewed candidate code. |
| Recovery | Useful prior content and cache remain. Available cold-open content has the existing outdated/incomplete notice and Retry. Empty/failed cold reads show a retryable error. | Baseline primary pagination; every read remains unverified. No removals or verified-cache replacement on that authority. Existing explicit saves still work. |
| Forward restored | A complete primary read can clear the read warning and refresh verified content. Unacknowledged edits still require their own matching receipt. | Restore the exact paired forward bytes, not arbitrary current main. |

Routine verified-cache paint may initially be fresh; after a recovery read the
warning remains. Successful writer acknowledgement does not certify board
completeness. The inverse retains the old paginator's missing completeness
proof; it cannot demonstrate authoritative emptiness during recovery. It is a
temporary operating state, not an equivalent permanent reader.

## Reproduce locally

Use Node and the repository's pinned Playwright/Chromium dependencies. The two
Git objects above must be available locally (fetch those exact SHAs if absent).
Run from the isolated artifact branch. These commands never write to a backend:

```sh
node scripts/samples-recovery-build.js .codex-tmp/recovery
node test/samples-recovery-build.js
node qa/boot/samples-recovery-rehearsal.js
```

The independent-review correction can be run alone with
`node qa/boot/samples-recovery-rehearsal.js --same-client-actor`. Its report labels
the targeted scope explicitly; it does not claim the full rehearsal ran.

For a separately reviewed exact combined checkout, the optional arguments are
its local path and full target SHA. This produces a scoped inverse of that
target, not an older whole document:

```sh
node scripts/samples-recovery-build.js .codex-tmp/recovery-combined EXACT_LOCAL_CHECKOUT 37c1c453bbd3b4e590606a2a3332e505b2414bd2
```

The script refuses paginator, reader, local-work schema/ownership, loader,
input/save or cache drift. Its inverse round trip proves that replacing the
single changed function with its original returns every target HTML byte.
The isolated patch apply/reverse proof explicitly sets Git `core.autocrlf=false`
and `core.eol=lf`; inherited Windows line-ending conversion otherwise changes the
whole document. The builder writes the paired HTML files as exact bytes and is
the artifact source of truth, rather than a checkout with local text conversion.

## Executable proof and limits

The browser test loads the complete pinned HTML documents at a loopback origin.
Each transition changes the query to force a new document; served HTML digests
are recorded. Real application functions handle typing, blur, debounce,
promotion, save, reload, client changes, identity changes and receipt settlement.
Only transport/storage observation belongs to the fixture; app functions are
not replaced with success stubs. External requests are intercepted, unknown
requests aborted and asserted absent, WebSockets closed, and remote DNS refused.
All identities, keys, links and content in the fixture are fictional.

Coverage: untouched blank; typed-before-debounce; held create/update;
failed create; accepted-but-error-response create; positively acknowledged
create with newer name/direction debt and an independently changed asset;
refresh; different client and different actor; same-client actor replacement
(server-only view, no private-debt Retry/claim/replay, exact original-actor restoration);
late success/failure from a save
started in recovery; stored unowned legacy archive; verified/nonempty/empty/
failed reads; and the two real baseline negative controls.

The test observes storage without changing application values. It compares the
last actual old-document storage mutation to new-document entry, then demands
byte-for-byte conservation after recovery boot, refresh and forward restoration.
A `pagehide` event snapshot alone is insufficient: its real asynchronous save
can legitimately checkpoint again before document destruction. Stable IDs,
owner, field revisions, `isNew` and remaining edit values are retained; a positive
matching acknowledgement is the only tested release of owned debt. The legacy
unassigned archive is never claimed, replayed or removed. Another client or actor
cannot see/replay the work. Explicit retry after a positive create ack carries
only the owed fields and preserves the peer's untouched asset.

The synthetic receiver keys rows by stable ID and records logical creates.
Repeated requests after unknown acceptance update that same synthetic row once;
this proves outgoing ID continuity and fixture behavior, **not live server
idempotence or a live receipt**. Browser crash before a successful local storage
checkpoint, storage quota/unavailability, simultaneous tab conflicts, BFCache,
different browsers, live anonymous-client journeys, deployment/cache propagation
and live monitoring delivery are not proven by this rehearsal. Existing separate
candidate evidence is not silently relabelled as recovery evidence.

## Operating constraints, aborts and restoration

1. The coordinator must approve the exact target/recovery digest pair and its
   held release gates before any production operation. This package executes none.
2. Keep the owning tab/session open until its local-work storage checkpoint is
   verified. If storage reports failure or cannot be read back, stop transition;
   retain the tab and recover the private content before proceeding. Never clear
   browser storage, uninstall the profile or copy a different actor's records.
3. Preserve the same origin/profile and all owned work, legacy archive, cache and
   existing writer-repair keys. Do not bulk-replay or convert unowned legacy data.
   Unknown server acceptance is not a save success; establish a scoped receipt
   before considering any alternative to the existing stable-ID retry.
4. Abort on any source/hash drift, missing storage record, changed owned bytes
   without its legitimate matching acknowledgement, foreign-owner display/write,
   incomplete read clearing its warning, unexpected network escape, or duplicate
   logical creation. Keep both artifacts and private receipts for investigation.
5. Return by restoring the exact paired `forward.html` through a separately
   authorized release, preserving storage. Verify complete scoped read receipts
   and remaining local debt independently. Never substitute new main blindly.

## Artifact SHA-256 receipts

| Document | SHA-256 |
|---|---|
| Pinned baseline HTML | `0fc2e652bcb03916a04c45ed8c3c40bb67940142214badacf7f898cecab89f5e` |
| Candidate forward HTML | `8d91a1f00144f92483f6607f256e26991d368a3fbb7814c61e1c0e0bfb010380` |
| Candidate recovery HTML | `96a4671c63eff6b27ea07b63edeccb6ee9b1ffe1f48bd0e8814c892edd659910` |
| Combined forward HTML | `fbec9dbd8a06f98f1776144392def7a45ea278720f75ad9602f664fc4c2e0a20` |
| Combined recovery HTML | `13ca205fb94bb3a3e651cd0bb37a5f047f1f077bfc4c0a3a5423feb0927251b8` |

The private `.codex-tmp/samples-recovery-report.json` contains final status,
browser version, passed groups and synthetic owned-receipt digests. A partial
run remains `INCOMPLETE`, not green. No raw private runtime content is published.

Local results at artifact head `cd52801688e660b0a57baeebb45df2214b219c77`:
12 full-browser groups; 8 isolated recovery read cases plus exact
inverse and 3 drift refusals; existing reader 48/48 and local-work 18/18; repository
map 273/273; whitespace check clean. No blanket suite was rerun for this artifact
addition; no application checkout bytes changed. Hosted checks and release
evidence are separate from these local receipts.

Independent review identified that the original actor assertion also switched
clients, so it did not isolate same-client ownership. The correction adds that
explicit real-browser case and reruns only `--same-client-actor`: PASS. The full
selector now contains 13 groups; all 13 were not rerun together for this narrow
correction. Application and generated recovery HTML hashes remain unchanged.
