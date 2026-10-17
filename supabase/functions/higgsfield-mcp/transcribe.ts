// The database and storage parts of studio_transcribe (the logic is in
// transcribe.mjs). hf_generations rows are reserved through
// hf_reserve_generation like every other job; the transcript goes to the
// private bucket "transcripts" (created by
// supabase/migrations/20261017160000_hf_transcripts_bucket.sql, service role only).

import type { SupabaseClient } from "npm:@supabase/supabase-js@2.49.8";
import { STT_BUCKET, STT_MODEL } from "./transcribe.mjs";

type JsonMap = Record<string, unknown>;
type Reserve = { member: string; model: string; prompt: string; params: JsonMap; cost: number; cap: number; idemKey: string };

export function transcribeStore(client: SupabaseClient) {
  const bucket = () => client.storage.from(STT_BUCKET);
  return {
    reserve: async (p: Reserve): Promise<JsonMap | null> => {
      const { data, error } = await client.rpc("hf_reserve_generation", {
        p_member: p.member, p_model: p.model, p_prompt: p.prompt, p_params: p.params,
        p_cost: p.cost, p_cap: p.cap, p_idem_key: p.idemKey,
      });
      return error || !data ? null : data as JsonMap;
    },
    // Returns how many rows changed; "only" makes the change conditional.
    update: async (id: number, fields: JsonMap, only?: { status?: string }): Promise<number> => {
      let q = client.from("hf_generations").update(fields).eq("id", id);
      if (only?.status) q = q.eq("status", only.status);
      const { data, error } = await q.select("id");
      if (error) throw new Error(error.message);
      return (data || []).length;
    },
    byRequest: async (requestId: string): Promise<JsonMap | null> => {
      const { data } = await client.from("hf_generations")
        .select("id,status,video_url,error,est_cost_usd,params,updated_at")
        .eq("request_id", requestId).maybeSingle();
      return (data as JsonMap | null) || null;
    },
    // The newest finished transcript of the same file (same cache key).
    cached: async (key: string): Promise<{ request_id: string; video_url: string } | null> => {
      const { data } = await client.from("hf_generations")
        .select("request_id,video_url")
        .eq("model", STT_MODEL).eq("status", "completed")
        .contains("params", { source_hash: key, cache_ok: true })
        .not("video_url", "is", null)
        .order("created_at", { ascending: false }).limit(1);
      const row = (data || [])[0] as { request_id: string; video_url: string } | undefined;
      return row || null;
    },
    // The transcript text is stored byte for byte as ElevenLabs sent it.
    upload: async (path: string, text: string): Promise<void> => {
      const body = new Blob([text], { type: "application/json" });
      const { error } = await bucket().upload(path, body, { contentType: "application/json", upsert: true });
      if (error) throw new Error(error.message);
    },
    exists: async (path: string): Promise<boolean> => {
      const { data, error } = await bucket().createSignedUrl(path, 60);
      return !error && Boolean(data?.signedUrl);
    },
    sign: async (path: string, seconds: number): Promise<string> => {
      const { data, error } = await bucket().createSignedUrl(path, seconds, { download: true });
      if (error || !data?.signedUrl) throw new Error(error?.message || "no link returned");
      return data.signedUrl;
    },
  };
}
