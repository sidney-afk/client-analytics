// Private local preparation only. No network, uploads, SQL or credential discovery.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {privateFile,verifyExistingMedia} from './native-brief-media-package.mjs';
import {briefMediaHash as sha,briefMediaOccurrences as occurrences,BRIEF_MEDIA_BUCKET} from '../supabase/functions/_shared/native-brief-media.mjs';
import {commentMediaDownloads,commentMediaLimit} from '../supabase/functions/_shared/native-comment-media.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'), hex=/^[a-f0-9]{64}$/;
const validator=path.join(root,'scripts/native-comment-media-validate.py');
const pinned=['scripts/native-comment-media-validate.py','scripts/native-brief-media-validate.py',
  'migrations/2026-09-07-native-brief-media.sql','migrations/2026-09-07-native-comment-media.sql'];
const pins=async()=>Object.fromEntries(await Promise.all(pinned.map(async p=>[p,await sha(fs.readFileSync(path.join(root,p)))])));
export async function verifyCommentFile(file,mime,expected) {
  assert(commentMediaDownloads[mime],'comment_mime_held');
  const source=privateFile(file), stat=fs.statSync(source);
  assert(stat.isFile() && stat.size>0 && stat.size<=commentMediaLimit(mime),'comment_size_held');
  const bytes=fs.readFileSync(source), content=await sha(bytes);
  assert.equal(content,expected,'comment_content_mismatch');
  if (mime!=='font/otf' && bytes.length<=52428800) await verifyExistingMedia(mime,bytes);
  else {
    const r=spawnSync(process.env.NATIVE_BRIEF_MEDIA_PYTHON || 'python',['-B',validator,mime],
      {input:bytes,windowsHide:true,timeout:120000,maxBuffer:4096});
    assert(r.status===0 && JSON.parse(r.stdout.toString()).ok===true,'comment_bytes_held');
  }
  return {bytes,content_sha256:content,mime_type:mime,byte_length:bytes.length,storage_mime_type:'application/octet-stream'};
}
function mkdir(output) {
  assert(path.isAbsolute(output) && !fs.existsSync(output),'new_private_directory_required');
  privateFile(path.dirname(output)); fs.mkdirSync(output,{mode:0o700}); return privateFile(output);
}
function write(dir,name,bytes) {
  const target=path.join(dir,name); fs.mkdirSync(path.dirname(target),{recursive:true,mode:0o700});
  fs.writeFileSync(target,bytes,{flag:'wx',mode:0o600});
}
function scope(row) {
  assert(row && typeof row.body==='string' && row.id && row.deliverable_id && row.client_slug
    && ['video','graphics'].includes(row.team) && ['internal','client'].includes(row.audience)
    && Number.isInteger(row.version) && row.version>=1 && Number.isFinite(Date.parse(row.updated_at)) && !row.deleted_at,'comment_scope_held');
  return {id:row.id,deliverable_id:row.deliverable_id,client_slug:row.client_slug,team:row.team,
    source_audience:row.audience,source_version:row.version,source_updated_at:row.updated_at};
}
export async function stage(inputFile,output) {
  const input=JSON.parse(fs.readFileSync(privateFile(inputFile)));
  assert.equal(input.contract,'native_comment_media_ingress_v1');
  assert(Array.isArray(input.documents) && input.documents.length>0 && input.documents.length<=100);
  const files=new Map(),ledger=[];
  for (const doc of input.documents) {
    const owner=scope(doc.row), bodyHash=await sha(doc.row.body), refs=occurrences(doc.row.body);
    assert(refs.length>0 && refs.length<=200 && doc.files.length===refs.length,'complete_comment_occurrences_required');
    const bytes=fs.readFileSync(privateFile(doc.source_receipt_path)), receipt=JSON.parse(bytes), receiptHash=await sha(bytes);
    assert.equal(receipt.contract,'native_comment_media_source_v1');
    for (const [k,v] of Object.entries({...owner,body_sha256:bodyHash})) assert.equal(receipt[k],v,'source_binding_mismatch');
    assert.equal(receipt.occurrences.length,refs.length);
    files.set('receipts/'+receiptHash+'.json',bytes);
    for (const ref of refs) {
      const sources=receipt.occurrences.filter(x=>x.offset===ref.offset), matches=doc.files.filter(x=>x.offset===ref.offset);
      assert(sources.length===1 && matches.length===1,'exact_occurrence_required');
      assert.equal(sources[0].original_url_sha256,await sha(ref.url));
      const copy=await verifyCommentFile(matches[0].path,matches[0].mime_type,sources[0].content_sha256);
      const id=randomUUID(), storage_path=copy.content_sha256+'/'+id;
      files.set('objects/'+storage_path,copy.bytes);
      ledger.push({id,source_kind:'native_comment',source_entity_id:owner.id,deliverable_id:owner.deliverable_id,
        client_slug:owner.client_slug,team:owner.team,source_audience:owner.source_audience,source_version:owner.source_version,
        source_updated_at:owner.source_updated_at,source_sha256:bodyHash,source_offset:ref.offset,source_length:ref.length,
        original_url_sha256:sources[0].original_url_sha256,audience:'staff',state:'pending',content_sha256:copy.content_sha256,
        readback_sha256:null,storage_path,byte_length:copy.byte_length,mime_type:copy.mime_type,verified_at:null,source_receipt_sha256:receiptHash});
    }
  }
  files.set('ledger.private.json',Buffer.from(JSON.stringify(ledger)));
  const manifest={contract:'native_comment_media_package_v1',kind:'INGRESS_STAGED',bucket:BRIEF_MEDIA_BUCKET,
    installed:false,storage_mime_type:'application/octet-stream',source_pins:await pins(),
    files:Object.fromEntries(await Promise.all([...files].map(async([n,b])=>[n,await sha(b)])))};
  const dir=mkdir(output); for (const [name,bytes] of files) write(dir,name,bytes);
  write(dir,'manifest.private.json',JSON.stringify(manifest));
  return {classification:'OFFLINE_COMMENT_STAGED',occurrences:ledger.length,installed:false};
}
export async function verify(directory) {
  const dir=privateFile(directory), manifest=JSON.parse(fs.readFileSync(path.join(dir,'manifest.private.json')));
  assert.equal(manifest.contract,'native_comment_media_package_v1'); assert.equal(manifest.bucket,BRIEF_MEDIA_BUCKET);
  assert.deepEqual(manifest.source_pins,await pins());
  assert(['INGRESS_STAGED','ADMISSION_PROPOSAL'].includes(manifest.kind));
  assert.equal(manifest.storage_mime_type,'application/octet-stream');
  for (const [name,digest] of Object.entries(manifest.files)) {
    assert(/^(ledger\.private\.json|receipts\/[a-f0-9]{64}\.json|objects\/[a-f0-9]{64}\/[a-f0-9-]{36})$/.test(name));
    const file=path.join(dir,name); assert.equal(fs.realpathSync(file),path.resolve(file));
    assert.equal(await sha(fs.readFileSync(file)),digest);
  }
  const rows=JSON.parse(fs.readFileSync(path.join(dir,'ledger.private.json')));
  assert(Array.isArray(rows) && new Set(rows.map(r=>r.id)).size===rows.length);
  for (const row of rows) {
    assert.equal(row.source_kind,'native_comment'); assert.equal(row.audience,'staff');
    assert.equal(row.state,manifest.kind==='INGRESS_STAGED'?'pending':'verified');
    assert.equal(row.storage_path,row.content_sha256+'/'+row.id);
    assert.equal(manifest.files['objects/'+row.storage_path],row.content_sha256);
    const checked=await verifyCommentFile(path.join(dir,'objects',row.storage_path),row.mime_type,row.content_sha256);
    assert.equal(checked.byte_length,row.byte_length);
    assert.equal(manifest.files['receipts/'+row.source_receipt_sha256+'.json'],row.source_receipt_sha256);
    const receipt=JSON.parse(fs.readFileSync(path.join(dir,'receipts',row.source_receipt_sha256+'.json')));
    assert.equal(receipt.contract,'native_comment_media_source_v1');
    for(const[k,v]of Object.entries({id:row.source_entity_id,deliverable_id:row.deliverable_id,client_slug:row.client_slug,
      team:row.team,source_audience:row.source_audience,source_version:row.source_version,source_updated_at:row.source_updated_at,body_sha256:row.source_sha256}))assert.equal(receipt[k],v);
    const refs=receipt.occurrences.filter(x=>x.offset===row.source_offset);
    assert.equal(refs.length,1); assert.equal(refs[0].original_url_sha256,row.original_url_sha256); assert.equal(refs[0].content_sha256,row.content_sha256);
    if(row.state==='verified')assert.equal(row.readback_sha256,row.content_sha256);
  }
  return {manifest,rows};
}
export async function admission(directory,readbackFile,output) {
  const {manifest,rows}=await verify(directory); assert.equal(manifest.kind,'INGRESS_STAGED');
  const bytes=fs.readFileSync(privateFile(readbackFile)), evidence=JSON.parse(bytes);
  assert.equal(evidence.contract,'native_comment_media_storage_readback_v1');
  assert.equal(evidence.bucket,BRIEF_MEDIA_BUCKET); assert.equal(evidence.public,false);
  assert(evidence.global_limit_bytes>=104857600 && evidence.bucket_limit_bytes===104857600 && hex.test(evidence.recovery_base_sha256));
  assert(Number.isFinite(Date.parse(evidence.observed_at)) && Date.parse(evidence.observed_at)<=Date.now());
  assert.equal(evidence.objects.length,rows.length);
  for(const row of rows) {
    const objects=evidence.objects.filter(x=>x.storage_path===row.storage_path); assert.equal(objects.length,1);
    assert.equal(objects[0].storage_mime_type,'application/octet-stream');
    assert.equal(objects[0].content_disposition,'attachment');
    const checked=await verifyCommentFile(objects[0].path,row.mime_type,row.content_sha256);assert.equal(checked.byte_length,row.byte_length);
    const current=evidence.documents.filter(x=>x.id===row.source_entity_id);assert.equal(current.length,1);
    const owner=scope(current[0]);
    for(const k of ['deliverable_id','client_slug','team','source_audience'])assert.equal(owner[k],row[k]);
    assert.equal(await sha(current[0].body),row.source_sha256,'fresh_source_required');
    const ref=occurrences(current[0].body).find(x=>x.offset===row.source_offset&&x.length===row.source_length);
    assert(ref);assert.equal(await sha(ref.url),row.original_url_sha256);
    row.state='verified';row.readback_sha256=row.content_sha256;row.verified_at=evidence.observed_at;
  }
  const dir=mkdir(output);
  for(const name of Object.keys(manifest.files))if(name!=='ledger.private.json')write(dir,name,fs.readFileSync(path.join(directory,name)));
  const ledger=Buffer.from(JSON.stringify(rows)), receiptHash=await sha(bytes), receiptName='receipts/'+receiptHash+'.json';
  write(dir,'ledger.private.json',ledger);write(dir,receiptName,bytes);
  manifest.files['ledger.private.json']=await sha(ledger);manifest.files[receiptName]=receiptHash;
  Object.assign(manifest,{kind:'ADMISSION_PROPOSAL',recovery_base_sha256:evidence.recovery_base_sha256,storage_readback_sha256:receiptHash});
  write(dir,'manifest.private.json',JSON.stringify(manifest));
  await verify(dir);return {classification:'OFFLINE_COMMENT_ADMISSION_PROPOSAL',occurrences:rows.length,installed:false};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))try{
  const[mode,input,output,destination]=process.argv.slice(2);assert(['stage','verify','admission'].includes(mode));
  console.log(JSON.stringify(mode==='stage'?await stage(input,output):mode==='admission'?await admission(input,output,destination)
    :{classification:'OFFLINE_COMMENT_PACKAGE_VERIFIED',occurrences:(await verify(input)).rows.length}));
}catch{console.error('{"ok":false,"reason":"native_comment_media_package_held"}');process.exitCode=2;}
