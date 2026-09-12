import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
export const samplesCaptureHashes={index:'edef156c8a0c067a2ef512f8070ac8e8072c8e6b337bbe553dab0ca854c04953',thumbnail:'8e8478cb8812688656fb5dee5fe022dd32090722da9db78f12556459de81cb51'};
// Exact public v50 capture; optional explicit paths remain hash-bound.
export async function loadCapturedSamples({indexPath,thumbnailPath,sdkModulePath,atomic=false}={}){
 const root=path.resolve(process.env.PROOF_HARNESS_ROOT,'../serving/samples-v50/functions');
 indexPath??=path.join(root,'sample-review-upsert/index.ts');thumbnailPath??=path.join(root,'_shared/thumbnail-revisions.ts');
 if(typeof atomic!=='boolean')throw Error('SAMPLES_MODE_INVALID');
 for(const [file,expected] of [[indexPath,samplesCaptureHashes.index],[thumbnailPath,samplesCaptureHashes.thumbnail]]){
 if(typeof file!=='string'||createHash('sha256').update(fs.readFileSync(file)).digest('hex')!==expected)throw Error('SAMPLES_CAPTURE_HASH_MISMATCH');}
 const {compose}=await import('../../../scripts/linear-exit-atomic-writer-compose.js');
 const production=atomic?compose('samples',fs.readFileSync(indexPath)):null;
 let source=production?production.source:fs.readFileSync(indexPath,'utf8');
 function once(old,next){if(source.split(old).length!==2)throw Error('SAMPLES_CAPTURE_SEAM_DRIFT');source=source.replace(old,next);}
 once('"npm:@supabase/supabase-js@2.49.8"',JSON.stringify(pathToFileURL(sdkModulePath||path.join(process.env.PROOF_HARNESS_ROOT,'sdk.mjs')).href));
 once('"../_shared/thumbnail-revisions.ts"',JSON.stringify(pathToFileURL(thumbnailPath).href));
 once('Deno.serve(','globalThis.__capturedSamplesServe(');
 const generated=path.join(process.env.PROOF_OUTPUT_ROOT,atomic?'atomic-samples-candidate.ts':'captured-samples-v50.ts');fs.writeFileSync(generated,source);let handler;globalThis.__capturedSamplesServe=h=>handler=h;await import(pathToFileURL(generated).href);if(typeof handler!=='function')throw Error('SAMPLES_HANDLER_MISSING');
 return {atomic,production_sha256:production?.sha256,source_sha256:createHash('sha256').update(source).digest('hex'),post(body,headers){return handler(new Request('http://samples.fixture.invalid/functions/v1/sample-review-upsert',{method:'POST',headers,body:JSON.stringify(body)}));}};
}
