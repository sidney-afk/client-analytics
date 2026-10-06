'use strict';
// Temporary serving origins are canonicalized by the capture runner. All other
// computed values and every screenshot byte must be identical.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = __dirname;
const before = JSON.parse(fs.readFileSync(path.join(root,'desktop-before/measurements.json'),'utf8'));
const after = JSON.parse(fs.readFileSync(path.join(root,'desktop-after/measurements.json'),'utf8'));
const rows = after.rows.map(row => {
  const old = before.rows.find(r => r.label===row.label && r.width===row.width && r.theme===row.theme);
  const name = row.label+'-'+row.theme+'-'+row.width+'.png';
  const a = fs.readFileSync(path.join(root,'desktop-before',name));
  const b = fs.readFileSync(path.join(root,'desktop-after',name));
  return {label:row.label,width:row.width,theme:row.theme,pixels:a.equals(b)?'identical':'different',styles:old?.styleHash===row.styleHash?'identical':'different',beforeSha256:crypto.createHash('sha256').update(a).digest('hex'),afterSha256:crypto.createHash('sha256').update(b).digest('hex'),beforeStyles:old?.styleHash,afterStyles:row.styleHash};
});
const passing = rows.filter(r => r.pixels==='identical' && r.styles==='identical').length;
const directory = path.join(root,'desktop');
fs.mkdirSync(directory,{recursive:true});
fs.writeFileSync(path.join(directory,'populated-parity.json'),JSON.stringify({rows,baselineFailures:before.failures,afterFailures:after.failures},null,2));
console.log('KASPER_ADMIN_DESKTOP: '+passing+'/'+rows.length+' populated native desktop screenshots and computed styles identical to main.');
if (passing!==rows.length || rows.length!==144 || before.failures.length || after.failures.length) process.exitCode=1;
