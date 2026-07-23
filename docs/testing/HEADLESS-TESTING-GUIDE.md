# Headless-Browser Testing Guide

How to test this app the way it actually runs — by driving the **real
`index.html`** in a headless Chromium, exactly the same code the Chrome
extension and the live site serve. This is the workflow that produced the
audit fixes and the Kasper "Messages" inbox change: write one focused probe per
behaviour, run it against the real app + real backend, read the result, fix,
re-run until green — then verify before pushing.

> **One-line mental model:** the headless browser loads the *same* single-file
> app the user sees. There is no separate "test build." If a probe drives the
> page and the assertion passes, the real UI does that too. You are not mocking
> the app — you are *using* it and checking what it actually renders/writes.

---

## 0. Why headless == the Chrome extension / live UI

The whole product is one static file: `index.html` (one large inline
`<script>`). The Chrome extension, GitHub Pages (`main` → live), and a local
`python3 -m http.server` all serve the **identical bytes**. So:

- Loading `http://localhost:8000/index.html` headless runs the same code path as
  the real surface. The only differences you control deliberately: timezone,
  viewport, and the password gate.
- The app talks to the **live** Supabase + n8n backend from any origin. That's
  powerful (your probe exercises the true data flow) **and dangerous** (you can
  mutate real data). See **§5 Scope & safety** — it is not optional.

---

## 1. Environment

### Serve the app
```bash
# from the repo root; the runner owns and silences its server
PROBE_ATTEMPTS=1 node qa/run-probes.js <probe-name>
```
Protected client URLs contain a credential. Do not start or reuse an ad-hoc
logging server for those routes. `qa/run-probes.js`, `qa/master.js`, and
`qa/overnight_runner.sh` silence the server, strip client-entry credentials from
its environment, and fail closed if the port belongs to another process.
`qa/master.js --no-server` is an explicit opt-in reserved for a server you
started, trust, and already confirmed is silent.

### Playwright
Playwright is installed system-wide; requiring it by **absolute path** works in
every environment (including ones where `npm install` hasn't run):
```js
const PW = require('/opt/node22/lib/node_modules/playwright');
```
Launch headless Chromium:
```js
const browser = await PW.chromium.launch({ headless: true, args: ['--ignore-certificate-errors'] });
```

### The three surfaces (same file, different entry)
| Surface | URL | Notes |
|---|---|---|
| **SMM** (manager) | `…/index.html?v2debug=1#calendar/<slug>` | `_isClientLink = false` — full edit rights |
| **Client** (read-mostly) | `…/index.html?c=<TEST%20Client>&t=<current-protected-token>&v=calendar` | `_isClientLink = true`; strict verification runs before route data |
| **Kasper** (reviewer) | `…/index.html?Kasper=1&v2debug=1` | cross-client review/inbox |

- `?v2debug=1` turns on verbose `[calV2…]` console logs on staff/Kasper routes. It is
  deliberately forbidden on strict client-entry URLs; use the shared builder instead.
- The **test client** is **Sidney Laruel**, slug **`sidneylaruel`**. Use only
  this one (see §5).
- Live client routes require a current protected token. Each operative harness obtains it
  from the staff-only `client-review-link` issuer, keeps it only in local process memory,
  and passes it explicitly to `gotoTestClientEntry`, whose replacement errors omit the URL.
  Never export it through `GITHUB_ENV`
  or `process.env`; browser and unrelated child environments must strip client-entry
  credentials. Never commit, paste into examples, or print the token.

### The password gate
The app shows a password overlay (`#passwordOverlay`). Don't type the password in
your scripts — **seed the auth flag in localStorage before the page scripts run**:
```js
const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 }, ignoreHTTPSErrors: true });
await ctx.addInitScript(() => { try { localStorage.setItem('syncview_auth_v1', 'ok'); } catch (e) {} });
```
(If you ever need the real overlay path: fill `#passwordInput` and call
`window.submitPassword()`. But the localStorage seed is cleaner and avoids putting
the team password in a script.)

### Timezone (for date/tz bugs)
The "off-by-one date" bug only reproduces in Americas timezones. Set it per
context:
```js
const ctx = await browser.newContext({ timezoneId: 'America/Argentina/Buenos_Aires', /* … */ });
```

---

## 2. The reusable harness

**Use the in-repo harness libraries first** — they are the maintained
descendants of the pattern this section teaches:

- `qa/golden_lib.js` — real Kasper/client handlers + upsert webhook + polling
  (required by `qa/probes/lib.js`);
- `qa/sxr_courier_lib.js` — the Samples harness (courier, Linear mocks,
  `archiveSafe` cleanup);
- `qa/scenario_engine.js` + `qa/scenarios.js` — multi-actor flows via real DOM
  clicks, asserted against the live DB.

Don't hand-copy a fresh helper when one of those fits. The `qalib.js` below is
the **model behind them** — read it to understand what every harness must do
(capture ALL JS errors so any probe can assert "0 JS errors", seed the auth
flag, open each surface with a sane wait), and use it only for a quick
standalone probe outside `qa/`.

```js
// qalib.js — shared headless harness
const PW = require('/opt/node22/lib/node_modules/playwright');
const {
  TEST_CLIENT,
  clientEntrySafeChildEnv,
  currentTestClientToken,
  gotoTestClientEntry,
} = require('./qa/test-client-entry.js');
const ORIGIN = 'http://localhost:8000';

async function launch() {
  return await PW.chromium.launch({
    headless: true,
    args: ['--ignore-certificate-errors'],
    env: clientEntrySafeChildEnv(),
  });
}

// Attach error capture to a page. page._errs collects everything worth failing on.
function capture(page) {
  page._errs = [];
  page.on('console', m => { if (m.type() === 'error') page._errs.push('[console.error] ' + m.text()); });
  page.on('pageerror', e => page._errs.push('[pageerror] ' + (e && e.message)));
  page.on('requestfailed', r => {
    const u = r.url();
    // Only app backends matter — ignore e.g. placeholder image hosts.
    if (/synchrosocial|supabase/.test(u)) page._errs.push('[reqfail] ' + u + ' ' + (r.failure() && r.failure().errorText));
  });
}

async function ctx(browser, opts = {}) {
  const c = await browser.newContext({ viewport: { width: 1500, height: 950 }, ignoreHTTPSErrors: true, ...opts });
  await c.addInitScript(() => { try { localStorage.setItem('syncview_auth_v1', 'ok'); } catch (e) {} });
  return c;
}

async function open(browser, url, opts) {
  const c = await ctx(browser, opts);
  const p = await c.newPage();
  capture(p);
  await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await p.waitForTimeout(700);
  return p;
}

// SMM: wait until the realtime channel is subscribed so reads are live.
async function smm(browser, slug = 'sidneylaruel', opts) {
  const p = await open(browser, `${ORIGIN}/index.html?v2debug=1#calendar/${slug}`, opts);
  await p.waitForFunction(() => window.calV2Status && window.calV2Status().subscribed, { timeout: 20000 }).catch(() => {});
  await p.waitForTimeout(2500);
  return p;
}
async function client(browser, name = 'Sidney Laruel', opts) {
  const token = await currentTestClientToken();
  const c = await ctx(browser, opts);
  const p = await c.newPage();
  capture(p);
  await gotoTestClientEntry(p, {
    origin: ORIGIN,
    view: 'calendar',
    name: TEST_CLIENT.name,
    token,
    gotoOptions: { waitUntil: 'domcontentloaded', timeout: 45000 },
  });
  await p.waitForTimeout(5000);
  return p;
}
async function kasper(browser, opts) {
  const p = await open(browser, `${ORIGIN}/index.html?Kasper=1&v2debug=1`, opts);
  await p.waitForTimeout(8000);   // Kasper loads many clients; give it room
  return p;
}

module.exports = { launch, open, ctx, smm, client, kasper, ORIGIN };
```

**Key public hooks the app exposes (read these, don't reinvent):**
- `window.calV2Status()` → `{ subscribed, ready, slug, … }` — realtime readiness.
- `window._kasperLoadReview(true)` — force a fresh Kasper queue+inbox load.
- `window._kasperGotoTab('review'|'replies'|'editors'|'filming')` — switch tabs.
- Many `window._cal*` / `window._kasper*` functions are exposed for driving the
  UI. **Not everything is on `window`** — some state objects (e.g.
  `_kasperState`) are module-scoped. When a global isn't exposed, **drive the UI
  through exposed functions and assert on the rendered DOM** instead of poking
  internals.

---

## 3. How to write a probe (the method)

A probe is a small standalone Node script that: seeds state through the **real
backend**, drives the **real UI**, then asserts on **observable output** (DOM
text, `data-*` attributes, backend rows). Use a 3-line pass/fail harness and a
non-zero exit on failure so the runner gives a clean signal.

### Backend constants (browser-safe public keys, already in `index.html`)
```js
const UPSERT = 'https://synchrosocial.app.n8n.cloud/webhook/calendar-upsert-post';
const SUPA   = 'https://uzltbbrjidmjwwfakwve.supabase.co/rest/v1/calendar_posts';
const KEY    = 'sb_publishable_P4-NdUWJqjtACWZOB6LPEA_8GANHAUA';  // read-only via RLS
```
- **Seed / mutate** through the upsert webhook (the same path the app uses), so
  the test exercises the true write flow:
  ```js
  const up = (post) => fetch(UPSERT, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client: 'sidneylaruel', post, comments_base_at: '' }) }).then(r => r.json());
  ```
- **Read back** from Supabase REST and **poll** — writes are not instant (n8n +
  Supabase mirror lag). Never assert immediately after a write:
  ```js
  const supa = async (id, sel) => (await (await fetch(`${SUPA}?id=eq.${id}&select=${sel}`,
    { headers: { apikey: KEY, Authorization: 'Bearer ' + KEY } })).json())[0] || {};
  const poll = async (id, sel, pred, ms = 15000) => { const t = Date.now(); let r;
    while (Date.now() - t < ms) { r = await supa(id, sel); if (pred(r)) return r; await new Promise(x => setTimeout(x, 800)); } return r; };
  ```

### Probe template
```js
// my_probe.js — Scoped to Sidney ONLY. Always cleans up what it creates.
const Q = require('./qalib.js');
const UPSERT = 'https://synchrosocial.app.n8n.cloud/webhook/calendar-upsert-post';
const up = (post) => fetch(UPSERT, { method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ client: 'sidneylaruel', post, comments_base_at: '' }) }).then(r => r.json());

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else fail++; console.log((c ? '  ✅ ' : '  ❌ ') + m); };

const TS = Math.floor(Date.now() / 1000);
const PID = 'p_probe_' + TS;     // unique id so parallel runs never collide

(async () => {
  // 1) SEED via the real backend path. A card needs an asset/thumb to clear
  //    Kasper's content gate; pick statuses that put it where you're testing.
  const TOMORROW = new Date(Date.now() + 86400e3).toISOString().slice(0, 10);
  await up({ id: PID, name: 'Probe ' + TS, platforms: 'youtube', scheduled_date: TOMORROW,
    status: 'In Progress', caption_status: 'Kasper Approval',
    thumbnail_url: 'https://placehold.co/320x180.png', asset_url: 'https://example.com/x.mp4' });

  // 2) DRIVE the real UI on the relevant surface.
  const browser = await Q.launch();
  const kas = await Q.kasper(browser);
  const res = await kas.evaluate(async (pid) => {
    for (let i = 0; i < 25; i++) {
      try { await window._kasperLoadReview(true); } catch (e) {}
      await new Promise(x => setTimeout(x, 1000));
      try { window._kasperGotoTab('review'); } catch (e) {}
      await new Promise(x => setTimeout(x, 300));
      const card = document.querySelector('.kcard[data-kasper-pid="' + pid + '"]');
      if (card) return { found: true, text: card.textContent };
    }
    return { found: false };
  }, PID);

  // 3) ASSERT on observable output (DOM here; could be backend rows via poll()).
  ok(res.found, 'card reaches the Kasper review queue');
  ok(kas._errs.length === 0, 'no JS errors (' + JSON.stringify(kas._errs.slice(0, 4)) + ')');

  // 4) CLEAN UP — archive what you created (tombstone any comments you added).
  await up({ id: PID, status: 'Archived' });

  console.log('PROBE: pass=' + pass + ' fail=' + fail, fail ? '❌' : '✅');
  await browser.close();
  process.exit(fail ? 1 : 0);   // non-zero on failure → clean runner signal
})();
```
Run it:
```bash
node my_probe.js 2>&1 | tail -15
```

### Principles
- **TEST LIKE A HUMAN — the rule that matters most.** For every surface, at least
  ONE probe must start from a COLD OPEN (no backend seeding at all) and drive the
  **primary user journey end-to-end through the real UI, exactly as a person
  would**: open the tab, click the button that **CREATES** the thing, type into
  the real inputs, paste the links, change the status by clicking the real
  controls, then **archive/delete** it — all via real clicks and typed text,
  never by calling a handler directly or inserting a row through the webhook.
  Seeding via `up(...)` is fine to set up a *specific downstream state* you want
  to test, but a suite that ONLY ever seeds has a fatal blind spot: it never
  proves the feature is **usable from zero**.
  > This is not hypothetical. The entire "Samples (Review)" tab shipped with no
  > "Add sample" button (and no delete) because every single probe seeded rows
  > through the webhook — so not one ever tried to *create* a sample the way a
  > human does, and the empty, unusable starting state was invisible to the whole
  > suite. The user found it by opening the tab once. A single cold-open smoke
  > test would have caught it instantly.

  **Litmus test:** if you deleted every `up(...)` / seed call from your probes,
  could at least one still prove a user can CREATE, edit, and remove the thing
  through the UI? If no, you have not tested the feature — you've tested its
  internals. Write the cold-open journey probe FIRST, before the edge-case probes.
- **Drive the app's own functions; assert on what the user can observe.** DOM
  text, `data-*` attributes, the backend row. Never assert on private internals —
  they change and they lie about user-visible behaviour.
- **One probe = one behaviour.** Small and focused beats a monolith. You'll run
  it dozens of times; keep it fast to read.
- **Always capture & assert JS errors** (`page._errs`). A green assertion with a
  console exception is a fail.
- **Poll, don't sleep-and-hope.** Backend writes settle asynchronously; loop
  until the expected state appears (with a timeout) instead of a fixed wait.
- **Unique ids per run** (`'p_' + Date.now()`), so re-runs and parallel runs
  never collide.

---

## 4. The loop (how to actually work)

```
write a focused probe  →  run it  →  read the RESULT + pass/fail line
        ↑                                   │
        └──────── fix the code ←── if ❌ : diagnose from the output
```
- Read the probe's printed `RESULT: {…}` and the `✅/❌` lines. That tells you
  what the app actually did.
- When it fails, fix `index.html` (or the probe if the probe was wrong — be
  honest about which), then re-run the **same** probe. Don't move on until it's
  green.
- Keep probes around (e.g. in `/tmp/qa/`). They're your regression net for the
  session.

---

## 5. Scope & safety — NOT OPTIONAL

The app reads/writes the **live** backend shared by **real clients**. A careless
probe can corrupt real data. Hard rules:

1. **Only ever mutate the test client: `sidneylaruel` ("Sidney Laruel").** Never
   write to any other client's cards, statuses, notes, or settings.
2. **This includes Kasper's cross-client tabs.** The Review/Messages/Editors tabs
   show *every* client. Read them freely, but only ever *act on* a Sidney card.
   When driving a Kasper handler, target a pid you created on Sidney.
3. **Always clean up what you create.** Archive test cards (`status: 'Archived'`)
   and tombstone test comments (`{…, deleted: true, updated_at: <now ISO>}`) at
   the end of every probe. Leave the test client as you found it.
4. **Frontend changes ship via a branch/PR, never to `main` directly** — `main`
   is the live site. Backend/workflow changes are even higher-stakes; don't
   touch shared workflows without explicit sign-off.
5. **Use unique ids** so you never accidentally overwrite a real or prior row.

---

## 6. Pre-push verification ritual

Before committing/pushing, run this every time. Tests are the deliverable's
proof — if something fails, say so with the output; don't push past red.

```bash
# 1) Syntax-check the inline script — catches a broken edit in <1s, before any browser.
node -e "const fs=require('fs');const h=fs.readFileSync('index.html','utf8');
const b=[...h.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]).sort((a,c)=>c.length-a.length)[0];
new (require('vm').Script)(b); console.log('✅ inline script parses');"

# 2) Run the whole suite via the blessed runner; trust EXIT CODES, not grep
#    (a test can legitimately print "0 failed").
node test/run-all.js || echo "UNIT SUITE FAILED"

# 3) Run your targeted live probe(s) for the behaviour you changed → expect pass=N fail=0.
node /tmp/qa/my_probe.js 2>&1 | tail -15
```
Only after all three are clean: commit and push.

---

## 7. Gotchas this workflow already hit (save yourself the time)

- **Local server dies** → `net::ERR_CONNECTION_REFUSED`. Restart with the §1
  guard line and re-run.
- **Not every global is on `window`.** `_kasperState` and many helpers are
  module-scoped. Driving via exposed `window._*` functions + reading the DOM is
  the reliable path; if you truly need an internal, assert on the DOM it
  produces instead.
- **Placeholder-image failures are not app errors.** A stock image host
  (`placehold.co` etc.) erroring is noise — that's why `capture()` only flags
  `synchrosocial|supabase` request failures.
- **ISO timestamps sort lexicographically.** `String(a).localeCompare(String(b))`
  on ISO 8601 is correct chronological order — used for "newest first" asserts.
- **Realtime needs a beat.** Wait on `calV2Status().subscribed` (SMM) / give
  Kasper ~8s before asserting, or you'll read a half-loaded page.
- **Timezone bugs need a timezone.** Reproduce date off-by-ones with
  `timezoneId: 'America/Argentina/Buenos_Aires'` on the context.
- **Content gate:** a card needs `asset_url` *or* `thumbnail_url` to appear in
  Kasper's queue. A statuses-only card silently won't show.
- **Writes are async.** Poll Supabase/DOM until convergence; don't assert right
  after `up()`.

---

## 8. Checklist to hand a fresh session

- [ ] Start the static server (§1) and confirm `200`.
- [ ] Drop `qalib.js` (§2) next to your probes.
- [ ] For each behaviour: write a focused probe from the template (§3); seed via
      the upsert webhook; drive the real UI; assert on DOM/backend; assert 0 JS
      errors; **clean up**.
- [ ] Loop until green (§4). Only ever touch **`sidneylaruel`** (§5).
- [ ] Before pushing: syntax-check → full `test/*.js` suite (exit codes) →
      targeted probes (§6). Push only verified changes, on a branch/PR.
