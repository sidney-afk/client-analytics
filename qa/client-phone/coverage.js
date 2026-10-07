'use strict';
// Inventory existing native journeys; a capture or green geometry check never
// promotes a screenshot to visually clean. Reviews are recorded by PNG hash.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../..');
const arg = (key, fallback) => process.argv.find(v=>v.startsWith('--'+key+'='))?.slice(key.length+3) || fallback;
const destination = path.resolve(root, arg('out', 'docs/audits/2026-10-07-prism-phone'));
const list = (file, args=[]) => JSON.parse(execFileSync(process.execPath, [file, ...args, '--list'], {cwd:root,encoding:'utf8'}));
const widths = [375,390,430], themes = ['light','dark'];
const inventory = [
  ...list('qa/staff-phone-final-pass.js', ['--all-states']),
  ...list('docs/syncview-design/tests/kasper-admin-expanded-browser.js'),
];
const routes = ['today','calendar','sample-reviews','templates','filming-plans','tiktok-upload','home','workload','production','linear','kasper','time-off'];
for (const tab of routes) for (const kind of ['screen','tabs','more']) inventory.push({lane:'rules',name:tab+'-'+kind,tab});
for (const kind of ['caption-open','set-all','color','keyboard','empty-caption']) inventory.push({lane:'rules',name:'calendar-'+kind,tab:'calendar'});
for (const tab of ['calendar','sample-reviews']) for (const media of ['linked',tab==='calendar'?'warning':'missing-media']) for (const kind of ['card','actions']) inventory.push({lane:'design',name:tab+'-'+media+'-'+kind,tab});
for (const tab of ['calendar','samples']) for (const state of ['single','expanded-video','expanded-graphic','expanded-caption','approve-confirm','approved','change-draft','change-sent','empty','loading','error','refused-save','long-content','many']) inventory.push({lane:'client',name:tab+'-'+state,tab});
const unique = [...new Map(inventory.map(s=>[s.lane+':'+s.name,s])).values()];
// These are explicit discovery obligations, not claims that a native screen
// has each state or that a similarly named fixture proves it.
const dimensions = ['menus/sheets/pickers','editing','empty','loading','error','refused saves','long names/captions','many items','single item','main actions'];
const tabs = ['Today','Calendar','Samples','Templates','Filming','TikTok/Instagram','Analytics','Workload','SyncLinear','Submit','Kasper Review','Kasper Messages','Kasper Filming','Kasper Editors','Kasper Time Off','Kasper Sales Intake','Kasper Hiring','Kasper Onboarding','Kasper Credentials','Kasper Clients','Kasper Save problems','Kasper Ads','Kasper Quiz','Personal Time Off','Client Calendar','Client Samples'];
fs.mkdirSync(destination,{recursive:true});
const file = path.join(destination,'coverage.json');
const previous = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file,'utf8')) : {states:[],obligations:[]};
const fragments=fs.readFileSync(path.join(root,'src/index/manifest.txt'),'utf8').split(/\r?\n/).map(s=>s.trim()).filter(s=>s&&!s.startsWith('#'));
const sourceHash=crypto.createHash('sha256').update(Buffer.concat(fragments.map(name=>fs.readFileSync(path.join(root,'src/index',name))))).digest('hex');
if(previous.sourceHash!==sourceHash) {previous.states=[];previous.obligations=[];}
const oldStates = new Map(previous.states.map(s=>[s.lane+':'+s.name,s]));
const states = unique.map(s=>oldStates.get(s.lane+':'+s.name) || {...s,cells:widths.flatMap(width=>themes.map(theme=>({width,theme,status:'OPEN',capture:null,review:null}))) });
const oldObligations = new Map(previous.obligations.map(s=>[s.tab+':'+s.dimension,s]));
const obligations = tabs.flatMap(tab=>dimensions.map(dimension=>oldObligations.get(tab+':'+dimension) || {tab,dimension,status:'OPEN',evidence:[],reason:'Native state/action discovery and review pending'}));
fs.writeFileSync(file,JSON.stringify({sourceHash,widths,themes,states,obligations},null,2)+'\n');
const lines = ['# Prism phone coverage','','The finish line is a complete clean screenshot round followed by a clean fresh-review round. Geometry, captures and previous audits alone do not prove visual quality. Every cell starts OPEN; only a recorded personal visual review plus passing actions may mark it CLEAN.','','Widths: 375, 390, 430. Themes: light, dark. All data is fictional; requests are intercepted.','','## Native journey inventory','','| Lane | Native state | 375 light | 375 dark | 390 light | 390 dark | 430 light | 430 dark |','|---|---|---|---|---|---|---|---|'];
for (const s of states) lines.push('| '+[s.lane,s.name,...s.cells.map(c=>c.status)].join(' | ')+' |');
lines.push('','## Discovery obligations','','A screen with no meaningful instance of a state needs an explicit source-backed reason. Missing setups remain OPEN. New reachable states must be added before accepting a round.','','| Screen | '+dimensions.join(' | ')+' |','|---|'+dimensions.map(()=>'---').join('|')+'|');
for (const tab of tabs) lines.push('| '+[tab,...dimensions.map(d=>obligations.find(o=>o.tab===tab&&o.dimension===d).status)].join(' | ')+' |');
fs.writeFileSync(path.join(destination,'COVERAGE.md'),lines.join('\n')+'\n');
console.log('PHONE_COVERAGE: '+states.length+' native states; '+states.reduce((n,s)=>n+s.cells.length,0)+' width/theme cells; '+obligations.length+' discovery obligations; '+states.flatMap(s=>s.cells).filter(c=>c.status==='CLEAN').length+' clean cells');
