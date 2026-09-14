// The claimed database intent owns the destination and card identity. No caller URL.
export function urgentWebsiteText(claim: any, intent: any): string {
  if (!intent || intent.id !== claim.intent_id || intent.kind !== "urgent"
      || intent.state !== "sending" || intent.attempt_count !== claim.attempt
      || intent.destination_channel_id !== claim.destination_channel_id
      || claim.client_msg_id !== claim.intent_id || claim.allow_mentions !== true
      || intent.message?.allow_mentions !== true || intent.message?.text !== claim.text
      || typeof intent.deliverable_id !== "string" || !intent.deliverable_id.trim()
      || intent.deliverable_id.length > 300 || /[\x00-\x1f\x7f]/.test(intent.deliverable_id)
      || typeof claim.text !== "string") throw new Error("urgent_link_context_invalid");
  const query = new URLSearchParams({ prod: "1", d: intent.deliverable_id });
  const url = "https://syncview.synchrosocial.com/?" + query.toString() + "#production";
  // Preserve an already-correct link without duplicating it.
  return claim.text.split(/\s+/).some((token: string) => token === url || token === "<" + url + ">" || token.startsWith("<" + url + "|")) ? claim.text : claim.text + "\nOpen in SyncView: " + url;
}
