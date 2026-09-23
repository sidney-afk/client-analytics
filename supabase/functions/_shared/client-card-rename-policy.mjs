/*
 * Clients may not rename cards (owner decision, 2026-09-23). The calendar's
 * client view hides the name field, but that is a browser gate; this is the
 * server's.
 *
 * The refusal drops ONLY the name change and lets the rest of the save
 * through. A client's approve / request-changes rides the same calendar-upsert
 * save as the card's other fields, and the owner's first rule for this feature
 * is that approving and requesting changes never fail. Refusing the whole save
 * because a stale browser also sent a different name would break exactly that.
 *
 * Returns the name to store:
 *   { keep: true }                 -> leave `incoming.name` as sent
 *   { keep: false, name, refused } -> overwrite with the stored name
 */
export function clientCardNameDecision(principalRole, incoming, existing) {
  if (String(principalRole || "") !== "client") return { keep: true, refused: false };
  if (!incoming || !Object.prototype.hasOwnProperty.call(incoming, "name")) {
    return { keep: true, refused: false };
  }
  // A card the client is creating has no stored name to protect.
  if (!existing || !existing.id) return { keep: true, refused: false };
  const stored = existing.name == null ? "" : String(existing.name);
  const sent = incoming.name == null ? "" : String(incoming.name);
  if (sent === stored) return { keep: true, refused: false };
  return { keep: false, name: existing.name == null ? null : stored, refused: true };
}
