/*
 * A fault-injecting wrapper around supabase-shim.mjs, for the assignee lane.
 *
 * The SQL shim's hooks cover RPCs only; the assignee policy is a plain table
 * read (`syncview_runtime_flags` filtered to one key), and the lane needs that
 * ONE read to fail at the real handler without touching any other read the
 * same request performs (prod_authority, public_intake_enabled, the roster).
 * This wrapper returns the shim's own builder for every table and every
 * filter except the faulted one, so nothing is modeled: a faulted read
 * resolves to the exact `{ data: null, error }` shape supabase-js hands back
 * on a failed request, and the handler reacts with its own code.
 *
 * supabase-shim.mjs stays a byte copy of the PR1274 shim on purpose; this file
 * wraps it rather than editing it.
 */
import * as shim from './supabase-shim.mjs';

export const faults = {
  /* Set to a predicate `(table, filters) => boolean`; matching selects fail. */
  selectFails: null,
  attempted: [],
};

export function resetFaults() {
  faults.selectFails = null;
  faults.attempted.length = 0;
}

export const hooks = shim.hooks;
export const resetHooks = shim.resetHooks;
export const runSql = shim.runSql;

function wrapBuilder(builder, table) {
  const proxy = new Proxy(builder, {
    get(target, property) {
      if (property === 'then') {
        return (resolve, reject) => {
          const filters = Array.isArray(target.filters) ? target.filters : [];
          if (target.op === 'select' && typeof faults.selectFails === 'function'
              && faults.selectFails(table, filters)) {
            faults.attempted.push({ table, filters: filters.map(f => [f.col, f.op, f.val]) });
            const error = { code: 'PGRST000', message: 'injected: policy flag unreadable', details: '', hint: '' };
            return Promise.resolve({ data: null, error }).then(resolve, reject);
          }
          return target.then(resolve, reject);
        };
      }
      const value = target[property];
      if (typeof value !== 'function') return value;
      return (...args) => {
        const result = value.apply(target, args);
        return result === target ? proxy : result;
      };
    },
  });
  return proxy;
}

export function createClient(...args) {
  const client = shim.createClient(...args);
  return {
    ...client,
    from(table) { return wrapBuilder(client.from(table), table); },
    rpc(...rpcArgs) { return client.rpc(...rpcArgs); },
  };
}

export class SupabaseClient {}
