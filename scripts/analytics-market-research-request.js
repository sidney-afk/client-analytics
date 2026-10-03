#!/usr/bin/env node
'use strict';
// Prints the one SQL statement that asks the Market Research shadow job for a brief (a row in
// analytics_market_research_collect_queue), so nobody retypes it with a slug and keywords by hand.
// It connects to nothing and changes nothing: paste the printed statement into the Supabase SQL editor.
// The slug and the keywords are inputs, never stored in the repo. One brief costs real Apify, Whisper and
// Claude money: the switch row only lets the clients it lists be built, and caps new briefs per day.
//
//   node scripts/analytics-market-research-request.js --client=<slug> --keyword="first" --keyword="second"
//   (1 to 10 keywords, each 1 to 80 characters)
// The same script prints the statement that sets the job's switch (flag analytics_market_research_collect):
//   node scripts/analytics-market-research-request.js --switch-shadow --client=<slug> [--max-new-per-day=2]
//   node scripts/analytics-market-research-request.js --switch-off
// Run it in a terminal from the repository folder; what it prints is the SQL to paste into the Supabase SQL editor.
const SLUG = /^[a-z0-9&]+$/;

function build(args) {
  if (args.includes('--switch-off')) return switchSql({ mode: 'off' });
  if (args.includes('--switch-shadow')) return buildSwitch(args);
  const one = name => {
    const hits = args.filter(a => a.startsWith(`--${name}=`)).map(a => a.slice(name.length + 3));
    return hits;
  };
  const clients = one('client');
  if (clients.length !== 1 || !SLUG.test(clients[0])) throw new Error('give exactly one --client=<slug> (lowercase letters, digits or &)');
  const keywords = one('keyword').map(k => k.trim()).filter(Boolean);
  if (keywords.length < 1 || keywords.length > 10) throw new Error('give 1 to 10 --keyword="..." values');
  if (keywords.some(k => k.length > 80 || /[\u0000-\u001f\u007f]/.test(k))) throw new Error('a keyword is longer than 80 characters or has a control character');
  const list = JSON.stringify([...new Set(keywords)]).replace(/'/g, "''");
  return `insert into public.analytics_market_research_collect_queue (client_slug, keywords, requested_by) values ('${clients[0]}', '${list}'::jsonb, 'script');`;
}

function switchSql(value) {
  return `update public.syncview_runtime_flags set value = '${JSON.stringify(value)}'::jsonb where key = 'analytics_market_research_collect';`;
}

function buildSwitch(args) {
  const clients = args.filter(a => a.startsWith('--client=')).map(a => a.slice(9));
  if (!clients.length || clients.some(c => !SLUG.test(c))) throw new Error('--switch-shadow needs one or more --client=<slug> (lowercase letters, digits or &)');
  const capArg = args.find(a => a.startsWith('--max-new-per-day='));
  const cap = capArg ? Number(capArg.slice(18)) : 2;
  if (!Number.isInteger(cap) || cap < 1 || cap > 10) throw new Error('--max-new-per-day must be a whole number from 1 to 10');
  return switchSql({ mode: 'shadow', clients: [...new Set(clients)], max_new_per_day: cap });
}

if (require.main === module) {
  try { console.log(build(process.argv.slice(2))); } catch (e) { console.error(e.message); process.exit(2); }
}
module.exports = { build };
