'use strict';
/*
 * Nano Banana (Google's image models) is switched off for the team; GPT Image
 * does the same job (owner's decision, 2026-10-16). The Google key never had
 * quota, so every call ever made failed with Google's raw English quota error.
 *
 * - direct.ts (run here for real, Google and OpenAI mocked): the two Google
 *   models are not offered, are never priced, and runDirect refuses them
 *   before any fetch, so no Google call can happen. Asking by id or name is
 *   recognised and mapped to the same request in GPT Image's settings.
 * - index.ts (static; the connector runs under Deno): the shortlist, the
 *   expression-fix recipe and the instructions no longer offer them, and
 *   create / price_check / model_details / recipe_plan / run_recipe answer
 *   a Nano Banana ask with the switched-off line and a GPT Image card,
 *   making nothing.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', 'supabase', 'functions', 'higgsfield-mcp');
const read = (f) => fs.readFileSync(path.join(dir, f), 'utf8');
const OFF = 'Nano Banana is switched off for the team. GPT Image does the same job; here is its price.';

(async () => {
  const fetched = [];
  globalThis.fetch = async (url) => { fetched.push(String(url)); throw new Error('no network in this test'); };
  const env = { OPENAI_KEY: 'test-openai', GOOGLE_AI_KEY: 'test-google' };
  globalThis.Deno = { env: { get: (k) => env[k] } };
  const d = await import(path.join(dir, 'direct.ts'));

  // One switch, off.
  assert.strictEqual(d.GOOGLE_IMAGE_ENABLED, false, 'the Google switch is off');
  assert.deepStrictEqual(d.GOOGLE_IMAGE_IDS, ['google/nano-banana', 'google/nano-banana-pro']);

  // Not offered, not routed, not priced.
  const ids = d.DIRECT_MODELS.map((m) => m.id);
  assert.deepStrictEqual(ids, ['openai/gpt-image', 'openai/gpt-image-fast'], 'only GPT Image is offered directly');
  for (const id of d.GOOGLE_IMAGE_IDS) {
    assert.strictEqual(d.isDirect(id), false, id + ' is not a direct model while off');
    assert.deepStrictEqual(d.directEstimate(id, { prompt: 'a dog' }), { error: OFF }, id + ' is never priced');
  }

  // No Google call can happen: refused before any image or API fetch.
  for (const id of d.GOOGLE_IMAGE_IDS) {
    await assert.rejects(d.runDirect(id, { prompt: 'a dog', image_urls: ['https://example.com/a.png'] }, async () => { fetched.push('input'); throw new Error('fetched'); }), (e) => e.message === OFF);
  }
  assert.deepStrictEqual(fetched, [], 'nothing was fetched for a Google model');

  // Asked for by id or by name.
  for (const ask of ['google/nano-banana', 'google/nano-banana-pro', 'nano-banana', 'Nano Banana Pro', '  NANO_BANANA ', 'nanobanana']) {
    assert.strictEqual(d.asksSwitchedOff(ask), true, JSON.stringify(ask) + ' is a Nano Banana ask');
  }
  for (const ask of ['openai/gpt-image', 'openai/gpt-image-fast', 'xai/grok-imagine-image-2.0', 'alibaba/qwen-image-3/edit', '', undefined, null]) {
    assert.strictEqual(d.asksSwitchedOff(ask), false, JSON.stringify(ask) + ' is not');
  }

  // The same request in GPT Image's settings, priced like GPT Image.
  assert.deepStrictEqual(d.gptImageInputs({ prompt: 'p', image_urls: ['https://x/a.png'], image_size: '2K', aspect_ratio: '9:16' }),
    { prompt: 'p', image_urls: ['https://x/a.png'], size: '1152x2048', quality: 'medium' });
  assert.deepStrictEqual(d.gptImageInputs({ prompt: 'p', image_size: '4K' }), { prompt: 'p', size: 'auto', quality: 'medium' });
  for (const shape of ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9']) {
    const est = d.directEstimate('openai/gpt-image', d.gptImageInputs({ prompt: 'p', aspect_ratio: shape }));
    assert.ok(est.usd > 0, 'every Nano Banana shape maps to a GPT Image size it accepts: ' + shape);
  }

  // GPT Image itself is unchanged.
  const gpt = d.directEstimate('openai/gpt-image', { prompt: 'a dog', size: 'auto', quality: 'medium' });
  assert.ok(gpt.usd > 0 && gpt.usd < 1, 'GPT Image still prices');

  // index.ts wiring.
  const src = read('index.ts');
  const goTo = src.slice(src.indexOf('const GO_TO'), src.indexOf('const ALL_MODELS'));
  assert.ok(!/"google\/nano-banana/.test(goTo.replace(/GOOGLE_IMAGE_ENABLED \? \["google\/nano-banana"\]/, '')), 'the shortlist offers Nano Banana only behind the switch');
  const recipes = src.slice(src.indexOf('const RECIPES'), src.indexOf('const RECIPE_BY_KEY'));
  assert.ok(/models: \["openai\/gpt-image", \.\.\.\(GOOGLE_IMAGE_ENABLED \? GOOGLE_IMAGE_IDS : \[\]\)/.test(recipes), 'the expression fix offers Nano Banana only behind the switch');
  const instr = src.slice(src.indexOf('const INSTRUCTIONS'), src.indexOf('const EMPTY'));
  assert.ok(!/then Nano Banana|GPT Image and Nano Banana/.test(instr), 'the instructions no longer recommend Nano Banana');
  assert.ok(/Nano Banana \(Google\) is switched off for the team/.test(instr), 'and say it is switched off');
  assert.ok(!/plus GPT Image and Nano Banana/.test(src), 'start_here no longer lists it');

  const tools = src.slice(src.indexOf('async function callTool'));
  const offBranch = tools.slice(tools.indexOf('if ((name === "price_check" || name === "create") && asksSwitchedOff(args.model))'));
  assert.ok(offBranch.length > 0 && tools.indexOf('asksSwitchedOff(args.model))') < tools.indexOf('if (name === "price_check" || name === "create") {'), 'create and price_check catch a Nano Banana ask first');
  const offBody = offBranch.slice(0, offBranch.indexOf('\n  }\n'));
  assert.ok(/SWITCHED_OFF_TEXT/.test(offBody) && /planCard\("openai\/gpt-image"/.test(offBody), 'it answers with the switched-off line and a GPT Image card');
  assert.ok(!/submitJob|runDirect|background\(/.test(offBody), 'and makes nothing');
  assert.ok(/name === "model_details"\) \{\n    if \(asksSwitchedOff\(args\.model\)\)/.test(tools), 'model_details answers a Nano Banana ask too');
  const recipe = tools.slice(tools.indexOf('if (name === "recipe_plan" || name === "run_recipe")'));
  assert.ok(/const off = asksSwitchedOff\(args\.model\);/.test(recipe) && /if \(name === "recipe_plan" \|\| off\) \{/.test(recipe), 'a recipe asked on Nano Banana shows the GPT Image plan and runs nothing');
  assert.ok(recipe.indexOf('if (name === "recipe_plan" || off)') < recipe.indexOf('submitJob('), 'before any job is submitted');

  console.log('higgsfield-nano-banana-off: Nano Banana is switched off, never called, and an ask for it gets a GPT Image price card ✅');
})().catch((e) => { console.error(e); process.exit(1); });
