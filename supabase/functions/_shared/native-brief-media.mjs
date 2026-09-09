// Dormant staff-only render projection. Caller MUST authenticate the exact current
// deliverable/client/team before invoking. Never writes a brief or fetches Linear.
export const BRIEF_MEDIA_BUCKET = 'syncview-native-brief-media';
export const BRIEF_MEDIA_CONTRACT = 'native_brief_media_v1';
export const briefMediaHash = async value => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',
  typeof value === 'string' ? new TextEncoder().encode(value) : value))).map(x => x.toString(16).padStart(2, '0')).join('');
export function briefMediaOccurrences(brief) {
  // Exact UTF-16 source offsets, including repeated occurrences. No URL-wide
  // replace, URL normalization, decoding, or inference from archived descriptions.
  return [...String(brief || '').matchAll(/<(https?:\/\/uploads\.linear\.app\/[^<>]+)>|(https?:\/\/uploads\.linear\.app\/[^\s<>"'\])]+)/gi)]
    .map(m => { const url = m[1] || m[2]; return { offset: m.index + (m[1] ? 1 : 0), length: url.length, url }; });
}
const hash = x => typeof x === 'string' && /^[a-f0-9]{64}$/.test(x);
const downloads = { 'application/pdf': 'original.pdf', 'image/svg+xml': 'original.svg', 'video/mp4': 'original.mp4', 'video/quicktime': 'original.mov' };
const mime = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', ...Object.keys(downloads)]);
const DEFERRED_TEXT = 'This older file has not been restored here yet.';
export async function signNativeMedia(db, storagePath, storageOrigin, download=null) {
  const signed=await db.storage.from(BRIEF_MEDIA_BUCKET).createSignedUrl(storagePath,300,download?{download}:undefined);
  if (signed.error || typeof signed.data?.signedUrl!=='string') throw Error('media_signing_failed');
  const url=new URL(signed.data.signedUrl);
  if (url.protocol!=='https:' || url.origin!==new URL(storageOrigin).origin || url.username || url.password || url.hash
    || url.pathname !== '/storage/v1/object/sign/'+BRIEF_MEDIA_BUCKET+'/'+storagePath
    || (download && url.searchParams.get('download')!==download)) throw Error('media_signing_scope_failed');
  return url.href;
}
export async function projectBriefMedia(db, row, storageOrigin, now = Date.now()) {
  const brief = typeof row.brief === 'string' ? row.brief : '';
  const refs = briefMediaOccurrences(brief);
  const digest = await briefMediaHash(brief);
  const result = { contract: BRIEF_MEDIA_CONTRACT, mode: 'required', complete: false,
    coverage_scope: 'current_native_brief_uploads_linear_app',
    id: row.id, client_slug: row.client_slug, team: row.team, source_updated_at: row.updated_at,
    brief_sha256: digest, occurrences: refs.length, unresolved: refs.length,
    render_brief: null, expires_at: null, deferred: 0, reason: 'media_unavailable' };
  try {
    const flag = await db.from('syncview_runtime_flags').select('value').eq('key', 'native_brief_media').maybeSingle();
    if (flag.error || !flag.data || !['off', 'required'].includes(flag.data.value?.mode)
        || flag.data.value?.contract !== BRIEF_MEDIA_CONTRACT) return result;
    if (flag.data.value.mode === 'off') return { ...result, mode: 'off', reason: 'not_enabled' };
    if (flag.data.value.recovery_contract !== 'native_brief_media_recovery_v1'
        || !hash(flag.data.value.recovery_receipt_sha256) || !hash(flag.data.value.coverage_receipt_sha256)) return result;
    const deferred = flag.data.value.owner_deferred_references ?? [];
    if (!Array.isArray(deferred) || deferred.length > 20) return result;
    if (!refs.length) return { ...result, complete: true, unresolved: 0, render_brief: brief, reason: null };
    if (refs.length > 200 || !row.updated_at || !row.id || !row.client_slug || !row.team
        || row.deleted_at || row.tombstoned_at || row.is_deleted === true) return result;
    const read = await db.from('native_brief_media_occurrences').select('*')
      .eq('deliverable_id', row.id).eq('client_slug', row.client_slug).eq('team', row.team)
      .eq('source_kind', 'native_brief').eq('source_entity_id', row.id)
      .eq('state', 'verified').limit(1001);
    if (read.error || !Array.isArray(read.data) || read.data.length > 1000
        || new Set(read.data.map(copy => copy.id)).size !== read.data.length) return result;
    const mapped = [];
    for (const ref of refs) {
      // A text edit/reorder is not a new image. Reuse only previously verified
      // copies of this exact original URL within the same source entity/scope,
      // and only when ALL matching copies agree on byte identity. Original
      // capture digest/offset/timestamp remain immutable provenance; replacements
      // below use the newly scanned current offsets and response digest.
      const originalHash = await briefMediaHash(ref.url);
      const disposition = deferred.filter(x => x && x.id === row.id && x.client_slug === row.client_slug
        && x.team === row.team && x.original_url_sha256 === originalHash);
      if (disposition.length) {
        if (disposition.length !== 1) return result;
        const d = disposition[0];
        if (d.contract !== 'native_brief_owner_deferred_v1' || d.source_status !== 'posted'
            || String(row.status || '').trim().toLowerCase() !== d.source_status
            || !hash(d.content_sha256) || !hash(d.owner_receipt_sha256)
            || !Number.isSafeInteger(d.byte_length) || d.byte_length <= 52428800) return result;
        mapped.push({ ref, deferred: d });
        continue;
      }
      const matches = read.data.filter(x => x.original_url_sha256 === originalHash);
      if (!matches.length || new Set(matches.map(x => [x.content_sha256, x.byte_length, x.mime_type].join('|'))).size !== 1) return result;
      for (const copy of matches) {
      if (copy.state !== 'verified' || copy.audience !== 'staff'
          || !/^[a-f0-9-]{36}$/.test(copy.id) || copy.deliverable_id !== row.id || copy.client_slug !== row.client_slug
          || copy.source_kind !== 'native_brief' || copy.source_entity_id !== row.id
          || copy.team !== row.team || !hash(copy.source_sha256)
          || !Number.isSafeInteger(copy.source_offset) || copy.source_offset < 0 || copy.source_length !== ref.length
          || !Number.isFinite(Date.parse(copy.source_updated_at))
          || !hash(copy.content_sha256) || copy.readback_sha256 !== copy.content_sha256
          || !mime.has(copy.mime_type) || !Number.isSafeInteger(copy.byte_length) || copy.byte_length < 1
          || copy.byte_length > 52428800 || !Number.isFinite(Date.parse(copy.verified_at))
          || Date.parse(copy.verified_at) > now
          || copy.storage_path !== copy.content_sha256 + '/' + copy.id) return result;
      }
      const exact = matches.filter(copy => copy.source_sha256 === digest && copy.source_offset === ref.offset);
      if (exact.length > 1) return result;
      mapped.push({ ref, copy: exact[0] || [...matches].sort((a, b) => a.id.localeCompare(b.id))[0] });
    }
    const replacements = [];
    for (const { ref, copy, deferred: disposition } of mapped) {
      if (disposition) {
        replacements.push({ ...ref, original_url: ref.url, content_sha256: disposition.content_sha256,
          display: 'deferred', url: null });
        continue;
      }
      const download = downloads[copy.mime_type] || null;
      const url = await signNativeMedia(db, copy.storage_path, storageOrigin, download);
      replacements.push({ ...ref, original_url: ref.url, content_sha256: copy.content_sha256, url,
        display: download ? 'download' : 'inline', mime_type: copy.mime_type });
    }
    // A row may move or change while URLs are signed. Never label that stale
    // projection current; canonical text remains governed by its original read.
    const current = await db.from('deliverables').select('*')
      .eq('id', row.id).eq('client_slug', row.client_slug).maybeSingle();
    if (current.error || !current.data || current.data.team !== row.team
        || current.data.updated_at !== row.updated_at || current.data.brief !== brief || current.data.status !== row.status
        || current.data.deleted_at || current.data.tombstoned_at || current.data.is_deleted === true) return result;
    let rendered = brief;
    for (const ref of [...replacements].reverse()) {
      let offset = ref.offset, length = ref.length, value = ref.display === 'deferred' ? DEFERRED_TEXT : ref.url;
      if (ref.display === 'download' || ref.display === 'deferred') {
        // Match the same simple/angle image syntax accepted by the description
        // renderer. Remove only its image marker, keeping the label and source
        // text in the canonical brief. Never put PDF/SVG into an image element.
        const before = brief.slice(0, offset), image = /!\[([^\]\n]*)\]\((<?)$/.exec(before);
        if (image) {
          const close = image[2] ? '>)' : ')';
          if (!brief.slice(offset + length).startsWith(close)) return result;
          offset = image.index; length = ref.offset + ref.length + close.length - offset;
          value = ref.display === 'deferred' ? image[1] + ' — ' + DEFERRED_TEXT
            : '[Download original ' + downloads[ref.mime_type].split('.').pop().toUpperCase() + ': ' + image[1] + '](' + ref.url + ')';
        }
      }
      rendered = rendered.slice(0, offset) + value + rendered.slice(offset + length);
    }
    return { ...result, complete: true, unresolved: 0, deferred: replacements.filter(x => x.display === 'deferred').length,
      copied: replacements.filter(x => x.display !== 'deferred').length, render_brief: rendered,
      expires_at: new Date(now + 285000).toISOString(), images: replacements, reason: null };
  } catch { return result; }
}
