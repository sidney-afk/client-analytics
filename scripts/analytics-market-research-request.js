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
const SLUG = /^[a-z0-9&]+$/;

function build(args) {
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

if (require.main === module) {
  try { console.log(build(process.argv.slice(2))); } catch (e) { console.error(e.message); process.exit(2); }
}
module.exports = { build };
