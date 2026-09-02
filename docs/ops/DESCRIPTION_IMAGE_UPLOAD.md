# Pasting an image into a description — scope

**Why this file exists.** Owner, 2026-08-31: *"could you look into pasting
images in the description? … same way it does in linear. So just a simple
pasting of a screenshot or whatever."*

**Half of it shipped.** PR #1204 (merged 2026-09-01) made markdown image syntax
render — before it, `![alt](url)` matched the *link* rule, so a description
carrying a screenshot drew a stray `!` in front of a blue link to a PNG. Any
image already reachable by URL now renders inline.

**The other half — actually pasting bytes — is blocked on one decision**, and
that PR said so rather than guessing:

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
| new failure modes | expiry mid-read, a resolve call per description, an offline/cached render with no valid URL |

### Option B — public bucket, unguessable path

The description stores a plain `https://…/storage/v1/object/public/<bucket>/<uuid>.png`.

| | |
|---|---|
| privacy | anyone holding the URL can fetch it |
| render path | **no change at all** — #1204 already renders https images |
| shared renderer | untouched |
| link rot | none |
| copy/paste out | works |
| new failure modes | none beyond the upload itself |

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

- **A write edge function.** `description-image-upload`, service-role, staff
  auth on the existing `x-syncview-key` / role headers, one image per call.
- **Bounds, all fail-closed:** an explicit MIME allowlist (`image/png`,
  `image/jpeg`, `image/webp`, `image/gif`), a byte ceiling (2 MB is roomy for a
  screenshot), a decoded-dimension ceiling, and a per-actor rate limit. Reject
  anything not on the list rather than sniffing — a permissive sniffer is how
  an SVG (which can carry script) gets in.
- **Never trust the client's filename or MIME.** Derive the extension from the
  allowlisted type and name the object with a fresh UUID.
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

**Recommendation: Option B.** A pasted screenshot then has exactly the property
the estate already accepts for every Drive and Frame.io link in the same field,
no client-facing surface renders these descriptions, and the render path does
not change at all — which means the paste handler is a write edge function and
a clipboard listener, not a rewrite of a renderer that also draws comments.

Option A is the stronger answer to a threat this surface does not currently
have, and it charges an async contract on a shared renderer to get it. If you
want the stronger property anyway, that is a legitimate call and the cost is
real but bounded; say so and it gets built that way.

**What I need from you:**

1. **A or B.** One word.
2. **Retention** — do pasted images live forever, or get cleaned up when the
   description that referenced them changes? *Forever* is a fine answer and is
   what B implies by default; the only reason to say otherwise is storage cost,
   which for screenshots is negligible for a long time.

Nothing else is blocked. Everything in §3 is the same either way and can be
written the moment the first answer lands.
