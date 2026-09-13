'use strict';
// Reuse the exact complete-V2 source installation/seed prefix, never execute its
// existing capture path as an import side effect.
const fs=require('fs'),path=require('path'),Module=require('module'),assert=require('assert/strict');
process.env.PROOF_APPLICATION_DATA_VERSION='v2';
const file=path.join(__dirname,'linear-exit-complete-application-recovery.js'),source=fs.readFileSync(file,'utf8');
const marker=" const complete=require('../scripts/linear-exit-complete-application-data');";
assert.equal(source.split(marker).length,2);
const prefix=source.slice(0,source.indexOf(marker));
const suffix=` await require('./helpers/control-recovery-proof').run(cluster,{currentPublic:process.argv.includes('--current-public')});
}catch(e){fs.writeFileSync(path.join(process.env.PROOF_OUTPUT_ROOT,'control-recovery-error.private.log'),String(e.stack||e));console.error('LINEAR_EXIT_CONTROL_RECOVERY_FAILED');process.exitCode=1;}finally{cluster.stop();}}main();`;
const m=new Module(file,module);m.filename=file;m.paths=Module._nodeModulePaths(__dirname);m._compile(prefix+suffix,file);
