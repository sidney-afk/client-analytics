'use strict';
// Shared UI fragments also own staff phone behavior; docs/backend changes do not.
function isStaffPhoneFile(file) {
 return /^(src\/index\/|js\/sv-|qa\/staff-phone|qa\/finch-phone\/)/.test(file)
  || /^(index\.html|\.gitattributes|qa\/staff-gate-seed\.js|scripts\/staff-phone-changed\.js|test\/staff-phone-rules-source\.js|\.github\/workflows\/calendar-unit-tests\.yml)$/.test(file)
  || /^docs\/syncview-design\/(staff-phone-rules\.(css|js|html)|tests\/(staff-phone-browser|staff-calendar-expanded-browser|staff-samples-expanded-browser|kasper-admin-expanded-browser)\.js)$/.test(file);
}
module.exports={isStaffPhoneFile};
if(require.main===module){
 const {execFileSync}=require('node:child_process');
 const [base,head]=process.argv.slice(2);
 if(!base||!head)throw Error('Expected base and head commits');
 const changed=execFileSync('git',['diff','--name-only','-z',base,head],{encoding:'utf8'}).split('\0').filter(Boolean).some(isStaffPhoneFile);
 if(process.env.GITHUB_OUTPUT)require('node:fs').appendFileSync(process.env.GITHUB_OUTPUT,'changed='+changed+'\n');
 console.log('STAFF_PHONE_FILES: '+(changed?'changed; run phone matrix':'unchanged; skip phone matrix'));
}
