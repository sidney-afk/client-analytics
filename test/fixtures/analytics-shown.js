'use strict';
/* Analytics is hidden for everyone unless the analytics_hidden runtime flag reads { "hidden": false } (session Curtain
   Seven, 2026-10-17). The browser tests that still exercise Analytics (the staff bar's tab, a client link's Analytics
   page and toggle) bring it back in their browser context with this: the review page's switch read answers
   analytics_hidden { hidden: false }, and the browser has already seen Analytics shown, so a client link opens it
   exactly as before. Every other request goes on to the test's own handlers. */
async function analyticsShown(ctx) {
  await ctx.addInitScript(() => { try { localStorage.setItem('sv-analytics-shown', '1'); } catch (e) {} });
  await ctx.route('**/rest/v1/syncview_runtime_flags?**', route => {
    if (!/analytics_hidden/.test(decodeURIComponent(route.request().url()))) return route.fallback();
    return route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*' }, contentType: 'application/json', body: JSON.stringify([{ key: 'analytics_hidden', value: { hidden: false } }]) });
  });
}
module.exports = { analyticsShown };
