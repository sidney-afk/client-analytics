// The connector's filming pipeline tools for Claude (item 1, PR 2):
//   client_record(client)                              a short summary of a client's file store
//   feedback_note(client?, title, body, follows?)      save a note from the chat (source "chat")
//   feedback_notes(since, client?)                     read notes, for supervisors only: a personal
//                                                      connector link whose member is on the publish
//                                                      list (fp_publishers), checked here, server side
// Plain JavaScript with no Deno parts, so a unit test can run it; index.ts
// passes in the database reads and writes as deps. The note rules are the
// same ones pipeline-google uses for notes.add (../pipeline-google/store.mjs).

import { UUID_RE, noteRow } from "../pipeline-google/store.mjs";

export const NOTES_LIMIT = 50;
export const NOTES_MAX_CHARS = 60_000;

const when = (t) => {
  const d = new Date(String(t));
  return Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 16).replace("T", " ") + " UTC" : "unknown time";
};

// deps.findClient(query) -> { plan?: { client_slug, client_name }, choices?: string[] }
const which = (found) => `Which client? ${found.choices && found.choices.length ? "Options: " + found.choices.join(", ") : "No match."}`;

// deps: findClient, files(slug) -> [{ name, version, updated_by, updated_at }] (never a body),
//       nextBatch(slug) -> integer or null (fp_batch_counter.next; null: no row)
export async function clientRecord(deps, client) {
  const found = await deps.findClient(String(client || ""));
  if (!found.plan) return which(found);
  const p = found.plan;
  const [files, next] = await Promise.all([deps.files(p.client_slug), deps.nextBatch(p.client_slug)]);
  const latest = Number.isInteger(next) && next > 1 ? next - 1 : 0;
  const lines = [
    `${p.client_name}: filming pipeline record (file names and versions only, no contents).`,
    latest ? `Latest idea batch: ${latest} (the next one taken will be ${latest + 1}).` : "Latest idea batch: none taken yet.",
  ];
  if (!files.length) {
    lines.push("Files: none saved yet.");
  } else {
    lines.push(`Files (${files.length}):`);
    for (const f of [...files].sort((a, b) => String(a.name).localeCompare(String(b.name)))) {
      lines.push(`- ${f.name}: version ${f.version}, last saved ${when(f.updated_at)} by ${f.updated_by}`);
    }
  }
  return lines.join("\n");
}

// deps: findClient, noteExists(id) -> boolean, addNote(row) -> { id, created_at }
export async function feedbackNote(deps, args, member) {
  let slug = null, name = "";
  const asked = String(args.client || "").trim();
  if (asked) {
    const found = await deps.findClient(asked);
    if (!found.plan) return which(found);
    slug = found.plan.client_slug;
    name = found.plan.client_name;
  }
  const made = noteRow({ title: args.title, body: args.body, source: "chat", follows: args.follows }, { member, client: slug });
  if (!made.ok) {
    const why = String(made.error || "the note is not valid");
    return why.startsWith("Give ") ? why : `Could not save the note: ${why}`;
  }
  if (made.row.follows && !(await deps.noteExists(made.row.follows))) return "Could not save the note: follows names a note that does not exist (use the id feedback_notes shows).";
  const saved = await deps.addNote(made.row);
  return `Saved note ${saved.id}${name ? ` for ${name}` : ""}: "${made.row.title}".`;
}

// "2026-10-10", "2026-10-10T08:00:00Z" and the like. Answers an ISO string or "".
export function sinceOf(raw) {
  const s = String(raw || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}([T ][0-9:.]+(Z|[+-]\d{2}:?\d{2})?)?$/.test(s)) return "";
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(s) ? s + "T00:00:00Z" : s.replace(" ", "T"));
  return Number.isFinite(d.getTime()) ? d.toISOString() : "";
}

// Oldest first, so a long range is read in pages: each answer that stops
// early names the since to ask with next.
// deps: findClient, notes({ since, slug|null, limit }) -> rows oldest first (created_at >= since),
//       clientNames() -> Map slug -> name, isPublisher(member) -> boolean
// who: { member, teamLink } of the caller's connector link.
export const NOTES_REFUSED = "Refused: feedback_notes is for supervisors (a personal connector link on the publish list). Ask the account owner if you need to read the notes.";
export async function feedbackNotes(deps, args, who) {
  if (!who || who.teamLink || !String(who.member || "").trim()) return NOTES_REFUSED;
  if (!(await deps.isPublisher(String(who.member)))) return NOTES_REFUSED;
  const since = sinceOf(args.since);
  if (!since) return 'Give since as a date, for example "2026-10-10" (UTC), or a date and time.';
  let slug = null, label = "all clients";
  const asked = String(args.client || "").trim();
  if (asked) {
    const found = await deps.findClient(asked);
    if (!found.plan) return which(found);
    slug = found.plan.client_slug;
    label = found.plan.client_name;
  }
  const rows = await deps.notes({ since, slug, limit: NOTES_LIMIT + 1 });
  const more = rows.length > NOTES_LIMIT;
  const shown = rows.slice(0, NOTES_LIMIT);
  if (!shown.length) return `No feedback notes since ${when(since)} (${label}).`;
  const names = await deps.clientNames();
  const head = `Feedback notes since ${when(since)} (${label}), oldest first: ${shown.length}${more ? " shown, and there are more" : ""}.`;
  const parts = [];
  let used = head.length, last = null;
  for (const r of shown) {
    const meta = [
      `id ${r.id}`,
      when(r.created_at),
      `by ${r.member}`,
      r.client_slug ? `client ${names.get(r.client_slug) || r.client_slug}` : "no client",
      `from ${r.source}`,
      r.follows ? `follows ${r.follows}` : "",
    ].filter(Boolean).join(", ");
    const block = `## ${r.title}\n${meta}\n\n${r.body}`;
    if (parts.length && used + block.length + 2 > NOTES_MAX_CHARS) break;
    parts.push(block);
    used += block.length + 2;
    last = r;
  }
  const stopped = more || parts.length < shown.length;
  // The last shown note's own time: the next page starts with it again, so none is skipped.
  const next = last ? String(last.created_at) : since;
  const tail = stopped ? `\n\n[Not all notes are shown. Read the rest with since "${next}" (it repeats the last note above).]` : "";
  return `${head}\n\n${parts.join("\n\n")}${tail}`;
}

export { UUID_RE };
