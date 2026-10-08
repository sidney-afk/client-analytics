'use strict';
// Native inventories only. Visual acceptance requires personal review tied to
// the PNG hash and passing actions; captures and geometry alone are not clean.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { PROFILES } = require('./profiles');
const root = path.resolve(__dirname, '../..');
const arg = (key, fallback) => process.argv.find(v=>v.startsWith('--'+key+'='))?.slice(key.length+3) || fallback;
const destination = path.resolve(root, arg('out', 'docs/audits/2026-10-07-prism-phone'));
const list = (file, args=[]) => JSON.parse(execFileSync(process.execPath, [file,...args,'--list'], {cwd:root,encoding:'utf8'}));
const scopeVersion = 'owner-2026-10-08';
const priority = ['Today','Calendar','Samples','Card detail sheet','Clients','TikTok upload','Analytics','Workload','Ads'];
const rare = ['error','refused saves','long names/captions','many items'];
const inventory = [
  ...list('qa/staff-phone-final-pass.js',['--all-states']),
  ...list('docs/syncview-design/tests/kasper-admin-expanded-browser.js'),
  ...list('docs/syncview-design/tests/client-calendar-expanded-browser.js'),
  ...list('docs/syncview-design/tests/client-links-expanded-browser.js'),
];
for (const tab of ['today','calendar','sample-reviews','tiktok-upload','home','workload']) for (const kind of ['screen','tabs','more']) inventory.push({lane:'rules',name:tab+'-'+kind,tab});
for (const kind of ['caption-open','set-all','color','keyboard','empty-caption']) inventory.push({lane:'rules',name:'calendar-'+kind,tab:'calendar'});
for (const tab of ['calendar','sample-reviews']) for (const media of ['linked',tab==='calendar'?'warning':'missing-media']) for (const kind of ['card','actions']) inventory.push({lane:'design',name:tab+'-'+media+'-'+kind,tab});
function classify(state) {
  const {lane,name}=state, client=lane.startsWith('client-');
  let screen;
  if(lane==='client-calendar-expanded') screen='Calendar';
  else if(lane==='client-links-expanded') screen=name.startsWith('samples-')?'Samples':'Analytics';
  else if(lane==='admin') screen=/^(clients(?:-|$)|client-)/.test(name)?'Clients':/^ads/.test(name)?'Ads':null;
  else if(name==='linear-detail') screen='Card detail sheet';
  else screen=[[/^today-/,'Today'],[/^calendar-/,'Calendar'],[/^(samples|sample-reviews)-/,'Samples'],[/^tiktok-/,'TikTok upload'],[/^(analytics|home)-/,'Analytics'],[/^workload-/,'Workload']].find(([pattern])=>pattern.test(name))?.[1];
  if(!screen || /analytics-(brief|content-calendar)/.test(name)) return null;
  const ownerScreen=screen;
  const kind=/loading|posting|sending/.test(name)?'loading':/empty|all-clear|no-account|no-posts/.test(name)?'empty':/save-error|denied/.test(name)?'refused saves':/error|failed|invalid-link/.test(name)?'error':/long/.test(name)?'long names/captions':/many/.test(name)?'many items':/tabs|more|menu|picker|client-search|popover|options|schedule|confirm|detail|edit|lightbox|notes|comparison|open|actions|caption|organize$|suggest-post/.test(name)?'menus/sheets open':'normal';
  if(client && /^(month|week)-post$|lightbox|notes|comparison/.test(name)) screen='Card detail sheet';
  if(rare.includes(kind) && !['Today','Calendar','Samples'].includes(screen)) return null;
  return {...state,screen,ownerScreen,audience:client?'client':'staff',kind};
}
const selected=inventory.map(classify).filter(Boolean);
// The older calendar-sheet/samples-sheet names mean the Sheet *view*, not a
// card detail overlay. Missing native setups must stay explicit discoveries.
for(const name of ['card-detail-menus','card-detail-empty','card-detail-loading']) selected.push({lane:'discovery',name,screen:'Card detail sheet',ownerScreen:'Card detail sheet',audience:'staff',kind:name.endsWith('empty')?'empty':name.endsWith('loading')?'loading':'menus/sheets open',setup:'OPEN: reach the native deliverable detail sheet; the Sheet view is not a detail sheet'});
const unique=[...new Map(selected.map(state=>[state.lane+':'+state.name,state])).values()].sort((a,b)=>priority.indexOf(a.screen)-priority.indexOf(b.screen)||a.audience.localeCompare(b.audience)||a.name.localeCompare(b.name));
fs.mkdirSync(destination,{recursive:true});
const file=path.join(destination,'coverage.json');
const previous=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):{states:[],obligations:[]};
const fragments=fs.readFileSync(path.join(root,'src/index/manifest.txt'),'utf8').split(/\r?\n/).map(s=>s.trim()).filter(s=>s&&!s.startsWith('#'));
const sourceHash=crypto.createHash('sha256').update(Buffer.concat(fragments.map(name=>fs.readFileSync(path.join(root,'src/index',name))))).digest('hex');
const reusable=previous.sourceHash===sourceHash && previous.scopeVersion===scopeVersion;
const oldStates=new Map((reusable?previous.states:[]).map(state=>[state.lane+':'+state.name,state]));
const states=unique.map(state=>({...state,cells:PROFILES.flatMap(profile=>(state.audience==='client'?['light']:['light','dark']).map(theme=>oldStates.get(state.lane+':'+state.name)?.cells.find(cell=>cell.profile===profile.id&&cell.width===profile.width&&cell.height===profile.height&&cell.theme===theme)||{profile:profile.id,width:profile.width,height:profile.height,theme,status:'OPEN',capture:null,review:null}))}));
const surfaces=priority.flatMap(screen=>['Calendar','Samples','Card detail sheet','Analytics'].includes(screen)?['staff','client'].map(audience=>({screen,audience})):[{screen,audience:'staff'}]);
const obligations=surfaces.flatMap(surface=>['normal','menus/sheets open','empty','loading','main actions',...(['Today','Calendar','Samples'].includes(surface.screen)?rare:[])].map(dimension=>(reusable&&previous.obligations.find(o=>o.screen===surface.screen&&o.audience===surface.audience&&o.dimension===dimension))||{...surface,dimension,status:'OPEN',evidence:[],reason:'Native setup, actions and personal review pending; nonexistent states need source-backed reasons'}));
const scope={priority,basicStates:['normal','menus/sheets open','empty','loading'],rareStatesOnly:['Today','Calendar','Samples'],clientTheme:'light only: client review pages intentionally use light',excluded:['Quiz','Save problems','all other tabs outside the owner-approved screen list'],note:'Legacy 360/390/430 CI guards remain regression checks. Historical galleries retain their original source/device binding.'};
fs.writeFileSync(file,JSON.stringify({scopeVersion,sourceHash,profiles:PROFILES,scope,states,obligations},null,2)+'\n');
const columns=PROFILES.flatMap(profile=>['light','dark'].map(theme=>({profile,theme})));
const lines=['# Prism device coverage','','Owner scope, 2026-10-08. The finish line is a complete clean round followed by a clean fresh-eyes round. A CLEAN cell requires personal judgment tied to its PNG hash and passing native actions; screenshots and geometry alone are insufficient.','','Devices: desktop 1440 x 900; iPhone 14 Pro / 16 Pro 393 x 852; Android 412 x 915. Staff uses light/dark. Client pages intentionally use light only; client dark cells below are not required.','','Priority: '+priority.join(' → ')+'.','','Each screen requires normal, menus/sheets open, empty and loading. Rare states are required only on Today, Calendar and Samples. Quiz, Save problems and unlisted screens are excluded. Existing 360/390/430 CI guards remain. All data is fictional and transports are intercepted. Unfinished Filming work is preserved privately as deferred, without acceptance.','','Earlier galleries and coverage are historical proof. No 375/390/430 acceptance transfers to these new device sizes. Add newly discovered states before accepting a round; explain absent states from source.','','## Native journey inventory','','| Screen | Audience / lane | State | Kind | '+columns.map(c=>c.profile.id+' '+c.theme).join(' | ')+' |','|---|---|---|---|'+columns.map(()=>'---').join('|')+'|'];
for(const state of states) lines.push('| '+[state.screen,state.audience+' / '+state.lane,state.name,state.kind,...columns.map(column=>state.cells.find(cell=>cell.profile===column.profile.id&&cell.theme===column.theme)?.status||'not used')].join(' | ')+' |');
lines.push('','## Native state and action discovery','','Missing setups stay OPEN. Sheet-view names do not prove a card detail overlay. Each requirement needs evidence or an explicit source-backed absence reason.','','| Screen | Audience | Requirement | Status | Reason |','|---|---|---|---|---|');
for(const obligation of obligations) lines.push('| '+[obligation.screen,obligation.audience,obligation.dimension,obligation.status,obligation.reason].join(' | ')+' |');
fs.writeFileSync(path.join(destination,'COVERAGE.md'),lines.join('\n')+'\n');
console.log('PHONE_COVERAGE: '+states.length+' scoped native states; '+states.reduce((n,state)=>n+state.cells.length,0)+' device/theme cells; '+obligations.length+' discovery obligations; '+states.flatMap(state=>state.cells).filter(cell=>cell.status==='CLEAN').length+' clean cells');
