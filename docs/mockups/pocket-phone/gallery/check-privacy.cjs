// Read-only publication check. The gallery itself makes no backend requests.
// Uses the existing repository gate's public roster configuration; no key or
// roster identity is copied into these preview sources or reports.
const fs = require('node:fs');
const path = require('node:path');
const repo = path.resolve(__dirname, '../../../..');
const root = path.resolve(__dirname, '..');
const code = fs.readFileSync(path.join(repo, 'scripts/repo-identity-exposure-check.js'), 'utf8');
const key = code.match(/\|\| '(sb_publishable_[^']+)'/)[1];
const origin = code.match(/\|\| '(https:\/\/[^']+)'/)[1];
async function rows(table) {
  const response = await fetch(origin + '/rest/v1/' + table, { headers: { apikey: key } });
  if (!response.ok) throw new Error('Public roster read failed.');
  return response.json();
}
(async () => {
  const [clients, team] = await Promise.all([
    rows('clients?select=slug,kind&limit=1000'), rows('team_members?select=name,active&limit=1000')
  ]);
  const terms = [...clients.filter(c => ['client', 'test'].includes(c.kind)).map(c => c.slug),
    ...team.map(c => c.name).filter(n => n && n.includes(' '))].filter(Boolean);
  let files = 0, protectedMatches = 0, tokenPatterns = 0;
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(file); continue; }
      if (!/\.(html|css|js|cjs|json|md|txt)$/.test(file) || file.endsWith('export-privacy.json')) continue;
      files++;
      const text = fs.readFileSync(file, 'utf8');
      protectedMatches += terms.filter(term => text.toLowerCase().includes(term.toLowerCase())).length;
      tokenPatterns += (text.match(/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}|-----BEGIN [A-Z ]*PRIVATE KEY|[?&](?:token|key)=[A-Za-z0-9_-]{12,}/g) || []).length;
    }
  }
  walk(root);
  const snapshots = JSON.parse(fs.readFileSync(path.join(__dirname, 'snapshots.json'), 'utf8'));
  const originalHandlers = Object.values(snapshots).reduce((n, text) => n + (text.match(/\son[a-z]+\s*=/gi) || []).length, 0);
  const externalAttributes = Object.values(snapshots).reduce((n, text) => n + (text.match(/\s(?:href|src|srcset|action|poster|formaction)\s*=/gi) || []).length, 0);
  const renderer = fs.readFileSync(path.join(__dirname, 'preview.js'), 'utf8');
  const networkCalls = (renderer.match(/\b(?:fetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon)/g) || []).length;
  const report = { files, rosterTerms: terms.length, protectedMatches, tokenPatterns, originalHandlers, externalAttributes, networkCalls };
  const output = process.argv[2];
  if (output) fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  console.log('EXPORT_PRIVACY: ' + JSON.stringify(report));
  process.exitCode = protectedMatches || tokenPatterns || originalHandlers || externalAttributes || networkCalls ? 1 : 0;
})().catch(error => { console.error(error.message); process.exitCode = 1; });
