// Build the standalone design artifact. Does not build or modify the app.
const fs = require('node:fs');
const path = require('node:path');
const dir = __dirname;
const read = name => fs.readFileSync(path.join(dir, name), 'utf8');
const asset = (name, mime) => `data:${mime};base64,${fs.readFileSync(path.join(dir, name)).toString('base64')}`;
const scriptJson = value => JSON.stringify(value).replace(/</g, '\\u003c');
const inlineScript = value => value.replace(/<\/script/gi, '<\\/script');
let fonts = read('fonts.css').replace(/url\('([^']+)'\)/g,
  (_, name) => `url('${asset(name, 'font/ttf')}')`);
let renderer = read('preview.js')
  .replaceAll('calendar-thumbnail.png', asset('calendar-thumbnail.png', 'image/png'))
  .replaceAll('example-chart.svg', asset('example-chart.svg', 'image/svg+xml'));
const policy = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; frame-src about:; connect-src 'none'; form-action 'none'; base-uri 'none'">`;
const phone = read('phone-shell.html')
  .replace('<head>', '<head>' + policy)
  .replace('<!--PM_STYLES-->', `<style>${fonts}\n${read('original-skin.css')}\n${read('phone-polish.css')}</style>`)
  .replace('<!--PM_DATA-->', `<script>/*PM_QUERY*/window.PM_DATA=${scriptJson(JSON.parse(read('snapshots.json')))};window.PM_DEFS=${scriptJson(JSON.parse(read('states.json')))};</script>`)
  .replace('<!--PM_RENDERER-->', `<script>${inlineScript(renderer)}</script>`);
const gallery = read('gallery-shell.html')
  .replace('<head>', '<head>' + policy)
  .replace('<!--PM_FONTS-->', `<style>${fonts}</style>`)
  .replace('<!--PM_PHONE_DOCUMENT-->', `<script type="application/json" id="pm-phone-document">${scriptJson(phone)}</script>`);
fs.writeFileSync(path.join(dir, 'gallery.html'), gallery);
console.log(`GALLERY_BUILD: ${JSON.parse(read('states.json')).length} states; standalone offline HTML generated; application files untouched.`);
