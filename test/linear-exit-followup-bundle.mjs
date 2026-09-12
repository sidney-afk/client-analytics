import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {buildFollowupBundle} from '../scripts/linear-exit-followup-bundle.mjs';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'followup-bundle-test-'));
try {
 const target=path.join(root,'bundle'),m=buildFollowupBundle(target);
 assert.equal(m.enabled_default,false);assert.equal(m.installed,false);assert.equal(m.schedule_installed,false);
 for(const file of m.files){const bytes=fs.readFileSync(path.join(target,file.path));assert.equal(createHash('sha256').update(bytes).digest('hex'),file.sha256);assert.equal(bytes.length,file.bytes);}
 const source=fs.readFileSync(path.join(target,'functions/card-followup-worker/index.ts'),'utf8');
 for(const match of source.matchAll(/from '\.\/([^']+)'/g))assert(fs.existsSync(path.join(target,'functions/card-followup-worker',match[1])),'every local import must ship');
 const lock=JSON.parse(fs.readFileSync(path.join(target,'functions/card-followup-worker/deno.lock')));assert.equal(lock.specifiers['npm:postgres@3.4.7'],'3.4.7');assert.equal(lock.specifiers['npm:@supabase/supabase-js@2.49.8'],'2.49.8');
 assert.throws(()=>buildFollowupBundle(target),/EEXIST/);assert.deepEqual(JSON.parse(fs.readFileSync(path.join(target,'manifest.json'))),m);
 const second=buildFollowupBundle(path.join(root,'second'));assert.deepEqual(second.files,m.files,'portable artifact bytes do not depend on output path');
 assert.throws(()=>buildFollowupBundle('relative'),/ABSOLUTE/);
 console.log('FOLLOWUP_BUNDLE_OFFLINE_PASS portable source/import closure, pinned dependency integrity, exact readback, existing target preserved; hosted runtime UNPROVEN');
} finally {if(path.dirname(root)!==path.resolve(os.tmpdir())||!path.basename(root).startsWith('followup-bundle-test-'))throw Error('TEMP_BOUNDARY');fs.rmSync(root,{recursive:true,force:true});}
