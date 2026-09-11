'use strict';
require('./linear-exit-priority-snapshot-postgres').run({combined:true}).catch(error=>{console.error(error.stack);process.exitCode=1;});
