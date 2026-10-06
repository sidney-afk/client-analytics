'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { stripBlockComments } = require('./helpers/strip-comments');
const root = path.resolve(__dirname,'..');
const source = fs.readFileSync(path.join(root,'src/index/020-styles-surfaces.css.part'),'utf8');
const match = source.match(/\/\* POCKET-ADMIN-PHONE:BEGIN[\s\S]*?\*\/([\s\S]*?)\/\* POCKET-ADMIN-PHONE:END \*\//);
assert(match,'phone scope markers must exist');
function selectors(value) {
  let depth=0,start=0; const out=[];
  for(let i=0;i<value.length;i++) { if(value[i]==='(')depth++;if(value[i]===')')depth--;if(value[i]===','&&!depth){out.push(value.slice(start,i).trim());start=i+1;} }
  out.push(value.slice(start).trim());return out;
}
function check(css,capped=false) {
  css=stripBlockComments(css);let i=0,rules=0;
  while(i<css.length) {
    while(/\s/.test(css[i]||'')&&i<css.length)i++;
    if(i===css.length)break;
    const open=css.indexOf('{',i);assert(open>=0,'statements outside rules are forbidden');
    const prelude=css.slice(i,open).trim();let depth=1,end=open+1;
    while(end<css.length&&depth){if(css[end]==='{')depth++;if(css[end]==='}')depth--;end++;}
    assert.equal(depth,0,'balanced CSS');const body=css.slice(open+1,end-1);
    if(prelude.startsWith('@')) {
      const media=/^@media\s*\(\s*max-width\s*:\s*(\d+)px\s*\)$/.exec(prelude);
      assert(media&&Number(media[1])<=767,'every media query must cap at 767px');rules+=check(body,true);
    } else {
      assert(capped,'all phone rules must be within a phone media query');
      assert(selectors(prelude).every(s=>s==='html.pocket-admin-phone'||s.startsWith('html.pocket-admin-phone ')),'all selectors belong to the owned phone marker');rules++;
    }
    i=end;
  }
  return rules;
}
const rules=check(match[1]);assert(rules>100,'the full layout must be covered');
for(const bad of ['html.pocket-admin-phone body{color:red}', '@media(max-width:900px){html.pocket-admin-phone body{color:red}}','@media(max-width:767px){body{color:red}}'])assert.throws(()=>check(bad));
console.log('KASPER_ADMIN_SCOPE: '+rules+' rules; all capped at 767px and owned marker; widened/unscoped rules rejected.');
