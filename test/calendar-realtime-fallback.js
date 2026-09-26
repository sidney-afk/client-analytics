'use strict';
/* Calendar / client-link live-update safety net (src/index/150-...).
   Measured 2026-09-26: calV2Status().subscribed read true while every realtime
   handshake failed, and an open page never picked up another page's change.
   The page now tracks the real connection state and pulls on a timer while it
   is not connected. Live proof: qa/realtime-fallback/client-link-fallback.js. */
const fs = require('fs');
const path = require('path');
const s = fs.readFileSync(path.join(__dirname, '..', 'src/index/150-calendar-hydration-import.js.part'), 'utf8');
let failed = 0;
const t = (ok, msg) => { console.log((ok ? '  ok  ' : '  ❌  ') + msg); if (!ok) failed++; };
t(/_calV2SetRtState\(String\(status \|\| ''\)\)/.test(s), 'the subscribe callback records the real connection state');
t(/_calV2SetRtState\('connecting'\);\s*_calV2StartFallback\(slug, lease\);/.test(s), 'a new channel starts as connecting with the fallback armed');
t(/connected: _calV2RtState === 'SUBSCRIBED'/.test(s), 'calV2Status().connected is true only when the channel is SUBSCRIBED');
t(/subscribed: !!_calV2Channel/.test(s), 'calV2Status().subscribed keeps its old meaning for existing probes');
t(/_calV2StopFallback\(\);\s*_calV2SetRtState\('idle'\);/.test(s), 'dropping the channel stops the fallback');
const tick = s.slice(s.indexOf('function fallbackTick'), s.indexOf('function fallbackTick') + 900);
t(/_calV2RtState !== 'SUBSCRIBED'/.test(tick) && /_calV2OnRealtimeChange\(slug, lease\)/.test(tick), 'while not connected the fallback pulls through the normal realtime path (debounce, self-echo, floor)');
t(/visibilityState !== 'hidden'/.test(tick), 'the fallback does not pull on a hidden tab');
t(/CAL_V2_FALLBACK_POLL_MS = 30000/.test(s) && /CAL_V2_CONNECT_GRACE_MS = 15000/.test(s), 'fallback every 30 s, after a 15 s grace to connect');
if (failed) { console.error('calendar-realtime-fallback: ' + failed + ' failed'); process.exit(1); }
console.log('calendar-realtime-fallback: all checks passed');
