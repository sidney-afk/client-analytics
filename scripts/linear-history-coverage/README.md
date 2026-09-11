# Historical reference coverage (offline)

Measure the supplied Calendar/Samples history separately from staff archives.
This tool reads one local JSON file. It never fetches a URL, downloads an asset,
exports a workspace, imports a row, rescues a file, or changes an application.
Node 22 or newer; no package installation required.

Run the meaningful synthetic tests from the repository root:

```powershell
node scripts/linear-history-coverage/test.js
```

Run the CLI with a fictional snapshot:

```powershell
node scripts/linear-history-coverage/fixtures/synthetic.js | Set-Content -Encoding utf8 "$env:TEMP/syncview-fictional-history.json"
node scripts/linear-history-coverage/scan.js --input "$env:TEMP/syncview-fictional-history.json"
```

For an explicitly supplied private snapshot, replace the input with its local
absolute path. Keep that file and any raw receipts outside the checkout. Only
JSON is supported; do not pass SQL dumps, backup packages, credentials, or export
archives. The 25 MiB file bound refuses oversized input rather than truncating it.
Exit `0` means a bounded inventory of the supported supplied input, `2` means
incomplete input/extraction, and `1` means invalid input or changed helper source.
None is a product-readiness or provider-shutdown decision.

The tests are deliberately inside this task's owned directory. They require the
explicit command above; the existing `test/run-all.js` does not discover them.
The repository's ordinary unit and map checks remain separately required.

## Input contract

`fixtures/synthetic.js` emits a complete example; `scan.js` exports `REQUIRED`,
the exact required table/field list. Supply:

- `contract: "syncview-linear-history-coverage-v1"`.
- `metadata.source`: `kind` (`synthetic` or `private_snapshot`), a private
  `description`, and the source artifact's SHA-256. This is provenance supplied
  by the operator, not an independently certified export.
- `metadata.captured_at`: ISO timestamp, including timezone. Keep observations
  at or before this timestamp. The output reports historical observations only.
- `metadata.tables[table]`: exact included `fields` and `pagination` with
  `complete`, `expected_rows`, `returned_rows`, and `next_cursor`. Complete means
  counts match the supplied rows and `next_cursor` is null. This declaration
  must cover every page, not just a final page or the last successful request.
- `metadata.known_omissions`: an explicit array, even when empty. Any omission
  makes the report incomplete. Its text is never echoed.
- `data`: arrays for `calendar_posts`, `sample_reviews`, `production_comments`,
  `deliverables`, `thumbnail_media_revisions`, `linear_archive`, and
  `linear_archive_asset_refs`. Every required field must be present on every
  row; an explicit null differs from an omitted field. Unknown tables, missing
  fields, duplicate scoped identities, or malformed rows prevent completeness.
- `mappings` and `observations`: explicit arrays; empty arrays mean no supplied
  proof. Their absence is a coverage gap.

Do not manufacture null fields or completeness declarations to clear a gap.
Preserve actual schema omissions. This adapter does not authenticate Track-B
packages or replace F34's independent final-inventory certification.

A mapping binds an exact occurrence using `locator` with `table`, `client_scope`,
`row_id`, `field`, and zero-based `ordinal`, plus exact `source_url` and
`target_url`. `client_scope` is the row's `client` or `client_slug`, or empty only
where the source has no scope. For canonical comments, `row_id` is the
deliverable ID and `field` is `thread.<input-group-index>.body` or
`thread.<input-group-index>.attachments.<index>`. For card threads it is
`video_tweaks.<parsed-row-index>.body` (similarly for other components).
Archive fields start at `archive`; direct fields keep their column name.
Multiple URLs in a text field have separate ordinals. Storage references use
their exact object path as `source_url`; this is a reference value, not an HTTP
URL. The raw locator stays private; only its random-key HMAC appears in output.

An independently stored classification requires exactly one occurrence mapping,
a `mapping_observation` (`observed_at`, `evidence_sha256`), and `storage` containing:

- `provider_independent: true`, `observed_at`, and `evidence_sha256`;
- matching nonempty `source_sha256` / `readback_sha256` and positive `byte_length`;
- a non-Linear HTTP(S) target URL on the mapping.

These are supplied observation receipts. The scanner checks their shape,
binding, dates and agreement; it does **not** authenticate a receipt digest or
independently read the bytes. Only supply audited receipts from an actual
mapping check and independent object readback. A sidecar `rescued` state, an
export filename, a non-Linear hostname, or a guessed signed-URL expiry does not
satisfy this contract. A sidecar alternative without receipts is `unproven`.

An accessibility observation requires the same exact `locator`, exact `url`,
`principal: "anonymous_client"`, `observed_at`, `evidence_sha256`, and `result`
(`failure` or `retrieved`). Retrieval additionally requires `content_sha256`
and `rendered_correct: true`; a status code alone never qualifies. Observations
for a mapped copy are reported separately from the original URL and do not
prove that a reader adopted that mapping. Staff observations cannot establish
client access; conflicting observations remain conflicting. See `test.js` for
fictional mapping and observation examples.

A positive **mapped-copy** retrieval also requires the observed `content_sha256`
to equal the source/readback hash of the mapping's verified storage evidence.
A syntactically valid different hash yields `contradictory_content_observation`,
even if `rendered_correct` is true or another receipt matches. Without verified
storage or an observed content hash, mapped retrieval remains `unproven`.
Renditions with different bytes are not supported by this evidence contract;
an unverified rendition flag cannot bypass the byte match. Storage independence
can retain its supplied proof while mapped retrieval contradicts it.

`mapped_observations` retains separately auditable records for accepted mapped
success, failure and conflicting observations: paired `observed_at` timestamp,
`evidence_sha256`, `result`, optional `content_sha256`, `content_binding` and the
supplied `rendered_correct` boolean. The records sort by timestamp and receipt
hash without separating those pairs. These records contain no URL, locator,
body, arbitrary failure text or attachment name. The existing `observed_at` and
`observation_receipt_hashes` fields still refer only to the original URL.

## Output and interpretation

| Classification | Evidence required / meaning |
| --- | --- |
| `independently_stored` | Exact mapping and sufficient supplied independent byte-readback receipts; client access remains separate |
| `provider_dependent` | The only known retrieval path is on Linear; no mapping or sidecar alternative is known |
| `inaccessible` | A supplied, occurrence/URL/principal-bound failure observation establishes failure at its observation time |
| `unsupported` | The extraction grammar/format is not implemented; this is an input unit, not a measured asset count |
| `unproven` | Evidence is insufficient, conflicting, or a mapping is missing/incomplete |

An original URL may be inaccessible while a mapped independent copy exists;
`storage_independence` preserves that distinction. `scope_counts` separates
client card candidates, canonical candidates, thumbnail history candidates,
staff/internal, staff archives, archived cards, hidden/deleted content, and uncertain scope.
These are **candidate references**, not a reconstructed session or proof that
the client can see them. No crosswalk, runtime flag, active-client identity,
component eligibility, local archive suppression, or deployed reader is certified.
An explicit card `status: Archived` is excluded from client card candidates;
unknown runtime/client-local filters still require a real reader proof.

Occurrences are retained even when the same resource repeats. Unique resources
are a separate denominator. When a body cannot be extracted, total supplied
reference occurrences are null; known occurrences and unsupported input units
are separately counted. `estate_total_references` is always null; this bounded
scanner cannot establish the full historical estate denominator. Every report
keeps `full_linear_independence: UNPROVEN`, `current_client_retrieval: NOT_TESTED`,
and `restore_drill: NOT_TESTED`.

Output uses fixed enums, counts, ISO observation timestamps, source/receipt
digests, and per-run random-key HMAC handles. It emits no URLs, bodies, names,
tokens, client identifiers, attachment filenames, arbitrary metadata, or input
paths. Handles deliberately change between CLI runs; keep input provenance
privately to reproduce a finding. Errors also suppress parser/path text.

## Supported and unsupported formats

| Source | Supported | Explicit limits |
| --- | --- | --- |
| Calendar card threads | Actual `_calLoadCommentsField`; video, graphic, caption and title; legacy prose seeding | Title eligibility is not reconstructed; malformed/dropped rows are incomplete |
| Samples card threads | Actual `_sxrMigrateShape`; video and graphic JSON arrays | Non-JSON legacy prose is a gap, matching its distinct parser |
| Canonical comments | Actual `publicComment` and `_prodCanonicalCardComment`; audience, replies, resolve/delete state | Candidate inventory only; authorization/crosswalk/completeness/network orchestration unproven |
| Bodies | Plain text, basic Markdown HTTP(S) inline images/links, reference definitions, autolinks, balanced parentheses | HTML/rich JSON, relative/data/blob/FTP references, escaped/complex Markdown, embedded documents and URL-less opaque formats are not fully supported |
| Attachments | Array objects with `url`, `href`, or `file_url`; every occurrence retained | Beyond the canonical reader's 20-item cap is a gap; other schemas unsupported |
| Card media | `asset_url`, `thumbnail_url`, `thumbnail_folder_url`; caption/CTA and creative-direction references | Creative-direction audience is unproven; Drive ID-only retrieval and folder membership are unsupported |
| Thumbnail history | Baseline/latest storage path references | No object bytes, policy, signed URL issuance, newest-cycle selection, or render proof |
| Staff archive | Recursive JSON string extraction to depth 20, plus deliverable briefs | Not a client history reader; depth overflow is incomplete |

The F34 `urlsFromText` helper and its exact pattern are exercised as an additional
extraction coverage check. Its narrower parser is not used as the entire asset
universe. No rescue/backup entrypoint is imported or executed. The app's pure
helpers are extracted with the repository's shared brace-balanced extractor in
a context without browser boot, network, credentials, or a writer.

See [the dated evidence and next gates](2026-09-05-report.md).
