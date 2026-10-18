// Seed N throwaway review cards on the TEST client (caption waiting on the client;
// video and thumbnail already approved, since a seed has no work item and a client
// answer on those parts is refused: native_link_required). Prints the ids.
// node qa/gauntlet-client/seed.js <tag> <n>    |   node qa/gauntlet-client/seed.js --archive <id,...>
'use strict';
const G = require('./lib.js');
const a = process.argv.slice(2);
if (a[0] === '--archive') { for (const id of a[1].split(',')) console.log(id, G.archiveCalSafe(id) ? 'archived' : 'NOT archived'); process.exit(0); }
const tag = a[0] || 'g', n = Number(a[1] || 3), ts = Date.now(), ids = [];
for (let i = 0; i < n; i++) {
  const id = `p_gcl_${tag}_${ts}_${i}`;
  G.upCal({ id, name: `GCL ${tag.toUpperCase()} ${i + 1}`, platforms: 'instagram', scheduled_date: new Date(Date.now() + (3 + i) * 86400e3).toISOString().slice(0, 10),
    video_status: 'Approved', graphic_status: 'Approved', caption_status: 'Client Approval', status: 'Client Approval',
    caption: `Gauntlet client caption ${tag} ${i + 1}. A short line to review.`,
    thumbnail_url: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg', asset_url: 'https://example.com/gauntlet.mp4' });
  ids.push(id);
}
console.log(ids.join(','));
