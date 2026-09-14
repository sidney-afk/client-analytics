// Preparation-only read observer. SQL validates this exact query and original attempt.
export const CREATE_READ_QUERY="query SyncViewMirrorIssue($id: String!) { issue(id: $id) { id identifier title description url priority dueDate archivedAt updatedAt\nstate { id name type }\nteam { id key name states { nodes { id name type position } } }\nproject { id name }\nassignee { id name email }\nparent { id identifier title }\nlabelIds\nlabels(first: 100, includeArchived: true) { nodes { id name color description } pageInfo { hasNextPage } }\nattachments(first: 100) { nodes { id url title subtitle } pageInfo { hasNextPage endCursor } }\ncomments(first: 100) { nodes { id body createdAt user { id name email } } } } }";
export const CREATE_READ_QUERY_SHA256='3b9dca6d2c4958575692c69ef6999a1659ff13edef22cd01b13e85559fd395dd';
export async function observeProviderCreate(db,request,readGraphql) {
 const variables={id:request.expectedOutbox?.payload?.planned_linear_issue_id};
 if(typeof variables.id!=='string'||!variables.id)throw Error('provider_create_observer_id');
 const response=await readGraphql(CREATE_READ_QUERY,variables);
 const {data,error}=await db.rpc('production_provider_create_observe_v1',{p_epoch:request.epoch,p_attempt_id:request.attemptId,p_expected_outbox:request.expectedOutbox,p_expected_observation:request.expectedObservation??null,p_query:CREATE_READ_QUERY,p_variables:variables,p_response:response});if(error)throw error;return data;
}
export async function recoverObservedProviderCreate(db,{epoch,attemptId,expectedOutbox}){const {data,error}=await db.rpc('production_provider_create_observed_recover_v1',{p_epoch:epoch,p_attempt_id:attemptId,p_expected_outbox:expectedOutbox});if(error)throw error;return data;}
// Default endpoint stays fixed. An injected fetch may be used for isolated tests.
export function createReadOnlyProviderTransport({authorization,fetchImpl=fetch}) {
 if(typeof authorization!=='string'||!authorization)throw Error('provider_observer_authorization');
 return async(query,variables)=>{
  if(query!==CREATE_READ_QUERY||Object.keys(variables).join(',')!=='id'||typeof variables.id!=='string'||!variables.id)throw Error('provider_observer_query');
  const response=await fetchImpl('https://api.linear.app/graphql',{method:'POST',redirect:'error',signal:AbortSignal.timeout(7000),headers:{'content-type':'application/json',authorization},body:JSON.stringify({query,variables})});
  if(response.redirected)throw Error('provider_observer_redirect');
  const reader=response.body?.getReader();if(!reader)throw Error('provider_observer_body');let length=0;const chunks=[];try{while(true){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>1048576)throw Error('provider_observer_body_limit');chunks.push(value);}}finally{await reader.cancel();}
  const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}let body;try{body=JSON.parse(new TextDecoder().decode(bytes));}catch{body={parse_error:true};}if(!body||typeof body!=='object'||Array.isArray(body))body={invalid_body:true};return {http_status:response.status,body};
 };
}
