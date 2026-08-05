# Setting up the Graphics drill artifact (owner, ~5 minutes)

**What this is for.** The daily self-test creates a fake Graphics job and walks
it through the same steps a designer would. One of those steps is "send for SMM
approval" — and SyncView deliberately refuses to send a graphic for approval
when there is no actual graphic file attached. That rule is correct and we are
not turning it off. So the test needs one small, permanently-parked picture file
to use as its stand-in graphic.

You do this once. After that the test can prove the whole Graphics path every
night instead of skipping that one step.

---

## Step 1 — Make the picture

Any small ordinary image is fine. A screenshot works. It must be:

- **a real picture file** — `.png` or `.jpg`
- **small** — under about 5 MB. Small matters: Google shows a "can't scan this
  file for viruses" warning page for big files, and the test reads that warning
  page instead of the picture and fails.
- **not confidential** — it will be readable by anyone who has the link. A
  colour swatch, a logo, or a screenshot of nothing sensitive is ideal.

Name it something obvious like `syncview-test-graphic.png` so nobody deletes it
later wondering what it is.

## Step 2 — Put it in Google Drive

1. Go to <https://drive.google.com>.
2. Drag the picture into any folder you own. A folder you will not clean out —
   **if this file is ever deleted or moved to Trash, the nightly test starts
   failing again.**

## Step 3 — Share it so the test can read it

1. **Right-click** the file → **Share** → **Share** again.
2. In the dialog, find the section headed **General access**. It will probably
   say **Restricted**.
3. Click **Restricted** and change it to **Anyone with the link**.
4. To the right of that, make sure the role says **Viewer** (not Editor).
5. Click **Copy link**. This puts the link on your clipboard.
6. Click **Done**.

The link you copied looks like this:

```
https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz/view?usp=sharing
```

That is the correct link. You do not need to edit it — paste it exactly as
copied.

> **This will not work if:** you copied the link to a *folder* rather than a
> file; you used a Google Doc, Sheet or Slide instead of a picture file; access
> is still **Restricted**; or the file is in Dropbox with an expiring link.
> Dropbox share links do work, but Drive is simpler — use Drive unless you have
> a reason not to.

## Step 4 — Save the link in GitHub

1. Go to <https://github.com/sidney-afk/client-analytics/settings/variables/actions>
   (Settings → Secrets and variables → Actions → **Variables** tab).
2. Click the green **New repository variable** button.
3. In **Name**, type exactly — capitals and underscores matter:

   ```
   PRODUCTION_WRITE_DRILL_GRAPHICS_ARTIFACT_URL
   ```

4. In **Value**, paste the link you copied.
5. Click **Add variable**.

It goes under **Variables**, not **Secrets** — the link is not confidential and
keeping it visible means anyone can check whether it still works.

**That is the whole change.** Nothing needs to be edited in code afterwards; the
drill already reads this variable and simply finds it empty today.

---

## What you should see afterwards

On the next daily run of **Production write gateway TEST drill**, the report
changes in exactly two ways:

- `graphics_artifact_attached` becomes `true`
- `graphics_approval_artifact` **disappears** from `parked_assertions`

Once that happens the nightly test is proving that a Graphics job can be
created, commented on, moved through approval, and reflected in Linear — which
is the thing the Graphics cutover depends on.

`description_roundtrip` will still be listed in `parked_assertions`. That is a
different, unrelated item waiting on an Edge Function deploy, and it is not
something this file fixes.

## If it does not work

> **Read this first — do not start by re-sharing the file. Nothing about your
> file is wrong.**
>
> **The probe cannot fetch a Google Drive or Google Docs link at all.** It is
> refused before any network request, by the function's own URL policy.
>
> `assetProbeUrl` rewrites a Drive share link to
> `drive.google.com/uc?export=download&id=…`. `assetProbeRedirectAllowed` then
> validates that URL with `assetUrlType`, whose `providerQuerySafe` allows only
> the query keys `usp, dl, raw, download, id, tab, rlkey, resourcekey`.
> **`export` is not among them**, so the probe URL the function just built is
> judged `invalid`, `drive.google.com` is not in the redirect host allowlist,
> and `boundedAssetFetch` throws `asset_redirect_invalid` at hop 0.
>
> The Docs path fails identically: its probe URL uses `format=pdf`, and
> `format` is not in the list either. Dropbox works, because `raw` and `rlkey`
> both are — which is why `docs/ops/GRAPHICS_DRILL_ARTIFACT_SETUP.md` has always
> been able to say Dropbox links work.
>
> Confirmed live on 2026-08-05 by run `31034175188`, which recorded
> `result_code: asset_unavailable_redirect_invalid` against an owner-supplied,
> correctly-shared PNG.
>
> **CORRECTION.** An earlier version of this warning claimed the opposite: that
> the committed probe followed Google's 303 and accepted the file, and that a
> rejection therefore meant the deployed function was stale (F51). That was
> wrong. It came from a local replica of the probe that I wrote by hand, which
> invented an allowance for `drive.google.com` that the real
> `assetProbeRedirectAllowed` does not have, and omitted `assetUrlType` and
> `providerQuerySafe` entirely. The replica reached the network; the real code
> never does. Two deploys were requested partly on that reasoning. They
> delivered other real fixes, but the artifact rationale was mine and it was
> mistaken.
>
> **This is a repository defect, present on `main` today. No file, size, or
> sharing change fixes it, and neither does a deploy of the current source.**

If the deployment is known-current, then the drill's `asset_state` means:

| what the report says | what it means | what to do |
|---|---|---|
| `missing` | the variable is empty or misspelled | re-check the name in Step 4, character for character |
| `invalid` | the link is a folder, a Google Doc, or not a share link | redo Steps 1–3 with an actual picture file |
| `permission_denied` | the probe was shown a sign-in page — genuinely still **Restricted** | redo Step 3 and set **Anyone with the link** |
| `unavailable` | **check the deployment first (above).** Otherwise: the file is large enough that Google returns its virus-scan warning page instead of the bytes | use a smaller picture (under ~5 MB) |
| `expired` | the file was deleted, trashed, or moved out of the shared location | restore it, or redo Steps 1–4 with a new file |

Note that `permission_denied` and `unavailable` are different answers.
A genuinely unshared file returns `permission_denied`, because the probe
recognises a Google sign-in page. If you are seeing `unavailable`, sharing is
probably **not** what is wrong.
