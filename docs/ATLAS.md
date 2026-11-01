# SyncView Atlas

> **Keeping this current.** Any PR that adds, removes, renames or changes what a tab, button, toggle, mode or runtime switch does updates the [Team guide](#team-guide-every-tab-button-and-switch) in the same PR, in plain English: what it does, who sees it, what the client sees, and which switch it sits behind. When a switch's audience is changed live, its row in the switch table changes too. The technical sections (screens, tables, functions, n8n, Sheets, jobs, secrets, deploy lanes) follow the same rule. Brain also runs a weekly check that compares ATLAS with the changes merged that week and reports any mismatch to the SyncView supervisor, so a missed update is caught within a week; it does not replace updating ATLAS in the PR. The same rule is in [AGENTS.md](../AGENTS.md) and the PR template. The Team guide was last checked against code and live switches on 2026-10-28; the technical sections below keep their own dates.

Technical sections re-verified 2026-10-29 against client-analytics main `45c88a8` and the live catalogs, read-only: the Edge Function list (68 live), every database relation and its browser privileges (225), the 26 database timer jobs, the runtime switches, the n8n census (125 workflows, 56 active) and its credential names, and every workflow file. Each section carries its own date. Nothing was deployed, dispatched, edited or sent in a live system. Not re-read this pass: GitHub and Supabase Edge secret names (no read access from this session), the two private sibling repos, and Sheet tab lists; those rows say so. Earlier full pass: 2026-09-30 at `3caef657e0a832b265af33d67009ac4649c60112`.

Find a name with your browser's Find command, or use the section links below. Each entry points to its owner. [State of things](STATE_OF_THINGS.md) sets priorities; [Find anything](FIND_ANYTHING.md) routes deeper questions; [Open repairs](ops/OPEN_REPAIRS.md) records unresolved work.

| Find | Open |
| --- | --- |
| Repo boundaries and connections | [Four repos](#four-repos) |
| How a tab, button or switch works (for teammates) | [Team guide](#team-guide-every-tab-button-and-switch) |
| A tab, form or screen | [Screens](#screens) |
| Stored data and browser access | [Tables and views](#tables-and-views) |
| A backend function | [Edge functions](#edge-functions) |
| An automation or its exit step | [n8n](#n8n) |
| A spreadsheet or tab | [Google Sheets](#google-sheets) |
| A timer or workflow | [Scheduled jobs and GitHub workflows](#scheduled-jobs) |
| An outside service | [Outside services](#outside-services) |
| Where a secret name lives | [Secrets](#secret-names-and-locations) |
| How something deploys | [Deploy lanes](#deploy-lanes-and-owner-action) |
| A broken behavior | [Where do I look when](#where-do-i-look-when) |
| Migration source | [Table creating migrations](#table-creating-migration-inventory) |
| What this check proves | [Keeping this true](#verification-limits-and-keeping-this-map-true) |

## Team guide: every tab, button and switch

Written for teammates (SMMs, editors and designers, Kasper), not developers. The brain answers "how does X work in SyncView" from this section. Checked against the page source on main `0674b99` and the live switch values (read-only) on **2026-10-28**. Anything the code did not settle is marked **(unconfirmed)**. Everything after this section is the technical map.

**Roles used below.** **Admin** (Kasper and the owner), **SMM** (social media manager), **Creative** (video editors and graphic designers). A **client link** is the private address a client opens with no login; it never shows staff controls.

**How switches work.** Many features sit behind a runtime switch that the owner or supervisor flips live with no release. A switch can be on for **all** (every signed-in staff member, or every client; a staff switch never reaches the client link), for a short list of named staff or clients, for the **test client only** (the agency's own test account, never a real client), or off. The table at the end of this guide lists every live switch and who has it on.

### Quick answers

- **The YouTube title.** On YouTube posts, the card name is the YouTube title. Turn on **YouTube title review** for a client in the Calendar's ⋮ More menu. A small coloured square then appears left of the card name, with its own review status (In Progress through Approved). It never changes the card's overall status. The client approves the title on their Review page. If they edit it there, the edit goes to the team as a change request ("Please use this title: …") and never renames the post. See [Calendar](#content-calendar-and-the-post-card).
- **Collaborative mode.** A per-client switch in the Calendar's ⋮ More menu (called "Client collaboration" on a phone). Any staff member can flip it.
  - **Off (the default):** the client sees only finished posts, read only.
  - **On:** the client also sees work in progress and unscheduled posts, can **Suggest a post**, and can type the caption on the Sheet.
  - **Never, in either mode:** the client renames, changes statuses, drags dates or archives.
- **The intake link vs Submit.** It is the same form.
  - **Submit** (staff tab, titled "Create production work") is used by a signed-in Admin or SMM to hand in a shoot's footage. It creates a parent issue, a "Video N" and "Thumbnail N" for each video, and one undated Calendar card per video.
  - **The client upload link** (copied with **Copy upload link** on Submit; titled "Upload your content") is that form for clients and videographers. They need no sign-in, the title box is hidden, the limits are tighter, and every piece is marked as coming from the public link. It works only while `public_intake_enabled` is on (it is).
- **SyncLinear.** The team's own work tracker, which replaced Linear. The header button says **Linear**, the screen's breadcrumb says **Production**, and its address is `/synclinear` (old `?prod=1` links still work). You cannot create anything there: posts and their sub-issues come only from Create Post on the Calendar or Samples, or from Submit. See [Production / SyncLinear](#production--synclinear-what-it-is-and-what-it-is-called).
- **Samples.** Trial pieces for a client (a Video plus a Thumbnail, with no caption, date or platforms). They are made by SMMs on the Samples tab, edited in Production like posts, and reviewed by the client on a separate Samples link. See [Samples](#samples-what-they-are-and-how-they-differ-from-calendar-posts).
- **Trial reels.** One video posted as several versions (A to G) with different text hooks, each as an Instagram trial reel. The winner is kept after 24 h. The card, Production, review and client parts are behind `trial_reels_pages` (**test client only**). The trial reel switch on the **Post** tab is a separate thing: it is there for every staff member, and it posts a single reel as an Instagram trial.
- **Analytics.** Hidden for everyone right now (owner decision, 2026-10-17). See [Analytics](#analytics-overview-and-client-profile).

### Signing in, the header, Today, Workload, Analytics, clients, Templates, Time Off and weekly reports

Roles used below: **Admin** (Kasper and the owner), **SMM** (social media manager), **Creative** (video and graphic editors). A **client link** is the private link a client opens; it never shows any of the staff controls below.

#### Signing in (staff)

- Every staff page is covered by a sign-in screen until you sign in. Client links, the onboarding forms and the weekly-report form do not ask for it.
- **Staff sign in** card: pick **Your name** from the team list, type your **Role key** (the eye button shows or hides it), press **Continue**. A wrong key says "That role key does not match the selected name."
- Your role (Admin, SMM or Creative) comes from the key, and decides what you can do. The key stays saved on that device ("Verified on this device"), so you only sign in once per browser.
- When a page needs a higher role you get a plain message, for example "Work-day planning requires an Admin or SMM account." Sign out and sign in with the right account.

#### Account menu (person icon, top right)

- Top line: "Signed in as [name] · [role]".
- **Sign out** (or **Staff sign in** if you are signed out).
- **Time Off**: your leave page (shown while the `pto_v1` switch is on; it is on).
- **Onboarding**: the onboarding forms inbox (Admin, SMM, Creative).
- **Client Credentials**: the client logins vault (Admin, SMM).
- **Dark mode** on/off, and **Original status colors** (use the classic workflow colour palette). Both are remembered per browser.
- **Messages** sits beside the menu as its own button, for Admin and SMM only (editors have no inbox).

#### Top navigation

- Order: **Today, Calendar, Samples, Templates, Filming, Post, Analytics** | **Workload, Linear (SyncLinear), Submit, Kasper**.
- The first group follows the shared client (see the picker below); the second group is about people and ignores it.
- Every signed-in staff member sees all tabs, except:
  - **Kasper**: Admin only.
  - **Samples**: shown unless that browser has opted out.
  - **Analytics**: currently hidden for everyone (see Analytics below).
- Each page has a clean address (for example /today, /workload, /templates, /time-off); old links with "#" still work and are forwarded.

#### Shared client picker (small dropdown after the logo)

- One "current client" for the whole site. Calendar, Samples, Templates, Filming Plans, Post and Analytics all open on it, so you pick a client once.
- Opening it shows **My clients** (your own clients from the SMM roster, always listed, cannot be removed), then **Recent** (up to three; an × removes one, and there is a clear-recent option). Typing searches every current client.
- It is a per-browser convenience; nothing is saved to the server. Never shown on client links.

#### "My clients": whose clients are whose

- Only current clients count (a client that has left the Clients list disappears).
- The SMM roster says which clients each SMM owns. Anyone on the roster, admins included, sees their own clients. An admin who is not on the roster sees every client.
- Staff can also be granted "also sees" clients (another manager's clients, or one client); these show separately as "Also seeing". It never changes who owns the client.
- Test clients are hidden from everyone, except that your own roster row can list your own test client, which then shows on your Today and in My clients only.
- The same rule feeds Today and the picker, so they always agree.

#### Quick jump

- Press **/** anywhere (not while typing in a box, and not on SyncLinear, where / opens its own search). On touch screens use the magnifier next to the client picker.
- Type part of a client and/or a tab, like "cal" or a client name plus "templates", and press Enter. The client becomes current and the tab opens. A tab alone just opens the tab; a client alone opens it on the tab you are on (or the Calendar from a team tab). Arrow keys move, Escape closes.

#### Phone layout

- On a phone-width screen (767 px and narrower) staff pages drop the wide header for one title row: the screen name, **Tabs** (every tab you normally see) and **More** (account, appearance and client controls). Nothing new is added; every row presses the normal control.
- Phone polish (staff, permanent since 2026-10-29, no switch): smoother phone design, for example Notes sits right under the statuses on an opened post, a quieter Delete on notes, two-line message previews in Messages, and Production rows that do not wrap. Desktop never changes.

#### Unread badges

- Unread badges (staff, desktop only; permanent since 2026-10-29, no switch): a card's Notes button shows one round picture per person with something for you, coloured by kind (orange change request, blue client comment, grey team, violet Kasper). A small number on the picture's corner = new; a plain coloured number beside it = already read but still needs you (a change not done, a client comment to answer). At most three people, then "+N"; hover lists who and what.
- Inside Notes: Slack-style notes with New and "Waiting for your answer" tags; hover a note for Reply (comments only), No reply needed, Mark done, Delete. "No reply needed" and "Mark unread" are remembered in your browser only.
- Messages: New, To answer and All tabs; the header button counts new only.
- Clients: with `review_client_polish` (on for all clients) the client link gets the same badges, counting only the team's notes. The team shows as one person, "Synchro team"; no staff names or pictures.

#### "New version" prompt

- SyncView checks for a new release every 5 minutes and when you come back to the tab.
- A tab in the background reloads itself if nothing is being typed.
- A tab you are using is asked once, about an hour after a new version appears, and never mid-draft: "A new version of SyncView is available — reload to get the latest." **Reload** or **×** (Dismiss = not now; it will not ask again for later releases).
- After about 4 hours on an old version (or straight away if the owner forces it), a full-screen reload wall appears; it still waits while you have unsaved work.

#### Today

- One page per person showing what is waiting on **you**. It only reads: no checkboxes. A card leaves by itself when its status moves on and lands in **Cleared today**. A bar shows "X of Y cleared today" and "N this week". Updates live.
- **SMM and Admin**: a greeting with how many items to clear, chips for **Your clients** (and **Also seeing**; an admin who sees all gets "Every current client"; a chip opens that client's Calendar). Two views:
  - **Rings**: five jobs. **To approve** (editor work waiting for SMM approval), **Missing links** (posts with no video or thumbnail link), **Captions to write** (captions sent back for tweaks first, with the request's first line, then empty captions), **To schedule** (Approved posts), **Dates to move** (To Do work items whose due date has passed). Click a ring to list its items (12 shown, rest in SyncLinear and Calendar). Sorted by upload date, soonest first.
  - **Walk-through**: one upcoming post at a time ("Post 3 of 5"), with checks for video link, thumbnail link and caption; **Open card**, open in SyncLinear, and move to the next. Covers the next two weeks.
- **Editors (Creative)**: their own queue (tweaks first, then urgent, then by due date) as a **List** or a **Deck** (one card at a time, **Skip for now** sends it to the back). Rows open SyncLinear, where editors work.
- Date pills: red = today or overdue, amber = 1 to 2 days, highlighted = within a week, grey = later.
- An SMM with no clients listed sees "No clients are listed for you yet. Ask an admin to add yours to the SMM list."

#### Workload

- Team planning board: who works on what, on which day. Open to Admin, SMM and Creative; **planning (dragging and saving work days) and changing due dates are Admin and SMM only**.
- `workload_calm_staff` (on for all staff): the calm design, with fewer boxes, colour only where it means something (overdue red, due soon amber), the filters tucked behind one **View options** button (a dot shows when a filter is on), client groups inside a day that open and close, and "Needs assignment" and "Needs a work day" folded into quiet rows. What each click saves is unchanged.
- **Team workload** panel: each person from freest to busiest, with Capacity, Overdue, In progress and Tweaks counts; click a number to see the items.
- **Work-day calendar** controls: previous / **Today** / next; **Week** or **Month**; **↻** refresh; team **All / Video / Graphics**; **All editors** dropdown; **All clients** search; **Plan only** or **Plan + Due Date** (Month is unavailable while Plan + Due Date is on).
- How cards are placed automatically: each item starts on the earliest working day from today where that editor still has room, never later than one working day before its due date. Capacity per day: video editors 4 units, graphics 15. A card can count as 1, 2 or 3 units ("Counts as N videos of capacity"). If no day has room, the card sits on its last possible day and the day shows red over-capacity; only a person can fix that (reassign or move the deadline).
- **Drag a card** to a day to pin it ("Planned by hand. Stays on this day until someone changes it."). **Use automatic plan** removes the pin. A pinned day already in the past shows the card on today, marked "Carried over" (the saved day is not changed).
- Click a card or a count to open a popover: the items with their tweak comments, the due line (click it to change the due date, Admin/SMM), **Open in Linear** (SyncLinear) and **Open in the content calendar**.
- Strips under the calendar: **Needs assignment** (no editor) and **Needs a work day or deadline**.
- Phone: **Agenda / Week / Month** views.

#### Analytics (overview and client profile)

- **Currently hidden for everyone** (owner decision 2026-10-17): no Analytics tab, and client links open their Content Calendar. It comes back when the owner sets the `analytics_hidden` switch to shown; nothing was deleted. The description below is what it shows when on.
- **Overview (staff)**: every client's numbers as a table or cards, with a Day / Week toggle for gains, and pinned clients (**Pin a client**, **Edit pins**).
- **Client profile**: tabs **Analytics / Content Calendar / Brief** (clients never see Brief).
  - Header: last scraped date and what it compares against; **Share** (copy the client link) and a Slack button that posts this week's top reel to the client's Slack channel (staff only; needs the channel set in the client profile).
  - Gains bars for the last day and the last week; per-platform blocks for Instagram, TikTok and YouTube (followers or subscribers, views); **Followers Over Time** (Total or Daily Change, per platform); **Daily Views Over Time** (All or one platform); **Top Performing** videos per platform (Week or Month).
  - Content summary: staff press **Generate summary** (a paid AI call, only on click); clients see a summary only if one exists.
  - **Brief** (staff): the client's Keywords brief, with Overview, Niche Insights, Hook Analysis, Content Directions, The Gap and Sources, plus a date picker when there are several.

#### Client profiles, Create client and the onboarding checklist (Admin)

- Where: **Kasper › More › Pipeline & Admin › Clients**. Admin only. Search a client or open **All clients**; one profile at a time.
- Profile cards: **Contact and team** (email, Slack channel, Creative channel, Slack person to tag), **Social accounts**, **Publishing** (Post for Me, Instagram (Post for Me), Facebook Page (Post for Me), Upload-Post; the two account ids are checked with Post For Me when saved), a folded **Content research** (description, keywords, competitors), **Managed by** (change the social media manager), **Save changes**, and **See history**.
- **HubSpot** band: deal stage, contract and payment state (only for clients the `client_hubspot_sync` switch lists: three today).
- **Onboarding** section (folded): its header reads "19 of 24 required steps done" or "Onboarded".
  - **Resources**: found / missing / unknown for each thing the client should have (profile fields, review link, filming plan link, Templates page, Canva link, logins saved, form answers, Calendar cards, Samples, Analytics numbers, Drive folders, HubSpot contact, brain folder, and more). Logins and links show as present or missing only.
  - **Onboarding checklist** (27 steps): each says who does it (the client, automatic, a Claude session, or by hand), Required or Optional. Buttons: **Mark done** (optional evidence link), **Skip with a note** (optional steps, reason required), **Reopen**.
- **New client** (Admin): name, social media manager, optional email. It checks the name live and lists exactly what it will make. **Create client** makes the roster row, review link, profile, manager and checklist in one go. Slack channels are made automatically once the client email, the client's onboarding form, the manager's Slack id and the filming plan link are all in. A name starting "ZZ THROWAWAY" makes a removable test client.

#### Onboarding forms (what clients fill in)

- Two private-link forms built from one module: **standard** (/onboarding_form) and **AI avatar** (/ai_onboarding_form). Seven steps each: Basic info, Brand & audience, Style (subtitle style, B-roll, music, references, a live thumbnail-look picker), Sample video (standard only) or AI avatar (AI only), Photos & source, Goals, Account access. The style choices are "direction, not final".
- Drafts are kept while typing so a submission is not lost.
- Staff read submissions in the **Onboarding** inbox (account menu or Kasper › Onboarding): Standard, AI avatar and Old forms (the historical Notion forms, shown as-is), with search. Templates shows an **Onboarding ↗** button on a client that has a form. The form readers check for an Admin key on the server, so the inbox may not load for SMM or Creative (unconfirmed).

#### Client Credentials

- The vault for client social logins: account menu › Client Credentials, or the Calendar's ⋯ menu for one client. Admin and SMM.
- Per client: **Add credential**, **Reveal password**, **Copy password**, copy handle, **Edit**, **Archive**, **History**, **Mark reviewed**. Unmatched or imported rows can be assigned to a client. **Import from onboarding** brings in logins from forms. **Refresh**.

#### Templates

- Per-client working page for editors and SMMs. The index lists clients with a search and pinned "My Clients".
- A client page shows: the client's Instagram/TikTok/YouTube links; **Links** (filming plans, editor folder, reference reel, client photos, editable Canva); **Latest frame folders** and **Latest raw footage**; **Quick look** (subtitle and thumbnail specs: font, colours, highlight); the **Editor brief** (with a copy button to paste into Claude); **Audience**; and **All facts, with sources**.
- **Edit links** / **Done**: the working links (reference reel, client photos, Canva, editor folder) are the only things edited here; several links per field are allowed. Which roles may edit them is unconfirmed.
- Everything else comes from the Synchro Brain. To correct it use **Send a change** (write what is true now); it updates in a minute or two.

#### Filming Plans

- **Filming tab**: one master Google Doc per client. Search, **Refresh**, **Open**, and (Admin, SMM, Creative) **Add / update** and **Edit** (Doc link, notes).
- **Kasper › Filming Plans** (Admin): which clients need a new plan. Pills **need a plan** (10 or fewer pieces of upcoming content, no Doc, or an overdue plan), **soon** (11 to 20, or a plan due within 14 days), **covered** (21 or more). Content counts every active card that is undated or dated today or later. Each row has Open Doc and Calendar links, and a month grid.

#### Caption prompts

- Calendar › ⋯ menu › **Caption prompt** (any staff, per client). It is used whenever someone clicks Generate caption on that client's cards. Shows whether a custom prompt is saved; edit and **Save**, or **Reset to default**. The transcript is added automatically. Also holds the client's **call to action choices** (one per line). A twin **Thumbnail title prompt** sits in the same menu.

#### Time Off

- Switch `pto_v1` is on. Open from the account menu (no tab). Every staff member: balances (Wellness available, Sick left, floating holiday), **Request time off** (Wellness, Sick, Floating holiday, Unpaid; SyncView counts business days; half-day option), **My requests** (cancel while pending), a **Team calendar** of approved absences and paid holidays, and who is away today.
- Rules (server side): paid leave starts 60 days after the start date; wellness is earned monthly (capped per year, resets 1 January); 3 sick days a year; one floating holiday a year; only sick leave can be today or in the past; a warning when the start is under 14 days away.
- **Kasper › Time Off** (Admin): **Pending requests** (**Approve** / **Deny** with a note), team calendar, member balances, **Log time off** (put leave on someone's record: member, type, dates, half day, note; a line shows what it uses from their balance; it is saved as approved, shows on the team calendar, and the member sees "Logged by" with no Cancel), **Add adjustment** (changes a balance only, never on the calendar), and **Member setup** (start date, enabled).

#### SMM weekly reports

- **Form** (/smm-weekly-report, Admin and SMM): one report per client per Monday-to-Sunday week. It asks for the overall status, schedule, content shipped, performance, biggest win, biggest obstacle or risk, whether you need Kasper, client mood, client requests and other notes. **Submit report**, then **Submit another client**. It cannot be edited after you submit, and a second report for the same client and week is refused.
- **Kasper view** (/smm-weekly-reports, Admin): read-only, filtered by week, SMM, status and client, with an attention count. A weekly reminder email to Kasper is described in the docs; whether it runs is unconfirmed.

### Content Calendar and the post card

#### The Calendar page: client picker, views and toolbar
- **Who uses it:** SMMs and admins every day; editors and Kasper open cards from it. The client has their own read-mostly copy through their client link (see "What the client sees").
- **Client picker (tabs along the top):** each client you open becomes a coloured tab. "+" / **Add client** opens a search box ("Search clients…"). The small x on a tab closes it (it does not touch the client's data). The tabs you keep open are remembered in your own browser only.
- **Four views (staff):** **Review** (your SMM approval queue: cards with a part waiting at For SMM Approval; the badge counts them), **Sheet** (the full card list), **Month** and **Week** (calendar grids).
  - On Month and Week, staff drag a post onto a day to schedule or move it. Posts with no date sit in a tray you can drag from. Clients can never drag dates.
- **Toolbar (Sheet view):**
  - **Organize** menu: **Order**: "Auto-organize by date" (oldest first, unscheduled last) or "Off — your drag order". Your manual order is kept and comes back when you turn auto-organize off. While sorting by date, cards can't be dragged. **Month**: All months, This month, Previous/Next, or Custom. **Content**: All, scheduled only, or unscheduled only (the reserve pile). When a month filter hides cards, a small chip says so.
  - **Status filter** (funnel): "Show only" or "Hide" cards by their overall status. Clear it with the x.
  - **Card size** zoom (- / +): four sizes for staff, the smallest (added 2026-10-31) about six cards across a laptop screen; the client link has three. On a desktop the card strip runs the full width of the window.
  - **Sheet fits the window** (switch `sheet_fit_v1`, on for everyone since 31 Oct: every staff Sheet and every client link, desktop only). On a desktop: the Sheet ends where the cards end, so when the cards fit the page does not scroll up or down and the sideways scrollbar sits right under the cards; spacing is tighter at every size, and the thumbnail gives up a little height so the cards fit the window (the default size shows every card in full on a 1920 x 1000 screen; the smallest fits a MacBook Air); the wheel follows the gesture wherever the pointer is: up and down scrolls the page, a sideways swipe, tilt wheel or Shift+wheel slides the cards, an opened caption scrolls first, and when nothing scrolls up or down a normal wheel slides the cards. Client links also get the smallest card size while it is on. Phones are unchanged. With the switch off, the Sheet is exactly as it was before.
  - **Globe** ("Open profiles"): opens the client's Instagram, TikTok, YouTube and other profiles.
  - **Bell** (admins and SMMs only): sends the client one Slack alert that new content is ready for review.
  - **Select** (checkbox icon): pick several cards, then give them a colour tag or **Archive** them. **Write captions** (the second icon): pick several cards, then **Generate captions** for all of them.
  - **⋮ More** menu (staff only, never on the client link): **Share with client** (copies the client link), **Caption prompt**, **Thumbnail title prompt**, **Platform** (choose which platforms this client uses; each card can then mark where it is going), **Client credentials** (admins and SMMs only), **Collaborative mode** (switch), **YouTube title review** (switch), **Import → Import from Excel**, and **Archived cards** (admins and SMMs only).
  - On a phone, "Collaborative mode" is labelled **Client collaboration**.

#### Collaborative mode (per client switch in ⋮ More)
- **Who can flip it:** any staff member on that client's calendar. The client cannot. It is saved for the whole client, so it applies on every device and for every SMM. It is off unless someone turns it on.
- **Its own tooltip says:** "Lets your client see what you're working on and suggest new posts of their own. With this off, they only see what's finished."
- **Off (the default), the client sees:**
  - On Sheet, Month and Week, only posts where **every** part (video, thumbnail, caption) is Approved, Scheduled or Posted. Empty view text: "Finished posts will appear here."
  - Only finished status pills. In-progress pills are hidden.
  - No "Suggest a post" button and no unscheduled tray.
  - Every field is read only on the Sheet.
- **On, the client also sees:**
  - Posts still being worked on, with their in-progress status pills.
  - The unscheduled posts.
  - A **Suggest a post** button. It adds a blank card they can name and fill in. It is a calendar card only; no sub-issues are made.
  - They can edit the **caption** on existing cards. Name, date, call to action, links and statuses stay locked.
- **What it does NOT change:**
  - The client never renames a card, never changes a status, never drags dates, and never archives, in either mode.
  - Their **Review** tab works the same either way: a card is listed only while one of its parts is at Client Approval.
  - On the review page itself, the client can edit the caption even with the mode off.

#### Creating a post (Create Post dialog)
- **Who:** staff. Open it with **Create Post** on the Sheet.
- **Choices in the dialog:**
  - **Video + Thumbnail**, **Video only** or **Thumbnail only**.
  - **How many posts?** (1 up to a limit of 100 sub-issues in total).
  - **Post name(s)**, optional.
  - **Video editor**: "Assigned automatically" by default, or pick someone. The list shows each editor's open videos and marks one as "(suggested)". "Not assigned" is also offered.
  - **Batch**: **Start a new batch** (its name is pre-filled and you can change it) or **Add to a previous batch** (searchable).
  - A preview lists exactly what will be created, for example "Video 3 — name" and "Thumbnail 3 — name".
  - **Create post** makes the work items in Production and then the calendar card.
- **Switch:** the dialog is used for clients on the `write_ui_reroute_clients` list (38 clients live). For any other client, Create Post just adds a blank card (unconfirmed which clients are outside the list). `editor_suggest_last` (one staff member listed) puts named editors last in the suggestion order.

#### The post card: every field and button
- **Grip** (drag to reorder on the Sheet), **link icon** ("Copy a link to this card") and **x** ("Archive"). The link icon and x are staff only.
- **Title (name):** type to rename the card. If the card is linked to work items, the new name is copied to its sub-issue titles automatically: "Video 2 — old" becomes "Video 2 — new". While this happens the card shows "Name syncing…". If it fails it shows "Name didn't sync · **Retry**". This also works the other way: renaming the sub-issue renames the card. **Switch:** `rename_propagation` (card to sub-issue and sub-issue to card both on). Clients cannot rename cards.
- **YouTube title square:** a small coloured square left of the title, on YouTube cards. It shows when **YouTube title review** is on for the client, or the title already has a review status.
  - Click it to set the title's status: In Progress, For SMM Approval, Kasper Approval, Client Approval, Tweaks Needed or Approved.
  - The text being reviewed is the card name.
  - The title status never affects the card's overall status.
  - Staff only on the card; the client approves the title on their Review page.
- **Date chip:** "Add date" / the date. Opens a date picker (staff).
- **Thumbnail URL** and **Video URL (Frame.io / Drive)** fields:
  - Once filled, each shows an open pill, a pencil to edit and, for thumbnails, "Open the folder this link is in".
  - A **Compare** icon shows the previous and current thumbnail after a thumbnail has been replaced (switch `thumbnail_revision_v2`, on).
  - Changing a thumbnail refreshes it for every viewer without a hard refresh.
- **Caption box:**
  - **Generate** opens "Generate caption" with Platform, Call to action, "Note for the AI", and a transcript box. The transcript is required if no Frame.io video is linked.
  - While it runs, the pill shows progress and an x to stop it.
  - **Regenerate with a note** (circular arrow, shown once a caption exists) opens "Redo with a note".
  - **Caption history** (clock icon, once the caption has changed): every version, what changed (removed words red, added words green), and **Put this version back**. Restoring saves it as a new version, so nothing is overwritten.
  - **+ Alt caption** adds a second caption for another platform (for example LinkedIn) as a tab. It is approved together with the main caption.
  - The client's prompt and call-to-action choices are set in ⋮ More → **Caption prompt** (with **Reset to default**).
  - **Switches:** `caption_generate_ef_clients` (all clients). Caption history has no switch: permanent for every signed-in staff member since 2026-10-29, no switch.
- **Call to action** field.
- **Notes** button (bottom left). It shows open tweaks and unread replies. It opens the card's Notes:
  - **About the…** picker: Video, Thumbnail, Caption, or Title when title review is in use.
  - The send arrow posts a comment. Staff choose who sees it with the lock/eye icon: **Team only** or **To client**.
  - The arrow beside Send offers **Request change** ("Moves this part to Tweaks Needed. Team only.").
  - Each note has Reply, Edit, **Mark done** / Reopen, and Delete. Resolved notes are kept under their own filter.
  - Frame.io comments appear as rows marked "Frame.io". No switch: permanent for every signed-in staff member since 2026-10-29, no switch; never the client.
- **Frame.io viewer:** Notes, the thumbnail's play icon, the Review preview and Kasper's "Watch here" all open one view, with the video on the left and notes on the right. Opened from a play button (a card's play icon, the Review tab's preview, Kasper's "Watch here"), it starts playing at once, with sound if the browser allows, else muted with a button to turn the sound on (`_fvAutoStart`). Opened from the notes (the Notes button, a note's link, Messages), it waits for its play button. **Switch:** `frame_viewer_clients` (all clients). The client gets the player too, but never the Frame.io comments.
- **Status row:**
  - One pill each for **Video**, **Thumbnail** and **Caption**, with the statuses N/A, In Progress, For SMM Approval, Kasper Approval, Client Approval, Tweaks Needed, Approved, Scheduled and Posted.
  - **Set all to…** sets all three at once.
  - The card's overall status is its *worst* part, so one Tweaks Needed makes the whole card Tweaks Needed. N/A is ignored.
  - Review statuses are greyed out until there is something to review ("Add the video Frame link before sending it for approval", "Write the caption first"). Use N/A for a part the post will never have.
  - Video and Thumbnail pills are greyed and read N/A when no sub-issue is linked ("This screen can't create one").
  - Changing a pill moves the linked Production work item too.
- **URGENT button:** appears when the Video is at Tweaks Needed (pings the editor), or when any part, including the title, is at Kasper Approval (pings Kasper). Once sent for that round it reads "Sent". The Kasper ping uses the `kasper_urgent_ping_enabled` switch (on).
- **Save state:** "Save failed · Retry", or "Saved, syncing" with a click to retry. **Switch:** `calendar_card_write_clients` (all clients).

#### Trial reels on the card
- **What it is:** one video posted as several versions (Video A to G) that differ in the text hook. Each version goes out as an Instagram trial reel, and the winner is kept after 24 h.
- **On the card:**
  - A faint **Trial reels** switch sits in the Video row.
  - When it's on, the row shows "Video · N", a short state ("2/4 approved", "On trial · 17 h left") and an arrow to open the versions.
  - Each version has: paste its Frame.io link, change link, "New cut ready", **Drop this version** / Bring back, and, once the 24 h are over, a trophy (**Make this the winner**). Its "Video C is the winner · Undo" toast shows on the click; if the pick is refused, the toast goes and the page says why.
  - The client can say "Not this one" on a version; the team then sees "Client dropped" and drops it.
  - Each version says where it is: **with SMM**, **with Kasper**, **with client**, approved or change asked.
  - A change on one version does not hold the others: the versions a reviewer approved go on to the next reviewer at once, and the changed one follows when its new cut is approved.
  - **On the SMM's Review tab:** a trial card is listed while any version waits for the SMM, whatever the card's status, Tweaks Needed included (a new cut that came in while another version's change is still open). The SMM's approve on a trial card always sends it to Kasper, so its video has no "Approve to client".
  - **If a card did not move on** after every version was answered (the page closed between the two saves), the review page shows "Every version is approved" ("You approved every version" on the client link) with the usual approve button, which moves the card on.
  - The card goes to Approved once every version is approved or dropped. The 24 h trial starts when the card is set to Posted; "On trial" shows on the row at once and is confirmed by the trial-reels function a moment later.
  - The client sees only the winner once it is picked.
- **Switch:** `trial_reels_pages`, **test client only**.

#### Archive and restore
- **Archive** (the card's x, or Select → Archive) asks "Archive this post?". This is admins and SMMs in every mode; never the client.
- Archiving removes the card from the calendar and the client's view. Its linked video and thumbnail work items are moved to **Backlog**. If that step fails you get a notice to move them by hand.
- ⋮ More → **Archived cards** (admins and SMMs only) lists archived cards from the last 30/60/90 days. Restore puts the card back exactly as it was, and each linked work item goes back to the status it had.

#### Auto-posted
- A post at **Scheduled** turns **Posted** by itself once its scheduled day has ended (US Eastern time). The check runs every 15 minutes, behind the scenes, with no button.
- A card it has moved once is never moved again, so a person's undo wins.
- **Switch:** `calendar_auto_posted`, on for **all clients** (its list is `*`).

#### Thumbnail titles
- ⋮ More → **Thumbnail title prompt** edits the client's prompt. A background job uses it to write a title into a new, empty thumbnail sub-issue's description from the client's filming plan. It never overwrites what a person wrote. **Switch:** `thumbnail_titles`, on for all clients (its list is `*`).
- The **Thumbnail titles** / **Write title** buttons are on the Production page, not the card (admins and SMMs only). No switch for the buttons: permanent for every signed-in staff member since 2026-10-29, no switch.

#### What the client sees when staff act
- Statuses: in-progress parts are visible only with Collaborative mode on; finished parts always are.
- A part set to **Client Approval** puts the card in the client's Review tab.
- Notes marked **To client** are visible to them; **Team only** notes never are.
- Archiving hides the card from them. Posted / Scheduled shows as such.
- They never see the Frame.io comments, the YouTube title square, the URGENT buttons or the ⋮ menu.

### The client review link and Samples

#### The client review link: what it is and how it is checked
- **What it is for:** the one web address a client opens to review their content. They need no login. It opens SyncView in a cut-down "client" form: no staff bar, no client picker, only that client's posts.
- **Who makes it:** a signed-in staff member, usually the SMM. On the Calendar, use the menu (three dots), then **Share with client** ("Copy the client link for this calendar"). On Samples, the same menu has **Share with client** ("Copy the client link for these samples"). Each copies a link for the client currently open. A Calendar link and a Samples link are separate links.
- **How it is checked:** the link names the client and carries a secret code. Each time it opens, SyncView asks the server whether the code is valid and still active for that exact client and that kind of page. Only then does it load anything.
  - If the code is wrong, the link has been tampered with, or extra pieces were added: **"This link isn't valid. Please ask your social media manager for an updated link."** Nothing loads, and saved copies for that client are cleared from the browser.
  - If the server cannot be reached: **"We could not verify this link"**, with **Try again**.
  - Pressing Back into a link re-checks it.
- **What the client can reach:** only their own posts. Analytics is hidden on client links (no Analytics switch row exists, so it stays hidden). An old link that asked for Analytics or Brief opens the Content Calendar instead.
- **If copying fails,** the SMM sees plain words. For example: "Your staff sign-in is no longer valid. Sign in again, then copy the link", or "This client has no active roster row yet…".
- **Notify client** (bell button, staff only, on the Calendar and Samples bars) sends the client a Slack alert in their private channel, tagging their linked Slack person if one is set. It needs the client to have a review link already.

#### The client's Calendar link: tabs and header
- Switch `review_stage_client_pages`: **on for all clients.** This means every client gets the new review page (the "guided stage") and one header.
- The header shows the client's name, the tabs **Review | Sheet | Month | Week**, a sun/moon button (light or dark), and a **"?"** button.
- **The "?" help video:** it opens the public start page's "Review content" tutorial in a new tab. It shows only when the switch `review_help_video_url` holds an address. That switch **holds an address live** (set 18 Oct), so the "?" shows for every client.
- A fresh open always lands on **Review**.

#### Review tab (client side): Approve, Ask for a change, notes
- **What the client sees:** a strip of posts waiting for them ("N waiting for you"). Each post has a step bar with its parts: **Video, Thumbnail, Caption**, plus **YouTube title** on YouTube posts. A part is waiting for the client when it is at **Client Approval**. A green check means the part is approved. Orange means a change was asked.
- **Video player:** the same player as the staff Notes view. It never plays on its own; there is a play button, and on desktop a speed button.
- **Buttons on a waiting part:**
  - **Approve the video / thumbnail / caption.** It shows "Approved" at once and saves. That part moves to Approved.
  - **Ask for a change** opens a box ("What should change on the …?"). **Ask for change** sends it and the part goes to Tweaks Needed. The client sees "Change asked" and the words they sent. Since the polish switch, the box stays open with "Sent" so they can add another change.
  - **Edit the caption** (and the YouTube title). A client's caption edit replaces the caption itself, tells the team in a note (with the old caption), and counts as approving the caption. If the caption changed meanwhile, the client is asked **Replace caption**. A YouTube title edit never renames the post: it goes to the team as a change request ("Please use this title: …").
  - **Change my mind** on an approved part. The client cannot reopen it; this sends a note to the team ("Your team will reopen it").
  - **Finish reviewing** saves nothing (each answer is already saved). It opens the next waiting post. It stays off with "Saving…" while an answer is still sending. When all is done: "All done. Your team has everything."
- **Enter key:** with a mouse or trackpad, Enter sends a message; on a phone or tablet touch screen, Enter starts a new line and only the Send button sends (since 31 Oct; staff keep Enter = send).
- **Conversation panel ("Message your team"):** plain notes go to the team, attached to the part on screen. The client never sees team-only notes. "Is this a change?" lets them turn a note into a change on a chosen part, or send it as **Just a note**.
- **Never lost:** an Approve or change is kept in the browser until the server confirms it. Lost connections are retried for up to 30 minutes. Unsent words are kept per post for 7 days.
- **Polish (`review_client_polish`, on for all clients since 28 Oct, watched until 31 Oct).** Approve shows its check at the click and is undone, with a reason, if refused. A spinner replaces "Sending". A bare × deletes your own note, after "Delete this note?". Notes appear as quiet rows with day lines. Client replies sit under the team message they answer. Notes have unread badges.

#### Sheet tab (client side)
- **What it is:** the client's view of every post as cards in a row. This is SyncView's own page, built from the database. It is **not** a Google Sheet.
- **Read only:** title, call to action, date, video and thumbnail links (open only), and part status pills. No archive, no status changes, no copy-link. The old "Approve post" bar on Sheet cards is switched off in code, so clients approve only on Review.
- **Video button / thumbnail:** opens the in-app viewer (video on the left, notes on the right). Switch `frame_viewer_clients`: **on for all.** A client never sees Frame.io comments; staff do. A post with no playable Frame.io link falls back to the Frame.io link.
- **Notes button:** opens the post's notes. The client can write a note, ask for a change, reply, and delete their own notes. They cannot mark things resolved or choose who sees a note.
- **What shows:** with Collaborative mode off, only finished posts appear (every part Approved, Scheduled or Posted), and in-progress status pills are hidden. Month and Week show undated posts read only under "Not scheduled yet (N)"; on a phone that list is folded behind one "Not scheduled yet N" row the client taps to open (since 31 Oct). "Ready for your review" pills are violet on the client link (red stays for staff). A client can never drag posts onto days.
- **The Google Sheet backup:** an older "SyncView Calendar" Google Sheet with per-client Calendar and Samples tabs was a mirror of the database. The onboarding guide calls it a "legacy mirror", and the owner calls the Sheet "a backup only". Clients never see it, and nothing a client does on the Sheet tab is read from it. Whether it is still updated today is (unconfirmed).

#### Collaborative mode (client's side)
- **Who switches it:** the SMM, from the Calendar's three-dot menu, **Collaborative mode** ("Lets your client see what you're working on and suggest new posts of their own"). It is set per client.
- **When it is on, the client:**
  - sees posts still being worked on, with their in-progress pills;
  - gets **Suggest a post** (a blank card they can fill in);
  - may type the **caption** on existing Sheet cards (again, since 27 Oct);
  - may save a drag-reorder of the Sheet.
- **When it is off:** captions are read only and reordering does not save. The review page's caption edit for a post waiting on the client works either way.

#### Trial reels (client side)
- Switch `trial_reels_pages`: **test client only.**
- On a post with several trial versions, the video step shows "Video B of 5" with arrows. The client sees only the versions the team has already approved.
  - **Approve** answers the version on screen; **Approve all** answers every open version.
  - **Ask for a change** goes on that version (it is sent as "Video C: …").
  - **Not this one** tells the team to drop that version.
  - **Change my mind** on an approved version reopens it as a change, the same as **Ask for a change** on it: the version reads "Change asked", the client's words go to the editor as "Video A: …", and the card goes to Tweaks Needed once nothing else waits for the client. It is also beside "Video A approved" while another version still waits. This works only while the card's video is at Client Approval or Tweaks Needed; on a card already Approved it still sends a note naming the version.
- Once a winner is picked, the client sees only that one ("the one we are posting").
- Samples never have trial reels.

#### Staff counterpart: SMM Review tab and Kasper's Review Session
- **SMM's Calendar Review tab** (same `review_stage_client_pages` switch, on for all) uses the same page. It has:
  - **Approve to Kasper** / **Approve to client**, the same switch on Approve that the Samples Review tab uses (below);
  - Edit;
  - notes marked **Team only** or **Client can see** (change requests are always team only);
  - **Change my mind**, which reopens a part as a change.
- **Kasper's Review Session** (switch `review_stage_kasper_staff`: 3 staff members). Sections: Urgent, Waiting for your review, With the editors. Buttons:
  - **Approve**, which sends the part to the client;
  - **Approve after tweaks**, which needs a note; after the fix the post goes straight to the client;
  - **Ask for a change**, and **Tweaks are on Frame** (a change with no typing);
  - Message (team only);
  - **Finish reviewing**;
  - **Close card**, which only hides the card;
  - an editor ping for urgent tweaks.
- **Layout 2** (`review_stage_kasper_layout2`: 3 staff, screens 1360 px and wider):
  - a list of waiting cards always shown on the left;
  - every part of the card on stage at once;
  - Finish and Close at the top right;
  - **Undo** for a few seconds after Approve.
- Kasper's click-to-check polish is on for every signed-in staff member wherever his Review Session is on.
- Samples appear in Kasper's list with a **Sample** tag and a **Watch the video** link instead of the player.

#### Samples: what they are and how they differ from Calendar posts
- **What:** trial pieces made for a client, each a **Video** plus a **Thumbnail**. There is no caption, call to action, date, platforms, colour tag, YouTube title, Collaborative mode, or Month/Week.
- **Extra field:** **Creative direction**, with an eye button that hides it from the client or shows it to them.
- **Six statuses per part:** In Progress, For SMM Approval, Kasper Approval, Client Approval, Tweaks Needed, Approved. There is no Scheduled or Posted.
- **Who makes them:** SMMs, from the Samples page (staff menu, per-client tabs). Editors do the work in Production, as for Calendar posts.
- **Where they appear:** Samples is on for everyone. The old `?sxr=1` opt-in is history.

#### Samples: staff buttons
- **Toolbar:**
  - **Review | Sheet** tabs. Review shows a count of samples waiting for SMM approval.
  - **Notify client**.
  - card size (zoom out / zoom in).
  - a select button ("Pick several samples to archive"), then **Archive** / **Done**.
  - the menu: **Share with client**, and **Archived samples** ("Restore one"; only for staff allowed to restore).
- **"+" / Add the first sample:**
  - For clients on the new save path, it opens the same **Create Post** dialog as the Calendar. That dialog creates the batch and the video and thumbnail work items, and offers "Not assigned" for the editor.
  - For other clients it adds a blank card.
- **Card:**
  - name and creative direction (with the eye button);
  - Thumbnail and Video link fields;
  - buttons to open each work item in Production (or "Add the missing … to this sample");
  - a status menu per part, plus **Set all to…**;
  - Notes;
  - **Copy a link to this card**;
  - **Archive**. It asks "Archive this sample?". Archiving also parks its work items in Backlog;
  - a drag grip to reorder;
  - **URGENT** pings: to the editor when the Video is at Tweaks Needed, and to Kasper when a part is at Kasper Approval (`kasper_urgent_ping_enabled` is on).
- **SMM Review tab:**
  - per part: **Approve**, with Kasper as the default target and Client as the alternative (after Kasper has seen it once, Client becomes the default);
  - **Comment** (status unchanged), **Request change** (goes to Tweaks Needed);
  - a **First review** badge;
  - **Open in Sheet**.
  - Samples with no video or thumbnail are listed in a notice instead.
- **Kasper (Samples):** per part:
  - **Approve**, which goes to Client Approval;
  - **Comment** (team only);
  - **Approve after tweaks**;
  - **Request change**;
  - plus close-card and urgent ping.

#### Samples: the client's side
- **The link** is its own Samples link (from Share with client on Samples). It opens a page titled "Sample reviews" with **Review | Sheet** only. It is the older list style, not the new review stage page.
- **Review:** collapsible cards ("Video needs your review"). For each waiting part:
  - **Approve video** / **Approve thumbnail**, which moves the part to Approved ("Locked in");
  - a box, "Add a note or request a change…";
  - **Comment**, which does not change the status;
  - **Request change**, which moves the part to Tweaks Needed ("we're working on your tweaks").
  - The thread shows below.
- **Sheet:** read-only cards with status pills and links. Creative direction appears unless it is hidden. The client cannot add, edit, archive, reorder or select.
- **Visibility:** a client sees a sample once any part has left In Progress. They never see archived samples or team-only notes.
- The Samples link goes through the same link check as the Calendar link. The Calendar link holds an unconfirmed Approve or change in the browser until the server confirms it. Whether a Samples link does the same is (unconfirmed).

### Production (SyncLinear), Submit and the client upload link

#### Production / SyncLinear: what it is and what it is called

- **What it is for:** the team's work tracker. It replaced Linear, which the team no longer uses. Every video edit and every thumbnail/graphic is one "issue" (a work item). Editors see what they need to do, SMMs track and fix work, and Kasper sees what is waiting for their approval.
- **Who uses it:** staff only (admins, SMMs, editors/designers). Clients never see this screen.
- **Names, all for the same screen:**
  - The button in the top bar says **Linear**. Hovering over it shows "SyncLinear".
  - Its address is `/synclinear`. Older links use `?prod=1`, and those still work.
  - Inside the screen, the breadcrumb at the top says **Production**. Teammates say "SyncLinear", "Linear" or "Production" and mean the same place.
- **Switch:** `prod_authority`. Video and Graphics are both set to SyncView, so editing is on for both teams. If a team were ever switched back, its issues would show "… is view only for now".

#### Finding work: sidebar, views, list and board

- **Sidebar:**
  - **My issues:** what is assigned to you. You must be signed in with your staff account.
  - **Favorites:** shown only when some issues are marked as favorites. (unconfirmed: how a favorite is added)
  - **Workspace > Projects:** every client.
  - **Your teams > Video / Graphics:** each team has its own **Issues** and **Projects** links.
  - **Search button:** opens the search and command box. You can also press "/" to open it.
- **Issues list.** It has three tabs:
  - **Active:** Todo, In Progress, For SMM approval, For Kasper approval, Tweak Needed, For Client Approval and Scheduled. Approved and Posted are hidden.
  - **Backlog:** Backlog and Triage.
  - **All issues:** everything.
- **Projects board:** each client is a "project" card showing its number of issues and a target date. The columns are Backlog, Planned, In Progress, Paused, Completed and Canceled. You can drag cards, select them and open the Status / Lead / Target menus, but **project changes are not saved here**. The app answers "View only for now".
- **Project page:** click a client card to see that client's issues. "Project details" shows or hides its side panel.
- **Filter button:**
  - "Assigned to me".
  - Status, Assignee or Client, each with a list of values to tick.
  - Active filters show as pills. Use "Clear filters" to reset.
  - A pill at the top switches the team scope (All, Video or Graphics).
- **Display button:**
  - **Show sub-issues** on/off.
  - **Group by:** Status, Client/project or Assignee.
  - **Ordering:** Due date, Updated or Created.
  - The app remembers these choices in your browser.
- **Selecting several rows** shows a "N selected" bar with bulk actions: Assign to…, Change status…, Change due date… and Copy issue IDs. Right-clicking a row gives the same menu for that one issue. Two items in those menus always refuse:
  - **Delete:** "Deleting is not available here, for anyone". Archive the post on the content calendar instead.
  - **Move to project / another team:** not allowed. An issue's client and team come from where it was created.
- **Refresh:** a refresh button and a freshness note keep the data current. If live updates fall behind, the note says "Live updates are behind. Refresh to catch up."

#### Parents, sub-issues and the "no creating here" rule

- **How a post is built:** one **parent issue** for the post, with **sub-issues** under it, named "Video 1 — name", "Thumbnail 1 — name" and so on (Samples posts use "Sample Video N"). The parent is a container: its status, assignee, due date and labels cannot be edited. The message is "This is the main card for the post. Open its sub-issues to work on them."
- **A sub-issue** shows "Sub-issue of" with a link to its parent, plus a **Parent issue** box in the right panel.
- **A parent** lists its sub-issues under a "Sub-issues N" header.
- **There is no New issue button and no Add sub-issue button, for anyone.** The owner's rule: posts and their sub-issues are created only from the content calendar (Create Post on the client's Calendar or Samples tab) or from Submit. The point is that nothing exists in SyncLinear that is not also in the calendar.
- **Recover issue:** this button appears only if a create from an earlier version of the page may have half-finished. It lets the author finish or see that item.

#### An issue's page: properties

- **Status.** The order is Backlog, Todo, In Progress, For SMM approval, For Kasper approval, Tweak Needed, For Client Approval, Approved, Scheduled, Posted, Canceled, Duplicate (plus Triage).
  - New work starts in **Todo**, and the assignee moves it.
  - Hovering over the status shows how long the issue has been in it.
  - Editors may move their own assigned work to any status.
- **Assignee:** pick a teammate, or leave it unassigned.
- **Due date:** type a date (for example "Jul 20 2027"), or use Tomorrow, End of this week, In one week, Custom… (a calendar) or Remove due date. Overdue dates are highlighted.
- **Labels:** search the label list and tick labels. Workload capacity labels such as "3× Workload" also live here.
- **Priority:** SyncLinear has no priority field.
- **Project:** the client. Warnings such as "Needs attribution" or "Attribution conflict" mean the issue's client link needs fixing by an admin.
- **Social media manager:** shows the client's SMM, taken from the roster. Read only.
- **Open in Calendar:** opens the linked Calendar card in a new tab.
- **Back to card:** appears when you came from a card, and takes you back to it.
- **Who may change what:**
  - **Admins and SMMs:** everything above.
  - **Editors and designers:**
    - Can comment on their own team's issues.
    - Can change the status and the title only on their team's issues that are **assigned to them**.
    - Can edit the Raw footage, Frame folder and Deliverable/Thumbnail file links on any issue.
    - Cannot change the assignee, due date, labels or description.
  - **Blocked controls:** they stay visible but greyed out, and their tooltip gives the reason (for example "This issue is not assigned to you.").

#### Title, description and images

- **Renaming:** click the title of a sub-issue to rename it. The "Video 1 — " part is fixed, and only the name after the dash changes. Enter saves the new name and Escape cancels.
- **Description:** press **Edit** to write in it. It is Markdown, and you can switch between a formatted view and plain Markdown. **Save** and **Cancel** are at the bottom, and Ctrl/Cmd + Enter also saves.
  - The parent's description is the post's own text. Each sub-issue has its own brief.
  - Only admins and SMMs can edit descriptions.
- **Images in descriptions:** paste or drop an image into the editor to upload and insert it. Switch: `description_image_upload_enabled`, on for everyone.

#### Assets and trial versions

- **The Assets box has four rows:**
  - **Filming plan:** found from the client automatically. It cannot be edited here.
  - **Raw footage** and **Frame folder:** shared by the whole post. Editing one changes it on the parent and on every sub-issue.
  - **Deliverable file:** called **Thumbnail file** on graphics. This is the finished file for this sub-issue. A parent issue normally does not show it.
- **Status words on each row:** Available, Missing, Not checked, Permission denied, Expired and so on. "Refresh access" checks the sharing again.
- **"from the content calendar / samples card / client / post"** means the link is borrowed from there. Editing a borrowed link changes what the Calendar shows too.
- **Trial reels:** when a card has Trial reels on, the video sub-issue shows one "Deliverable file · Video A … E" row per version, each with its own Edit. Switch: `trial_reels_pages`, which is on for the test client only.

#### Comments ("Feedback & tweaks")

- **Writing:** type in the box and press **Comment**.
- **Each comment has:** Reply, Edit, Resolve/Reopen (on top-level threads) and Delete. Which of these you see depends on your rights.
- **Labels on each comment:** Internal or Client-visible, where it came from (Native comment, Linear import, Imported feedback, Linked feedback, Calendar or Samples source), Video or Graphics, and "Tweak · Round N" with Open or Resolved.
- **Who can see a comment:** a new comment is **Internal**. The Internal/Client-visible switch is offered only when a matching Samples card is linked; otherwise it is greyed out with that reason.
- **Notes from the Calendar card** show up here as feedback.

#### Thumbnail titles

- **Buttons:** **Thumbnail titles** sits on a post's "Sub-issues" header and titles every thumbnail. **Write title** sits next to Edit on a single thumbnail's description and titles just that one.
- **How a run works:**
  1. The server reads the client's filming plan. If it cannot tell which plan tab to use, it asks you ("Use this tab" / "Cancel").
  2. It writes a title only into an empty description, or over the old automatic "Needs info" line.
  3. If a person already wrote something, it shows Now/New and asks you to choose: Keep mine, Replace (your text stays under the title) or Add title above mine. For an earlier AI title, the choices are Keep the old title or Use new.
  4. Undo and Use another tab are offered afterwards.
- **Practical details:** only admins and SMMs can run it. A run continues if you close the tab, and there is one run per post.
- **Switches:**
  - The buttons: no switch, permanent for every signed-in staff member since 2026-10-29, no switch.
  - `thumbnail_titles` (a separate automatic background writer of titles): on for all clients (its list is `*`).

#### How a Calendar card and its Production work item stay in sync

- **Linking:** each Calendar (or Samples) card is linked to its video sub-issue and its thumbnail sub-issue.
- **Status:** when someone changes a status in Production, the server updates the card's video or graphic status, then works out the card's overall status again (the worst of video, graphic and caption). A status changed on the Calendar writes both sides.
- **Names (`rename_propagation`):** renaming a card renames its linked sub-issues, keeping the "Video N — " prefix. Renaming a sub-issue renames its card. This happens on the server a moment later and never blocks a save. Older mismatches stay until someone renames one side. The switch is on, with its three parts (card → sub-issue, sub-issue → card, Samples) all on.

#### Submit (staff form, "Create production work")

- **What it is for:** handing a shoot's footage to the team. It creates the post and its work in one step. It is for raw footage uploads; there is no separate "request a graphic" mode. Only admins and SMMs can use it, and they must be signed in.
- **Fields and buttons, top to bottom:**
  - **Copy upload link:** copies the client upload link (see the next section).
  - **Client:** search and pick from the client list.
  - **Title:** filled in for you as "Client · today's date". You cannot edit it.
  - **Filming Plans:** found from the client automatically. It may say "Resolved securely when submitted" or warn "No filming plan found for this client". A missing plan never blocks the submission.
  - **Main folder:** the Google Drive folder for the whole shoot.
  - **Notes** (optional): notes about the whole shoot.
  - **Videos:** use − / + or type a number. The form starts at 12 videos (1 on a phone), and the maximum is 24.
  - **One box per video:**
    - **Main camera** link.
    - **Side camera** link (optional).
    - **Audio** link (optional).
    - **Notes for this video** (optional).
  - **Shortcut:** press Shift inside a link box to paste the last link you used.
  - **Make a thumbnail too:** on by default, and the app remembers your choice. On creates a video and a thumbnail for each video; off creates video only.
  - **Create deliverables:** sends the form.
- **What submitting creates:**
  - One parent issue.
  - For each video, "Video N" and, if the thumbnail switch is on, "Thumbnail N", all in **Todo**.
  - Due dates: videos 1–5 are due in 5 working days, videos 6–10 in 10, and so on.
  - One linked Calendar card per video, with no date set.
- **If something fails:** what you typed is kept in your browser. A "Saved submission" box offers Restore it, Send it as it was (or Finish it) and Discard it. Pressing the button again never sends the same submission twice.
- (unconfirmed: who the video sub-issues are assigned to when made through Submit)

#### Public client upload link vs Submit

- **What it is:** the same form, opened from a link ending in `?intake=1`, titled "Upload your content". It has the Synchro Social logo and a "?" link that explains how the page works. The Title field is hidden, but the title is still made and sent.
- **Who uses it:** clients and videographers sending footage. Neither needs to sign in.
- **Who sends it:** any staff member with Submit, using **Copy upload link**. It is one shared link and the person picks their client in the form. (unconfirmed: whether the client list on the link is narrowed)
- **What happens to a submission:** it lands exactly like a staff Submit: a parent, Video and Thumbnail sub-issues, and Calendar cards. Each piece is marked as coming from the public link.
  - The sender sees "Upload received. Thank you!".
  - If only the last step failed, they see "We are finishing one last step… press the button again".
- **Limits:**
  - At most 50 work items per submission (25 videos when thumbnails are on).
  - About 12 submissions per client per hour, and 60 per hour across all clients.
- **Switch:** `public_intake_enabled`, on. When it is off, the link cannot submit.
- **Background document:** `docs/features/CLIENT_FOOTAGE_SUBMISSION.md` is an older design note (July 2026). The fix it describes is live: a missing filming plan never blocks a client. Its redesign ideas are partly reflected in the current form (one main folder, optional side camera and audio, notes per video).

#### Quiz intake

- **What it is:** the Growth Bottleneck Quiz on the marketing website (synchrosocial.com/quiz) sends answers to SyncView, at most 120 per hour.
- **Where answers appear:** admins read them in Kasper > More > Pipeline & Admin > **Quiz Leads**. Answers are also passed to the sales automation.
- **Switch:** `quiz_intake_enabled`, on.
- It is a marketing lead form, unrelated to footage or Production.

### Post tab, Kasper area, Notes and Messages, Leads, Hiring, Sales Intake and SyncMate

Switch values below are the live values read on 2026-10-28.

#### Post tab (posting to TikTok and Instagram)

**What it's for:** posting a finished video or carousel straight to a client's TikTok or Instagram, either now or at a set time. Open it with the **Post** button in the staff header (on a phone, the screen is titled "Post to TikTok" or "Post to Instagram").

**Who can use it:** any signed-in staff member (admin, SMM, or editor/designer). The server turns away anyone without a staff sign-in. Clients never see this tab.

- **Platform switch (TikTok / Instagram)** at the top. Your browser remembers which side you used last.
- **Client:** pick the client. The tab shows which Post For Me account the post will go to. If no account is connected, you see "⚠ No account" and cannot post. Nothing ever falls back to another account.
  - The TikTok account id is added by an admin under **Kasper > More > Clients > Publishing > "Post for Me"**.
  - The Instagram account id is a separate field, stored on the client's SyncView profile (`postforme_instagram_account_id`). An admin adds it under **Kasper > More > Clients > Publishing > "Instagram (Post for Me)"** (or through roster-write). The Clients Info sheet only holds a copy of it.
  - The client's Facebook Page (for "Also post to Facebook") is added the same way, under **"Facebook Page (Post for Me)"**. It is not in the sheet.
- **Instagram only, server allow-list:** Instagram posting works only for clients on a server allow-list that the owner manages. Which clients are on it is not published (unconfirmed). TikTok has no such client list, but it does check that the account on file is a TikTok account.
- **Live switch `tiktok_upload_source` = supabase:** TikTok uploads and the queue run through SyncView's own server, not the old n8n and Sheet route. You do nothing differently because of it.

**TikTok side**
- **Media: Video or Photo carousel.**
  - Video: MP4, MOV or WebM, up to 287 MB.
  - Photo carousel: 1 to 35 JPEG, PNG or WEBP images, up to 20 MB each. Reorder with the arrows; remove with ×.
- **Caption:** up to 2,200 characters.
  - If the video's file name matches exactly one of the client's Calendar cards, that card's caption fills an empty caption box, with an **Undo**.
  - If the card has a second caption written for this platform, that one is used.
- **Scheduling:** "Post immediately" is on by default. Switch it off to pick a date, time (with AM/PM) and timezone.
- **TikTok options** (open with "Show options"):
  - Privacy: Public, or Private (only me).
  - Post mode: Direct post, or Send to TikTok drafts.
  - Cover timestamp in milliseconds: which frame TikTok uses as the thumbnail.
  - Music: auto-add trending music (photo carousels only).
  - Disable duet, Disable comments, Disable stitch.
  - Commercial content: Branded content, Your brand, AI-generated.
- **Live preview:** shows how the post will look in the For You feed.
- **Button:** "Post to TikTok" or "Schedule on TikTok". While a post uploads you see a progress bar and a **Cancel** button.
- **Drafts:** your draft is kept in your browser. After a reload it asks you to re-attach the file.

**Instagram side**
- **Post type: Reel or Carousel.**
  - Reel: one MP4 or MOV video.
  - Carousel: one feed post of 2 to 10 images and videos, mixed. JPEG, PNG, WEBP, MP4 or MOV; images up to 8 MB. Reorder with the arrows; remove with ×. Instagram crops every item to the shape of the first one.
- **Cover image (Reel only, optional):** choose one of these:
  - **Image:** upload a JPEG or PNG, 9:16, up to 8 MB.
  - **Pick a Calendar card:** choose one of the client's Approved or Scheduled cards to use its thumbnail as the cover. Its caption also fills the caption box if that box is empty.
  - **Frame from video:** drag a slider to choose a frame. At 0 seconds Instagram uses the first frame.
- **Caption:** up to 2,200 characters, with the same fill-from-Calendar and Undo as TikTok.
- **Trial reel switch (Reel only):**
  - The reel is shown to non-followers first. It reaches followers only if someone shares it from the Instagram app.
  - Not every account can post trial reels. If this one cannot, the post shows as Failed with Instagram's reason.
  - The switch has no runtime switch of its own and is there for everyone who uses the tab.
  - A carousel can never be a trial.
- **Also post to Facebook:** shown once a client is picked. Ticked by default when the client's Facebook Page is on file; the same post then also goes to the Page (a Reel as a Facebook Reel; a carousel of photos as one Facebook post). Untick it for Instagram only. It is off, with the reason, for a trial reel, a carousel with a video, or a client with no Page. No runtime switch: the server allow-list above still decides who can post.
- **Scheduling:** works the same way as TikTok (date, hour, minutes in 5-minute steps, AM/PM, timezone).
- **Button:** "Post to Instagram" or "Schedule on Instagram".
  - If SyncView could not confirm the post went through, press the button again. It will not post twice.

**The queue (right side, one per platform)**
- Three tabs: **Upcoming**, **Failed** (turns red when something failed) and **Done**. "Show more" loads 5 more rows at a time.
- Each row shows the client, the caption, the status (Uploading, Posting, Scheduled, Posted, Failed, Cancelled) and the type: Reel, Trial reel, Carousel (n) or TikTok.
  - A post that also went to Facebook shows Instagram and Facebook on their own lines, each with its status (and reason if it failed), and an **Instagram** and a **Facebook** link once live. It sits under Failed if either failed. Cancel cancels both.
- **Cancel** (scheduled posts only) removes the post from Post For Me so it never goes out. The file stays on your computer.
  - On TikTok, a post that has already published cannot be cancelled.
- **Open** opens the published post.
- **TikTok only:**
  - **Retry** resends a failed post.
  - **×** (Dismiss) hides a row in your own browser.
- The queue refreshes by itself: often while something is posting, rarely while posts are only scheduled.

**TikTok Pilot:** a hidden page that posts directly to TikTok, waiting on TikTok's app review. It is not submission-ready and not part of normal work.

#### Kasper area: overview

**Who:** admins only. The **Kasper** button appears in the header only for a verified admin sign-in. The header says "Kasper — Things waiting for your call."

- **Main tabs:** Review Session, Messages and Filming Plans.
  - For the people the new review page switch lists, the main tabs are only Review and Messages, and Filming Plans moves into More.
- **More menu** (the ⋯ button; it takes the name of the open section). It has three groups:
  - **Team:** Editors, Time Off.
  - **Pipeline & Admin:** Sales Intake, Hiring Process, Onboarding, Leads, Quiz Leads, Client Credentials, Clients, Save problems.
  - **Analytics:** Ad Performance.
- **Counts:** tabs show a count of what is waiting (Time Off and Onboarding show one only when it is above zero). The More button adds up the counts of the tabs inside it.
- **`kasper_fast_boot`** (on for 3 staff members): the Kasper tab opens fast from a saved list. A saved list older than 3 minutes is not shown as if it were current.
- **`kasper_urgent_ping_enabled`** (on):
  - On a card part waiting at Kasper Approval, staff get an **URGENT** button. It sends Kasper a Slack ping and puts the card in an **Urgent** section at the top of Kasper's Review Session.
  - The card leaves Urgent by itself once Kasper decides.

#### Kasper: Review Session

**What it's for:** where Kasper reviews every part (video, thumbnail, caption, title) that is waiting at "Kasper Approval".

**Sections:**
- **Urgent** (shown only when something was pinged).
- **Waiting for your review.**
- **Tweaks pending:** Kasper already asked for changes, and the work is with the SMM or editor.
- **Approved history:** this also notes any card someone moved past Kasper "without your decision".
- **"Sent back to you"** marks a card that came back to Kasper after a decision on it.

**Buttons on each part:**
- **Approve:** sends it on to the client.
- **Comment:** a team-only note. It does not change the status or tell the editor.
- **Request change:** moves the part to Tweaks Needed.
- **Approve after tweaks:** sends the tweak to the editor. After the fix, the part goes straight to the client with no second look from Kasper.

**Buttons on the whole card:**
- **Finish reviewing:** hands the card to the SMM. Approved parts go to the client, tweaks go to Tweaks pending, and parts Kasper only commented on wait for a reply.
- **Close (×):** hides the card without a decision. It comes back when a new message arrives.
- **Ping editor:** sends the editor a Slack ping.

**New review page:**
- `review_stage_kasper_staff` (3 staff) switches the new review page on. It has Next post, Undo for a few seconds after Approve, and a "With the editors" strip.
- `review_stage_kasper_layout2` (the same 3 staff, screens 1360 px wide or more) adds a second layout: a list of cards on the left, every part on screen at once, and Finish reviewing and Close card at the top right.

#### Kasper: other subtabs

- **Messages:** the same inbox as the header Messages button (see Messages inbox below).
- **Editors:** last week, one row per editor.
  - It shows "on his plate" (load) against "pushed through" (first cuts and tweak rounds handed off), with bars per day.
  - Click an editor for their timeline. Click a day's bar for that day's clients.
  - Read-only.
- **Filming Plans:** one row per client, sorted by who needs a new filming plan soonest.
  - "Content" counts the client's active Calendar cards that are still available.
  - The alert turns red when content is very low or a plan is overdue, and amber when content is getting low or a plan is due within 2 weeks.
- **Time Off:** the team leave calendar.
  - It shows Away today, Off this month and Pending this month, plus observed holidays.
  - Pick a day to **Approve** or **Deny** requests on it. There is also an Adjustments section.
  - This subtab needs the leave-admin right and `pto_v1` (on).
- **Sales Intake:** see Sales intake below.
- **Hiring Process:** see Hiring below.
- **Onboarding:** the full client onboarding inbox, in three sections (Standard, AI, Old forms), with search. It shows names, contact details and account logins.
- **Client Credentials:** the one place for client Instagram, TikTok, Facebook, LinkedIn, YouTube and other logins.
  - Buttons: **Add credential**, **Import from onboarding**, **Refresh**.
  - Every password reveal and every edit is recorded. SMMs can also reach this page outside Kasper.
- **Clients:** the client roster.
  - Use **search**, **All clients** and **New client**.
  - Each client has sections for contact and team (email, Slack channel, creative channel, Slack person to tag), social accounts, publishing (Post for Me, Upload-Post), and a folded Content research section.
  - SMMs can be assigned here, and values have Copy buttons.
- **Save problems:** every refused or failed save that reached the server log in the last 30 days.
  - Filter by Period, Screen (Calendar, Samples, Production) and Who (client links or staff).
  - Read-only. Some surfaces do not report, so a missing row does not prove a save worked.
- **Ad Performance:** read-only figures for the agency's own Meta prospecting ads (the ads that bring in sales calls): spend, landing page views, conversion rate, cost per booking, and iClosed bookings.
  - It has a date-range toggle, a per-ad table, a per-lead list (with phone) and an unfinished-leads section.
  - Updated twice a day. It is not a per-client feature.
- **Leads:** opens the Leads page (see below).
- **Quiz Leads:** a read-only list of Growth Bottleneck Quiz answers from the public quiz, newest first.

#### Notes on cards (how comments flow between client and staff)

**Where:** every Calendar card has a **Notes** panel. Clients open the same panel from their review link.

**Staff writing a new note:**
- A note is **team only** by default (lock icon). Click the icon to switch to **"The client can see this"** (eye icon). Notes to the client carry a "To client" tag.
- The arrow next to Send has **Request change**, which moves the part to Tweaks Needed and is always team only.
- "About the…" picks which part the note is about (Video, Thumbnail, Caption, Title).
- A reply keeps the audience and part of the thread it answers.
- **Mark done** closes a change request. Finished threads move to history (icon at the top right).
- A note to the client is only offered where the client can actually read it.

**Client writing a note:**
- "This is a… **Comment**" (does not change the status) or "**Request a change**" (moves the card to Tweaks Needed).
- The client also picks "About the…".
- The client sees the team as one name, "Synchro team", and never sees staff names or team-only notes.

**Frame.io comments in Notes (every signed-in staff member, no switch since 2026-10-29):**
- A card's Frame.io comments appear in its Notes, marked "A comment left in Frame.io. Reply to it there."
- Only the first comments show; the rest are in Frame.io.
- Comments on older versions of a version stack are not shown.
- Never on the client link.

#### Messages inbox and unread badges

**Who:** admins and SMMs. Open it with the header **Messages** button, the phone Tabs menu, or Kasper > Messages.
- An SMM sees their own clients.
- An admin who is not on the SMM roster sees every client (the reviewer view).
- Editors and designers have no inbox.
- A card drops out once it is posted.

**What's in it:**
- **New / All** switch, plus **To answer** for badge users.
- Search conversations.
- **Reply** under a thread.
- **Open card** opens the card's Notes in the Calendar.
- **Mark as unread.**
- Change requests carry a "Change request" tag. Messages written to the client carry "To client".

**What counts as new:**
- Automatic records never count.
- Kasper's inbox counts only staff messages.
- The badge refreshes by itself.

**Unread badges (every signed-in staff member, desktop only, no switch since 2026-10-29):**
- A card's Notes button shows a small photo of each person with something for you, with a coloured number:
  - orange: change request
  - blue: client comment
  - grey: team
  - violet: Kasper
- A filled number means new. A plain coloured number means you have read it but it still needs you.
- Hovering a note gives Reply, **No reply needed**, Mark done and Delete. "No reply needed" and "Mark unread" are kept only in your browser for now.

**Client link (`review_client_polish`, on for all clients):** the same badges, but only the team's notes count for the client.

#### Leads (CRM)

**What it's for:** everyone we might sell to, where each person stands, and what happens next.

**Where and who:** the page is `/leads` (Kasper > More > Pipeline & Admin > Leads). It is admin only. **Nothing in Leads sends a message.**

**Home page:** a search bar and four colour tiles, each with its key number: **Today**, **Leads**, **Report**, **Automations**. Every other page has a fixed menu row with these sections and search. Browser Back, Forward and reload keep your place.

**Leads (the list):**
- One table with the columns Name, Stage, Where they came from, Niche, Next step and Due.
- Click a column title to filter (Stage, Source, Niche, Due) or sort (Name). "Show everyone" clears the filters.
- People are split into **Cold leads** (Dream 100, people we picked to reach out to) and **Warm leads** (ad leads, past calls, email list, referrals). Each section folds.
- An **All / Cold / Warm** toggle shows one or both.
- Overdue next steps are marked.

**Stages:** To contact, Contacted, Replied, Call 1 booked, No-show, Call 1 done, Call 2 done, Gone quiet, Won, Lost. Hover a stage name for its meaning.

**Changing a stage:** drag and drop between stages was removed. Change a stage on the person's page.

**Person page:**
- Opens from a row or a search result.
- **Edit** changes the stage, next step and due date. If they were lost, you also pick why it didn't close (Price, Trust, Timing, Budget, No-show).
- "What's happened" is the timeline. Use **Add a note** to write down what happened on a call or in a message.
- Lists the automations they are in, with pause and resume, **Skip next**, **Stop**, and adding them to one.
- "Also in Leads as" offers **Merge** for a same-name duplicate.
- With no next step typed, a greyed suggestion from the stage shows.

**Today:**
- Next steps due today or overdue.
- "Did they show?" for calls that have passed: **Showed** moves the person to Call 1 done. **No-show** moves them to No-show and adds them to the No-show automation.
- Automatic sends due in the next 24 hours, with their state.

**Report:** one row per source, with the stages left to right, each in its own colour: Filled in the form (came from an ad form, or the form was sent or started), Booked, Showed up and Signed, then Total at the far right. It also has "Same person twice?" for merging.

**Automations:**
- Every email and text a lead gets by itself, grouped by when it starts.
- SyncView's own sequences start **off**, and every step is a **draft** until an admin presses **Approve**. Use **Edit** and then "Save as draft" to change a step.
- n8n automations show read-only, word for word.

#### Hiring Process (briefly)

- **Where and who:** Kasper > More > Hiring Process, admin only.
- **Roles:** applications come in from iClosed for two roles: Client Success & Content Manager, and Video Editor (which adds a practical-test stage).
- **Status filters:** New, In review, On hold, Invited, All.
- **What Kasper does:**
  - **Mark in review**, or mark an applicant as not moving forward (this sends no email).
  - See an **Email preview**.
  - Queue an **Interview invitation**, or for editors a **practical test**, then record its verdict. A pass unlocks the final interview invite.
- **Switches:** `hiring_invites_enabled` and `hiring_practical_tests_enabled` are both on, so these emails send automatically. The owner plans to switch them off once the hire closes.

#### Sales Intake (briefly)

- **Where and who:** Kasper > More > Sales Intake, filled in by Kasper after closing a deal on a call.
- **Fields:** client name, who closed it, Instagram, email, phone, start date, deliverables, billing type, payment processor (Stripe or Commas, with no default), payment link, termination clause, and referred by.
- **Buttons:** **Generate agreement preview**, then **Create agreement & send**. This creates the e-signature agreement and emails the client the agreement and the invoice link.
- Whether the earlier safety gaps noted in the design doc are fixed is unconfirmed.

#### SyncMate (the team's AI assistant connector)

**What it is:** SyncMate, formerly "the Connector", is a connector you add to your own Claude (or ChatGPT) chat. It is for everyone on the team, mainly SMMs, editors and designers.

**How you get it:**
- Each teammate has a personal link with their own pass. There is also a shared Team link, which asks for your first name so the log shows who did what.
- Apps that only accept a sign-in use SyncMate's sign-in page, where you type your pass once.
- Who issues passes is unconfirmed (ask the owner).
- After SyncMate's tools change, use "Refresh tool list" in the connector settings and start a new chat.

**What you can do:**
- **Make AI images and videos** with Higgsfield's models.
  - GPT Image is used for photo edits, thumbnails and new photos. Nano Banana is switched off.
  - It picks a model and sensible settings: vertical 9:16, about 1080p.
- **Price check before every create:** it always shows a plan card (model, every setting, the exact price, other options) and waits for you to say "go". Changing anything re-prices it.
- **Recipes:**
  - Thumbnail expression fix.
  - B-roll as photo first, then video. You approve the still image, then that exact image is animated.
  - Batches of thumbnails from screenshots.
- **Client brains:** reads what the Synchro Brain knows about a client, and saves new lasting facts.
- **Client style** for thumbnail titles.
- **Filming plans:** reads a client's filming plan.
- **Studio tools:**
  - The Synchro video studio download, and client video profiles.
  - **Review notes** for doing a client's tweaks.
  - Trial reel versions.
  - Shared tools and kits.
  - Voice clean-up (removes background noise).
  - Transcription.
  - Feedback notes on the filming pipeline.
- **Files:** turns Drive and Dropbox links into links the models can read.
- **Team usage:** shows this month's spend.

**What it never does:**
- Never makes anything without showing the price first.
- Never goes past the team's monthly budget cap.
- Never changes SyncView, code, n8n, ads or Slack. It says that is the owner's job.
- Never offers tools from other connectors.

### Every live switch, and who has it on

Read-only from `syncview_runtime_flags` on 2026-10-28. "All staff" means every signed-in staff member and never the client link. "All clients" means every client link. A switch the page reads but that has no row live is at its default: `analytics_hidden` has no row, so Analytics is hidden. Five former staff switches are no longer read and are on for every signed-in staff member, whatever their rows say (2026-10-29, session Permafive): caption history, Frame.io comments in Notes, the unread badges, the phone polish and the thumbnail title buttons (`caption_history_staff`, `frame_comments_in_notes_staff`, `unread_badges_v2`, `phone_polish_staff`, `thumbnail_title_buttons_staff`).

| Switch | What a teammate notices | Who has it on |
| --- | --- | --- |
| `analytics_hidden` | The Analytics tab and client Analytics | No row: hidden for everyone |
| `calendar_auto_posted` | Scheduled posts turn Posted by themselves after their day ends | All clients (`*`) |
| `calendar_card_write_clients` | Card saves use the newer save path | All clients |
| `write_ui_reroute_clients`, `calendar_upsert_ef_clients`, `sample_review_ef_clients`, `settings_ef_clients` | Create Post opens the dialog, and saves and settings go through the server (for other clients, Create Post adds a blank card) | A list of 38 clients, including the test client |
| `caption_generate_ef_clients` | Generate caption | All clients |
| `frame_viewer_clients` | The in-page Frame.io player | All clients (and staff) |
| `thumbnail_titles` | Background job that writes titles into new thumbnail sub-issues | All clients (`*`) |
| `thumbnail_revision_v2` | Compare old and new thumbnail on the card | On |
| `workload_calm_staff` | Calm Workload design | All staff |
| `review_stage_client_pages` | The guided client Review page and the SMM Review tab | All clients |
| `review_client_polish` | Client link polish: instant Approve, quiet notes, unread badges | All clients (watched until 2026-10-31) |
| `review_help_video_url` | The "?" help video on the client link | Set |
| `review_stage_kasper_staff` | Kasper's new Review Session page | 3 staff members |
| `review_stage_kasper_layout2` | Kasper's second layout (wide screens) | 3 staff members |
| `kasper_fast_boot` | Kasper tab opens from a saved list | 3 staff members |
| `kasper_urgent_ping_enabled` | URGENT button pings Kasper | On |
| `trial_reels_pages` | Trial reels on the card, in Production, on review pages and the client link | Test client only |
| `rename_propagation` | Card name and sub-issue names follow each other (and Samples) | On (all three parts) |
| `description_image_upload_enabled` | Paste images into Production descriptions | On |
| `sheet_fit_v1` | Calendar Sheet fits the window, tighter spacing, compact smallest size, the wheel follows the gesture (desktop; staff by id or name, clients by slug, or `all`) | All staff and all clients (`all: true`, since 2026-10-31) |
| `editor_suggest_last` | Puts some editors last in Create Post's editor suggestions | 1 staff member listed |
| `prod_authority` | SyncLinear can edit Video and Graphics work | Both on SyncView |
| `public_intake_enabled` | The client upload link can submit | On |
| `quiz_intake_enabled` | The marketing quiz feeds Quiz Leads | On |
| `pto_v1` | Time Off | On |
| `hiring_invites_enabled`, `hiring_practical_tests_enabled` | Hiring emails send automatically | On |
| `client_hubspot_sync` | HubSpot band on a client profile | 3 clients, including the test client |
| `tiktok_upload_source` | TikTok uploads run through SyncView's own server | SyncView |
| `analytics_metrics_collect`, `analytics_top_videos_collect` | SyncView's own analytics collector | Off |
| `linear_outbound_enabled`, `linear_legacy_parity_enabled` | Old Linear sync | Off (Linear is no longer used) |

Background switches with nothing to click (`auth_enforcement`, `client_comment_gateway_enabled`, `client_profiles_authority`, `analytics_mirror_*`, `filming_plan_tabs_source`, `native_*`, `production_native_*`, `write_ui_overdue_due_bump`) are covered in the technical sections below and in [State of things](STATE_OF_THINGS.md).

### Still unconfirmed

- How an issue is added to SyncLinear's Favorites.
- Who the video sub-issues are assigned to when the work comes in through Submit or the upload link.
- Whether the upload link's client list is narrower than the staff one.
- Whether the Onboarding inbox loads for SMM and Creative (the menu shows it; the server reader checks for Admin).
- Which roles may use **Edit links** on Templates.
- Whether the weekly SMM report reminder email to Kasper runs.
- Whether the old "SyncView Calendar" Google Sheet backup is still being written. Clients never see it either way.
- Whether a client's answer on a Samples link is held in the browser until the server confirms it, as it is on Calendar links.
- Which clients are on the server allow-list for Instagram posting.
- Who issues SyncMate passes (ask the owner).
- Whether the safety gaps listed in the Sales Intake design doc are closed.

## Four repos

Verified 2026-10-29 against main 45c88a8 and the live catalog (read-only).

Staff and client pages in client-analytics use Supabase and n8n. The Brain holds editorial knowledge; the pipelines read that knowledge and publish review material to Google. The marketing site supplies sales, quiz and onboarding intake to the same backend ecosystem.


| Repo | Owner | Purpose and connection |
| --- | --- | --- |
| client-analytics | [Source map](../REPO_MAP.md) and [Pages publishing](../.github/workflows/pages-site.yml) | SyncView, its Supabase source, operational docs and monitoring. Pages publishes an allowlisted site from main; Edge Functions deploy on merge through their own lanes below. Client info lives in SyncView's client profiles; the Clients Info sheet is a copy. |
| synchro-pipelines | [Pipeline entry](https://github.com/sidney-afk/synchro-pipelines/blob/main/README.md) and Google bridge client (`google_relay.py`; the `pipeline-google` function itself lives in this repo since 2026-10-16) | Research and concept review tools read a sibling Brain checkout. Local runs publish Sheets and Docs through n8n or pipeline-google; this repo has no GitHub workflow files (unverified 2026-10-29). |
| synchro-brain | [Knowledge layout](https://github.com/sidney-afk/synchro-brain/blob/main/README.md) and [Change processor](https://github.com/sidney-afk/synchro-brain/blob/main/.github/workflows/process-syncview-change.yml) | Private editorial knowledge. SyncView brain reads files and adds change inputs; the Brain workflow files those changes into facts on main. Its README still contained an older disconnected state description at the last read (unverified 2026-10-29). |
| synchrosocial | [Marketing map](https://github.com/sidney-afk/synchrosocial/blob/main/docs/ECOSYSTEM_MAP.md) and [Site deploy](https://github.com/sidney-afk/synchrosocial/blob/main/.github/workflows/deploy.yml) | Marketing and acquisition site. Its build publishes dist to GitHub Pages from main; sales, onboarding and quiz flows feed n8n and Supabase. Its Enterprise Atlas remains the company map. |

Sibling source commits: `synchrosocial` main is `522fefd75dab11c0008ffc7bc723d60856175459` (read 2026-10-29). `synchro-pipelines` and `synchro-brain` are private and could not be read from this session; their last recorded commits, from the 2026-09-30 pass, are `9ed2cfa6d7c2ba841c0e0d78d9c252754503b504` and `5e77a75fb6abcff9b7d819c28fa39a2b7d16eb0b` (unverified 2026-10-29). These are source snapshots, without a live browser or publication proof for the sibling sites.

## Screens

Verified 2026-10-29 against main 45c88a8 and the live catalog (read-only).

Visibility below comes from page source and role checks. Shared rules live in [staff capabilities](../src/index/100-onboarding-staff-controls.js.part). A visible screen does not itself grant database access. [Clean addresses](../src/index/003-sv-route.html.part) and [the fragment list](../src/index/manifest.txt) own routing and assembly; `src/index/INDEX.md` is the generated fragment map (a build output, not committed). Several screens sit behind runtime switches in `syncview_runtime_flags`, read once per page in [the switch reader](../src/index/188-review-stage-switch.js.part); live states below were read on 2026-10-29.


| Screen | Who sees it | Fragment and purpose |
| --- | --- | --- |
| Today | Staff; SMM and admin see their own roster clients (an admin not on the roster sees all), plus the test client their own roster row lists; video and graphics see their own queue. | [097-today.js.part](../src/index/097-today.js.part). Daily work and review priorities; reads only. Client scope is the shared rule in [098-smm-clients.js.part](../src/index/098-smm-clients.js.part). |
| Analytics overview and client profile | Staff; verified client link sees its own profile. | [050-market-briefs.js.part](../src/index/050-market-briefs.js.part). Social metrics, top videos and period comparisons (`renderOverview`, `renderClient`); 095-shared-client opens it. |
| Brief, market research and content summaries | Staff and scoped client profile. | [050-market-briefs.js.part](../src/index/050-market-briefs.js.part). Research tabs and content summary views; shared brief helpers, theme, toasts and the analytics cache live in [040-shared-briefs.js.part](../src/index/040-shared-briefs.js.part). |
| Content Calendar and card dialog | Staff and scoped client link. | [134-calendar-prefs-mount.js.part](../src/index/134-calendar-prefs-mount.js.part). Calendar cards, the client-link sheet view and review state. |
| Calendar create, intake and media | Staff; separate public intake entry. | [180-calendar-native-post-media.js.part](../src/index/180-calendar-native-post-media.js.part). Native work creation and video, thumbnail or brief material. |
| Calendar approval, changes and Notes | Staff and scoped client link. | [190-calendar-approval-comments.js.part](../src/index/190-calendar-approval-comments.js.part). Native status, the Notes dialog, canonical threads and client review. |
| Watch here (Frame.io player in Notes) | Staff, Kasper and client link; live switch `frame_viewer_clients` is on for all. A client link never sees Frame.io comments. | [187-frame-viewer.js.part](../src/index/187-frame-viewer.js.part). A card's Frame.io video beside its notes; read only. |
| Review page (guided stage) | Client review link and the SMM's Review tab (live: all clients); Kasper's Review Session only for the staff `review_stage_kasper_staff` names (live: 3). | [195-review-stage.js.part](../src/index/195-review-stage.js.part), loaded on demand. One page for client, SMM and Kasper; every button calls the old page's save. |
| Trial reels on the card | Staff Calendar only, behind `trial_reels_pages` (live: one client). | [189-trial-reels-card.js.part](../src/index/189-trial-reels-card.js.part). Video versions A to G, 24 h trial state and the winner, written through the trial-reels function. |
| Trial reels on the review page | Client link, SMM Review tab and Kasper, behind the same switch. | [194-review-trial-versions.js.part](../src/index/194-review-trial-versions.js.part). One version at a time with per-version answers; approve and change requests reuse the card's paths. |
| Samples and sample card | Staff and scoped client link. | [270-samples-model.js.part](../src/index/270-samples-model.js.part). Sample reviews; old Samples routes redirect here. |
| Sample notes, media and comments | Staff and scoped client link. | [280-samples-cards-notes.js.part](../src/index/280-samples-cards-notes.js.part). Card editing and comment rendering. |
| Sample approval and changes | Staff and scoped client link. | [290-samples-writes-review.js.part](../src/index/290-samples-writes-review.js.part). Saves and review actions. |
| Archived Calendar cards and Samples | Admin and SMM. | [186-archived-restore.js.part](../src/index/186-archived-restore.js.part). Find and restore archived cards. |
| Client review send queue | Client review links. | [185-client-review-queue.js.part](../src/index/185-client-review-queue.js.part). Holds a client's Approve or Request changes in the browser until the server confirms it, re-sending after a dropped connection. |
| Templates and Brain facts | Staff. | [060-templates-filming.js.part](../src/index/060-templates-filming.js.part). Creative settings and editorial facts. |
| Filming Plans directory | Staff; edits use onboarding capability. | [060-templates-filming.js.part](../src/index/060-templates-filming.js.part). Client filming Doc references. |
| Workload board and week | Staff reads; admin and SMM plan days. | [080-workload-render.js.part](../src/index/080-workload-render.js.part). Native work by creative and day. The calm layout ([072-workload-calm.js.part](../src/index/072-workload-calm.js.part), switch `workload_calm_staff`, live: all) changes look only, never writes. |
| Workload issue popovers and drag planning | Staff; role checks govern writes. | [090-workload-popovers.js.part](../src/index/090-workload-popovers.js.part). Issue details; 071-workload-planner owns placement. |
| SyncLinear (header button shows the text "Linear"; "SyncLinear" is only its hidden title and ARIA label) | Staff; native authority and role checks govern writes. | [210-production-state-writes.js.part](../src/index/210-production-state-writes.js.part). Native work tree. Address /synclinear; route key is production; Submit uses linear. |
| SyncLinear views and attribution | Staff. | [220-production-attribution-views.js.part](../src/index/220-production-attribution-views.js.part). List, board, filters, ownership and parents. |
| SyncLinear create and canonical comments | Staff; client operations stay scoped. | [230-production-create-comments.js.part](../src/index/230-production-create-comments.js.part). Native creation and comment lifecycle. |
| SyncLinear descriptions and images | Staff. | [240-production-description.js.part](../src/index/240-production-description.js.part). Brief editing and image attachments. |
| SyncLinear trial reel file rows | Staff, behind `trial_reels_pages`. | [245-production-trial-versions.js.part](../src/index/245-production-trial-versions.js.part). One Deliverable file row per version in the video sub-issue's Assets. |
| SyncLinear dates, assignees and labels | Staff; role and team gates apply. | [250-production-controls-data.js.part](../src/index/250-production-controls-data.js.part). Native work controls and read projection. |
| SyncLinear thumbnail titles | Every signed-in staff member (no switch since 2026-10-29); only admins and SMMs can run it. | [255-production-thumbnail-titles.js.part](../src/index/255-production-thumbnail-titles.js.part). "Thumbnail titles" and "Write title" start a server run from the filming plan; a person's text is never overwritten without Keep mine. |
| Submit | Admin and SMM; public intake has its own entry. | [200-intake-data-startup.js.part](../src/index/200-intake-data-startup.js.part). Native video and graphic submission. |
| Post (TikTok side; header "Post", address /post, route key tiktok-upload) | Staff. | [300-tiktok-upload.js.part](../src/index/300-tiktok-upload.js.part). Video and carousel upload, scheduling, result and cancel. |
| Post (Instagram side) | Staff; server allowlist limits posting. | [299-instagram-upload.js.part](../src/index/299-instagram-upload.js.part). Reels, carousels (2 to 10 items) and a Trial reel switch through Post For Me; the account id comes from the client profile. Real posting was not tested here. |
| Messages inbox | Admin and SMM (header Messages, phone Tabs menu, Kasper Messages); the server scopes clients. | [326-core-messages-inbox.js.part](../src/index/326-core-messages-inbox.js.part). One inbox page (route messages); replies use the Notes save path. |
| Unread badges | Every signed-in staff member (no switch since 2026-10-29), desktop only. | [327-core-unread-badges.js.part](../src/index/327-core-unread-badges.js.part). People bubbles and counts on Notes and Messages; display only. |
| Leads (CRM) | Admin, plus one staff member granted by roster id; the crm-leads function decides access. | [328-crm-leads.js.part](../src/index/328-crm-leads.js.part). Page /leads, linked from Kasper > Pipeline & Admin: Today, Pipeline, sequences, search and report. |
| Kasper Review Session and review history | Admin. | [330-kasper-review-history.js.part](../src/index/330-kasper-review-history.js.part). Calendar and Samples approvals, urgent review and past reviews; the new review page replaces it for named staff. |
| Kasper Messages | Admin. | [323-kasper-dashboard-tail.js.part](../src/index/323-kasper-dashboard-tail.js.part). Opens the Messages inbox; the older Messages view remains as a fallback. |
| Kasper Editors | Admin. | [340-kasper-editors-board.js.part](../src/index/340-kasper-editors-board.js.part). Editor work and labor reporting; 330 loads it. |
| Kasper Filming Plans | Admin. | [321-kasper-dashboard-replies.js.part](../src/index/321-kasper-dashboard-replies.js.part). Doc tabs and batches. |
| Kasper Sales Intake and Hiring Process | Admin. | [310-sales-intake-hiring.js.part](../src/index/310-sales-intake-hiring.js.part). Sales and private hiring review. |
| Kasper Onboarding | Admin in Kasper; onboarding capability (admin, SMM, creative) gates the tab. | [321-kasper-dashboard-replies.js.part](../src/index/321-kasper-dashboard-replies.js.part). Standard, AI and old submissions; the form itself is in 100. |
| Kasper Client Credentials | Admin in Kasper; separate page admits admin and SMM. | [321-kasper-dashboard-replies.js.part](../src/index/321-kasper-dashboard-replies.js.part). Protected credentials and reveal history. |
| Kasper Clients (client profiles) | Admin. | [323-kasper-dashboard-tail.js.part](../src/index/323-kasper-dashboard-tail.js.part). Client profiles, the source of client info; HubSpot, resources and the onboarding checklist come from [324-client-onboarding-panel.js.part](../src/index/324-client-onboarding-panel.js.part). |
| Kasper Save problems, Ad Performance and Quiz Leads | Admin. | [321-kasper-dashboard-replies.js.part](../src/index/321-kasper-dashboard-replies.js.part). Refusal log, acquisition funnel and quiz intake. |
| Time Off and Kasper Time Off | Staff requests; admin manages. | [110-time-off.js.part](../src/index/110-time-off.js.part). Private leave requests, balances and decisions. |
| Caption prompts and caption generation dialog | Staff edits prompts; generation follows Calendar scope. | [Caption and prompt controls](../src/index/180-calendar-native-post-media.js.part). Native progress and guarded prompt save; legacy fallback reads remain. |
| Standalone onboarding viewer | Staff with onboarding capability. | [Protected full form viewer](../src/index/060-templates-filming.js.part). Full client onboarding shown in a separate browser tab (/onboarding/...). |
| SMM weekly report form and viewer | Admin and SMM submit; admin manages. | [112-smm-weekly-reports.js.part](../src/index/112-smm-weekly-reports.js.part). Manager updates and report history. |
| Standard and AI onboarding forms | Public form entry. | [100-onboarding-staff-controls.js.part](../src/index/100-onboarding-staff-controls.js.part). Submission, autosave and fallback capture. |
| Sales intake form | Admin Kasper form. | [310-sales-intake-hiring.js.part](../src/index/310-sales-intake-hiring.js.part). Sales agreement inputs. |
| Staff sign in and account menu | Staff entry; verified roles afterward. | [100-onboarding-staff-controls.js.part](../src/index/100-onboarding-staff-controls.js.part). Roster and personal role key verification. |
| Phone staff shell | Staff on a phone-width screen (767px or narrower); nothing is built at desktop widths. | [099-staff-phone-bar.js.part](../src/index/099-staff-phone-bar.js.part) and [099-phone-staff-shell.js.part](../src/index/099-phone-staff-shell.js.part). One title row with Tabs and More in place of the desktop header; every row presses an existing control. |
| Client link boot and update screen | Scoped client review entry. | [260-production-refresh-boot.js.part](../src/index/260-production-refresh-boot.js.part). Strict token validation, startup and stale callers. |
| Quick jump and shared client picker | Staff. | [096-quick-jump.js.part](../src/index/096-quick-jump.js.part). Cross-screen navigation; 095-shared-client owns shared selection and 098-smm-clients the "My clients" rule. |
| Transcript, media and date dialogs | Audience follows parent screen. | [350-footer.html.part](../src/index/350-footer.html.part). Shared dialog markup; behavior lives in parent fragments and 345-core-tooltip-date-picker. |


All Kasper subtab keys live in [KASPER_SUBTABS](../src/index/320-core-kasper-subtabs.js.part); Kasper itself shows only to a verified admin. [SyncThumbnails](../thumbnails/README.md) is a retained standalone mockup absent from the published allowlist. TikTok Pilot is retained hidden source in [the TikTok fragment](../src/index/300-tiktok-upload.js.part).

## Tables and views

Verified 2026-10-29 against main 45c88a8 and the live catalog (read-only).

The live catalog has **225 application and platform relations** outside system catalogs: 167 in public, four in private application schemas, and 54 owned by Supabase or extensions. Every row below is a catalog observation. Source links identify readers, writers or SQL owners; their presence does not prove that every historical routine is invoked today.

Direct browser access below means table SELECT grants (has_table_privilege), schema USAGE and the RLS read policies for anon and authenticated, measured 2026-10-29. A granted view can expose its projection even when its base tables deny SELECT. RLS without a matching read policy permits no rows. Scoped Edge readers are separate. This pass did not test every REST route or inspect private data rows.


| Public relation | What it holds | Reader and writer code owners | Direct browser access |
| --- | --- | --- | --- |
| `ai_client_onboarding` | Table. AI funnel onboarding submissions. | [ai-onboarding-list](../supabase/functions/ai-onboarding-list/index.ts) / [onboarding-full](../supabase/functions/onboarding-full/index.ts) | No direct browser SELECT grant. |
| `analytics_content_summaries` | Table. Copied client content summaries. | [Scoped reader](../supabase/functions/analytics-read/index.ts); [mirror writer](../supabase/functions/analytics-write/index.ts) uses the shared dataset mapping. | No direct browser SELECT grant. |
| `analytics_ingest_receipts` | Table. Receipts proving which analytics copy is complete. | [analytics-read](../supabase/functions/analytics-read/index.ts) / [analytics-write](../supabase/functions/analytics-write/index.ts) | No direct browser SELECT grant. |
| `analytics_market_research_briefs` | Table. Copied market research briefs. | [Scoped reader](../supabase/functions/analytics-read/index.ts); [mirror writer](../supabase/functions/analytics-write/index.ts) uses the shared dataset mapping. | No direct browser SELECT grant. |
| `analytics_metrics` | Table. Daily social account metrics copied from Sheets. | [Scoped reader](../supabase/functions/analytics-read/index.ts); [mirror writer](../supabase/functions/analytics-write/index.ts) uses the shared dataset mapping. | No direct browser SELECT grant. |
| `analytics_metrics_collect_queue` | Table. Work queue for the in-house Metrics collector (cron `analytics-metrics-collect-tick`). | [analytics-metrics-collect](../supabase/functions/analytics-metrics-collect/index.ts); [SQL definition](../migrations/2026-10-01-analytics-metrics-collect-shadow.sql) | No direct browser SELECT grant; service role only. |
| `analytics_metrics_dedupe_log` | Table. Removed duplicate Metrics rows and repair reasons, retained for rollback. | [Owner-approved SQL repair and rollback reader](../migrations/2026-10-01-analytics-metrics-dedupe-quoted-empty.sql); no browser or ordinary app writer. | No direct browser SELECT grant; RLS is enabled. |
| `analytics_metrics_shadow` | Table. Metrics rows the in-house collector writes beside the n8n copy for comparison. | [analytics-metrics-collect](../supabase/functions/analytics-metrics-collect/index.ts); [SQL definition](../migrations/2026-10-01-analytics-metrics-collect-shadow.sql) | No direct browser SELECT grant; service role only. |
| `analytics_post_tracking` | Table. Per-post tracking state for the in-house Metrics collector. | [analytics-metrics-collect](../supabase/functions/analytics-metrics-collect/index.ts); [SQL definition](../migrations/2026-10-01-analytics-metrics-collect-shadow.sql) | No direct browser SELECT grant; service role only. |
| `analytics_top_videos` | Table. Top video history copied from Sheets. | [Scoped reader](../supabase/functions/analytics-read/index.ts); [mirror writer](../supabase/functions/analytics-write/index.ts) uses the shared dataset mapping. | No direct browser SELECT grant. |
| `analytics_top_videos_collect_queue` | Table. Work queue for the in-house Top videos collector (cron `analytics-top-videos-collect-tick`). | [analytics-top-videos-collect](../supabase/functions/analytics-top-videos-collect/index.ts); [SQL definition](../migrations/2026-10-02-analytics-top-videos-collect-shadow.sql) | No direct browser SELECT grant; service role only. |
| `analytics_top_videos_shadow` | Table. Top video rows the in-house collector writes beside the n8n copy. | [analytics-top-videos-collect](../supabase/functions/analytics-top-videos-collect/index.ts); [SQL definition](../migrations/2026-10-02-analytics-top-videos-collect-shadow.sql) | No direct browser SELECT grant; service role only. |
| `batches` | Table. Production batches and parent cards. | [Browser references](../src/index/067-workload-board-source.js.part); [batch-write](../supabase/functions/batch-write/index.ts) / [brain](../supabase/functions/brain/index.ts) / [production-write](../supabase/functions/production-write/index.ts); [SQL readers and writers](../supabase/migrations/20260913183021_provider_issue_observation_recovery_preparation.sql) | No direct browser SELECT grant; a leftover anon read policy grants nothing without it. |
| `batches_parent_claim_backup_20260824` | Table. Retained parent claim repair backup. | [Catalog context](truth/SUPABASE.md) | No direct browser SELECT grant. |
| `calendar_auto_posted_moves` | Table. The auto-posted job's record of every Calendar card it moved. | [calendar-auto-posted](../supabase/functions/calendar-auto-posted/index.ts) (cron `calendar-auto-posted-tick`); [SQL definition](../migrations/2026-10-10-calendar-auto-posted.sql) | No direct browser SELECT grant; service role only. |
| `calendar_feedback_materializations` | Table. Recoverable Calendar feedback copied into native comments. | [SQL readers and writers](../migrations/2026-09-05-calendar-feedback-recovery.sql) | No direct browser SELECT grant. |
| `calendar_post_events` | Table. Calendar save history. | [Browser references](../src/index/186-archived-restore.js.part); [calendar-reorder](../supabase/functions/calendar-reorder/index.ts) / [calendar-upsert](../supabase/functions/calendar-upsert/index.ts); [SQL readers and writers](../migrations/2026-09-18-native-calendar-status-bridge.sql) | SELECT to anon, authenticated with RLS: true. |
| `calendar_posts` | Table. Calendar cards, components, approvals and comments. | [Browser references](../src/index/097-today.js.part); [calendar-reorder](../supabase/functions/calendar-reorder/index.ts) / [calendar-upsert](../supabase/functions/calendar-upsert/index.ts) / [production-write](../supabase/functions/production-write/index.ts) and other callers; [SQL readers and writers](../migrations/live-schema-baseline-2026-07-03.sql) | SELECT granted to anon and authenticated; the RLS read policy (true) names anon only, so authenticated reads no rows. |
| `caption_cta_options` | Table. A client's call to action choices for captions. | [caption-generate](../supabase/functions/caption-generate/index.ts); [SQL definition](../migrations/2026-10-14-caption-cta-and-title-ideas.sql) | No direct browser SELECT grant; service role only. |
| `caption_jobs` | Table. Caption progress, result, error and cancellation state. | [caption-jobs](../supabase/functions/caption-jobs/index.ts) | No direct browser SELECT grant. |
| `caption_prompts` | Table. Saved caption instructions per client. | [Browser references](../src/index/180-calendar-native-post-media.js.part); [caption-prompts-save](../supabase/functions/caption-prompts-save/index.ts) | SELECT to anon, authenticated with RLS: true. |
| `caption_versions` | Table. Every version of a Calendar card's caption, append-only, written by a trigger on `calendar_posts`. | [caption-generate](../supabase/functions/caption-generate/index.ts); [Browser references](../src/index/180-calendar-native-post-media.js.part); [SQL definition](../migrations/2026-10-23-caption-versions.sql) | No direct browser SELECT grant; service role only. |
| `card_change_journal` | Table. Before and after images for native card changes. | [SQL readers and writers](../migrations/2026-09-26-card-journal-slim.sql) | No direct browser SELECT grant. |
| `card_write_admission_v1` | Table. Admission receipts for atomic card writes. | [SQL readers and writers](../supabase/migrations/20260913183021_provider_issue_observation_recovery_preparation.sql) | No direct browser SELECT grant. |
| `card_write_followups_v1` | Table. Follow-up work owed after a card write. | [SQL readers and writers](../supabase/migrations/20260913062149_retirement_switch_preparation.sql) | No direct browser SELECT grant. |
| `card_write_operations_v1` | Table. Idempotent card operation records. | [SQL readers and writers](../supabase/migrations/20260912174907_card_atomic_admission_preparation.sql) | No direct browser SELECT grant. |
| `card_write_transaction_context_v1` | Table. Transaction context binding card writes and follow-ups. | [SQL readers and writers](../supabase/migrations/20260913183021_provider_issue_observation_recovery_preparation.sql) | No direct browser SELECT grant. |
| `client_access` | Table. Private client review tokens and their active scope. | [analytics-read](../supabase/functions/analytics-read/index.ts) / [client-review-link](../supabase/functions/client-review-link/index.ts) / [client-token-verify](../supabase/functions/client-token-verify/index.ts) and other callers; [SQL readers and writers](../migrations/2026-09-09-native-client-provisioning.sql) | No direct browser SELECT grant. |
| `client_access_events` | Table. Client token access audit. | [client-token-verify](../supabase/functions/client-token-verify/index.ts) | No direct browser SELECT grant. |
| `client_backfill_proposals` | Table. Proposed onboarding backfill rows awaiting review. | [SQL definition](../migrations/2026-10-03-onboarding-checklist-tables.sql) | No direct browser SELECT grant; service role only. |
| `client_credential_events` | Table. Credential change and reveal audit. | [client-credentials](../supabase/functions/client-credentials/index.ts) | No direct browser SELECT grant. |
| `client_credentials` | Table. Private client platform credentials. | [client-credentials](../supabase/functions/client-credentials/index.ts) | No direct browser SELECT grant. |
| `client_credentials_rev` | Table. Credential revision history. | [Browser references](../src/index/321-kasper-dashboard-replies.js.part); [client-credentials](../supabase/functions/client-credentials/index.ts) | SELECT to anon, authenticated with RLS: true. |
| `client_onboarding` | Table. Standard onboarding submissions. | [onboarding-full](../supabase/functions/onboarding-full/index.ts) / [onboarding-list](../supabase/functions/onboarding-list/index.ts) | No direct browser SELECT grant. |
| `client_onboarding_events` | Table. Onboarding checklist history per client. | [client-onboarding](../supabase/functions/client-onboarding/index.ts) / [client-hubspot-sync](../supabase/functions/client-hubspot-sync/index.ts); [SQL definition](../migrations/2026-10-03-onboarding-checklist-tables.sql) | No direct browser SELECT grant; service role only. |
| `client_onboarding_progress` | Table. Onboarding checklist step state per client. | [client-onboarding](../supabase/functions/client-onboarding/index.ts); [SQL definition](../migrations/2026-10-03-onboarding-checklist-tables.sql) | No direct browser SELECT grant; service role only. |
| `client_onboarding_summary_v1` | View. Onboarding checklist summary per client. | [client-onboarding](../supabase/functions/client-onboarding/index.ts); [SQL definition](../migrations/2026-10-03-onboarding-checklist-tables.sql) | No direct browser SELECT grant; service role only. |
| `client_profile_edits` | Table. Audit of client profile edits. | [SQL readers and writers](../migrations/2026-09-25-client-profile-edits.sql) | No direct browser SELECT grant. |
| `client_profiles` | Table. Client info authority since 2026-10-02 (`client_profiles_authority` = syncview); the Clients Info Sheet is only a copy sent through `roster_sheet_outbox`. `extra.postforme_instagram_account_id` holds the Instagram Post For Me id. | Writers: [roster-write](../supabase/functions/roster-write/index.ts) / [client-profile-write](../supabase/functions/client-profile-write/index.ts) / [client-onboarding](../supabase/functions/client-onboarding/index.ts); readers [analytics-read](../supabase/functions/analytics-read/index.ts) / [instagram-upload](../supabase/functions/instagram-upload/index.ts) / [tiktok-upload](../supabase/functions/tiktok-upload/index.ts) and other callers; [SQL readers and writers](../migrations/2026-10-02-roster-native.sql) | No direct browser SELECT grant. |
| `client_resource_status_v1` | View. Client resource readiness projection. | [client-onboarding](../supabase/functions/client-onboarding/index.ts); [SQL definition](../migrations/2026-10-03-onboarding-checklist-tables.sql) | No direct browser SELECT grant; service role only. |
| `client_resources` | Table. Per-client onboarding resources and links. | [client-onboarding](../supabase/functions/client-onboarding/index.ts); [Browser references](../src/index/324-client-onboarding-panel.js.part); [SQL definition](../migrations/2026-10-03-onboarding-checklist-tables.sql) | No direct browser SELECT grant; service role only. |
| `client_review_alerts` | Table. Staff-only log of "Notify client" alerts and owner previews. | [client-review-alert](../supabase/functions/client-review-alert/index.ts); [SQL definition](../supabase/migrations/20261014120000_client_review_alerts.sql) | No direct browser SELECT grant; service role only. |
| `client_sales_state` | Table. Per-client sales (CRM) state used by onboarding. | [client-hubspot-sync](../supabase/functions/client-hubspot-sync/index.ts); [SQL definition](../migrations/2026-10-03-onboarding-checklist-tables.sql) | No direct browser SELECT grant; service role only. |
| `clients` | Table. Canonical client registry and native project mappings. | [Browser references](../src/index/040-shared-briefs.js.part); [analytics-read](../supabase/functions/analytics-read/index.ts) / [brain](../supabase/functions/brain/index.ts) / [client-review-link](../supabase/functions/client-review-link/index.ts) and other callers; [SQL readers and writers](../supabase/migrations/20260912200637_thumbnail_parser_contract_alignment.sql) | SELECT to anon, authenticated with RLS: true. |
| `clients_roster_sync_log` | Table. Roster sync receipts and changes. | [SQL readers and writers](../migrations/2026-09-28-clients-roster-sync.sql) | No direct browser SELECT grant. |
| `content_samples` | Table. Retained legacy Samples records. | [SQL readers and writers](../migrations/samples-supabase-migration.sql) | No direct browser SELECT grant. |
| `crm_enrolments` | Table. Lead enrolments in follow-up sequences. | [crm-leads](../supabase/functions/crm-leads/index.ts); [SQL definition](../supabase/migrations/20261026120000_crm_leads.sql) | No direct browser SELECT grant; service role only. |
| `crm_events` | Table. Lead history. | [crm-leads](../supabase/functions/crm-leads/index.ts); [SQL definition](../supabase/migrations/20261026120000_crm_leads.sql) | No direct browser SELECT grant; service role only. |
| `crm_n8n_sequences` | Table. n8n follow-up sequences shown in the CRM. | [crm-leads](../supabase/functions/crm-leads/index.ts); [Browser references](../src/index/328-crm-leads.js.part); [SQL definition](../supabase/migrations/20261027210000_crm_n8n_sequences.sql) | No direct browser SELECT grant; service role only. |
| `crm_people` | Table. Sales leads and their stage. | [crm-leads](../supabase/functions/crm-leads/index.ts); [SQL definition](../supabase/migrations/20261026120000_crm_leads.sql) | No direct browser SELECT grant; service role only. |
| `crm_sequence_steps` | Table. Versioned steps of each follow-up sequence (drafts until approved). | [crm-leads](../supabase/functions/crm-leads/index.ts); [SQL definition](../supabase/migrations/20261026120000_crm_leads.sql) | No direct browser SELECT grant; service role only. |
| `crm_sequences` | Table. Follow-up sequence definitions. | [crm-leads](../supabase/functions/crm-leads/index.ts); [SQL definition](../supabase/migrations/20261026120000_crm_leads.sql) | No direct browser SELECT grant; service role only. |
| `crm_sources` | Table. Lead sources. | [crm-leads](../supabase/functions/crm-leads/index.ts); [SQL definition](../supabase/migrations/20261026120000_crm_leads.sql) | No direct browser SELECT grant; service role only. |
| `deliverable_events` | Table. Native work item changes and monitor heartbeats. | [Browser references](../src/index/186-archived-restore.js.part); [production-write](../supabase/functions/production-write/index.ts); [SQL readers and writers](../supabase/migrations/20260913055621_provider_recorded_create_linkage_recovery_preparation.sql) | SELECT to anon, authenticated with RLS: true; (action IS DISTINCT FROM 'attachment_change'::text); ((event_key IS NULL) OR (action <> ALL (ARRAY['comment_add'::text, 'comment_edit'::text, 'comment_delete'::text, 'comment_resolve'::text, 'comment_unresolve'::text, 'comment_link_linear'::text, 'comment_link_native'::text]))); (action IS DISTINCT FROM 'description_change'::text). |
| `deliverables` | Table. Native production work items, statuses, owners and dates. | [Browser references](../src/index/067-workload-board-source.js.part); [deliverable-write](../supabase/functions/deliverable-write/index.ts) / [notify](../supabase/functions/notify/index.ts) / [production-comments](../supabase/functions/production-comments/index.ts) and other callers; [SQL readers and writers](../supabase/migrations/20260913183021_provider_issue_observation_recovery_preparation.sql) | No direct browser SELECT grant; a leftover anon read policy grants nothing without it. |
| `description_images` | Table. Images attached to native briefs. | [description-image-upload](../supabase/functions/description-image-upload/index.ts) | No direct browser SELECT grant. |
| `filming_plan_tabs_cache` | Table. Cached Google Doc tab summaries. | [filming-plan-tabs](../supabase/functions/filming-plan-tabs/index.ts) | No direct browser SELECT grant. |
| `filming_plans` | Table. Filming plan Doc references. | [filming-plans](../supabase/functions/filming-plans/index.ts) / [production-write](../supabase/functions/production-write/index.ts); [SQL readers and writers](../migrations/2026-07-09-filming-plans-source.sql) | No direct browser SELECT grant; a leftover anon read policy grants nothing without it. |
| `flag_flips` | Table. Runtime switch history. | [SQL readers and writers](../migrations/2026-07-05-b0-linear-auth-scaffold.sql) | SELECT to anon, authenticated with RLS: true. |
| `fp_batch_counter` | Table. Next filming idea batch number per client. | [higgsfield-mcp](../supabase/functions/higgsfield-mcp/index.ts); [SQL definition](../supabase/migrations/20261016230000_filming_pipeline_passes.sql) | No direct browser SELECT grant; service role only. |
| `fp_feedback_notes` | Table. Filming pipeline feedback notes from a chat or the ideas Sheet. | [higgsfield-mcp](../supabase/functions/higgsfield-mcp/index.ts) / [pipeline-google](../supabase/functions/pipeline-google/index.ts); [SQL definition](../supabase/migrations/20261016230000_filming_pipeline_passes.sql) | No direct browser SELECT grant; service role only. |
| `fp_file_history` | Table. Every saved version of every filming pipeline file. | [SQL definition](../supabase/migrations/20261016230000_filming_pipeline_passes.sql) | No direct browser SELECT grant; service role only. |
| `fp_files` | Table. Filming pipeline per-client files, current version. | [higgsfield-mcp](../supabase/functions/higgsfield-mcp/index.ts) / [pipeline-google](../supabase/functions/pipeline-google/index.ts); [SQL definition](../supabase/migrations/20261016230000_filming_pipeline_passes.sql) | No direct browser SELECT grant; service role only. |
| `fp_pass_tabs` | Table. Doc and Sheet tabs created through a pipeline pass. | [pipeline-google](../supabase/functions/pipeline-google/index.ts); [SQL definition](../supabase/migrations/20261016230000_filming_pipeline_passes.sql) | No direct browser SELECT grant; service role only. |
| `fp_passes` | Table. Filming pipeline passes (token hashes only). | [higgsfield-mcp](../supabase/functions/higgsfield-mcp/index.ts) / [pipeline-google](../supabase/functions/pipeline-google/index.ts); [SQL definition](../supabase/migrations/20261016230000_filming_pipeline_passes.sql) | No direct browser SELECT grant; service role only. |
| `fp_publishers` | Table. Connector members allowed to make a pass for real client files. | [higgsfield-mcp](../supabase/functions/higgsfield-mcp/index.ts) / [pipeline-google](../supabase/functions/pipeline-google/index.ts); [SQL definition](../supabase/migrations/20261016230000_filming_pipeline_passes.sql) | No direct browser SELECT grant; service role only. |
| `fp_settings` | Table. Filming pipeline settings. | [higgsfield-mcp](../supabase/functions/higgsfield-mcp/index.ts) / [pipeline-google](../supabase/functions/pipeline-google/index.ts) / [pipeline-social](../supabase/functions/pipeline-social/index.ts); [SQL definition](../supabase/migrations/20261016230000_filming_pipeline_passes.sql) | No direct browser SELECT grant; service role only. |
| `frameio_token_keeper` | Table. Frame.io refresh token keeper. | [frameio-token](../supabase/functions/frameio-token/index.ts); [SQL definition](../migrations/2026-10-13-frameio-token-keeper.sql) | No direct browser SELECT grant; service role only. |
| `hf_activity` | Table. Synchro connector activity log, one row per tool call. | [higgsfield-mcp](../supabase/functions/higgsfield-mcp/index.ts) / [pipeline-social](../supabase/functions/pipeline-social/index.ts); [SQL definition](../supabase/migrations/20261015180000_hf_activity.sql) | No direct browser SELECT grant; service role only. |
| `hf_generations` | Table. Team media generation jobs and charges. | [higgsfield-mcp](../supabase/functions/higgsfield-mcp/index.ts); [SQL readers and writers](../migrations/2026-09-28-higgsfield-team-connector.sql) | No direct browser SELECT grant. |
| `hf_guides` | Table. Synchro connector team playbooks (newest row per topic is live). | [higgsfield-mcp](../supabase/functions/higgsfield-mcp/index.ts); [SQL definition](../supabase/migrations/20261015200000_hf_guides.sql) | No direct browser SELECT grant; service role only. |
| `hf_studio_downloads` | Table. Video studio download log. | [higgsfield-mcp](../supabase/functions/higgsfield-mcp/index.ts); [SQL definition](../supabase/migrations/20261016180000_hf_studio_downloads.sql) | No direct browser SELECT grant; service role only. |
| `hf_team_members` | Table. Team connector identities and personal access tokens. | [higgsfield-mcp](../supabase/functions/higgsfield-mcp/index.ts) | No direct browser SELECT grant. |
| `hf_tools` | Table. Shared team tools and client kits. | [higgsfield-mcp](../supabase/functions/higgsfield-mcp/index.ts); [SQL definition](../supabase/migrations/20261021180000_hf_tools.sql) | No direct browser SELECT grant; service role only. |
| `hiring_application_events` | Table. Application review and delivery history. | [SQL readers and writers](../migrations/2026-09-15-hiring-video-editor-role.sql) | No direct browser SELECT grant. |
| `hiring_applications` | Table. Private job applications and review state. | [hiring-applications](../supabase/functions/hiring-applications/index.ts); [SQL readers and writers](../migrations/2026-09-15-hiring-video-editor-role.sql) | No direct browser SELECT grant. |
| `hiring_invite_jobs` | Table. Durable interview invitation queue. | [SQL readers and writers](../migrations/2026-09-15-hiring-video-editor-role.sql) | No direct browser SELECT grant. |
| `hiring_practical_test_jobs` | Table. Durable practical test email queue. | [SQL readers and writers](../migrations/2026-09-15-hiring-video-editor-role.sql) | No direct browser SELECT grant. |
| `instagram_uploads` | Table. Instagram Reel queue, provider IDs and results. | [instagram-upload](../supabase/functions/instagram-upload/index.ts) | No direct browser SELECT grant. |
| `intake_raw_submissions` | Table. Raw copy of every intake upload, stored first. | [production-write](../supabase/functions/production-write/index.ts); [SQL definition](../migrations/2026-10-18-intake-raw-submissions.sql) | No direct browser SELECT grant; service role only. |
| `kasper_ad_campaign_daily` | Table. Campaign totals by day. | [kasper-ad-performance-read](../supabase/functions/kasper-ad-performance-read/index.ts); [SQL readers and writers](../migrations/2026-08-27-kasper-ad-performance-multi-campaign.sql) | No direct browser SELECT grant. |
| `kasper_ad_leads` | Table. Booked acquisition lead and CRM status. | [kasper-ad-performance-read](../supabase/functions/kasper-ad-performance-read/index.ts); [SQL readers and writers](../migrations/2026-08-27-kasper-ad-performance-multi-campaign.sql) | No direct browser SELECT grant. |
| `kasper_ad_performance_by_ad_daily` | Table. Daily ad breakdown. | [kasper-ad-performance-read](../supabase/functions/kasper-ad-performance-read/index.ts); [SQL readers and writers](../migrations/2026-08-27-kasper-ad-performance-multi-campaign.sql) | No direct browser SELECT grant. |
| `kasper_ad_performance_daily` | Table. Daily acquisition funnel totals. | [kasper-ad-performance-read](../supabase/functions/kasper-ad-performance-read/index.ts); [SQL readers and writers](../migrations/2026-08-27-kasper-ad-performance-multi-campaign.sql) | No direct browser SELECT grant. |
| `kasper_ad_unfinished_leads` | Table. Unfinished bookings and follow-up status. | [kasper-ad-performance-read](../supabase/functions/kasper-ad-performance-read/index.ts); [SQL readers and writers](../migrations/2026-08-27-kasper-ad-performance-multi-campaign.sql) | No direct browser SELECT grant. |
| `legacy_intake_native_triage` | Table. Legacy captured intake awaiting native classification. | [production-write](../supabase/functions/production-write/index.ts); [SQL readers and writers](../migrations/2026-09-07-legacy-intake-native-triage.sql) | No direct browser SELECT grant. |
| `legacy_onboarding` | Table. Imported old onboarding forms. | [legacy-onboarding-list](../supabase/functions/legacy-onboarding-list/index.ts) / [onboarding-full](../supabase/functions/onboarding-full/index.ts); [SQL readers and writers](../migrations/legacy-onboarding-migration.sql) | No direct browser SELECT grant. |
| `linear_archive` | Table. Retained raw Linear export. | [production-archive](../supabase/functions/production-archive/index.ts); [SQL readers and writers](../migrations/2026-07-23-f34-f53-production-attachments.sql) | No direct browser SELECT grant. |
| `linear_archive_asset_refs` | Table. Historical attachment references. | [production-archive](../supabase/functions/production-archive/index.ts); [SQL readers and writers](../migrations/2026-07-23-f34-f53-production-attachments.sql) | No direct browser SELECT grant. |
| `linear_archive_asset_rescue_config` | Table. Retained attachment rescue configuration. | [SQL readers and writers](../migrations/2026-07-23-f34-f53-production-attachments.sql) | No direct browser SELECT grant. |
| `linear_deliverable_comment_ids_v1` | View. Compatibility comment identifier projection. | [SQL view](../migrations/2026-08-03-linear-reconciler-bounded-inputs.sql) | No direct browser SELECT grant. |
| `linear_deliverables_reconcile_input_v1` | View. Retained comparison input view. | [SQL readers and writers](../migrations/2026-08-03-linear-reconciler-bounded-inputs.sql) | No direct browser SELECT grant. |
| `linear_intake_receipts` | Table. Legacy intake capture and creation receipts. | [SQL readers and writers](../migrations/2026-09-07-legacy-intake-native-triage.sql) | No direct browser SELECT grant. |
| `linear_outbound_cutoff_control` | Table. Controls sealing the retired outbound lane. | [SQL readers and writers](../migrations/2026-09-06-linear-outbound-cutoff.sql) | No direct browser SELECT grant. |
| `linear_project_ids_shape_migration_20260728` | Table. Project ID migration backup. | [SQL readers and writers](../migrations/2026-07-28-linear-project-ids-team-shape.sql) | No direct browser SELECT grant. |
| `linear_reconcile_projection_status_v1` | View. Retained projection health view. | [SQL view](../migrations/2026-08-03-linear-reconciler-bounded-inputs.sql) | No direct browser SELECT grant. |
| `message_reads` | Table. When each staff member last read each post's Messages conversation. | [production-comments](../supabase/functions/production-comments/index.ts); [SQL definition](../supabase/migrations/20261014090000_message_reads.sql) | No direct browser SELECT grant; service role only. |
| `mirror_outbox` | Table. Historical mirror delivery intents and receipts. | [production-write](../supabase/functions/production-write/index.ts); [SQL readers and writers](../supabase/migrations/20260913183021_provider_issue_observation_recovery_preparation.sql) | No direct browser SELECT grant. |
| `native_brief_media_occurrences` | Table. Preserved brief media and verification receipts. | [SQL definition](../migrations/2026-09-07-native-brief-media.sql) | No direct browser SELECT grant. |
| `onboarding_fallback` | Table. Backup onboarding drafts, submissions and dead letters. | [onboarding-capture](../supabase/functions/onboarding-capture/index.ts) | No direct browser SELECT grant. |
| `onboarding_steps` | Table. Onboarding checklist step catalog. | [client-onboarding](../supabase/functions/client-onboarding/index.ts); [SQL definition](../migrations/2026-10-03-onboarding-checklist-tables.sql) | No direct browser SELECT grant; service role only. |
| `production_asset_access_checks` | Table. Recorded checks of archived media access. | [production-write](../supabase/functions/production-write/index.ts) | No direct browser SELECT grant. |
| `production_card_materialization_ingress` | Table. Durable requests to build native cards. | [SQL readers and writers](../migrations/2026-09-06-native-card-materialization-boundary.sql) | No direct browser SELECT grant. |
| `production_card_materialization_receipts` | Table. Native card creation outcomes. | [SQL readers and writers](../migrations/2026-09-06-native-card-materialization-boundary.sql) | No direct browser SELECT grant. |
| `production_card_provenance` | Table. Card origin and source binding. | [SQL readers and writers](../migrations/2026-09-06-native-card-materialization-boundary.sql) | No direct browser SELECT grant. |
| `production_comment_card_links` | Table. Canonical comment to Calendar or Sample bindings. | [SQL readers and writers](../migrations/2026-09-12-native-ordinary-envelope-repair.sql) | No direct browser SELECT grant. |
| `production_comment_import_conflicts` | Table. Comment import conflicts requiring classification. | [SQL definition](../migrations/2026-07-23-production-comment-thread-lifecycle.sql) | No direct browser SELECT grant. |
| `production_comment_mutation_receipts` | Table. Idempotent comment change receipts. | [production-write](../supabase/functions/production-write/index.ts); [SQL readers and writers](../migrations/2026-09-12-native-ordinary-envelope-repair.sql) | No direct browser SELECT grant. |
| `production_comment_read_audit` | Table. Canonical thread read audit. | [production-comments](../supabase/functions/production-comments/index.ts); [SQL readers and writers](../migrations/2026-07-23-production-comment-thread-lifecycle.sql) | No direct browser SELECT grant. |
| `production_comment_read_budget` | Table. Limits and usage for canonical thread reads. | [SQL readers and writers](../migrations/2026-07-23-production-comment-thread-lifecycle.sql) | No direct browser SELECT grant. |
| `production_comments` | Table. Canonical production comments and lifecycle state. | [notify](../supabase/functions/notify/index.ts) / [production-archive](../supabase/functions/production-archive/index.ts) / [production-comments](../supabase/functions/production-comments/index.ts) and other callers; [SQL readers and writers](../supabase/migrations/20260913181213_provider_comment_observation_recovery_preparation.sql) | No direct browser SELECT grant. |
| `production_deliverables_browser_v1` | View. Browser projection of native work items. | [Browser references](../src/index/067-workload-board-source.js.part); [production-write](../supabase/functions/production-write/index.ts); [SQL readers and writers](../migrations/2026-09-19-native-intake-open-load.sql) | SELECT to anon, authenticated; view projection governs rows. |
| `production_intake_manifests` | Table. Validated intake roots and component topology. | [production-write](../supabase/functions/production-write/index.ts); [SQL readers and writers](../migrations/2026-09-07-legacy-intake-native-triage.sql) | No direct browser SELECT grant. |
| `production_label_catalog_versions` | Table. Native label catalog snapshots. | [SQL readers and writers](../migrations/2026-09-18-native-label-retired-state.sql) | No direct browser SELECT grant. |
| `production_native_client_provisions` | Table. Native onboarding provisioning receipts. | [SQL readers and writers](../migrations/2026-09-09-native-client-provisioning.sql) | No direct browser SELECT grant. |
| `production_native_client_test_provisions` | Table. Test-client provisioning receipts. | [SQL definition](../migrations/2026-10-03-native-client-test-provision.sql) | No direct browser SELECT grant; service role only. |
| `production_native_identifier_grants` | Table. Authority to mint native identifiers. | [SQL readers and writers](../migrations/2026-09-07-native-identifier-mint.sql) | No direct browser SELECT grant. |
| `production_native_identifier_mint` | Table. Native identifier counters and assignments. | [SQL readers and writers](../migrations/2026-09-07-native-identifier-mint.sql) | No direct browser SELECT grant. |
| `production_native_ordinary_receipt_admissions` | Table. Ordinary native completion admission receipts. | [SQL readers and writers](../migrations/2026-09-18-native-test-client-parity.sql) | No direct browser SELECT grant. |
| `production_notification_config` | Table. Per-client notification destinations. | [SQL readers and writers](../migrations/2026-09-18-notification-creative-channel.sql) | No direct browser SELECT grant. |
| `production_notification_delivery_receipts` | Table. Provider outcomes for notifications. | [SQL readers and writers](../migrations/2026-09-18-notification-creative-channel.sql) | No direct browser SELECT grant. |
| `production_notification_intents` | Table. Durable native notification queue. | [notify](../supabase/functions/notify/index.ts); [SQL readers and writers](../migrations/2026-09-18-notification-creative-channel.sql) | No direct browser SELECT grant. |
| `production_notification_monitor_v1` | View. Notification debt and health projection. | [SQL view](../migrations/2026-09-09-native-notification-outbox.sql) | No direct browser SELECT grant. |
| `production_notification_reconciliations` | Table. Reconciliation of uncertain notification sends. | [SQL readers and writers](../migrations/2026-09-18-notification-creative-channel.sql) | No direct browser SELECT grant. |
| `pto_adjustments` | Table. Time off balance adjustments. | [pto](../supabase/functions/pto/index.ts); [SQL readers and writers](../migrations/2026-07-15-pto-tracker.sql) | No direct browser SELECT grant. |
| `pto_member_events` | Table. Append-only record of PTO member setup changes. | [SQL definition](../migrations/2026-10-10-pto-member-setup-audit.sql) | No direct browser SELECT grant; service role only. |
| `pto_members` | Table. Private staff time off profiles. | [pto](../supabase/functions/pto/index.ts); [SQL readers and writers](../migrations/2026-07-15-pto-tracker.sql) | No direct browser SELECT grant. |
| `pto_requests` | Table. Time off requests and decisions. | [pto](../supabase/functions/pto/index.ts); [SQL readers and writers](../migrations/2026-07-15-pto-tracker.sql) | No direct browser SELECT grant. |
| `public_intake_log` | Table. Public production submission audit. | [production-write](../supabase/functions/production-write/index.ts) | No direct browser SELECT grant. |
| `quiz_intake_log` | Table. Quiz capture audit. | [quiz-capture](../supabase/functions/quiz-capture/index.ts) | No direct browser SELECT grant. |
| `quiz_responses` | Table. Marketing quiz responses. | [quiz-capture](../supabase/functions/quiz-capture/index.ts) / [quiz-leads-list](../supabase/functions/quiz-leads-list/index.ts) | No direct browser SELECT grant. |
| `rename_propagation_outbox` | Table. Names waiting to propagate between cards and work items. | [SQL readers and writers](../migrations/2026-09-23-rename-propagation.sql) | No direct browser SELECT grant. |
| `rename_propagation_status_v1` | View. Name propagation debt view. | [Browser references](../src/index/125-title-name-rule.js.part) | SELECT to anon, authenticated; view projection governs rows. |
| `roster_cleanup_log` | Table. Rollback data from the stale roster cleanup. | [SQL definition](../migrations/2026-10-02-roster-stale-cleanup.sql) | No direct browser SELECT grant; service role only. |
| `roster_sheet_outbox` | Table. Clients Info and Social Media Managers Sheet copy still owed; drained only by a roster-write, client-profile-write or client-onboarding request (no timer). | [roster-write](../supabase/functions/roster-write/index.ts) (shared roster handlers); [SQL definition](../migrations/2026-10-02-roster-native.sql) | No direct browser SELECT grant; service role only. |
| `sales_intakes` | Table. Sales intake and agreement requests. | [SQL definition](../migrations/sales-intake-migration.sql) | No direct browser SELECT grant. |
| `sample_review_events` | Table. Sample review save history. | [Browser references](../src/index/186-archived-restore.js.part); [sample-review-reorder](../supabase/functions/sample-review-reorder/index.ts) / [sample-review-upsert](../supabase/functions/sample-review-upsert/index.ts); [SQL readers and writers](../migrations/2026-09-10-kasper-urgent-ping-ledger.sql) | SELECT granted to anon and authenticated; the RLS read policy (true) names anon only, so authenticated reads no rows. |
| `sample_reviews` | Table. Sample cards, review state and comments. | [Browser references](../src/index/186-archived-restore.js.part); [production-write](../supabase/functions/production-write/index.ts) / [sample-review-reorder](../supabase/functions/sample-review-reorder/index.ts) / [sample-review-upsert](../supabase/functions/sample-review-upsert/index.ts) and other callers; [SQL readers and writers](../migrations/sample-reviews-migration.sql) | SELECT granted to anon and authenticated; the RLS read policy (true) names anon only, so authenticated reads no rows. |
| `settings_events` | Table. Template and caption instruction change history. | [caption-prompts-save](../supabase/functions/caption-prompts-save/index.ts) / [templates-save](../supabase/functions/templates-save/index.ts) | No direct browser SELECT grant. |
| `smm_also_sees` | Table. Staff-only "also sees" grants for Today and My clients (by roster manager or one client); never changes the roster. | [smm-weekly-reports](../supabase/functions/smm-weekly-reports/index.ts) | No direct browser SELECT grant; service role SELECT only. |
| `smm_assignment_edits` | Table. Who moved which client to which manager. | [client-profile-write](../supabase/functions/client-profile-write/index.ts) / [roster-write](../supabase/functions/roster-write/index.ts); [SQL definition](../migrations/2026-10-02-roster-native.sql) | No direct browser SELECT grant; service role only. |
| `smm_weekly_reports` | Table. Private weekly manager reports. | [smm-weekly-reports](../supabase/functions/smm-weekly-reports/index.ts) | No direct browser SELECT grant; a leftover anon read policy grants nothing without it. |
| `social_media_managers` | Table. Manager directory and each manager's client list; the Social Media Managers Sheet tab is now a copy. | [smm-weekly-reports](../supabase/functions/smm-weekly-reports/index.ts) / [client-profile-write](../supabase/functions/client-profile-write/index.ts) / [roster-write](../supabase/functions/roster-write/index.ts) (shared roster handlers); [SQL readers and writers](../migrations/2026-10-02-roster-native.sql) | No direct browser SELECT grant; a leftover anon read policy grants nothing without it. |
| `studio_trial_versions` | Table. Trial reels log, one row per version. | [higgsfield-mcp](../supabase/functions/higgsfield-mcp/index.ts) / [trial-reels](../supabase/functions/trial-reels/index.ts); [SQL definition](../supabase/migrations/20261026200000_studio_trial_versions.sql) | No direct browser SELECT grant; service role only. |
| `syncview_auth_events` | Table. Staff authentication audit. | [client-review-link](../supabase/functions/client-review-link/index.ts) / [key-verify](../supabase/functions/key-verify/index.ts) | No direct browser SELECT grant. |
| `syncview_retirement_admission` | Table. Recorded retirement boundary admissions. | [SQL readers and writers](../supabase/migrations/20260913062149_retirement_switch_preparation.sql) | No direct browser SELECT grant. |
| `syncview_runtime_flags` | Table. Runtime switches and routing rosters. | [Browser references](../src/index/040-shared-briefs.js.part); [analytics-read](../supabase/functions/analytics-read/index.ts) / [analytics-write](../supabase/functions/analytics-write/index.ts) / [client-profile-write](../supabase/functions/client-profile-write/index.ts) and other callers; [SQL readers and writers](../supabase/migrations/20260913183021_provider_issue_observation_recovery_preparation.sql) | SELECT to anon, authenticated with RLS: true. |
| `team_members` | Table. Canonical staff roster, roles and provider mappings. | [Browser references](../src/index/097-today.js.part); [client-profile-write](../supabase/functions/client-profile-write/index.ts) / [description-image-upload](../supabase/functions/description-image-upload/index.ts) / [key-verify](../supabase/functions/key-verify/index.ts) and other callers; [SQL readers and writers](../migrations/2026-09-24-workload-native-snapshot-board-builder.VERIFY.sql) | No direct browser SELECT grant; a leftover anon read policy grants nothing without it. |
| `templates` | Table. Client creative template settings. | [Browser references](../src/index/040-shared-briefs.js.part); [templates-save](../supabase/functions/templates-save/index.ts) | SELECT to anon, authenticated with RLS: true. |
| `thumbnail_media_revisions` | Table. Private thumbnail revision metadata. | [thumbnail-revision-read](../supabase/functions/thumbnail-revision-read/index.ts); [SQL readers and writers](../supabase/migrations/20260912184931_card_followup_outcome_proof.sql) | No direct browser SELECT grant; a leftover anon read policy grants nothing without it. |
| `thumbnail_title_prompts` | Table. Saved thumbnail title instructions per client. | [thumbnail-title-prompts](../supabase/functions/thumbnail-title-prompts/index.ts) / [thumbnail-titles](../supabase/functions/thumbnail-titles/index.ts); [SQL definition](../migrations/2026-10-09-thumbnail-titles.sql) | No direct browser SELECT grant; service role only. |
| `thumbnail_title_queue` | Table. Thumbnail title work queue (cron `thumbnail-titles-tick`). | [thumbnail-titles](../supabase/functions/thumbnail-titles/index.ts); [SQL definition](../migrations/2026-10-09-thumbnail-titles.sql) | No direct browser SELECT grant; service role only. |
| `thumbnail_title_run_items` | Table. Items of a manual thumbnail title run. | [thumbnail-titles](../supabase/functions/thumbnail-titles/index.ts); [SQL definition](../migrations/2026-10-23-thumbnail-title-buttons.sql) | No direct browser SELECT grant; service role only. |
| `thumbnail_title_runs` | Table. Manual thumbnail title runs from the Production buttons. | [thumbnail-titles](../supabase/functions/thumbnail-titles/index.ts); [SQL definition](../migrations/2026-10-23-thumbnail-title-buttons.sql) | No direct browser SELECT grant; service role only. |
| `tiktok_accounts` | Table. Retained TikTok Pilot account connections. | [SQL definition](../migrations/ttpilot-schema-migration.sql) | No direct browser SELECT grant. |
| `tiktok_oauth_state` | Table. Retained TikTok Pilot OAuth handshake state. | [SQL definition](../migrations/ttpilot-schema-migration.sql) | No direct browser SELECT grant. |
| `tiktok_pilot_posts` | Table. Retained TikTok Pilot upload queue. | [SQL definition](../migrations/ttpilot-schema-migration.sql) | No direct browser SELECT grant. |
| `tiktok_uploads` | Table. TikTok upload queue and results. | [tiktok-upload](../supabase/functions/tiktok-upload/index.ts) / [tiktok-upload-cancel](../supabase/functions/tiktok-upload-cancel/index.ts); [Browser references](../src/index/300-tiktok-upload.js.part); [SQL definition](../migrations/2026-10-07-tiktok-uploads.sql) | No direct browser SELECT grant; service role only. |
| `track_b_f27_team_fences` | Table. Team write fences for guarded recovery. | [SQL readers and writers](../supabase/migrations/20260912193957_provider_closed_snapshot_preparation.sql) | No direct browser SELECT grant. |
| `track_b_team_rollback_intents` | Table. Captured intents awaiting classified rollback. | [SQL readers and writers](../supabase/migrations/20260913183021_provider_issue_observation_recovery_preparation.sql) | No direct browser SELECT grant. |
| `track_b_team_rollbacks` | Table. Team rollback sessions and proof state. | [SQL readers and writers](../supabase/migrations/20260913183021_provider_issue_observation_recovery_preparation.sql) | No direct browser SELECT grant. |
| `trial_reel_cards` | Table. Trial reels: the switch of one Calendar card and its winner. | [trial-reels](../supabase/functions/trial-reels/index.ts); [SQL definition](../supabase/migrations/20261027090000_trial_reels.sql) | No direct browser SELECT grant; service role only. |
| `workload_issues` | Table. Frozen legacy Linear issue snapshot. | [Browser references](../src/index/067-workload-board-source.js.part); [workload-plan](../supabase/functions/workload-plan/index.ts); [SQL readers and writers](../migrations/2026-09-24-workload-native-snapshot-board-builder.VERIFY.sql) | SELECT granted to anon and authenticated; the RLS read policy (true) names anon only, so authenticated reads no rows. |
| `workload_issues_native_v1` | View. Native Workload issue projection. | [Browser references](../src/index/067-workload-board-source.js.part); [SQL readers and writers](../migrations/2026-09-24-workload-native-snapshot-board-builder.VERIFY.sql) | SELECT to anon, authenticated; view projection governs rows. |
| `workload_plan` | Table. Staff internal work day pins. | [workload-plan](../supabase/functions/workload-plan/index.ts); [SQL readers and writers](../migrations/2026-09-24-workload-native-snapshot-board-builder.VERIFY.sql) | No direct browser SELECT grant. |
| `workload_snapshot_cache` | Table. Prebuilt native Workload snapshots. | [SQL readers and writers](../migrations/2026-09-24-workload-native-snapshot-board-builder.sql) | No direct browser SELECT grant. |
| `workload_snapshot_invalidation` | Table. Marks native Workload snapshots dirty. | [SQL readers and writers](../migrations/2026-09-24-workload-native-snapshot-board-builder.sql) | No direct browser SELECT grant. |


### Private application schemas


| Relation | Purpose and owner | Direct browser access |
| --- | --- | --- |
| `linear_exit_install.journal_v1` | Installation transaction journal. [SQL definition](../supabase/migrations/20260912203454_installation_transaction_journal_preparation.sql) | No direct browser SELECT grant. |
| `linear_exit_maintenance.gate_v1` | Maintenance admission gate. [SQL definition](../supabase/migrations/20260913035202_installation_maintenance_gate_preparation.sql) | No direct browser SELECT grant. |
| `linear_exit_provider.send_attempts_v1` | Retained provider send attempt receipts. [SQL definition](../supabase/migrations/20260913034324_provider_send_admission_preparation.sql) | No direct browser SELECT grant. |
| `write_refusal_diagnostics.receipts_v1` | Private save refusal receipts read by Save problems. [SQL definition](../supabase/migrations/20260913044451_write_refusal_diagnostics_preparation.sql) | No direct browser SELECT grant. |


### Supabase and extension owned relations

These are backend platform stores. Service access depends on platform roles; browsers normally use the service API. No auth, Storage object or decrypted Vault value was read; the 2026-10-29 pass read only the catalog.


| Relation | Platform owner and data | Direct browser access |
| --- | --- | --- |
| `auth.audit_log_entries` | Auth account, session or sign-in state; Auth service owns it. [Catalog context](truth/SUPABASE.md) | No direct browser SELECT grant. |
| `auth.custom_oauth_providers` | Auth account, session or sign-in state; Auth service owns it. [Catalog context](truth/SUPABASE.md) | No direct browser SELECT grant. |
| `auth.flow_state` | Auth account, session or sign-in state; Auth service owns it. [Catalog context](truth/SUPABASE.md) | No direct browser SELECT grant. |
| `auth.identities` | Auth account, session or sign-in state; Auth service owns it. [Catalog context](truth/SUPABASE.md) | No direct browser SELECT grant. |
| `auth.instances` | Auth account, session or sign-in state; Auth service owns it. [Catalog context](truth/SUPABASE.md) | No direct browser SELECT grant. |
| `auth.mfa_amr_claims` | Auth account, session or sign-in state; Auth service owns it. [Catalog context](truth/SUPABASE.md) | No direct browser SELECT grant. |
| `auth.mfa_challenges` | Auth account, session or sign-in state; Auth service owns it. [Catalog context](truth/SUPABASE.md) | No direct browser SELECT grant. |
| `auth.mfa_factors` | Auth account, session or sign-in state; Auth service owns it. [Catalog context](truth/SUPABASE.md) | No direct browser SELECT grant. |
| `auth.mfa_recovery_code_sets` | Auth account, session or sign-in state; Auth service owns it. [Catalog context](truth/SUPABASE.md) | No direct browser SELECT grant. |
| `auth.mfa_recovery_codes` | Auth account, session or sign-in state; Auth service owns it. [Catalog context](truth/SUPABASE.md) | No direct browser SELECT grant. |
| `auth.oauth_authorizations` | Auth account, session or sign-in state; Auth service owns it. [Catalog context](truth/SUPABASE.md) | No direct browser SELECT grant. |
| `auth.oauth_client_states` | Auth account, session or sign-in state; Auth service owns it. [Catalog context](truth/SUPABASE.md) | No direct browser SELECT grant. |
| `auth.oauth_clients` | Auth account, session or sign-in state; Auth service owns it. [Catalog context](truth/SUPABASE.md) | No direct browser SELECT grant. |
| `auth.oauth_consents` | Auth account, session or sign-in state; Auth service owns it. [Catalog context](truth/SUPABASE.md) | No direct browser SELECT grant. |
| `auth.one_time_tokens` | Auth account, session or sign-in state; Auth service owns it. [Catalog context](truth/SUPABASE.md) | No direct browser SELECT grant. |
| `auth.refresh_tokens` | Auth account, session or sign-in state; Auth service owns it. [Catalog context](truth/SUPABASE.md) | No direct browser SELECT grant. |
| `auth.saml_providers` | Auth account, session or sign-in state; Auth service owns it. [Catalog context](truth/SUPABASE.md) | No direct browser SELECT grant. |
| `auth.saml_relay_states` | Auth account, session or sign-in state; Auth service owns it. [Catalog context](truth/SUPABASE.md) | No direct browser SELECT grant. |
| `auth.schema_migrations` | Auth account, session or sign-in state; Auth service owns it. [Catalog context](truth/SUPABASE.md) | No direct browser SELECT grant. |
| `auth.scim_tokens` | Auth account, session or sign-in state; Auth service owns it. [Catalog context](truth/SUPABASE.md) | No direct browser SELECT grant. |
| `auth.scim_users` | Auth account, session or sign-in state; Auth service owns it. [Catalog context](truth/SUPABASE.md) | No direct browser SELECT grant. |
| `auth.sessions` | Auth account, session or sign-in state; Auth service owns it. [Catalog context](truth/SUPABASE.md) | No direct browser SELECT grant. |
| `auth.sso_domains` | Auth account, session or sign-in state; Auth service owns it. [Catalog context](truth/SUPABASE.md) | No direct browser SELECT grant. |
| `auth.sso_providers` | Auth account, session or sign-in state; Auth service owns it. [Catalog context](truth/SUPABASE.md) | No direct browser SELECT grant. |
| `auth.users` | Auth account, session or sign-in state; Auth service owns it. [Catalog context](truth/SUPABASE.md) | No direct browser SELECT grant. |
| `auth.webauthn_challenges` | Auth account, session or sign-in state; Auth service owns it. [Catalog context](truth/SUPABASE.md) | No direct browser SELECT grant. |
| `auth.webauthn_credentials` | Auth account, session or sign-in state; Auth service owns it. [Catalog context](truth/SUPABASE.md) | No direct browser SELECT grant. |
| `cron.job` | Scheduler definitions or execution history; pg_cron owns it. [Catalog context](truth/SUPABASE.md) | Table SELECT granted, but anon and authenticated hold no USAGE on schema cron, so no browser access. |
| `cron.job_run_details` | Scheduler definitions or execution history; pg_cron owns it. [Catalog context](truth/SUPABASE.md) | Table SELECT granted, but anon and authenticated hold no USAGE on schema cron, so no browser access. |
| `extensions.pg_stat_statements` | Extension statistics or statement information; installed extension owns it. [Catalog context](truth/SUPABASE.md) | SELECT to anon, authenticated; view projection governs rows. |
| `extensions.pg_stat_statements_info` | Extension statistics or statement information; installed extension owns it. [Catalog context](truth/SUPABASE.md) | SELECT to anon, authenticated; view projection governs rows. |
| `realtime.messages` | Routing or subscription state; Realtime service owns it. [Catalog context](truth/SUPABASE.md) | SELECT granted to anon, authenticated; RLS has no browser read policy. |
| `realtime.messages_2026_10_26` | Routing or subscription state; Realtime service owns it (daily partition; the set rolls forward). [Catalog context](truth/SUPABASE.md) | No direct browser SELECT grant. |
| `realtime.messages_2026_10_27` | Routing or subscription state; Realtime service owns it (daily partition; the set rolls forward). [Catalog context](truth/SUPABASE.md) | No direct browser SELECT grant. |
| `realtime.messages_2026_10_28` | Routing or subscription state; Realtime service owns it (daily partition; the set rolls forward). [Catalog context](truth/SUPABASE.md) | No direct browser SELECT grant. |
| `realtime.messages_2026_10_29` | Routing or subscription state; Realtime service owns it (daily partition; the set rolls forward). [Catalog context](truth/SUPABASE.md) | No direct browser SELECT grant. |
| `realtime.messages_2026_10_30` | Routing or subscription state; Realtime service owns it (daily partition; the set rolls forward). [Catalog context](truth/SUPABASE.md) | No direct browser SELECT grant. |
| `realtime.messages_2026_10_31` | Routing or subscription state; Realtime service owns it (daily partition; the set rolls forward). [Catalog context](truth/SUPABASE.md) | No direct browser SELECT grant. |
| `realtime.messages_2026_11_01` | Routing or subscription state; Realtime service owns it (daily partition; the set rolls forward). [Catalog context](truth/SUPABASE.md) | No direct browser SELECT grant. |
| `net._http_response` | Outbound HTTP responses kept by pg_net (used by the cron dispatch jobs); extension owns it. [Catalog context](truth/SUPABASE.md) | SELECT granted to anon, authenticated with schema USAGE; RLS is off. Not reachable from a browser: the Data API exposes only `public` and `graphql_public` (a publishable-key read with schema net returned PGRST106 on 2026-10-29). |
| `net.http_request_queue` | Outbound HTTP request queue for pg_net; extension owns it. [Catalog context](truth/SUPABASE.md) | SELECT granted to anon, authenticated with schema USAGE; RLS is off. Not reachable from a browser (schema net is not exposed by the Data API; checked 2026-10-29). |
| `realtime.schema_migrations` | Routing or subscription state; Realtime service owns it. [Catalog context](truth/SUPABASE.md) | No direct browser SELECT grant. |
| `realtime.subscription` | Routing or subscription state; Realtime service owns it. [Catalog context](truth/SUPABASE.md) | SELECT to anon, authenticated; RLS is off. |
| `storage.buckets` | Object or bucket metadata; Storage service owns it. [Catalog context](truth/SUPABASE.md) | SELECT granted to anon, authenticated; RLS has no browser read policy. |
| `storage.buckets_analytics` | Object or bucket metadata; Storage service owns it. [Catalog context](truth/SUPABASE.md) | SELECT granted to anon, authenticated; RLS has no browser read policy. |
| `storage.buckets_vectors` | Object or bucket metadata; Storage service owns it. [Catalog context](truth/SUPABASE.md) | SELECT granted to anon, authenticated; RLS has no browser read policy. |
| `storage.migrations` | Object or bucket metadata; Storage service owns it. [Catalog context](truth/SUPABASE.md) | No direct browser SELECT grant. |
| `storage.objects` | Object or bucket metadata; Storage service owns it. [Catalog context](truth/SUPABASE.md) | SELECT granted to anon, authenticated; RLS has no browser read policy. |
| `storage.s3_multipart_uploads` | Object or bucket metadata; Storage service owns it. [Catalog context](truth/SUPABASE.md) | SELECT granted to anon, authenticated; RLS has no browser read policy. |
| `storage.s3_multipart_uploads_parts` | Object or bucket metadata; Storage service owns it. [Catalog context](truth/SUPABASE.md) | SELECT granted to anon, authenticated; RLS has no browser read policy. |
| `storage.vector_indexes` | Object or bucket metadata; Storage service owns it. [Catalog context](truth/SUPABASE.md) | SELECT granted to anon, authenticated; RLS has no browser read policy. |
| `supabase_migrations.schema_migrations` | Applied migration history; migration tooling owns it. [Catalog context](truth/SUPABASE.md) | No direct browser SELECT grant. |
| `vault.decrypted_secrets` | Encrypted secret store or decrypted view; privileged Vault callers own it. [Catalog context](truth/SUPABASE.md) | No direct browser SELECT grant. |
| `vault.secrets` | Encrypted secret store or decrypted view; privileged Vault callers own it. [Catalog context](truth/SUPABASE.md) | No direct browser SELECT grant. |

## Edge functions

Verified 2026-10-29 against main 45c88a8 and the live catalog (read-only).

There are 69 entrypoint folders and one shared helper folder here. The live project has **68 functions** (read 2026-10-29), all ACTIVE and all with platform JWT verification false; that setting does not remove function authentication, every function checks its own key or token. 66 of the 68 have source here; the other two, `doctors-partial-capture` and `fp-tab-test`, are listed under live functions owned outside this repo. Three repo folders are not live: `analytics-market-research-collect` (never deployed) and the retired `linear-inbound` and `linear-outbound`. Presence and version below are read live; live byte equality to this checkout was not attested here (the merge lane attests each function it deploys).

**Release path.** Since 2026-10-16 every function goes live by itself when a change to it merges to `main`, through [on merge](../.github/workflows/deploy-edge-functions-on-merge.yml) (runbook: [EF_AUTO_DEPLOY](ops/EF_AUTO_DEPLOY.md)). That lane holds a function whose merge adds a migration (until Lighthouse applies it and runs the lane by hand with `migrations_applied`), runs the old manual lanes' safeguards, and deploys in order (`notify`, then `production-write`, then `production-comments` and `production-archive`). The Section 4 three are released by that lane dispatching [deploy-f27-section4-closures.yml](../.github/workflows/deploy-f27-section4-closures.yml) with `capture`. Never automatic: `calendar-upsert` and `sample-review-upsert` (frozen), `client-token-verify` (deliberate manual), `linear-inbound` and `linear-outbound` (retired). The older per-function lanes named below are manual fallbacks only (dispatch, no push trigger). [The deploy manifest](ops/EF_DEPLOY_MANIFEST.md) owns source closures.


| Function | Purpose and caller | Live presence and release lane |
| --- | --- | --- |
| <!-- atlas:edge _shared -->[`_shared`](../supabase/functions/_shared/) | Shared auth, write, media, policy and Sheet-copy helpers; not an endpoint. | Bundled with its caller; a change to it redeploys every function that imports it. |
| <!-- atlas:edge ai-onboarding-list -->[`ai-onboarding-list`](../supabase/functions/ai-onboarding-list/index.ts) | Staff reads AI onboarding submissions. | Live v87. [On merge](../.github/workflows/deploy-edge-functions-on-merge.yml); fallback [deploy-onboarding-edge-functions.yml](../.github/workflows/deploy-onboarding-edge-functions.yml) |
| <!-- atlas:edge analytics-market-research-collect -->[`analytics-market-research-collect`](../supabase/functions/analytics-market-research-collect/index.ts) | Our own run of the Market Research brief job (n8n MARKET RESEARCH, generate-market-brief), shadow only; request-driven through a queue table, timer-ticked, key-protected (`ANALYTICS_COLLECT_KEY`). | Not live (2026-10-29): not deployed, its queue table and switch row do not exist (OPEN_REPAIRS 335). Analytics jobs paused by owner decision 2026-10-06. Fallback [deploy-single-function.yml](../.github/workflows/deploy-single-function.yml) |
| <!-- atlas:edge analytics-metrics-collect -->[`analytics-metrics-collect`](../supabase/functions/analytics-metrics-collect/index.ts) | Our own run of the daily metrics job (n8n CLIENTS METRICS): shadow or live mode; pg_cron tick every minute 04:00 to 08:59 UTC; key-protected. | Live v23. Switch `analytics_metrics_collect` is `off` (owner pause 2026-10-06); timer active. [On merge](../.github/workflows/deploy-edge-functions-on-merge.yml); fallback [deploy-single-function.yml](../.github/workflows/deploy-single-function.yml) |
| <!-- atlas:edge analytics-top-videos-collect -->[`analytics-top-videos-collect`](../supabase/functions/analytics-top-videos-collect/index.ts) | Our own run of the daily Top Videos job (n8n TOP VIDEOS): shadow or live mode; pg_cron tick every minute 08:00 to 12:59 UTC plus a daily prune; key-protected. | Live v20. Switch `analytics_top_videos_collect` is `off` (owner pause 2026-10-06); timers active. [On merge](../.github/workflows/deploy-edge-functions-on-merge.yml); fallback [deploy-single-function.yml](../.github/workflows/deploy-single-function.yml) |
| <!-- atlas:edge analytics-read -->[`analytics-read`](../supabase/functions/analytics-read/index.ts) | Staff or verified client links read one client's analytics and profile rows; the page's client list since `analytics_mirror_read_enabled` gained `"roster": "database"`. | Live v40. [On merge](../.github/workflows/deploy-edge-functions-on-merge.yml); fallback [deploy-single-function.yml](../.github/workflows/deploy-single-function.yml) |
| <!-- atlas:edge analytics-write -->[`analytics-write`](../supabase/functions/analytics-write/index.ts) | The daily Sheets copy and the n8n mirror key write analytics rows with receipts (`ANALYTICS_MIRROR_WRITE_KEY`). | Live v35. [On merge](../.github/workflows/deploy-edge-functions-on-merge.yml); fallback [deploy-single-function.yml](../.github/workflows/deploy-single-function.yml) |
| <!-- atlas:edge batch-write -->[`batch-write`](../supabase/functions/batch-write/index.ts) | Service callers write native batch fields. | Live v84. Section 4: on merge dispatches [deploy-f27-section4-closures.yml](../.github/workflows/deploy-f27-section4-closures.yml) with `capture`; fingerprint re-pinned in the same PR. |
| <!-- atlas:edge brain -->[`brain`](../supabase/functions/brain/index.ts) | Staff reads one client's brief and facts from the private Brain and submits changes to its input folder. | Live v42. [On merge](../.github/workflows/deploy-edge-functions-on-merge.yml); fallback [deploy-single-function.yml](../.github/workflows/deploy-single-function.yml) |
| <!-- atlas:edge calendar-auto-posted -->[`calendar-auto-posted`](../supabase/functions/calendar-auto-posted/index.ts) | Background step (pg_cron `calendar-auto-posted-tick` only, every 15 minutes): turns a Calendar post from Scheduled to Posted once its scheduled day has ended in US Eastern time, through production-write and calendar-upsert, the same calls a click makes. OPEN_REPAIRS 402. | Live v13. Switch `calendar_auto_posted` on for every client (`*`) since 2026-10-27. [On merge](../.github/workflows/deploy-edge-functions-on-merge.yml); fallback [deploy-single-function.yml](../.github/workflows/deploy-single-function.yml) |
| <!-- atlas:edge calendar-card-write -->[`calendar-card-write`](../supabase/functions/calendar-card-write/index.ts) | Native writer for a Calendar card's own fields, replacing calendar-upsert (retirement plan step 1): same request and answers, guards ported in `logic.mjs`, staff key required, client link tokens refused, its own switch `calendar_card_write_clients` checked in code. | Live v10. `calendar_card_write_clients` covers every client's staff saves (`all: true`) since 2026-10-21; rollback list is the test client plus two others. Client review links still save through calendar-upsert. [On merge](../.github/workflows/deploy-edge-functions-on-merge.yml); fallback [deploy-single-function.yml](../.github/workflows/deploy-single-function.yml) |
| <!-- atlas:edge calendar-reorder -->[`calendar-reorder`](../supabase/functions/calendar-reorder/index.ts) | Calendar staff calls reorder existing cards. | Live v83. [On merge](../.github/workflows/deploy-edge-functions-on-merge.yml); no manual lane (fallback: run the merge lane by hand with `functions`). |
| <!-- atlas:edge calendar-upsert -->[`calendar-upsert`](../supabase/functions/calendar-upsert/index.ts) | Client review links (and the fallback for staff) save Calendar cards. Frozen live writer; staff saves moved to calendar-card-write. | Live v96. Frozen by [owner rule](../AGENTS.md): never auto-deployed; changed only through [calendar-upsert-live-delta.yml](../.github/workflows/calendar-upsert-live-delta.yml) with the owner. |
| <!-- atlas:edge caption-generate -->[`caption-generate`](../supabase/functions/caption-generate/index.ts) | Generate caption off n8n: Frame.io file, Whisper (Replicate), Claude with the client prompt, Brain voice and fixed writing rules, or a pasted transcript; progress in caption-jobs. | Live v23. `caption_generate_ef_clients` covers every client (`all: true`) since 2026-10-09 (OPEN_REPAIRS 388). [On merge](../.github/workflows/deploy-edge-functions-on-merge.yml); fallback [deploy-single-function.yml](../.github/workflows/deploy-single-function.yml) |
| <!-- atlas:edge caption-jobs -->[`caption-jobs`](../supabase/functions/caption-jobs/index.ts) | Calendar and Generate Caption read progress and request cancellation or updates. | Live v31. [On merge](../.github/workflows/deploy-edge-functions-on-merge.yml); fallback [deploy-single-function.yml](../.github/workflows/deploy-single-function.yml) |
| <!-- atlas:edge caption-prompts-save -->[`caption-prompts-save`](../supabase/functions/caption-prompts-save/index.ts) | Staff saves per-client caption instructions. | Live v81. [On merge](../.github/workflows/deploy-edge-functions-on-merge.yml); no manual lane. |
| <!-- atlas:edge client-credentials -->[`client-credentials`](../supabase/functions/client-credentials/index.ts) | Admin and SMM manage protected platform credentials. | Live v95. [On merge](../.github/workflows/deploy-edge-functions-on-merge.yml); fallback [deploy-onboarding-edge-functions.yml](../.github/workflows/deploy-onboarding-edge-functions.yml) |
| <!-- atlas:edge client-onboarding -->[`client-onboarding`](../supabase/functions/client-onboarding/index.ts) | Admin reads and changes one client's onboarding checklist and resources (presence and ids only, never tokens or credentials), and Create client; a create then sends the same best-effort Sheet copy as client-profile-write. One of the three writers of `client_profiles`. | Live v24; Create client live since 2026-10-08 (OPEN_REPAIRS 372). [On merge](../.github/workflows/deploy-edge-functions-on-merge.yml) with the onboarding schema readback; fallback [deploy-single-function.yml](../.github/workflows/deploy-single-function.yml) |
| <!-- atlas:edge client-profile-write -->[`client-profile-write`](../supabase/functions/client-profile-write/index.ts) | Admin edits one client's profile from Kasper > Clients: writes `client_profiles` with history (`client_profile_admin_edit`, version checked), moves a client's manager (`smm_assign_client`), then queues and sends the Clients Info / Social Media Managers Sheet copy (`roster_sheet_outbox`). The Sheet is a copy; the database is the main copy (`client_profiles_authority` = syncview since 2026-10-02). | Live v35. [On merge](../.github/workflows/deploy-edge-functions-on-merge.yml); fallback [deploy-single-function.yml](../.github/workflows/deploy-single-function.yml) |
| <!-- atlas:edge client-review-alert -->[`client-review-alert`](../supabase/functions/client-review-alert/index.ts) | Admins and SMMs send one general "ready for your review" Slack alert to a client's private channel (Notify client button); the owner can preview it in their own DM first. | Live v11. [On merge](../.github/workflows/deploy-edge-functions-on-merge.yml); fallback [deploy-single-function.yml](../.github/workflows/deploy-single-function.yml). See [NOTIFY_CLIENT.md](ops/NOTIFY_CLIENT.md). |
| <!-- atlas:edge client-review-link -->[`client-review-link`](../supabase/functions/client-review-link/index.ts) | Admin and SMM issue a scoped client review link. | Live v54. [On merge](../.github/workflows/deploy-edge-functions-on-merge.yml); fallback [deploy-client-review-link.yml](../.github/workflows/deploy-client-review-link.yml) |
| <!-- atlas:edge client-token-verify -->[`client-token-verify`](../supabase/functions/client-token-verify/index.ts) | Client entry verifies its current review token in strict mode. | Live v79. Deliberate manual: the merge lane never deploys it; reviewed operator release, read back before its browser caller is served. |
| <!-- atlas:edge deliverable-write -->[`deliverable-write`](../supabase/functions/deliverable-write/index.ts) | Service callers write native work item fields. | Live v84. Section 4: on merge dispatches [deploy-f27-section4-closures.yml](../.github/workflows/deploy-f27-section4-closures.yml) with `capture`. |
| <!-- atlas:edge description-image-upload -->[`description-image-upload`](../supabase/functions/description-image-upload/index.ts) | Staff uploads brief images into private Storage. | Live v50. [On merge](../.github/workflows/deploy-edge-functions-on-merge.yml); fallback [deploy-description-image-upload.yml](../.github/workflows/deploy-description-image-upload.yml) |
| <!-- atlas:edge filming-plan-tabs -->[`filming-plan-tabs`](../supabase/functions/filming-plan-tabs/index.ts) | Staff reads and caches Google Doc tab lists for Kasper > Filming (replaced the n8n webhook). | Live v29. [On merge](../.github/workflows/deploy-edge-functions-on-merge.yml); fallback [deploy-single-function.yml](../.github/workflows/deploy-single-function.yml) |
| <!-- atlas:edge frameio-token -->[`frameio-token`](../supabase/functions/frameio-token/index.ts) | Frame.io key keeper: a server caller with the broker key gets a fresh Adobe access token; the rotating refresh token is saved in `frameio_token_keeper` on every refresh and never leaves the server. One-time browser login at `/login`. | Live v8. [On merge](../.github/workflows/deploy-edge-functions-on-merge.yml) with the keeper-table readback; fallback [deploy-single-function.yml](../.github/workflows/deploy-single-function.yml) |
| <!-- atlas:edge frameio-view -->[`frameio-view`](../supabase/functions/frameio-view/index.ts) | Watch here: a staff key and a card's Frame.io link get a fresh playable video address and the video's comments from Frame.io's V4 API, through the `frameio-token` key keeper. A client review token plus a card id gets the playable address only, for a card of that same client while `frame_viewer_clients` allows it. Read only, stores nothing. | Live v10. `frame_viewer_clients` on for every client (`all: true`) since 2026-10-16. [On merge](../.github/workflows/deploy-edge-functions-on-merge.yml); fallback [deploy-single-function.yml](../.github/workflows/deploy-single-function.yml) |
| <!-- atlas:edge trial-reels -->[`trial-reels`](../supabase/functions/trial-reels/index.ts) | Trial reels, the SyncView half (plan: `docs/features/TRIAL_REELS_PLAN.md`, #2352): a card's Trial reels switch, each version's Frame.io link, each reviewer's answer per version, the 24 h trial and the SMM's winner pick, in `studio_trial_versions` and `trial_reel_cards`. Staff key for everything; a client review link for read and answer only. Never writes the card's status or its one link. | Live v12; its tables exist. Page switch `trial_reels_pages` lists the test client only. [On merge](../.github/workflows/deploy-edge-functions-on-merge.yml); no manual lane. |
| <!-- atlas:edge filming-plans -->[`filming-plans`](../supabase/functions/filming-plans/index.ts) | Staff reads and updates filming plan Doc references. | Live v82. [On merge](../.github/workflows/deploy-edge-functions-on-merge.yml); fallback [deploy-onboarding-edge-functions.yml](../.github/workflows/deploy-onboarding-edge-functions.yml) |
| <!-- atlas:edge crm-gmail -->[`crm-gmail`](../supabase/functions/crm-gmail/index.ts) | Leads CRM Gmail reader: who one company mailbox has emailed (headers only, `gmail.metadata`, read only, server key only; `docs/features/CRM_LEADS.md`). | Live v3. Needs a Workspace admin's domain-wide delegation approval before it can read (whether granted: unverified 2026-10-29). [On merge](../.github/workflows/deploy-edge-functions-on-merge.yml); no manual lane. |
| <!-- atlas:edge crm-leads -->[`crm-leads`](../supabase/functions/crm-leads/index.ts) | The Leads CRM page (`/leads`): list, read, update and note people in the pipeline, sequences and steps; staff key with Leads access, step approval admin only (`docs/features/CRM_LEADS.md`). Only reader of the `crm_*` tables. | Live v10; its tables exist. [On merge](../.github/workflows/deploy-edge-functions-on-merge.yml); no manual lane. |
| <!-- atlas:edge higgsfield-mcp -->[`higgsfield-mcp`](../supabase/functions/higgsfield-mcp/index.ts) | The SyncMate connector: team chat apps generate images and video through personal connector identities, read client brains and filming plans; editors' studios also clean voices (Auphonic) and transcribe takes (ElevenLabs, `studio_transcribe`) through it. | Live v92. [On merge](../.github/workflows/deploy-edge-functions-on-merge.yml); fallback [deploy-single-function.yml](../.github/workflows/deploy-single-function.yml). Read `docs/ops/HIGGSFIELD_CONNECTOR_LESSONS.md` first. |
| <!-- atlas:edge hiring-applications -->[`hiring-applications`](../supabase/functions/hiring-applications/index.ts) | Admin reviews job applications and queues candidate mail. | Live v52. [On merge](../.github/workflows/deploy-edge-functions-on-merge.yml) with the hiring source checks; fallback [deploy-hiring-applications.yml](../.github/workflows/deploy-hiring-applications.yml) |
| <!-- atlas:edge hiring-automation -->[`hiring-automation`](../supabase/functions/hiring-automation/index.ts) | n8n captures hiring events and claims or receipts candidate sends. | Live v50. [On merge](../.github/workflows/deploy-edge-functions-on-merge.yml) with the hiring contract test; fallback [deploy-hiring-automation.yml](../.github/workflows/deploy-hiring-automation.yml) |
| <!-- atlas:edge instagram-upload -->[`instagram-upload`](../supabase/functions/instagram-upload/index.ts) | Staff submits, lists, schedules, cancels and checks Instagram Reels, carousels (2 to 10 items) and manual trial reels through Post For Me; queue in `instagram_uploads`. The account id comes from `client_profiles.extra.postforme_instagram_account_id`; real clients only on the `INSTAGRAM_UPLOAD_ALLOWED_CLIENTS` allow-list. | Live v32. [On merge](../.github/workflows/deploy-edge-functions-on-merge.yml); fallback [deploy-single-function.yml](../.github/workflows/deploy-single-function.yml) |
| <!-- atlas:edge tiktok-upload -->[`tiktok-upload`](../supabase/functions/tiktok-upload/index.ts) | Staff mints the Post For Me upload URL, creates, lists, checks and retries TikTok posts; the queue is `tiktok_uploads` (OPEN_REPAIRS 362). Replaced the n8n TikTok webhooks (`tiktok_upload_source` = supabase since 2026-10-07). Admin-only one-time copy of the TikTokUpload Sheet tab. Receives Post For Me's result webhook (`?pfm_webhook=1`, its own secret, no staff key) and asks about every overdue open row (OPEN_REPAIRS 370). | Live v19. [On merge](../.github/workflows/deploy-edge-functions-on-merge.yml); fallback [deploy-single-function.yml](../.github/workflows/deploy-single-function.yml) |
| <!-- atlas:edge tiktok-upload-cancel -->[`tiktok-upload-cancel`](../supabase/functions/tiktok-upload-cancel/index.ts) | Staff cancels a scheduled TikTok upload: deletes the post in Post For Me, proves it is gone, then marks the queue row cancelled (the `tiktok_uploads` table first, the TikTokUpload Sheet tab only for a row the table does not have). | Live v19. [On merge](../.github/workflows/deploy-edge-functions-on-merge.yml); fallback [deploy-single-function.yml](../.github/workflows/deploy-single-function.yml) |
| <!-- atlas:edge thumbnail-titles -->[`thumbnail-titles`](../supabase/functions/thumbnail-titles/index.ts) | Background step (pg_cron `thumbnail-titles-tick` only, every minute): writes a short AI title from the filming plan into each new empty thumbnail work item made from the Submit tab or a Calendar post, or a "Needs info" line; never over text a person wrote. | Live v31. Switch `thumbnail_titles` on for every client (`*`) since 2026-10-09. [On merge](../.github/workflows/deploy-edge-functions-on-merge.yml); fallback [deploy-single-function.yml](../.github/workflows/deploy-single-function.yml) |
| <!-- atlas:edge thumbnail-title-prompts -->[`thumbnail-title-prompts`](../supabase/functions/thumbnail-title-prompts/index.ts) | Staff read and save a client's thumbnail title prompt from the Calendar "..." menu (the twin of caption-prompts-save). | Live v28. [On merge](../.github/workflows/deploy-edge-functions-on-merge.yml); fallback [deploy-single-function.yml](../.github/workflows/deploy-single-function.yml) |
| <!-- atlas:edge kasper-ad-performance-read -->[`kasper-ad-performance-read`](../supabase/functions/kasper-ad-performance-read/index.ts) | Admin reads acquisition metrics and private lead status. | Live v54. [On merge](../.github/workflows/deploy-edge-functions-on-merge.yml); no manual lane. |
| <!-- atlas:edge key-verify -->[`key-verify`](../supabase/functions/key-verify/index.ts) | Staff entry verifies a roster identity and role key. | Live v87. [On merge](../.github/workflows/deploy-edge-functions-on-merge.yml); fallback [deploy-onboarding-edge-functions.yml](../.github/workflows/deploy-onboarding-edge-functions.yml) |
| <!-- atlas:edge legacy-onboarding-list -->[`legacy-onboarding-list`](../supabase/functions/legacy-onboarding-list/index.ts) | Staff reads imported old onboarding forms. | Live v87. [On merge](../.github/workflows/deploy-edge-functions-on-merge.yml); fallback [deploy-onboarding-edge-functions.yml](../.github/workflows/deploy-onboarding-edge-functions.yml) |
| <!-- atlas:edge linear-inbound -->[`linear-inbound`](../supabase/functions/linear-inbound/index.ts) | Retired provider webhook source retained for contract tests (Linear sync deleted 2026-09-24). | Absent from live list. No deploy path; the merge lane marks it manual. Never restore as ordinary maintenance. |
| <!-- atlas:edge linear-outbound -->[`linear-outbound`](../supabase/functions/linear-outbound/index.ts) | Retired provider delivery source retained for contract tests (Linear sync deleted 2026-09-24). | Absent from live list. No deploy path; the merge lane marks it manual. Never restore as ordinary maintenance. |
| <!-- atlas:edge monitoring-watchdog-tick -->[`monitoring-watchdog-tick`](../supabase/functions/monitoring-watchdog-tick/index.ts) | The monitoring dead-man's switch on Supabase's own timer: every 15 minutes (pg_cron) it runs the same heartbeat check as `scripts/monitoring-watchdog.js --check` and pages the owner through the alert relay; the GitHub hosts stay as a second observer. | Live v17; timer `monitoring-watchdog-tick` active. [On merge](../.github/workflows/deploy-edge-functions-on-merge.yml); fallback [deploy-single-function.yml](../.github/workflows/deploy-single-function.yml) |
| <!-- atlas:edge notify -->[`notify`](../supabase/functions/notify/index.ts) | Staff and the notification sender deliver ordinary urgent or queued Slack messages. | Live v53. [On merge](../.github/workflows/deploy-edge-functions-on-merge.yml), first in the Track-B order, with the Linear-exit SQL preflight; fallback [deploy-onboarding-edge-functions.yml](../.github/workflows/deploy-onboarding-edge-functions.yml) or [deploy-single-function.yml](../.github/workflows/deploy-single-function.yml) |
| <!-- atlas:edge onboarding-capture -->[`onboarding-capture`](../supabase/functions/onboarding-capture/index.ts) | Public forms durably capture onboarding and fallback submissions. | Live v80. [On merge](../.github/workflows/deploy-edge-functions-on-merge.yml); no manual lane. |
| <!-- atlas:edge onboarding-full -->[`onboarding-full`](../supabase/functions/onboarding-full/index.ts) | Staff reads one full protected onboarding submission. | Live v87. [On merge](../.github/workflows/deploy-edge-functions-on-merge.yml); fallback [deploy-onboarding-edge-functions.yml](../.github/workflows/deploy-onboarding-edge-functions.yml) |
| <!-- atlas:edge onboarding-list -->[`onboarding-list`](../supabase/functions/onboarding-list/index.ts) | Staff reads standard onboarding submission summaries. | Live v87. [On merge](../.github/workflows/deploy-edge-functions-on-merge.yml); fallback [deploy-onboarding-edge-functions.yml](../.github/workflows/deploy-onboarding-edge-functions.yml) |
| <!-- atlas:edge pipeline-google -->[`pipeline-google`](../supabase/functions/pipeline-google/index.ts) | The filming-plan pipeline reads and writes Docs, Sheets and Drive with the pipeline key (moved here from synchro-pipelines 2026-10-16), or with a 6-hour filming pipeline pass from the connector's `pipeline_pass` tool, limited to one client's files (plus company-wide files named in the `fp_settings` key `company_read_files`, read only) and to tabs created through a pass ([rules](../supabase/functions/pipeline-google/rules.mjs)); with a pass it also reads and saves the pipeline's per-client files, takes batch numbers, saves feedback notes and hands out a Synchro Brain snapshot ([store](../supabase/functions/pipeline-google/store.mjs)). | Live v36. [On merge](../.github/workflows/deploy-edge-functions-on-merge.yml); fallback [deploy-single-function.yml](../.github/workflows/deploy-single-function.yml) |
| <!-- atlas:edge pipeline-social -->[`pipeline-social`](../supabase/functions/pipeline-social/index.ts) | The filming-plan pipeline's door to ScrapeCreators (2026-10-23): TikTok, YouTube Shorts and Reddit research, video transcripts and the credit balance, with a 6-hour filming pipeline pass (x-pipeline-pass). Each action is one fixed endpoint ([rules](../supabase/functions/pipeline-social/rules.mjs)); every call is logged in `hf_activity` and counted against a monthly cap (`fp_settings` key `scrapecreators_monthly_calls`). Key: Supabase secret `SCRAPECREATORS_API_KEY`. | Live v6. [On merge](../.github/workflows/deploy-edge-functions-on-merge.yml); no manual lane. |
| <!-- atlas:edge production-archive -->[`production-archive`](../supabase/functions/production-archive/index.ts) | Admin reads retained archive media and rescue metadata. | Live v56. [On merge](../.github/workflows/deploy-edge-functions-on-merge.yml), after production-write, with the Linear-exit SQL preflight; fallback [deploy-onboarding-edge-functions.yml](../.github/workflows/deploy-onboarding-edge-functions.yml) |
| <!-- atlas:edge production-comments -->[`production-comments`](../supabase/functions/production-comments/index.ts) | Staff and client scope read canonical comment threads. | Live v82. [On merge](../.github/workflows/deploy-edge-functions-on-merge.yml), after production-write, with the Linear-exit SQL preflight; fallback [deploy-onboarding-edge-functions.yml](../.github/workflows/deploy-onboarding-edge-functions.yml) |
| <!-- atlas:edge production-write -->[`production-write`](../supabase/functions/production-write/index.ts) | Staff and client review operations write native production state through one gateway. | Live v131. Section 4: on merge (after `notify`) dispatches [deploy-f27-section4-closures.yml](../.github/workflows/deploy-f27-section4-closures.yml) with `capture`; fingerprint re-pinned in the same PR. |
| <!-- atlas:edge roster-read -->[`roster-read`](../supabase/functions/roster-read/index.ts) | n8n reads the client roster (Clients Info) and who manages each client from the database (`ROSTER_SERVICE_KEY`); csv answers keep the Sheet's headers. | Live v22; in use by n8n since the roster switch of 2026-10-02 (six workflows read or write through roster-read / roster-write). [On merge](../.github/workflows/deploy-edge-functions-on-merge.yml); fallback [deploy-single-function.yml](../.github/workflows/deploy-single-function.yml) |
| <!-- atlas:edge roster-write -->[`roster-write`](../supabase/functions/roster-write/index.ts) | n8n (and backfills) write clients and manager assignments to `client_profiles` and the manager lists, with history, then send the Sheet copy; `copy_to_sheet` retries the queue, `queue_full_copy` queues the whole roster. The only door that sets `extra.postforme_instagram_account_id`. `sync_managers` (Sheet-main Manager Sync) refuses now that the database is main. | Live v22; in use since 2026-10-02. [On merge](../.github/workflows/deploy-edge-functions-on-merge.yml); fallback [deploy-single-function.yml](../.github/workflows/deploy-single-function.yml) |
| <!-- atlas:edge pto -->[`pto`](../supabase/functions/pto/index.ts) | Staff requests time off; admin decides and manages balances. | Live v55. [On merge](../.github/workflows/deploy-edge-functions-on-merge.yml) with `PTO_SCHEMA_CONTRACT`; fallback [deploy-pto-edge-functions.yml](../.github/workflows/deploy-pto-edge-functions.yml) |
| <!-- atlas:edge quiz-capture -->[`quiz-capture`](../supabase/functions/quiz-capture/index.ts) | The marketing site captures quiz responses and forwards intake. | Live v51. [On merge](../.github/workflows/deploy-edge-functions-on-merge.yml); no manual lane. |
| <!-- atlas:edge quiz-leads-list -->[`quiz-leads-list`](../supabase/functions/quiz-leads-list/index.ts) | Admin reads captured marketing quiz leads. | Live v51. [On merge](../.github/workflows/deploy-edge-functions-on-merge.yml); no manual lane. |
| <!-- atlas:edge sample-review-reorder -->[`sample-review-reorder`](../supabase/functions/sample-review-reorder/index.ts) | Staff reorders existing Sample review cards. | Live v83. [On merge](../.github/workflows/deploy-edge-functions-on-merge.yml); no manual lane. |
| <!-- atlas:edge sample-review-upsert -->[`sample-review-upsert`](../supabase/functions/sample-review-upsert/index.ts) | Staff and client links save Sample reviews. Frozen live writer. | Live v96. Frozen by [owner rule](../AGENTS.md): the merge lane never deploys it. No redeploy or re-gating without the owner. |
| <!-- atlas:edge smm-weekly-reports -->[`smm-weekly-reports`](../supabase/functions/smm-weekly-reports/index.ts) | Managers submit reports; admin reviews; also serves the review queue's manager list to the page. | Live v81. [On merge](../.github/workflows/deploy-edge-functions-on-merge.yml); fallback [deploy-onboarding-edge-functions.yml](../.github/workflows/deploy-onboarding-edge-functions.yml) |
| <!-- atlas:edge syncview-session -->[`syncview-session`](../supabase/functions/syncview-session/index.ts) | Prepared v2 guest sign-in exchanges a verified SyncView credential for scoped app metadata. | Live v32. [On merge](../.github/workflows/deploy-edge-functions-on-merge.yml); fallback [deploy-single-function.yml](../.github/workflows/deploy-single-function.yml) |
| <!-- atlas:edge templates-save -->[`templates-save`](../supabase/functions/templates-save/index.ts) | Staff saves creative templates. | Live v81. [On merge](../.github/workflows/deploy-edge-functions-on-merge.yml); no manual lane. |
| <!-- atlas:edge thumbnail-folder-resolve -->[`thumbnail-folder-resolve`](../supabase/functions/thumbnail-folder-resolve/index.ts) | Calendar and Samples resolve a public Drive folder reference. | Live v73. [On merge](../.github/workflows/deploy-edge-functions-on-merge.yml); no manual lane. |
| <!-- atlas:edge thumbnail-revision-read -->[`thumbnail-revision-read`](../supabase/functions/thumbnail-revision-read/index.ts) | Staff and scoped client reviews obtain signed thumbnail revisions. | Live v77. [On merge](../.github/workflows/deploy-edge-functions-on-merge.yml); fallback [deploy-thumbnail-edge-functions.yml](../.github/workflows/deploy-thumbnail-edge-functions.yml) |
| <!-- atlas:edge thumbnail-revision-scan -->[`thumbnail-revision-scan`](../supabase/functions/thumbnail-revision-scan/index.ts) | The scheduled scanner (pg_cron dispatch every 10 minutes) discovers Drive thumbnail changes. | Live v80. [On merge](../.github/workflows/deploy-edge-functions-on-merge.yml); fallback [deploy-thumbnail-edge-functions.yml](../.github/workflows/deploy-thumbnail-edge-functions.yml) |
| <!-- atlas:edge workload-plan -->[`workload-plan`](../supabase/functions/workload-plan/index.ts) | Staff reads native Workload; admin and SMM edit internal plan dates. | Live v65. [On merge](../.github/workflows/deploy-edge-functions-on-merge.yml); fallback [deploy-single-function.yml](../.github/workflows/deploy-single-function.yml) |
| <!-- atlas:edge write-diagnostics -->[`write-diagnostics`](../supabase/functions/write-diagnostics/index.ts) | Browsers report save refusals to the server-side refusal log; admin reads Save problems. | Live v47. [On merge](../.github/workflows/deploy-edge-functions-on-merge.yml); fallback [deploy-single-function.yml](../.github/workflows/deploy-single-function.yml) |
| <!-- atlas:edge client-hubspot-sync -->[`client-hubspot-sync`](../supabase/functions/client-hubspot-sync/index.ts) | Keeps each client's HubSpot deal, contract state and payment state in `client_sales_state` (read only toward HubSpot, never n8n): refreshed when an admin opens a profile; built for a daily timer too. | Live v21. Switch `client_hubspot_sync` mode on for a short list of clients (`all: false`); no daily pg_cron job exists (2026-10-29). [On merge](../.github/workflows/deploy-edge-functions-on-merge.yml) with the HubSpot schema readback; fallback [deploy-single-function.yml](../.github/workflows/deploy-single-function.yml) |


### Live functions owned outside this repo


| Live function | Owner and purpose | Deployment finding |
| --- | --- | --- |
| `fp-tab-test` | [Retired test stub](https://github.com/sidney-afk/synchro-pipelines/blob/main/supabase/functions/fp-tab-test/index.ts). Returns a retired test result and no longer creates Doc tabs. | Live v30 (2026-10-29), ACTIVE, JWT off. No source in this repo; the merge lane never touches it. |
| `doctors-partial-capture` | [Capture workflow](#n8n). Marketing doctors form relays qualified partial leads into email-only recovery. | Live v29 (2026-10-29), ACTIVE, JWT off. No source file in this repo; deploy provenance unverified. |

`pipeline-google` and `pipeline-social` used to sit in this sub-table; both have their source in this repo and deploy on merge, so they are in the main table above.

## n8n

Verified 2026-10-29 against main 45c88a8 and the live catalog (read-only).

The live census (re-read 2026-10-29, read-only) has **125 workflows: 56 active and 69 inactive**, the same IDs and counts as the 2026-10-23 read; none were added, removed or archived since. The 2026-09-30 read found 120 (76 active). Every live ID is listed below, and the table of active workflows now holds only the 56 that are active; the 24 switched off since 2026-10-01 moved to the inactive table with their off date. Graphs re-read on 2026-10-29: the roster readers and writers, the two analytics timers, MARKET RESEARCH, VIDEO PRODUCTION AUTOMATION, Onboarding Provisioning, Weekly Backup, Kasper Ad Performance, Booking Recovery Dispatch and Inbound SMS Relay; other edits since 2026-09-30 are taken from `ops/N8N_EDIT_LOG.md`, and graphs unchanged since then rest on the 2026-09-30 read. Client data: every n8n reader or writer of client and manager rows that is on goes through `roster-read` / `roster-write` (client profiles are the source since 2026-10-02); the switched-off analytics timers still read the Clients Info tab, which is now only a copy. Active means enabled, not proven healthy. The [truth register](truth/N8N.md) holds IDs; the [phase 2 exit plan](plans/2026-09-30-n8n-exit-phase-2.md) owns decisions, evidence gates and retirement dates. Timers use the stated workflow timezone; instance timezone was not independently read. Node defaults that are absent from serialized settings are left unknown.


| Active workflow | Trigger and cadence | What it touches | Exit status |
| --- | --- | --- | --- |
| <!-- atlas:n8n udkwwzdFuPW3K2CE -->[`udkwwzdFuPW3K2CE`](https://synchrosocial.app.n8n.cloud/workflow/udkwwzdFuPW3K2CE) Client, Slack Creative Channel Finalizer | Every 15 minutes; POST webhook; Daily 15:07; instance timezone | Finalizer queue (n8n table), filming plans and Slack channels; client and manager rows read and the creative channel id written through `roster-read` / `roster-write` (client profiles; Clients Info gets the copy) since 2026-10-02. | A: direct trigger built; keep safety timers until real client proof (the roster path has not had a real client run yet). |
| <!-- atlas:n8n nQ4vnZ8bmG3E3Lor -->[`nQ4vnZ8bmG3E3Lor`](https://synchrosocial.app.n8n.cloud/workflow/nQ4vnZ8bmG3E3Lor) Sales, Booking Recovery Dispatch | Hourly; instance timezone | Booking recovery queue, HubSpot, email, SMS and booking alerts. Logs each event to `crm-leads` (Leads CRM) since 2026-10-26. | C: due-work gate planned; hourly dispatch still enabled. |
| <!-- atlas:n8n a2sJJ3oZMefASPl2 -->[`a2sJJ3oZMefASPl2`](https://synchrosocial.app.n8n.cloud/workflow/a2sJJ3oZMefASPl2) Sales, Booking Recovery Heartbeat | Daily 09:00; America/New_York | Recovery queue health and Slack alert. | Keep as recovery heartbeat. |
| <!-- atlas:n8n 8nq6jGbpmCDZxnQz -->[`8nq6jGbpmCDZxnQz`](https://synchrosocial.app.n8n.cloud/workflow/8nq6jGbpmCDZxnQz) Sales, Doctors Partial Lead Capture | POST webhook; instance timezone | Doctors partial lead queue for email recovery. Logs each event to `crm-leads` (Leads CRM) since 2026-10-26. | Keep; external marketing intake. |
| <!-- atlas:n8n xoPqojySDriQ8Mzh -->[`xoPqojySDriQ8Mzh`](https://synchrosocial.app.n8n.cloud/workflow/xoPqojySDriQ8Mzh) Sales, Call Booked (iClosed) | POST webhook; instance timezone | iClosed booking into HubSpot and sales handlers. Logs each event to `crm-leads` (Leads CRM) since 2026-10-26. | Keep; external event. |
| <!-- atlas:n8n 31DnMJLU3YM89py1 -->[`31DnMJLU3YM89py1`](https://synchrosocial.app.n8n.cloud/workflow/31DnMJLU3YM89py1) Sales, Booking Recovery Capture (iClosed) | POST webhook; instance timezone | iClosed abandonment into booking recovery queue. | Keep; external event. |
| <!-- atlas:n8n s8lsPpKqWYhscLPV -->[`s8lsPpKqWYhscLPV`](https://synchrosocial.app.n8n.cloud/workflow/s8lsPpKqWYhscLPV) Sales, Booked Call to Meta CAPI | POST webhook; instance timezone | Booked call event into Meta conversion API. | Keep; external event. |
| <!-- atlas:n8n Tfhc3vebZyG6obOg -->[`Tfhc3vebZyG6obOg`](https://synchrosocial.app.n8n.cloud/workflow/Tfhc3vebZyG6obOg) SyncView Edge Alert Relay to DM Sidney | POST webhook; instance timezone | Sanitized edge alerts into owner Slack DM. | Keep; alert relay. |
| <!-- atlas:n8n eiisSbHsD1OnnNdQ -->[`eiisSbHsD1OnnNdQ`](https://synchrosocial.app.n8n.cloud/workflow/eiisSbHsD1OnnNdQ) Hiring, Practical Test Dispatch | Every 5 minutes; instance timezone | Hiring outbox through hiring-automation into practical-test email. | Keep until hiring closes; owner decision. |
| <!-- atlas:n8n su5afuhg17V2xhgh -->[`su5afuhg17V2xhgh`](https://synchrosocial.app.n8n.cloud/workflow/su5afuhg17V2xhgh) Hiring, Interview Invite Dispatch | Every 5 minutes; instance timezone | Hiring interview outbox through hiring-automation into invitation email. | Keep until hiring closes; owner decision. |
| <!-- atlas:n8n oi4BPg79dykdet6H -->[`oi4BPg79dykdet6H`](https://synchrosocial.app.n8n.cloud/workflow/oi4BPg79dykdet6H) Hiring, Application Capture (iClosed) | POST webhook; instance timezone | iClosed application, hiring bridge, Slack and Telegram. | Keep; external intake. |
| <!-- atlas:n8n oUf7Bj0lsLf72gIl -->[`oUf7Bj0lsLf72gIl`](https://synchrosocial.app.n8n.cloud/workflow/oUf7Bj0lsLf72gIl) Editor AI, Music Upload to Drive v2 | POST webhook; instance timezone | Editor music upload into Google Drive. | Keep; webhook tool. |
| <!-- atlas:n8n L6XjD7Kp6wDLCy5d -->[`L6XjD7Kp6wDLCy5d`](https://synchrosocial.app.n8n.cloud/workflow/L6XjD7Kp6wDLCy5d) Editor AI, Music Upload to Drive | POST webhook; instance timezone | Older editor music upload into Google Drive. | Keep; parallel webhook tool. |
| <!-- atlas:n8n 1WjZZjfQjDlg1Crf -->[`1WjZZjfQjDlg1Crf`](https://synchrosocial.app.n8n.cloud/workflow/1WjZZjfQjDlg1Crf) SyncView, Urgent Kasper Review to Slack | POST webhook; instance timezone | Urgent review notification into Slack DM. | Keep; webhook notification. |
| <!-- atlas:n8n TMJFYCqgqhZUBQpl -->[`TMJFYCqgqhZUBQpl`](https://synchrosocial.app.n8n.cloud/workflow/TMJFYCqgqhZUBQpl) Client Ideas, publish formatted tab (headers from payload) | POST webhook; instance timezone | Create formatted Google Sheet tab using payload headers. | Keep; pipeline publishing. |
| <!-- atlas:n8n tSQZx390d98JlHda -->[`tSQZx390d98JlHda`](https://synchrosocial.app.n8n.cloud/workflow/tSQZx390d98JlHda) Client Ideas, append rows to an existing tab | POST webhook; instance timezone | Append idea rows to caller-selected Google Sheet tab. | Keep; pipeline publishing. |
| <!-- atlas:n8n AWnfZXFbHFr43HuQ -->[`AWnfZXFbHFr43HuQ`](https://synchrosocial.app.n8n.cloud/workflow/AWnfZXFbHFr43HuQ) Client Ideas, publish formatted tab | POST webhook; instance timezone | Create formatted Google Sheet tab for client ideas. | Keep; pipeline publishing. |
| <!-- atlas:n8n fqoI8XrN5hpY9SOj -->[`fqoI8XrN5hpY9SOj`](https://synchrosocial.app.n8n.cloud/workflow/fqoI8XrN5hpY9SOj) Arketa REVIVAL , daily member report to Slack | Cron `0 6 * * *`; Pacific/Honolulu | Arketa membership report into n8n report store and Slack. | Keep; external vendor report. |
| <!-- atlas:n8n chwr81f1GG5tgKtV -->[`chwr81f1GG5tgKtV`](https://synchrosocial.app.n8n.cloud/workflow/chwr81f1GG5tgKtV) Arketa REVIVAL , report watchdog | Cron `0 8 * * *`; Pacific/Honolulu | Arketa report freshness into Slack alert. | Keep; watchdog. |
| <!-- atlas:n8n 2Ax4c78jgI7roXzv -->[`2Ax4c78jgI7roXzv`](https://synchrosocial.app.n8n.cloud/workflow/2Ax4c78jgI7roXzv) Kasper Ad Performance, Daily Pull | Cron `0 9 * * *`; Cron `0 21 * * *`; instance timezone | Meta ads, iClosed bookings, HubSpot contacts and the n8n booking_recovery table into five Kasper performance tables. | G: possible optional move; current pull stays. |
| <!-- atlas:n8n BrJSe8zCKUccfmIq -->[`BrJSe8zCKUccfmIq`](https://synchrosocial.app.n8n.cloud/workflow/BrJSe8zCKUccfmIq) VIDEO PRODUCTION AUTOMATION | POST webhook; GET webhook; instance timezone | Video and graphic intake: Linear project and editor lookups, filming plans, manager list through `roster-read`, Video Editors and Linear Submissions Sheets, F44 receipts and Slack; the AI thumbnail branch is disabled. | H: keep large graph; production authority is native, retained Linear branches are not live-write proof. |
| <!-- atlas:n8n t2RP7QNHrbQx52f4 -->[`t2RP7QNHrbQx52f4`](https://synchrosocial.app.n8n.cloud/workflow/t2RP7QNHrbQx52f4) Client, Onboarding Provisioning | Called by workflow; instance timezone | Drive folders, HubSpot and Slack finalizer queue. | Keep provisioning; A trims finalizer polling only. |
| <!-- atlas:n8n ghpbQQJizAnR6p2b -->[`ghpbQQJizAnR6p2b`](https://synchrosocial.app.n8n.cloud/workflow/ghpbQQJizAnR6p2b) Normal Sales, Booking Handler | Called by workflow; instance timezone | HubSpot booking, sales emails and Telegram; no booking confirmation text since 2026-10-27. | Keep; invoked sales handler. |
| <!-- atlas:n8n m6T2atZGGXKlDqfw -->[`m6T2atZGGXKlDqfw`](https://synchrosocial.app.n8n.cloud/workflow/m6T2atZGGXKlDqfw) Sales, Inbound SMS Relay | POST webhook; instance timezone | Inbound Twilio SMS relayed into Telegram; replies from known leads logged to `crm-leads` (match only) since 2026-10-27. | Keep; external event. |
| <!-- atlas:n8n z9Rt1Np00nfvFe6J -->[`z9Rt1Np00nfvFe6J`](https://synchrosocial.app.n8n.cloud/workflow/z9Rt1Np00nfvFe6J) AI Client, Send Onboarding Email | Called by workflow; instance timezone | AI onboarding email and HubSpot record. | Keep; invoked onboarding handler. |
| <!-- atlas:n8n I6EES5l97h2fCims -->[`I6EES5l97h2fCims`](https://synchrosocial.app.n8n.cloud/workflow/I6EES5l97h2fCims) Normal Client, Send Onboarding Email | Called by workflow; instance timezone | Normal onboarding email and HubSpot record. | Keep; invoked onboarding handler. |
| <!-- atlas:n8n K8eriMC5r8sudLDB -->[`K8eriMC5r8sudLDB`](https://synchrosocial.app.n8n.cloud/workflow/K8eriMC5r8sudLDB) Sales Intake, Submit | POST webhook; instance timezone | Sales intake record, contract, Stripe, email and Slack. | Keep; external intake. |
| <!-- atlas:n8n 1T64i88a7oXh1TP8 -->[`1T64i88a7oXh1TP8`](https://synchrosocial.app.n8n.cloud/workflow/1T64i88a7oXh1TP8) Sales, Payment Received (Commas) | POST webhook; instance timezone | Payment signal into HubSpot contract and onboarding gates. | Keep; signed external event. |
| <!-- atlas:n8n RFi70kokkNFHoRC0 -->[`RFi70kokkNFHoRC0`](https://synchrosocial.app.n8n.cloud/workflow/RFi70kokkNFHoRC0) Onboarding, Append Client Row | POST webhook; instance timezone | One `roster-write` `upsert_client` call (client and manager) into client profiles; the Clients Info and Social Media Managers tabs get the copy. | Keep; Sheet writes replaced by `roster-write` 2026-10-02. Webhook still has no sign-in. |
| <!-- atlas:n8n OmAExq4kdDdNk1HP -->[`OmAExq4kdDdNk1HP`](https://synchrosocial.app.n8n.cloud/workflow/OmAExq4kdDdNk1HP) Sales, Invoice Paid (Stripe) | POST webhook; instance timezone | Stripe invoice signal into HubSpot and onboarding gates. | Keep; external event. |
| <!-- atlas:n8n 310kO3OnG1yytE2D -->[`310kO3OnG1yytE2D`](https://synchrosocial.app.n8n.cloud/workflow/310kO3OnG1yytE2D) Normal Sales, Pre-Call Nurture | Called by workflow; instance timezone | Normal pre-call nurture emails with waits and cancellation checks. Logs each event to `crm-leads` (Leads CRM) since 2026-10-26. | Keep; invoked sales handler. |
| <!-- atlas:n8n GaYgLJy8NCPUUfw5 -->[`GaYgLJy8NCPUUfw5`](https://synchrosocial.app.n8n.cloud/workflow/GaYgLJy8NCPUUfw5) AI Sales, Pre-Call Nurture | Called by workflow; instance timezone | AI pre-call nurture emails with waits and cancellation checks. | Keep; invoked sales handler. |
| <!-- atlas:n8n jlVfbg0Njxf1It7h -->[`jlVfbg0Njxf1It7h`](https://synchrosocial.app.n8n.cloud/workflow/jlVfbg0Njxf1It7h) SyncView, Weekly Backup | Sunday 02:00; instance timezone | Google Drive copies of the Main Sheet, every n8n graph (read back and checked) and four database tables; the repo zip steps are disabled since 2026-10-25. | Keep; partial backup, not complete restore proof. |
| <!-- atlas:n8n kI7M7R5UTJupOsFv -->[`kI7M7R5UTJupOsFv`](https://synchrosocial.app.n8n.cloud/workflow/kI7M7R5UTJupOsFv) SyncView SMM Reports, Weekly Reminder | Monday 09:00; America/Guatemala | Weekly social manager reporting reminder email. | Keep; timer. |
| <!-- atlas:n8n gAqqhjIcpBxW9wB6 -->[`gAqqhjIcpBxW9wB6`](https://synchrosocial.app.n8n.cloud/workflow/gAqqhjIcpBxW9wB6) Sales, Contract Signed | POST webhook; instance timezone | Signed contract event into HubSpot and onboarding gates. | Keep; external event. |
| <!-- atlas:n8n alZ87zcRVKgcGVY7 -->[`alZ87zcRVKgcGVY7`](https://synchrosocial.app.n8n.cloud/workflow/alZ87zcRVKgcGVY7) Clients, Monthly Check-in | Monthly 08:00; day not serialized; instance timezone | MonthlyCheckup Sheet into client check-in emails. | Keep; timer. |
| <!-- atlas:n8n II3sJbSLrptmtWLR -->[`II3sJbSLrptmtWLR`](https://synchrosocial.app.n8n.cloud/workflow/II3sJbSLrptmtWLR) Clients, Content Ready Notify | POST webhook; instance timezone | Client email read through `roster-read` (client profiles), then content-ready email. | Keep; webhook notification. |
| <!-- atlas:n8n XM70AtHSrsCsfd3k -->[`XM70AtHSrsCsfd3k`](https://synchrosocial.app.n8n.cloud/workflow/XM70AtHSrsCsfd3k) AI Sales, Post-Call Next Steps | Form submission; instance timezone | Post-call form into HubSpot, Stripe and next-step email. | Keep; form intake. |
| <!-- atlas:n8n ydbhXgV3X7SVnkSy -->[`ydbhXgV3X7SVnkSy`](https://synchrosocial.app.n8n.cloud/workflow/ydbhXgV3X7SVnkSy) SyncView Onboarding, Legacy List | GET webhook; instance timezone | Legacy onboarding Supabase list read. | Keep compatibility wrapper; no phase 2 off date. |
| <!-- atlas:n8n hxLFIdKG9hUIzukO -->[`hxLFIdKG9hUIzukO`](https://synchrosocial.app.n8n.cloud/workflow/hxLFIdKG9hUIzukO) SyncView AI Onboarding, Submit | POST webhook; instance timezone | AI onboarding submission into Supabase and Slack. | Keep external form wrapper. |
| <!-- atlas:n8n ljNY7CKYLKzMOACZ -->[`ljNY7CKYLKzMOACZ`](https://synchrosocial.app.n8n.cloud/workflow/ljNY7CKYLKzMOACZ) SyncView Onboarding, Submit | POST webhook; instance timezone | Normal onboarding submission into Supabase and Slack. | Keep external form wrapper. |
| <!-- atlas:n8n u4ACOKArXHidVJXl -->[`u4ACOKArXHidVJXl`](https://synchrosocial.app.n8n.cloud/workflow/u4ACOKArXHidVJXl) SyncView Onboarding, Fallback Capture | POST webhook; instance timezone | Failed onboarding into n8n fallback table and Slack. | Keep recovery capture. |
| <!-- atlas:n8n r8b6IU2762qkmSvZ -->[`r8b6IU2762qkmSvZ`](https://synchrosocial.app.n8n.cloud/workflow/r8b6IU2762qkmSvZ) AI Sales, Call Cancelled (iClosed) | POST webhook; instance timezone | iClosed cancellation into n8n cancellation table. Logs each event to `crm-leads` (Leads CRM) since 2026-10-26. | Keep; external event. |
| <!-- atlas:n8n itqDXSl2ybsRSAiQ -->[`itqDXSl2ybsRSAiQ`](https://synchrosocial.app.n8n.cloud/workflow/itqDXSl2ybsRSAiQ) SyncView, Error Alerts to DM Sidney | Production error; instance timezone | Production workflow failures into Slack DM. | Keep; coverage depends on each workflow error setting. |
| <!-- atlas:n8n rhDX5VfnmOylc8o7 -->[`rhDX5VfnmOylc8o7`](https://synchrosocial.app.n8n.cloud/workflow/rhDX5VfnmOylc8o7) SyncView Editors, Labor Week | POST webhook; instance timezone | Retained Linear labor-week read. | Keep in plan; current credential success was not tested. |
| <!-- atlas:n8n oDZ1Oljvaig5KSLD -->[`oDZ1Oljvaig5KSLD`](https://synchrosocial.app.n8n.cloud/workflow/oDZ1Oljvaig5KSLD) SyncView AI Onboarding, List | GET webhook; instance timezone | AI onboarding Supabase list read. | Keep compatibility wrapper. |
| <!-- atlas:n8n slqt2zCDyIc7OAmY -->[`slqt2zCDyIc7OAmY`](https://synchrosocial.app.n8n.cloud/workflow/slqt2zCDyIc7OAmY) SyncView Onboarding, List | GET webhook; instance timezone | Normal onboarding Supabase list read. | Keep compatibility wrapper. |
| <!-- atlas:n8n gPY5DL4D0n5nwius -->[`gPY5DL4D0n5nwius`](https://synchrosocial.app.n8n.cloud/workflow/gPY5DL4D0n5nwius) Sample Review, Upsert | POST webhook; instance timezone | Native sample card, comments and save event. | Phase 1: still on 2026-10-29 and still running from an unidentified caller; do not switch off until it is found (`ops/OWNER_SHIP_LIST.md`). |
| <!-- atlas:n8n XOT7IDFGxTwOUCCP -->[`XOT7IDFGxTwOUCCP`](https://synchrosocial.app.n8n.cloud/workflow/XOT7IDFGxTwOUCCP) Sample Review, Reorder | POST webhook; instance timezone | Native sample card order. | Phase 1: still on 2026-10-29; off only after zero-run proof (run count unverified 2026-10-29). |
| <!-- atlas:n8n EUGX35UmyUgSCjWD -->[`EUGX35UmyUgSCjWD`](https://synchrosocial.app.n8n.cloud/workflow/EUGX35UmyUgSCjWD) Sample Review, Get | GET webhook; instance timezone | Native Samples read compatibility endpoint. | F: browser fallback retired in source; retain live wrapper until published page and zero-call proof. |
| <!-- atlas:n8n FD2QUIOlobkdLOgs -->[`FD2QUIOlobkdLOgs`](https://synchrosocial.app.n8n.cloud/workflow/FD2QUIOlobkdLOgs) MARKET RESEARCH | POST webhook; instance timezone | Client config through `roster-read`; Apify, Whisper and Anthropic into Market Research Briefs and Hook Library Sheets. | Keep; five enabled webhooks; the daily ContentSummaries timer branch and the duplicate copies are disabled. |
| <!-- atlas:n8n 3hZnjXmHdNv4bttw -->[`3hZnjXmHdNv4bttw`](https://synchrosocial.app.n8n.cloud/workflow/3hZnjXmHdNv4bttw) SyncView Caption Prompts, Get | GET webhook; instance timezone | CaptionPrompts Sheet fallback read. | Keep first-load fallback; no phase 2 off date. |
| <!-- atlas:n8n lpnLIPUFSo7bURWf -->[`lpnLIPUFSo7bURWf`](https://synchrosocial.app.n8n.cloud/workflow/lpnLIPUFSo7bURWf) Sales, Call Rescheduled (iClosed) | POST webhook; instance timezone | iClosed reschedule payload, Telegram alert to Kasper, pre-call nurture restart and the Pre-Call Nurture Started table. Logs each event to `crm-leads` (Leads CRM) since 2026-10-26. | Added 2026-10-22; active, keep. |
| <!-- atlas:n8n cM3G9REliKpwicnR -->[`cM3G9REliKpwicnR`](https://synchrosocial.app.n8n.cloud/workflow/cM3G9REliKpwicnR) Sales, Doctors Instant Booking Link | POST webhook; instance timezone | Doctors and educators form Submit, booking_recovery table, Gmail and Twilio. Logs each event to `crm-leads` (Leads CRM) since 2026-10-26. | Added 2026-10-05; active, keep. |
| <!-- atlas:n8n lU5RlPUBsmlMsFSf -->[`lU5RlPUBsmlMsFSf`](https://synchrosocial.app.n8n.cloud/workflow/lU5RlPUBsmlMsFSf) Educators Sales, Pre-Call Nurture | Called by other workflows; no own trigger | Educator pre-call emails and the nurture tables. Logs each event to `crm-leads` (Leads CRM) since 2026-10-26. | Added 2026-10-22; active, keep. |
| <!-- atlas:n8n S3fcVkml49KBxD6P -->[`S3fcVkml49KBxD6P`](https://synchrosocial.app.n8n.cloud/workflow/S3fcVkml49KBxD6P) Editor AI, Client notes from the brain | GET webhook; instance timezone | Reads one client Music section from the brain repository and returns only that. | Added 2026-10-12; active, keep. |


### Inactive retained workflows

These 69 IDs still exist but are disabled (checked 2026-10-29). They are history or recovery assets, not schedules. The first 24 were switched off between 2026-10-01 and 2026-10-16, each recorded in `ops/N8N_EDIT_LOG.md`; the other 45 were already off on 2026-09-30 or added off. Individual inactive graphs and past execution health were not audited; do not reactivate them from this map. Names of client-specific one-time tasks are omitted.


| Workflow | Purpose from retained name | Status |
| --- | --- | --- |
| <!-- atlas:n8n y1bEpXLggfR5HqYV -->[`y1bEpXLggfR5HqYV`](https://synchrosocial.app.n8n.cloud/workflow/y1bEpXLggfR5HqYV) | New Client to Slack DM (Notion Onboarding) | Off since 2026-10-01 (Notion form replaced; N8N_EDIT_LOG); kept unarchived for the F60 retirement proof. |
| <!-- atlas:n8n y3rEWCVdB0esN3tO -->[`y3rEWCVdB0esN3tO`](https://synchrosocial.app.n8n.cloud/workflow/y3rEWCVdB0esN3tO) | SyncView SMM Reports, Manager Sync (last version sent managers to `roster-write` `sync_managers`) | Off since 2026-10-02 at the client-profile switch (N8N_EDIT_LOG). |
| <!-- atlas:n8n Jr7JviDpBHee508N -->[`Jr7JviDpBHee508N`](https://synchrosocial.app.n8n.cloud/workflow/Jr7JviDpBHee508N) | Project Central, Sheet API | Off since 2026-10-02 (Project Central archived by the owner; N8N_EDIT_LOG). |
| <!-- atlas:n8n Q4n1bagJYBkurEaI -->[`Q4n1bagJYBkurEaI`](https://synchrosocial.app.n8n.cloud/workflow/Q4n1bagJYBkurEaI) | CLIENTS METRICS (reads the Clients Info copy; Apify, YouTube, Metrics and PostTracking Sheets, analytics-write) | Off since 2026-10-06 (analytics paused by the owner; N8N_EDIT_LOG). |
| <!-- atlas:n8n DyVPx0neUZ94R0hJ -->[`DyVPx0neUZ94R0hJ`](https://synchrosocial.app.n8n.cloud/workflow/DyVPx0neUZ94R0hJ) | TOP VIDEOS (reads the Clients Info copy; Apify, YouTube, TopVideos Sheet, analytics-write) | Off since 2026-10-06 (analytics paused by the owner; N8N_EDIT_LOG). |
| <!-- atlas:n8n pWSqaqVw7dmqhYOA -->[`pWSqaqVw7dmqhYOA`](https://synchrosocial.app.n8n.cloud/workflow/pWSqaqVw7dmqhYOA) | SyncView Calendar, Upsert Post | Off since 2026-10-08 (saves go to `calendar-upsert`; N8N_EDIT_LOG). |
| <!-- atlas:n8n meM78zr1Gcl72c6f -->[`meM78zr1Gcl72c6f`](https://synchrosocial.app.n8n.cloud/workflow/meM78zr1Gcl72c6f) | Calendar Comment Merge (helper) | Off since 2026-10-08 with Upsert Post (N8N_EDIT_LOG). |
| <!-- atlas:n8n o6wWaGNlIlyZFTX7 -->[`o6wWaGNlIlyZFTX7`](https://synchrosocial.app.n8n.cloud/workflow/o6wWaGNlIlyZFTX7) | SyncView TikTok Upload, Submit | Off since 2026-10-08 (TikTok runs on Supabase; N8N_EDIT_LOG). |
| <!-- atlas:n8n qGJ7mUjml98DSiGo -->[`qGJ7mUjml98DSiGo`](https://synchrosocial.app.n8n.cloud/workflow/qGJ7mUjml98DSiGo) | SyncView TikTok Upload, Submit (Direct) | Off since 2026-10-08 (TikTok runs on Supabase; N8N_EDIT_LOG). |
| <!-- atlas:n8n FlvoUXIFwRDg8KUb -->[`FlvoUXIFwRDg8KUb`](https://synchrosocial.app.n8n.cloud/workflow/FlvoUXIFwRDg8KUb) | SyncView TikTok Upload, Media Upload URL | Off since 2026-10-08 (TikTok runs on Supabase; N8N_EDIT_LOG). |
| <!-- atlas:n8n iYb1896sIAclGvy8 -->[`iYb1896sIAclGvy8`](https://synchrosocial.app.n8n.cloud/workflow/iYb1896sIAclGvy8) | SyncView TikTok Upload, List | Off since 2026-10-08 (TikTok runs on Supabase; N8N_EDIT_LOG). |
| <!-- atlas:n8n IjayuU6jkA21aKo3 -->[`IjayuU6jkA21aKo3`](https://synchrosocial.app.n8n.cloud/workflow/IjayuU6jkA21aKo3) | SyncView TikTok Upload, Status | Off since 2026-10-08 (TikTok runs on Supabase; N8N_EDIT_LOG). |
| <!-- atlas:n8n 4ca3li54eRFtSfXE -->[`4ca3li54eRFtSfXE`](https://synchrosocial.app.n8n.cloud/workflow/4ca3li54eRFtSfXE) | SyncView TikTok Upload, Cancel | Off since 2026-10-08 (TikTok runs on Supabase; N8N_EDIT_LOG). |
| <!-- atlas:n8n 1qZmOQPtG6rKYlK7 -->[`1qZmOQPtG6rKYlK7`](https://synchrosocial.app.n8n.cloud/workflow/1qZmOQPtG6rKYlK7) | SyncView TikTok Upload, Result | Off since 2026-10-09 (Post For Me results go to `tiktok-upload`; N8N_EDIT_LOG). |
| <!-- atlas:n8n RGkuE8d4uJg6CPde -->[`RGkuE8d4uJg6CPde`](https://synchrosocial.app.n8n.cloud/workflow/RGkuE8d4uJg6CPde) | SyncView Caption Prompts, Save | Off since 2026-10-09 (replaced by `caption-prompts-save`; N8N_EDIT_LOG). |
| <!-- atlas:n8n 5KnYvvZ33B78Khny -->[`5KnYvvZ33B78Khny`](https://synchrosocial.app.n8n.cloud/workflow/5KnYvvZ33B78Khny) | SyncView Caption Jobs, Status | Off since 2026-10-09 (replaced by `caption-jobs`; N8N_EDIT_LOG). |
| <!-- atlas:n8n vwRfBZsmUMtDqbYM -->[`vwRfBZsmUMtDqbYM`](https://synchrosocial.app.n8n.cloud/workflow/vwRfBZsmUMtDqbYM) | SyncView Caption Jobs, Update | Off since 2026-10-09 (replaced by `caption-jobs`; N8N_EDIT_LOG). |
| <!-- atlas:n8n KViFEOqSRBNdCJRk -->[`KViFEOqSRBNdCJRk`](https://synchrosocial.app.n8n.cloud/workflow/KViFEOqSRBNdCJRk) | SyncView Calendar, Get | Off since 2026-10-09 (page reads the database; N8N_EDIT_LOG). |
| <!-- atlas:n8n TcWOfnKd4Csdnnbv -->[`TcWOfnKd4Csdnnbv`](https://synchrosocial.app.n8n.cloud/workflow/TcWOfnKd4Csdnnbv) | SyncView Kasper, Queue (batch) | Off since 2026-10-09 (page reads the database; N8N_EDIT_LOG). |
| <!-- atlas:n8n iA54ipMOybicmYBh -->[`iA54ipMOybicmYBh`](https://synchrosocial.app.n8n.cloud/workflow/iA54ipMOybicmYBh) | SyncView Calendar, Append Post | Off since 2026-10-13 (Calendar workbook frozen as backup; N8N_EDIT_LOG). |
| <!-- atlas:n8n JcekBKUzELgX4HjH -->[`JcekBKUzELgX4HjH`](https://synchrosocial.app.n8n.cloud/workflow/JcekBKUzELgX4HjH) | SyncView Calendar, Delete Post | Off since 2026-10-13 (Calendar workbook frozen as backup; N8N_EDIT_LOG). |
| <!-- atlas:n8n OXd0sUoSJYMspGTF -->[`OXd0sUoSJYMspGTF`](https://synchrosocial.app.n8n.cloud/workflow/OXd0sUoSJYMspGTF) | SyncView Calendar, Reorder | Off since 2026-10-13 (Calendar workbook frozen as backup; N8N_EDIT_LOG). |
| <!-- atlas:n8n lTtZNLrQLpIZqwAY -->[`lTtZNLrQLpIZqwAY`](https://synchrosocial.app.n8n.cloud/workflow/lTtZNLrQLpIZqwAY) | SyncView Calendar, Reorder (batch) | Off since 2026-10-13 (Calendar workbook frozen as backup; N8N_EDIT_LOG). |
| <!-- atlas:n8n rNrRCwKPGuau7sLH -->[`rNrRCwKPGuau7sLH`](https://synchrosocial.app.n8n.cloud/workflow/rNrRCwKPGuau7sLH) | SyncView Calendar, Generate Caption | Off since 2026-10-16 (captions run on `caption-generate`; page fallback removed in #2102; N8N_EDIT_LOG). |
| <!-- atlas:n8n TJVMyfwl85qrFGeK -->[`TJVMyfwl85qrFGeK`](https://synchrosocial.app.n8n.cloud/workflow/TJVMyfwl85qrFGeK) | SyncView, Urgent Tweak to Slack | Disabled; retained, no ordinary deployment or off-date action. |
| <!-- atlas:n8n YftXIbiMkgin50HI -->[`YftXIbiMkgin50HI`](https://synchrosocial.app.n8n.cloud/workflow/YftXIbiMkgin50HI) | Create AI Generated Music Folder (setup) | Disabled; retained, no ordinary deployment or off-date action. |
| <!-- atlas:n8n qR1Wgr71HTohlCzH -->[`qR1Wgr71HTohlCzH`](https://synchrosocial.app.n8n.cloud/workflow/qR1Wgr71HTohlCzH) | Filming Plan, Docs BatchUpdate (webhook) | Disabled; retained, no ordinary deployment or off-date action. |
| <!-- atlas:n8n LRf1OxhXlyv5YEyV -->[`LRf1OxhXlyv5YEyV`](https://synchrosocial.app.n8n.cloud/workflow/LRf1OxhXlyv5YEyV) | Private one-time maintenance task | Disabled; retained, no ordinary deployment or off-date action. |
| <!-- atlas:n8n L8mem5VAJyNZiuk7 -->[`L8mem5VAJyNZiuk7`](https://synchrosocial.app.n8n.cloud/workflow/L8mem5VAJyNZiuk7) | Private one-time maintenance task | Disabled; retained, no ordinary deployment or off-date action. |
| <!-- atlas:n8n 6UyCt01RNlt2YO9B -->[`6UyCt01RNlt2YO9B`](https://synchrosocial.app.n8n.cloud/workflow/6UyCt01RNlt2YO9B) | Private one-time maintenance task | Disabled; retained, no ordinary deployment or off-date action. |
| <!-- atlas:n8n 2JxqOqTUtlfUWI9N -->[`2JxqOqTUtlfUWI9N`](https://synchrosocial.app.n8n.cloud/workflow/2JxqOqTUtlfUWI9N) | Private one-time maintenance task | Disabled; retained, no ordinary deployment or off-date action. |
| <!-- atlas:n8n Zw2TIvLuMlIo81Vp -->[`Zw2TIvLuMlIo81Vp`](https://synchrosocial.app.n8n.cloud/workflow/Zw2TIvLuMlIo81Vp) | Private one-time maintenance task | Disabled; retained, no ordinary deployment or off-date action. |
| <!-- atlas:n8n e7IQzG58w5dRNSvV -->[`e7IQzG58w5dRNSvV`](https://synchrosocial.app.n8n.cloud/workflow/e7IQzG58w5dRNSvV) | Private one-time maintenance task | Disabled; retained, no ordinary deployment or off-date action. |
| <!-- atlas:n8n xOVa10JrMFXAe2xJ -->[`xOVa10JrMFXAe2xJ`](https://synchrosocial.app.n8n.cloud/workflow/xOVa10JrMFXAe2xJ) | Private one-time maintenance task | Disabled; retained, no ordinary deployment or off-date action. |
| <!-- atlas:n8n tzHL7vV2n4IZUCGW -->[`tzHL7vV2n4IZUCGW`](https://synchrosocial.app.n8n.cloud/workflow/tzHL7vV2n4IZUCGW) | Private one-time maintenance task | Disabled; retained, no ordinary deployment or off-date action. |
| <!-- atlas:n8n iz42ILXhZ3eBj3IJ -->[`iz42ILXhZ3eBj3IJ`](https://synchrosocial.app.n8n.cloud/workflow/iz42ILXhZ3eBj3IJ) | Private one-time maintenance task | Disabled; retained, no ordinary deployment or off-date action. |
| <!-- atlas:n8n E9MUbcDUVt4FJu2i -->[`E9MUbcDUVt4FJu2i`](https://synchrosocial.app.n8n.cloud/workflow/E9MUbcDUVt4FJu2i) | Private one-time maintenance task | Disabled; retained, no ordinary deployment or off-date action. |
| <!-- atlas:n8n ABiN18oLVsE0X5Pt -->[`ABiN18oLVsE0X5Pt`](https://synchrosocial.app.n8n.cloud/workflow/ABiN18oLVsE0X5Pt) | Private one-time maintenance task | Disabled; retained, no ordinary deployment or off-date action. |
| <!-- atlas:n8n 3ZA0GIMuklByBScV -->[`3ZA0GIMuklByBScV`](https://synchrosocial.app.n8n.cloud/workflow/3ZA0GIMuklByBScV) | Private one-time maintenance task | Disabled; retained, no ordinary deployment or off-date action. |
| <!-- atlas:n8n K1iSkFMQCroJvbPc -->[`K1iSkFMQCroJvbPc`](https://synchrosocial.app.n8n.cloud/workflow/K1iSkFMQCroJvbPc) | Private one-time maintenance task | Disabled; retained, no ordinary deployment or off-date action. |
| <!-- atlas:n8n QibBgR4ahxWbCo30 -->[`QibBgR4ahxWbCo30`](https://synchrosocial.app.n8n.cloud/workflow/QibBgR4ahxWbCo30) | Private one-time maintenance task | Disabled; retained, no ordinary deployment or off-date action. |
| <!-- atlas:n8n 4p3IWVnSaFNFhGWv -->[`4p3IWVnSaFNFhGWv`](https://synchrosocial.app.n8n.cloud/workflow/4p3IWVnSaFNFhGWv) | Client, Slack Private Channel Provisioner | Disabled; retained, no ordinary deployment or off-date action. |
| <!-- atlas:n8n 824XucXIPu0YBRHs -->[`824XucXIPu0YBRHs`](https://synchrosocial.app.n8n.cloud/workflow/824XucXIPu0YBRHs) | Private one-time maintenance task | Disabled; retained, no ordinary deployment or off-date action. |
| <!-- atlas:n8n AHTwSZPubALe6OJU -->[`AHTwSZPubALe6OJU`](https://synchrosocial.app.n8n.cloud/workflow/AHTwSZPubALe6OJU) | Private one-time maintenance task | Disabled; retained, no ordinary deployment or off-date action. |
| <!-- atlas:n8n BfUkVRGAOSsH3pmi -->[`BfUkVRGAOSsH3pmi`](https://synchrosocial.app.n8n.cloud/workflow/BfUkVRGAOSsH3pmi) | Sales, Growth Quiz Capture | Disabled; retained, no ordinary deployment or off-date action. |
| <!-- atlas:n8n 7PMVMQ9NuuxBa2Gi -->[`7PMVMQ9NuuxBa2Gi`](https://synchrosocial.app.n8n.cloud/workflow/7PMVMQ9NuuxBa2Gi) | Sales, Growth Quiz Heartbeat | Disabled; retained, no ordinary deployment or off-date action. |
| <!-- atlas:n8n 8OcmLPacyrug0V3M -->[`8OcmLPacyrug0V3M`](https://synchrosocial.app.n8n.cloud/workflow/8OcmLPacyrug0V3M) | Sales, Growth Quiz Nurture Dispatch | Disabled; retained, no ordinary deployment or off-date action. |
| <!-- atlas:n8n NeTWOfflUndxTe1C -->[`NeTWOfflUndxTe1C`](https://synchrosocial.app.n8n.cloud/workflow/NeTWOfflUndxTe1C) | Kasper Ad Performance, ONE-TIME Backfill (manual only) | Disabled; retained, no ordinary deployment or off-date action. |
| <!-- atlas:n8n UYUTvvj7YGJOeZuz -->[`UYUTvvj7YGJOeZuz`](https://synchrosocial.app.n8n.cloud/workflow/UYUTvvj7YGJOeZuz) | Kasper Ad Performance, Daily Pull | Disabled; retained, no ordinary deployment or off-date action. |
| <!-- atlas:n8n qllIDZPkdNAPRj0b -->[`qllIDZPkdNAPRj0b`](https://synchrosocial.app.n8n.cloud/workflow/qllIDZPkdNAPRj0b) | SyncView Monitoring Pager + Reconciler V2 Trigger | Disabled; retained, no ordinary deployment or off-date action. |
| <!-- atlas:n8n 8stSpZUiyG7f2LQX -->[`8stSpZUiyG7f2LQX`](https://synchrosocial.app.n8n.cloud/workflow/8stSpZUiyG7f2LQX) | SyncView Calendar, Linear Add Comment | Disabled; retained, no ordinary deployment or off-date action. |
| <!-- atlas:n8n VQqqeY9B2GZbh2Bt -->[`VQqqeY9B2GZbh2Bt`](https://synchrosocial.app.n8n.cloud/workflow/VQqqeY9B2GZbh2Bt) | SyncView Calendar, Linear Set Status | Disabled; retained, no ordinary deployment or off-date action. |
| <!-- atlas:n8n BTxic5NSaCMtZMh6 -->[`BTxic5NSaCMtZMh6`](https://synchrosocial.app.n8n.cloud/workflow/BTxic5NSaCMtZMh6) | Weekly Slack, Top Reel of the Week | Disabled; retained, no ordinary deployment or off-date action. |
| <!-- atlas:n8n ukLGHr6uDJIEP1pM -->[`ukLGHr6uDJIEP1pM`](https://synchrosocial.app.n8n.cloud/workflow/ukLGHr6uDJIEP1pM) | Weekly Slack, Top Reel + Top Videos in Niche (TEST) | Disabled; retained, no ordinary deployment or off-date action. |
| <!-- atlas:n8n GP8CSZDNcy5sGdFr -->[`GP8CSZDNcy5sGdFr`](https://synchrosocial.app.n8n.cloud/workflow/GP8CSZDNcy5sGdFr) | SyncView Calendar, Linear Issue Statuses | Disabled; retained, no ordinary deployment or off-date action. |
| <!-- atlas:n8n ROx3VQ36xm58AaIM -->[`ROx3VQ36xm58AaIM`](https://synchrosocial.app.n8n.cloud/workflow/ROx3VQ36xm58AaIM) | Register PFM Result Webhook (run once) | Disabled; retained, no ordinary deployment or off-date action. |
| <!-- atlas:n8n yQBGgdbZPqOgn2eE -->[`yQBGgdbZPqOgn2eE`](https://synchrosocial.app.n8n.cloud/workflow/yQBGgdbZPqOgn2eE) | SyncView Calendar, Supabase Backfill (ALL clients) | Disabled; retained, no ordinary deployment or off-date action. |
| <!-- atlas:n8n aw2b98wxraQTEulJ -->[`aw2b98wxraQTEulJ`](https://synchrosocial.app.n8n.cloud/workflow/aw2b98wxraQTEulJ) | SyncView Calendar, Supabase Backfill (TEST one client) | Disabled; retained, no ordinary deployment or off-date action. |
| <!-- atlas:n8n G1RRkIDs6Mh7RGk8 -->[`G1RRkIDs6Mh7RGk8`](https://synchrosocial.app.n8n.cloud/workflow/G1RRkIDs6Mh7RGk8) | Private one-time maintenance task | Disabled; retained, no ordinary deployment or off-date action. |
| <!-- atlas:n8n 7Pdp6qnkBzwXP3YG -->[`7Pdp6qnkBzwXP3YG`](https://synchrosocial.app.n8n.cloud/workflow/7Pdp6qnkBzwXP3YG) | SyncView Samples, Provision Missing Tabs | Disabled; retained, no ordinary deployment or off-date action. |
| <!-- atlas:n8n gB17L9M5yYxxk6GT -->[`gB17L9M5yYxxk6GT`](https://synchrosocial.app.n8n.cloud/workflow/gB17L9M5yYxxk6GT) | SyncView Calendar, Provision Missing Tabs | Disabled; retained, no ordinary deployment or off-date action. |
| <!-- atlas:n8n d7Dod7OuQsVsl1CN -->[`d7Dod7OuQsVsl1CN`](https://synchrosocial.app.n8n.cloud/workflow/d7Dod7OuQsVsl1CN) | SyncView Workload, Tweak Comments | Disabled; retained, no ordinary deployment or off-date action. |
| <!-- atlas:n8n 5S4JyVVR2CpHEv9b -->[`5S4JyVVR2CpHEv9b`](https://synchrosocial.app.n8n.cloud/workflow/5S4JyVVR2CpHEv9b) | Filming Plan Tabs | Disabled; retained, no ordinary deployment or off-date action. |
| <!-- atlas:n8n fJNyB5fNCRSTYNfQ -->[`fJNyB5fNCRSTYNfQ`](https://synchrosocial.app.n8n.cloud/workflow/fJNyB5fNCRSTYNfQ) | Project Central, Inspect (debug) | Disabled; retained, no ordinary deployment or off-date action. |
| <!-- atlas:n8n 6yhqWsM8RT2c7AOp -->[`6yhqWsM8RT2c7AOp`](https://synchrosocial.app.n8n.cloud/workflow/6yhqWsM8RT2c7AOp) | Private one-time maintenance task | Disabled; retained, no ordinary deployment or off-date action. |
| <!-- atlas:n8n Nk3pwR6Fbl4VAPqH -->[`Nk3pwR6Fbl4VAPqH`](https://synchrosocial.app.n8n.cloud/workflow/Nk3pwR6Fbl4VAPqH) | SyncView Calendar, Linear Sub-Issues | Disabled; retained, no ordinary deployment or off-date action. |
| <!-- atlas:n8n VAqlVLk8wczPq6DQ -->[`VAqlVLk8wczPq6DQ`](https://synchrosocial.app.n8n.cloud/workflow/VAqlVLk8wczPq6DQ) | AI WORKFLOW | Disabled; retained, no ordinary deployment or off-date action. |
| <!-- atlas:n8n vb3O0wkTK6Q7Rtro -->[`vb3O0wkTK6Q7Rtro`](https://synchrosocial.app.n8n.cloud/workflow/vb3O0wkTK6Q7Rtro) | BACKUPS | Disabled; retained, no ordinary deployment or off-date action. |
| <!-- atlas:n8n 84679Qq5zhVqXfPQ -->[`84679Qq5zhVqXfPQ`](https://synchrosocial.app.n8n.cloud/workflow/84679Qq5zhVqXfPQ) | Temporary text preview and delivery check (throwaway) | Disabled; marked for deletion by its own name. |


### Historical IDs still mentioned in truth

These are absent from the current full live list (re-checked 2026-10-29). They remain linked because the truth register preserves old execution and rollback receipts.


| Historical workflow | Evidence and state |
| --- | --- |
| <!-- atlas:n8n 19ZqxaOt09KPLGx1 -->[`19ZqxaOt09KPLGx1`](truth/N8N.md) | Absent from current live census; retained documentary history. |
| <!-- atlas:n8n 6OtjILbhkYLY6yVE -->[`6OtjILbhkYLY6yVE`](truth/N8N.md) | Absent from current live census; retained documentary history. |
| <!-- atlas:n8n BKl9OFVMb4VS2IHf -->[`BKl9OFVMb4VS2IHf`](truth/N8N.md) | Absent from current live census; retained documentary history. |
| <!-- atlas:n8n CdCYzye6Khp6x5A6 -->[`CdCYzye6Khp6x5A6`](truth/N8N.md) | Absent from current live census; retained documentary history. |
| <!-- atlas:n8n DBQvKxonjhTt7rKC -->[`DBQvKxonjhTt7rKC`](truth/N8N.md) | Absent from current live census; retained documentary history. |
| <!-- atlas:n8n FPQo6G2zi8WcIfa1 -->[`FPQo6G2zi8WcIfa1`](truth/N8N.md) | Absent from current live census; retained documentary history. |
| <!-- atlas:n8n MJbMZ789B5ExZz9x -->[`MJbMZ789B5ExZz9x`](truth/N8N.md) | Absent from current live census; retained documentary history. |
| <!-- atlas:n8n ZJOtYpQZj73DcBB1 -->[`ZJOtYpQZj73DcBB1`](truth/N8N.md) | Absent from current live census; retained documentary history. |
| <!-- atlas:n8n lGwC9WWPVJtxphtf -->[`lGwC9WWPVJtxphtf`](truth/N8N.md) | Absent from current live census; retained documentary history. |
| <!-- atlas:n8n wP0yLVDIOJph1bcM -->[`wP0yLVDIOJph1bcM`](truth/N8N.md) | Absent from current live census; retained documentary history. |
| <!-- atlas:n8n xEhLpKwNv8uTaeAK -->[`xEhLpKwNv8uTaeAK`](truth/N8N.md) | Not a workflow: the ID of the n8n data table `booking_recovery` (read live by Kasper Ad Performance, Daily Pull on 2026-10-29); the truth register lists it with absent workflow IDs. |

## Google Sheets

Verified 2026-10-29 against main 45c88a8 and the live catalog (read-only). The workbook tab lists below are from the last metadata read (2026-10-02, [remaining map](plans/2026-10-03-sheets-remaining-map.md)); tab existence was not re-read on 2026-10-29 (unverified 2026-10-29). Readers and writers were re-checked against source, live flags and the n8n active list.

Workbook metadata was read without cell values. IDs, private workbook titles, client tab names and share URLs are deliberately absent from this public map. The [Sheets truth page](truth/SHEETS.md), [move plan](plans/2026-09-24-sheets-to-supabase.md), [roster plan](plans/2026-10-02-roster-native.md) and [remaining map](plans/2026-10-03-sheets-remaining-map.md) own deeper context. Metadata proves a tab exists; it does not prove that a human still uses it.

The main SyncView workbook has **20 tabs** (as of 2026-10-02). Browser readers below come from [config](../src/index/040-shared-briefs.js.part) and [loaders](../src/index/040-shared-briefs.js.part); n8n owners link to the active registry above. **Client info lives in SyncView's database (`client_profiles`), not the Sheet**: live `client_profiles_authority` is `{"source":"syncview"}` since 2026-10-02, and `analytics_mirror_read_enabled` is `{"roster":"database","enabled":true}`, so the browser's client list and analytics numbers read the database. Clients Info and Social Media Managers are a **copy**: `roster-write`, `client-profile-write` and `client-onboarding` queue each change in `roster_sheet_outbox` and send it ([sheet copy](../supabase/functions/_shared/roster-sheet-copy.mjs)). The queue is only sent when one of those functions runs (or `roster-write`'s `copy_to_sheet` action is called); nothing sends it on a timer, and a direct RPC edit leaves the Sheet behind until the next such request. Analytics collection is paused by owner decision (2026-10-06): CLIENTS METRICS and TOP VIDEOS are inactive in n8n and their replacement jobs' switches are `off`.


| Main workbook tab | Readers and writers | Move status and owner evidence |
| --- | --- | --- |
| `Clients Info` | Written only as a copy of `client_profiles` by roster-write, client-profile-write and client-onboarding (outbox, sent on request). Append Client Row now calls roster-write. Browser roster reads the database. `clients-roster-sync` still reads the tab daily to set `clients.active`; daily mirror parity compares it. | Database is the authority since 2026-10-02 (`client_profiles_authority` = `syncview`); the tab is a read-only copy. The daily copy skips it. [Roster plan](plans/2026-10-02-roster-native.md) |
| `Videographer Contact` | Retained contacts tab; no enabled active-graph caller found. | Human use unverified; no confirmed cutover. [Reader and writer registry](#n8n) |
| `Legacy Clients` | Retained historical roster; no enabled active-graph caller found. | Human use unverified; preserved. [Reader and writer registry](#n8n) |
| `Social Media Managers` | Written as a copy of the database's manager assignments by the same three functions. Manager Sync is inactive; the browser review queue's managers come from `smm-weekly-reports`. | Database primary; tab is a copy. `roster-managers-parity` runs in the daily mirror lane. [Reader and writer registry](#n8n) |
| `Competitors` | Retained competitor reference; no enabled active-graph caller found. | Human use unverified; preserved. [Reader and writer registry](#n8n) |
| `Old_Clients` | Retained historical roster; no enabled active-graph caller found. | Human use unverified; preserved. [Reader and writer registry](#n8n) |
| `Monthly Checkup` | Monthly Check-in (active) reads it for client emails. | Outside analytics move; retained. [Reader and writer registry](#n8n) |
| `Metrics` | Browser analytics reads the database mirror; Sheet URL kept as fallback. CLIENTS METRICS (its writer) is inactive. | Analytics paused 2026-10-06; replacement `analytics-metrics-collect` switch `off`. Mirror holds the rows. [Reader and writer registry](#n8n) |
| `PostTracking` | Was read and updated by CLIENTS METRICS, now inactive. | Paused with analytics; native `analytics_post_tracking` exists. [Reader and writer registry](#n8n) |
| `TopVideos` | Browser analytics reads the database mirror; Sheet fallback kept. TOP VIDEOS (its writer) is inactive. | Analytics paused 2026-10-06; replacement `analytics-top-videos-collect` switch `off`. [Reader and writer registry](#n8n) |
| `ContentSummaries` | Optional browser fallback; MARKET RESEARCH writer branch is disabled. | Mirror table exists; no enabled content-summary writer found. [Reader and writer registry](#n8n) |
| `Competitor Briefs` | Old generator and browser download removed; retained tab exists. | Retired by owner; not migrating. [Reader and writer registry](#n8n) |
| `Market Research Briefs` | Browser Brief fallback; MARKET RESEARCH (active) webhook branches write it. | Mirror table exists; writer still on the Sheet. [Reader and writer registry](#n8n) |
| `CaptionPrompts` | Caption Prompts Get (active) reads it. Caption Prompts Save is inactive; `caption-prompts-save` writes the native table only. Browser uses native table first. | Sheet no longer written; Get stays fallback. [Reader and writer registry](#n8n) |
| `Video Editors` | VIDEO PRODUCTION AUTOMATION (active) reads editor assignment rows. | Outside analytics move; retained. [Reader and writer registry](#n8n) |
| `Templates` | Retained compatibility tab; current browser and templates-save use native templates. | Native primary copy; no enabled graph writer found. [Reader and writer registry](#n8n) |
| `Hook Library` | MARKET RESEARCH (active) appends generated hooks. | Outside analytics move; retained. [Reader and writer registry](#n8n) |
| `Linear Submissions` | VIDEO PRODUCTION AUTOMATION retains intake receipt branch. | Native production authority is on; Linear functions deleted 2026-09-24; retained branch does not prove current Linear writes. [Reader and writer registry](#n8n) |
| `TikTokUpload` | No current writer: TikTok upload is native since 2026-10-07 (`tiktok_upload_source` = `supabase`, `tiktok-upload` function, `tiktok_uploads` table); all seven n8n TikTok Upload workflows, including Result, are inactive. | Retained history; Instagram uses native `instagram_uploads`. [Reader and writer registry](#n8n) |
| `FilmingPlans` | Retained plan tab; browser and filming-plans use native filming_plans. | Native primary copy; no enabled graph writer found. [Reader and writer registry](#n8n) |


### Other workbooks and dynamic tabs


| Workbook family | Tabs and readers or writers | Move status |
| --- | --- | --- |
| Calendar mirror | 64 tabs (as of 2026-10-02; unverified 2026-10-29): one hidden `Sheet1`, 32 private `Calendar_<client>` tabs and 31 private `Samples_<client>` tabs. Every n8n Calendar workflow (Get, Upsert Post, Append, Delete, Reorder, Provision) is inactive; the browser saves through `calendar-card-write` and `calendar-upsert`. Samples reads and writes use Supabase. [Owners](#n8n) | No live writer found 2026-10-29; tabs retained as history. Individual human use unverified. |
| Video automation workbook | 18 private client tabs, metadata verified 2026-10-02. VIDEO PRODUCTION AUTOMATION references the workbook; individual tab usage was not closed. [Owner](#n8n) | Retained legacy intake material; no blanket migration claim. |
| Project Central workbook | `Projects`, `Areas`, `Items` were graph references for the Project Central Sheet API workflow, which is inactive. Metadata read returned 403. [Owner](#n8n) | Outside the analytics move. Tab existence and human use unverified. |
| Client Ideas workbooks | Caller-selected workbooks and tabs used by the three publish or append workflows and `pipeline-google`. [Writer rules](https://github.com/sidney-afk/synchro-pipelines/blob/main/GOOGLE_WRITES.md) | Dynamic inventory cannot be exhaustively resolved from static graphs; not part of analytics retirement. |


## Scheduled jobs

Verified 2026-10-29 against main 45c88a8 and the live catalog (read-only).

These are configured triggers, not guarantees that recent runs succeeded. [Monitoring map](ops/MONITORING.md) and [Open repairs](ops/OPEN_REPAIRS.md) own operational receipts. Every active n8n timer is shown in [the active table](#n8n). Workflow-local timezone and unresolved defaults are recorded there.

### Database jobs

**26 live jobs, all active** (`select jobname, schedule, active from cron.job`, read 2026-10-29). Cron clock interpretation is UTC; recent execution success was not audited. A job calling a switched-off feature still fires, and the function answers "skipped".


| Job | Schedule | What it does and source |
| --- | --- | --- |
| `gh-dispatch-<workflow>` (17 jobs) | Same cron as each workflow's own `schedule:` | Starts the 17 timed GitHub workflows on time through the workflow_dispatch API (below). One job each for alert-digest, assurance-ledger-freshness, calendar-e2e-nightly, card-calendar-status-drift, clients-roster-sync, dawn-check, n8n-execution-quota-watchdog, native-intake-completion, native-intake-completion-monitor, native-notification-monitor, native-notification-sender, production-polish-gate, rename-propagation-drain, samples-e2e-nightly, sheets-mirror-daily, thumbnail-revision-scan, track-b-backup. [SQL source](../migrations/2026-10-09-github-workflow-dispatch-timer.sql) |
| `monitoring-watchdog-tick` | `*/15 * * * *` | Calls `monitoring-watchdog-tick`: the dead-man's switch check, writes the `monitoring_watchdog` heartbeat and pages through the n8n alert relay. [SQL source](../migrations/2026-10-09-monitoring-watchdog-tick-schedule.sql) |
| `thumbnail-titles-tick` | Every minute | Calls `thumbnail-titles` only when `thumbnail_titles_tick_needed()`; switch `thumbnail_titles` is on for every client. [SQL source](../migrations/2026-10-09-thumbnail-titles.sql) |
| `calendar-auto-posted-tick` | `*/15 * * * *` | Calls `calendar-auto-posted`: a Scheduled post turns Posted once its day has ended (US Eastern); switch `calendar_auto_posted` is on for every client. [SQL source](../migrations/2026-10-10-calendar-auto-posted.sql) |
| `analytics-metrics-collect-tick` | `* 4-8 * * *` | Calls `analytics-metrics-collect` "tick"; inert while switch `analytics_metrics_collect` is `off` (analytics paused 2026-10-06). [SQL source](../migrations/2026-10-01-analytics-metrics-collect-schedule.sql) |
| `analytics-top-videos-collect-tick` | `* 8-12 * * *` | Calls `analytics-top-videos-collect` "tick"; inert while switch `analytics_top_videos_collect` is `off`. [SQL source](../migrations/2026-10-02-analytics-top-videos-collect-schedule.sql) |
| `analytics-top-videos-collect-prune` | `47 3 * * *` | Drops Top Videos queue rows older than 14 days and shadow rows older than 30. [SQL source](../migrations/2026-10-02-analytics-top-videos-collect-schedule.sql) |
| `workload-snapshot-warm` | Every 10 seconds | Warms native workload snapshot. [SQL source](../migrations/2026-09-23-workload-native-snapshot-server-warm.sql) |
| `workload-snapshot-warm-history` | `17 3 * * *` | Removes this warmer's cron history older than one day. [SQL source](../migrations/2026-09-23-workload-native-snapshot-server-warm.sql) |
| `write-refusal-retention-daily` | `17 4 * * *` | Runs production_write_refusal_retention_daily_v1 for bounded diagnostic retention. [SQL source](../supabase/migrations/20260927200000_write_refusal_detail_and_viewer.sql) |
| Not live (in repo only) | — | Defined in migrations but absent from the live catalog on 2026-10-29: `analytics-metrics-collect-prune`, `analytics-market-research-collect-tick` and `-prune`, `analytics-collect-check-metrics` and `-top-videos`, `client-hubspot-sync-daily`. [Market research timer](../migrations/2026-10-02-analytics-market-research-collect-schedule.sql); [HubSpot timer](../migrations/2026-10-04-client-hubspot-sync-schedule.sql) |


### GitHub Actions

There are **54 workflow files** in this checkout. The GitHub catalog includes additional historical entries with no current file; catalog presence alone is not a runnable source or a deployment. Cron expressions below use UTC. Repository variable states quoted below come from the files' own comments; the variables were not readable from this session (unverified 2026-10-29). Manual evidence workflows can write data when dispatched; this session dispatched none.


| Workflow file | Trigger and schedule | Purpose |
| --- | --- | --- |
| <!-- atlas:action .github/workflows/alert-digest.yml -->[`alert-digest.yml`](../.github/workflows/alert-digest.yml) | Manual, Push, Cron `47 * * * *` (database timer) | Builds the one combined problem message; posts only if the `ALERT_DIGEST_ENABLED` variable is `true` (unset per the file's comment, so shadow). |
| <!-- atlas:action .github/workflows/assurance-ledger-freshness.yml -->[`assurance-ledger-freshness.yml`](../.github/workflows/assurance-ledger-freshness.yml) | Manual, Push, Cron `37 7 * * *` (database timer) | Checks evidence ledger age. |
| <!-- atlas:action .github/workflows/calendar-e2e-nightly.yml -->[`calendar-e2e-nightly.yml`](../.github/workflows/calendar-e2e-nightly.yml) | Manual, Cron `0 8 * * *` (database timer) | Runs Calendar browser journeys. |
| <!-- atlas:action .github/workflows/calendar-upsert-live-delta.yml -->[`calendar-upsert-live-delta.yml`](../.github/workflows/calendar-upsert-live-delta.yml) | Manual only (typed confirmation, production environment) | Deploys the one auto-posted line onto a downloaded LIVE copy of `calendar-upsert` (never the repo source), verifies by hash and verify_jwt false, rolls back on failure; reports "already applied" when live already carries it. OPEN_REPAIRS 402. |
| <!-- atlas:action .github/workflows/calendar-unit-tests.yml -->[`calendar-unit-tests.yml`](../.github/workflows/calendar-unit-tests.yml) | Manual, Push (main), Pull request | Runs unit inventory and source checks, including atlas-sync; browser jobs split into parallel parts. |
| <!-- atlas:action .github/workflows/card-calendar-status-drift.yml -->[`card-calendar-status-drift.yml`](../.github/workflows/card-calendar-status-drift.yml) | Manual, Push, Cron `27 * * * *` (database timer) | Reads native card and Calendar status drift. |
| <!-- atlas:action .github/workflows/client-entry-visible-boot.yml -->[`client-entry-visible-boot.yml`](../.github/workflows/client-entry-visible-boot.yml) | Manual, Push, Pull request | Checks client entry render without exposing private links. |
| <!-- atlas:action .github/workflows/client-signoff-reconcile.yml -->[`client-signoff-reconcile.yml`](../.github/workflows/client-signoff-reconcile.yml) | Manual | Reconciles client review receipts into native state. |
| <!-- atlas:action .github/workflows/clients-roster-sync.yml -->[`clients-roster-sync.yml`](../.github/workflows/clients-roster-sync.yml) | Manual, Cron `41 6 * * *` (database timer) | Reads the Clients Info tab (itself a copy of `client_profiles`) and sets `clients.active` to match; dry run unless `CLIENTS_ROSTER_SYNC_APPLY` is `true`. |
| <!-- atlas:action .github/workflows/crosswalk-phase2-repair.yml -->[`crosswalk-phase2-repair.yml`](../.github/workflows/crosswalk-phase2-repair.yml) | Manual | Runs owner-gated crosswalk repair. |
| <!-- atlas:action .github/workflows/dawn-check.yml -->[`dawn-check.yml`](../.github/workflows/dawn-check.yml) | Manual, Cron `30 11 * * 1-5` (database timer) | Checks health and reports owner alerts. |
| <!-- atlas:action .github/workflows/deploy-client-review-link.yml -->[`deploy-client-review-link.yml`](../.github/workflows/deploy-client-review-link.yml) | Manual | Deploys `client-review-link` after production Environment approval, with readback; see owner release lanes below. |
| <!-- atlas:action .github/workflows/deploy-edge-functions-on-merge.yml -->[`deploy-edge-functions-on-merge.yml`](../.github/workflows/deploy-edge-functions-on-merge.yml) | Manual, Push (main, function paths) | Deploys every Edge Function a merge changed, in order, with the manual lanes' checks; dispatches the Section 4 lane for its three; holds a function whose migration is not applied. Runbook `docs/ops/EF_AUTO_DEPLOY.md`. |
| <!-- atlas:action .github/workflows/deploy-description-image-upload.yml -->[`deploy-description-image-upload.yml`](../.github/workflows/deploy-description-image-upload.yml) | Manual | Manual fallback since 2026-10-16 (merges deploy through `deploy-edge-functions-on-merge.yml`); see owner release lanes below. |
| <!-- atlas:action .github/workflows/deploy-f27-section4-closures.yml -->[`deploy-f27-section4-closures.yml`](../.github/workflows/deploy-f27-section4-closures.yml) | Manual (dispatched on merge by `deploy-edge-functions-on-merge.yml`) | Captures and seals the live three into the rollback bundle in the run, stores and verifies it, then deploys; see owner release lanes below. |
| <!-- atlas:action .github/workflows/deploy-hiring-applications.yml -->[`deploy-hiring-applications.yml`](../.github/workflows/deploy-hiring-applications.yml) | Manual | Deploys the function set in its source; see owner release lanes below. |
| <!-- atlas:action .github/workflows/deploy-hiring-automation.yml -->[`deploy-hiring-automation.yml`](../.github/workflows/deploy-hiring-automation.yml) | Manual | Exact-SHA release of the private n8n hiring bridge; see owner release lanes below. |
| <!-- atlas:action .github/workflows/deploy-onboarding-edge-functions.yml -->[`deploy-onboarding-edge-functions.yml`](../.github/workflows/deploy-onboarding-edge-functions.yml) | Manual | Manual fallback since 2026-10-16 for the onboarding, credentials, filming-plan and SMM-report functions (merges deploy through `deploy-edge-functions-on-merge.yml`); see owner release lanes below. |
| <!-- atlas:action .github/workflows/deploy-pto-edge-functions.yml -->[`deploy-pto-edge-functions.yml`](../.github/workflows/deploy-pto-edge-functions.yml) | Manual | Manual fallback since 2026-10-16 (merges deploy through `deploy-edge-functions-on-merge.yml`); see owner release lanes below. |
| <!-- atlas:action .github/workflows/deploy-single-function.yml -->[`deploy-single-function.yml`](../.github/workflows/deploy-single-function.yml) | Manual | Deploys one function from a fixed allowlist at an exact main commit, then attests it; refuses the Section 4 three and the frozen `calendar-upsert` and `sample-review-upsert`. |
| <!-- atlas:action .github/workflows/deploy-thumbnail-edge-functions.yml -->[`deploy-thumbnail-edge-functions.yml`](../.github/workflows/deploy-thumbnail-edge-functions.yml) | Manual | Manual fallback since 2026-10-16 (merges deploy through `deploy-edge-functions-on-merge.yml`); see owner release lanes below. |
| <!-- atlas:action .github/workflows/edge-function-type-ratchet.yml -->[`edge-function-type-ratchet.yml`](../.github/workflows/edge-function-type-ratchet.yml) | Push, Pull request | Ratchets edge TypeScript validation. |
| <!-- atlas:action .github/workflows/f27-post-contract-capture.yml -->[`f27-post-contract-capture.yml`](../.github/workflows/f27-post-contract-capture.yml) | Manual | Captures private F27 deploy closure evidence. |
| <!-- atlas:action .github/workflows/f27-team-rollback-proof.yml -->[`f27-team-rollback-proof.yml`](../.github/workflows/f27-team-rollback-proof.yml) | Manual, Pull request | Runs private F27 team rollback proof. |
| <!-- atlas:action .github/workflows/f42-apply-rehearsal.yml -->[`f42-apply-rehearsal.yml`](../.github/workflows/f42-apply-rehearsal.yml) | Manual, Pull request | Runs owner-gated F42 apply rehearsal. |
| <!-- atlas:action .github/workflows/f42-card-comment-import.yml -->[`f42-card-comment-import.yml`](../.github/workflows/f42-card-comment-import.yml) | Manual | Imports approved historical card comments. |
| <!-- atlas:action .github/workflows/higgsfield-catalog-watch.yml -->[`higgsfield-catalog-watch.yml`](../.github/workflows/higgsfield-catalog-watch.yml) | Manual (no schedule; run by hand or by the Connector supervisor's daily check) | Compares the connector's model list with Higgsfield's live docs and goes red on any difference. |
| <!-- atlas:action .github/workflows/review-note-backfill.yml -->[`review-note-backfill.yml`](../.github/workflows/review-note-backfill.yml) | Manual | Adds client review-page notes missing from the comment store, or rolls a run back; dry run by default. |
| <!-- atlas:action .github/workflows/graphics-f2-evidence.yml -->[`graphics-f2-evidence.yml`](../.github/workflows/graphics-f2-evidence.yml) | Manual, Pull request | Captures private graphics evidence. |
| <!-- atlas:action .github/workflows/graphics-f2-preflight.yml -->[`graphics-f2-preflight.yml`](../.github/workflows/graphics-f2-preflight.yml) | Manual | Runs graphics read-only preflight. |
| <!-- atlas:action .github/workflows/linear-deliverables-reconcile.yml -->[`linear-deliverables-reconcile.yml`](../.github/workflows/linear-deliverables-reconcile.yml) | Manual (schedule commented out 2026-09-20) | Retained Linear reconciliation lane; dry run by default. |
| <!-- atlas:action .github/workflows/linear-exit-preparation-ci.yml -->[`linear-exit-preparation-ci.yml`](../.github/workflows/linear-exit-preparation-ci.yml) | Pull request | Runs isolated Linear-exit preparation proofs. |
| <!-- atlas:action .github/workflows/linear-outbound-drain.yml -->[`linear-outbound-drain.yml`](../.github/workflows/linear-outbound-drain.yml) | Manual, Repository dispatch (schedule commented out 2026-09-20) | Retained outbound lane; the Linear sync functions were deleted 2026-09-24. |
| <!-- atlas:action .github/workflows/monitoring-crosscheck.yml -->[`monitoring-crosscheck.yml`](../.github/workflows/monitoring-crosscheck.yml) | Manual, Cron `*/20 * * * *` (GitHub schedule only) | Second dead-man's switch host; crosschecks monitoring inputs. |
| <!-- atlas:action .github/workflows/monitoring-cutover-proof.yml -->[`monitoring-cutover-proof.yml`](../.github/workflows/monitoring-cutover-proof.yml) | Manual | Now named "TEST cleanup and roster coverage": `roster` lane is read-only team coverage; `cleanup` disposes of crashed-drill TEST residue. |
| <!-- atlas:action .github/workflows/monitoring-deadman.yml -->[`monitoring-deadman.yml`](../.github/workflows/monitoring-deadman.yml) | Manual, Cron `*/15 * * * *` (GitHub schedule only) | Checks missed monitoring heartbeat; independent of the database timer. |
| <!-- atlas:action .github/workflows/n8n-execution-quota-watchdog.yml -->[`n8n-execution-quota-watchdog.yml`](../.github/workflows/n8n-execution-quota-watchdog.yml) | Manual, Cron `17 13 * * *` (database timer) | Reads n8n execution quota and alerts. |
| <!-- atlas:action .github/workflows/native-intake-completion-monitor.yml -->[`native-intake-completion-monitor.yml`](../.github/workflows/native-intake-completion-monitor.yml) | Manual, Cron `12,27,42,57 * * * *` (database timer) | Checks native intake completion health. |
| <!-- atlas:action .github/workflows/native-intake-completion.yml -->[`native-intake-completion.yml`](../.github/workflows/native-intake-completion.yml) | Manual, Cron `5,20,35,50 * * * *` (database timer) | Drains admitted native intake jobs. |
| <!-- atlas:action .github/workflows/native-notification-monitor.yml -->[`native-notification-monitor.yml`](../.github/workflows/native-notification-monitor.yml) | Manual, Cron `2-59/5 * * * *` (database timer) | Checks notification delivery health. |
| <!-- atlas:action .github/workflows/native-notification-preview.yml -->[`native-notification-preview.yml`](../.github/workflows/native-notification-preview.yml) | Manual | Previews notifications without sending. |
| <!-- atlas:action .github/workflows/native-notification-sender.yml -->[`native-notification-sender.yml`](../.github/workflows/native-notification-sender.yml) | Manual, Cron `*/5 * * * *` (database timer) | Sends admitted native notifications when its enable variable is true. |
| <!-- atlas:action .github/workflows/pages-site.yml -->[`pages-site.yml`](../.github/workflows/pages-site.yml) | Manual, Push, Pull request | Builds index and publishes GitHub Pages for matching source paths. |
| <!-- atlas:action .github/workflows/production-polish-gate.yml -->[`production-polish-gate.yml`](../.github/workflows/production-polish-gate.yml) | Manual, Push, Pull request, Cron `17 9 * * 1-5` (database timer) | Runs production visual and interaction gate. |
| <!-- atlas:action .github/workflows/pto-ui-tests.yml -->[`pto-ui-tests.yml`](../.github/workflows/pto-ui-tests.yml) | Manual, Push, Pull request | Runs PTO browser checks. |
| <!-- atlas:action .github/workflows/rename-propagation-drain.yml -->[`rename-propagation-drain.yml`](../.github/workflows/rename-propagation-drain.yml) | Manual, Cron `*/5 * * * *` (database timer) | Drains admitted rename propagation jobs. |
| <!-- atlas:action .github/workflows/samples-e2e-nightly.yml -->[`samples-e2e-nightly.yml`](../.github/workflows/samples-e2e-nightly.yml) | Manual, Cron `0 6 * * *` (database timer) | Runs Samples browser journeys. |
| <!-- atlas:action .github/workflows/schedule-fallback-guard.yml -->[`schedule-fallback-guard.yml`](../.github/workflows/schedule-fallback-guard.yml) | Called by the 17 timer-dispatched workflows | First job of each: on a GitHub schedule run it stands the run down when the database timer already started that slot, so a job runs once; when the timer missed, the run goes ahead (OPEN_REPAIRS 403). With `mirror_timer_failure` a stand-down goes red when the timer's run was red (OPEN_REPAIRS 505 to 507). |
| <!-- atlas:action .github/workflows/sheets-mirror-daily.yml -->[`sheets-mirror-daily.yml`](../.github/workflows/sheets-mirror-daily.yml) | Manual, Cron `23 9 * * *` (database timer) | Copies analytics tabs into the mirror (skips Clients Info, which the database owns, and any dataset whose job is live), then strict parity including Clients Info and managers; copy is a dry run unless `SHEETS_MIRROR_COPY_APPLY` is `true`. |
| <!-- atlas:action .github/workflows/thumbnail-revision-scan.yml -->[`thumbnail-revision-scan.yml`](../.github/workflows/thumbnail-revision-scan.yml) | Manual, Cron `*/10 * * * *` (database timer) | Scans admitted thumbnail revisions. |
| <!-- atlas:action .github/workflows/tiktok-carousel-browser-journey.yml -->[`tiktok-carousel-browser-journey.yml`](../.github/workflows/tiktok-carousel-browser-journey.yml) | Manual, Push, Pull request | Runs provider upload browser journey. |
| <!-- atlas:action .github/workflows/track-b-backup.yml -->[`track-b-backup.yml`](../.github/workflows/track-b-backup.yml) | Manual, Cron `23 */6 * * *` (database timer) | Creates encrypted private backup evidence. |
| <!-- atlas:action .github/workflows/track-b-recovery-rehearsal.yml -->[`track-b-recovery-rehearsal.yml`](../.github/workflows/track-b-recovery-rehearsal.yml) | Manual | Rehearses restoration in isolated targets. |
| <!-- atlas:action .github/workflows/workload-source-freshness.yml -->[`workload-source-freshness.yml`](../.github/workflows/workload-source-freshness.yml) | Manual | Checks native workload source freshness. |


The database timer ([migrations/2026-10-09-github-workflow-dispatch-timer.sql](../migrations/2026-10-09-github-workflow-dispatch-timer.sql), OPEN_REPAIRS 388) is **live**: 17 `gh-dispatch-*` jobs were active on 2026-10-29. It dispatches every scheduled workflow marked "database timer" above through GitHub's workflow_dispatch API at its own cron, because GitHub runs `schedule:` crons hours late; the two dead-man hosts are left on GitHub's own schedule as the independent observer. Each dispatched workflow keeps its `schedule:` block as the fallback, and its first job ([schedule-fallback-guard.yml](../.github/workflows/schedule-fallback-guard.yml)) lets that late copy run only when the timer missed the slot. It replaced the resident `lane-ticker.yml`, deleted 2026-10-09. Owner variables and concurrency gates still control each dispatched lane.


| Other repo workflow | Trigger | Purpose |
| --- | --- | --- |
| [check-brain](https://github.com/sidney-afk/synchro-brain/blob/main/.github/workflows/check-brain.yml) | Main push and pull request | Validates private knowledge files. (unverified 2026-10-29) |
| [process-syncview-change](https://github.com/sidney-afk/synchro-brain/blob/main/.github/workflows/process-syncview-change.yml) | Change-file push and manual | Claude processes admitted SyncView knowledge edits; writes private repo. (unverified 2026-10-29) |
| [atlas-freshness](https://github.com/sidney-afk/synchrosocial/blob/main/.github/workflows/atlas-freshness.yml) | Monday `0 9 * * 1`, Atlas path push and manual | Checks the marketing Atlas. (unverified 2026-10-29) |
| [deploy](https://github.com/sidney-afk/synchrosocial/blob/main/.github/workflows/deploy.yml) | Main push and manual | Builds marketing dist and publishes GitHub Pages. (unverified 2026-10-29) |


Synchro Pipelines had no workflow files at its pinned tree (last checked 2026-09-30; unverified 2026-10-29). Supabase and n8n schedules were inventoried separately above.


## Outside services

Verified 2026-10-29 against main 45c88a8 and the live catalog (read-only).

These purposes are source or active-graph references. Credential existence and enabled nodes are not proof that a paid provider or revoked credential works today.


| Service | Used for and owner |
| --- | --- |
| Post For Me | TikTok upload, status and result webhook via the native [TikTok function](../supabase/functions/tiktok-upload/index.ts) since 2026-10-07 (all n8n TikTok workflows inactive); Instagram Reels, carousels and trial reels via the native [Instagram function](../supabase/functions/instagram-upload/index.ts), account id from `client_profiles.extra.postforme_instagram_account_id` (set through roster-write). |
| Frame.io | Video assets, review media and production automation; login kept by [frameio-token](../supabase/functions/frameio-token/index.ts), "Watch here" playback and comments read by [frameio-view](../supabase/functions/frameio-view/index.ts). [Provider endpoints](truth/ENDPOINTS.md). |
| Replicate | Caption audio transcription (Whisper) in the native [caption function](../supabase/functions/caption-generate/index.ts), which runs every caption since 2026-10-09; n8n Generate Caption is inactive. Retained editor AI calls in n8n. |
| Apify | Market research scraping in n8n; Frame.io lookup fallback in the caption function; the metrics and top-video scrapers are paused with analytics (2026-10-06). [Scraper owners](#n8n). |
| ScrapeCreators | Filming plan research (TikTok, YouTube Shorts, Reddit, transcripts) through [pipeline-social](../supabase/functions/pipeline-social/index.ts). |
| Anthropic | Caption writing in the native caption function; research and production text generation in n8n; private Brain edit worker. [Worker](https://github.com/sidney-afk/synchro-brain/blob/main/.github/workflows/process-syncview-change.yml). |
| Slack | Creative channels, owner error alerts, client review alerts and native notification delivery. [Native sender](../supabase/functions/notify/index.ts); [Notify client](../supabase/functions/client-review-alert/index.ts); [workflow owners](#n8n). |
| Google | Sheets copies of the roster (sent by roster-write and its siblings) and retained analytics tabs, Drive assets and backups, Docs filming plans ([pipeline-google](../supabase/functions/pipeline-google/index.ts)), Gmail onboarding and sales mail, read-only Gmail headers for Leads ([crm-gmail](../supabase/functions/crm-gmail/index.ts)), YouTube analytics. [Write boundaries](https://github.com/sidney-afk/synchro-pipelines/blob/main/GOOGLE_WRITES.md). |
| HubSpot | Sales contacts, booking state, contract and payment gates, ad attribution in n8n; each client's deal, contract and payment state read by [client-hubspot-sync](../supabase/functions/client-hubspot-sync/index.ts) (its daily timer is not in the live catalog). [Sales handlers](#n8n). |
| Meta | Facebook ads and conversions, Instagram provider account connection. [Ad pull and CAPI](#n8n). |
| Twilio and Telegram | Sales SMS and booking alert relays. [Recovery handlers](#n8n). |
| iClosed, Calendly, Stripe, eSignatures and Commas | Booking and application signals, invoices and contract signatures. [Event handlers](#n8n). |
| Notion and Arketa | Arketa membership reporting (active). The Notion onboarding poller is inactive in n8n (read 2026-10-29). [Active owners](#n8n). |
| Higgsfield, OpenAI and Google AI | Editor asset generation and model helpers. [Editor function](../supabase/functions/higgsfield-mcp/index.ts); [In-chat result viewer](../supabase/functions/higgsfield-mcp/viewer.ts). |
| Linear | Retained history only; native production is authoritative. The `linear-inbound` and `linear-outbound` functions were deleted from the live project on 2026-09-24; their source stays as a frozen reference with no deploy path. Linear is being cancelled. [Exit map](independence/SYSTEM_MAP.md). |

## Secret names and locations

Verified 2026-10-29 against main 45c88a8 (source and workflow references) and the live Supabase Vault and n8n credential lists (read-only). The GitHub and Supabase Edge secret name lists could not be re-read this session (the GitHub secrets API is not reachable from the session proxy and there is no read tool for Edge secrets); those two lists are the last live read and are marked so.

Names only. Values were never exported into this repo. Live inventories verify name presence, not usability. Supabase includes protected configuration slots as well as credentials. A name in source can be optional, obsolete or inherited; it is separated from configured names below. n8n login names are exact literals, including their punctuation; credential values and IDs are omitted.


| Location | Configured names |
| --- | --- |
| client-analytics GitHub repository secrets (last live read; unverified 2026-10-29) | `ANALYTICS_MIRROR_WRITE_KEY`, `LINEAR_API_KEY`, `N8N_API_KEY`, `N8N_QUOTA_ALERT_WEBHOOK`, `NATIVE_NOTIFICATION_NOTIFY_URL`, `NATIVE_NOTIFICATION_RUNNER_KEY`, `SLACK_ALERT_WEBHOOK`, `SUPABASE_ACCESS_TOKEN`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`, `SYNCVIEW_STAFF_ACTOR`, `SYNCVIEW_STAFF_KEY`, `THUMBNAIL_REVISION_SCAN_KEY`, `TRACK_B_BACKUP_DATABASE_URL`, `TRACK_B_BACKUP_GOOGLE_CREDENTIALS_JSON`, `TRACK_B_BACKUP_HMAC_KEY`, `TRACK_B_RESTORE_DATABASE_URL` |
| client-analytics GitHub production environment (last live read; unverified 2026-10-29) | `B3_ACCELERATOR_DATABASE_URL`, `F27_PRIVATE_SHARED_DRIVE_ROOT_ID`, `GRAPHICS_F2_OWNER_DISPATCH_ATTESTATION`, `GRAPHICS_F2_READONLY_DATABASE_URL`, `LINEAR_MIRROR_API_KEY`, `ROLE_KEY_ADMIN`, `ROLE_KEY_CREATIVE`, `ROLE_KEY_SMM`, `SUPABASE_ACCESS_TOKEN`, `SUPABASE_SERVICE_ROLE_KEY`, `TRACK_B_BACKUP_GOOGLE_CREDENTIALS_JSON`. The merge lane and Section 4 lane run in this environment and use `SUPABASE_ACCESS_TOKEN`, `SLACK_ALERT_WEBHOOK`, `N8N_API_KEY`, `F27_PRIVATE_SHARED_DRIVE_ROOT_ID` and `TRACK_B_BACKUP_GOOGLE_CREDENTIALS_JSON` ([runbook](ops/EF_AUTO_DEPLOY.md)). |
| client-analytics GitHub github-pages environment | No environment secrets returned (last live read). |
| Supabase project Edge secrets (last live read; unverified 2026-10-29) | `ANALYTICS_MIRROR_WRITE_KEY`, `B4_TEST_PROJECT_BY_TEAM`, `B4_TEST_PROJECT_IDS`, `BRAIN_GITHUB_TOKEN`, `CLIENTS_INFO_SHEET_ID`, `CREDENTIALS_STAFF_KEY`, `GOOGLE_AI_KEY`, `GOOGLE_DRIVE_API_KEY`, `GOOGLE_SERVICE_ACCOUNT_JSON`, `GRAPHIC_TITLE_API_KEY`, `GRAPHIC_TITLE_MODEL`, `GRAPHIC_TITLE_PROMPT`, `HIGGSFIELD_KEY`, `HIRING_AUTOMATION_KEY`, `HIRING_INTERVIEW_EVENT_URL`, `HIRING_INTERVIEW_EVENT_URL_VIDEO_EDITOR`, `INSTAGRAM_UPLOAD_ALLOWED_CLIENTS`, `N8N_QUIZ_CAPTURE_SECRET`, `NOTIFY_FORMAT`, `NOTIFY_PREVIEW_SLACK_USER_ID`, `NOTIFY_RUNNER_KEY`, `NOTIFY_WAKE_ENABLED`, `ONBOARDING_STAFF_KEY`, `OPENAI_KEY`, `PIPELINE_GOOGLE_KEY`, `POST_FOR_ME_API_KEY`, `ROLE_KEY_ADMIN`, `ROLE_KEY_CREATIVE`, `ROLE_KEY_SMM`, `SLACK_ALERT_WEBHOOK`, `SLACK_BOT_TOKEN`, `SUPABASE_ANON_KEY`, `SUPABASE_DB_URL`, `SUPABASE_JWKS`, `SUPABASE_PUBLISHABLE_KEYS`, `SUPABASE_SECRET_KEYS`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`, `SYNCVIEW_WRITER_STAFF_KEY`, `THUMBNAIL_REVISION_SCAN_KEY`, `WRITE_DIAGNOSTICS_ENABLED`, `WRITE_DIAGNOSTICS_RUNNER_KEY` |
| Supabase Edge secrets required by functions added since that read | `ANALYTICS_COLLECT_KEY`, `ANTHROPIC_API_KEY`, `APIFY_TOKEN` (analytics collect jobs); `REPLICATE_API_TOKEN` (caption-generate); `AUPHONIC_KEY`, `ELEVENLABS_API_KEY` or `ELEVENLABS_KEY` (higgsfield-mcp studio); `CRM_SENDER_KEY` (crm-leads); `FRAMEIO_BROKER_KEY`, `FRAMEIO_CLIENT_ID`, `FRAMEIO_CLIENT_SECRET`, `FRAMEIO_LOGIN_EMAIL` (frameio-token, frameio-view); `HUBSPOT_READ_TOKEN`, `HUBSPOT_SYNC_KEY` (client-hubspot-sync); `MONITORING_WATCHDOG_KEY`, `MONITORING_ALERT_WEBHOOK` (monitoring-watchdog-tick); `ROSTER_SERVICE_KEY` (roster-read, roster-write); `SCRAPECREATORS_API_KEY` (pipeline-social); `TIKTOK_PFM_WEBHOOK_SECRET`, `TIKTOK_UPLOADS_SHEET_ID` (tiktok-upload); `THUMBNAIL_TITLES_API_KEY` (thumbnail-titles); `GEMINI_API_KEY`, `YOUTUBE_API_KEY` (unverified which are required). Their functions are live and in use, which implies most are set; name presence unverified 2026-10-29. |
| Supabase Vault (live read 2026-10-29) | `analytics_collect_key`, `calendar_auto_posted_key`, `github_dispatch_token`, `hubspot_sync_key`, `monitoring_watchdog_key`, `roster_service_key`, `thumbnail_titles_key` (the keys the pg_cron timers sign their calls with; the earlier "zero named rows" is no longer true). |
| synchro-brain GitHub repository | `CLAUDE_CODE_OAUTH_TOKEN` (last live read; unverified 2026-10-29). |
| synchro-pipelines and synchrosocial GitHub repository secrets | No repository secret names returned (last live read). Brain and Pipelines have no GitHub environments; marketing github-pages returns no secrets. All four repos belong to a personal account, so organization secret inheritance does not apply. |


Optional source-only settings with defaults (not secrets, absent from the configured list): `ANALYTICS_COLLECT_TICK_BUDGET_MS`, `AUPHONIC_USD_PER_HOUR`, `BRAIN_BRANCH`, `BRAIN_REPO`, `CALENDAR_AUTO_POSTED_ACTOR`, `CAPTION_MODEL`, `CLIENT_REVIEW_ALERT_LIVE`, `CLIENT_REVIEW_ALERT_ORIGIN`, `ELEVENLABS_STT_URL`, `ELEVENLABS_USD_PER_HOUR`, `GOOGLE_CLIENT_EMAIL`, `GOOGLE_PRIVATE_KEY` (alternative to `GOOGLE_SERVICE_ACCOUNT_JSON`), `HF_MONTHLY_CAP_USD`, `NOTIFY_URGENT_FORMAT`, `SB_REGION`, `THUMBNAIL_REVISION_MAX_BYTES`, `THUMBNAIL_TITLES_MODEL`; `LINEAR_MIRROR_API_KEY` is still read by source but Linear is retired. [Source owners](../supabase/functions/) describe defaults and required inputs. GitHub workflow secret references absent from both checked repo and production environment lists: `LINEAR_STATE_UUID_MAP`, `ROBOT_ROLE_KEY_ADMIN`, `ROBOT_ROLE_KEY_SMM` (nightly e2e and dawn check), `TRACK_B_RECOVERY_SOURCE_DATABASE_URL`, `TRACK_B_RECOVERY_TARGET_DATABASE_URL`. `SYNCVIEW_ROLE_KEY` is a job environment name the dawn check fills from the robot keys, not a secret. Configured names no current workflow file references: `B3_ACCELERATOR_DATABASE_URL`, `ROLE_KEY_ADMIN`, `ROLE_KEY_CREATIVE`, `ROLE_KEY_SMM` (GitHub copies). Automatic `GITHUB_TOKEN` is issued by Actions. Local operator environments and unnamed keys embedded in retained n8n nodes remain private and are not an exhaustive inventory.


| n8n credential login name | Type and location |
| --- | --- |
| `Analytics mirror key` | `httpHeaderAuth` in n8n credential store. |
| `APIFY @HOUSE` | `httpQueryAuth` in n8n credential store. |
| `Arketa Partner API` | `httpCustomAuth` in n8n credential store. |
| `Bearer Auth account` | `httpBearerAuth` in n8n credential store. |
| `Calendly account` | `calendlyApi` in n8n credential store. |
| `Calendly account 2` | `calendlyApi` in n8n credential store. |
| `Calendly account 3` | `calendlyOAuth2Api` in n8n credential store. |
| `Claude` | `httpHeaderAuth` in n8n credential store. |
| `eSignatures.com (token)` | `httpQueryAuth` in n8n credential store. |
| `Facebook Graph account` | `facebookGraphApi` in n8n credential store. |
| `Gemini API` | `httpHeaderAuth` in n8n credential store. |
| `GitHub brain read-only` | `httpHeaderAuth` in n8n credential store. |
| `GitHub PAT — reconcile` | `httpHeaderAuth` in n8n credential store. |
| `Google Docs account` | `googleDocsOAuth2Api` in n8n credential store. |
| `Google Drive account` | `googleDriveOAuth2Api` in n8n credential store. |
| `Google Sheets account` | `googleSheetsOAuth2Api` in n8n credential store. |
| `Header Auth account` | `httpHeaderAuth` in n8n credential store. |
| `Hello email` | `gmailOAuth2` in n8n credential store. |
| `Hiring Automation Key` | `httpHeaderAuth` in n8n credential store. |
| `House gmail` | `gmailOAuth2` in n8n credential store. |
| `HubSpot account` | `hubspotAppToken` in n8n credential store. |
| `iClosed API - Kasper` | `httpHeaderAuth` in n8n credential store. |
| `Kasper` | `slackOAuth2Api` in n8n credential store. |
| `Kasper User Token` | `slackApi` in n8n credential store. |
| `LINEAR` | `httpHeaderAuth` in n8n credential store. |
| `n8n account` | `n8nApi` in n8n credential store. |
| `Notion OAuth2 API` | `notionOAuth2Api` in n8n credential store. |
| `OPENAI` | `httpHeaderAuth` in n8n credential store. |
| `Post For Me` | `httpBearerAuth` in n8n credential store. |
| `Replicate` | `httpHeaderAuth` in n8n credential store. |
| `Roam API` | `httpHeaderAuth` in n8n credential store. |
| `Roster service key` | `httpHeaderAuth` in n8n credential store (roster-read / roster-write). |
| `Sidney Slack account` | `slackOAuth2Api` in n8n credential store. |
| `sidney@synchrosocial` | `googleDriveOAuth2Api` in n8n credential store. |
| `Slack account 2` | `slackApi` in n8n credential store. |
| `Slack account 3` | `slackApi` in n8n credential store. |
| `Stripe account` | `stripeApi` in n8n credential store. |
| `Supabase - SyncView Calendar` | `supabaseApi` in n8n credential store. |
| `SyncView Bot` | `slackApi` in n8n credential store. |
| `SyncView Client Credentials Staff Key` | `httpHeaderAuth` in n8n credential store. |
| `Telegram — Booking Alerts` | `telegramApi` in n8n credential store. |
| `Twilio — SMS` | `twilioApi` in n8n credential store. |
| `Upload-Post` | `httpHeaderAuth` in n8n credential store. |
| `YOUTUBE` | `httpQueryAuth` in n8n credential store. |


44 n8n credentials, live read 2026-10-29. Pipeline operator configuration is described in [the pipeline README](https://github.com/sidney-afk/synchro-pipelines/blob/main/README.md); actual local operator environments are not accessible. [Deploy manifest](../docs/ops/EF_DEPLOY_MANIFEST.md), [the merge-lane runbook](ops/EF_AUTO_DEPLOY.md) and workflow files are the authority for required release credentials.

## Deploy lanes and owner action

Verified 2026-10-29 against main 45c88a8, `.github/workflows` and `CLAUDE.md` (read-only).

The owner runs nothing for a deploy: no capture script, no deploy button, no access token. Edge Functions go live on merge; the Section 4 lane seals its own rollback bundle. What still needs a person is **Lighthouse**: applying a migration that holds a function, then running the merge lane by hand with `commit_sha` = that merge and `migrations_applied` = true; and releasing anything else the lane holds (its run summary says how, and the owner relay is paged). Do not merge while a Section 4 release is running. Always give a person the direct Actions URL and the commit SHA to paste.


| Lane | What deploys | What the owner does |
| --- | --- | --- |
| [Pages site](https://github.com/sidney-afk/client-analytics/actions/workflows/pages-site.yml) | client-analytics fragments rebuild index.html (not committed since 2026-10-15) and GitHub Pages deploys on main pushes or manual dispatch. | Nothing beyond review and merge; inspect the Actions result if a page change does not show. Docs-only merge does not trigger this lane. |
| [Edge Functions on merge](https://github.com/sidney-afk/client-analytics/actions/workflows/deploy-edge-functions-on-merge.yml) | Every function a merge to main changed (folder, imports or fingerprint), in order: `notify`, the Section 4 three (dispatched below), then `production-comments` and `production-archive`, then the rest; attests each. Holds a function whose merge adds a migration, a drift-guard mismatch, a stale Section 4 pin, a failed safeguard or `verify_jwt = true`. Never deploys `calendar-upsert`, `sample-review-upsert`, `client-token-verify`, `linear-inbound`, `linear-outbound`. | Nothing for an ordinary merge. Lighthouse: after applying a held migration, Run workflow with `commit_sha` = that merge, `migrations_applied` ticked; for other holds follow the run summary (`functions` = the held ones). Disable this workflow to stop automatic deploys at once. Runbook: [EF_AUTO_DEPLOY](ops/EF_AUTO_DEPLOY.md). |
| [F27 Section 4](https://github.com/sidney-afk/client-analytics/actions/workflows/deploy-f27-section4-closures.yml) | Exactly production-write, deliverable-write and batch-write. Dispatched by the merge lane with `capture`: captures the live three, seals and stores the rollback bundle in the Shared Drive root, fetches it back and verifies it, then deploys and attests. `commit_sha` must be main's tip. | Nothing normally. A change to one of the three must re-pin its fingerprint in this workflow in the same PR (`node scripts/ef-fingerprint.js <sha> --slugs=<slug> --expected-only`). Manual fallback: Run workflow with `capture` as both bundle inputs; `capture-only` is a dry run. Undo: `restore-captured-prior-three` with the sealed SHA-256 and byte length from that run's summary. |
| [Single function](https://github.com/sidney-afk/client-analytics/actions/workflows/deploy-single-function.yml) | Manual fallback only: one allowlisted function chosen by input (31 options), with the onboarding, HubSpot and Frame.io schema readbacks. | Only when a held function needs it. Frozen functions are not on its list. |
| [Onboarding functions](https://github.com/sidney-afk/client-analytics/actions/workflows/deploy-onboarding-edge-functions.yml) | Manual fallback only: the onboarding, credentials, filming-plan, SMM-report and key-verify set, plus the pinned Track-B set (notify, production-write, production-comments, production-archive) with the Linear-exit SQL preflight. | Only when a held function needs it. |
| [PTO functions](https://github.com/sidney-afk/client-analytics/actions/workflows/deploy-pto-edge-functions.yml) | Manual fallback only: `pto`, with `PTO_SCHEMA_CONTRACT`. | Only when a held function needs it. |
| [Thumbnail functions](https://github.com/sidney-afk/client-analytics/actions/workflows/deploy-thumbnail-edge-functions.yml) | Manual fallback only: `thumbnail-revision-read` and `thumbnail-revision-scan`. | Only when a held function needs it; enabling the scan is separate. |
| [Client review link](https://github.com/sidney-afk/client-analytics/actions/workflows/deploy-client-review-link.yml) | Manual fallback only: `client-review-link`. | Only when a held function needs it; no private share URL in public evidence. |
| [Description upload](https://github.com/sidney-afk/client-analytics/actions/workflows/deploy-description-image-upload.yml) | Manual fallback only: `description-image-upload`. | Only when a held function needs it. |
| [Hiring applications](https://github.com/sidney-afk/client-analytics/actions/workflows/deploy-hiring-applications.yml) | Manual fallback only: `hiring-applications`. | Only when a held function needs it; preserve hiring automation gates. |
| [Hiring automation](https://github.com/sidney-afk/client-analytics/actions/workflows/deploy-hiring-automation.yml) | Manual fallback only: `hiring-automation`. | Only when a held function needs it; turning invitation delivery on is separate. |
| [Calendar upsert live delta](https://github.com/sidney-afk/client-analytics/actions/workflows/calendar-upsert-live-delta.yml) | The frozen `calendar-upsert`, never auto-deployed. | Yes, as before: only with the owner's explicit go. |
| [Manifest operator rows](ops/EF_DEPLOY_MANIFEST.md) | `client-token-verify` (deliberate manual) and the frozen `sample-review-upsert`. | Authorize a reviewed operator deployment; capture exact source and live receipt. |
| [Database migrations](../migrations/) | Schema and functions; no automatic apply lane. A migration a merge adds holds that merge's functions unless it carries `-- ef-auto-deploy: functions-cope-without-this` or an `-- ef-auto-deploy-applied-when:` probe. | Lighthouse applies the exact SQL and reads it back, then releases the held functions (above). This Atlas applies none. |
| [n8n exit plan](plans/2026-09-30-n8n-exit-phase-2.md) | Published n8n graphs, maintained outside GitHub deploy. | Never edit an n8n workflow without the owner's explicit go in that same request; private export, public-safe receipt and readback. Retirement is deactivate after proof, never delete. |
| [Marketing Pages](https://github.com/sidney-afk/synchrosocial/actions/workflows/deploy.yml) | synchrosocial main build and Pages publish. | Review and merge marketing source; inspect marketing Actions deploy. |
| [Brain worker](https://github.com/sidney-afk/synchro-brain/actions/workflows/process-syncview-change.yml) | Processes private knowledge changes; no site deployment. | Review admitted knowledge edit and worker result. Pipelines operator publishing is separate. |

## Where do I look when...

Verified 2026-10-29 against main 45c88a8 and the live catalog (read-only).


| Question | First place and next evidence |
| --- | --- |
| A save failed? | [Save problems entry](../src/index/321-kasper-dashboard-replies.js.part) and [private diagnostic reader](../supabase/functions/write-diagnostics/index.ts); [write contract](truth/SUPABASE.md#write-contract-calendarsxr-upsert-paths). Follow the screen owner to its write function and Supabase function logs. The write-refusal log is best-effort and does not cover every surface. |
| A caption did not generate? | [Caption progress](../src/index/180-calendar-native-post-media.js.part); native `caption_jobs` row, then [caption-generate](../supabase/functions/caption-generate/index.ts) logs (Frame.io lookup, Replicate transcription or model error). n8n Generate Caption is inactive. |
| A client link is broken? | [Token verifier](../supabase/functions/client-token-verify/index.ts) and [Review link](../supabase/functions/client-review-link/index.ts); `clients` and `client_access` enrollment, then [client boot proof](truth/APP.md). Keep the real URL private. |
| A client's details are wrong, or the Clients Info Sheet disagrees? | `client_profiles` is the authority; edit through [roster-write](../supabase/functions/roster-write/index.ts) or [client-profile-write](../supabase/functions/client-profile-write/index.ts), never the Sheet. A Sheet behind the database means `roster_sheet_outbox` rows are pending: they send only when one of those functions (or `copy_to_sheet`) runs. [Roster plan](plans/2026-10-02-roster-native.md). |
| A TikTok post failed? | [Upload screen](../src/index/300-tiktok-upload.js.part); [tiktok-upload](../supabase/functions/tiktok-upload/index.ts) logs, `tiktok_uploads` row and Post For Me provider result. The n8n TikTok workflows and the `TikTokUpload` tab are retired. |
| An Instagram Reel failed? | [Native Instagram function](../supabase/functions/instagram-upload/index.ts) logs, `instagram_uploads` row and Post For Me job result; [owner gates](STATE_OF_THINGS.md). |
| Analytics is stale or blank? | Collection is paused by owner decision (2026-10-06), so numbers stop at that point by design. Then [receipt-aware mirror reader](../supabase/functions/analytics-read/index.ts), `analytics_ingest_receipts` and [Sheet fallback owners](#google-sheets); [migration comparison](plans/2026-09-24-sheets-to-supabase.md). |
| A card or sample vanished? | [Production writer](../supabase/functions/production-write/index.ts) or [Sample writer](../supabase/functions/sample-review-upsert/index.ts); `deliverables`, `calendar_posts`, `sample_reviews` and events; [repair ledger](ops/OPEN_REPAIRS.md). |
| A post did not turn Posted by itself? | `calendar-auto-posted-tick` job and [calendar-auto-posted](../supabase/functions/calendar-auto-posted/index.ts) logs; the `calendar_auto_posted` switch and the post's exact "Scheduled" status. |
| A filming plan or Doc tab will not load? | [Tab gateway](../supabase/functions/filming-plan-tabs/index.ts), `filming_plan_tabs_source` flag and Google access; [plan store](../supabase/functions/filming-plans/index.ts). |
| A notification or creative channel is missing? | [Notification monitor](../.github/workflows/native-notification-monitor.yml), `production_notification_delivery_receipts` and `native_intake_jobs`; [Provisioning and Finalizer](#n8n) execution. |
| An onboarding or hiring form failed? | [Onboarding capture](../supabase/functions/onboarding-capture/index.ts), [client-onboarding](../supabase/functions/client-onboarding/index.ts) or [Hiring capture](../supabase/functions/hiring-applications/index.ts) logs and [form wrapper workflow](#n8n); `onboarding_fallback` or hiring delivery outbox. |
| Workload or PTO looks wrong? | [Workload snapshot owner](../supabase/functions/workload-plan/index.ts) and [PTO owner](../supabase/functions/pto/index.ts); `workload_issues_native_v1`, `workload_plan`, `pto_requests` and `workload-snapshot-warm` job. |
| Which release or scheduled job changed this? | [Deploy lanes](#deploy-lanes-and-owner-action) and [schedule registry](#scheduled-jobs); Actions run logs (a timed run shows source `db-timer`), Supabase function logs or `cron.job_run_details`, n8n execution list, then [OPEN_REPAIRS](ops/OPEN_REPAIRS.md). |

## Table-creating migration inventory

Each linked file contains table-creating DDL, including retained backup and temporary tables. This is source inventory, not evidence that every statement was applied. Some files retain tables later dropped or renamed. Live relations above decide current presence. Both migration roots are checked. Verified 2026-10-29 against main 45c88a8 (100 table-creating files, matching the atlas-sync rule both ways) and the live catalog; "not applied" below means the named tables were absent live on 2026-10-29.


| Migration file | DDL table names |
| --- | --- |
| <!-- atlas:migration migrations/2026-10-01-analytics-metrics-collect-shadow.sql -->[`migrations/2026-10-01-analytics-metrics-collect-shadow.sql`](../migrations/2026-10-01-analytics-metrics-collect-shadow.sql) | `public.analytics_metrics_shadow`, `public.analytics_post_tracking`, `public.analytics_metrics_collect_queue` |
| <!-- atlas:migration migrations/2026-10-02-analytics-top-videos-collect-shadow.sql -->[`migrations/2026-10-02-analytics-top-videos-collect-shadow.sql`](../migrations/2026-10-02-analytics-top-videos-collect-shadow.sql) | `public.analytics_top_videos_shadow`, `public.analytics_top_videos_collect_queue` |
| <!-- atlas:migration migrations/2026-10-06-analytics-collect-live.sql -->[`migrations/2026-10-06-analytics-collect-live.sql`](../migrations/2026-10-06-analytics-collect-live.sql) | `public.analytics_collect_daily_checks`; "edge" added to the source checks of `public.analytics_metrics`, `public.analytics_top_videos`, `public.analytics_ingest_receipts` (not applied: no daily checks table live and the source checks still lack "edge") |
| <!-- atlas:migration migrations/2026-10-02-analytics-market-research-collect-shadow.sql -->[`migrations/2026-10-02-analytics-market-research-collect-shadow.sql`](../migrations/2026-10-02-analytics-market-research-collect-shadow.sql) | `public.analytics_market_research_collect_queue`, `public.analytics_market_research_shadow` (not applied; absent live 2026-10-29) |
| <!-- atlas:migration migrations/2026-10-01-analytics-metrics-dedupe-quoted-empty.sql -->[`migrations/2026-10-01-analytics-metrics-dedupe-quoted-empty.sql`](../migrations/2026-10-01-analytics-metrics-dedupe-quoted-empty.sql) | `public.analytics_metrics_dedupe_log`, temporary `_twins` |
| <!-- atlas:migration migrations/2026-07-03-a1-calendar-upsert.sql -->[`migrations/2026-07-03-a1-calendar-upsert.sql`](../migrations/2026-07-03-a1-calendar-upsert.sql) | `public.calendar_post_events`, `public.syncview_runtime_flags` |
| <!-- atlas:migration migrations/2026-07-04-a4-settings-edge-functions.sql -->[`migrations/2026-07-04-a4-settings-edge-functions.sql`](../migrations/2026-07-04-a4-settings-edge-functions.sql) | `public.templates`, `public.caption_prompts` |
| <!-- atlas:migration migrations/2026-07-05-b0-linear-auth-scaffold.sql -->[`migrations/2026-07-05-b0-linear-auth-scaffold.sql`](../migrations/2026-07-05-b0-linear-auth-scaffold.sql) | `public.team_members`, `public.clients`, `public.client_access`, `public.client_access_events`, `public.syncview_auth_events`, `public.flag_flips` |
| <!-- atlas:migration migrations/2026-07-06-b1-linear-data-model.sql -->[`migrations/2026-07-06-b1-linear-data-model.sql`](../migrations/2026-07-06-b1-linear-data-model.sql) | `public.batches`, `public.deliverables`, `public.deliverable_events`, `public.mirror_outbox`, `public.linear_archive` |
| <!-- atlas:migration migrations/2026-07-09-filming-plans-source.sql -->[`migrations/2026-07-09-filming-plans-source.sql`](../migrations/2026-07-09-filming-plans-source.sql) | `public.filming_plans` |
| <!-- atlas:migration migrations/2026-07-09-thumbnail-media-revisions.sql -->[`migrations/2026-07-09-thumbnail-media-revisions.sql`](../migrations/2026-07-09-thumbnail-media-revisions.sql) | `public.thumbnail_media_revisions` |
| <!-- atlas:migration migrations/2026-07-10-smm-weekly-reports.sql -->[`migrations/2026-07-10-smm-weekly-reports.sql`](../migrations/2026-07-10-smm-weekly-reports.sql) | `public.social_media_managers`, `public.smm_weekly_reports` |
| <!-- atlas:migration migrations/2026-07-11-b4-write-attribution.sql -->[`migrations/2026-07-11-b4-write-attribution.sql`](../migrations/2026-07-11-b4-write-attribution.sql) | `public.settings_events` |
| <!-- atlas:migration migrations/2026-07-12-production-comments.sql -->[`migrations/2026-07-12-production-comments.sql`](../migrations/2026-07-12-production-comments.sql) | `public.production_comments` |
| <!-- atlas:migration migrations/2026-07-14-linear-intake-receipts.sql -->[`migrations/2026-07-14-linear-intake-receipts.sql`](../migrations/2026-07-14-linear-intake-receipts.sql) | `public.linear_intake_receipts` |
| <!-- atlas:migration migrations/2026-07-15-pto-tracker.sql -->[`migrations/2026-07-15-pto-tracker.sql`](../migrations/2026-07-15-pto-tracker.sql) | `public.pto_members`, `public.pto_requests`, `public.pto_adjustments` |
| <!-- atlas:migration migrations/2026-10-10-pto-member-setup-audit.sql -->[`migrations/2026-10-10-pto-member-setup-audit.sql`](../migrations/2026-10-10-pto-member-setup-audit.sql) | `public.pto_member_events` (append-only Member setup record, written only by `pto_set_member_start_v2`; OPEN_REPAIRS 399) |
| <!-- atlas:migration migrations/2026-07-19-workload-plan.sql -->[`migrations/2026-07-19-workload-plan.sql`](../migrations/2026-07-19-workload-plan.sql) | `public.workload_plan` |
| <!-- atlas:migration migrations/2026-07-20-f27-team-rollback.sql -->[`migrations/2026-07-20-f27-team-rollback.sql`](../migrations/2026-07-20-f27-team-rollback.sql) | `public.track_b_f27_team_fences`, `public.track_b_team_rollbacks`, `public.track_b_team_rollback_intents` |
| <!-- atlas:migration migrations/2026-07-23-f34-f53-production-attachments.sql -->[`migrations/2026-07-23-f34-f53-production-attachments.sql`](../migrations/2026-07-23-f34-f53-production-attachments.sql) | `public.production_asset_access_checks`, `public.linear_archive_asset_rescue_config`, `public.linear_archive_asset_refs` |
| <!-- atlas:migration migrations/2026-07-23-production-comment-thread-lifecycle.sql -->[`migrations/2026-07-23-production-comment-thread-lifecycle.sql`](../migrations/2026-07-23-production-comment-thread-lifecycle.sql) | `public.production_comment_read_audit`, `public.production_comment_read_budget`, `public.production_comment_mutation_receipts`, `public.production_comment_card_links`, `public.production_comment_import_conflicts` |
| <!-- atlas:migration migrations/2026-07-28-f27-write-authorization-only.sql -->[`migrations/2026-07-28-f27-write-authorization-only.sql`](../migrations/2026-07-28-f27-write-authorization-only.sql) | `public.track_b_f27_team_fences` |
| <!-- atlas:migration migrations/2026-07-28-linear-project-ids-team-shape.sql -->[`migrations/2026-07-28-linear-project-ids-team-shape.sql`](../migrations/2026-07-28-linear-project-ids-team-shape.sql) | `public.linear_project_ids_shape_migration_20260728` |
| <!-- atlas:migration migrations/2026-08-24-hiring-applications.sql -->[`migrations/2026-08-24-hiring-applications.sql`](../migrations/2026-08-24-hiring-applications.sql) | `public.hiring_applications`, `public.hiring_invite_jobs`, `public.hiring_application_events` |
| <!-- atlas:migration migrations/2026-08-24-kasper-ad-performance-unfinished-leads.sql -->[`migrations/2026-08-24-kasper-ad-performance-unfinished-leads.sql`](../migrations/2026-08-24-kasper-ad-performance-unfinished-leads.sql) | `public.kasper_ad_unfinished_leads` |
| <!-- atlas:migration migrations/2026-08-24-kasper-ad-performance-v2.sql -->[`migrations/2026-08-24-kasper-ad-performance-v2.sql`](../migrations/2026-08-24-kasper-ad-performance-v2.sql) | `public.kasper_ad_performance_by_ad_daily`, `public.kasper_ad_leads` |
| <!-- atlas:migration migrations/2026-08-24-kasper-ad-performance.sql -->[`migrations/2026-08-24-kasper-ad-performance.sql`](../migrations/2026-08-24-kasper-ad-performance.sql) | `public.kasper_ad_performance_daily` |
| <!-- atlas:migration migrations/2026-08-24-public-intake-log.sql -->[`migrations/2026-08-24-public-intake-log.sql`](../migrations/2026-08-24-public-intake-log.sql) | `public.public_intake_log` |
| <!-- atlas:migration migrations/2026-08-24-quiz-responses.sql -->[`migrations/2026-08-24-quiz-responses.sql`](../migrations/2026-08-24-quiz-responses.sql) | `public.quiz_responses`, `public.quiz_intake_log` |
| <!-- atlas:migration migrations/2026-08-27-kasper-ad-performance-multi-campaign.sql -->[`migrations/2026-08-27-kasper-ad-performance-multi-campaign.sql`](../migrations/2026-08-27-kasper-ad-performance-multi-campaign.sql) | `public.kasper_ad_campaign_daily` |
| <!-- atlas:migration migrations/2026-09-05-calendar-feedback-recovery.sql -->[`migrations/2026-09-05-calendar-feedback-recovery.sql`](../migrations/2026-09-05-calendar-feedback-recovery.sql) | `public.calendar_feedback_materializations` |
| <!-- atlas:migration migrations/2026-09-05-card-change-journal.sql -->[`migrations/2026-09-05-card-change-journal.sql`](../migrations/2026-09-05-card-change-journal.sql) | `public.card_change_journal` |
| <!-- atlas:migration migrations/2026-09-05-description-images.sql -->[`migrations/2026-09-05-description-images.sql`](../migrations/2026-09-05-description-images.sql) | `public.description_images` |
| <!-- atlas:migration migrations/2026-09-05-native-intake-reconcile.sql -->[`migrations/2026-09-05-native-intake-reconcile.sql`](../migrations/2026-09-05-native-intake-reconcile.sql) | `public.production_card_provenance` |
| <!-- atlas:migration migrations/2026-09-05-native-intake-root-manifest.sql -->[`migrations/2026-09-05-native-intake-root-manifest.sql`](../migrations/2026-09-05-native-intake-root-manifest.sql) | `public.production_intake_manifests` |
| <!-- atlas:migration migrations/2026-09-05-native-label-catalog-foundation.sql -->[`migrations/2026-09-05-native-label-catalog-foundation.sql`](../migrations/2026-09-05-native-label-catalog-foundation.sql) | `public.production_label_catalog_versions` |
| <!-- atlas:migration migrations/2026-09-06-linear-outbound-cutoff.sql -->[`migrations/2026-09-06-linear-outbound-cutoff.sql`](../migrations/2026-09-06-linear-outbound-cutoff.sql) | `public.linear_outbound_cutoff_control` |
| <!-- atlas:migration migrations/2026-09-06-native-card-materialization-boundary.sql -->[`migrations/2026-09-06-native-card-materialization-boundary.sql`](../migrations/2026-09-06-native-card-materialization-boundary.sql) | `public.production_card_materialization_receipts`, `public.production_card_materialization_ingress` |
| <!-- atlas:migration migrations/2026-09-07-legacy-intake-native-triage.sql -->[`migrations/2026-09-07-legacy-intake-native-triage.sql`](../migrations/2026-09-07-legacy-intake-native-triage.sql) | `public.legacy_intake_native_triage` |
| <!-- atlas:migration migrations/2026-09-07-native-brief-media.sql -->[`migrations/2026-09-07-native-brief-media.sql`](../migrations/2026-09-07-native-brief-media.sql) | `public.native_brief_media_occurrences` |
| <!-- atlas:migration migrations/2026-09-07-native-identifier-mint.sql -->[`migrations/2026-09-07-native-identifier-mint.sql`](../migrations/2026-09-07-native-identifier-mint.sql) | `public.production_native_identifier_mint`, `public.production_native_identifier_grants` |
| <!-- atlas:migration migrations/2026-09-09-native-client-provisioning.sql -->[`migrations/2026-09-09-native-client-provisioning.sql`](../migrations/2026-09-09-native-client-provisioning.sql) | `public.production_native_client_provisions` |
| <!-- atlas:migration migrations/2026-09-09-native-notification-outbox.sql -->[`migrations/2026-09-09-native-notification-outbox.sql`](../migrations/2026-09-09-native-notification-outbox.sql) | `public.production_notification_config`, `public.production_notification_intents`, `public.production_notification_delivery_receipts`, `public.production_notification_reconciliations` |
| <!-- atlas:migration migrations/2026-09-09-native-ordinary-receipts.sql -->[`migrations/2026-09-09-native-ordinary-receipts.sql`](../migrations/2026-09-09-native-ordinary-receipts.sql) | `public.production_native_ordinary_receipt_admissions` |
| <!-- atlas:migration migrations/2026-09-09-syncview-retirement-admission.sql -->[`migrations/2026-09-09-syncview-retirement-admission.sql`](../migrations/2026-09-09-syncview-retirement-admission.sql) | `public.syncview_retirement_admission` |
| <!-- atlas:migration migrations/2026-09-15-hiring-video-editor-role.sql -->[`migrations/2026-09-15-hiring-video-editor-role.sql`](../migrations/2026-09-15-hiring-video-editor-role.sql) | `public.hiring_practical_test_jobs` |
| <!-- atlas:migration migrations/2026-09-18-native-calendar-backfill-temp-table-clear.sql -->[`migrations/2026-09-18-native-calendar-backfill-temp-table-clear.sql`](../migrations/2026-09-18-native-calendar-backfill-temp-table-clear.sql) | `native_calendar_backfill_scope`, `native_calendar_backfill_applied` |
| <!-- atlas:migration migrations/2026-09-18-native-calendar-status-bridge.sql -->[`migrations/2026-09-18-native-calendar-status-bridge.sql`](../migrations/2026-09-18-native-calendar-status-bridge.sql) | `native_calendar_backfill_scope`, `native_calendar_backfill_applied` |
| <!-- atlas:migration migrations/2026-10-08-native-calendar-na-wins-one-client.sql -->[`migrations/2026-10-08-native-calendar-na-wins-one-client.sql`](../migrations/2026-10-08-native-calendar-na-wins-one-client.sql) | `native_calendar_backfill_scope`, `native_calendar_backfill_applied` |
| <!-- atlas:migration migrations/2026-09-23-rename-propagation.sql -->[`migrations/2026-09-23-rename-propagation.sql`](../migrations/2026-09-23-rename-propagation.sql) | `public.rename_propagation_outbox` |
| <!-- atlas:migration migrations/2026-09-23-workload-native-snapshot-cache.sql -->[`migrations/2026-09-23-workload-native-snapshot-cache.sql`](../migrations/2026-09-23-workload-native-snapshot-cache.sql) | `public.workload_snapshot_invalidation`, `public.workload_snapshot_cache` |
| <!-- atlas:migration migrations/2026-09-24-workload-native-snapshot-board-builder.VERIFY.sql -->[`migrations/2026-09-24-workload-native-snapshot-board-builder.VERIFY.sql`](../migrations/2026-09-24-workload-native-snapshot-board-builder.VERIFY.sql) | `workload_board_verify` |
| <!-- atlas:migration migrations/2026-09-25-client-profile-edits.sql -->[`migrations/2026-09-25-client-profile-edits.sql`](../migrations/2026-09-25-client-profile-edits.sql) | `public.client_profile_edits` |
| <!-- atlas:migration migrations/2026-09-25-sheets-mirror-phase1.sql -->[`migrations/2026-09-25-sheets-mirror-phase1.sql`](../migrations/2026-09-25-sheets-mirror-phase1.sql) | `public.client_profiles`, `public.analytics_metrics`, `public.analytics_top_videos`, `public.analytics_market_research_briefs`, `public.analytics_content_summaries`, `public.analytics_ingest_receipts` |
| <!-- atlas:migration migrations/2026-09-28-clients-roster-sync.sql -->[`migrations/2026-09-28-clients-roster-sync.sql`](../migrations/2026-09-28-clients-roster-sync.sql) | `public.clients_roster_sync_log` |
| <!-- atlas:migration migrations/2026-09-28-higgsfield-team-connector.sql -->[`migrations/2026-09-28-higgsfield-team-connector.sql`](../migrations/2026-09-28-higgsfield-team-connector.sql) | `public.hf_team_members`, `public.hf_generations` |
| <!-- atlas:migration migrations/2026-10-02-roster-native.sql -->[`migrations/2026-10-02-roster-native.sql`](../migrations/2026-10-02-roster-native.sql) | `public.roster_sheet_outbox`, `public.smm_assignment_edits` (plus functions `client_profile_service_write`, `client_profile_archive`, `roster_route_enrol`, `smm_assign_client`) |
| <!-- atlas:migration migrations/2026-09-29-filming-plan-tabs-cache.sql -->[`migrations/2026-09-29-filming-plan-tabs-cache.sql`](../migrations/2026-09-29-filming-plan-tabs-cache.sql) | `public.filming_plan_tabs_cache` |
| <!-- atlas:migration migrations/2026-09-30-caption-jobs.sql -->[`migrations/2026-09-30-caption-jobs.sql`](../migrations/2026-09-30-caption-jobs.sql) | `public.caption_jobs` |
| <!-- atlas:migration migrations/2026-10-02-roster-stale-cleanup.sql -->[`migrations/2026-10-02-roster-stale-cleanup.sql`](../migrations/2026-10-02-roster-stale-cleanup.sql) | `public.roster_cleanup_log` |
| <!-- atlas:migration migrations/2026-10-03-onboarding-checklist-tables.sql -->[`migrations/2026-10-03-onboarding-checklist-tables.sql`](../migrations/2026-10-03-onboarding-checklist-tables.sql) | `public.onboarding_steps`, `public.client_onboarding_progress`, `public.client_onboarding_events`, `public.client_resources`, `public.client_sales_state`, `public.client_backfill_proposals`, views `client_onboarding_summary_v1`, `client_resource_status_v1` |
| <!-- atlas:migration migrations/2026-09-30-instagram-uploads.sql -->[`migrations/2026-09-30-instagram-uploads.sql`](../migrations/2026-09-30-instagram-uploads.sql) | `public.instagram_uploads` |
| <!-- atlas:migration migrations/2026-10-07-tiktok-uploads.sql -->[`migrations/2026-10-07-tiktok-uploads.sql`](../migrations/2026-10-07-tiktok-uploads.sql) | `public.tiktok_uploads`; switch `tiktok_upload_source` (live value: supabase) |
| <!-- atlas:migration migrations/2026-10-10-calendar-auto-posted.sql -->[`migrations/2026-10-10-calendar-auto-posted.sql`](../migrations/2026-10-10-calendar-auto-posted.sql) | `public.calendar_auto_posted_moves` (the job's own record of every card it moved; switch `calendar_auto_posted` on for all clients, timer `calendar-auto-posted-tick`) |
| <!-- atlas:migration migrations/2026-10-09-thumbnail-titles.sql -->[`migrations/2026-10-09-thumbnail-titles.sql`](../migrations/2026-10-09-thumbnail-titles.sql) | `public.thumbnail_title_prompts`, `public.thumbnail_title_queue`; switch `thumbnail_titles` (on for all clients: its list is `*`); timer `thumbnail-titles-tick` |
| <!-- atlas:migration migrations/2026-10-23-thumbnail-title-buttons.sql -->[`migrations/2026-10-23-thumbnail-title-buttons.sql`](../migrations/2026-10-23-thumbnail-title-buttons.sql) | `public.thumbnail_title_runs`, `public.thumbnail_title_run_items`, function `thumbnail_title_manual_apply` (the Production thumbnail title buttons, OPEN_REPAIRS 481; applied) |
| <!-- atlas:migration migrations/2026-10-13-frameio-token-keeper.sql -->[`migrations/2026-10-13-frameio-token-keeper.sql`](../migrations/2026-10-13-frameio-token-keeper.sql) | `public.frameio_token_keeper` |
| <!-- atlas:migration migrations/2026-10-14-caption-cta-and-title-ideas.sql -->[`migrations/2026-10-14-caption-cta-and-title-ideas.sql`](../migrations/2026-10-14-caption-cta-and-title-ideas.sql) | `public.caption_cta_options` (a client's call to action choices; closed to every browser role), column `public.caption_jobs.extras` (title ideas and hashtags) |
| <!-- atlas:migration migrations/2026-10-18-intake-raw-submissions.sql -->[`migrations/2026-10-18-intake-raw-submissions.sql`](../migrations/2026-10-18-intake-raw-submissions.sql) | `public.intake_raw_submissions` (the raw copy of every upload, stored first; see [INTAKE_RAW_COPY.md](ops/INTAKE_RAW_COPY.md)) |
| <!-- atlas:migration migrations/2026-10-23-caption-versions.sql -->[`migrations/2026-10-23-caption-versions.sql`](../migrations/2026-10-23-caption-versions.sql) | `public.caption_versions` (every version of a Calendar card's caption, append-only, written by a trigger on `calendar_posts` that never blocks a save; read by `caption-generate` for the history pop-up; OPEN_REPAIRS 482) |
| <!-- atlas:migration migrations/ai-onboarding-supabase-migration.sql -->[`migrations/ai-onboarding-supabase-migration.sql`](../migrations/ai-onboarding-supabase-migration.sql) | `public.ai_client_onboarding` |
| <!-- atlas:migration migrations/client-credentials-migration.sql -->[`migrations/client-credentials-migration.sql`](../migrations/client-credentials-migration.sql) | `public.client_credentials`, `public.client_credential_events`, `public.client_credentials_rev` |
| <!-- atlas:migration migrations/legacy-onboarding-migration.sql -->[`migrations/legacy-onboarding-migration.sql`](../migrations/legacy-onboarding-migration.sql) | `public.legacy_onboarding` |
| <!-- atlas:migration migrations/live-schema-baseline-2026-07-03.sql -->[`migrations/live-schema-baseline-2026-07-03.sql`](../migrations/live-schema-baseline-2026-07-03.sql) | `public.ai_client_onboarding`, `public.calendar_posts`, `public.client_credential_events`, `public.client_credentials`, `public.client_credentials_rev`, `public.client_onboarding`, `public.content_samples`, `public.onboarding_fallback`, `public.sales_intakes`, `public.sample_review_events`, `public.sample_reviews`, `public.tiktok_accounts`, `public.tiktok_oauth_state`, `public.tiktok_pilot_posts`, `public.workload_issues` |
| <!-- atlas:migration migrations/onboarding-fallback-supabase-migration.sql -->[`migrations/onboarding-fallback-supabase-migration.sql`](../migrations/onboarding-fallback-supabase-migration.sql) | `public.onboarding_fallback` |
| <!-- atlas:migration migrations/onboarding-supabase-migration.sql -->[`migrations/onboarding-supabase-migration.sql`](../migrations/onboarding-supabase-migration.sql) | `public.client_onboarding` |
| <!-- atlas:migration migrations/sales-intake-migration.sql -->[`migrations/sales-intake-migration.sql`](../migrations/sales-intake-migration.sql) | `public.sales_intakes` |
| <!-- atlas:migration migrations/sample-reviews-migration.sql -->[`migrations/sample-reviews-migration.sql`](../migrations/sample-reviews-migration.sql) | `public.sample_reviews`, `public.sample_review_events` |
| <!-- atlas:migration migrations/samples-supabase-migration.sql -->[`migrations/samples-supabase-migration.sql`](../migrations/samples-supabase-migration.sql) | `public.content_samples` |
| <!-- atlas:migration migrations/ttpilot-schema-migration.sql -->[`migrations/ttpilot-schema-migration.sql`](../migrations/ttpilot-schema-migration.sql) | `public.tiktok_accounts`, `public.tiktok_oauth_state`, `public.tiktok_pilot_posts` |
| <!-- atlas:migration migrations/workload-issues-supabase-migration.sql -->[`migrations/workload-issues-supabase-migration.sql`](../migrations/workload-issues-supabase-migration.sql) | `public.workload_issues` |
| <!-- atlas:migration migrations/2026-10-03-native-client-test-provision.sql -->[`migrations/2026-10-03-native-client-test-provision.sql`](../migrations/2026-10-03-native-client-test-provision.sql) | `public.production_native_client_test_provisions` |
| <!-- atlas:migration supabase/migrations/20260912174907_card_atomic_admission_preparation.sql -->[`supabase/migrations/20260912174907_card_atomic_admission_preparation.sql`](../supabase/migrations/20260912174907_card_atomic_admission_preparation.sql) | `public.card_write_admission_v1`, `public.card_write_operations_v1`, `public.card_write_followups_v1` |
| <!-- atlas:migration supabase/migrations/20260912183653_application_dml_admission_preparation.sql -->[`supabase/migrations/20260912183653_application_dml_admission_preparation.sql`](../supabase/migrations/20260912183653_application_dml_admission_preparation.sql) | `public.card_write_transaction_context_v1` |
| <!-- atlas:migration supabase/migrations/20260912203454_installation_transaction_journal_preparation.sql -->[`supabase/migrations/20260912203454_installation_transaction_journal_preparation.sql`](../supabase/migrations/20260912203454_installation_transaction_journal_preparation.sql) | `linear_exit_install.journal_v1` |
| <!-- atlas:migration supabase/migrations/20260913034324_provider_send_admission_preparation.sql -->[`supabase/migrations/20260913034324_provider_send_admission_preparation.sql`](../supabase/migrations/20260913034324_provider_send_admission_preparation.sql) | `linear_exit_provider.send_attempts_v1` |
| <!-- atlas:migration supabase/migrations/20260913035202_installation_maintenance_gate_preparation.sql -->[`supabase/migrations/20260913035202_installation_maintenance_gate_preparation.sql`](../supabase/migrations/20260913035202_installation_maintenance_gate_preparation.sql) | `linear_exit_maintenance.gate_v1` |
| <!-- atlas:migration supabase/migrations/20260913044451_write_refusal_diagnostics_preparation.sql -->[`supabase/migrations/20260913044451_write_refusal_diagnostics_preparation.sql`](../supabase/migrations/20260913044451_write_refusal_diagnostics_preparation.sql) | `write_refusal_diagnostics.receipts_v1` |
| <!-- atlas:migration supabase/migrations/20261007150000_smm_also_sees.sql -->[`supabase/migrations/20261007150000_smm_also_sees.sql`](../supabase/migrations/20261007150000_smm_also_sees.sql) | `public.smm_also_sees` |
| <!-- atlas:migration supabase/migrations/20261014090000_message_reads.sql -->[`supabase/migrations/20261014090000_message_reads.sql`](../supabase/migrations/20261014090000_message_reads.sql) | `public.message_reads` |
| <!-- atlas:migration supabase/migrations/20261014120000_client_review_alerts.sql -->[`supabase/migrations/20261014120000_client_review_alerts.sql`](../supabase/migrations/20261014120000_client_review_alerts.sql) | `public.client_review_alerts` |
| <!-- atlas:migration supabase/migrations/20261015180000_hf_activity.sql -->[`supabase/migrations/20261015180000_hf_activity.sql`](../supabase/migrations/20261015180000_hf_activity.sql) | `public.hf_activity` |
| <!-- atlas:migration supabase/migrations/20261015200000_hf_guides.sql -->[`supabase/migrations/20261015200000_hf_guides.sql`](../supabase/migrations/20261015200000_hf_guides.sql) | `public.hf_guides` |
| <!-- atlas:migration supabase/migrations/20261016180000_hf_studio_downloads.sql -->[`supabase/migrations/20261016180000_hf_studio_downloads.sql`](../supabase/migrations/20261016180000_hf_studio_downloads.sql) | `public.hf_studio_downloads` |
| <!-- atlas:migration supabase/migrations/20261016230000_filming_pipeline_passes.sql -->[`supabase/migrations/20261016230000_filming_pipeline_passes.sql`](../supabase/migrations/20261016230000_filming_pipeline_passes.sql) | `public.fp_publishers`, `public.fp_settings`, `public.fp_passes`, `public.fp_pass_tabs`, `public.fp_files`, `public.fp_file_history`, `public.fp_batch_counter`, `public.fp_feedback_notes` |
| <!-- atlas:migration supabase/migrations/20261026120000_crm_leads.sql -->[`supabase/migrations/20261026120000_crm_leads.sql`](../supabase/migrations/20261026120000_crm_leads.sql) | `public.crm_people`, `public.crm_events`, `public.crm_sources`, `public.crm_sequences`, `public.crm_sequence_steps`, `public.crm_enrolments` (plus function `crm_apply_change`) |
| <!-- atlas:migration supabase/migrations/20261027210000_crm_n8n_sequences.sql -->[`supabase/migrations/20261027210000_crm_n8n_sequences.sql`](../supabase/migrations/20261027210000_crm_n8n_sequences.sql) | `public.crm_n8n_sequences` |
| <!-- atlas:migration supabase/migrations/20261021180000_hf_tools.sql -->[`supabase/migrations/20261021180000_hf_tools.sql`](../supabase/migrations/20261021180000_hf_tools.sql) | `public.hf_tools` |
| <!-- atlas:migration supabase/migrations/20261026200000_studio_trial_versions.sql -->[`supabase/migrations/20261026200000_studio_trial_versions.sql`](../supabase/migrations/20261026200000_studio_trial_versions.sql) | `public.studio_trial_versions` |
| <!-- atlas:migration supabase/migrations/20261027090000_trial_reels.sql -->[`supabase/migrations/20261027090000_trial_reels.sql`](../supabase/migrations/20261027090000_trial_reels.sql) | `public.studio_trial_versions` (SyncView's columns), `public.trial_reel_cards` |

## Verification limits and keeping this map true

Read-only evidence (2026-10-29) covers main `45c88a8`, the live schema metadata and browser privileges, the Edge Function catalog, all 26 database jobs, the full n8n list with active states and credential names, and the public sibling repo. Secret names, the two private sibling repos and Sheet tab lists were carried over from the 2026-09-30 and 2026-10-02 reads and are marked unverified where they appear. It does not prove successful current provider calls, recent scheduled executions, live function byte equality or every human Sheet reader. Project Central metadata returned 403; dynamic workbook targets and private operator environments cannot be enumerated from accessible graphs. Live-only `doctors-partial-capture` and `fp-tab-test` have no repo source. Local operator environments and unnamed retained n8n keys are not closed. No real post, caption generation, recovery send, restore, schema apply or deployment was run. These gaps require private access or explicitly authorized live proof; they are not marked passed.

[atlas-sync](../test/atlas-sync.js) runs in the [unit suite](../test/suite-classification.json). It compares both directions for edge folders including helpers, table-creating SQL in both migration roots, every workflow file and n8n IDs recorded in [N8N truth](truth/N8N.md). Missing, stale, duplicate, invisible and malformed entries fail; local links are checked. This offline test cannot detect an unrecorded live n8n or database change. After a live change, update the dated truth census and this map together from a read-only inventory. Brain runs a weekly check that compares this map with the week's merged changes and reports mismatches to the SyncView supervisor; it reads the repo, not the live systems, so a live-only change still needs a read-only re-inventory like this one.
