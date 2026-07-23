# Visible boot-sequence lane

`client-entry-sequence.js` is the offline browser guard for first paint, reload,
Back/Forward Cache restore, and route ownership. It does not wait for a settled
page and then infer what happened earlier. Its local server sends `index.html`
in two chunks:

1. the complete static document through the body skeletons;
2. the main application script only after Chromium has visibly painted the
   expected first-frame skeleton.

An animation-frame observer records every distinct visible state. The lane fails
if Calendar, Brief, an invalid client link, or a client Samples review ever
paints the Analytics overview, staff chrome, Production, or retired Samples
surface.

## Coverage

- staff client-profile history reload: Calendar and Brief own first paint;
- client Calendar and Brief links: neutral verification, then a route-owned
  loader, then the requested tab, on first navigation and reload;
- client Brief lifetime: a real `pagehide` retires polling intervals, delayed
  tab-summary starts, active tab-summary transport, and both Brief-sheet reads;
  deliberately late synthetic responses cannot repopulate state, localStorage,
  or the retired document after client capability is revoked;
- Calendar → Brief → Back → Forward stays inside the verified client envelope,
  and a calendar/brief-only client can switch to honest empty Analytics without
  a URL/content split;
- F102: missing, unknown, invalid, duplicate, `c + prod`, and mixed-hash entries
  fail closed without client-data reads or a staff fallback; rotated-token
  reloads, incomplete legacy verifier responses, and display-name/slug mismatch
  are denied before stale or fresh client data can paint;
- F102 cross-document Back: full Chromium must report `pageshow.persisted=true`,
  repaint the neutral verifier, and deny a rotated token without restoring a
  cached Calendar or issuing a client read;
- F102 pending-read Back: all six deliberately held analytics essentials/extras
  are aborted at `pagehide`; after the persisted return is denied, the harness
  releases those uncooperative old responses and proves they cannot apply,
  recreate cache, repaint, or revive a seeded staff caption job;
- F102 Calendar ownership: a held client Calendar read is signal-aborted on a
  real Calendar → Brief click and remains unable to apply/cache/paint after its
  late release; Calendar → Analytics retires a deliberately paused realtime
  factory before release; a standalone A → B tab click keeps B's visible loader
  and controller through A's old `finally`; and a third held Calendar read is
  aborted at `pagehide` before persisted rotated-token denial, with no late
  data, cache, DOM, realtime, staff-state, or capability revival;
- staff Calendar ownership: a held v1 Linear reconcile released after a real
  A → B tab click cannot enqueue edits, write, cache, or render into B; pending
  and settled Calendars flush writers then retire primary/post-load/realtime
  ownership at `pagehide`; real persisted Back visibly installs exactly one
  fresh read despite return throttles; and a held forced-meta continuation
  released after B owns the route cannot mutate shared banner state,
  localStorage, cache, writes, or visible DOM;
- F117: legacy `v=samples` binds the server-verified client, canonicalizes to
  `v=sample-reviews&sxr=1`, ignores a different saved client and a stored staff
  opt-out without mutating either sticky flag, and remains exact across reload
  plus real Back/Forward traversal; every recorded frame rejects generic SXR,
  a wrong embedded client, and the Add-client switcher;
- F117 pending-read Back: a deliberately held exact-client Samples request is
  signal-aborted on `pagehide`; a persisted rotated-token denial stays terminal
  after the late response is released, with no row apply, cache write, generic
  mount, wrong client, or Add-client frame;
- F184: startup plus the installed focus, online, visible, and 60-second retry
  callbacks inspect no retry storage while strict verification is pending or
  returns 500. After explicit retry, a held queue-routing read is released only
  after a real `pageshow.persisted=true` BFCache return has revoked its exact
  generation, proving the stale continuation cannot inspect, POST, or finalize.
  A later strict retry sends only matching client-A Calendar debt through a
  synthetic 500/success cycle while foreign client-B and unknown rows remain
  byte-identical. A seeded staff-only Calendar-card job remains byte-identical,
  unread, and never invokes its runner throughout the visible sequence.

Every external request is synthetically satisfied or blocked. Google Sheets,
Supabase, n8n, fonts, and Chart.js receive fictional in-memory fixtures; the
BFCache context removes browser interception (which disables BFCache), strips
external document assets, and applies a loopback-only DNS rule plus an in-page
synthetic transport. An unrecognized request, browser console error, or uncaught
page error fails the run. No live client, TEST client, credential, writer, or
runtime flag is read or changed.

Probe subprocesses receive the issuer key only when their exact basename is in
the reviewed client-entry capability registry. Parity, staff-only, and unknown
manual probes remain credential-free, and no subprocess receives a client token.

## Run

```bash
npm run test:boot
```

The command makes one attempt per navigation. There is no scenario retry.
