import { createClient } from 'npm:@supabase/supabase-js@2.49.8';
import { authorizeStaffKey, timingSafeEqual } from '../_shared/staff-role-auth.ts';
import { handleCardRead } from '../_shared/card-read.mjs';

Deno.serve((req: Request) => handleCardRead(req, {
  staffAuthorized: (key: string) => authorizeStaffKey(key, ['admin', 'smm', 'creative']).ok,
  clientAuthorized: async (slug: string, token: string) => {
    const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
    const { data, error } = await db.from('client_access')
      .select('slug,review_token,client:clients!inner(slug,active)').eq('slug', slug).maybeSingle();
    if (error) throw error;
    const client = Array.isArray(data?.client) ? data.client[0] : data?.client;
    return client?.active === true && client?.slug === slug && !!data?.review_token && timingSafeEqual(token, data.review_token);
  },
  read: (table: string, query: URLSearchParams) => {
    const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    return fetch(Deno.env.get('SUPABASE_URL')! + '/rest/v1/' + table + '?' + query, {
      headers: { apikey: key, Authorization: 'Bearer ' + key, Accept: 'application/json' }, signal: AbortSignal.timeout(12000),
    });
  },
}));
