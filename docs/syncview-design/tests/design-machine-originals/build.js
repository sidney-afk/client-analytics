// Build SyncView: inject Inter font into the source placeholder, emit both outputs, sync the mirror.
// Source of truth (edit this): the scratchpad syncview-app.html (has __INTER_B64__ placeholder).
// Font blob is reused from the previously-built out/_sv.html so no external woff2 is needed.
const fs = require('fs');
const SRC = 'C:/Users/Sidney/AppData/Local/Temp/claude/C--Users/0ceffb3e-265c-423b-92f5-0f690f2e3f0d/scratchpad/syncview-app.html';
const OUT_FULL = 'out/SyncView.html';
const OUT_SV = 'out/_sv.html';
const MIRROR = 'out/syncview-app.src.html';

const src = fs.readFileSync(SRC, 'utf8');
if (src.indexOf('__INTER_B64__') < 0) throw new Error('placeholder __INTER_B64__ not found in source');

// reuse the font blob already embedded in the prior build
const prior = fs.readFileSync(OUT_SV, 'utf8');
const m = prior.match(/;base64,([A-Za-z0-9+/=]+)/);
if (!m) throw new Error('could not extract font blob from ' + OUT_SV);
const blob = m[1];

const built = src.split('__INTER_B64__').join(blob);
fs.writeFileSync(OUT_FULL, built);
fs.writeFileSync(OUT_SV, built);
fs.writeFileSync(MIRROR, src); // mirror keeps the placeholder, for auditors to read
console.log('BUILD OK  source=' + src.length + '  blob=' + blob.length + '  out=' + built.length);
