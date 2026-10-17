// The database and storage parts of voice_cleanup (the logic is in voice.mjs).
// hf_generations rows are reserved through hf_reserve_generation like every
// other job; the cleaned WAV goes to the private bucket "voice" (created by
// supabase/migrations/20261017040000_hf_voice_bucket.sql, service role only).

import type { SupabaseClient } from "npm:@supabase/supabase-js@2.49.8";
import { VOICE_BUCKET } from "./voice.mjs";

type JsonMap = Record<string, unknown>;
type Reserve = { member: string; model: string; prompt: string; params: JsonMap; cost: number; cap: number; idemKey: string };

export function voiceStore(client: SupabaseClient) {
  return {
    reserve: async (p: Reserve): Promise<JsonMap | null> => {
      const { data, error } = await client.rpc("hf_reserve_generation", {
        p_member: p.member, p_model: p.model, p_prompt: p.prompt, p_params: p.params,
        p_cost: p.cost, p_cap: p.cap, p_idem_key: p.idemKey,
      });
      return error || !data ? null : data as JsonMap;
    },
    // Returns how many rows changed; "only" makes the change conditional
    // (the copy is claimed by the one check that moves the row on).
    update: async (id: number, fields: JsonMap, only?: { status?: string; updated_at?: string }): Promise<number> => {
      let q = client.from("hf_generations").update(fields).eq("id", id);
      if (only?.status) q = q.eq("status", only.status);
      if (only?.updated_at) q = q.eq("updated_at", only.updated_at);
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
    upload: async (path: string, body: ReadableStream<Uint8Array>, contentType: string): Promise<void> => {
      const { error } = await client.storage.from(VOICE_BUCKET).upload(path, body, { contentType, upsert: true, duplex: "half" });
      if (error) throw new Error(error.message);
    },
    sign: async (path: string, seconds: number): Promise<string> => {
      const { data, error } = await client.storage.from(VOICE_BUCKET).createSignedUrl(path, seconds, { download: true });
      if (error || !data?.signedUrl) throw new Error(error?.message || "no link returned");
      return data.signedUrl;
    },
  };
}
