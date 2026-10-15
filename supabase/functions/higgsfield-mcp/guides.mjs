// The team's playbooks, served by the connector's "guide" tool.
//
// Each guide is a row in hf_guides (topic, body). A change is a NEW row, never
// an edit, so the newest row per topic is the live guide and the older rows are
// its history. Guides are written straight into the table, so a change reaches
// every teammate on their next call: no skill to reinstall, no deploy.

export const TOPIC_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
export const START_TOPIC = "start";

export function cleanTopic(raw) {
  if (typeof raw !== "string") return "";
  const t = raw.trim().toLowerCase().replace(/[\s_]+/g, "-");
  return TOPIC_RE.test(t) ? t : "";
}

// Newest row per topic, from rows in any order.
export function latestGuides(rows) {
  const latest = new Map();
  for (const r of Array.isArray(rows) ? rows : []) {
    const topic = cleanTopic(r && r.topic);
    const body = r && typeof r.body === "string" ? r.body.trim() : "";
    if (!topic || !body) continue;
    const at = Date.parse(String(r.created_at || "")) || 0;
    const seen = latest.get(topic);
    if (!seen || at > seen.at) latest.set(topic, { topic, body, at });
  }
  return latest;
}

function firstLine(body) {
  return body.split("\n").map((l) => l.replace(/^#+\s*/, "").trim()).find(Boolean) || "";
}

function dated(g) {
  return g.at ? `\n\n(Guide "${g.topic}", updated ${new Date(g.at).toISOString().slice(0, 10)}.)` : "";
}

// The list of guides, one line each, for start_here and an unknown topic.
export function guideIndex(latest) {
  return [...latest.values()]
    .filter((g) => g.topic !== START_TOPIC)
    .sort((a, b) => a.topic.localeCompare(b.topic))
    .map((g) => `- ${g.topic}: ${firstLine(g.body)}`)
    .join("\n");
}

// What the guide tool answers. No topic: the starting guide and the list.
export function guideReply(rows, rawTopic) {
  const latest = latestGuides(rows);
  if (!latest.size) return "No team guides are written yet. Follow start_here and the connector's own instructions.";
  const index = guideIndex(latest);
  const topic = cleanTopic(rawTopic);
  if (!topic || topic === START_TOPIC) {
    const start = latest.get(START_TOPIC);
    return `${start ? start.body + "\n\n" : ""}Guides (call guide with one of these topics before that kind of task):\n${index || "none yet"}`;
  }
  const g = latest.get(topic);
  if (!g) return `No guide called "${topic}". Guides:\n${index || "none yet"}`;
  return g.body + dated(g);
}
