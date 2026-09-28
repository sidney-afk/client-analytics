'use strict';
/* A synthetic client link, fully offline, for browser suites that need the
 * client's own view (Calendar or Sample reviews) to draw a review card.
 * Same shape as client-phone-review-browser.js. No real client, key or data. */
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS' };
const CLIENT = 'Link Fixture Client';
const SLUG = 'linkfixtureclient';
const TOKEN = 'synthetic-link-token';
const SURFACES = {
  calendar: { query: { v: 'calendar' }, table: 'calendar_posts', card: 'p_link_fixture_1' },
  samples: { query: { v: 'sample-reviews', sxr: '1' }, table: 'sample_reviews', card: 'sr_link_fixture_1' },
  analytics: { query: {}, table: null, card: null },
};
const ROW = {
  client: SLUG, name: 'Link fixture post', status: 'In Progress', scheduled_date: null, order_index: 1,
  updated_at: '2026-09-20T12:00:00.000Z', asset_url: 'https://example.invalid/video.mp4', thumbnail_url: '',
  video_status: 'Client Approval', graphic_status: 'Client Approval', caption_status: 'Client Approval',
  caption: 'Fixture caption', comments: [], graphic_comments: [], caption_comments: [],
};

// Answers every request outside the local server for the given surface.
function clientLinkRoute(surface) {
  const { table, card } = SURFACES[surface];
  const row = Object.assign({}, ROW, { id: card });
  return route => {
    const r = route.request(); const u = new URL(r.url());
    const json = body => route.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: JSON.stringify(body) });
    if (r.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS, body: '' });
    if (u.pathname === '/functions/v1/client-token-verify') {
      let body = {}; try { body = JSON.parse(r.postData() || '{}'); } catch (e) {}
      return json({ ok: true, valid: true, allowed: true, slug: SLUG, display_name: CLIENT, view: body.view, strict: true, active: true, protocol: 'syncview-client-entry-v1' });
    }
    if (r.method() !== 'GET' && r.method() !== 'HEAD') return json({ ok: true });
    if (table && u.pathname === '/rest/v1/' + table) return json([row]);
    if (u.pathname === '/rest/v1/clients') return json([{ slug: SLUG, kind: 'client', active: true }]);
    if (u.pathname === '/rest/v1/syncview_runtime_flags' && /prod_authority/.test(u.search)) return json([{ value: { video: 'linear', graphics: 'linear' } }]);
    if (/\/rest\/v1\//.test(u.pathname)) return json([]);
    if (/\/functions\/v1\/|\/webhook\//.test(u.pathname)) return json({});
    if (/docs\.google\.com/.test(u.host)) return route.fulfill({ status: 200, headers: CORS, contentType: 'text/csv', body: '' });
    return route.abort();
  };
}
const clientLinkUrl = (origin, surface) => `${origin}/index.html?${new URLSearchParams(Object.assign({ c: CLIENT, t: TOKEN }, SURFACES[surface].query))}`;
const clientLinkCard = surface => SURFACES[surface].card && `.kcard[data-cal-review-pid="${SURFACES[surface].card}"]`;

module.exports = { CORS, clientLinkRoute, clientLinkUrl, clientLinkCard };
