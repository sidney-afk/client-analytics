---
name: thumbnail-batch
description: Make a batch of client video thumbnails in Canva from screenshots. Use when a designer says "make thumbnails for [client]", "thumbnail batch", "put these screenshots in Canva", or shares client screenshots for thumbnails. Optionally fixes awkward facial expressions first, writes titles in the client's style from their filming plan, and fills copies of the client's latest editable Canva thumbnail with each screenshot and title.
---

# Thumbnail batch

You help the agency's graphic designer turn client screenshots into editable Canva thumbnails. Talk in plain English. One thumbnail per screenshot unless she says otherwise.

Tools you use:
- **Synchro Higgsfield** connector: `clients`, `client_style`, `client_filming_plan`, `import_file`, `recipe_plan`, `run_recipe`, `check_jobs`.
- **Canva** connector: `search-designs`, `copy-design`, `read-design`, `upload-asset-from-url`, `edit-design`.

Never spend money or save a Canva design without her yes.

## 1. Client and screenshots

1. Ask which client (use `clients` if the name is unclear).
2. Get the screenshots as links. Chat attachments cannot be passed to the tools, so ask her to put them in a Google Drive folder shared as "anyone with the link" and paste each file's link (or a Dropbox link). Run `import_file` on each link and keep the returned link, in order. Number them 1, 2, 3...

## 2. Expression fix (optional)

Ask: "Do any faces need the expression fixed (mid-word mouth, half-closed eyes)?" If yes, for the ones she picks:
1. `recipe_plan` with recipe `thumbnail-expression-fix` and those links. Show the card (model, count, total price) and wait for "go".
2. `run_recipe`, then `check_jobs` every 30 seconds until done. Show her each result and let her keep the fixed or the original version per screenshot.

## 3. Titles

Ask: "Do you have the titles, or should I write them?"
- **She has them:** match each title to its screenshot number.
- **You write them:**
  1. Ask which videos these thumbnails are for (for example "videos 3 to 7 from October").
  2. `client_filming_plan` with the client and month; find those videos.
  3. `client_style` for the client's voice and thumbnail style.
  4. Write 2 or 3 title options per video in that style, similar in length to the client's existing titles (they must fit the same text box). Let her pick or edit.

## 4. Canva

1. `search-designs` for the client's editable thumbnail design (names look like `XX-IG-Thumbnail-Editable` or "<Client> - Thumbnails"); sort by newest and confirm the design with her if more than one matches.
2. `read-design` with `page_metadata` to find the page count; the last page is the latest style. Use that page unless she names another.
3. For each screenshot:
   1. `copy-design` with the design id and `page_numbers: [last page]` (one copy per thumbnail; the same page cannot be repeated in one copy).
   2. `upload-asset-from-url` with the screenshot link.
   3. `read-design` with `open_transaction: true` and fields `design_content`, `thumbnails`. The background photo is usually the largest image element covering the page; the title is the text element.
   4. `edit-design` with `keep_open`: `update_fill` on the photo element with the new asset, `find_and_replace_text` on the title (find = the old title exactly), and `update_title` to "<Client> thumbnail <n> - <short title>".
   5. Show her the preview. If the photo framing or text fit is off, fix it (`crop_media`, `resize_element`, `format_text` font size) and show again.
4. When she approves all previews, `commit` each one. Give her the list of edit links, numbered like the screenshots.

## Rules

- Keep the client's font, colours and layout exactly; only the photo and title change.
- If a step fails, say which screenshot and why, and continue with the rest.
- State every price before spending, and the total at the end.
