const fs = require('fs');
const path = require('path');

const index = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

function ok(condition, message) {
  if (!condition) {
    console.error('FAIL:', message);
    process.exitCode = 1;
    return;
  }
  console.log('PASS:', message);
}

const start = index.indexOf('function openCalPreview(id)');
const end = index.indexOf('function closeCalPreview()', start);
const preview = start >= 0 && end > start ? index.slice(start, end) : '';

ok(preview.length > 0, 'Calendar month/week preview is present');
ok(
  /cal-preview-label">Thumbnail URL<\/div><div class="cal-preview-val">\$\{linkify\(p\.thumbnail_url\)\}/.test(preview),
  'Calendar month/week preview shows thumbnail_url through the safe clickable-link renderer'
);
ok(
  preview.indexOf('linkify(p.asset_url)') < preview.indexOf('linkify(p.thumbnail_url)'),
  'Thumbnail URL appears directly after Asset URL'
);

if (!process.exitCode) console.log('calendar-preview-thumbnail-link checks passed');
