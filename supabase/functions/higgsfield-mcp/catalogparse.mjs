// Reads Higgsfield's public docs (llms-full.txt) into model entries: id, name,
// category, usage notes and input schema. Shared by scripts/higgsfield-catalog.js
// (writes catalog.ts) and the connector itself (index.ts refreshes its model
// list from the live docs at run time), so both read the docs the same way.
export const DOCS_URL = 'https://docs.higgsfield.ai/docs/llms-full.txt';

function category(id) {
  if (/genjutsu\/motion|motion-control/.test(id)) return 'motion-transfer';
  if (/object-swap/.test(id)) return 'object-swap';
  if (/video-extend/.test(id)) return 'video-extend';
  if (/video-edit/.test(id)) return 'video-edit';
  if (/first-last-frame/.test(id)) return 'first-last-frame-video';
  if (/reference-to-video|image-reference|video-reference/.test(id)) return 'reference-to-video';
  if (/image-to-video/.test(id)) return 'image-to-video';
  if (/text-to-video/.test(id)) return 'text-to-video';
  if (/cinema-studio/.test(id)) return 'cinematic-video';
  if (/marketing-studio/.test(id)) return 'marketing-image';
  if (/ads-studio/.test(id)) return 'marketing-image';
  if (/genjutsu\/restyle/.test(id)) return 'video-restyle';
  if (/qwen-image-3\/edit|grok-imagine-image/.test(id)) return 'image-edit';
  return 'text-to-image';
}

function strip(value) {
  if (Array.isArray(value)) return value.map(strip);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) if (k !== 'title') out[k] = strip(v);
    return out;
  }
  return value;
}

// Endpoints the connector cannot serve yet. Restyle needs a preset_id taken from
// a presets endpoint the connector has no tool for, so a teammate could never
// fill it in; leaving it out keeps it from being offered.
const SKIP = new Set(['higgsfield/genjutsu/restyle/v1.0']);

export function parseDocs(text) {
  const models = [];
  for (const sec of text.split(/\n(?=# )/)) {
    const id = (sec.match(/\*\*Endpoint ID:\*\* `([^`]+)`/) || [])[1];
    if (!id || SKIP.has(id)) continue;
    const name = sec.split('\n', 1)[0].slice(2).replace(/ API$/, '').trim();
    const notesBlock = (sec.match(/## Usage notes\n([\s\S]*?)\n## /) || [])[1] || '';
    const notes = notesBlock.split('\n').filter(l => l.startsWith('* ')).map(l => l.slice(2).replace(/\\/g, '').trim());
    // The docs now put the schema in a quoted block ("> " before every line);
    // older pages had it bare. Strip the quote marks, then read it as before.
    const bare = sec.replace(/^> ?/gm, '');
    const schemaText = (bare.match(/Complete JSON schema\*{0,2}\s*```json[^\n]*\n([\s\S]*?)```/) || bare.match(/Complete JSON schema">\s*```json[^\n]*\n([\s\S]*?)```/) || [])[1];
    if (!schemaText) continue;
    models.push({ id, name, category: category(id), notes, schema: strip(JSON.parse(schemaText)) });
  }
  return models.sort((a, b) => a.id.localeCompare(b.id));
}
