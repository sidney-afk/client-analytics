'use strict';
// Explicit prepared source only; does not write/deploy or change the default handler.
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const sourcePath='supabase/functions/linear-outbound/index.ts';
function compose(){const bytes=fs.readFileSync(path.resolve(__dirname,'..',sourcePath)),text=bytes.toString('utf8');
 const sha=crypto.createHash('sha256').update(bytes).digest('hex');
 if(sha!=='8b6823724bbeda49449fd584f5953e40c4f2c14428c66c3458d17471c06daaf4')throw Error('PROVIDER_SEND_BASELINE_DRIFT');
 const send='      const data = await linearGraphql(mutation.query, mutation.variables as JsonMap);';
 const checkpoint='      await sleep(RATE_DELAY_MS);';
 for(const needle of [send,checkpoint])if(text.split(needle).length!==2)throw Error('PROVIDER_SEND_COMPOSITION_BOUNDARY');
 const prepared='import { admitProviderSend, sendAdmittedProviderMutation, completeProviderSend } from "./provider-send-preparation.mjs";\n'+text.replace(send,'      const externalSendAttempt = await admitProviderSend(supabase, row, mutation, f27Replay);\n      const data = await sendAdmittedProviderMutation(supabase, externalSendAttempt, () => linearGraphql(mutation.query, mutation.variables as JsonMap));').replace(checkpoint,'      await completeProviderSend(supabase, externalSendAttempt, linearResult);\n'+checkpoint);
 return {source:prepared,baseline_sha256:sha,default_handler_changed:false,deployment_authorized:false,replay_prepared:false,external_worker_coverage_proven:false};
}
module.exports={compose};
