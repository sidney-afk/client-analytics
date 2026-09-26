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
  const url = "https://syncview.synchrosocial.com/synclinear/" + encodeURIComponent(intent.deliverable_id);
  // The pre-clean-URL form of the same link; the site still forwards it.
  const legacy = "https://syncview.synchrosocial.com/?" + new URLSearchParams({ prod: "1", d: intent.deliverable_id }).toString() + "#production";
  // Preserve an already-correct link (either form) without duplicating it.
  const has = (u: string) => claim.text.split(/\s+/).some((token: string) => token === u || token === "<" + u + ">" || token.startsWith("<" + u + "|"));
  return has(url) || has(legacy) ? claim.text : claim.text + "\nOpen in SyncView: " + url;
}
