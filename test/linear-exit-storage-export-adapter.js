'use strict';
const assert=require('assert/strict'),http=require('http'),fs=require('fs'),os=require('os'),path=require('path'),crypto=require('crypto');
const {captureStorageInventory,createStorageExportAdapter}=require('../scripts/linear-exit-storage-export-adapter');
const {exportObjects,readInventory}=require('../scripts/linear-exit-object-export');
const {restoreEncrypted}=require('../scripts/linear-exit-object-custody-encrypted');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'storage-export-test-'));
const bucket={id:'synthetic',public:false,file_size_limit:null,allowed_mime_types:null};
const files=new Map(Array.from({length:101},(_,i)=>['file'+String(i).padStart(3,'0'),Buffer.from('synthetic '+i)]));
files.set('folder/space ü.bin',Buffer.from('nested bytes'));
const version='synthetic-version',calls=[];let behavior='normal',metadataReads=0;
const server=http.createServer(async(req,res)=>{
 try{calls.push({method:req.method,path:req.url});assert(req.headers.authorization?.startsWith('Bearer '));const route=new URL(req.url,'http://localhost').pathname;
 const json=value=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value));};
 if(route==='/storage/v1/bucket'){if(behavior==='redirect'){res.writeHead(302,{Location:'https://example.invalid/never'});return res.end();}if(behavior==='denied'){res.statusCode=403;return res.end('private error must not escape');}return json([bucket]);}
 if(route==='/storage/v1/object/list/synthetic'){assert.equal(req.method,'POST');let body='';for await(const part of req)body+=part;const opts=JSON.parse(body);assert.deepEqual(opts.sortBy,{column:'name',order:'asc'});const names=opts.prefix==='folder'?['space ü.bin']:[...files.keys()].filter(n=>!n.includes('/')).concat(['folder']).sort();const rows=names.slice(opts.offset,opts.offset+opts.limit).map(name=>name==='folder'?{name,id:null,metadata:null}:{name,id:'id-'+name,metadata:{size:files.get(opts.prefix?opts.prefix+'/'+name:name).length}});if(behavior==='duplicate'&&opts.offset===100)rows.push({name:'file000',id:'duplicate',metadata:{size:1}});return json(rows);}
 const match=route.match(/^\/storage\/v1\/object\/(info|authenticated)\/synthetic\/(.+)$/);if(!match){res.statusCode=404;return res.end();}assert.equal(req.method,'GET');const name=match[2].split('/').map(decodeURIComponent).join('/'),bytes=files.get(name);assert(bytes);
 if(match[1]==='info')return json({id:'id-'+name,name,bucket_id:'synthetic',version:behavior==='version'?'changed':version,size:bytes.length,content_type:'application/octet-stream',cache_control:'max-age=60',etag:'synthetic-etag',metadata:{synthetic:behavior==='metadata-drift'&&++metadataReads>104?'changed':'retained'},last_modified:'2026-09-12T00:00:00Z',created_at:'2026-09-11T00:00:00Z'});
 res.end(behavior==='corrupt'?Buffer.alloc(bytes.length,1):bytes);
 }catch(_){res.statusCode=500;res.end('synthetic server assertion');}
});
(async()=>{try{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;
 const opts={projectRef:'a'.repeat(20),serviceKey:crypto.randomBytes(32).toString('hex'),hmacInput:crypto.randomBytes(32).toString('base64'),encryptionKey:crypto.randomBytes(32),keyId:crypto.randomBytes(16).toString('hex'),fetch:async(url,options)=>{assert.equal(new URL(url).origin,'https://'+'a'.repeat(20)+'.supabase.co');assert.equal(options.redirect,'error');return fetch('http://127.0.0.1:'+port+new URL(url).pathname,options);}};
 const captured=await captureStorageInventory(opts),inventory=readInventory(captured.inventoryBytes,opts.hmacInput);assert.equal(captured.objects,102);assert.equal(captured.atomic_source_snapshot_proven,false);assert.equal(inventory.objects.find(o=>o.path==='folder/space ü.bin').sha256,crypto.createHash('sha256').update(files.get('folder/space ü.bin')).digest('hex'));
 const options={...opts,inventoryBytes:captured.inventoryBytes,target:path.join(temp,'package')};options.adapter=createStorageExportAdapter(options);
 const exported=await exportObjects(options);assert.equal(exported.objects,102);assert.equal(exported.live_source_proven,false);
 restoreEncrypted({...options,packageDirectory:options.target,target:path.join(temp,'restored')});for(const [name,bytes] of files)assert.deepEqual(fs.readFileSync(path.join(temp,'restored','synthetic',name)),bytes);
 const sidecar=fs.readFileSync(path.join(temp,'restored','export-evidence','storage-metadata.hmac'));const payload=sidecar.subarray(32);assert.deepEqual(sidecar.subarray(0,32),crypto.createHmac('sha256',require('../scripts/track-b-backup').parseHmacKey(opts.hmacInput)).update(payload).digest());const metadata=JSON.parse(payload);assert.equal(metadata.inventory_sha256,captured.inventory_sha256);assert.equal(metadata.objects.length,102);assert.equal(metadata.objects[0].metadata.content_type,'application/octet-stream');assert.equal(metadata.backend_version_history_proven,false);behavior='metadata-drift';metadataReads=0;await assert.rejects(captureStorageInventory(opts),/METADATA_CHANGED/);behavior='normal';for(const mode of ['version','duplicate','denied','redirect','corrupt']){behavior=mode;await assert.rejects(exportObjects({...options,target:path.join(temp,mode),adapter:createStorageExportAdapter(options)}),e=>!e.message.includes(opts.serviceKey)&&!e.message.includes('private error'));assert(!fs.existsSync(path.join(temp,mode)));}behavior='normal';
 const tampered=Buffer.from(captured.inventoryBytes);tampered[0]^=1;assert.throws(()=>createStorageExportAdapter({...options,inventoryBytes:tampered}),/AUTH/);
 const malicious=structuredClone(inventory);malicious.objects[0].path='../escape';const {signInventory}=require('../scripts/linear-exit-object-export');const maliciousAdapter=createStorageExportAdapter({...options,inventoryBytes:signInventory(malicious,opts.hmacInput)});await assert.rejects(maliciousAdapter.download(malicious.objects[0]),/PATH/);
 await assert.rejects(captureStorageInventory({...opts,fetch:async(url,options)=>{const response=await opts.fetch(url,options);if(url.includes('/object/info/')){const data=await response.json();delete data.cache_control;return Response.json(data);}return response;}}),/METADATA_MISSING/);
 await assert.rejects(captureStorageInventory({...opts,projectRef:'bad.example/escape'}),/CONFIG/);
 await assert.rejects(captureStorageInventory({...opts,maxPages:1}),/PAGE_LIMIT/);
 assert(calls.every(c=>c.method==='GET'||c.method==='POST'&&c.path==='/storage/v1/object/list/synthetic'));
 console.log('STORAGE_EXPORT_HTTP_PASS 102 objects, nested Unicode, pagination, encrypted byte-exact restore, drift/corruption/auth/redirect/path/limit refusals; loopback only, hosted and atomic snapshot UNPROVEN');
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));if(path.dirname(path.resolve(temp))!==path.resolve(os.tmpdir())||!path.basename(temp).startsWith('storage-export-test-'))throw Error('TEMP_BOUNDARY');fs.rmSync(temp,{recursive:true,force:true});}})().catch(e=>{console.error(e.message);process.exitCode=1;});
