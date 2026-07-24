'use strict';

/*
 * F34 source-only Linear archive asset rescue.
 *
 * Default mode is a read-only plan. --apply requires an explicit owner
 * confirmation, downloads only private uploads.linear.app URLs with the Linear
 * bearer, writes content-addressed bytes to the provisioned private Drive
 * folder, independently reads them back, then advances the private sidecar by
 * CAS. Output never contains an original URL, rescued URL, token, or row body.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { driveAccessToken } = require('./f27-private-snapshot-store.js');

const MAX_BYTES = 50 * 1024 * 1024;
const PAGE_SIZE = 500;
const UPLOAD_RE = /https:\/\/uploads[.]linear[.]app\/[^\s<>"')\]]+/gi;

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function argsFrom(argv) {
  const args = new Map();
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (!key.startsWith('--')) throw new Error('invalid argument');
    if (args.has(key)) throw new Error('duplicate argument');
    if (argv[i + 1] && !argv[i + 1].startsWith('--')) args.set(key, argv[++i]);
    else args.set(key, '1');
  }
  return args;
}

function urlsFromText(value) {
  // Preserve every source occurrence. Two references may intentionally carry
  // the same URL; their independent source locations still need independent
  // rescue/disposition evidence.
  return (String(value == null ? '' : value).match(UPLOAD_RE) || [])
    .map(url => url.replace(/[.,;]+$/, ''));
}

function collectUrls(value, pathParts = [], rows = []) {
  if (typeof value === 'string') {
    urlsFromText(value).forEach((url, index) => rows.push({
      url,
      location: [...pathParts, String(index)].join('.'),
    }));
  } else if (Array.isArray(value)) {
    value.forEach((item, index) => collectUrls(item, [...pathParts, String(index)], rows));
  } else if (value && typeof value === 'object') {
    Object.entries(value).forEach(([key, item]) => collectUrls(item, [...pathParts, key], rows));
  }
  return rows;
}

function deterministicRef(row) {
  const originalUrl = clean(row.original_url);
  const originalHash = sha256(originalUrl);
  const identity = [
    clean(row.linear_uuid), clean(row.source_kind), clean(row.location_key), originalHash,
  ].join('\0');
  return {
    ref_id: `f34:${sha256(identity).slice(0, 40)}`,
    linear_uuid: clean(row.linear_uuid),
    deliverable_id: clean(row.deliverable_id) || null,
    comment_id: clean(row.comment_id) || null,
    client_slug: clean(row.client_slug),
    team: clean(row.team).toLowerCase() || null,
    audience: clean(row.audience).toLowerCase() === 'client' ? 'client' : 'internal',
    source_kind: clean(row.source_kind),
    location_key: clean(row.location_key),
    original_url: originalUrl,
    original_url_sha256: originalHash,
    rescued_url: null,
    state: 'pending',
    media_type: null,
    last_error_code: null,
    reviewed_by: null,
    review_note: null,
  };
}

function discoverArchiveRefs(archives, comments, deliverables = []) {
  const refs = [];
  for (const deliverable of Array.isArray(deliverables) ? deliverables : []) {
    urlsFromText(deliverable.brief).forEach((url, index) => refs.push(deterministicRef({
      linear_uuid: deliverable.linear_issue_uuid,
      deliverable_id: deliverable.id,
      client_slug: deliverable.client_slug,
      team: deliverable.team,
      audience: 'internal',
      source_kind: 'operational_brief',
      location_key: `deliverable.${clean(deliverable.id)}.brief.${index}`,
      original_url: url,
    })));
  }
  for (const archive of Array.isArray(archives) ? archives : []) {
    const base = {
      linear_uuid: archive.linear_uuid,
      client_slug: archive.client_slug,
      team: archive.team,
      audience: 'internal',
    };
    // Scan the complete archived record so a top-level/future description
    // field cannot fall outside discovery. Identity fields simply produce no
    // candidates; deterministic de-duplication collapses raw/comment copies.
    collectUrls(archive, ['archive']).forEach(found => refs.push(deterministicRef({
      ...base,
      source_kind: found.location.toLowerCase().includes('description')
        ? 'issue_description'
        : 'archive_raw',
      location_key: found.location,
      original_url: found.url,
    })));
  }
  for (const comment of Array.isArray(comments) ? comments : []) {
    const base = {
      linear_uuid: comment.linear_issue_uuid,
      comment_id: comment.id,
      client_slug: comment.client_slug,
      team: comment.team,
      audience: comment.audience,
    };
    urlsFromText(comment.body).forEach((url, index) => refs.push(deterministicRef({
      ...base,
      source_kind: 'normalized_comment_body',
      location_key: `comment.${clean(comment.id)}.body.${index}`,
      original_url: url,
    })));
    collectUrls(comment.attachments, ['comment', clean(comment.id), 'attachments'])
      .forEach(found => refs.push(deterministicRef({
        ...base,
        source_kind: 'comment_attachment',
        location_key: found.location,
        original_url: found.url,
      })));
  }
  const byId = new Map();
  refs.forEach(ref => byId.set(ref.ref_id, ref));
  return [...byId.values()].sort((a, b) => a.ref_id.localeCompare(b.ref_id));
}

function inventoryOccurrence(ref) {
  return {
    ref_id: clean(ref.ref_id),
    linear_uuid_sha256: sha256(clean(ref.linear_uuid)),
    source_kind: clean(ref.source_kind),
    location_key_sha256: sha256(clean(ref.location_key)),
    original_url_sha256: clean(ref.original_url_sha256),
  };
}

function occurrenceIdentity(value) {
  return JSON.stringify({
    ref_id: clean(value.ref_id),
    linear_uuid_sha256: clean(value.linear_uuid_sha256),
    source_kind: clean(value.source_kind),
    location_key_sha256: clean(value.location_key_sha256),
    original_url_sha256: clean(value.original_url_sha256),
  });
}

function occurrenceInventorySha256(rows) {
  return sha256((Array.isArray(rows) ? rows : [])
    .map(occurrenceIdentity)
    .sort()
    .join('\n'));
}

function inventoryCertificationMaterial(payload, occurrences) {
  const source = payload && payload.source && typeof payload.source === 'object'
    ? payload.source
    : {};
  return JSON.stringify({
    contract: clean(payload && payload.contract),
    complete: payload && payload.complete === true,
    exported_at: clean(payload && payload.exported_at),
    source: {
      system: clean(source.system),
      export_id: clean(source.export_id),
      organization_sha256: clean(source.organization_sha256),
      generator: clean(source.generator),
      generated_at: clean(source.generated_at),
      artifact_sha256: clean(source.artifact_sha256),
    },
    occurrences: [...occurrences].sort((left, right) =>
      occurrenceIdentity(left).localeCompare(occurrenceIdentity(right))),
  });
}

function safeHexEqual(left, right) {
  const a = clean(left);
  const b = clean(right);
  return /^[a-f0-9]{64}$/.test(a)
    && /^[a-f0-9]{64}$/.test(b)
    && crypto.timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}

function publicPlan(refs, inventory = {}) {
  const rows = (Array.isArray(refs) ? refs : []).map(ref => ({
    ...inventoryOccurrence(ref),
    client_slug_sha256: sha256(clean(ref.client_slug)),
    team: clean(ref.team) || null,
    audience: clean(ref.audience),
    state: clean(ref.state) || 'pending',
  }));
  return {
    status: 'PLAN',
    source_only: true,
    scan_complete: inventory.scan_complete === true,
    completeness_reason: clean(inventory.reason) || null,
    final_inventory_count: Number(inventory.inventory_count || 0),
    inventory_evidence: inventory.supplied ? {
      file_sha256: clean(inventory.file_sha256) || null,
      source_artifact_sha256: clean(inventory.source_artifact_sha256) || null,
      source_export_id_sha256: clean(inventory.source_export_id_sha256) || null,
      certification_key_id: clean(inventory.certification_key_id) || null,
    } : null,
    ref_count: rows.length,
    reconciliation: {
      discovered: rows.length,
      rescued: 0,
      explicit_owner_disposition: 0,
      unresolved: rows.length,
      inventory_missing_from_syncview: Number(inventory.missing_from_syncview || 0),
      syncview_missing_from_inventory: Number(inventory.missing_from_inventory || 0),
      zero_gaps: inventory.scan_complete === true && rows.length === 0,
      identity_sha256: occurrenceInventorySha256(rows),
    },
    rows,
  };
}

function reconcileFinalInventory(filePath, refs, options = {}) {
  if (!clean(filePath)) {
    return {
      supplied: false,
      scan_complete: false,
      reason: 'final_linear_export_inventory_required',
      inventory_count: 0,
      missing_from_syncview: 0,
      missing_from_inventory: 0,
      identity_sha256: null,
    };
  }
  if (!path.isAbsolute(filePath)) throw new Error('final_inventory_absolute_path_required');
  const stat = fs.statSync(filePath);
  if (!stat.isFile() || stat.size < 2 || stat.size > 10 * 1024 * 1024) {
    throw new Error('final_inventory_invalid_file');
  }
  const fileBytes = fs.readFileSync(filePath);
  const fileSha256 = sha256(fileBytes);
  const pinnedFileSha256 = clean(options.pinnedFileSha256);
  const certificationKey = clean(options.certificationKey);
  const certificationKeyId = clean(options.certificationKeyId);
  if (!/^[a-f0-9]{64}$/.test(pinnedFileSha256)
      || !certificationKey
      || !/^[a-zA-Z0-9_.:-]{3,100}$/.test(certificationKeyId)) {
    throw new Error('final_inventory_certification_required');
  }
  if (!safeHexEqual(fileSha256, pinnedFileSha256)) {
    throw new Error('final_inventory_digest_mismatch');
  }
  const payload = JSON.parse(fileBytes.toString('utf8'));
  const occurrences = payload && Array.isArray(payload.occurrences) ? payload.occurrences : null;
  const source = payload && payload.source && typeof payload.source === 'object'
    && !Array.isArray(payload.source) ? payload.source : null;
  const certification = payload && payload.certification
    && typeof payload.certification === 'object'
    && !Array.isArray(payload.certification) ? payload.certification : null;
  const validOccurrence = value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const keys = Object.keys(value).sort();
    const expectedKeys = [
      'linear_uuid_sha256',
      'location_key_sha256',
      'original_url_sha256',
      'ref_id',
      'source_kind',
    ];
    return keys.length === expectedKeys.length
      && keys.every((key, index) => key === expectedKeys[index])
      && /^f34:[a-f0-9]{40}$/.test(clean(value.ref_id))
      && /^[a-f0-9]{64}$/.test(clean(value.linear_uuid_sha256))
      && /^[a-z0-9][a-z0-9_.:-]{0,79}$/.test(clean(value.source_kind))
      && /^[a-f0-9]{64}$/.test(clean(value.location_key_sha256))
      && /^[a-f0-9]{64}$/.test(clean(value.original_url_sha256));
  };
  if (!payload
      || payload.contract !== 'syncview_f34_final_linear_inventory_v3'
      || payload.complete !== true
      || !Number.isFinite(Date.parse(clean(payload.exported_at)))
      || !source
      || source.system !== 'linear'
      || source.generator !== 'syncview-independent-linear-export-v1'
      || !/^[a-zA-Z0-9_.:-]{3,200}$/.test(clean(source.export_id))
      || !/^[a-f0-9]{64}$/.test(clean(source.organization_sha256))
      || !Number.isFinite(Date.parse(clean(source.generated_at)))
      || !/^[a-f0-9]{64}$/.test(clean(source.artifact_sha256))
      || !certification
      || clean(certification.key_id) !== certificationKeyId
      || !/^[a-f0-9]{64}$/.test(clean(certification.hmac_sha256))
      || !occurrences
      || occurrences.length > 100_000
      || occurrences.some(value => !validOccurrence(value))) {
    throw new Error('final_inventory_contract_invalid');
  }
  const inventoryRows = occurrences.map(value => ({
    ref_id: clean(value.ref_id),
    linear_uuid_sha256: clean(value.linear_uuid_sha256),
    source_kind: clean(value.source_kind),
    location_key_sha256: clean(value.location_key_sha256),
    original_url_sha256: clean(value.original_url_sha256),
  }));
  const inventoryById = new Map();
  for (const row of inventoryRows) {
    if (inventoryById.has(row.ref_id)) throw new Error('final_inventory_duplicate_ref');
    inventoryById.set(row.ref_id, row);
  }
  const expectedHmac = crypto.createHmac('sha256', certificationKey)
    .update(inventoryCertificationMaterial(payload, inventoryRows))
    .digest('hex');
  if (!safeHexEqual(expectedHmac, certification.hmac_sha256)) {
    throw new Error('final_inventory_hmac_mismatch');
  }
  const syncviewRows = (refs || []).map(inventoryOccurrence);
  const syncviewById = new Map();
  for (const row of syncviewRows) {
    if (syncviewById.has(row.ref_id)) throw new Error('syncview_occurrence_duplicate_ref');
    syncviewById.set(row.ref_id, row);
  }
  const exactMatch = (left, right) => left && right
    && occurrenceIdentity(left) === occurrenceIdentity(right);
  const missingFromSyncview = inventoryRows.filter(row =>
    !exactMatch(row, syncviewById.get(row.ref_id)));
  const missingFromInventory = syncviewRows.filter(row =>
    !exactMatch(row, inventoryById.get(row.ref_id)));
  return {
    supplied: true,
    scan_complete: missingFromSyncview.length === 0 && missingFromInventory.length === 0,
    reason: missingFromSyncview.length || missingFromInventory.length
      ? 'final_linear_export_inventory_mismatch'
      : null,
    inventory_count: inventoryRows.length,
    missing_from_syncview: missingFromSyncview.length,
    missing_from_inventory: missingFromInventory.length,
    missing_from_syncview_occurrences: missingFromSyncview,
    missing_from_inventory_occurrences: missingFromInventory,
    identity_sha256: occurrenceInventorySha256(inventoryRows),
    file_sha256: fileSha256,
    source_artifact_sha256: clean(source.artifact_sha256),
    source_export_id_sha256: sha256(clean(source.export_id)),
    certification_key_id: certificationKeyId,
  };
}

// The runbook (docs/ops/F34_LINEAR_ASSET_RESCUE.md §Apply) requires a certified
// final Linear export inventory that reconciles exactly before any rescue
// mutates Drive or sidecar state: scan_complete true and both mismatch counts
// zero. A stale, mismatching, or absent inventory must fail closed BEFORE the
// Drive token is obtained and the mutation loop is entered — reporting GAPS
// only after partial uploads is too late.
function inventoryPermitsRescue(inventory) {
  const summary = inventory && typeof inventory === 'object' ? inventory : {};
  return summary.scan_complete === true
    && Number(summary.missing_from_syncview || 0) === 0
    && Number(summary.missing_from_inventory || 0) === 0;
}

async function responseJson(response, label) {
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload == null) throw new Error(`${label}_${response.status}`);
  return payload;
}

async function readBoundedBytes(response, maxBytes, errorPrefix) {
  const declared = Number(response.headers.get('content-length') || 0);
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new Error(`${errorPrefix}_too_large`);
  }
  if (!response.body || typeof response.body.getReader !== 'function') {
    throw new Error(`${errorPrefix}_body_missing`);
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || !value.byteLength) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new Error(`${errorPrefix}_too_large`);
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    try { reader.releaseLock(); } catch (_) {}
  }
  if (!total) throw new Error(`${errorPrefix}_empty`);
  return Buffer.concat(chunks, total);
}

async function restPages(baseUrl, serviceKey, table, select, filters = '') {
  const rows = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const response = await fetch(
      `${baseUrl}/rest/v1/${table}?select=${encodeURIComponent(select)}&limit=${PAGE_SIZE}&offset=${offset}${filters}`,
      {
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
          Accept: 'application/json',
        },
        redirect: 'error',
      },
    );
    const page = await responseJson(response, `read_${table}`);
    if (!Array.isArray(page)) throw new Error(`invalid_${table}_page`);
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return rows;
}

async function loadDiscoveryRows(config) {
  const filter = config.clientSlug
    ? `&client_slug=eq.${encodeURIComponent(config.clientSlug)}`
    : '';
  const [archives, comments, deliverables] = await Promise.all([
    restPages(config.supabaseUrl, config.serviceKey, 'linear_archive',
      '*', filter),
    restPages(config.supabaseUrl, config.serviceKey, 'production_comments',
      'id,linear_issue_uuid,client_slug,team,audience,body,attachments', filter),
    restPages(config.supabaseUrl, config.serviceKey, 'deliverables',
      'id,linear_issue_uuid,client_slug,team,brief', filter),
  ]);
  return { archives, comments, deliverables };
}

async function rpc(config, name, body) {
  const response = await fetch(`${config.supabaseUrl}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: config.serviceKey,
      Authorization: `Bearer ${config.serviceKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/vnd.pgrst.object+json',
    },
    body: JSON.stringify(body),
    redirect: 'error',
  });
  return responseJson(response, name);
}

function approvedLinearRedirect(value) {
  let url;
  try { url = new URL(clean(value)); } catch (_) { return false; }
  const host = clean(url.hostname).toLowerCase().replace(/\.$/, '');
  return url.protocol === 'https:'
    && !url.username
    && !url.password
    && (host === 'uploads.linear.app'
      || host === 'storage.googleapis.com'
      || /^[a-z0-9.-]+[.]s3(?:[.-][a-z0-9-]+)?[.]amazonaws[.]com$/.test(host));
}

async function linearDownload(config, ref) {
  let current = ref.original_url;
  let response;
  let activeTimer = null;
  for (let redirect = 0; redirect <= 3; redirect++) {
    if (!approvedLinearRedirect(current)) throw new Error('linear_redirect_rejected');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const host = new URL(current).hostname.toLowerCase();
      response = await fetch(current, {
        headers: {
          ...(host === 'uploads.linear.app' ? { Authorization: config.linearKey } : {}),
          Accept: '*/*',
        },
        redirect: 'manual',
        signal: controller.signal,
      });
    } catch (error) {
      clearTimeout(timer);
      throw error;
    }
    if (response.status < 300 || response.status >= 400) {
      activeTimer = timer;
      break;
    }
    clearTimeout(timer);
    if (response.body && typeof response.body.cancel === 'function') {
      await response.body.cancel().catch(() => {});
    }
    const location = clean(response.headers.get('location'));
    if (!location || redirect === 3) throw new Error('linear_redirect_incomplete');
    current = new URL(location, current).toString();
  }
  try {
    if (!response || !response.ok) {
      throw new Error(`linear_download_${response ? response.status : 'missing'}`);
    }
    const bytes = await readBoundedBytes(response, MAX_BYTES, 'linear_download');
    return {
      bytes,
      mediaType: clean(response.headers.get('content-type')) || 'application/octet-stream',
    };
  } finally {
    if (activeTimer) clearTimeout(activeTimer);
  }
}

async function driveList(token, folderId, name) {
  const escaped = name.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const params = new URLSearchParams({
    q: `'${folderId}' in parents and name = '${escaped}' and trashed = false`,
    fields: 'files(id,name,size,md5Checksum)',
    supportsAllDrives: 'true',
    includeItemsFromAllDrives: 'true',
    corpora: 'allDrives',
    pageSize: '10',
  });
  const response = await fetch(`https://www.googleapis.com/drive/v3/files?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
    redirect: 'error',
  });
  const payload = await responseJson(response, 'drive_list');
  return Array.isArray(payload.files) ? payload.files : [];
}

async function driveUpload(token, folderId, name, mediaType, bytes) {
  const boundary = `f34_${crypto.randomBytes(12).toString('hex')}`;
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name, parents: [folderId] })}`),
    Buffer.from(`\r\n--${boundary}\r\nContent-Type: ${mediaType}\r\n\r\n`),
    bytes,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const response = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,name,size,md5Checksum',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body,
      redirect: 'error',
    },
  );
  return responseJson(response, 'drive_upload');
}

async function driveReadback(token, fileId) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`,
      {
        headers: { Authorization: `Bearer ${token}` },
        redirect: 'error',
        signal: controller.signal,
      },
    );
    if (!response.ok) throw new Error(`drive_readback_${response.status}`);
    return await readBoundedBytes(response, MAX_BYTES, 'drive_readback');
  } finally {
    clearTimeout(timer);
  }
}

function safeExtension(mediaType) {
  const subtype = clean(mediaType).split(';')[0].split('/')[1] || 'bin';
  return /^[a-z0-9.+-]{1,16}$/i.test(subtype) ? subtype.replace(/[^a-z0-9]+/gi, '-') : 'bin';
}

async function rescueOne(config, driveToken, ref, existing) {
  let cursor = existing || null;
  try {
    cursor = cursor || await rpc(config, 'linear_archive_asset_ref_write', {
      p_ref: ref,
      p_expected_updated_at: null,
      p_rescue_capability: null,
    });
    if (clean(cursor.state) === 'rescued' || clean(cursor.state) === 'owner_dispositioned') {
      return {
        ref_id: ref.ref_id,
        original_url_sha256: ref.original_url_sha256,
        state: clean(cursor.state),
        skipped_terminal: true,
      };
    }
    const downloaded = await linearDownload(config, ref);
    const contentHash = sha256(downloaded.bytes);
    const name = `linear-asset-${contentHash}.${safeExtension(downloaded.mediaType)}`;
    let matches = await driveList(driveToken, config.folderId, name);
    if (matches.length > 1) throw new Error('drive_name_collision');
    let file = matches[0];
    if (!file) file = await driveUpload(
      driveToken, config.folderId, name, downloaded.mediaType, downloaded.bytes,
    );
    const readback = await driveReadback(driveToken, clean(file.id));
    if (readback.length !== downloaded.bytes.length || sha256(readback) !== contentHash) {
      throw new Error('drive_readback_mismatch');
    }
    matches = await driveList(driveToken, config.folderId, name);
    if (matches.length !== 1 || clean(matches[0].id) !== clean(file.id)) {
      throw new Error('drive_publication_collision');
    }
    const verifiedAt = new Date().toISOString();
    const receiptMaterial = [
      ref.ref_id,
      ref.original_url_sha256,
      config.folderId,
      clean(file.id),
      contentHash,
      String(downloaded.bytes.length),
      verifiedAt,
    ].join('\x1f');
    const receiptHmac = crypto.createHmac('sha256', config.rescueCapability)
      .update(receiptMaterial)
      .digest('hex');
    cursor = await rpc(config, 'linear_archive_asset_ref_write', {
      p_ref: {
        ...ref,
        state: 'rescued',
        destination_provider: 'google_drive_private',
        destination_folder_id: config.folderId,
        destination_file_id: clean(file.id),
        content_sha256: contentHash,
        byte_length: downloaded.bytes.length,
        verified_at: verifiedAt,
        verification_receipt_hmac: receiptHmac,
        media_type: downloaded.mediaType,
        reviewed_by: 'f34-linear-asset-rescue',
        review_note: `sha256:${contentHash}`,
      },
      p_expected_updated_at: cursor.updated_at,
      p_rescue_capability: config.rescueCapability,
    });
    return {
      ref_id: ref.ref_id,
      original_url_sha256: ref.original_url_sha256,
      content_sha256: contentHash,
      byte_length: downloaded.bytes.length,
      state: clean(cursor.state),
      independent_private_readback: 'PASS',
    };
  } catch (error) {
    const errorCode = clean(error && error.message).replace(/[^a-z0-9_.:-]+/gi, '_').slice(0, 120)
      || 'rescue_failed';
    try {
      if (!cursor || !clean(cursor.updated_at)) throw new Error('no_sidecar_cursor');
      cursor = await rpc(config, 'linear_archive_asset_ref_write', {
        p_ref: {
          ...ref,
          state: 'failed',
          last_error_code: errorCode,
        },
        p_expected_updated_at: cursor.updated_at,
        p_rescue_capability: null,
      });
    } catch (_) {
      // Keep the original safe failure code; the final reconciliation read
      // will still count this reference as unresolved.
    }
    return {
      ref_id: ref.ref_id,
      original_url_sha256: ref.original_url_sha256,
      state: 'failed',
      error_code: errorCode,
    };
  }
}

async function loadExistingRefs(config) {
  const filter = config.clientSlug
    ? `&client_slug=eq.${encodeURIComponent(config.clientSlug)}`
    : '';
  return restPages(config.supabaseUrl, config.serviceKey, 'linear_archive_asset_refs',
    [
      'ref_id', 'linear_uuid', 'original_url_sha256', 'state', 'updated_at',
      'rescued_url', 'review_note', 'destination_provider',
      'destination_folder_id', 'destination_file_id', 'content_sha256',
      'byte_length', 'verified_at', 'verification_receipt_hmac',
    ].join(','), filter);
}

async function verifyRescued(config, driveToken, refs) {
  const receipts = [];
  for (const ref of refs.filter(row => clean(row.state) === 'rescued')) {
    const match = clean(ref.rescued_url).match(/^https:\/\/drive[.]google[.]com\/file\/d\/([A-Za-z0-9_-]+)\/view$/);
    const expected = clean(ref.content_sha256);
    const byteLength = Number(ref.byte_length);
    const verifiedAt = clean(ref.verified_at);
    const receiptMaterial = [
      clean(ref.ref_id),
      clean(ref.original_url_sha256),
      clean(ref.destination_folder_id),
      clean(ref.destination_file_id),
      expected,
      String(byteLength),
      verifiedAt,
    ].join('\x1f');
    const expectedReceipt = crypto.createHmac('sha256', config.rescueCapability)
      .update(receiptMaterial)
      .digest('hex');
    if (!match
        || clean(ref.destination_provider) !== 'google_drive_private'
        || clean(ref.destination_folder_id) !== config.folderId
        || clean(ref.destination_file_id) !== match[1]
        || !/^[a-f0-9]{64}$/.test(expected)
        || clean(ref.review_note) !== `sha256:${expected}`
        || !Number.isInteger(byteLength)
        || byteLength < 1
        || byteLength > MAX_BYTES
        || !Number.isFinite(Date.parse(verifiedAt))
        || clean(ref.verification_receipt_hmac) !== expectedReceipt) {
      receipts.push({ ref_id: ref.ref_id, state: 'failed', error_code: 'readback_identity_invalid' });
      continue;
    }
    try {
      const bytes = await driveReadback(driveToken, match[1]);
      const actual = sha256(bytes);
      receipts.push({
        ref_id: ref.ref_id,
        state: actual === expected && bytes.length === byteLength ? 'verified' : 'failed',
        content_sha256: actual,
        byte_length: bytes.length,
      });
    } catch (_) {
      receipts.push({ ref_id: ref.ref_id, state: 'failed', error_code: 'readback_failed' });
    }
  }
  return receipts;
}

function loadOwnerDispositionPlan(filePath, refs) {
  if (!path.isAbsolute(clean(filePath))) throw new Error('owner_disposition_absolute_path_required');
  const stat = fs.statSync(filePath);
  if (!stat.isFile() || stat.size < 2 || stat.size > 5 * 1024 * 1024) {
    throw new Error('owner_disposition_invalid_file');
  }
  const payload = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const rows = payload && Array.isArray(payload.dispositions) ? payload.dispositions : null;
  if (!payload
      || payload.contract !== 'syncview_f34_owner_dispositions_v1'
      || payload.complete !== true
      || !rows
      || rows.length > 100_000) {
    throw new Error('owner_disposition_contract_invalid');
  }
  const discovered = new Map((refs || []).map(ref => [clean(ref.ref_id), ref]));
  const seen = new Set();
  return rows.map(row => {
    const refId = clean(row && row.ref_id);
    const ref = discovered.get(refId);
    const confirmedBy = clean(row && row.confirmed_by);
    const confirmedAt = clean(row && row.confirmed_at);
    const decision = clean(row && row.decision);
    const reviewNote = clean(row && row.review_note);
    if (!ref
        || seen.has(refId)
        || clean(row && row.original_url_sha256) !== clean(ref.original_url_sha256)
        || !confirmedBy
        || confirmedBy.length > 200
        || !Number.isFinite(Date.parse(confirmedAt))
        || !/^[a-z][a-z0-9_.:-]{2,79}$/.test(decision)
        || !reviewNote
        || reviewNote.length > 2_000) {
      throw new Error('owner_disposition_contract_invalid');
    }
    seen.add(refId);
    return {
      ref,
      reviewed_by: confirmedBy,
      review_note: reviewNote,
      owner_evidence: {
        confirmed_by: confirmedBy,
        confirmed_at: new Date(Date.parse(confirmedAt)).toISOString(),
        decision,
        plan_sha256: sha256(fs.readFileSync(filePath)),
      },
    };
  });
}

async function applyOwnerDispositions(config, plan, existingRefs) {
  const existingById = new Map((existingRefs || []).map(ref => [clean(ref.ref_id), ref]));
  const receipts = [];
  for (const item of plan) {
    const existing = existingById.get(item.ref.ref_id);
    try {
      const result = await rpc(config, 'linear_archive_asset_ref_write', {
        p_ref: {
          ...item.ref,
          state: 'owner_dispositioned',
          reviewed_by: item.reviewed_by,
          review_note: item.review_note,
          owner_evidence: item.owner_evidence,
        },
        p_expected_updated_at: existing ? existing.updated_at : null,
        p_rescue_capability: config.rescueCapability,
      });
      receipts.push({
        ref_id: item.ref.ref_id,
        original_url_sha256: item.ref.original_url_sha256,
        state: clean(result.state),
      });
    } catch (error) {
      receipts.push({
        ref_id: item.ref.ref_id,
        original_url_sha256: item.ref.original_url_sha256,
        state: 'failed',
        error_code: clean(error && error.message).replace(/[^a-z0-9_.:-]+/gi, '_').slice(0, 120)
          || 'owner_disposition_failed',
      });
    }
  }
  return receipts;
}

function reconciliation(refs, discovered, inventory = {}) {
  const states = new Map((refs || []).map(ref => [clean(ref.ref_id), clean(ref.state)]));
  const relevant = discovered.map(ref => ({ ref, state: states.get(ref.ref_id) || 'pending' }));
  const rescued = relevant.filter(row => row.state === 'rescued').length;
  const dispositioned = relevant.filter(row => row.state === 'owner_dispositioned').length;
  const unresolved = relevant.length - rescued - dispositioned;
  return {
    scan_complete: inventory.scan_complete === true,
    completeness_reason: clean(inventory.reason) || null,
    final_inventory_count: Number(inventory.inventory_count || 0),
    inventory_missing_from_syncview: Number(inventory.missing_from_syncview || 0),
    syncview_missing_from_inventory: Number(inventory.missing_from_inventory || 0),
    discovered: relevant.length,
    rescued,
    explicit_owner_disposition: dispositioned,
    unresolved,
    zero_gaps: inventory.scan_complete === true && unresolved === 0,
    identity_sha256: occurrenceInventorySha256(discovered.map(inventoryOccurrence)),
  };
}

function rescuedVerificationStatus(summary, expectedRefs, receipts) {
  const expectedIds = (Array.isArray(expectedRefs) ? expectedRefs : [])
    .filter(row => clean(row && row.state) === 'rescued')
    .map(row => clean(row.ref_id))
    .filter(Boolean)
    .sort();
  const receiptRows = Array.isArray(receipts) ? receipts : [];
  const receiptIds = receiptRows.map(row => clean(row && row.ref_id)).filter(Boolean).sort();
  const exactSet = expectedIds.length > 0
    && expectedIds.length === receiptRows.length
    && receiptIds.length === receiptRows.length
    && new Set(receiptIds).size === receiptIds.length
    && expectedIds.every((refId, index) => refId === receiptIds[index]);
  return summary && summary.zero_gaps === true
    && exactSet
    && receiptRows.every(row => clean(row && row.state) === 'verified')
    ? 'VERIFIED'
    : 'GAPS';
}

async function run(argv = process.argv.slice(2), env = process.env) {
  const args = argsFrom(argv);
  const config = {
    supabaseUrl: clean(env.SUPABASE_URL),
    serviceKey: clean(env.SUPABASE_SERVICE_ROLE_KEY),
    linearKey: clean(env.LINEAR_API_KEY || env.LINEAR_API_TOKEN),
    folderId: clean(env.TRACK_B_BACKUP_DRIVE_FOLDER_ID),
    driveCredentials: clean(env.TRACK_B_BACKUP_GOOGLE_CREDENTIALS_JSON),
    rescueCapability: clean(env.F34_RESCUE_CAPABILITY),
    inventoryCertificationKey: clean(env.F34_INVENTORY_HMAC_KEY),
    inventoryCertificationKeyId: clean(env.F34_INVENTORY_KEY_ID),
    inventoryPinnedSha256: clean(
      args.get('--final-inventory-sha256') || env.F34_FINAL_INVENTORY_SHA256,
    ),
    clientSlug: clean(args.get('--client')),
  };
  if (!config.supabaseUrl || !config.serviceKey) throw new Error('supabase_configuration_required');
  const discovered = await loadDiscoveryRows(config);
  const refs = discoverArchiveRefs(
    discovered.archives,
    discovered.comments,
    discovered.deliverables,
  );
  const inventory = reconcileFinalInventory(args.get('--final-inventory'), refs, {
    pinnedFileSha256: config.inventoryPinnedSha256,
    certificationKey: config.inventoryCertificationKey,
    certificationKeyId: config.inventoryCertificationKeyId,
  });
  if (args.has('--verify-rescued')) {
    if (args.has('--apply') || args.has('--apply-owner-dispositions')) {
      throw new Error('conflicting_mode');
    }
    if (clean(env.F34_CONFIRM_LINEAR_ASSET_READBACK) !== 'VERIFY_PRIVATE_LINEAR_ASSETS') {
      throw new Error('readback_confirmation_required');
    }
    if (!config.driveCredentials || !config.folderId || !config.rescueCapability) {
      throw new Error('private_readback_configuration_required');
    }
    const driveToken = await driveAccessToken(config.driveCredentials, fetch);
    const existing = await loadExistingRefs(config);
    const readback = await verifyRescued(config, driveToken, existing);
    const summary = reconciliation(existing, refs, inventory);
    return {
      status: rescuedVerificationStatus(summary, existing, readback),
      source_only: true,
      readback_count: readback.length,
      readback,
      reconciliation: summary,
    };
  }
  if (args.has('--apply-owner-dispositions')) {
    if (args.has('--apply')) throw new Error('conflicting_mode');
    if (clean(env.F34_CONFIRM_OWNER_DISPOSITION)
        !== 'DISPOSITION_UNRECOVERABLE_LINEAR_ASSETS') {
      throw new Error('owner_disposition_confirmation_required');
    }
    if (!config.rescueCapability) throw new Error('owner_disposition_capability_required');
    const plan = loadOwnerDispositionPlan(args.get('--apply-owner-dispositions'), refs);
    const before = await loadExistingRefs(config);
    const receipts = await applyOwnerDispositions(config, plan, before);
    const after = await loadExistingRefs(config);
    const summary = reconciliation(after, refs, inventory);
    return {
      status: summary.zero_gaps
        && receipts.every(row => row.state === 'owner_dispositioned')
        ? 'DISPOSITIONED'
        : 'GAPS',
      source_only: true,
      attempted_count: receipts.length,
      receipts,
      reconciliation: summary,
    };
  }
  if (!args.has('--apply')) return publicPlan(refs, inventory);
  if (clean(env.F34_CONFIRM_LINEAR_ASSET_RESCUE) !== 'RESCUE_PRIVATE_LINEAR_ASSETS') {
    throw new Error('owner_confirmation_required');
  }
  if (!config.linearKey || !config.folderId || !config.driveCredentials
      || !config.rescueCapability) {
    throw new Error('private_rescue_configuration_required');
  }
  // Gate the entire rescue on an exactly-reconciled certified inventory before
  // touching Drive or the sidecar. A stale/mismatching/absent inventory fails
  // closed here instead of after partial uploads.
  if (!inventoryPermitsRescue(inventory)) {
    throw new Error('final_inventory_reconciliation_incomplete');
  }
  const driveToken = await driveAccessToken(config.driveCredentials, fetch);
  const before = await loadExistingRefs(config);
  const existingById = new Map(before.map(ref => [clean(ref.ref_id), ref]));
  const receipts = [];
  for (const ref of refs) {
    receipts.push(await rescueOne(config, driveToken, ref, existingById.get(ref.ref_id)));
  }
  const after = await loadExistingRefs(config);
  const summary = reconciliation(after, refs, inventory);
  return {
    status: summary.zero_gaps ? 'APPLIED' : 'GAPS',
    attempted_count: receipts.length,
    rescued_this_run: receipts.filter(row => row.state === 'rescued' && !row.skipped_terminal).length,
    receipts,
    reconciliation: summary,
  };
}

if (require.main === module) {
  run().then(result => {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }).catch(error => {
    process.stderr.write(`${JSON.stringify({
      status: 'FAIL',
      code: clean(error && error.message) || 'unexpected_failure',
    })}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  collectUrls,
  argsFrom,
  approvedLinearRedirect,
  deterministicRef,
  discoverArchiveRefs,
  inventoryCertificationMaterial,
  inventoryOccurrence,
  inventoryPermitsRescue,
  loadOwnerDispositionPlan,
  publicPlan,
  readBoundedBytes,
  reconcileFinalInventory,
  reconciliation,
  rescuedVerificationStatus,
  run,
  urlsFromText,
};
