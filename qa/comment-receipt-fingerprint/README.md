# Comment add receipt fingerprint regression

Source-only candidate based on `ce63c74d0333138f862cef5637bb7532fe059b74`.
Run `node test/comment-receipt-fingerprint.js` with Node 22.12+ and the baseline
commit available locally (the unit workflow checks out full history). Set
`COMMENT_FINGERPRINT_REPORT` to an off-repository path to retain JSON evidence.
No credentials or network are required; the runner refuses every external fetch.

The complete `production-write` handler accepts each synthetic add through its
real authentication, authorization, normalization, ID and fingerprint code. A
strict in-process Supabase seam implements only the reads and two RPC shapes
used by these cases. `production_comment_write` persists the actual arguments
as canonical comment, mutation receipt, event and outbox rows; it never provides
a preselected readback outcome. The actual gateway performs receipt readback.
This is RPC-shaped persistence, **not PostgreSQL, transaction or serving proof**.

The finite matrix has 238 assertion groups across ten variants: Calendar and
Samples (`sxr`), each VIDEO/GRAPHIC component and note/tweak; plus staff Calendar
and Production adds without a supplied native comment ID. For every variant:

- Baseline acceptance succeeds but its identical readback returns `conflict`.
- Candidate readback recognizes both baseline and candidate acceptance as
  `committed_exact`, without changing stored data or invoking a mutation RPC.
- Accepted add fingerprint bytes are identical before and after the repair;
  exact repeated adds leave one canonical comment, receipt, event and outbox.
- Changed body, actor, component, round, tweak marker, source clock and target
  cannot adopt the receipt. A changed target with a supplied native ID conflicts;
  without one it derives a distinct identity and remains `absent`, never exact.
- Removing the outbox keeps the existing refusal; this patch adds no fallback
  for an acceptance with no outbox receipt.
- Lifecycle-shaped readbacks (`edit`, `delete`, `resolve`, `unresolve` with CAS)
  cannot adopt the earlier add: baseline returns a conflict; candidate explicitly
  refuses this unsupported read operation. Lifecycle write/replay is unchanged.
- Explicit `action: "add"` remains compatible with omitted action. An active
  other-client token cannot read the original client's accepted comment (403).

The runtime change shares `commentAddFingerprint` between the accepted-add path
and `reconcileEntityOperation`: the existing accepted schema includes `action:
"add"` and two explicit null lifecycle CAS fields. Readback previously omitted
them. `intentFingerprint`, authorization, exact receipt/canonical scope checks,
and non-add lifecycle action/CAS fingerprints retain their existing behavior.
The reader now checks that the normalized action is `add` before reconstructing
its receipt, using the existing `reconcile_operation_unsupported` error otherwise.
Existing comment-slice and front-door suites cover those lifecycle policies;
this finite handler matrix exercises adds, not edit/delete/resolve/reopen RPCs.

Audit anchors at this candidate: `production-write/index.ts`
`reconcileEntityOperation:1926`, reconstruction `:2069`, accepted fingerprint
`:5189`; `policy.mjs` `commentAddFingerprint:1286`. Entry sources at the baseline
are `index.html` `readNative:43581` and `_writeUiReadRepairReceipt:67084`; the shared
Calendar/Samples caller is why both surfaces are included.

Candidate `index.ts` SHA256 is
`d98d52efb9ccd18ddefda2990b9af05b9f78a73e4d23458a6f80c242b49137d8`;
`policy.mjs` SHA256 is
`87bcf395acbd0b0100f656edb23a55df473b8d8318df9d225405eb68c0d74d2b`.
The runner emits baseline and candidate source hashes and synthetic cases.

No frontend, frozen anonymous writer, schema, flag, deployment pin or source
comment/status repair changes. The manual Section 4 serving/release gate remains
held. This does not establish complete Calendar feedback recovery. Discarding
or reverting this local source patch restores the old false-conflict behavior;
no stored fingerprint or accepted work needs rewriting. A future deployed
rollback requires the separately reviewed captured serving closure, not a blind
whole-branch revert or a client-writer re-gate.
