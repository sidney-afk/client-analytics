// Pure helpers for the brain Edge Function, shared with the unit test.

// SyncView slugs drop every non-alphanumeric; brain folders use dashes.
export function findClientFolder(folders, slug) {
  const want = String(slug || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!want) return null;
  return (folders || []).find((f) => String(f).toLowerCase().replace(/[^a-z0-9]/g, "") === want) || null;
}

// A fact is a "## Heading" followed by a <!-- brain ... --> block, then prose
// until the next "## " heading. Headings without a block are kept as prose of
// the previous fact, so nothing a person wrote is dropped.
export function parseBrainFacts(text, file) {
  const lines = String(text || "").replace(/\r\n/g, "\n").split("\n");
  const facts = [];
  let cur = null;
  let inBlock = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!inBlock && /^## /.test(line) && /^<!--\s*brain\s*$/.test((lines[i + 1] || "").trim())) {
      cur = { file, heading: line.slice(3).trim(), id: "", owner: "", status: "not-written", source: "", updated: "", spec: "", body: "" };
      facts.push(cur);
      inBlock = true;
      i++;
      continue;
    }
    if (inBlock) {
      if (line.trim() === "-->") { inBlock = false; continue; }
      const m = /^\s*([a-z_]+):\s*(.*)$/.exec(line);
      if (m && cur && Object.prototype.hasOwnProperty.call(cur, m[1]) && m[1] !== "body") cur[m[1]] = m[2].trim();
      continue;
    }
    if (cur) cur.body += line + "\n";
  }
  for (const f of facts) f.body = f.body.trim();
  return facts;
}

// "font=Cardo; main=#fff; highlight=none" -> [{key:"font",value:"Cardo"},...]
export function parseSpec(spec) {
  return String(spec || "").split(";").map((p) => p.trim()).filter(Boolean).map((p) => {
    const i = p.indexOf("=");
    return i < 0 ? { key: "", value: p } : { key: p.slice(0, i).trim(), value: p.slice(i + 1).trim() };
  });
}

// brief.md -> [{ heading, bullets: [{ text, facts: [ids] }] }]
export function parseBrief(text) {
  const sections = [];
  let cur = null;
  for (const line of String(text || "").replace(/\r\n/g, "\n").split("\n")) {
    const h = /^##\s+(.+)$/.exec(line);
    if (h) { cur = { heading: h[1].trim(), bullets: [] }; sections.push(cur); continue; }
    const b = /^-\s+(.*)$/.exec(line);
    if (!b || !cur) continue;
    const m = /<!--\s*fact:\s*([^>]*?)\s*-->/.exec(b[1]);
    const facts = m ? m[1].split(",").map((x) => x.trim()).filter(Boolean) : [];
    cur.bullets.push({ text: b[1].replace(/<!--[\s\S]*?-->/g, "").trim(), facts });
  }
  return sections.filter((x) => x.bullets.length);
}
