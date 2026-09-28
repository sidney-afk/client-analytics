// Supabase Edge Function: higgsfield-mcp
//
// A small MCP connector (the plug-in format Claude and ChatGPT both speak) that
// lets anyone on the team make Higgsfield videos from their own chat app while
// spending the pay-per-video Higgsfield API balance instead of a subscription.
//
// - Each teammate adds their personal link: .../higgsfield-mcp?key=<token>.
//   The token is a row in hf_team_members and only identifies who made what.
// - Every video is logged in hf_generations with its estimated cost.
// - A monthly cap (HF_MONTHLY_CAP_USD, default 200) refuses a video that would
//   push this month's estimated spend past it.
// - The Higgsfield key lives only in the HIGGSFIELD_KEY secret ("KEY_ID:KEY_SECRET").
//
// Stateless Streamable HTTP: every POST is one JSON-RPC message answered with JSON.

import { createClient } from "npm:@supabase/supabase-js@2.49.8";

const HF_API = "https://api.higgsfield.ai";
const CAP_RAW = (Deno.env.get("HF_MONTHLY_CAP_USD") || "200").trim();
// A malformed cap must not silently disable the limit: CAP_USD stays null and
// every new video is refused until the setting is fixed.
const CAP_USD: number | null = /^\d+(\.\d+)?$/.test(CAP_RAW) ? Number(CAP_RAW) : null;
const PROTOCOLS = ["2025-06-18", "2025-03-26", "2024-11-05"];

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type, mcp-session-id, mcp-protocol-version, accept",
  "Cache-Control": "no-store",
};

type JsonMap = Record<string, unknown>;

// ---- Models --------------------------------------------------------------

type Model = {
  id: "seedance-2.5" | "kling-2.6";
  label: string;
  bestFor: string;
  textPath: string;
  imagePath: string;
};

const MODELS: Record<string, Model> = {
  "seedance-2.5": {
    id: "seedance-2.5",
    label: "Seedance 2.5 (best quality)",
    bestFor: "hero shots, people and faces up close, talking, realistic motion, anything the viewer looks at closely, clips longer than 10 seconds",
    textPath: "bytedance/seedance-2.5/text-to-video",
    imagePath: "bytedance/seedance-2.5/image-to-video",
  },
  "kling-2.6": {
    id: "kling-2.6",
    label: "Kling 2.6 Pro (good and cheaper)",
    bestFor: "b-roll, background and filler shots, scenery, objects, simple motion, quick social cutaways",
    textPath: "kling-video/v2.6/pro/text-to-video",
    imagePath: "kling-video/v2.6/pro/image-to-video",
  },
};

// Seedance: Higgsfield's published per-second rates (no video input).
const SEEDANCE_PER_SEC: Record<string, number> = { "480p": 0.2056, "720p": 0.4622, "1080p": 1.1372 };
// Kling 2.6 Pro: Higgsfield publishes no API price, so this is a deliberately
// high estimate. The real charge shows in the Higgsfield console.
const KLING_PER_SEC = { sound: 0.14, silent: 0.07 };

const SHAPES: Record<string, string> = { vertical: "9:16", horizontal: "16:9", square: "1:1" };

type Plan = { model: Model; path: string; input: JsonMap; seconds: number; cost: number; notes: string[] };

function planVideo(args: JsonMap): Plan | { error: string } {
  const model = MODELS[String(args.model || "")];
  if (!model) return { error: "model must be \"seedance-2.5\" or \"kling-2.6\"." };
  const prompt = String(args.prompt || "").trim();
  if (!prompt) return { error: "prompt is required." };
  const aspect = SHAPES[String(args.shape || "vertical")];
  if (!aspect) return { error: "shape must be vertical, horizontal or square." };
  const imageUrl = String(args.image_url || "").trim();
  const sound = args.sound !== false;
  const notes: string[] = [];
  let seconds = Math.round(Number(args.seconds || 5));

  if (model.id === "kling-2.6") {
    const s = seconds <= 7 ? 5 : 10;
    if (s !== seconds) notes.push(`Kling makes 5 or 10 second clips, so this will be ${s} seconds.`);
    seconds = s;
    const input: JsonMap = { prompt, duration: seconds, aspect_ratio: aspect, sound: sound ? "on" : "off" };
    if (imageUrl) input.image_url = imageUrl;
    const cost = seconds * (sound ? KLING_PER_SEC.sound : KLING_PER_SEC.silent);
    return { model, path: imageUrl ? model.imagePath : model.textPath, input, seconds, cost, notes };
  }

  const s = Math.min(30, Math.max(4, seconds || 5));
  if (s !== seconds) notes.push(`Seedance makes 4 to 30 second clips, so this will be ${s} seconds.`);
  seconds = s;
  const resolution = ["480p", "720p", "1080p"].includes(String(args.resolution)) ? String(args.resolution) : "720p";
  const input: JsonMap = { prompt, duration: seconds, resolution, generate_audio: sound };
  if (imageUrl) input.image_url = imageUrl;
  else input.aspect_ratio = aspect;
  const cost = seconds * SEEDANCE_PER_SEC[resolution];
  return { model, path: imageUrl ? model.imagePath : model.textPath, input, seconds, cost, notes };
}

// ---- Tools ---------------------------------------------------------------

const GUIDE = [
  "Two models are available. Pick with the person, in plain words:",
  "",
  `1. ${MODELS["kling-2.6"].label}: about $0.70 for 5 seconds, $1.40 for 10. Best for ${MODELS["kling-2.6"].bestFor}.`,
  `2. ${MODELS["seedance-2.5"].label}: about $2.30 for 5 seconds at 720p ($1.00 at 480p, $5.70 at 1080p). Best for ${MODELS["seedance-2.5"].bestFor}.`,
  "",
  "How to choose: ask what the clip is for. Background or b-roll -> Kling. The main shot, a person up close, realistic human movement, or longer than 10 seconds -> Seedance.",
  "If unsure, suggest Kling first (cheaper) and offer Seedance if the result is not good enough.",
  "Kling only makes 5 or 10 second clips. Seedance makes 4 to 30 seconds.",
  "Shapes: vertical (Reels, TikTok, Shorts), horizontal (YouTube), square.",
  "To animate a photo, pass a public image link as image_url (Seedance uses the photo's own shape).",
].join("\n");

const INSTRUCTIONS = [
  "You help non-technical teammates of a social media agency make AI videos. Talk in plain English, no jargon.",
  "Before making a video: (1) ask what the video is for if it is not obvious, (2) recommend a model using video_model_guide's rules and say why in one sentence, (3) state the length, shape and estimated cost, and (4) get a yes.",
  "Write a rich visual prompt for them (subject, action, setting, camera movement, lighting, mood) from what they describe; show it to them.",
  "After make_video, call check_video about every 30 seconds until it is done (usually 1 to 5 minutes), then give them the download link.",
  "Never go around the monthly budget. If make_video refuses for budget, tell them to ask the account owner.",
].join(" ");

const TOOLS = [
  {
    name: "video_model_guide",
    description: "Read first. Explains which video model to use for what, what it costs, and this month's remaining team budget.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "make_video",
    description: "Start making a video. Only call after the person agreed to the model, length and estimated cost. Returns a job_id to pass to check_video.",
    inputSchema: {
      type: "object",
      required: ["model", "prompt"],
      additionalProperties: false,
      properties: {
        model: { type: "string", enum: ["kling-2.6", "seedance-2.5"], description: "kling-2.6 = good and cheaper (b-roll). seedance-2.5 = best quality." },
        prompt: { type: "string", description: "Detailed visual description of the video." },
        seconds: { type: "integer", minimum: 4, maximum: 30, default: 5, description: "Kling: 5 or 10. Seedance: 4 to 30." },
        shape: { type: "string", enum: ["vertical", "horizontal", "square"], default: "vertical" },
        resolution: { type: "string", enum: ["480p", "720p", "1080p"], default: "720p", description: "Seedance only." },
        sound: { type: "boolean", default: true, description: "Generate sound with the video." },
        image_url: { type: "string", description: "Optional public link to a photo to animate." },
      },
    },
  },
  {
    name: "check_video",
    description: "Check whether a video is finished. Returns the download link when done.",
    inputSchema: {
      type: "object",
      required: ["job_id"],
      additionalProperties: false,
      properties: { job_id: { type: "string" } },
    },
  },
  {
    name: "team_usage",
    description: "This month's team spending against the budget, and the most recent videos with who made them.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
];

// ---- Helpers -------------------------------------------------------------

function db() {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });
}

function monthStart(): string {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();
}

async function monthSpend(): Promise<number> {
  const { data, error } = await db()
    .from("hf_generations")
    .select("est_cost_usd,status")
    .gte("created_at", monthStart());
  if (error) throw new Error("Could not read the spending log.");
  return (data || [])
    .filter((r) => !["failed", "nsfw", "canceled", "submit_failed"].includes(String(r.status)))
    .reduce((sum, r) => sum + Number(r.est_cost_usd || 0), 0);
}

function money(n: number): string {
  return "$" + n.toFixed(2);
}

async function hf(method: string, path: string, body?: JsonMap): Promise<{ ok: boolean; status: number; data: JsonMap }> {
  const key = Deno.env.get("HIGGSFIELD_KEY");
  if (!key) return { ok: false, status: 500, data: { detail: "The Higgsfield API key is not set up yet (HIGGSFIELD_KEY)." } };
  const res = await fetch(HF_API + "/" + path, {
    method,
    headers: { Authorization: "Key " + key, "Content-Type": "application/json", Accept: "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data: JsonMap = {};
  try { data = await res.json(); } catch { data = {}; }
  return { ok: res.ok, status: res.status, data };
}

// ---- Tool handlers -------------------------------------------------------

async function idemKey(member: string, model: string, input: JsonMap): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify([member, model, input]));
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(hash, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function callTool(name: string, args: JsonMap, member: string): Promise<string> {
  if (CAP_USD === null && (name === "video_model_guide" || name === "make_video" || name === "team_usage")) {
    return "The monthly budget setting (HF_MONTHLY_CAP_USD) is not a valid dollar amount, so video making is paused. Ask the account owner.";
  }
  const cap = CAP_USD as number;
  if (name === "video_model_guide") {
    const spent = await monthSpend();
    return `${GUIDE}\n\nTeam budget this month: ${money(spent)} of ${money(cap)} used, ${money(Math.max(0, cap - spent))} left.`;
  }

  if (name === "make_video") {
    const plan = planVideo(args);
    if ("error" in plan) return "Could not start: " + plan.error;
    const client = db();
    // Cap check, retry dedupe and log row happen in one serialized database step.
    const { data: rsv, error } = await client.rpc("hf_reserve_generation", {
      p_member: member,
      p_model: plan.model.id,
      p_prompt: String(args.prompt),
      p_params: plan.input,
      p_cost: plan.cost,
      p_cap: cap,
      p_idem_key: await idemKey(member, plan.model.id, plan.input),
    });
    if (error || !rsv) return "Could not start: the log is unavailable, so nothing was spent.";
    const reservation = rsv as JsonMap;
    if (reservation.outcome === "over_cap") {
      return `Refused: this video (about ${money(plan.cost)}) would pass the team's monthly budget of ${money(cap)} (${money(Number(reservation.spent))} already used). Ask the account owner.`;
    }
    if (reservation.outcome === "duplicate") {
      return reservation.request_id
        ? `This exact video was already started a moment ago, so it was not charged twice.\njob_id: ${reservation.request_id}\nUse check_video with that job_id.`
        : "This exact video is being started right now. Wait a minute, then ask for team_usage to find its job.";
    }
    const row = { id: Number(reservation.id) };

    const res = await hf("POST", plan.path, plan.input);
    const requestId = String(res.data.request_id || "");
    if (!res.ok || !requestId) {
      const why = String(res.data.detail || res.data.error || `Higgsfield answered ${res.status}`);
      await client.from("hf_generations").update({ status: "submit_failed", error: why, updated_at: new Date().toISOString() }).eq("id", row.id);
      return "Higgsfield refused the request: " + why + (res.status === 402 || /balance|credit|fund/i.test(why) ? " (the API balance may need a top-up)." : "");
    }
    await client.from("hf_generations").update({ request_id: requestId, status: String(res.data.status || "queued"), updated_at: new Date().toISOString() }).eq("id", row.id);
    return [
      `Started: ${plan.model.label}, ${plan.seconds} seconds, estimated ${money(plan.cost)}.`,
      ...plan.notes,
      `job_id: ${requestId}`,
      "Check back with check_video in about 30 seconds. It usually takes 1 to 5 minutes.",
    ].join("\n");
  }

  if (name === "check_video") {
    const jobId = String(args.job_id || "").trim();
    if (!/^[0-9a-f-]{36}$/i.test(jobId)) return "That job_id does not look right.";
    const res = await hf("GET", `requests/${jobId}/status`);
    if (!res.ok) return "Could not check: " + String(res.data.detail || `Higgsfield answered ${res.status}`);
    const status = String(res.data.status || "unknown");
    const url = String((res.data.video as JsonMap | undefined)?.url || "");
    const err = res.data.error ? String(res.data.error) : null;
    await db().from("hf_generations").update({
      status, video_url: url || null, error: err, updated_at: new Date().toISOString(),
    }).eq("request_id", jobId);
    if (status === "completed" && url) return `Done. Download: ${url}\n(Links from Higgsfield may expire, so save the file.)`;
    if (status === "failed") return "The video failed: " + (err || "no reason given") + ". Nothing is charged for a failed video; try again or adjust the prompt.";
    if (status === "nsfw") return "Higgsfield blocked this video for its content rules. Try a different prompt.";
    if (status === "canceled") return "This video was canceled.";
    return `Still working (${status.replace("_", " ")}). Check again in about 30 seconds.`;
  }

  if (name === "team_usage") {
    const spent = await monthSpend();
    const { data } = await db()
      .from("hf_generations")
      .select("created_at,member_name,model,est_cost_usd,status,prompt")
      .order("created_at", { ascending: false })
      .limit(15);
    const lines = (data || []).map((r) =>
      `${String(r.created_at).slice(0, 10)}  ${r.member_name}  ${r.model}  ~${money(Number(r.est_cost_usd))}  ${r.status}  "${String(r.prompt).slice(0, 60)}"`
    );
    return `This month: ${money(spent)} of ${money(cap)} used (estimates; the Higgsfield console shows exact charges).\n\nRecent videos:\n${lines.join("\n") || "none yet"}`;
  }

  return "Unknown tool: " + name;
}

// ---- JSON-RPC over HTTP --------------------------------------------------

function reply(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

function rpcError(id: unknown, code: number, message: string): Response {
  return reply({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });
}

async function memberFor(req: Request): Promise<string | null> {
  const url = new URL(req.url);
  const token = (url.searchParams.get("key") || req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "").trim();
  if (!/^[0-9a-f]{16,64}$/i.test(token)) return null;
  const { data } = await db().from("hf_team_members").select("name,active").eq("token", token).maybeSingle();
  return data && data.active ? String(data.name) : null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: CORS });

  let msg: JsonMap;
  try { msg = await req.json(); } catch { return rpcError(null, -32700, "Parse error"); }
  if (Array.isArray(msg)) return rpcError(null, -32600, "Batches are not supported");

  const id = msg.id;
  const method = String(msg.method || "");
  if (id === undefined || id === null) return new Response(null, { status: 202, headers: CORS }); // notification

  const member = await memberFor(req);
  if (!member) return rpcError(id, -32001, "This connector link is not recognised. Ask the account owner for your personal link.");

  if (method === "initialize") {
    const asked = String((msg.params as JsonMap | undefined)?.protocolVersion || "");
    return reply({
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: PROTOCOLS.includes(asked) ? asked : PROTOCOLS[0],
        capabilities: { tools: {} },
        serverInfo: { name: "synchro-higgsfield", version: "1.0.0" },
        instructions: INSTRUCTIONS,
      },
    });
  }
  if (method === "ping") return reply({ jsonrpc: "2.0", id, result: {} });
  if (method === "tools/list") return reply({ jsonrpc: "2.0", id, result: { tools: TOOLS } });
  if (method === "tools/call") {
    const params = (msg.params || {}) as JsonMap;
    try {
      const text = await callTool(String(params.name || ""), (params.arguments || {}) as JsonMap, member);
      return reply({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text }] } });
    } catch (e) {
      return reply({ jsonrpc: "2.0", id, result: { isError: true, content: [{ type: "text", text: "Something went wrong: " + (e as Error).message }] } });
    }
  }
  return rpcError(id, -32601, "Method not found: " + method);
});
