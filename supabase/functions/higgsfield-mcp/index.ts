// Supabase Edge Function: higgsfield-mcp
//
// A small MCP connector (the plug-in format Claude and ChatGPT both speak) that
// lets anyone on the team make Higgsfield videos and images, with every model the
// Higgsfield API offers (catalog.ts), from their own chat app while spending the
// pay-per-use API balance instead of a subscription.
//
// - Each teammate adds their personal link: .../higgsfield-mcp?key=<token>.
//   The token is a row in hf_team_members and only identifies who made what.
// - Every job is logged in hf_generations with its exact price from
//   Higgsfield's estimate endpoint, checked before anything is submitted.
// - A monthly cap (HF_MONTHLY_CAP_USD, default 200) refuses a job that would
//   push this month's spend past it.
// - The Higgsfield key lives only in the HIGGSFIELD_KEY secret ("KEY_ID:KEY_SECRET").
//
// Stateless Streamable HTTP: every POST is one JSON-RPC message answered with JSON.

import { createClient } from "npm:@supabase/supabase-js@2.49.8";
import { CATALOG } from "./catalog.ts";

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

// ---- Catalog and guide ---------------------------------------------------

type Pick = { task: string; picks: string[] };

// Plain-language shortlist the chat app reads first. Every id is in CATALOG
// (the generated list of all 80+ API models); find_models lists the rest.
const GO_TO: Pick[] = [
  { task: "B-roll, background or filler video (cheaper)", picks: ["kling-video/v2.6/pro/text-to-video", "kling-video/v3.0-turbo/text-to-video"] },
  { task: "Best-quality video: people up close, realistic motion, clips up to 30s", picks: ["bytedance/seedance-2.5/text-to-video"] },
  { task: "Animate a photo", picks: ["bytedance/seedance-2.5/image-to-video", "kling-video/v2.6/pro/image-to-video"] },
  { task: "Keep the same person or product across shots (reference images)", picks: ["bytedance/seedance-2.5/reference-to-video", "kling-video/o3/image-reference"] },
  { task: "Video that goes from a chosen first frame to a chosen last frame", picks: ["kling-video/o3/first-last-frame"] },
  { task: "4K video", picks: ["kling-video/v3.0/4k/text-to-video", "kling-video/v3.0/4k/image-to-video"] },
  { task: "Cinematic video with camera, lens, lighting and era controls", picks: ["higgsfield/cinema-studio/4.0"] },
  { task: "Edit an existing video (change people, clothes, setting, style)", picks: ["bytedance/seedance-2.5/video-edit", "kling-video/o3/video-edit"] },
  { task: "Make an existing video longer", picks: ["bytedance/seedance-2.5/video-extend"] },
  { task: "Copy the movement from one video onto a person in a photo", picks: ["higgsfield/genjutsu/motion-transfer/v1.0", "kling-video/v3/motion-control/pro"] },
  { task: "Swap an object in a video for another", picks: ["higgsfield/genjutsu/object-swap/v1.0"] },
  { task: "Photorealistic image of people or scenes", picks: ["higgsfield-ai/soul/v2/standard"] },
  { task: "Edit a photo (change a person, outfit, background, add or remove things)", picks: ["xai/grok-imagine-image-2.0", "alibaba/qwen-image-3/edit"] },
  { task: "Image with readable text: thumbnails, posters, quotes", picks: ["ideogram/v4.0"] },
  { task: "Logos, icons, illustrations, design assets", picks: ["recraft/v4.1/pro/text-to-image", "recraft/v4.1/utility/pro/text-to-image"] },
  { task: "Quick, cheap image drafts", picks: ["z-image/turbo"] },
  { task: "Product and ad images", picks: ["marketing-studio/image/sunburst", "marketing-studio/image/flare"] },
];

const BY_ID = new Map(CATALOG.map((m) => [m.id, m]));

const INSTRUCTIONS = [
  "You help non-technical teammates of a social media agency make AI videos and images with Higgsfield. Talk in plain English, no jargon.",
  "Start with start_here. Work out what they want (ask one short question if unclear), pick a model from the shortlist and say why in one sentence.",
  "Call model_details before the first create with a model, write a rich prompt for them (subject, action, setting, camera, lighting, mood) and show it.",
  "Choose sensible settings yourself: vertical 9:16 for social media unless they say otherwise, and a sharp but not wasteful quality (1080p or 2K when offered).",
  "Before EVERY create, run price_check and show its plan card to the person exactly as returned: model, what it will make, every setting (shape, quality, length, sound, inputs), the exact price, and the other quality and shape options. End with: \"Say go, or tell me what to change.\"",
  "Only call create after they say go (or yes). If they change anything, run price_check again and show the updated card. Never make anything without showing its price first. Mention the cost again when it is done.",
  "Input media must be public links. If they have a file in Google Drive or Dropbox, pass its share link to import_file and use the link it returns.",
  "After create, call check_job about every 20 to 30 seconds until it is done (images take seconds, videos 1 to 5 minutes), then give them the download link.",
  "Never go around the monthly budget. If create refuses for budget, tell them to ask the account owner.",
].join(" ");

const EMPTY = { type: "object", properties: {}, additionalProperties: false };
const MODEL_ARG = { type: "string", description: "Model id, e.g. bytedance/seedance-2.5/text-to-video" };
const INPUTS_ARG = { type: "object", description: "The model's settings, as listed by model_details (prompt, duration, aspect_ratio, image_url, ...)." };

const TOOLS = [
  { name: "start_here", description: "Read first. What this connector can make, which model to use for what, and the team's remaining budget this month.", inputSchema: EMPTY },
  {
    name: "find_models",
    description: "List every available model, optionally only one kind (text-to-video, image-to-video, reference-to-video, first-last-frame-video, video-edit, video-extend, motion-transfer, object-swap, cinematic-video, text-to-image, image-edit, marketing-image).",
    inputSchema: { type: "object", additionalProperties: false, properties: { category: { type: "string" } } },
  },
  {
    name: "model_details",
    description: "The settings a model accepts (names, allowed values, defaults) and its usage notes. Call before creating with a model.",
    inputSchema: { type: "object", required: ["model"], additionalProperties: false, properties: { model: MODEL_ARG } },
  },
  {
    name: "price_check",
    description: "Exact cost in dollars of a request, without making anything.",
    inputSchema: { type: "object", required: ["model", "inputs"], additionalProperties: false, properties: { model: MODEL_ARG, inputs: INPUTS_ARG } },
  },
  {
    name: "create",
    description: "Make a video or image. Only call after the person agreed to the model, settings and price. Returns a job_id for check_job.",
    inputSchema: { type: "object", required: ["model", "inputs"], additionalProperties: false, properties: { model: MODEL_ARG, inputs: INPUTS_ARG } },
  },
  {
    name: "check_job",
    description: "Check whether a job is finished. Returns the download links when done.",
    inputSchema: { type: "object", required: ["job_id"], additionalProperties: false, properties: { job_id: { type: "string" } } },
  },
  {
    name: "import_file",
    description: "Turn a Google Drive, Dropbox or other public file link (image jpg/png/webp/gif, video mp4, audio wav) into a link the models can read. Returns the new link.",
    inputSchema: { type: "object", required: ["link"], additionalProperties: false, properties: { link: { type: "string" } } },
  },
  {
    name: "get_upload_link",
    description: "Advanced: a one-hour upload address for sending a file's bytes directly (HTTP PUT with the returned headers). Returns the public link to use afterwards.",
    inputSchema: {
      type: "object", required: ["content_type"], additionalProperties: false,
      properties: { content_type: { type: "string", enum: ["image/jpeg", "image/png", "image/webp", "image/gif", "video/mp4", "audio/wav"] } },
    },
  },
  { name: "team_usage", description: "This month's team spending against the budget, and the most recent jobs with who made them.", inputSchema: EMPTY },
];

// ---- Input validation (light; Higgsfield validates fully too) -------------

type Schema = { type?: string; enum?: unknown[]; minimum?: number; maximum?: number; maxItems?: number; minItems?: number; properties?: Record<string, Schema>; required?: string[]; default?: unknown; description?: string };

function validate(schema: Schema, inputs: JsonMap): string[] {
  const problems: string[] = [];
  const props = schema.properties || {};
  for (const key of Object.keys(inputs)) if (!(key in props)) problems.push(`"${key}" is not a setting of this model`);
  for (const key of schema.required || []) if (inputs[key] === undefined || inputs[key] === "") problems.push(`"${key}" is required`);
  for (const [key, value] of Object.entries(inputs)) {
    const p = props[key];
    if (!p) continue;
    if (p.enum && !p.enum.includes(value)) problems.push(`"${key}" must be one of ${p.enum.map((v) => JSON.stringify(v)).join(", ")}`);
    if (typeof value === "number") {
      if (p.minimum !== undefined && value < p.minimum) problems.push(`"${key}" must be at least ${p.minimum}`);
      if (p.maximum !== undefined && value > p.maximum) problems.push(`"${key}" must be at most ${p.maximum}`);
    }
    if (Array.isArray(value) && p.maxItems !== undefined && value.length > p.maxItems) problems.push(`"${key}" takes at most ${p.maxItems} items`);
  }
  return problems;
}

// The confirmation card shown before every job: each setting the model has
// an option for, with the value this request will use (chosen or the model's
// default) and the alternatives, so nothing is decided silently.
const SETTING_LABELS: Record<string, string> = {
  aspect_ratio: "Shape", resolution: "Quality", quality: "Quality level", duration: "Length (seconds)",
  generate_audio: "Sound", sound: "Sound", batch_size: "Number of images", bitrate_mode: "Bitrate", output_format: "File type",
};
const SHAPE_WORDS: Record<string, string> = { "9:16": "9:16 vertical", "16:9": "16:9 horizontal", "1:1": "1:1 square", "4:5": "4:5 portrait", "3:4": "3:4 portrait", "4:3": "4:3", "21:9": "21:9 cinema", auto: "auto (matches the photo)" };

function planCard(id: string, inputs: JsonMap, usd: number): string {
  const m = BY_ID.get(id)!;
  const props = (m.schema as Schema).properties || {};
  const show = (k: string, v: unknown) => k === "aspect_ratio" ? (SHAPE_WORDS[String(v)] || String(v)) : typeof v === "boolean" ? (v ? "on" : "off") : String(v);
  const lines: string[] = [`Plan: ${m.name}`];
  if (inputs.prompt) lines.push(`What it will make: "${String(inputs.prompt)}"`);
  for (const [k, p] of Object.entries(props)) {
    const label = SETTING_LABELS[k];
    if (!label && !p.enum && p.type !== "boolean") continue;
    if (k === "prompt" || /seed|negative|cfg|strength|weight|thinking|extend|enhance|style_id|custom_reference/.test(k)) continue;
    const chosen = inputs[k] !== undefined;
    const value = chosen ? inputs[k] : p.default;
    if (value === undefined && !p.enum) continue;
    const others = p.enum ? p.enum.filter((o) => o !== value).map((o) => show(k, o)) : [];
    lines.push(`- ${label || k}: ${value === undefined ? "not set" : show(k, value)}${chosen ? "" : " (default)"}${others.length ? `  [other options: ${others.join(", ")}]` : ""}`);
  }
  for (const [k, v] of Object.entries(inputs)) {
    if (/url/.test(k)) lines.push(`- Input ${k.replace(/_/g, " ")}: ${Array.isArray(v) ? v.length + " file(s)" : "1 file"}`);
  }
  lines.push(`Price: ${money(usd)}`);
  return lines.join("\n");
}

function describeModel(id: string): string {
  const m = BY_ID.get(id)!;
  const schema = m.schema as Schema;
  const required = new Set(schema.required || []);
  const lines = Object.entries(schema.properties || {}).map(([k, p]) => {
    const bits = [p.type || "value"];
    if (p.enum) bits.push("one of " + p.enum.map((v) => JSON.stringify(v)).join(" | "));
    if (p.minimum !== undefined || p.maximum !== undefined) bits.push(`range ${p.minimum ?? ""} to ${p.maximum ?? ""}`);
    if (p.maxItems !== undefined) bits.push(`up to ${p.maxItems} items`);
    if (p.default !== undefined) bits.push("default " + JSON.stringify(p.default));
    return `- ${k}${required.has(k) ? " (required)" : ""}: ${bits.join(", ")}${p.description ? ". " + p.description : ""}`;
  });
  return `${m.name} [${m.id}], ${m.category}\n\nSettings:\n${lines.join("\n")}${m.notes.length ? "\n\nNotes:\n- " + m.notes.join("\n- ") : ""}`;
}

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

async function idemKey(member: string, model: string, input: JsonMap): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify([member, model, input]));
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(hash, (b) => b.toString(16).padStart(2, "0")).join("");
}


async function estimate(model: string, inputs: JsonMap): Promise<{ usd: number } | { error: string }> {
  const res = await hf("POST", "estimate/" + model, inputs);
  const usd = Number(res.data.usd);
  if (!res.ok || !Number.isFinite(usd)) return { error: hfError(res) };
  return { usd };
}

function hfError(res: { status: number; data: JsonMap }): string {
  const d = res.data.detail;
  const text = Array.isArray(d) ? d.map((x) => (x as JsonMap).msg || JSON.stringify(x)).join("; ") : String(d || res.data.error || `Higgsfield answered ${res.status}`);
  return res.status === 403 ? text + " (the API balance needs a top-up)" : text;
}

function directLink(link: string): string {
  const drive = link.match(/drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?(?:export=download&)?id=)([\w-]+)/);
  if (drive) return `https://drive.usercontent.google.com/download?id=${drive[1]}&export=download&confirm=t`;
  if (/dropbox\.com\//.test(link)) return link.replace(/([?&])dl=0/, "$1dl=1") + (/[?&]dl=1/.test(link) ? "" : (link.includes("?") ? "&dl=1" : "?dl=1"));
  return link;
}

const UPLOAD_TYPES: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif", mp4: "video/mp4", wav: "audio/wav" };
const MAX_IMPORT_BYTES = 60 * 1024 * 1024;

async function uploadLink(contentType: string) {
  const res = await hf("POST", "files/generate-upload-url", { content_type: contentType });
  if (!res.ok || !res.data.upload_url) return { error: hfError(res) };
  return res.data as { upload_url: string; public_url: string; upload_headers: Record<string, string> };
}

// import_file fetches a caller-supplied link, so every hop (including each
// redirect) must be public https: no IP literals in private ranges, no
// internal names, and every resolved address public. The body is read in
// chunks and abandoned the moment it passes the size limit.
function privateIp(ip: string): boolean {
  const v4 = ip.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
  }
  const v6 = ip.toLowerCase().replace(/^\[|\]$/g, "");
  if (!v6.includes(":")) return false;
  const mapped = v6.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return privateIp(mapped[1]);
  return v6 === "::" || v6 === "::1" || /^f[cd]/.test(v6) || /^fe[89ab]/.test(v6) || /^ff/.test(v6);
}

async function publicHost(url: URL): Promise<boolean> {
  if (url.protocol !== "https:" || url.username || url.password) return false;
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!host.includes(".") && !host.includes(":")) return false;
  if (/(^|\.)(localhost|local|internal|localdomain|home\.arpa)$/.test(host)) return false;
  if (/^[\d.]+$/.test(host) || host.includes(":")) return !privateIp(host);
  try {
    const addrs = [
      ...(await Deno.resolveDns(host, "A").catch(() => [] as string[])),
      ...(await Deno.resolveDns(host, "AAAA").catch(() => [] as string[])),
    ];
    return addrs.length > 0 && addrs.every((a) => !privateIp(a));
  } catch {
    return false;
  }
}

async function safeFetch(link: string): Promise<Response | string> {
  let url = new URL(link);
  for (let hop = 0; hop < 6; hop++) {
    if (!(await publicHost(url))) return "That link points somewhere that is not a public https address.";
    const res = await fetch(url, { redirect: "manual" });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      await res.body?.cancel();
      url = new URL(res.headers.get("location")!, url);
      continue;
    }
    return res;
  }
  return "That link redirects too many times.";
}

async function readLimited(res: Response): Promise<Uint8Array<ArrayBuffer> | null> {
  const reader = res.body!.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > MAX_IMPORT_BYTES) { await reader.cancel(); return null; }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) { out.set(c, offset); offset += c.length; }
  return out;
}

async function importFile(link: string): Promise<string> {
  if (!/^https:\/\//i.test(link)) return "The link must start with https://";
  let fetched: Response | string;
  try { fetched = await safeFetch(directLink(link)); } catch { return "Could not open that link."; }
  if (typeof fetched === "string") return fetched;
  const res = fetched;
  if (!res.ok || !res.body) return `Could not download that link (${res.status}). Make sure it is shared as "anyone with the link".`;
  if (Number(res.headers.get("content-length") || 0) > MAX_IMPORT_BYTES) { await res.body.cancel(); return "That file is over 60 MB, too big to import."; }
  let type = (res.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  if (type === "audio/x-wav" || type === "audio/wave") type = "audio/wav";
  if (type === "image/jpg") type = "image/jpeg";
  if (!Object.values(UPLOAD_TYPES).includes(type)) {
    const ext = (res.headers.get("content-disposition")?.match(/filename\*?=(?:UTF-8'')?"?[^";]*\.(\w+)/i)?.[1] || new URL(link).pathname.split(".").pop() || "").toLowerCase();
    type = UPLOAD_TYPES[ext] || "";
  }
  if (!type) { await res.body.cancel(); return "That link is not a supported file (jpg, png, webp, gif, mp4 or wav), or it opened a web page instead of the file. Check the sharing setting."; }
  const bytes = await readLimited(res);
  if (!bytes) return "That file is over 60 MB, too big to import.";
  const up = await uploadLink(type);
  if ("error" in up) return "Could not prepare the upload: " + up.error;
  const put = await fetch(up.upload_url, { method: "PUT", headers: up.upload_headers, body: bytes });
  if (!put.ok) return `The upload failed (${put.status}).`;
  return `Imported (${type}, ${(bytes.length / 1048576).toFixed(1)} MB). Use this link as the model's input:\n${up.public_url}\n(Higgsfield keeps uploaded inputs for a limited time.)`;
}

function outputs(data: JsonMap): string[] {
  const urls: string[] = [];
  const add = (v: unknown) => { const u = (v as JsonMap | undefined)?.url; if (u) urls.push(String(u)); };
  for (const key of ["video", "audio", "zip", "mov"]) add(data[key]);
  for (const key of ["images", "audios", "videos"]) if (Array.isArray(data[key])) (data[key] as unknown[]).forEach(add);
  return urls;
}

// ---- Tool handlers -------------------------------------------------------

async function callTool(name: string, args: JsonMap, member: string): Promise<string> {
  // A malformed cap stops new spending only; job checks, details and imports keep working.
  const BAD_CAP = "The monthly budget setting (HF_MONTHLY_CAP_USD) is not a valid dollar amount, so nothing new can be made. Ask the account owner.";
  const cap = CAP_USD ?? 0;
  const budget = async (): Promise<string> => {
    if (CAP_USD === null) return BAD_CAP;
    const spent = await monthSpend();
    return `Team budget this month: ${money(spent)} of ${money(cap)} used, ${money(Math.max(0, cap - spent))} left.`;
  };
  const needModel = (): string | null => {
    const id = String(args.model || "").trim();
    return BY_ID.has(id) ? id : null;
  };
  const inputsOf = (): JsonMap => (args.inputs && typeof args.inputs === "object" && !Array.isArray(args.inputs) ? args.inputs as JsonMap : {});

  if (name === "start_here") {
    const list = GO_TO.map((g) => `- ${g.task}: ${g.picks.map((id) => `${BY_ID.get(id)?.name} [${id}]`).join(" or ")}`).join("\n");
    return `This connector can make videos and images with ${CATALOG.length} Higgsfield models. Go-to picks:\n${list}\n\nThere are more options per task: use find_models.\nPrices vary by model, length and resolution; price_check gives the exact figure.\nInput photos, videos and audio must be public links; import_file converts Drive and Dropbox links.\n\n${await budget()}`;
  }

  if (name === "find_models") {
    const category = String(args.category || "").trim();
    const models = CATALOG.filter((m) => !category || m.category === category);
    if (!models.length) return `No models in "${category}". Kinds: ${[...new Set(CATALOG.map((m) => m.category))].join(", ")}.`;
    return models.map((m) => `- ${m.name} [${m.id}] (${m.category})${m.notes[0] ? ": " + m.notes[0] : ""}`).join("\n");
  }

  if (name === "model_details") {
    const id = needModel();
    return id ? describeModel(id) : "Unknown model. Use find_models for the exact ids.";
  }

  if (name === "price_check" || name === "create") {
    const id = needModel();
    if (!id) return "Unknown model. Use find_models for the exact ids.";
    const inputs = inputsOf();
    const problems = validate(BY_ID.get(id)!.schema as Schema, inputs);
    if (problems.length) return "Fix these settings first:\n- " + problems.join("\n- ") + "\n\n" + describeModel(id);
    const est = await estimate(id, inputs);
    if ("error" in est) return "Higgsfield could not price this request: " + est.error;
    if (name === "price_check") return planCard(id, inputs, est.usd) + "\n" + await budget() + "\n\nSay go, or tell me what to change.";
    if (CAP_USD === null) return BAD_CAP;

    const client = db();
    // Cap check, retry dedupe and log row happen in one serialized database step.
    const { data: rsv, error } = await client.rpc("hf_reserve_generation", {
      p_member: member,
      p_model: id,
      p_prompt: String(inputs.prompt || "(no prompt)"),
      p_params: inputs,
      p_cost: est.usd,
      p_cap: cap,
      p_idem_key: await idemKey(member, id, inputs),
    });
    if (error || !rsv) return "Could not start: the log is unavailable, so nothing was spent.";
    const reservation = rsv as JsonMap;
    if (reservation.outcome === "over_cap") {
      return `Refused: this (${money(est.usd)}) would pass the team's monthly budget of ${money(cap)} (${money(Number(reservation.spent))} already used). Ask the account owner.`;
    }
    if (reservation.outcome === "duplicate") {
      return reservation.request_id
        ? `This exact request was already started a moment ago, so it was not charged twice.\njob_id: ${reservation.request_id}\nUse check_job with that job_id.`
        : "This exact request is being started right now. Wait a minute, then ask for team_usage to find its job.";
    }
    const rowId = Number(reservation.id);
    const res = await hf("POST", id, inputs);
    const requestId = String(res.data.request_id || "");
    if (!res.ok || !requestId) {
      const why = hfError(res);
      await client.from("hf_generations").update({ status: "submit_failed", error: why, updated_at: new Date().toISOString() }).eq("id", rowId);
      return "Higgsfield refused the request: " + why;
    }
    await client.from("hf_generations").update({ request_id: requestId, status: String(res.data.status || "queued"), updated_at: new Date().toISOString() }).eq("id", rowId);
    return `Started: ${BY_ID.get(id)!.name}, ${money(est.usd)}.\njob_id: ${requestId}\nCheck with check_job in about 20 to 30 seconds.`;
  }

  if (name === "check_job" || name === "check_video") {
    const jobId = String(args.job_id || "").trim();
    if (!/^[0-9a-f-]{36}$/i.test(jobId)) return "That job_id does not look right.";
    const res = await hf("GET", `requests/${jobId}/status`);
    if (!res.ok) return "Could not check: " + hfError(res);
    const status = String(res.data.status || "unknown");
    const urls = outputs(res.data);
    const err = res.data.error ? String(res.data.error) : null;
    const { data: logged } = await db().from("hf_generations").update({
      status, video_url: urls[0] || null, error: err, updated_at: new Date().toISOString(),
    }).eq("request_id", jobId).select("est_cost_usd");
    const cost = logged && logged[0] ? ` It cost ${money(Number(logged[0].est_cost_usd))}.` : "";
    if (status === "completed" && urls.length) return `Done.${cost} Download:\n${urls.join("\n")}\n(Higgsfield keeps results for about 7 days, so save the files.)`;
    if (status === "failed") return "It failed: " + (err || "no reason given") + ". Failed jobs are not charged; try again or adjust the prompt.";
    if (status === "nsfw") return "Higgsfield blocked this for its content rules (not charged). Try a different prompt or image.";
    if (status === "canceled") return "This job was canceled.";
    return `Still working (${status.replace("_", " ")}). Check again in about 20 to 30 seconds.`;
  }

  if (name === "import_file") return await importFile(String(args.link || "").trim());

  if (name === "get_upload_link") {
    const type = String(args.content_type || "");
    if (!Object.values(UPLOAD_TYPES).includes(type)) return "Unsupported content_type.";
    const up = await uploadLink(type);
    if ("error" in up) return "Could not prepare the upload: " + up.error;
    return JSON.stringify({ upload_url: up.upload_url, upload_headers: up.upload_headers, public_url: up.public_url, expires: "in 1 hour" });
  }

  if (name === "team_usage") {
    const { data } = await db()
      .from("hf_generations")
      .select("created_at,member_name,model,est_cost_usd,status,prompt")
      .order("created_at", { ascending: false })
      .limit(15);
    const lines = (data || []).map((r) =>
      `${String(r.created_at).slice(0, 10)}  ${r.member_name}  ${r.model}  ${money(Number(r.est_cost_usd))}  ${r.status}  "${String(r.prompt).slice(0, 60)}"`
    );
    return `${await budget()}\n\nRecent jobs:\n${lines.join("\n") || "none yet"}`;
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
        serverInfo: { name: "synchro-higgsfield", version: "2.0.0" },
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
