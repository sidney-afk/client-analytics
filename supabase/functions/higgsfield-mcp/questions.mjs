// A client's open questions (synchro-brain clients/<folder>/questions.md,
// spec in the brain's POLICY/questions.md): who may be asked which, the
// one-a-week limit, the note client_brain ends with, and marking a question
// answered. Plain JavaScript with no Deno parts, so a unit test can run it.
//
// Who is asked: Kasper gets `kasper` and `team` questions, any other named
// person only `team` ones, Sidney none (he decided on 2026-10-17 that client
// questions are never his), and a caller with no name none. A person is the
// personal link's name, or on the shared Team link the first name passed as
// "who". Names are matched on the first word, case ignored.

export const QUESTION_TOOL = "question_offered";
export const QUESTION_WINDOW_DAYS = 7;

// One block: "## <question>" then <!-- question ... --> with key: value lines,
// then the plain sentences until the next "## " heading.
export function parseQuestions(text) {
  const lines = String(text || "").replace(/\r\n/g, "\n").split("\n");
  const out = [];
  let cur = null;
  let inBlock = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!inBlock && /^## /.test(line) && /^<!--\s*question\s*$/.test((lines[i + 1] || "").trim())) {
      cur = { heading: line.slice(3).trim(), id: "", ask: "", fact: "", asked: "", status: "", answered: "", body: "" };
      out.push(cur);
      inBlock = true;
      i++;
      continue;
    }
    if (inBlock) {
      if (/^\s*-->\s*$/.test(line)) { inBlock = false; continue; }
      const m = line.match(/^\s*([a-z]+):\s*(.*?)\s*$/i);
      if (m && cur && Object.prototype.hasOwnProperty.call(cur, m[1].toLowerCase()) && m[1].toLowerCase() !== "body" && m[1].toLowerCase() !== "heading") {
        cur[m[1].toLowerCase()] = m[2];
      }
      continue;
    }
    if (/^## /.test(line)) { cur = null; continue; }
    if (cur) cur.body += (cur.body ? "\n" : "") + line;
  }
  for (const q of out) {
    q.body = q.body.trim();
    q.ask = q.ask.toLowerCase();
    q.status = q.status.toLowerCase();
  }
  return out;
}

// The person this call is for: { name, role } where role is "kasper",
// "sidney", "team" or "" (nobody named). member is the link's name; on the
// Team link, who is the cleaned first name ("" when not given).
export function questionPerson(member, who, teamLink) {
  const name = String(teamLink ? (who || "") : (member || "")).trim();
  if (!name) return { name: "", role: "" };
  const first = name.split(/\s+/)[0].toLowerCase();
  if (first === "sidney") return { name, role: "sidney" };
  if (first === "kasper") return { name, role: "kasper" };
  return { name, role: "team" };
}

export function asksFor(role) {
  if (role === "kasper") return ["kasper", "team"];
  if (role === "team") return ["team"];
  return [];
}

// The one question to offer, or null. offered is the set of question ids this
// person was already offered in the last 7 days. Order: for Kasper his own
// (`kasper`) questions before `team` ones; then the oldest `asked` first; then
// file order.
export function pickQuestion(questions, role, offered) {
  const allowed = asksFor(role);
  if (!allowed.length) return null;
  const seen = offered instanceof Set ? offered : new Set(offered || []);
  const open = (questions || [])
    .map((q, i) => ({ q, i }))
    .filter(({ q }) => q.id && q.status === "open" && allowed.includes(q.ask) && !seen.has(q.id));
  open.sort((a, b) =>
    allowed.indexOf(a.q.ask) - allowed.indexOf(b.q.ask) ||
    String(a.q.asked || "9999").localeCompare(String(b.q.asked || "9999")) ||
    a.i - b.i);
  return open.length ? open[0].q : null;
}

// What client_brain ends with when a question is offered.
export function questionNote(q, clientName) {
  return [
    "",
    "---",
    `One open question about ${clientName} that this person can answer (question id: ${q.id}):`,
    `${q.heading}`,
    q.body ? q.body : "",
    "",
    "Do not ask it now. Do the person's task first. At the END of their task, ask this one question in one plain sentence, and only this one (never another question from the brain). If they do not know or do not want to answer, drop it. If they answer, save their answer with brain_change: client set to " +
      `"${clientName}", what_changed set to their answer in their own words, and question_id set to "${q.id}". Then confirm in one line.`,
  ].filter((l, i, a) => !(l === "" && a[i - 1] === "")).join("\n");
}

// The hf_activity row that records one offer (the 7-day limit reads these).
export function offerRow({ member, who, teamLink, folder, id }) {
  return {
    member_name: String(member || "").slice(0, 80),
    who: teamLink ? (String(who || "").slice(0, 40) || null) : null,
    tool: QUESTION_TOOL,
    client: String(folder || "").slice(0, 120) || null,
    summary: String(id || "").slice(0, 200),
    ok: true,
    error: null,
  };
}

// Sets one open question's status to answered and adds the answered line,
// inside its own block only. Returns the new text, or null when the id is not
// an open question in this text.
export function markAnswered(text, id, answeredLine) {
  const src = String(text || "");
  const nl = src.includes("\r\n") ? "\r\n" : "\n";
  const lines = src.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (!/^## /.test(lines[i]) || !/^<!--\s*question\s*$/.test((lines[i + 1] || "").trim())) continue;
    let end = i + 2;
    while (end < lines.length && !/^\s*-->\s*$/.test(lines[end])) end++;
    if (end >= lines.length) return null;
    const block = lines.slice(i + 2, end);
    const val = (k) => { const l = block.find((b) => new RegExp(`^\\s*${k}:`, "i").test(b)); return l ? l.replace(/^\s*[a-z]+:\s*/i, "").trim() : ""; };
    if (val("id") !== id) continue;
    if (val("status").toLowerCase() !== "open") return null;
    const statusAt = block.findIndex((b) => /^\s*status:/i.test(b));
    const newBlock = block.slice();
    newBlock[statusAt] = "status: answered";
    const answeredAt = newBlock.findIndex((b) => /^\s*answered:/i.test(b));
    if (answeredAt >= 0) newBlock.splice(answeredAt, 1);
    newBlock.splice(statusAt + 1, 0, `answered: ${answeredLine}`);
    return [...lines.slice(0, i + 2), ...newBlock, ...lines.slice(end)].join(nl);
  }
  return null;
}

// ---- The two connector steps, with GitHub and the log passed in -----------

// The note to add to client_brain for this person, or "" for none. deps:
//   readQuestions(): questions.md text ("" when missing; throws on failure)
//   offeredSince(isoDate): question ids this person was offered since then
//   recordOffer(row): writes the hf_activity row
// Any failure reading the file or the log offers nothing: the weekly limit
// cannot be checked, so no question is better than a repeated one.
export async function questionFor({ member, who, teamLink, folder, clientName, now = null }, deps) {
  const person = questionPerson(member, who, teamLink);
  if (!asksFor(person.role).length || !folder) return "";
  let questions;
  try {
    questions = parseQuestions(await deps.readQuestions());
  } catch (_e) {
    return "";
  }
  if (!questions.some((q) => q.status === "open")) return "";
  const since = new Date((now ? now.getTime() : Date.now()) - QUESTION_WINDOW_DAYS * 86400_000).toISOString();
  let offered;
  try {
    offered = new Set(await deps.offeredSince(since));
  } catch (_e) {
    return "";
  }
  const q = pickQuestion(questions, person.role, offered);
  if (!q) return "";
  try {
    await deps.recordOffer(offerRow({ member, who, teamLink, folder, id: q.id }));
  } catch (_e) {
    return "";
  }
  return questionNote(q, clientName);
}

// Checks a question_id given to brain_change. Returns { ok: true, question }
// or { ok: false, message } in plain words.
export function checkQuestionId(text, id, folder, clientName) {
  const want = String(id || "").trim();
  const questions = parseQuestions(text);
  const q = questions.find((x) => x.id === want);
  if (!q) {
    return { ok: false, message: `Could not find a question with the id "${want}" for ${clientName}. Nothing was saved. Use the question id exactly as client_brain gave it, or save the answer without question_id.` };
  }
  if (q.status !== "open") {
    return { ok: false, message: `Could not use question "${want}": it is not open any more (it is ${q.status || "closed"}). Nothing was saved. If what the person said is still new, save it without question_id.` };
  }
  if (folder && !want.startsWith(`q.${folder}.`)) {
    return { ok: false, message: `Could not use question "${want}": it does not belong to ${clientName}. Nothing was saved.` };
  }
  return { ok: true, question: q };
}
