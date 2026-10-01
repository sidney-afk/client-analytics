#!/usr/bin/env node
// Asks the LIVE Higgsfield connector for a price on every model (free; makes
// nothing) and lists the ones it cannot price. Run after any pricing change
// and now and then, since Higgsfield changes how it describes prices.
//   HF_MCP_URL='<connector link with ?key=>' node scripts/higgsfield-price-sweep.js
// The link is private: pass it in the environment, never commit it.
'use strict';
const URL_ = process.env.HF_MCP_URL;
if (!URL_) { console.error('Set HF_MCP_URL to the connector link.'); process.exit(2); }
const IMG = 'https://raw.githubusercontent.com/python-pillow/Pillow/main/Tests/images/hopper.jpg';
const VID = 'https://raw.githubusercontent.com/mediaelement/mediaelement-files/master/big_buck_bunny.mp4';
const AUD = 'https://raw.githubusercontent.com/mediaelement/mediaelement-files/master/AirReview-Landmarks-02-ChasingCorporate.mp3';
async function call(name, args) {
  const r = await fetch(URL_, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) });
  return (await r.json()).result.content[0].text;
}
function sample(field, type) {
  const one = /video/.test(field) ? VID : /audio/.test(field) ? AUD : /image/.test(field) ? IMG : null;
  if (one) return type === 'array' ? [one] : one;
  return { string: 'a person smiling at the camera', array: [IMG], integer: 5, number: 5, boolean: false }[type] ?? 'x';
}
(async () => {
  const ids = new Set();
  for (const q of ['video', 'image', 'seedance', 'kling', 'veo', 'audio', 'edit', 'wan', 'minimax', 'soul', 'avatar', 'speech', 'music']) {
    for (const m of (await call('find_models', { query: q })).matchAll(/\[([a-z0-9][^\]\s]*\/[^\]\s]+)\]/g)) ids.add(m[1]);
  }
  const bad = [];
  await Promise.all([...ids].sort().map(async (id) => {
    const inputs = {};
    for (const line of (await call('model_details', { model: id })).split('\n')) {
      const m = line.match(/^- (\w+) \(required\): (\w+)/);
      if (m) inputs[m[1]] = sample(m[1], m[2]);
    }
    const t = await call('price_check', { model: id, inputs });
    if (/cannot read/.test(t)) bad.push(`${id}: ${t.split('\n')[0].slice(0, 240)}`);
  }));
  console.log(`${ids.size} models checked, ${bad.length} with a price description the connector cannot read.`);
  for (const b of bad.sort()) console.log('- ' + b);
  process.exit(bad.length ? 1 : 0);
})();
