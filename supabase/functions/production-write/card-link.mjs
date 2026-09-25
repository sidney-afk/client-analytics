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
 *   - a missing card is inserted with the same starting values the browser
 *     writes; a concurrent insert (unique violation) falls through to the fill;
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
    const card = cards.get(key) || { table, client, cardId, number: Number(item.video_number) || 0,
      title: "", slots: {} };
    if (!card.title) card.title = clean(item.title);
    card.slots[team] = { id, url: clean(item.linear_issue_url) };
    cards.set(key, card);
  }
  let linked = 0, already = 0;
  const failed = [], occupied = [];
  const baseOrder = new Map();
  for (const card of cards.values()) {
    try {
      const { data: existing, error: readError } = await supabase.from(card.table)
        .select("id,video_deliverable_id,graphic_deliverable_id")
        .eq("client", card.client).eq("id", card.cardId).maybeSingle();
      if (readError) throw new Error("card_read_failed");
      let inserted = false;
      if (!existing) {
        const orderKey = `${card.table}\u0000${card.client}`;
        if (!baseOrder.has(orderKey)) {
          const { data: orders } = await supabase.from(card.table)
            .select("order_index").eq("client", card.client);
          const max = (orders || [])
            .reduce((m, row) => Math.max(m, Number(row.order_index) || 0), 0);
          baseOrder.set(orderKey, max || Math.floor(Date.now() / 1000));
        }
        const video = card.slots.video, graphic = card.slots.graphics;
        const row = {
          client: card.client, id: card.cardId,
          order_index: String((baseOrder.get(orderKey) || 0) + card.number),
          name: card.title || `Video ${card.number}`,
          status: "In Progress", video_status: "In Progress", graphic_status: "In Progress",
          asset_url: "", thumbnail_url: "",
          // null, never "": both id columns carry a foreign key to deliverables.
          linear_issue_id: video ? video.url : "", video_deliverable_id: video ? video.id : null,
          graphic_linear_issue_id: graphic ? graphic.url : "",
          graphic_deliverable_id: graphic ? graphic.id : null,
          updated_at: new Date().toISOString(),
          ...(card.table === "calendar_posts"
            ? { scheduled_date: "", caption_status: "In Progress", caption: "", cta: "", tweaks: "",
              video_tweaks: "", graphic_tweaks: "", caption_tweaks: "" }
            : { creative_direction: "", hide_creative_direction: "" }),
        };
        const { error: insertError } = await supabase.from(card.table).insert(row);
        if (!insertError) { inserted = true; linked++; }
        else if (insertError.code !== "23505") throw new Error("card_insert_failed");
      }
      if (inserted) continue;
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
    occupied: occupied.length, failed: failed.length };
}
