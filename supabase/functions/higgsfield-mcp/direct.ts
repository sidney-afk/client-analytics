// Image models the connector calls directly instead of through Higgsfield:
// OpenAI's GPT Image (the ChatGPT image model) and Google's Nano Banana. Their
// APIs answer synchronously with the image bytes, so index.ts runs them in the
// background after the budget reservation and stores the result itself.
//
// Keys: OPENAI_KEY and GOOGLE_AI_KEY (Supabase function secrets).
// Prices (USD, checked 2026-09-28):
//   OpenAI gpt-image-2 / 2.5 Sunburst / 2.5 Flare: text in $5/M, image in $8/M, image out $30/M tokens.
//   Google gemini-3.1-flash-image: in $0.50/M, per image 1K $0.067, 2K $0.101, 4K $0.151.
//   Google gemini-3-pro-image: in $2/M, per image 1K/2K $0.134, 4K $0.24.
// Estimates are upper bounds; the actual cost from each response's token
// usage replaces the estimate in the log once the image is back.

import type { CatalogModel } from "./catalog.ts";

type JsonMap = Record<string, unknown>;

// Dated snapshots so behaviour does not shift under the team. Sunburst is
// OpenAI's most precise model for edits and final images; Flare is its fast
// everyday model, same token prices. (chatgpt-image-latest is a legacy
// pointer to the older ChatGPT snapshot.)
const OPENAI_MODELS: Record<string, string> = {
  "openai/gpt-image": "gpt-image-2.5-sunburst-2026-09-08",
  "openai/gpt-image-fast": "gpt-image-2.5-flare-2026-09-08",
};
const GOOGLE_MODELS: Record<string, { api: string; inRate: number; perImage: Record<string, number> }> = {
  "google/nano-banana": { api: "gemini-3.1-flash-image", inRate: 0.5e-6, perImage: { "1K": 0.067, "2K": 0.101, "4K": 0.151 } },
  "google/nano-banana-pro": { api: "gemini-3-pro-image", inRate: 2e-6, perImage: { "1K": 0.134, "2K": 0.134, "4K": 0.24 } },
};

const IMAGES = { type: "array", items: { type: "string", format: "uri" }, maxItems: 4, description: "Up to 4 public image links to edit or use as references. Leave out to make a new image from the prompt." };

export const DIRECT_MODELS: CatalogModel[] = [
  {
    id: "openai/gpt-image",
    name: "GPT Image (ChatGPT's image model)",
    category: "image-edit",
    notes: [
      "OpenAI's most capable image model (GPT Image 2.5 Sunburst). Best at precise edits that change only what you ask for; also makes new images from a prompt.",
      "size auto keeps the photo's own shape; any WIDTHxHEIGHT works (1152x2048 for vertical 9:16). quality medium is the default (good and cheap); low for rough drafts; high only when they ask for the sharpest result. Bigger sizes cost more.",
    ],
    schema: {
      type: "object",
      required: ["prompt"],
      properties: {
        prompt: { type: "string" },
        image_urls: IMAGES,
        size: { type: "string", default: "auto", description: "auto (keeps the photo's shape), or WIDTHxHEIGHT: both multiples of 16, shape between 1:3 and 3:1, longest edge at most 3840. Vertical 9:16 is 1152x2048, horizontal 16:9 is 2048x1152, square 1024x1024, 2:3 is 1024x1536." },
        quality: { type: "string", enum: ["low", "medium", "high"], default: "medium" },
      },
    },
  },
  {
    id: "openai/gpt-image-fast",
    name: "GPT Image Fast (OpenAI Flare)",
    category: "image-edit",
    notes: [
      "OpenAI's fast everyday image model: quicker drafts at the same price per image as GPT Image. Use GPT Image for precise edits and final images.",
      "size auto keeps the photo's own shape; any WIDTHxHEIGHT works (1152x2048 for vertical 9:16). quality medium is the default (good and cheap); low for rough drafts; high only when they ask for the sharpest result. Bigger sizes cost more.",
    ],
    schema: {
      type: "object",
      required: ["prompt"],
      properties: {
        prompt: { type: "string" },
        image_urls: IMAGES,
        size: { type: "string", default: "auto", description: "auto (keeps the photo's shape), or WIDTHxHEIGHT: both multiples of 16, shape between 1:3 and 3:1, longest edge at most 3840. Vertical 9:16 is 1152x2048, horizontal 16:9 is 2048x1152, square 1024x1024, 2:3 is 1024x1536." },
        quality: { type: "string", enum: ["low", "medium", "high"], default: "medium" },
      },
    },
  },
  {
    id: "google/nano-banana",
    name: "Nano Banana 2 (Google)",
    category: "image-edit",
    notes: ["Google's image model: fast, strong at edits that keep the person and scene identical. Also makes new images.", "Leave aspect_ratio out to keep the photo's own shape."],
    schema: {
      type: "object",
      required: ["prompt"],
      properties: {
        prompt: { type: "string" },
        image_urls: IMAGES,
        image_size: { type: "string", enum: ["1K", "2K", "4K"], default: "2K" },
        aspect_ratio: { type: "string", enum: ["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"] },
      },
    },
  },
  {
    id: "google/nano-banana-pro",
    name: "Nano Banana Pro (Google)",
    category: "image-edit",
    notes: ["Google's top image model: best detail and text rendering, slower and pricier than Nano Banana 2.", "Leave aspect_ratio out to keep the photo's own shape."],
    schema: {
      type: "object",
      required: ["prompt"],
      properties: {
        prompt: { type: "string" },
        image_urls: IMAGES,
        image_size: { type: "string", enum: ["1K", "2K", "4K"], default: "2K" },
        aspect_ratio: { type: "string", enum: ["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"] },
      },
    },
  },
];

export function isDirect(id: string): boolean {
  return id.startsWith("openai/") || id.startsWith("google/");
}

function images(inputs: JsonMap): string[] {
  return Array.isArray(inputs.image_urls) ? inputs.image_urls.map(String) : [];
}

// Edits send no input_fidelity: the 2.5 snapshots keep the source at full
// fidelity on their own and refuse the parameter outright.
// OpenAI output tokens by quality for a square / non-square image (published
// gpt-image table); "auto" size is priced as non-square, the larger of the two.
const OPENAI_OUT: Record<string, [number, number]> = { low: [272, 408], medium: [1056, 1584], high: [4160, 6240] };
// Reservation ceilings. A prompt is capped at MAX_PROMPT_CHARS and never
// tokenizes to more than one token per character, so textTokens() is a true
// upper bound; input images are priced at a generous per-image ceiling and
// capped at MAX_DIRECT_IMAGES. The actual cost replaces this once known.
export const MAX_PROMPT_CHARS = 8000;
export const MAX_DIRECT_IMAGES = 4;
const OPENAI_IN_IMAGE_TOKENS = 10000;
const GOOGLE_IN_IMAGE_TOKENS = 3000;
// "auto" -> undefined (fine), a valid WIDTHxHEIGHT -> [w, h], anything else -> null.
function openaiSize(size: string): [number, number] | undefined | null {
  if (size === "auto") return undefined;
  const m = size.match(/^(\d{2,4})x(\d{2,4})$/);
  if (!m) return null;
  const w = Number(m[1]), h = Number(m[2]);
  if (w % 16 || h % 16 || w > 3840 || h > 3840 || w / h > 3 || h / w > 3) return null;
  if (w * h < 655_360 || w * h > 8_294_400) return null; // OpenAI's total pixel limits
  return [w, h];
}

function textTokens(inputs: JsonMap): number {
  return String(inputs.prompt || "").length + 50;
}

export function directEstimate(id: string, inputs: JsonMap): { usd: number } | { error: string } {
  const n = images(inputs).length;
  if (String(inputs.prompt || "").length > MAX_PROMPT_CHARS) return { error: `The prompt is over ${MAX_PROMPT_CHARS} characters; shorten it.` };
  if (n > MAX_DIRECT_IMAGES) return { error: `At most ${MAX_DIRECT_IMAGES} input images for this model.` };
  if (OPENAI_MODELS[id]) {
    if (!Deno.env.get("OPENAI_KEY")) return { error: "GPT Image is not set up yet (OPENAI_KEY missing)." };
    const [sq, wide] = OPENAI_OUT[String(inputs.quality || "medium")] || OPENAI_OUT.medium;
    const size = String(inputs.size || "auto");
    const dims = openaiSize(size);
    if (dims === null) return { error: `Size "${size}" is not allowed. Use auto, or WIDTHxHEIGHT with both multiples of 16, a shape between 1:3 and 3:1, no edge over 3840 and 0.66 to 8.3 megapixels (vertical 9:16 is 1152x2048).` };
    // Output tokens grow with pixel count; the table is for 1024x1536, so
    // larger custom sizes scale up from it (never below the table figure).
    const out = size === "1024x1024" ? sq : Math.ceil(wide * Math.max(1, dims ? (dims[0] * dims[1]) / (1024 * 1536) : 1));
    return { usd: out * 30e-6 + n * OPENAI_IN_IMAGE_TOKENS * 8e-6 + textTokens(inputs) * 5e-6 };
  }
  const g = GOOGLE_MODELS[id];
  if (!g) return { error: "Unknown model." };
  if (!Deno.env.get("GOOGLE_AI_KEY")) return { error: "Nano Banana is not set up yet (GOOGLE_AI_KEY missing)." };
  const size = String(inputs.image_size || "2K");
  return { usd: (g.perImage[size] ?? g.perImage["2K"]) + (n * GOOGLE_IN_IMAGE_TOKENS + textTokens(inputs)) * g.inRate };
}

export type Fetched = { bytes: Uint8Array<ArrayBuffer>; type: string };
export type DirectResult = { bytes: Uint8Array<ArrayBuffer>; type: string; usd: number | null };

function b64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToB64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

// Runs one direct job. `fetchImage` is index.ts's guarded fetch (public https
// only, size-limited), so caller-supplied links go through the same checks.
export async function runDirect(id: string, inputs: JsonMap, fetchImage: (url: string) => Promise<Fetched>): Promise<DirectResult> {
  const refs = await Promise.all(images(inputs).map(fetchImage));
  const prompt = String(inputs.prompt || "");

  if (OPENAI_MODELS[id]) {
    const model = OPENAI_MODELS[id];
    const key = Deno.env.get("OPENAI_KEY")!;
    const quality = String(inputs.quality || "medium");
    const size = String(inputs.size || "auto");
    let res: Response;
    if (refs.length) {
      const form = new FormData();
      form.append("model", model);
      form.append("prompt", prompt);
      form.append("quality", quality);
      form.append("size", size);
      form.append("output_format", "jpeg");
      form.append("output_compression", "90");
      refs.forEach((r, i) => form.append("image[]", new Blob([r.bytes], { type: r.type }), `input-${i}.${r.type.split("/")[1] || "png"}`));
      res = await fetch("https://api.openai.com/v1/images/edits", { method: "POST", headers: { Authorization: "Bearer " + key }, body: form });
    } else {
      res = await fetch("https://api.openai.com/v1/images/generations", {
        method: "POST",
        headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
        body: JSON.stringify({ model, prompt, quality, size, output_format: "jpeg", output_compression: 90 }),
      });
    }
    const data = await res.json().catch(() => ({})) as JsonMap;
    if (!res.ok) throw new Error(String((data.error as JsonMap | undefined)?.message || `OpenAI answered ${res.status}`));
    const b64 = ((data.data as JsonMap[] | undefined)?.[0]?.b64_json) as string | undefined;
    if (!b64) throw new Error("OpenAI returned no image.");
    const u = (data.usage || {}) as JsonMap;
    const inD = (u.input_tokens_details || {}) as JsonMap;
    const usd = u.output_tokens !== undefined
      ? Number(inD.text_tokens || 0) * 5e-6 + Number(inD.image_tokens || 0) * 8e-6 + Number(u.output_tokens || 0) * 30e-6
      : null;
    // JPEG at 90: visually the same, several times smaller than PNG, so it
    // downloads fast and can be previewed inside the chat.
    return { bytes: b64ToBytes(b64), type: "image/jpeg", usd };
  }

  const g = GOOGLE_MODELS[id];
  const key = Deno.env.get("GOOGLE_AI_KEY")!;
  const size = String(inputs.image_size || "2K");
  const imageConfig: JsonMap = { imageSize: size };
  if (inputs.aspect_ratio) imageConfig.aspectRatio = String(inputs.aspect_ratio);
  const parts: JsonMap[] = refs.map((r) => ({ inline_data: { mime_type: r.type, data: bytesToB64(r.bytes) } }));
  parts.push({ text: prompt });
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${g.api}:generateContent`, {
    method: "POST",
    headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
    body: JSON.stringify({ contents: [{ parts }], generationConfig: { responseModalities: ["IMAGE"], imageConfig } }),
  });
  const data = await res.json().catch(() => ({})) as JsonMap;
  if (!res.ok) {
    const msg = String((data.error as JsonMap | undefined)?.message || `Google answered ${res.status}`);
    throw new Error(/prepayment|billing|quota/i.test(msg) ? msg + " (the Google AI account needs credit)" : msg);
  }
  const outParts = (((data.candidates as JsonMap[] | undefined)?.[0]?.content as JsonMap | undefined)?.parts || []) as JsonMap[];
  const img = outParts.map((p) => (p.inlineData || p.inline_data) as JsonMap | undefined).find((p) => p && p.data);
  if (!img) throw new Error("Google returned no image (it may have declined the request).");
  const usage = (data.usageMetadata || {}) as JsonMap;
  const usd = usage.promptTokenCount !== undefined ? Number(usage.promptTokenCount) * g.inRate + (g.perImage[size] ?? g.perImage["2K"]) : null;
  return { bytes: b64ToBytes(String(img.data)), type: String(img.mimeType || img.mime_type || "image/png"), usd };
}
