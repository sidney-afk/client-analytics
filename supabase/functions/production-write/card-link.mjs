import { normalizeTeam } from "./policy.mjs";

// Server-side card linking for native creates. Plain JS so the Node test
// suite can drive it with a fake client; imported by index.ts.
const CARD_TABLES = Object.freeze({ calendar: "calendar_posts", samples: "sample_reviews" });
const clean = (v) => String(v == null ? "" : v).trim();
const lower = (v) => clean(v).toLowerCase();

/*
 * Link the card to the work items this request just created, on the server,
 * before the response goes back (OPEN_REPAIRS 254).
 *
 * The browser used to be the only writer of video_deliverable_id /
 * graphic_deliverable_id: it waited for this response and then wrote the card
 * through calendar-upsert / sample-review-upsert. A page closed inside that
 * window (about 3 s) left work items whose card_id names a card that never
 * learned their ids. Now the card side is written here, straight after the
 * deliverables commit, and the browser's later write repeats the same values.
 *
 * Safe to run twice, and never destructive:
 *   - a card that does not exist yet is left alone and counted as `missing`:
 *     creating cards stays with the browser job and its writer (see below);
 *   - an existing card has a slot filled ONLY where it is empty. A slot that
 *     already names a different deliverable is left alone and reported;
 *   - nothing else on an existing card is touched.
 * Best effort: a failure here is reported in the response and never undoes a
 * committed create, because the browser write that follows still repairs it.
 */
function cardSlotColumn(team) {
  return team === "graphics" ? "graphic_deliverable_id" : "video_deliverable_id";
}

export async function linkCardsToCreatedDeliverables(supabase, items) {
  const cards = new Map();
  for (const item of items) {
    const table = CARD_TABLES[lower(item.origin)];
    const client = clean(item.client_slug);
    const cardId = clean(item.card_id);
    const team = normalizeTeam(item.team);
    const id = clean(item.id);
    if (!table || !client || !cardId || !id || (team !== "video" && team !== "graphics")) continue;
    const key = `${table}\u0000${client}\u0000${cardId}`;
    const card = cards.get(key) || { table, client, cardId, slots: {} };
    card.slots[team] = { id };
    cards.set(key, card);
  }
  let linked = 0, already = 0, missing = 0;
  const failed = [], occupied = [];
  for (const card of cards.values()) {
    try {
      const { data: existing, error: readError } = await supabase.from(card.table)
        .select("id,video_deliverable_id,graphic_deliverable_id")
        .eq("client", card.client).eq("id", card.cardId).maybeSingle();
      if (readError) throw new Error("card_read_failed");
      // A card that does not exist yet is NOT created here. Its creation
      // belongs to the browser job, through calendar-upsert /
      // sample-review-upsert, whose trigger records the created fact; a job
      // that never returns leaves it as visible reconcile debt
      // (production_intake_reconcile_cards, "card_creation_held").
      if (!existing) { missing++; continue; }
      for (const [team, slot] of Object.entries(card.slots)) {
        const column = cardSlotColumn(team);
        const { data: filled, error: fillError } = await supabase.from(card.table)
          .update({ [column]: slot.id, updated_at: new Date().toISOString() })
          .eq("client", card.client).eq("id", card.cardId)
          .or(`${column}.is.null,${column}.eq.`)
          .select("id");
        if (fillError) throw new Error("card_fill_failed");
        if (Array.isArray(filled) && filled.length) { linked++; continue; }
        const { data: now } = await supabase.from(card.table).select(column)
          .eq("client", card.client).eq("id", card.cardId).maybeSingle();
        if (clean(now && now[column]) === slot.id) already++;
        else occupied.push(`${card.cardId}:${team}`);
      }
    } catch (_error) {
      failed.push(card.cardId);
    }
  }
  if (failed.length || occupied.length) {
    console.warn("card link incomplete", failed.length, occupied.length);
  }
  return { version: 1, cards: cards.size, linked, already_linked: already,
    occupied: occupied.length, missing, failed: failed.length };
}
