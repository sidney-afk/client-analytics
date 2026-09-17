import fs from 'node:fs';
import { loadGateway } from './native-intake-reconcile/load-gateway.mjs';
import { hooks, resetHooks } from './native-intake-manifest/supabase-shim.mjs';
// Actual source handler; all transports are contained by the existing loader.
const gateway = await loadGateway();
let writes=0;
hooks.beforeRpc = name => { if(name==='production_deliverable_write' && ++writes===2) throw new Error('synthetic_second_child_interruption'); };
const body=gateway.rootBody('both',gateway.requestId('submission'));
const response=await gateway.post(body);resetHooks();
if(response.status<500)throw new Error('expected_partial_acceptance status='+response.status+' code='+String(response.json.error||''));
if(gateway.net.requests.some(r=>/api\.linear\.app|linear-outbound/.test(r.url)))throw new Error('provider_attempt_observed');
fs.writeFileSync(process.env.CARD_HISTORY_ACCEPTANCE_REPORT,JSON.stringify({request_id:body.request_id,status:response.status,provider_attempts:0}));
// Preserve loader scratch on failure; successful cleanup is confined to its
// directly created, synthetic temporary directory.
fs.rmSync(gateway.scratch,{recursive:true,force:true});
