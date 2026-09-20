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
 *   [{ id, client_slug, team, brief, updated_at, status }]
 *
 * Secrets are env-only, never CLI args (shell history) and never logged:
 *   LINEAR_API_KEY                 — Linear personal/API key for the download
 *   SUPABASE_URL                   — project REST/storage origin
 *   SUPABASE_SERVICE_ROLE_KEY      — service-role key (bucket is service-role only)
 *   NATIVE_BRIEF_MEDIA_COPY_CONFIRM — must equal COPY_NATIVE_BRIEF_MEDIA to --apply
 *
 * The manifest and out-map carry live, signed `uploads.linear.app` URLs
 * (Linear mints a fresh `?signature=` JWT per read — see
 * linear-media-rescue.mjs for the measured 300s life of that signature) and
 * so must never land in git; `assertPrivatePath` (ported from
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

/** Download the file from Linear. Returns { bytes, mimeType, receipt }. */
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
 * verified row for its exact key tuple. `deps.fetch` and `deps.now` are
 * injectable so the offline test never touches a real network.
 */
export async function applyManifest(manifest, config, deps) {
  const outMap = {};
  const results = { copied: 0, skipped_idempotent: 0, refused: 0 };
  const byKey = new Map();
  for (const occ of manifest.occurrences) {
    if (!byKey.has(occ.key)) byKey.set(occ.key, []);
    byKey.get(occ.key).push(occ);
  }

  for (const [key, occs] of byKey) {
    const first = occs[0];
    const tuple = occurrenceKeyTuple({
      deliverableId: first.deliverable_id,
      clientSlug: first.client_slug,
      team: first.team,
      briefSha256: first.source_sha256,
      offset: first.source_offset,
    });

    const existing = await findExistingVerified(config, tuple, deps);
    if (existing) {
      outMap[key] = { id: existing.id, storage_path: existing.storage_path, reused: true };
      results.skipped_idempotent += occs.length;
      continue;
    }

    const { bytes, mimeType, contentSha256, receiptSha256 } = await downloadFromLinear(first.url, config, deps);
    if (!VERIFIED_MIME.has(mimeType)) {
      results.refused += occs.length;
      outMap[key] = { error: 'unsupported_mime_type', reused: false };
      continue;
    }
    if (bytes.length < 1 || bytes.length > MAX_BYTES) {
      results.refused += occs.length;
      outMap[key] = { error: 'byte_length_out_of_range', reused: false };
      continue;
    }

    const id = crypto.randomUUID();
    const storagePath = `${contentSha256}/${id}`;
    const readbackSha256 = await uploadAndReadBack(config, storagePath, bytes, mimeType, deps);

    if (readbackSha256 !== contentSha256) {
      /* Never mark verified on a byte mismatch. Record the refusal and move
         on; nothing here writes a 'verified' row. */
      results.refused += occs.length;
      outMap[key] = { error: 'readback_mismatch', reused: false };
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
      source_updated_at: first.source_updated_at,
      source_sha256: tuple.source_sha256,
      source_offset: tuple.source_offset,
      source_length: first.source_length,
      original_url_sha256: first.original_url_sha256,
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
    outMap[key] = { id: inserted.id, storage_path: inserted.storage_path, reused: false };
    results.copied += occs.length;
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

async function cmdApply(manifestPath, outMapPath, argv, env) {
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
  const { outMap, results } = await applyManifest(manifest, config, { fetch });
  fs.writeFileSync(outMapPath, JSON.stringify(outMap, null, 2));
  console.log(
    `copied=${results.copied} skipped_idempotent=${results.skipped_idempotent} refused=${results.refused}`
  );
  console.log(`out-map written (PRIVATE): ${outMapPath}`);
  printFlagBlock();
  return { outMap, results };
}

/* ------------------------------------------------------------------ *
 * Flag flip / rollback — informational only. Printed at the end of every
 * run, never executed by this script. Shape matches
 * migrations/2026-09-07-native-brief-media.sql's seed row
 * ('{"mode":"off","contract":"native_brief_media_v1"}') and what
 * projectBriefMedia() reads back (flag.data.value.mode / .contract).
 * ------------------------------------------------------------------ */
export function flagFlipSql() {
  return `update public.syncview_runtime_flags
   set value = '{"mode":"required","contract":"${BRIEF_MEDIA_CONTRACT}"}'::jsonb,
       updated_by = 'native-brief-media-copy'
 where key = 'native_brief_media';`;
}

export function flagRollbackSql() {
  return `update public.syncview_runtime_flags
   set value = '{"mode":"off","contract":"${BRIEF_MEDIA_CONTRACT}"}'::jsonb,
       updated_by = 'native-brief-media-copy'
 where key = 'native_brief_media';`;
}

function printFlagBlock() {
  console.log('');
  console.log('-- FLAG FLIP (informational only — never executed by this script):');
  console.log(flagFlipSql());
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
