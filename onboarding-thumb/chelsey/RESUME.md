# Onboarding "Thumbnail style" rebuild — RESUME

Branch: claude/quirky-faraday-a987te

## Base
june1 = Chelsey Scaffidi "They Think They Know Me" (orange suit). Drive id 1SdAvReUBMq-7Iurs6vmfWG9SpyVWs5hJ
(GRA "Chelsey Scaffidi" project, "#5 June" folder). PASSES Higgsfield NSFW filter.
NOTE: original elegant baby thumbnail is NSFW-BLOCKED by Higgsfield — do not use it.

## 5 fonts locked (onboarding-thumb/chelsey/*.png) — june1 base, text restyled via Higgsfield nano_banana_pro (image-to-image, keep photo, change ONLY typography)
- elegant.png (native cream serif), bold.png (rounded white caps; user undecided keep vs rounder),
  handwritten.png (cream script), modern.png (thin caps), tiktok.png (Proxima sentence-case).
- Reference-transfer works: bold used box.jpg + bold.jpg as style refs.

## Effects engine = PROGRAMMATIC, $0, no Higgsfield (see effect_box_engine.py)
Isolate bright-text mask -> paint effects. stroke / shadow / box / highlight all proven on bold.
- box = per-line union rects -> scipy binary_closing+opening(disk r) => continuous IG rounded block
  with concave notch + gaussian AA. User wants it to EXACTLY match official IG box. NOT approved yet.
- highlight = recolor one word; per-font word-detection still needs fixing (thin/script break clustering).

## TODO (in order)
1. Finalize IG box on bold (match official IG exactly), get sign-off.
2. Decide bold keep vs rounder.
3. Replicate 4 effects to other 4 fonts; fix per-font highlight word box.
4. Wire into index.html thumbnail picker (OB_THUMB_STYLES ~line 11737): font segmented pills +
   Box/Highlight (+Stroke/Shadow) toggles, live preview, locked background.
5. QUEUED earlier: (a) swap onboarding logo to Synchro Social logo.png (Drive 1nlF6ei0-VczvwF4APv2-AOBp3l70ueHL;
   header ~line 11979 currently syncview-favicon.png). (b) per-main-section color system (s1-s8; subgroups
   video/thumb/misc already colored; avoid rainbow). (c) AI-avatar section (s8) hierarchy/grouping.

## Higgsfield: plan=ultimate, ~732 credits, ~2cr/1k gen. Use 1k.
## Context note: prior chat died at 32MB from accumulated review images. In new chat, load these assets.
