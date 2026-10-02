#!/usr/bin/env node
'use strict';
// Prints the one SQL statement that sets the switch of the Top Videos shadow job
// (flag analytics_top_videos_collect), so nobody retypes it with slugs from a chat.
// It connects to nothing and changes nothing: paste the printed statement into the
// Supabase SQL editor. The slugs are inputs, never stored in the repo.
//
//   node scripts/analytics-top-videos-flag.js --clients=slug1,slug2   shadow, those clients only
//   node scripts/analytics-top-videos-flag.js --all                   shadow, every active client
//   node scripts/analytics-top-videos-flag.js --off                   switch it off
const SLUG = /^[a-z0-9&]+$/;
const args = process.argv.slice(2);
const has = f => args.includes(f);
const clientsArg = (args.find(a => a.startsWith('--clients=')) || '').slice('--clients='.length);

function build() {
  const modes = [has('--off'), has('--all'), args.some(a => a.startsWith('--clients='))].filter(Boolean).length;
  if (modes !== 1) throw new Error('give exactly one of --clients=slug1,slug2, --all, --off');
  let value;
  if (has('--off')) value = { mode: 'off' };
  else if (has('--all')) value = { mode: 'shadow' };
  else {
    const clients = clientsArg.split(',').map(s => s.trim()).filter(Boolean);
    if (!clients.length) throw new Error('--clients needs at least one slug');
    const bad = clients.filter(s => !SLUG.test(s));
    if (bad.length) throw new Error(`${bad.length} slug(s) are not lowercase letters, digits or &`);
    value = { mode: 'shadow', clients: [...new Set(clients)] };
  }
  return `update public.syncview_runtime_flags set value = '${JSON.stringify(value)}'::jsonb where key = 'analytics_top_videos_collect';`;
}

if (require.main === module) {
  try { console.log(build()); } catch (e) { console.error(e.message); process.exit(2); }
}
module.exports = { build };
