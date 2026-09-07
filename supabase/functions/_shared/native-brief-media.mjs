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
const mime = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
export async function projectBriefMedia(db, row, storageOrigin, now = Date.now()) {
  const brief = typeof row.brief === 'string' ? row.brief : '';
  const refs = briefMediaOccurrences(brief);
  const digest = await briefMediaHash(brief);
  const result = { contract: BRIEF_MEDIA_CONTRACT, mode: 'required', complete: false,
    coverage_scope: 'current_native_brief_uploads_linear_app',
    id: row.id, client_slug: row.client_slug, team: row.team, source_updated_at: row.updated_at,
    brief_sha256: digest, occurrences: refs.length, unresolved: refs.length,
    render_brief: null, expires_at: null, reason: 'media_unavailable' };
  try {
    const flag = await db.from('syncview_runtime_flags').select('value').eq('key', 'native_brief_media').maybeSingle();
    if (flag.error || !flag.data || !['off', 'required'].includes(flag.data.value?.mode)
        || flag.data.value?.contract !== BRIEF_MEDIA_CONTRACT) return result;
    if (flag.data.value.mode === 'off') return { ...result, mode: 'off', reason: 'not_enabled' };
    if (flag.data.value.recovery_contract !== 'native_brief_media_recovery_v1'
        || !hash(flag.data.value.recovery_receipt_sha256) || !hash(flag.data.value.coverage_receipt_sha256)) return result;
    if (!refs.length) return { ...result, complete: true, unresolved: 0, render_brief: brief, reason: null };
    if (refs.length > 200 || !row.updated_at || !row.id || !row.client_slug || !row.team) return result;
    const read = await db.from('native_brief_media_occurrences').select('*')
      .eq('deliverable_id', row.id).eq('client_slug', row.client_slug).eq('team', row.team)
      .eq('source_kind', 'native_brief').eq('source_entity_id', row.id)
      .eq('source_sha256', digest).eq('state', 'verified').limit(201);
    if (read.error || !Array.isArray(read.data) || read.data.length !== refs.length) return result;
    const mapped = [];
    for (const ref of refs) {
      const matches = read.data.filter(x => x.source_offset === ref.offset && x.source_length === ref.length);
      const copy = matches[0];
      if (matches.length !== 1 || copy.state !== 'verified' || copy.audience !== 'staff'
          || !/^[a-f0-9-]{36}$/.test(copy.id) || copy.deliverable_id !== row.id || copy.client_slug !== row.client_slug
          || copy.source_kind !== 'native_brief' || copy.source_entity_id !== row.id
          || copy.team !== row.team || copy.source_sha256 !== digest
          || copy.original_url_sha256 !== await briefMediaHash(ref.url)
          || !hash(copy.content_sha256) || copy.readback_sha256 !== copy.content_sha256
          || !mime.has(copy.mime_type) || !Number.isSafeInteger(copy.byte_length) || copy.byte_length < 1
          || copy.byte_length > 52428800 || !Number.isFinite(Date.parse(copy.verified_at))
          || Date.parse(copy.verified_at) > now
          || copy.storage_path !== copy.content_sha256 + '/' + copy.id) return result;
      mapped.push({ ref, copy });
    }
    const replacements = [];
    for (const { ref, copy } of mapped) {
      const signed = await db.storage.from(BRIEF_MEDIA_BUCKET).createSignedUrl(copy.storage_path, 300);
      if (signed.error || typeof signed.data?.signedUrl !== 'string') return result;
      const url = new URL(signed.data.signedUrl);
      // Service SDK owns host; browser checks exact configured Supabase origin.
      if (url.protocol !== 'https:' || url.origin !== new URL(storageOrigin).origin || url.username || url.password || url.hash
          || !url.pathname.includes('/storage/v1/object/sign/' + BRIEF_MEDIA_BUCKET + '/')) return result;
      replacements.push({ ...ref, original_url: ref.url, content_sha256: copy.content_sha256, url: url.href });
    }
    // A row may move or change while URLs are signed. Never label that stale
    // projection current; canonical text remains governed by its original read.
    const current = await db.from('deliverables').select('id,client_slug,team,updated_at,brief')
      .eq('id', row.id).eq('client_slug', row.client_slug).maybeSingle();
    if (current.error || !current.data || current.data.team !== row.team
        || current.data.updated_at !== row.updated_at || current.data.brief !== brief) return result;
    let rendered = brief;
    for (const ref of [...replacements].reverse()) rendered = rendered.slice(0, ref.offset) + ref.url + rendered.slice(ref.offset + ref.length);
    return { ...result, complete: true, unresolved: 0, render_brief: rendered,
      expires_at: new Date(now + 285000).toISOString(), images: replacements, reason: null };
  } catch { return result; }
}
