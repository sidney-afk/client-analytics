# Pasting an image into a description — scope, decision, and what shipped

> **Decided and built, 2026-09-05.** Owner: *"if you think this is a good plan
> … then let's do it."* **Option B** (public bucket, unguessable path), images
> kept **forever**. Everything in §3 is now code; the sections below this box
> are the reasoning that led there and are kept as the record. What is left
> is owner-side: apply one migration, let one deploy lane run. See §0.

## 0. What shipped, and the two steps that make it live

**Code (this repository):**

| Piece | Where |
|---|---|
| Bucket `syncview-description-images` (public, 4 MiB, png/jpeg/webp/gif) + `description_images` ledger (service-role only) | `migrations/2026-09-05-description-images.sql` |
| Edge Function `description-image-upload` — verified admin/SMM actor, three-condition byte check, ceilings, hourly per-actor rate limit, UUID naming, ledger row (object removed if the row is refused) | `supabase/functions/description-image-upload/index.ts` + `policy.mjs` |
| Deploy lane, path-triggered on main, dispatchable by hand | `.github/workflows/deploy-description-image-upload.yml` |
| Paste + drop handler on the description editor, browser-side downscale to 1600px long edge, placeholder swap, save guard, 360px display cap with click-to-open | `index.html` (`_prodDescriptionPaste` and siblings) |
| Proof | `test/description-image-upload.js` (policy bytes + handler shape), `test/prod-description-image-paste.js` (editor behaviour, executed) |

**To make it live, in this order:**

1. **Apply the migration** in the Supabase SQL Editor:
   `migrations/2026-09-05-description-images.sql`. It is idempotent. It creates
   the bucket, the ledger, and the `description_image_upload_enabled` flag row
   (seeded ENABLED). Applied 2026-09-05; the flag row was added to the file
   after Codex review on #1310, so if the earlier version was the one run,
   the `insert into public.syncview_runtime_flags …` statement at its end is
   the one line still owed.
2. **Deploy the function.** Merging to `main` triggers
   `.github/workflows/deploy-description-image-upload.yml` automatically. If
   the merge landed before the migration was applied, nothing breaks: the
   function answers `503` (`rate_limit_unavailable`, because the ledger it
   counts does not exist yet) and the browser removes its placeholder and
   says the image could not be uploaded. Re-run the lane by hand if needed:
   https://github.com/sidney-afk/client-analytics/actions/workflows/deploy-description-image-upload.yml
3. Open any SyncLinear issue, Edit the description, Ctrl+V a screenshot.

**Until step 2 runs**, a paste gets the toast *"Image upload is not available
yet on this backend"* (the browser maps the 404 to that sentence) and the
description is left exactly as it was. Nothing else on the page changes.

**Kill switch.** The function reads `description_image_upload_enabled` before
it authenticates anyone and fails closed on a missing or malformed row. One
statement switches uploads off for every caller, cached tabs included, with
no deploy (`ROLLBACK.md`, Live State table). The browser answers *"Image
upload is switched off right now."*

**Rate limit is a reservation, not a look.** The ledger row is inserted
BEFORE the object and the count that decides the limit includes the caller's
own row, so ten screenshots dropped at once at the ceiling all withdraw
rather than all pass. A failed storage write withdraws the row too. Two
ceilings on that row: 120/hour per actor, and 600/hour per ROLE KEY. The
second exists because the actor header is caller-chosen and the role secret
is shared, so a stolen key could name each active member in turn; the role
that secret resolved to is the one thing the caller cannot forge.

**A header is not a file.** After the magic bytes agree with the label, the
body must also carry its format's closing structure (PNG `IEND`, GIF `0x3B`,
JPEG `FFD9`, a WebP RIFF length matching the file), so a signature-plus-IHDR
stub is refused as `image_incomplete` instead of stored forever as a URL that
renders broken.

**The robots know it exists.** `qa/probes/p96_description_image_upload.js`
runs nightly against the deployed function: the browser's preflight, the
refusal order (flag, key, roster), a real 1x1 PNG round trip through the
public URL, and the three byte refusals. It retains one 68-byte object per
run. It REQUIRES the `SYNCVIEW_STAFF_ACTOR` repository secret (an active
admin/SMM roster name the staff key's role resolves to) and fails without it
rather than skipping, so the nightly is red on p96 until the owner adds that
secret. Two owner-side items after merge, both one line:

1. `SYNCVIEW_STAFF_ACTOR` in repo Settings → Secrets and variables → Actions.
2. The role index, if the migration was applied before it was added:
   `create index if not exists description_images_role_created_idx on public.description_images (actor_role, created_at desc);`

**A PNG is walked, not suffix-matched.** Every chunk's length must fit, every
chunk's CRC must match, the first chunk must be a 13-byte IHDR, at least one
IDAT must carry data, and the walk must end on a zero-length IEND exactly at
the end of the file. A JPEG must reach a Start Of Scan before its EOI.

**Sizing, because it was the second half of the ask** (*"avoid things where
people paste something and it looks huge or horrible"*): a Retina screenshot
is 2x, so pasted raw it renders enormous, and Linear draws the mirrored
markdown image at natural size where no CSS of ours reaches. So the BROWSER
downscales to 1600px on the long edge before upload — the one lever that
sizes the picture on both surfaces — never upscales, keeps PNG as PNG (text
stays crisp, transparency survives) and passes a GIF through untouched. In
the SyncView panel a 360px height cap with `object-fit: contain` and a
zoom-in cursor keeps a tall capture from swallowing the layout; a click opens
the full image in a new tab.

**Not covered, on purpose:** images pasted INSIDE Linear arrive here as
`uploads.linear.app` signed URLs that need Linear's own auth, so they render
broken in SyncView. That is a proxy problem in the other direction and is
not touched by this change.

---


**Why this file exists.** Owner, 2026-08-31: *"could you look into pasting
images in the description? … same way it does in linear. So just a simple
pasting of a screenshot or whatever."*

**Half of it shipped.** PR #1204 (merged 2026-09-01) made markdown image syntax
render — before it, `![alt](url)` matched the *link* rule, so a description
carrying a screenshot drew a stray `!` in front of a blue link to a PNG. Any
image already reachable by URL now renders inline.

**The other half — actually pasting bytes — was blocked on one decision** (now
made, §0), and that PR said so rather than guessing:

> *"A paste handler needs somewhere to put the bytes, and that is a storage
> decision plus a deploy… whether description images follow [the private
> bucket] pattern or take a durable public URL… is an owner call and I have not
> made it."*

This file is that decision, written out so it can be answered in a sentence.

---

## 1. What exists today

**Rendering** (`_prodLinkify`, live since #1204):

- images are **opt-in per call and off by default**. The single opt-in is
  `_prodDescriptionHTML(..., rich = true)`, which passes `{ images: true }`.
- **descriptions only, never comments.** Comments are the one surface *clients*
  write on, so an image there would let a comment author post a tracking pixel
  that reports every staff reader's IP and reading time.
  `referrerpolicy="no-referrer"` hides *which page*, not who or when.
- **https only.** `javascript:` and `data:` in an `img src` are an XSS surface,
  and plain `http:` would be blocked as mixed content anyway.
- `referrerpolicy="no-referrer"` and `loading="lazy"` on every rendered image.

**Storage.** The estate has exactly **one** bucket:
`syncview-thumbnail-revisions`. It is **private**; a service-role edge function
writes it, and `thumbnail-revision-read` hands out **5-minute signed URLs** to
an authenticated staff caller.

**And the fact that decides most of this: there is no browser→storage path
anywhere in the estate.** Every byte that reaches Storage goes through an edge
function holding the service role. The browser has never held a key that can
write, and nothing here should be the first thing to change that.

---

## 2. The decision

Both options need the same write edge function (§3). They differ in **what the
description stores** and therefore in what has to happen at render time.

### Option A — private bucket, signed URL at render

The description stores a stable reference (`syncview-image:<id>`); the renderer
resolves it to a short-lived signed URL when it draws.

| | |
|---|---|
| privacy | strongest — the object is never publicly reachable |
| render path | **`_prodDescriptionHTML` has to become asynchronous**, or gain a resolve-then-repaint pass |
| shared renderer | `_prodLinkify` also draws comments; an async contract has to not leak into that path |
| link rot | none — a reference outlives any URL |
| copy/paste out | a pasted signed URL dies in five minutes, which will read as broken |
| **the Linear mirror** | **BREAKS — see below** |
| new failure modes | expiry mid-read, a resolve call per description, an offline/cached render with no valid URL |

**And it breaks the Linear mirror, which is the finding that changes the
weighting.** Raised by review on #1225 and verified: `description` is an
OUTBOUND OPERATION (`OUTBOUND_OPERATIONS` in `linear-outbound/mapping.mjs`),
and `linear-outbound` sends the description string to Linear **verbatim**.
Outbound is live for both SyncView-authoritative teams. So a description
carrying `syncview-image:<id>` puts that token into Linear as **literal text** —
the image renders in SyncView after the resolve pass and appears as a stray
string in Linear, which is the opposite of *"same way it does in linear."*
Option A therefore needs a durable Linear-compatible URL transformation of its
own — which is Option B wearing a costume — or it has to be ruled out.

### Option B — public bucket, unguessable path

The description stores a plain `https://…/storage/v1/object/public/<bucket>/<uuid>.png`.

| | |
|---|---|
| privacy | anyone holding the URL can fetch it |
| render path | **no change at all** — #1204 already renders https images |
| shared renderer | untouched |
| link rot | none |
| copy/paste out | works |
| **the Linear mirror** | **works** — see below |
| new failure modes | none beyond the upload itself |

**And the mirror keeps working, for a reason worth stating.** `![alt](https://…)`
is ordinary markdown that Linear renders as an image itself, so the same
description draws a picture on both surfaces — literally what was asked for.
It also survives the post-create verification: `collapseLinearAutolinks` exists
because Linear rewrites a BARE url into `[url](<url>)`, and it is deliberately
narrow enough to leave a real markdown link alone. An image link is a real
markdown construct with a label that is not its target, so nothing collapses and
nothing false-mismatches — the 2026-08-07 orphan defect's exact shape, avoided
by construction rather than by luck.

**The honest comparison is not "secure vs insecure".** It is: *does a
description image deserve stronger protection than everything already in these
descriptions?* Today a description's images are Drive and Frame.io links —
durable URLs that anyone holding them can open. Option B gives a pasted
screenshot exactly the property the estate already accepts for every other
asset in the same field. Option A gives it a stronger one, and charges an async
render on a shared renderer to do it.

**The thing that would change the answer — and I traced it rather than
leaving it open.** *Does any surface a **client** can reach render a deliverable
or batch description?* Writing one is admin/SMM only, but that is a write rule,
not a read rule, so the read paths were followed:

- `_prodDescriptionHTML(..., rich = true)` — the only image-enabled call — has
  exactly two call sites, both inside `_prodDescriptionPanelHTML`.
- That, `_prodProjectDetail` and `_prodBatchDetail` are reached only from the
  `_prodState.view` dispatch and the issue-detail panel: the **Production**
  surface.
- A client share link is confined to `['analytics','brief']`, asserted in two
  places (`if(!_isClientLink||!['analytics','brief'].includes(tab))return`).
  `production` is a staff header route and is not among them.
- The samples/review surface a client *can* reach renders comments, and
  comments are already image-disabled by construction.

**So no client-facing surface renders these descriptions**, which is what makes
Option B defensible rather than merely convenient. If that ever changes — a
client-visible batch panel, say — the choice has to be revisited, because
Option B's protection is the unguessability of the URL and nothing else.

---

## 3. The same either way

- **A write edge function.** `description-image-upload`, service-role, one image
  per call — and **bound to a verified actor, not just to the shared key.**
  Raised by review on #1225, correctly: `x-syncview-key` plus a caller-supplied
  role header authenticates *someone on staff* and nobody in particular, so it
  can neither enforce a per-actor rate limit nor stop an offboarded person who
  kept the key. `production-write` already does this properly — it requires
  `x-syncview-actor` and resolves it to exactly ONE active, role-compatible
  `team_members` row before it will write. This must do the same, and the
  reason is sharper here than there: the object it creates is durable and, under
  the public-bucket option, publicly readable.
- **Bounds, all fail-closed:** an allowlist of exactly `image/png`,
  `image/jpeg`, `image/webp`, `image/gif`; a byte ceiling (2 MB is roomy for a
  screenshot); a decoded-dimension ceiling; and a per-actor rate limit.
- **VALIDATE THE BYTES, not the label — three conditions, all required.** An
  earlier draft of this file said "reject anything not on the list rather than
  sniffing", and review on #1225 was right that this directs an implementer away
  from the check that makes the allowlist mean anything: an allowlist applied to
  a browser-supplied MIME value validates a *claim*, and SVG bytes labelled
  `image/png` satisfy it. So: (1) the DECLARED type is on the allowlist;
  (2) the file's magic bytes identify a type on the allowlist; (3) the two
  AGREE, and the bytes decode with the codec for that type. Any disagreement is
  a rejection. The point the original line was reaching for still stands — do
  not let a permissive sniffer *widen* the set, which is how an SVG gets in —
  but sniffing must NARROW it, never replace the allowlist.
- **Never trust the client's filename or MIME for naming either.** Derive the
  extension from the VERIFIED type and name the object with a fresh UUID.
- **A paste handler** on the description editor: `paste` → find image items on
  the clipboard → upload → insert `![name](url)` at the caret → on failure,
  leave the editor untouched and say so. A paste that half-works is worse than
  one that does not.
- **A deploy.** This is a new edge function, so it is owner-dispatched like
  every other one.

---

## 4. What must not be done

- **Do not give the browser a storage key.** Nothing in this estate has one,
  and an upload path is the worst place to start.
- **Do not admit `data:` URLs as a shortcut** for "no storage decision yet".
  It bypasses every size bound, bloats the description column, and reopens the
  `data:` hole #1204 deliberately closed.
- **Do not enable images in comments** to make the paste handler uniform. That
  is the tracking-pixel surface, and it is the reason the flag exists.
- **Do not reuse `syncview-thumbnail-revisions`.** It is scoped to one feature
  with its own retention and its own reader; a second unrelated content type in
  it makes both harder to reason about.

---

## 5. Recommendation, and the one thing I need

**Recommendation: Option B**, and review on #1225 made this less close than it
looked. A pasted screenshot then has exactly the property the estate already
accepts for every Drive and Frame.io link in the same field, no client-facing
surface renders these descriptions, the render path does not change at all — and
**the image appears in Linear too**, because `![alt](https://…)` is markdown
Linear renders itself. Option A's `syncview-image:<id>` token would reach Linear
as literal text, since `description` is mirrored verbatim. So Option A does not
merely cost more; it fails the sentence the request was made in.

Option A is the stronger answer to a threat this surface does not currently
have. It charges an async contract on a shared renderer, and it now also owes a
durable Linear-compatible URL transformation — which is Option B wearing a
costume. If you want the stronger property anyway, that is a legitimate call and
the cost is real, but it is a bigger number than this file first said.

**What I need from you:**

1. **A or B.** One word.
2. **Retention** — do pasted images live forever, or get cleaned up when the
   description that referenced them changes? *Forever* is a fine answer and is
   what B implies by default; the only reason to say otherwise is storage cost,
   which for screenshots is negligible for a long time.

Nothing else is blocked. Everything in §3 is the same either way and can be
written the moment the first answer lands.
