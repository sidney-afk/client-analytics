'use strict';
// Preparation only: returns a changed copy; no n8n API or workflow execution.
function prepare(workflow) {
  const copy=JSON.parse(JSON.stringify(workflow));
  if(!Array.isArray(copy.nodes))throw Error('WORKFLOW_NODES_REQUIRED');
  const before="let text = 'URGENT TWEAKS NEEDED\\nClient: ' + client + '\\nBy when: ASAP\\nSyncView: ' + syncUrl + '\\nLinear: ' + issue;";
  const after="let text = 'URGENT TWEAKS NEEDED\\nClient: ' + client + '\\nBy when: ASAP\\nSyncView: ' + syncUrl;";
  const matches=copy.nodes.filter(n=>typeof n.parameters?.jsCode==='string'&&n.parameters.jsCode.includes(before));
  if(matches.length!==1)throw Error('EXACT_EDITOR_TEMPLATE_REQUIRED');
  const code=matches[0].parameters.jsCode;
  if(code.split(before).length!==2||!code.includes("const syncUrl = 'https://syncview.synchrosocial.com/?prod=1&d=' + encodeURIComponent(parse.identifier) + '#production';"))throw Error('WEBSITE_TEMPLATE_DRIFT');
  matches[0].parameters.jsCode=code.replace(before,after);
  return copy;
}
module.exports={prepare};
