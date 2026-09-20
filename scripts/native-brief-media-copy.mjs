#!/usr/bin/env node
/*
 * native-brief-media-copy.mjs — build script for the (still-dormant)
 * `native_brief_media` recovery lane.
 *
 * For every `deliverables` row whose `brief` contains an
 * `uploads.linear.app` URL, this copies the file into the private
 * `syncview-native-brief-media` storage bucket and inserts a
 * `native_brief_media_occurrences` row carrying exactly the fields a
 * "verified" row needs per the reader's own validation
 * (`supabase/functions/_shared/native-brief-media.mjs`, `projectBriefMedia`)
 * and the migration's own CHECK constraint
 * (`migrations/2026-09-07-native-brief-media.sql`).
 *
 * Default mode is dry-run: `plan` reads a pre-extracted `rows.json`, scans
 * every brief with the SAME occurrence regex the reader uses (imported, not
 * re-derived), and writes a manifest of counts + occurrences. Zero network
 * calls. `apply` performs the real copy and REQUIRES both the `--apply` flag
 * and an explicit confirmation env var — belt-and-suspenders, because this
 * task ships the script but authorizes no live run of it.
 *
 * NOT RUN LIVE from this session, against any real database or the real
 * Linear API. Ships as a build, proven only by its offline test.
 *
 * Commands:
 *   native-brief-media-copy.mjs plan  <rows.json> <manifest.json>
 *   native-brief-media-copy.mjs apply --apply <manifest.json> <out-map.json>
 *
 * rows.json shape (an array), matching the precedent set by
 * `linear-media-rescue.mjs scan <rows.json> <manifest.json>` — a
 * pre-extracted set of rows, not a live query run inside this script:
 *   [{ id, client_slug, team, brief, updated_at, status, linear_issue_uuid }]
 * `linear_issue_uuid` (`deliverables.linear_issue_uuid`,
 * migrations/2026-07-06-b1-linear-data-model.sql) is required on any row
 * whose brief carries an `uploads.linear.app` occurrence — see "the stored
 * URL is stale" below.
 *
 * Secrets are env-only, never CLI args (shell history) and never logged:
 *   LINEAR_API_KEY                 — Linear personal/API key for the GraphQL
 *                                     re-fetch AND the asset download
 *   SUPABASE_URL                   — project REST/storage origin
 *   SUPABASE_SERVICE_ROLE_KEY      — service-role key (bucket is service-role only)
 *   NATIVE_BRIEF_MEDIA_COPY_CONFIRM — must equal COPY_NATIVE_BRIEF_MEDIA to --apply
 *
 * THE URL STORED IN `brief` IS ALREADY STALE AND MUST NEVER BE GETted
 * DIRECTLY. Per `docs/ops/LINEAR_MEDIA_RESCUE.md` §0 (measured 2026-09-07,
 * read-only, live): Linear mints the `?signature=` JWT fresh on every API
 * read and gives it a 300-second life; every URL sitting in `brief` was
 * captured whenever that brief was last synced, so its signature died five
 * minutes later and a GET of it now returns 401 regardless of the bearer
 * header. The only remaining route to the bytes is to re-read the issue
 * through the Linear API (`resolveFreshUrl`, GraphQL `issue(id:) { description }`,
 * same convention as `scripts/production-write-drill.js`'s
 * `ProductionWriteDrillDescription` query) and take whichever fresh
 * occurrence shares the stale one's `mediaKey()` (origin+pathname — the
 * signature is never a stable identity, exactly as `linear-media-rescue.mjs`
 * documents). `docs/ops/LINEAR_EXIT_JOURNAL.md`'s 2026-09-18 entry records
 * that the Linear API itself was STILL LIVE as of that measurement — the
 * "Linear access ends 2026-09-15" line in `docs/ops/LINEAR_CUTOFF_RUNBOOK.md`
 * is a prepared, not-yet-executed plan, read back once as though it had
 * already happened. This script does not assume either state; `apply`
 * simply fails closed (a named `linear_graphql_failed_*` / `linear_download_failed_*`
 * refusal, not a crash) the day that key is actually revoked.
 *
 * The manifest and out-map carry live, signed `uploads.linear.app` URLs
 * and so must never land in git; `assertPrivatePath` (ported from
 * linear-media-rescue.mjs, same rule as its `privateFile()`) refuses both
 * output paths inside a git working tree.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  briefMediaOccurrences,
  briefMediaHash,
  BRIEF_MEDIA_BUCKET,
  BRIEF_MEDIA_CONTRACT,
} from '../supabase/functions/_shared/native-brief-media.mjs';

/* ------------------------------------------------------------------ *
 * Public-repo guard — ported from scripts/linear-media-rescue.mjs
 * assertPrivatePath(). Kept as a local copy rather than an import so this
 * file has no runtime dependency on a sibling rescue lane's internals
 * beyond the one thing both need; the rule and its reasoning are identical.
 * ------------------------------------------------------------------ */
export function assertPrivatePath(target) {
  let dir = path.resolve(path.dirname(target));
  for (;;) {
    if (fs.existsSync(path.join(dir, '.git'))) {
      throw new Error(
        `refusing to write ${target}: it sits inside a git working tree ` +
        `(${dir}). This manifest/out-map carries a live, signed ` +
        `uploads.linear.app URL and this repo is public. Write it under a ` +
        `private directory instead.`
      );
    }
    const up = path.dirname(dir);
    if (up === dir) return target;
    dir = up;
  }
}

/* The stable identity of a Linear upload: origin + pathname, no query — the
   `?signature=` JWT is re-minted on every read (measured in
   linear-media-rescue.mjs) and must never be treated as part of the key. */
export function mediaKey(url) {
  const u = new URL(String(url));
  return u.origin + u.pathname;
}

export function mediaKeyHash(url) {
  return crypto.createHash('sha256').update(mediaKey(url)).digest('hex');
}

const sha256Hex = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

/* mime allowlist from the migration's verified-row CHECK constraint, plus
   the bucket-level allowlist (a strict subset for now — the bucket only
   admits image/pdf/svg/video types the CHECK also names). */
const VERIFIED_MIME = new Set([
  'image/png', 'image/jpeg', 'image/webp', 'image/gif',
  'application/pdf', 'image/svg+xml', 'video/mp4', 'video/quicktime',
]);

/*
 * The bucket's OWN `allowed_mime_types` (migration's `storage.buckets` insert)
 * is a narrower set than the verified-row CHECK constraint's mime_type list
 * above: it admits only the four image types plus `application/octet-stream`
 * — no `application/pdf`, `image/svg+xml`, `video/mp4` or `video/quicktime`.
 * Supabase Storage enforces the bucket's allowlist against the upload's
 * declared Content-Type, independent of whatever mime_type this script later
 * writes into the occurrence row. So for the four types the bucket does not
 * admit, the upload is sent as `application/octet-stream` (bucket-legal)
 * while the occurrence row still records the real detected mime_type (the
 * CHECK constraint's column, not the storage object's content-type header).
 * Readback verifies bytes either way, so this does not weaken verification.
 */
const BUCKET_ALLOWED_MIME = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/octet-stream']);
const bucketUploadContentType = mimeType => (BUCKET_ALLOWED_MIME.has(mimeType) ? mimeType : 'application/octet-stream');

const MAX_BYTES = 52428800; // migration CHECK: byte_length between 1 and 52428800

/* ------------------------------------------------------------------ *
 * The unique-index key tuple this lane's idempotency rests on:
 * migrations/2026-09-07-native-brief-media.sql →
 *   native_brief_media_verified_occurrence on
 *   (source_kind, source_entity_id, deliverable_id, client_slug, team,
 *    source_sha256, source_offset) where state='verified'
 * ------------------------------------------------------------------ */
export function occurrenceKeyTuple({ deliverableId, clientSlug, team, briefSha256, offset }) {
  return {
    source_kind: 'native_brief',
    source_entity_id: deliverableId,
    deliverable_id: deliverableId,
    client_slug: clientSlug,
    team,
    source_sha256: briefSha256,
    source_offset: offset,
  };
}

/* A deterministic, publishable string for the tuple above — used only to
   compare/index manifest entries locally, never sent anywhere and never
   itself a secret (it contains no URL, token or client display name). */
export function occurrenceKeyString(tuple) {
  return [
    tuple.source_kind, tuple.source_entity_id, tuple.deliverable_id,
    tuple.client_slug, tuple.team, tuple.source_sha256, tuple.source_offset,
  ].join('\u0000');
}

/* ------------------------------------------------------------------ *
 * plan — pure, offline, zero network
 * ------------------------------------------------------------------ */

export async function buildManifest(rows) {
  const occurrences = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const brief = typeof row.brief === 'string' ? row.brief : '';
    const refs = briefMediaOccurrences(brief);
    if (!refs.length) continue;
    const briefSha256 = await briefMediaHash(brief);
    for (const ref of refs) {
      const originalUrlSha256 = await briefMediaHash(ref.url);
      const tuple = occurrenceKeyTuple({
        deliverableId: String(row.id),
        clientSlug: String(row.client_slug),
        team: String(row.team),
        briefSha256,
        offset: ref.offset,
      });
      occurrences.push({
        deliverable_id: String(row.id),
        client_slug: String(row.client_slug),
        team: String(row.team),
        linear_issue_uuid: row.linear_issue_uuid != null ? String(row.linear_issue_uuid) : null,
        source_updated_at: row.updated_at,
        source_sha256: briefSha256,
        source_offset: ref.offset,
        source_length: ref.length,
        original_url_sha256: originalUrlSha256,
        url: ref.url,
        key: mediaKey(ref.url),
        key_sha256: mediaKeyHash(ref.url),
        key_tuple_string: occurrenceKeyString(tuple),
      });
    }
  }
  const distinctFiles = new Set(occurrences.map(o => o.key));
  const distinctTuples = new Set(occurrences.map(o => o.key_tuple_string));
  return {
    contract: BRIEF_MEDIA_CONTRACT,
    bucket: BRIEF_MEDIA_BUCKET,
    generated_at: new Date().toISOString(),
    rows: (Array.isArray(rows) ? rows : []).map(r => ({
      id: String(r.id), client_slug: String(r.client_slug), team: String(r.team),
      status: r.status ?? null, updated_at: r.updated_at, brief: r.brief,
      linear_issue_uuid: r.linear_issue_uuid != null ? String(r.linear_issue_uuid) : null,
    })),
    occurrences,
    counts: {
      rows: Array.isArray(rows) ? rows.length : 0,
      rows_with_media: new Set(occurrences.map(o => o.deliverable_id)).size,
      occurrences: occurrences.length,
      distinct_files: distinctFiles.size,
      distinct_verified_key_tuples: distinctTuples.size,
    },
  };
}

function cmdPlan(rowsPath, manifestPath) {
  assertPrivatePath(manifestPath);
  const rows = JSON.parse(fs.readFileSync(rowsPath, 'utf8'));
  return buildManifest(rows).then(manifest => {
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    const c = manifest.counts;
    console.log(
      `rows=${c.rows} rows_with_media=${c.rows_with_media} ` +
      `occurrences=${c.occurrences} distinct_files=${c.distinct_files} ` +
      `distinct_verified_key_tuples=${c.distinct_verified_key_tuples}`
    );
    console.log(`manifest written (PRIVATE): ${manifestPath}`);
    console.log('mode: plan (dry run) — zero network calls made');
    printFlagBlock();
    return manifest;
  });
}

/* ------------------------------------------------------------------ *
 * apply — the real copy. Every network call is behind an injectable
 * `deps` object so the offline test can mock fetch and storage without any
 * real network access, per the task's "no live run" constraint.
 * ------------------------------------------------------------------ */

/**
 * Query for an existing verified occurrence matching the exact key tuple.
 * This IS the idempotency mechanism: the unique index only exists for
 * state='verified', so a hit here means the copy already happened and must
 * be skipped, never re-downloaded or re-inserted.
 */
export async function findExistingVerified(config, tuple, deps) {
  const params = new URLSearchParams({
    select: '*',
    source_kind: `eq.${tuple.source_kind}`,
    source_entity_id: `eq.${tuple.source_entity_id}`,
    deliverable_id: `eq.${tuple.deliverable_id}`,
    client_slug: `eq.${tuple.client_slug}`,
    team: `eq.${tuple.team}`,
    source_sha256: `eq.${tuple.source_sha256}`,
    source_offset: `eq.${tuple.source_offset}`,
    state: 'eq.verified',
    limit: '2',
  });
  const res = await deps.fetch(`${config.supabaseUrl}/rest/v1/native_brief_media_occurrences?${params}`, {
    method: 'GET',
    headers: restHeaders(config),
  });
  if (!res.ok) throw new Error(`existing_lookup_failed_${res.status}`);
  const rows = await res.json();
  if (!Array.isArray(rows) || rows.length > 1) throw new Error('existing_lookup_ambiguous');
  return rows[0] || null;
}

function restHeaders(config) {
  return {
    apikey: config.supabaseServiceKey,
    authorization: `Bearer ${config.supabaseServiceKey}`,
    'content-type': 'application/json',
  };
}

/**
 * Re-read the issue through Linear's GraphQL API and return a FRESH signed
 * URL for the same file (matched by `mediaKey()`, never the stale URL
 * itself — see the file header comment). The stale URL is used only to
 * compute the key to match against, never sent to Linear or fetched
 * directly. Same GraphQL shape as `scripts/production-write-drill.js`'s
 * `ProductionWriteDrillDescription` query.
 */
export async function resolveFreshUrl(linearIssueUuid, staleUrl, config, deps) {
  if (!linearIssueUuid) throw new Error('linear_issue_uuid_missing');
  const key = mediaKey(staleUrl);
  const res = await deps.fetch('https://api.linear.app/graphql', {
    method: 'POST',
    headers: { authorization: config.linearApiKey, 'content-type': 'application/json' },
    body: JSON.stringify({
      query: 'query NativeBriefMediaRefresh($id: String!) { issue(id: $id) { id description } }',
      variables: { id: linearIssueUuid },
    }),
  });
  if (!res.ok) throw new Error(`linear_graphql_failed_${res.status}`);
  const json = await res.json();
  if (json.errors) throw new Error('linear_graphql_error');
  const description = json.data && json.data.issue && json.data.issue.description;
  if (typeof description !== 'string') throw new Error('linear_issue_description_missing');
  const fresh = briefMediaOccurrences(description).find(ref => mediaKey(ref.url) === key);
  if (!fresh) throw new Error('linear_fresh_signature_not_found');
  return fresh.url;
}

/** Download the file from Linear, given an ALREADY-FRESH URL (see
 *  resolveFreshUrl). Returns { bytes, mimeType, contentSha256, receiptSha256 }. */
export async function downloadFromLinear(url, config, deps) {
  const res = await deps.fetch(url, {
    method: 'GET',
    headers: { authorization: config.linearApiKey },
  });
  if (!res.ok) throw new Error(`linear_download_failed_${res.status}`);
  const arrayBuffer = await res.arrayBuffer();
  const bytes = Buffer.from(arrayBuffer);
  const mimeType = String(res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  /*
   * source_receipt_sha256 (NOT NULL, not itself re-validated by the reader
   * but required by the migration's schema): this hashes a canonical
   * "receipt" of the fetch — status, declared content-type, byte length and
   * the downloaded bytes' own sha256 — rather than the URL (which carries a
   * secret signature and must never be persisted) and rather than the raw
   * bytes alone (which would just duplicate content_sha256). The receipt is
   * evidence that a specific fetch of a specific byte sequence happened,
   * independent of the URL's signature.
   */
  const contentSha256 = sha256Hex(bytes);
  const receipt = JSON.stringify({
    status: res.status,
    content_type: mimeType,
    byte_length: bytes.length,
    content_sha256: contentSha256,
    key_sha256: mediaKeyHash(url),
  });
  const receiptSha256 = sha256Hex(Buffer.from(receipt, 'utf8'));
  return { bytes, mimeType, contentSha256, receiptSha256 };
}

/** Upload to the bucket at the content-addressed path, then independently
 *  read it back — the reader trusts readback_sha256 only when it was
 *  PROVEN by a real second read, not merely asserted equal to content_sha256. */
export async function uploadAndReadBack(config, storagePath, bytes, mimeType, deps) {
  const uploadRes = await deps.fetch(
    `${config.supabaseUrl}/storage/v1/object/${BRIEF_MEDIA_BUCKET}/${storagePath}`,
    {
      method: 'POST',
      headers: {
        apikey: config.supabaseServiceKey,
        authorization: `Bearer ${config.supabaseServiceKey}`,
        'content-type': bucketUploadContentType(mimeType),
        'x-upsert': 'false',
      },
      body: bytes,
    }
  );
  if (!uploadRes.ok) throw new Error(`storage_upload_failed_${uploadRes.status}`);

  /* Independent readback: a fresh GET, not a reuse of the bytes just sent. */
  const readRes = await deps.fetch(
    `${config.supabaseUrl}/storage/v1/object/authenticated/${BRIEF_MEDIA_BUCKET}/${storagePath}`,
    {
      method: 'GET',
      headers: {
        apikey: config.supabaseServiceKey,
        authorization: `Bearer ${config.supabaseServiceKey}`,
      },
    }
  );
  if (!readRes.ok) throw new Error(`storage_readback_failed_${readRes.status}`);
  const readBytes = Buffer.from(await readRes.arrayBuffer());
  const readbackSha256 = sha256Hex(readBytes);
  return readbackSha256;
}

export async function insertVerifiedRow(config, row, deps) {
  const res = await deps.fetch(`${config.supabaseUrl}/rest/v1/native_brief_media_occurrences`, {
    method: 'POST',
    headers: { ...restHeaders(config), prefer: 'return=representation' },
    body: JSON.stringify(row),
  });
  if (!res.ok) throw new Error(`insert_failed_${res.status}`);
  const inserted = await res.json();
  return Array.isArray(inserted) ? inserted[0] : inserted;
}

/**
 * Copy every occurrence in the manifest that does not already have a
 * verified row for its exact key tuple.
 *
 * IMPORTANT: one file (one `mediaKey()`) can appear in more than one
 * deliverable's brief — a duplicate pasted into two cards, or the same
 * asset referenced twice. `projectBriefMedia` (the reader) scopes its
 * lookup by the CURRENT deliverable/client/team, so a row copied under one
 * deliverable's identity is invisible to every other deliverable that
 * shares the file — each distinct (deliverable_id, client_slug, team,
 * source_offset) tuple needs its OWN verified row (own id, own
 * content-addressed storage_path — the migration's formula ties the path
 * to the row's own id, so the object write cannot be shared either).
 * What CAN be shared, and is, via `downloadCache` keyed on `mediaKey()`: a
 * single Linear GraphQL re-fetch + asset download + mime/size validation
 * per distinct file, never per occurrence.
 *
 * `deps.fetch` and `deps.now` are injectable so the offline test never
 * touches a real network.
 */
export async function applyManifest(manifest, config, deps) {
  const outMap = {};
  const results = { copied: 0, skipped_idempotent: 0, refused: 0 };
  const downloadCache = new Map(); // mediaKey -> { ok:true, bytes, mimeType, contentSha256, receiptSha256 } | { ok:false, error }

  for (const occ of manifest.occurrences) {
    const tuple = occurrenceKeyTuple({
      deliverableId: occ.deliverable_id,
      clientSlug: occ.client_slug,
      team: occ.team,
      briefSha256: occ.source_sha256,
      offset: occ.source_offset,
    });
    const tupleKey = occurrenceKeyString(tuple);

    const existing = await findExistingVerified(config, tuple, deps);
    if (existing) {
      outMap[tupleKey] = { id: existing.id, storage_path: existing.storage_path, reused: true };
      results.skipped_idempotent += 1;
      continue;
    }

    let dl = downloadCache.get(occ.key);
    if (!dl) {
      try {
        const freshUrl = await resolveFreshUrl(occ.linear_issue_uuid, occ.url, config, deps);
        const downloaded = await downloadFromLinear(freshUrl, config, deps);
        if (!VERIFIED_MIME.has(downloaded.mimeType)) {
          dl = { ok: false, error: 'unsupported_mime_type' };
        } else if (downloaded.bytes.length < 1 || downloaded.bytes.length > MAX_BYTES) {
          dl = { ok: false, error: 'byte_length_out_of_range' };
        } else {
          dl = { ok: true, ...downloaded };
        }
      } catch (error) {
        dl = { ok: false, error: String((error && error.message) || error) };
      }
      downloadCache.set(occ.key, dl);
    }

    if (!dl.ok) {
      results.refused += 1;
      outMap[tupleKey] = { error: dl.error, reused: false };
      continue;
    }

    const { bytes, mimeType, contentSha256, receiptSha256 } = dl;
    const id = crypto.randomUUID();
    const storagePath = `${contentSha256}/${id}`;
    const readbackSha256 = await uploadAndReadBack(config, storagePath, bytes, mimeType, deps);

    if (readbackSha256 !== contentSha256) {
      /* Never mark verified on a byte mismatch. Record the refusal and move
         on; nothing here writes a 'verified' row. This is a per-occurrence
         storage write, so it does not poison the shared download cache —
         a later occurrence sharing this file gets its own fresh attempt. */
      results.refused += 1;
      outMap[tupleKey] = { error: 'readback_mismatch', reused: false };
      continue;
    }

    const now = deps.now ? deps.now() : new Date();
    const verifiedAt = now.toISOString();

    const row = {
      id,
      deliverable_id: tuple.deliverable_id,
      source_kind: tuple.source_kind,
      source_entity_id: tuple.source_entity_id,
      client_slug: tuple.client_slug,
      team: tuple.team,
      source_updated_at: occ.source_updated_at,
      source_sha256: tuple.source_sha256,
      source_offset: tuple.source_offset,
      source_length: occ.source_length,
      original_url_sha256: occ.original_url_sha256,
      audience: 'staff',
      state: 'verified',
      content_sha256: contentSha256,
      readback_sha256: readbackSha256,
      storage_path: storagePath,
      byte_length: bytes.length,
      mime_type: mimeType,
      verified_at: verifiedAt,
      source_receipt_sha256: receiptSha256,
    };
    const inserted = await insertVerifiedRow(config, row, deps);
    outMap[tupleKey] = { id: inserted.id, storage_path: inserted.storage_path, reused: false };
    results.copied += 1;
  }

  return { outMap, results };
}

function cmdApplyGate(argv, env) {
  if (!argv.includes('--apply')) {
    throw new Error('apply_flag_required: pass --apply to perform the real copy');
  }
  if (env.NATIVE_BRIEF_MEDIA_COPY_CONFIRM !== 'COPY_NATIVE_BRIEF_MEDIA') {
    throw new Error(
      'owner_confirmation_required: set NATIVE_BRIEF_MEDIA_COPY_CONFIRM=COPY_NATIVE_BRIEF_MEDIA'
    );
  }
}

/* `deps` defaults to the real global fetch and is overridable so this
   command can also be driven directly, in-process, against a mocked
   network (the offline test does this to prove the printed flip block is
   really produced by a full run, not just by the pure receipt functions). */
export async function cmdApply(manifestPath, outMapPath, argv, env, deps = { fetch }) {
  assertPrivatePath(manifestPath);
  assertPrivatePath(outMapPath);
  cmdApplyGate(argv, env);
  const config = {
    supabaseUrl: String(env.SUPABASE_URL || '').replace(/\/+$/, ''),
    supabaseServiceKey: String(env.SUPABASE_SERVICE_ROLE_KEY || ''),
    linearApiKey: String(env.LINEAR_API_KEY || ''),
  };
  if (!config.supabaseUrl || !config.supabaseServiceKey || !config.linearApiKey) {
    throw new Error(
      'configuration_required: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and LINEAR_API_KEY must be set'
    );
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const { outMap, results } = await applyManifest(manifest, config, deps);
  fs.writeFileSync(outMapPath, JSON.stringify(outMap, null, 2));
  console.log(
    `copied=${results.copied} skipped_idempotent=${results.skipped_idempotent} refused=${results.refused}`
  );
  console.log(`out-map written (PRIVATE): ${outMapPath}`);
  const coverage = computeCoverageReceipt(manifest, outMap);
  const receipts = { coverage, recoveryReceiptSha256: computeRecoveryReceipt(outMap) };
  console.log(
    `coverage: ${coverage.resolved}/${coverage.total} resolved, complete=${coverage.complete}`
  );
  printFlagBlock(receipts);
  return { outMap, results, receipts };
}

/* ------------------------------------------------------------------ *
 * Flag flip / rollback — informational only. Printed at the end of every
 * run, never executed by this script.
 *
 * `projectBriefMedia()` (supabase/functions/_shared/native-brief-media.mjs)
 * requires MORE than `{mode:"required",contract:"native_brief_media_v1"}` on
 * the flag value before it treats `required` as active — it also demands
 * `recovery_contract === 'native_brief_media_recovery_v1'` and a valid
 * (64-hex) `recovery_receipt_sha256` / `coverage_receipt_sha256`. A flip
 * printed without those would deploy inert: every media-bearing brief would
 * still fall back to the broken Linear URL (`complete:false`) exactly as
 * before. So the REAL flip is only computable from a completed, zero-gap
 * `apply` run's own out-map — it is never templated ahead of one.
 *
 *   coverage_receipt_sha256 attests to COMPLETENESS: a canonical digest of
 *   every distinct verified-occurrence key tuple the manifest named, and
 *   how many of them resolved (idempotent-skip or fresh copy) without a
 *   single refusal. It is only produced, and only "complete", when
 *   `results.refused === 0` across the whole manifest.
 *
 *   recovery_receipt_sha256 attests to WHAT WAS ACTUALLY COPIED: a
 *   canonical digest of every (tuple, id, storage_path) the run produced,
 *   sorted, so the receipt is stable across a re-run that only skips
 *   already-verified tuples.
 *
 * `mode:"off"` needs neither field (the reader short-circuits on `off`
 * before it ever reads them), so the rollback block is always the real,
 * fully-runnable instruction, with or without a prior apply.
 * ------------------------------------------------------------------ */
const RECOVERY_CONTRACT = 'native_brief_media_recovery_v1';

/* Deterministic key-sorted JSON so two runs over the same result produce the
   same receipt, independent of object key insertion order. */
function canonicalJson(value) {
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort()
      .map(k => JSON.stringify(k) + ':' + canonicalJson(value[k])).join(',') + '}';
  }
  return JSON.stringify(value);
}

/**
 * Coverage receipt: every distinct verified-occurrence tuple the manifest
 * named, and whether every one of them now resolves (existing verified row
 * or a freshly copied one) with zero refusals. `complete` gates whether
 * `flagFlipSql` may print a real, activating flip at all.
 */
export function computeCoverageReceipt(manifest, outMap) {
  const tuples = [...new Set((manifest.occurrences || []).map(occ => occurrenceKeyString(occurrenceKeyTuple({
    deliverableId: occ.deliverable_id, clientSlug: occ.client_slug, team: occ.team,
    briefSha256: occ.source_sha256, offset: occ.source_offset,
  }))))].sort();
  const resolved = tuples.filter(t => outMap[t] && !outMap[t].error);
  const payload = {
    contract: BRIEF_MEDIA_CONTRACT,
    total_occurrences: tuples.length,
    resolved_occurrences: resolved.length,
    resolved_tuples_sha256: sha256Hex(Buffer.from(canonicalJson(resolved), 'utf8')),
  };
  return {
    complete: tuples.length > 0 && resolved.length === tuples.length,
    total: tuples.length,
    resolved: resolved.length,
    sha256: sha256Hex(Buffer.from(canonicalJson(payload), 'utf8')),
  };
}

/** Recovery receipt: every (tuple, id, storage_path) this out-map actually
 *  resolved, sorted, so it is stable across an idempotent re-run. */
export function computeRecoveryReceipt(outMap) {
  const entries = Object.keys(outMap).sort()
    .filter(t => outMap[t] && !outMap[t].error)
    .map(t => ({ tuple: t, id: outMap[t].id, storage_path: outMap[t].storage_path, reused: outMap[t].reused === true }));
  return sha256Hex(Buffer.from(canonicalJson(entries), 'utf8'));
}

export function flagFlipSql(receipts) {
  if (receipts && receipts.coverage && receipts.coverage.complete && /^[a-f0-9]{64}$/.test(receipts.recoveryReceiptSha256)) {
    const value = {
      mode: 'required',
      contract: BRIEF_MEDIA_CONTRACT,
      recovery_contract: RECOVERY_CONTRACT,
      recovery_receipt_sha256: receipts.recoveryReceiptSha256,
      coverage_receipt_sha256: receipts.coverage.sha256,
    };
    return `update public.syncview_runtime_flags
   set value = ${sqlJsonbLiteral(value)},
       updated_by = 'native-brief-media-copy'
 where key = 'native_brief_media';`;
  }
  return [
    '-- NOT YET ELIGIBLE. projectBriefMedia() also requires recovery_contract,',
    '-- recovery_receipt_sha256 and coverage_receipt_sha256 on the flag value',
    "-- before it treats mode:\"required\" as active (supabase/functions/_shared/",
    '-- native-brief-media.mjs). Those are generated from a completed, zero-gap',
    "-- `apply` run's own out-map, not templated ahead of one — run `apply`",
    '-- until it reports refused=0, then re-run to print the real flip.',
  ].join('\n');
}

export function flagRollbackSql() {
  const value = { mode: 'off', contract: BRIEF_MEDIA_CONTRACT };
  return `update public.syncview_runtime_flags
   set value = ${sqlJsonbLiteral(value)},
       updated_by = 'native-brief-media-copy'
 where key = 'native_brief_media';`;
}

function sqlJsonbLiteral(value) {
  return `'${JSON.stringify(value).replace(/'/g, "''")}'::jsonb`;
}

function printFlagBlock(receipts) {
  console.log('');
  console.log('-- FLAG FLIP (informational only — never executed by this script):');
  console.log(flagFlipSql(receipts));
  console.log('');
  console.log('-- ROLLBACK (flag back to off):');
  console.log(flagRollbackSql());
}

/* ------------------------------------------------------------------ *
 * CLI
 * ------------------------------------------------------------------ */

const USAGE = `usage:
  native-brief-media-copy.mjs plan  <rows.json> <manifest.json>
  native-brief-media-copy.mjs apply --apply <manifest.json> <out-map.json>

Secrets from env only: LINEAR_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
NATIVE_BRIEF_MEDIA_COPY_CONFIRM=COPY_NATIVE_BRIEF_MEDIA (required for apply).`;

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const [cmd, ...rest] = process.argv.slice(2);
  try {
    if (cmd === 'plan' && rest.length === 2) {
      await cmdPlan(rest[0], rest[1]);
    } else if (cmd === 'apply') {
      const positional = rest.filter(a => a !== '--apply');
      if (positional.length !== 2) { console.error(USAGE); process.exit(2); }
      await cmdApply(positional[0], positional[1], rest, process.env);
    } else {
      console.error(USAGE);
      process.exit(2);
    }
  } catch (error) {
    console.error(String(error.message || error));
    process.exit(1);
  }
}
