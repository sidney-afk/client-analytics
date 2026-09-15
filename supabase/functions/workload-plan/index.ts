// Supabase Edge Function: workload-plan
//
// Staff-readable projection and Admin/SMM-only writer for internal Workload
// plan days. The versioned native/explicit-legacy snapshot and alias adapter
// keep historical storage keys intact. Only the workload_plan sidecar is
// written; current team authority is read and never changed here.

import {
  createClient,
  type SupabaseClient,
} from "npm:@supabase/supabase-js@2.49.8";
import {
  authorizeBrowserWrite,
  browserWriteAuthResponse,
  normalizeBrowserWriteClient,
  type BrowserWritePrincipal,
} from "../_shared/browser-write-auth.ts";
import {
  authorizeStaffKey,
  staffAuthFailureStatus,
  type StaffRoleKey,
} from "../_shared/staff-role-auth.ts";
import { projectNativeSnapshot, legacyPlanAliases } from "./native-snapshot.mjs";

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-syncview-key, x-syncview-actor, x-syncview-role, x-syncview-source, x-syncview-client-token",
  "Cache-Control": "no-store",
};

const WORKLOAD_PLAN_READ_ROLES: readonly StaffRoleKey[] = [
  "admin",
  "smm",
  "creative",
];
const WORKLOAD_PLAN_WRITE_ROLES: readonly StaffRoleKey[] = [
  "admin",
  "smm",
];
const SAFE_ISSUE_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const LIST_PAGE_SIZE = 1000;
const MAX_LIST_PAGES = 50;
// How long `action:'list'` will wait for the enriched snapshot before answering
// from the bounded read instead. Deliberately well inside the compatibility
// client's 8s abort (WL_PLAN_READ_TIMEOUT_MS, index.html) so the direct read
// still has room to finish and reach the browser.
//
// RAISED 3000 -> 5000 on 2026-09-15. MEASURED in production logs: the enriched
// snapshot lands at 2.5-2.8s, so a 3s deadline was a coin flip -- roughly half
// of all `list` calls logged `ok_unaliased` and dropped the provider aliases.
// An override stored under a native id is invisible to a board keyed on the
// Linear uuid, so those cards silently fell back to automatic placement while
// a board that won the race showed the saved day. Two people, one card, two
// different days, no warning anywhere. 5s is ~1.8x the measured cost and still
// leaves 3s of margin inside the client's 8s abort -- margin that matters,
// because a snapshot that HANGS is now held for 5s before the bounded read is
// allowed to answer, and overrunning the abort costs every saved day at once
// plus the ability to edit, which is strictly worse than an unaliased list.
//
// The budget alone was only headroom -- the deadline is still a race and the
// snapshot still grows with the board -- so losing it no longer costs the
// aliases: `planAliasPairs` below gives the fallback its own pairing. What is
// left for this constant to protect is LATENCY, not correctness.
const LIST_ENRICH_BUDGET_MS = 5000;
// The degraded path's own bound. Two indexed `in` reads over at most this many
// ids, raced against a deadline of their own: the fallback exists because the
// enriched read was slow, so it must not become a second way to overrun the
// browser's 8s abort.
const PAIR_CHUNK = 500;
const PAIR_BUDGET_MS = 1200;

type JsonMap = Record<string, unknown>;
type PlanRow = {
  issue_id: string;
  client: string;
  plan_date: string | null;
  updated_at: string;
};

class WorkloadPlanError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string) {
    super(code);
    this.name = "WorkloadPlanError";
    this.status = status;
    this.code = code;
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

function clean(value: unknown): string {
  return String(value == null ? "" : value).trim();
}

function isWorkloadPlanWriteRole(role: string): role is StaffRoleKey {
  return (WORKLOAD_PLAN_WRITE_ROLES as readonly string[]).includes(role);
}

function serviceClient(): SupabaseClient {
  const url = clean(Deno.env.get("SUPABASE_URL"));
  const key = clean(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
  if (!url || !key) throw new WorkloadPlanError(503, "service_unavailable");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function requestBody(req: Request): Promise<JsonMap> {
  let parsed: unknown;
  try {
    parsed = await req.json();
  } catch (_error) {
    throw new WorkloadPlanError(400, "invalid_json");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new WorkloadPlanError(400, "invalid_body");
  }
  return parsed as JsonMap;
}

function parsePlanDate(value: unknown): string | null {
  if (value === null) return null;
  const date = clean(value);
  if (!ISO_DATE.test(date)) {
    throw new WorkloadPlanError(400, "invalid_plan_date");
  }
  const parsed = new Date(`${date}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new WorkloadPlanError(400, "invalid_plan_date");
  }
  return date;
}

function planRow(row: JsonMap): PlanRow {
  return {
    issue_id: clean(row.issue_id),
    client: clean(row.client),
    plan_date: row.plan_date == null ? null : clean(row.plan_date),
    updated_at: clean(row.updated_at),
  };
}

function requireListStaff(req: Request): StaffRoleKey {
  const key = clean(req.headers.get("x-syncview-key"));
  const auth = authorizeStaffKey(key, WORKLOAD_PLAN_READ_ROLES);
  if (!auth.ok || !auth.role) {
    throw new WorkloadPlanError(
      staffAuthFailureStatus(auth),
      auth.role ? "forbidden" : "unauthorized",
    );
  }
  return auth.role;
}

async function listPlans(db: SupabaseClient): Promise<PlanRow[]> {
  const plans: PlanRow[] = [];
  let afterIssueId = "";
  for (let page = 0; page < MAX_LIST_PAGES; page++) {
    let query = db
      .from("workload_plan")
      .select("issue_id,client,plan_date,updated_at")
      .not("plan_date", "is", null)
      .order("issue_id", { ascending: true })
      .limit(LIST_PAGE_SIZE);
    if (afterIssueId) query = query.gt("issue_id", afterIssueId);
    const { data, error } = await query;
    if (error) throw new WorkloadPlanError(500, "plan_list_failed");
    if (!Array.isArray(data)) throw new WorkloadPlanError(500, "plan_list_failed");
    plans.push(...data.map((row) => planRow(row as JsonMap)));
    if (data.length < LIST_PAGE_SIZE) return plans;
    const nextAfter = clean((data[data.length - 1] as JsonMap).issue_id);
    if (!nextAfter || nextAfter === afterIssueId) {
      throw new WorkloadPlanError(500, "plan_list_failed");
    }
    afterIssueId = nextAfter;
  }
  // Returning a partial list would make existing overrides appear to vanish.
  throw new WorkloadPlanError(503, "plan_list_limit");
}

/* THE DEGRADED PATH MUST STILL ANSWER IN BOTH NAMESPACES.
 *
 * `workload_plan` holds two identity namespaces for the same card -- the Linear
 * issue uuid and the native `del_...` deliverable id -- and the board keys on
 * whichever one its own source gave it. `legacyPlanAliases()` reconciles them
 * from the enriched snapshot, so when the snapshot loses its race the answer
 * went out keyed EXACTLY AS STORED, and a board keyed on the other name simply
 * could not see those overrides. Those cards then fell back to automatic
 * placement, one working day before the deadline, on a board that looked
 * completely normal. Two people, one card, two different columns, decided by
 * nothing but which side of a deadline their page load landed on.
 *
 * Raising the deadline only moved the coin. This is the fix: the fallback
 * builds the id pairing ITSELF, from the one relation that actually holds it,
 * bounded to the ids in the answer it is already returning. It cannot be made
 * slow by the size of the board, and it does not care WHY the snapshot was
 * unavailable -- slow, hung, or refused by its own validator, the pairing is
 * the same.
 *
 * It is deliberately NOT a second implementation of the snapshot's contract. It
 * proves one thing only -- these two ids are the same card, and it belongs to
 * this client -- and it keeps the safety property that matters: a stored day
 * whose client no longer matches its card's is never re-keyed onto that card.
 * Ambiguity is refused rather than guessed: a native row claiming a Linear id
 * that another row also claims aliases neither.
 */
type AliasPair = { id: string; client: string };

async function planAliasPairs(
  db: SupabaseClient,
  plans: PlanRow[],
): Promise<Map<string, AliasPair> | null> {
  const ids = [...new Set(plans.map((plan) => plan.issue_id).filter((id) => !!id))];
  const pairs = new Map<string, AliasPair>();
  if (!ids.length) return pairs;

  const rows: JsonMap[] = [];
  for (let from = 0; from < ids.length; from += PAIR_CHUNK) {
    const chunk = ids.slice(from, from + PAIR_CHUNK);
    // A stored key can be either half of the pair, so both halves are asked for.
    const [native, provider] = await Promise.all([
      db.from("deliverables").select("id,linear_issue_uuid,client_slug").in("id", chunk),
      db.from("deliverables").select("id,linear_issue_uuid,client_slug").in("linear_issue_uuid", chunk),
    ]);
    if (native.error || provider.error) return null;
    if (!Array.isArray(native.data) || !Array.isArray(provider.data)) return null;
    rows.push(...(native.data as JsonMap[]), ...(provider.data as JsonMap[]));
  }

  const owners = new Map<string, AliasPair>();
  const claimed = new Map<string, string>();
  const ambiguous = new Set<string>();
  for (const row of rows) {
    const nativeId = clean(row.id);
    const linearId = clean(row.linear_issue_uuid);
    const client = normalizeBrowserWriteClient(row.client_slug);
    if (!nativeId || !linearId || !client) continue;
    const seen = owners.get(nativeId);
    if (seen && (seen.id !== linearId || seen.client !== client)) {
      ambiguous.add(nativeId);
      ambiguous.add(linearId);
      ambiguous.add(seen.id);
      continue;
    }
    owners.set(nativeId, { id: linearId, client });
    const claim = claimed.get(linearId);
    if (claim && claim !== nativeId) {
      ambiguous.add(linearId);
      ambiguous.add(nativeId);
      ambiguous.add(claim);
      continue;
    }
    claimed.set(linearId, nativeId);
  }
  /* CONFIRM EVERY CANDIDATE LINEAR ID BEFORE ALIASING TO IT.
   *
   * The reads above are bounded to the ids in the ANSWER, which is what keeps
   * this cheap -- and it is also what makes the pass above blind. An override
   * stored under a native id tells us which Linear id its own row claims; it
   * says nothing about whether a SECOND deliverable claims the same one, and
   * that row is not in the answer, so it was never read. Aliasing on that
   * evidence could hand a saved work day to a card it does not belong to,
   * which is the one thing this whole path must never do. A test caught it.
   *
   * So each candidate Linear id is asked about directly: exactly one
   * deliverable may claim it, and it must be the one we already have. Anything
   * else is ambiguous and aliases neither side. One extra bounded read, and the
   * pairing is proven rather than assumed. */
  const candidates = [...new Set([...owners.values()].map((owner) => owner.id))]
    .filter((linearId) => !ambiguous.has(linearId));
  for (let from = 0; from < candidates.length; from += PAIR_CHUNK) {
    const chunk = candidates.slice(from, from + PAIR_CHUNK);
    const confirm = await db.from("deliverables").select("id,linear_issue_uuid").in(
      "linear_issue_uuid",
      chunk,
    );
    if (confirm.error || !Array.isArray(confirm.data)) return null;
    const claims = new Map<string, number>();
    for (const row of confirm.data as JsonMap[]) {
      const linearId = clean(row.linear_issue_uuid);
      const nativeId = clean(row.id);
      if (!linearId) continue;
      claims.set(linearId, (claims.get(linearId) || 0) + 1);
      if (claimed.get(linearId) !== nativeId) ambiguous.add(linearId);
    }
    for (const linearId of chunk) {
      if (claims.get(linearId) !== 1) ambiguous.add(linearId);
    }
  }

  for (const [nativeId, owner] of owners) {
    if (ambiguous.has(nativeId) || ambiguous.has(owner.id)) continue;
    pairs.set(nativeId, { id: owner.id, client: owner.client });
    pairs.set(owner.id, { id: nativeId, client: owner.client });
  }
  return pairs;
}

function pairedPlanAliases(
  plans: PlanRow[],
  pairs: Map<string, AliasPair>,
): { plans: PlanRow[]; unaliased: number; drifted: number } {
  const stored = new Set(plans.map((plan) => plan.issue_id));
  const emitted = new Set<string>();
  const out: PlanRow[] = [];
  let unaliased = 0;
  let drifted = 0;
  for (const plan of plans) {
    out.push(plan);
    const pair = pairs.get(plan.issue_id);
    // NO TWIN IS NOT A FAULT. A card that only ever had one identity is the
    // ordinary shape of the legacy teams, and counting it would raise a warning
    // that then stands forever. A standing false warning is how a true one
    // stops being read.
    if (!pair) continue;
    // Already stored under both names: nothing to add, nothing to report.
    if (stored.has(pair.id)) continue;
    /* DRIFT IS COUNTED APART FROM FAILURE, and that distinction is the whole
     * reason this returns two numbers.
     *
     * A saved day whose client no longer matches its card's is refused here for
     * the same reason the snapshot validator drops it: re-keying it would move
     * that day onto another client's card. But it is OLD, it is PERMANENT until
     * somebody repairs the data, and the snapshot path has been dropping the
     * same rows silently for weeks. Reporting it as a match failure would put a
     * number on the board that never goes down and that nobody can act on from
     * there -- the standing warning that teaches people to ignore warnings. It
     * travels as its own field for whoever is looking; it does not speak on the
     * board.
     *
     * `unaliased` is reserved for what is genuinely unexpected: two saved days
     * claiming one alias. That is a real, actionable, non-permanent fault. */
    if (pair.client !== plan.client) {
      drifted++;
      continue;
    }
    if (emitted.has(pair.id)) {
      unaliased++;
      continue;
    }
    emitted.add(pair.id);
    out.push({ ...plan, issue_id: pair.id });
  }
  return { plans: out, unaliased, drifted };
}

async function nativeSnapshot(db: SupabaseClient): Promise<JsonMap> {
  const {data,error}=await db.rpc("workload_native_snapshot_v1");
  if (error) throw new WorkloadPlanError(503,"workload_snapshot_unavailable");
  try { return projectNativeSnapshot(data,normalizeBrowserWriteClient); }
  catch { throw new WorkloadPlanError(503,"workload_snapshot_incomplete"); }
}

async function nativePlanTarget(db: SupabaseClient,issueId:string): Promise<JsonMap|null> {
  const {data,error}=await db.rpc("workload_native_plan_target_v1",{p_issue_id:issueId});
  if (error) throw new WorkloadPlanError(503,"workload_plan_target_unavailable");
  if (data===null) return null;
  if (!data || typeof data!=="object" || Array.isArray(data) || !clean(data.id)
      || !clean(data.client_slug) || typeof data.active!=="boolean") {
    throw new WorkloadPlanError(503,"workload_plan_target_incomplete");
  }
  return data as JsonMap;
}

async function requireWritableIssue(
  db: SupabaseClient,
  issueId: string,
  client: string,
): Promise<void> {
  const { data, error } = await db
    .from("workload_issues")
    .select("id,client_name,is_sub_issue,active,team_key")
    .eq("id", issueId)
    .maybeSingle();
  if (error) throw new WorkloadPlanError(500, "issue_lookup_failed");

  const target = data as JsonMap | null;
  if (target && ["VID","GRA"].includes(clean(target.team_key))) {
    const {data: flag,error: flagError}=await db.from("syncview_runtime_flags")
      .select("value").eq("key","prod_authority").maybeSingle();
    const team=target.team_key==="VID"?"video":"graphics";
    const value=flag && flag.value;
    if (flagError || !value || typeof value!=="object"
        || !["linear","syncview"].includes(value[team])) {
      throw new WorkloadPlanError(503,"workload_authority_unavailable");
    }
    if (value[team]!=="linear") throw new WorkloadPlanError(409,"native_issue_unavailable");
  }
  if (
    !target ||
    target.active !== true ||
    target.is_sub_issue !== true ||
    normalizeBrowserWriteClient(target.client_name) !== client
  ) {
    // Keep missing, inactive, parent, and cross-client targets indistinguishable.
    throw new WorkloadPlanError(409, "issue_not_writable");
  }
}

async function setPlan(
  db: SupabaseClient,
  principal: BrowserWritePrincipal,
  issueId: string,
  client: string,
  planDate: string | null,
): Promise<{ updated: number; plan: PlanRow | null }> {
  const now = new Date().toISOString();
  const { data, error } = await db
    .from("workload_plan")
    .upsert({
      issue_id: issueId,
      client,
      plan_date: planDate,
      updated_by: principal.actor,
      updated_at: now,
    }, { onConflict: "issue_id" })
    .select("issue_id,client,plan_date,updated_at");
  if (error) throw new WorkloadPlanError(500, "plan_write_failed");

  // F141 invariant: report rows actually returned by the write, never the
  // requested count or a literal success count.
  const updated = Array.isArray(data) ? data.length : 0;
  return {
    updated,
    plan: updated === 1 ? planRow(data[0] as JsonMap) : null,
  };
}

Deno.serve(async (req: Request): Promise<Response> => {
  const started = Date.now();
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }
  if (req.method !== "POST") {
    return json({ ok: false, error: "method_not_allowed" }, 405);
  }

  let action = "invalid";
  let outcome = "error";
  let writeCount = 0;

  try {
    const body = await requestBody(req);
    const requestedAction = clean(body.action).toLowerCase();
    if (!["list","set","native_snapshot"].includes(requestedAction)) {
      throw new WorkloadPlanError(400, "invalid_action");
    }
    action = requestedAction;

    if (action === "native_snapshot") {
      requireListStaff(req);
      const snapshot = await nativeSnapshot(serviceClient());
      outcome = "ok";
      return json(snapshot);
    }

    /* THE COMPATIBILITY ACTION MUST NOT DEPEND ON SNAPSHOT VALIDATION.
     *
     * `list` is what an OLD or still-open browser bundle calls. Routing it
     * through nativeSnapshot() made an otherwise readable plan list fail 503 on
     * ANY of the validator's all-or-nothing refusals -- a count mismatch, a
     * duplicate row, a missing authority, one `linear_id` claimed twice. On a
     * cold load that browser then paints every pill at its raw deadline with
     * saved-day editing disabled.
     *
     * That is OPEN_REPAIRS 177 exactly, through a different door. Item 177
     * relaxed the ONE drift check that caused the live outage; it did not make
     * the other refusals survivable, and `list` runs through all of them.
     *
     * So the enriched answer is attempted and the bounded read is the floor.
     * The healthy path is byte-identical to before -- same aliases, same shape
     * -- and a validation failure now costs the aliases rather than the board.
     * `listPlans` is a paged direct read of `workload_plan` with no validator
     * in it, and it still refuses (503) if IT cannot complete, so a partial
     * list can never masquerade as a whole one.
     */
    if (action === "list") {
      requireListStaff(req);
      const db = serviceClient();
      /* Both reads start together, and the BOUNDED one is the answer unless the
       * enriched one arrives in time.
       *
       * A try/catch around the snapshot was not enough, and the reason is worth
       * keeping: the failure that matters is "unavailable", and its commonest
       * form is SLOW, not thrown. A `workload_native_snapshot_v1()` that hangs
       * on one of its joined relations never rejects, so a catch never fires --
       * and the compatibility client aborts at WL_PLAN_READ_TIMEOUT_MS (8s,
       * index.html), losing every saved day and disabling editing exactly as if
       * we had refused it. Racing a deadline covers both shapes with one
       * mechanism.
       *
       * The budget leaves the bounded read most of the client's window. Its
       * rejection is captured rather than left floating: an unawaited rejected
       * promise takes the isolate down, and the enriched path routinely leaves
       * one behind. */
      const bounded = listPlans(db).then(
        (plans) => ({ plans, error: null as unknown }),
        (error) => ({ plans: null, error }),
      );
      const enriched = nativeSnapshot(db).then(
        (snapshot) => snapshot,
        () => null,
      );
      let timer: ReturnType<typeof setTimeout> | undefined;
      const budget = new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), LIST_ENRICH_BUDGET_MS);
      });
      let snapshot = await Promise.race([enriched, budget]);
      if (timer !== undefined) clearTimeout(timer);
      if (!snapshot) {
        /* The budget is spent, but that does NOT mean the fallback is the best
         * answer yet. If enrichment lands at 3.1s while the paged read is still
         * going at 5s, committing to the fallback here would strip the provider
         * aliases from a response we were about to be able to enrich -- and an
         * old bundle cannot match a native-keyed override without them, so real
         * saved work days would vanish under nothing worse than transient
         * latency. Race what is left: whichever finishes first is the answer,
         * and the deadline above still guarantees we never wait past it for
         * enrichment ALONE. */
        snapshot = await Promise.race([enriched, bounded.then(() => null)]);
      }
      if (snapshot) {
        outcome = "ok";
        return json({ok:true,complete:true,alias_mode:"snapshot",plans_unaliased:0,
          plans_drifted:Number(snapshot.plans_dropped) || 0,
          plans:legacyPlanAliases(snapshot)});
      }
      // Degraded, not refused -- but no longer degraded in the way that moved
      // cards. The pairing below is what the snapshot would have proven about
      // identity, read directly and bounded, so an override saved under either
      // name still reaches a board keyed on the other. `alias_mode` and
      // `plans_unaliased` travel with the answer so the browser can SAY when it
      // is holding an incomplete map instead of painting a confident wrong day.
      const settled = await bounded;
      if (settled.error) throw settled.error;
      const storedPlans = settled.plans as PlanRow[];
      let pairTimer: ReturnType<typeof setTimeout> | undefined;
      const pairs = await Promise.race([
        planAliasPairs(db, storedPlans).catch(() => null),
        new Promise<null>((resolve) => {
          pairTimer = setTimeout(() => resolve(null), PAIR_BUDGET_MS);
        }),
      ]);
      if (pairTimer !== undefined) clearTimeout(pairTimer);
      if (pairs) {
        const aliased = pairedPlanAliases(storedPlans, pairs);
        outcome = aliased.unaliased ? "ok_paired_partial" : "ok_paired";
        return json({ok:true,complete:true,alias_mode:"pairs",
          plans_unaliased:aliased.unaliased,plans_drifted:aliased.drifted,
          plans:aliased.plans});
      }
      // Both routes to the pairing are gone. Every stored work day, keyed as
      // stored, and the browser is told the map is incomplete.
      outcome = "ok_unaliased";
      return json({ok:true,complete:true,alias_mode:"none",
        plans_unaliased:storedPlans.length,plans_drifted:0,plans:storedPlans});
    }

    const client = normalizeBrowserWriteClient(body.client);
    if (!client) throw new WorkloadPlanError(400, "invalid_client");
    const issueId = clean(body.issue_id);
    if (!SAFE_ISSUE_ID.test(issueId)) {
      throw new WorkloadPlanError(400, "invalid_issue_id");
    }
    if (!Object.prototype.hasOwnProperty.call(body, "plan_date")) {
      throw new WorkloadPlanError(400, "invalid_plan_date");
    }
    const planDate = parsePlanDate(body.plan_date);

    const db = serviceClient();
    const principal = await authorizeBrowserWrite(
      db,
      req,
      client,
      "workload-plan",
    );
    if (
      principal.kind !== "staff" ||
      !isWorkloadPlanWriteRole(principal.role)
    ) {
      throw new WorkloadPlanError(403, "staff_required");
    }

    const nativeTarget=await nativePlanTarget(db,issueId);
    let result: {updated:number;plan:PlanRow|null};
    if (nativeTarget) {
      if (nativeTarget.active!==true || nativeTarget.is_sub_issue!==true
          || normalizeBrowserWriteClient(nativeTarget.client_name)!==client
          || !["linear","syncview"].includes(clean(nativeTarget.authority))
          || (nativeTarget.authority==="linear"
            && normalizeBrowserWriteClient(nativeTarget.provider_client_name)!==client)) {
        throw new WorkloadPlanError(409,"issue_not_writable");
      }
      const {data,error}=await db.rpc("workload_native_plan_set_v1",{
        p_native_id:clean(nativeTarget.id),p_client_slug:clean(nativeTarget.client_slug),
        p_client:client,p_plan_date:planDate,p_actor:principal.actor,
        p_provider_client_name:nativeTarget.provider_client_name || null,
      });
      if (error) throw new WorkloadPlanError(409,"native_plan_write_refused");
      if (!data || data.ok!==true || data.updated!==1 || !data.plan
          || data.plan.issue_id!==nativeTarget.id || data.plan.client!==client
          || data.plan.plan_date!==planDate) {
        throw new WorkloadPlanError(409,"short_write");
      }
      // An older bundle sent the retained UUID. Echo its requested identity,
      // while SQL owns the exact canonical target and historical storage key.
      result={updated:data.updated,plan:{...planRow(data.plan),issue_id:issueId}};
    } else {
      // Explicit remaining legacy teams/provider-authority path. Failure to
      // read native ownership above never reaches this compatibility branch.
      await requireWritableIssue(db, issueId, client);
      result=await setPlan(db, principal, issueId, client, planDate);
    }
    writeCount = result.updated;
    if (result.updated !== 1 || !result.plan) {
      outcome = "short_write";
      return json({
        ok: false,
        error: "short_write",
        updated: result.updated,
      }, 409);
    }

    outcome = "ok";
    return json({
      ok: true,
      updated: result.updated,
      plan: result.plan,
    });
  } catch (error) {
    const browserAuth = browserWriteAuthResponse(error);
    if (browserAuth) {
      outcome = "denied";
      return json({
        ok: false,
        error: browserAuth.code,
      }, browserAuth.status);
    }
    if (error instanceof WorkloadPlanError) {
      outcome = error.status === 401 || error.status === 403 ? "denied" : "error";
      return json({ ok: false, error: error.code }, error.status);
    }
    return json({ ok: false, error: "request_failed" }, 500);
  } finally {
    // Aggregate-only operational metadata: never log client, issue, date, or
    // caller-supplied identity values.
    console.log(JSON.stringify({
      fn: "workload-plan",
      action,
      outcome,
      updated: writeCount,
      ms: Date.now() - started,
    }));
  }
});
