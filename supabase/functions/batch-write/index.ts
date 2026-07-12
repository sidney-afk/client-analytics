import { handleB4Write } from "../_shared/b4-write.ts";

Deno.serve((req: Request) => handleB4Write(req, {
  table: "batches",
  rpc: "batch_write",
  entity: "batch",
}));
