# Higgsfield connector: mistakes made and the rule each one taught

Read this before changing `supabase/functions/higgsfield-mcp`. Append a row
every time a bug reaches the team; never rewrite old rows.

## The rules

1. **After changing any model, provider or request setting, make one real,
   cheap call on the live connector before handing it over** (a low quality
   image costs about one cent). Unit tests and CI never talk to OpenAI or
   Higgsfield, so a green PR proves nothing about whether the provider
   accepts the request.
2. **Check the provider's current docs, not memory.** Model names, sizes and
   supported settings change monthly. Memory has been wrong twice here.
3. **Test every tool shape the change touches**: a plain create, an edit with
   input images, and every recipe that uses the model. A fix to one path has
   broken another more than once.
4. **Claude caches tool definitions.** Any change to tool names, descriptions
   or viewer metadata needs the connector removed and re-added before testing.
5. **When a price estimate comes back as text instead of a number, treat it
   as unsupported until measured**; never show a guessed price.
6. **For anything the connector picks on its own (a Canva file, a model),
   write the rule down in the connector text with the real naming patterns,
   and exclude test files explicitly.**

7. **After any pricing change, run `node scripts/higgsfield-price-sweep.js`** (free; it
   asks the live connector to price every model and lists any it cannot read).
   When a new price shape appears, Claude can still quote a worked-out price
   (`quoted_usd`) instead of refusing or switching models.

## Log

| Date | What broke | Why | Rule |
|---|---|---|---|
| 2026-09 | Seedance video edit had no price | Higgsfield returned a per second rate as text | 5 |
| 2026-09 | GPT Image limited to a few fixed sizes | Worked from out of date memory of the API | 2 |
| 2026-09 | B-roll photo step took about 10 minutes | Used a Higgsfield queued model for a step a direct model does in seconds | 1 |
| 2026-09 | In-chat viewer did not appear | Claude had cached the old tool definitions | 4 |
| 2026-09 | Recipe plan card showed up blank | Claude shows the model only the structured result, which lacked the text | 3 |
| 2026-09 | A test Canva design was picked instead of the client's real file | Selection rule did not know the naming patterns or exclude tests | 6 |
| 2026-09-30 | Every GPT Image edit (expression fix recipe) failed | Kept sending `input_fidelity`, which the 2.5 models refuse; no live edit was made after the model switch | 1, 3 |
| 2026-10-01 | Seedance 2.0 (and 9 other models) could not be priced, so Claude suggested switching models | Higgsfield describes their prices in new sentence shapes (per generated second, video tokens, image tokens); the connector read only one shape | 7 |
| 2026-10-10 | `client_style` said the one client whose short name has "&" had no Synchro Brain folder, so its voice never reached thumbnail titles (or the caption writer) | Brain folders spell "&" as "and"; the folder match dropped the "&" instead, so the two names never met (found in a site check, OPEN_REPAIRS 400) | 6 |
