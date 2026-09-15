'use strict';
// Produces an explicit prepared handler, never changes the default source.
const previous=require('./linear-exit-provider-send-compose');
function compose(){const r=previous.compose(),needle='admitProviderSend(supabase, row, mutation, f27Replay)';if(r.source.split(needle).length!==2)throw Error('PROVIDER_V2_BOUNDARY');return {...r,source:r.source.replace('./provider-send-preparation.mjs','./provider-send-v2-preparation.mjs').replace(needle,()=>`admitProviderSend(supabase, row, mutation, f27Replay, {format:'provider-receipt-context-v1',mirrorActor,issueId,issue:issue ?? null,context})`),receipt_context_version:1};}
module.exports={compose};
