'use strict';
// Explicit isolated lane; normal entry-boundary resume remains unchanged.
if(process.env.F63_REQUIRE_POSTGRES!=='1'){console.log('SKIP installation interruption: owned disposable PostgreSQL required');process.exit(0);}
process.env.LINEAR_EXIT_INSTALL_INTERRUPTION='1';
require('./linear-exit-install-resume');
