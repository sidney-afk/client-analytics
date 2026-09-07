'use strict';
// Actual complete reader/helper and browser functions; synthetic SDK, no network.
const fs=require('fs'),path=require('path'),os=require('os'),vm=require('vm'),assert=require('assert/strict');
const {pathToFileURL}=require('url'),{spawnSync}=require('child_process');
const {extractFunction}=require('./helpers/extract-function');
if(!process.execArgv.includes('--experimental-strip-types')){
 const r=spawnSync(process.execPath,['--experimental-strip-types','--no-warnings',__filename,...process.argv.slice(2)],{stdio:'inherit',windowsHide:true});process.exit(r.status??1);
}
const root=path.resolve(__dirname,'..'),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'comment-media-'));
const stamp='2026-09-01T00:00:00Z',target={id:'d',client_slug:'fixture',team:'video',origin:'calendar',card_id:'card'};
const body='First ![file](https://uploads.linear.app/fixture/file.png) again https://uploads.linear.app/fixture/file.png';
const row={id:'comment',...target,deliverable_id:'d',id:'comment',body,audience:'internal',version:1,updated_at:stamp,created_at:stamp};
let tables,reads,signed,hook,handler,audit=true,fail='',groups=0,signPath=null;
const env={SUPABASE_URL:'https://fixture.invalid',SUPABASE_SERVICE_ROLE_KEY:'fixture',ROLE_KEY_SMM:'staff',ROLE_KEY_CREATIVE:'creative'};
globalThis.Deno={env:{get:k=>env[k]},serve:fn=>handler=fn};globalThis.fetch=()=>{throw Error('network_refused');};
class Query{
 constructor(table){this.table=table;this.filters=[];this.cap=Infinity;}
 select(c,o={}){this.head=o.head;return this;}eq(k,v){this.filters.push(r=>r[k]===v);return this;}
 order(){return this;}limit(n){this.cap=n;return this;}or(){return this;}maybeSingle(){this.single=true;return this;}insert(){return this;}
 then(resolve,reject){reads.push(this.table);const rows=structuredClone((tables[this.table]||[]).filter(r=>this.filters.every(f=>f(r))).slice(0,this.cap));
 return Promise.resolve({data:this.head?null:this.single?rows[0]||null:rows,count:rows.length,error:this.table===fail?{}:null}).then(resolve,reject);}
}
globalThis.__commentSDK={from:t=>new Query(t),rpc:async name=>({data:name==='production_comment_read_authorize'?{ok:true,authorized:audit}:{ok:true,allowed:true}}),
storage:{from:bucket=>({createSignedUrl:async(p,ttl,options)=>{signed++;assert.equal(ttl,300);assert(options.download);if(hook)hook();
 return {data:{signedUrl:env.SUPABASE_URL+(signPath || '/storage/v1/object/sign/'+bucket+'/'+p)+'?token=fixture&download='+options.download}};}})}};
async function call(extra={},headers={'x-syncview-key':'staff','x-syncview-actor':'Fixture Staff'}){
 const r=await handler(new Request('https://fixture.invalid',{method:'POST',headers:{...headers,'content-type':'application/json'},body:JSON.stringify({deliverable_id:'d',...extra})}));return{status:r.status,body:await r.json()};
}
let copies;function reset(){signed=0;reads=[];hook=null;audit=true;fail='';signPath=null;tables={team_members:[{id:'actor',name:'Fixture Staff',role:'smm',active:true}],
 clients:[{slug:'fixture',active:true}],deliverables:[structuredClone(target)],production_comments:[structuredClone(row)],
 native_brief_media_occurrences:structuredClone(copies),syncview_runtime_flags:[{key:'native_comment_media',value:{mode:'required',contract:'native_comment_media_v1',recovery_contract:'native_comment_media_recovery_v1',recovery_receipt_sha256:'a'.repeat(64),coverage_receipt_sha256:'b'.repeat(64)}}]};}
async function check(name,fn){reset();await fn();console.log('PASS '+name);groups++;}
(async()=>{try{
 const media=await import(pathToFileURL(path.join(root,'supabase/functions/_shared/native-brief-media.mjs')));
 const refs=media.briefMediaOccurrences(body),digest=await media.briefMediaHash(body);
 copies=await Promise.all(refs.map(async(ref,i)=>{const id='11111111-1111-4111-8111-11111111111'+i;return{id,source_kind:'native_comment',source_entity_id:row.id,deliverable_id:'d',client_slug:'fixture',team:'video',
 source_audience:'internal',source_version:1,source_sha256:digest,source_updated_at:stamp,source_offset:ref.offset,source_length:ref.length,original_url_sha256:await media.briefMediaHash(ref.url),
 audience:'staff',state:'verified',content_sha256:'c'.repeat(64),readback_sha256:'c'.repeat(64),storage_path:'c'.repeat(64)+'/'+id,byte_length:123,mime_type:'image/png',verified_at:stamp,source_receipt_sha256:'a'.repeat(64)};}));
 const entry=path.join(root,'supabase/functions/production-comments/index.ts');
 const source=fs.readFileSync(entry,'utf8').replace(/import \{ createClient, SupabaseClient \} from "npm:[^"]+";/,'const createClient=()=>globalThis.__commentSDK; type SupabaseClient=any;')
 .replace(/from "(\.\.?\/[^\"]+)"/g,(_,p)=>'from '+JSON.stringify(pathToFileURL(path.resolve(path.dirname(entry),p)).href));
 fs.writeFileSync(path.join(tmp,'handler.mts'),source);await import(pathToFileURL(path.join(tmp,'handler.mts')));
 await check('actual authenticated and audited reader returns two download links with canonical body unchanged',async()=>{const r=await call();assert.equal(r.status,200);assert.equal(r.body.comments[0].body,body);assert(r.body.comments[0].media.complete);assert.equal(signed,2);assert(!r.body.comments[0].media.render_body.includes('uploads.linear.app'));});
 for(const [name,change]of[['audit refusal',()=>audit=false],['inactive actor',()=>tables.team_members[0].active=false]])await check(name+' cannot sign',async()=>{change();assert((await call()).status>=400);assert.equal(signed,0);assert(!reads.includes('native_brief_media_occurrences'));});
 await check('unsigned cannot read custody',async()=>{assert.equal((await call({},{})).status,401);assert.equal(signed,0);});
 await check('plain comment page preserves original read path without media flag/custody/sign/auth overhead',async()=>{
  tables.production_comments[0].body='Ordinary comment';const r=await call();assert.equal(r.status,200);assert.equal(r.body.comments[0].media,undefined);
  assert.equal(signed,0);assert(!reads.includes('syncview_runtime_flags'));assert(!reads.includes('native_brief_media_occurrences'));assert.equal(reads.filter(t=>t==='team_members').length,1);
 });
 await check('single-comment refresh reads selected older comment',async()=>{tables.production_comments.unshift({...row,id:'newer',body:'No files'});const r=await call({media_comment_id:'comment'});assert.equal(r.body.comments.length,1);assert.equal(r.body.comments[0].id,'comment');assert(r.body.comments[0].media.complete);});
 for(const[name,change]of[
 ['missing copy',()=>tables.native_brief_media_occurrences=[]],['cross comment',()=>tables.native_brief_media_occurrences.forEach(x=>x.source_entity_id='other')],
 ['audience changed',()=>tables.production_comments[0].audience='client'],['new URL',()=>tables.production_comments[0].body+=' https://uploads.linear.app/fixture/new.png'],
 ['conflicting bytes',()=>tables.native_brief_media_occurrences[1].content_sha256='d'.repeat(64)],['over cap raster',()=>tables.native_brief_media_occurrences.forEach(x=>x.byte_length=52428801)],
 ['comment client mismatch',()=>tables.production_comments[0].client_slug='other'],['missing flag',()=>tables.syncview_runtime_flags=[]],
 ['future receipt',()=>tables.native_brief_media_occurrences[0].verified_at='2999-01-01T00:00:00Z'],
 ])await check(name+' remains visibly held',async()=>{change();const r=await call();assert.equal(r.body.comments[0].media.complete,false);assert.equal(r.body.comments[0].media.render_body,null);});
 await check('ordinary edit/reorder reuses exact within-comment files at current offsets',async()=>{tables.production_comments[0].body='Edited '+body;tables.production_comments[0].version=2;const r=await call();assert(r.body.comments[0].media.complete);assert.equal(r.body.comments[0].media.source_version,2);assert.equal(tables.native_brief_media_occurrences[0].source_sha256,digest);});
 for(const [name,p]of [['wrong object same bucket','/storage/v1/object/sign/syncview-native-brief-media/other'],['wrong prefix','/other/storage/v1/object/sign/syncview-native-brief-media/'+copies[0].storage_path]])await check(name+' signed URL stays held',async()=>{signPath=p;assert.equal((await call()).body.comments[0].media.complete,false);});
 for(const[name,change]of[['deleted',()=>tables.production_comments[0].deleted_at=stamp],['body race',()=>tables.production_comments[0].body='Changed'],['scope race',()=>tables.deliverables[0].team='graphics'],['inactive client',()=>tables.clients[0].active=false]])await check(name+' after signing suppresses mapping',async()=>{hook=change;const r=await call();assert.equal(r.body.comments[0].media.complete,false);});
 await check('actor offboarding during signing denies response',async()=>{hook=()=>tables.team_members[0].active=false;assert.equal((await call()).status,403);});
 await check('comment video100MiB and font always download; brief limit unchanged',async()=>{for(const mime of ['video/quicktime','font/otf']){tables.native_brief_media_occurrences.forEach(x=>{x.mime_type=mime;x.byte_length=mime.startsWith('video')?104857600:123;});assert((await call()).body.comments[0].media.complete);}tables.native_brief_media_occurrences.forEach(x=>x.byte_length=104857601);assert(!(await call()).body.comments[0].media.complete);});
 const html=fs.readFileSync(path.join(root,'index.html'),'utf8'),context={URL,Date,console,_prodState:{openId:'d'},_calEsc:s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;'),_calEscAttr:s=>String(s).replaceAll('"','&quot;'),_jsAttrArg:s=>JSON.stringify(s)};
 vm.createContext(context);vm.runInContext(['_jsAttrArg','_prodNormalizeMarkdownLine','_prodMarkdownBlockish','_prodLinkifyInline','_prodLinkify','_prodCommentMediaHTML'].map(n=>extractFunction(html,n)).join('\n'),context);
 await check('actual browser renderer preserves images-off and expired visible refresh',async()=>{const r=await call(),c={...r.body.comments[0],row_updated_at:stamp};const markup=context._prodCommentMediaHTML(c);assert(!markup.includes('<img'));assert(!markup.includes('uploads.linear.app'));assert(markup.includes('Refresh downloads'));c.media.expires_at=stamp;const expired=context._prodCommentMediaHTML(c);assert(!expired.includes('href='));assert(expired.includes('File downloads need a fresh check'));assert.equal(c.body,body);});
 await check('deleted comment never signs',async()=>{tables.production_comments[0].deleted_at=stamp;const r=await call();assert.equal(r.body.comments[0].body,'Comment deleted.');assert.equal(signed,0);});
 await check('cold missing projection and cached required downgrade cannot restore provider destinations',async()=>{
  const c={...row,row_updated_at:stamp};assert(!context._prodCommentMediaHTML(c).includes('href='));assert(context._prodCommentMediaHTML(c).includes('Refresh downloads'));
  context._prodHashText=()=>'';vm.runInContext(['_prodCommentTruthy','_prodCommentNormalize','_prodCommentMerge'].map(n=>extractFunction(html,n)).join('\n'),context);
  const merged=context._prodCommentMerge([{...row,media:{mode:'required',complete:true}}],[{...row,media:null}]);assert.equal(merged[0].media.complete,false);assert(!context._prodCommentMediaHTML(merged[0]).includes('href='));
 });
 for(const mode of ['success','identity-loss','generation-change','failed','concurrent-edit-failed','concurrent-edit-success','older-response'])await check('actual refresh function '+mode+' preserves scoped adoption',async()=>{
  const state={},adopted=[],notices=[],original={...row,media:{mode:'required',deliverable_id:'d'}},identity={name:'Fixture Staff'};
  let latest=original;
  const ctx={console,AbortController,setTimeout,clearTimeout,JSON,generation:0,_isClientLink:false,PROD_COMMENTS_EF_URL:'https://fixture.invalid',
   stateFor:()=>state,find:()=>latest,_syncviewStaffIdentityForHeaders:()=>identity,
   authHeaders:()=>({'x-syncview-key':'staff','x-syncview-actor':'Fixture Staff','content-type':'application/json'}),
   adopt:(id,r)=>adopted.push(r),_prodToast:s=>notices.push(s)};
  if(mode==='older-response')original.version=2;
  ctx.fetch=async(url,options)=>{const response=mode.includes('failed')?new Response('{"ok":false}',{status:503}):await handler(new Request(url,options));
   if(mode.startsWith('concurrent-edit'))latest={...original,version:2,body:'Accepted new text'};
   if(mode==='identity-loss')identity.name='Other';if(mode==='generation-change')ctx.generation++;return response;};
  vm.createContext(ctx);vm.runInContext('async '+extractFunction(html,'refreshMedia'),ctx);await ctx.refreshMedia('d','comment');
  if(mode==='success'){assert.equal(adopted.length,1);assert(adopted[0].media.complete);assert.equal(adopted[0].body,body);}
  else if(mode==='failed'){assert.equal(adopted.length,1);assert.equal(adopted[0].media.complete,false);assert.equal(notices.length,1);}
  else assert.equal(adopted.length,0);
 });
 if(process.argv.includes('--browser')){
  const {chromium}=require('playwright'),browser=await chromium.launch({headless:true});try{const page=await browser.newPage();let external=0;await page.route('**/*',r=>{external++;return r.abort();});
   reset();const r=await call(),c={...r.body.comments[0],row_updated_at:stamp};
   await page.setContent('<div id="comments">'+context._prodCommentMediaHTML(c)+'</div>');
   await page.evaluate(()=>{window.refreshes=0;window._prodComments={refreshMedia:()=>window.refreshes++};});
   await page.getByRole('button',{name:'Refresh downloads'}).click();assert.equal(await page.evaluate(()=>window.refreshes),1);
   await page.evaluate(expiry=>{Date.now=()=>expiry+1;},Date.parse(c.media.expires_at));
   await page.locator('a').first().click();assert.equal(await page.evaluate(()=>window.refreshes),2);
   assert.equal(await page.locator('img').count(),0);assert.equal(external,0);
   for(const width of [360,768,1280]){await page.setViewportSize({width,height:800});assert.equal(await page.locator('button').isVisible(),true);}
   console.log('PASS actual Chromium download controls, images-off, three widths and zero external requests');groups++;
  }finally{await browser.close();}
 }
 await check('private local staging/readback proposal preserve comment identity and originals',async()=>{
  const pkg=await import(pathToFileURL(path.join(root,'scripts/native-comment-media-package.mjs')));
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==','base64');
  const content=await media.briefMediaHash(png),file=path.join(tmp,'file.png'),receiptFile=path.join(tmp,'receipt.json');fs.writeFileSync(file,png);
  const receipt={contract:'native_comment_media_source_v1',id:row.id,deliverable_id:'d',client_slug:'fixture',team:'video',source_audience:'internal',source_version:1,source_updated_at:stamp,body_sha256:digest,
   occurrences:await Promise.all(refs.map(async r=>({offset:r.offset,original_url_sha256:await media.briefMediaHash(r.url),content_sha256:content})))};
  fs.writeFileSync(receiptFile,JSON.stringify(receipt));const input=path.join(tmp,'ingress.json');
  fs.writeFileSync(input,JSON.stringify({contract:'native_comment_media_ingress_v1',documents:[{row,source_receipt_path:receiptFile,files:refs.map(r=>({offset:r.offset,path:file,mime_type:'image/png'}))}]}));
  const staged=path.join(tmp,'staged');assert.equal((await pkg.stage(input,staged)).occurrences,2);const pack=await pkg.verify(staged);
  assert(pack.rows.every(r=>r.state==='pending'&&r.source_entity_id===row.id&&r.source_audience==='internal'));
  const evidence={contract:'native_comment_media_storage_readback_v1',bucket:'syncview-native-brief-media',public:false,global_limit_bytes:104857600,bucket_limit_bytes:104857600,
   recovery_base_sha256:'a'.repeat(64),observed_at:stamp,documents:[row],objects:pack.rows.map(r=>({storage_path:r.storage_path,path:file,storage_mime_type:'application/octet-stream',content_disposition:'attachment'}))};
  const readback=path.join(tmp,'readback.json');fs.writeFileSync(readback,JSON.stringify(evidence));
  const admitted=path.join(tmp,'admitted');await pkg.admission(staged,readback,admitted);assert((await pkg.verify(admitted)).rows.every(r=>r.state==='verified'));
  evidence.documents=[{...row,audience:'client'}];fs.writeFileSync(readback,JSON.stringify(evidence));
  await assert.rejects(pkg.admission(staged,readback,path.join(tmp,'wrong-audience')));
  fs.writeFileSync(path.join(staged,'objects',pack.rows[0].storage_path),'corrupt');await assert.rejects(pkg.verify(staged));
 });
 console.log('PASS '+groups+' comment media groups');
}finally{fs.rmSync(tmp,{recursive:true,force:true});}})().catch(e=>{console.error(e);process.exitCode=1;});
