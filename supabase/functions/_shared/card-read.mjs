// GET-only card reader. The credential determines scope; filters never grant it.
export async function handleCardRead(req, deps) {
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'apikey, authorization, x-syncview-key, x-syncview-client-token, x-syncview-actor, x-syncview-role', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Cache-Control': 'no-store' };
  const reply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'GET') return reply({ error: 'method_not_allowed' }, 405);
  try {
    const url = new URL(req.url), q = url.searchParams;
    const table = q.get('table');
    if (!['calendar_posts', 'sample_reviews'].includes(table) || q.getAll('table').length !== 1) return reply({ error: 'invalid_table' }, 400);
    q.delete('table');
    const key = (req.headers.get('x-syncview-key') || '').trim();
    const token = (req.headers.get('x-syncview-client-token') || '').trim();
    if (!!key === !!token) return reply({ error: 'credentials_required' }, 401);
    const allowed = new Set(['select', 'order', 'limit', 'offset', 'or', 'and', 'client', 'id', 'name', 'status', 'scheduled_date', 'updated_at', 'video_status', 'graphic_status', 'caption_status', 'title_status', 'video_deliverable_id', 'graphic_deliverable_id']);
    for (const [k, v] of q) {
      if (!allowed.has(k) || v.length > 16000) return reply({ error: 'invalid_query' }, 400);
    }
    // No joins, aliases, embedded resources, or arbitrary service-role headers.
    if (q.getAll('select').length > 1 || !/^(\*|[a-z_][a-z0-9_]*(,[a-z_][a-z0-9_]*)*)$/.test(q.get('select') || '*')) return reply({ error: 'invalid_select' }, 400);
    if (q.getAll('order').length > 1 || (q.has('order') && !/^[a-z_][a-z0-9_]*\.(asc|desc)(\.(nullsfirst|nullslast))?(,[a-z_][a-z0-9_]*\.(asc|desc)(\.(nullsfirst|nullslast))?)*$/.test(q.get('order')))) return reply({ error: 'invalid_order' }, 400);
    for (const [name, max] of [['limit', 1000], ['offset', 100000]]) {
      if (q.getAll(name).length > 1 || (q.has(name) && (!/^\d+$/.test(q.get(name)) || Number(q.get(name)) > max))) return reply({ error: 'invalid_page' }, 400);
    }
    q.set('limit', q.get('limit') || '1000');
    if (key) {
      if (!deps.staffAuthorized(key)) return reply({ error: 'unauthorized' }, 401);
    } else {
      // A client read must name exactly one slug. Active roster and token are
      // checked together; no permissive auth flag or caller-supplied role.
      const clients = q.getAll('client');
      if (clients.length !== 1 || !/^eq\.[a-z0-9&]+$/.test(clients[0])) return reply({ error: 'client_scope_required' }, 403);
      const slug = clients[0].slice(3);
      if (!await deps.clientAuthorized(slug, token)) return reply({ error: 'unauthorized' }, 401);
      // Keep the top-level equality even when the query contains OR cursors.
      q.set('client', 'eq.' + slug);
    }
    const response = await deps.read(table, q);
    if (!response.ok) return reply({ error: 'read_unavailable' }, 502);
    const rows = await response.json();
    if (!Array.isArray(rows)) return reply({ error: 'invalid_read_response' }, 502);
    return reply(rows);
  } catch (_) { return reply({ error: 'read_unavailable' }, 503); }
}
