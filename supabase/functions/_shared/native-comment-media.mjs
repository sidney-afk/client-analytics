// Caller authenticates and durably audits staff access before invoking. No writes.
import { briefMediaHash, briefMediaOccurrences, signNativeMedia } from './native-brief-media.mjs';
export const COMMENT_MEDIA_CONTRACT = 'native_comment_media_v1';
export const commentMediaDownloads = Object.freeze({ 'image/png':'original.png', 'image/jpeg':'original.jpg',
  'image/webp':'original.webp', 'image/gif':'original.gif', 'application/pdf':'original.pdf',
  'image/svg+xml':'original.svg', 'video/mp4':'original.mp4', 'video/quicktime':'original.mov', 'font/otf':'original.otf' });
const hash = x => typeof x === 'string' && /^[a-f0-9]{64}$/.test(x);
export const commentMediaLimit = mime => ['video/mp4','video/quicktime'].includes(mime) ? 104857600 : 52428800;
export async function projectCommentMedia(db, row, target, storageOrigin, now=Date.now()) {
  const body = typeof row.body === 'string' ? row.body : '', refs = briefMediaOccurrences(body);
  const digest = await briefMediaHash(body);
  const result = { contract: COMMENT_MEDIA_CONTRACT, mode:'required', complete:false,
    id:row.id, deliverable_id:row.deliverable_id, client_slug:row.client_slug, team:row.team,
    source_audience:row.audience, source_version:row.version, source_updated_at:row.updated_at,
    body_sha256:digest, source_body:body, occurrences:refs.length, render_body:null, expires_at:null, reason:'comment_files_unavailable' };
  try {
    const flag = await db.from('syncview_runtime_flags').select('value').eq('key','native_comment_media').maybeSingle();
    if (flag.error || flag.data?.value?.contract !== COMMENT_MEDIA_CONTRACT || !['off','required'].includes(flag.data.value.mode)) return result;
    if (flag.data.value.mode==='off') return {...result,mode:'off',reason:'not_enabled'};
    if (flag.data.value.recovery_contract !== 'native_comment_media_recovery_v1'
      || !hash(flag.data.value.recovery_receipt_sha256) || !hash(flag.data.value.coverage_receipt_sha256)) return result;
    if (row.deleted_at || !row.id || !row.updated_at || !Number.isInteger(row.version) || row.version<1
      || !['internal','client'].includes(row.audience) || row.deliverable_id!==target.id
      || row.client_slug!==target.client_slug || row.team!==target.team || refs.length>200) return result;
    if (!refs.length) return {...result,complete:true,render_body:body,reason:null};
    const read = await db.from('native_brief_media_occurrences').select('*').eq('source_kind','native_comment')
      .eq('source_entity_id',row.id).eq('deliverable_id',target.id).eq('client_slug',target.client_slug)
      .eq('team',target.team).eq('source_audience',row.audience).eq('state','verified').limit(1001);
    if (read.error || !Array.isArray(read.data) || read.data.length>1000 || new Set(read.data.map(x=>x.id)).size!==read.data.length) return result;
    const mapped=[];
    for (const ref of refs) {
      const originalHash=await briefMediaHash(ref.url), matches=read.data.filter(x=>x.original_url_sha256===originalHash);
      if (!matches.length || new Set(matches.map(x=>[x.content_sha256,x.byte_length,x.mime_type].join('|'))).size!==1) return result;
      for (const x of matches) if (x.source_kind!=='native_comment' || x.source_entity_id!==row.id
        || x.deliverable_id!==target.id || x.client_slug!==target.client_slug || x.team!==target.team
        || x.source_audience!==row.audience || x.audience!=='staff' || x.state!=='verified'
        || !Number.isInteger(x.source_version) || x.source_version<1 || !hash(x.source_sha256)
        || !Number.isInteger(x.source_offset) || x.source_offset<0 || x.source_length!==ref.length
        || !Number.isFinite(Date.parse(x.source_updated_at)) || !hash(x.source_receipt_sha256)
        || !/^[a-f0-9-]{36}$/.test(x.id) || !hash(x.content_sha256) || x.readback_sha256!==x.content_sha256
        || !commentMediaDownloads[x.mime_type] || !Number.isSafeInteger(x.byte_length) || x.byte_length<1
        || x.byte_length>commentMediaLimit(x.mime_type) || !Number.isFinite(Date.parse(x.verified_at))
        || Date.parse(x.verified_at)>now || x.storage_path!==x.content_sha256+'/'+x.id) return result;
      const exact=matches.filter(x=>x.source_sha256===digest && x.source_offset===ref.offset);
      if (exact.length>1) return result;
      const copy=exact[0] || [...matches].sort((a,b)=>a.id.localeCompare(b.id))[0];
      const url=await signNativeMedia(db,copy.storage_path,storageOrigin,commentMediaDownloads[copy.mime_type]);
      mapped.push({...ref,url});
    }
    // Recheck canonical comment and target after all signatures. Already issued
    // bearer URLs expire in five minutes; this does not claim atomic revocation.
    const current=await db.from('production_comments').select('*').eq('id',row.id).maybeSingle();
    const owner=await db.from('deliverables').select('*').eq('id',target.id).maybeSingle();
    const client=await db.from('clients').select('slug,active').eq('slug',target.client_slug).maybeSingle();
    if (current.error || owner.error || !current.data || !owner.data
      || client.error || client.data?.active!==true
      || ['id','deliverable_id','client_slug','team','body','audience','version','updated_at','deleted_at'].some(k=>(current.data[k]??null)!==(row[k]??null))
      || ['id','client_slug','team','origin','card_id'].some(k=>(owner.data[k]??null)!==(target[k]??null))
      || current.data.deleted_at || owner.data.deleted_at || owner.data.tombstoned_at || owner.data.is_deleted===true) return result;
    let render=body;
    for (const ref of [...mapped].reverse()) render=render.slice(0,ref.offset)+ref.url+render.slice(ref.offset+ref.length);
    return {...result,complete:true,render_body:render,expires_at:new Date(now+285000).toISOString(),reason:null};
  } catch { return result; }
}
