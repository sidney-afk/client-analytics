'use strict';
process.env.SXR_COURIER = process.env.SXR_COURIER || '0';
const R = require('path').resolve(__dirname, '../..');
const H = require(R + '/qa/probes/ot4_lib.js');
const { spawn } = require('child_process');
async function launch() {
  return H.PW.chromium.launch({ headless: true, args: ['--ignore-certificate-errors', '--disable-gpu'].concat(process.env.HTTPS_PROXY ? ['--proxy-server=' + process.env.HTTPS_PROXY] : []) });
}
function server() { return spawn('python3', ['-m', 'http.server', '8000'], { cwd: R, stdio: 'ignore' }); }
module.exports = { H, launch, server, R };
