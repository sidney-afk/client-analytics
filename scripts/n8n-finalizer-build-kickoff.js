// OPEN_REPAIRS 696. The Slack Creative Channel Finalizer's "Build Kickoff" Code step, kept here as the
// source of truth: the n8n step's code is BUILD_KICKOFF_JS below, byte for byte. It builds the creative
// channel's first message from what exists at finalize time (owner, 3 Nov 2026: "change the n8n
// workflow"; the logins stay in Slack, owner rule 24 Aug). Anything missing becomes a bracketed
// placeholder, never a guess. No Slack id, Drive id, client name or login is written here: every one is
// read from the steps before it (Check Readiness and Slack Decision, Read SMM Assignment, Read Clients
// Info, Read Filming Plan, Read Sales Intake) and from the queue row's own snapshot.
//
// Test: test/n8n-finalizer-build-kickoff.js runs this code against fictional step outputs.
'use strict';

const BUILD_KICKOFF_JS = String.raw`const rows = name => { try { return $(name).all().map(i => i.json || {}); } catch (e) { return []; } };
const first = name => rows(name)[0] || {};
const s = v => String(v == null ? "" : v).trim();
const FILL = t => "[ " + t + " ]";
const base = first("Verify Clients Info Readback");
const job = first("Pick One Pending Job");
const ready = first("Check Readiness and Slack Decision");
const name = s(job.client_name);
const info = rows("Read Clients Info").find(r => s(r.client_name) === name) || {};
const smmRow = rows("Read SMM Assignment").find(r => s(r.client_name) === name) || {};
const plan = rows("Read Filming Plan").find(r => s(r.client_slug) === s(job.viewer_slug) && s(r.doc_url)) || {};
const intakes = rows("Read Sales Intake").filter(r => s(r.client_email).toLowerCase() === s(job.email).toLowerCase() && !/cancel/i.test(s(r.status)));
intakes.sort((a, b) => s(b.created_at).localeCompare(s(a.created_at)));
const intake = intakes[0] || {};
const tag = id => /^U[A-Z0-9]{6,}$/i.test(s(id)) ? "<@" + s(id) + ">" : "";
const smmTag = tag(smmRow.slack_profile_url);
// Check Readiness builds private_required_members as Array.from(new Set([KASPER_ID, smmSlackId])): a Set keeps
// insertion order, so Kasper (its fixed constant, inserted first) is always element 0, also when he is the SMM.
const leadIds = Array.isArray(ready.private_required_members) ? ready.private_required_members : [];
const kasperTag = tag(leadIds[0]);
const smm = smmTag || FILL("SMM");
const lead = kasperTag || FILL("Kasper");
// The queue row's snapshot was written at form time, in Slack's single-asterisk bold. Read one labelled
// answer: "*Label* — value" on one line, or "*Label*" followed by paragraphs up to the next bold label.
const brief = s(job.form_brief);
const field = label => {
  const head = "*" + label + "*";
  const at = brief.indexOf(head);
  if (at < 0) return "";
  const rest = brief.slice(at + head.length);
  if (rest.startsWith(" — ")) return s(rest.slice(3).split("\n")[0]);
  if (!rest.startsWith("\n\n")) return "";
  const out = [];
  for (const para of rest.slice(2).split("\n\n")) { if (para.startsWith("*")) break; out.push(para); }
  return s(out.join("\n"));
};
const kick = s(job.kickoff);
let logins = "";
const a0 = kick.indexOf("*Account access*\n\n");
if (a0 >= 0) {
  const from = a0 + "*Account access*\n\n".length;
  const end = kick.indexOf("\n\n*Full form answers*", from);
  logins = s(end > from ? kick.slice(from, end) : kick.slice(from));
}
const isAi = s(job.funnel).toLowerCase() === "ai";
const funnel = isAi ? "AI funnel" : s(job.funnel) ? "Standard funnel" : FILL("funnel");
const scope = s(intake.deliverables);
const filming = scope ? /film|shoot|videograph/i.test(scope) : null;
const manychat = scope ? /many ?chat/i.test(scope) : null;
const folder = s(job.folder_id) ? "https://drive.google.com/drive/folders/" + s(job.folder_id) : FILL("Drive folder");
const formUrl = s(job.viewer_slug) ? "https://syncview.synchrosocial.com/?onboarding_view=" + encodeURIComponent(s(job.viewer_slug)) : FILL("onboarding form link");
const deck = field("Brand guidelines");
const keywords = [s(info.keywords), s(info.specific_keywords)].filter(Boolean).join(", ");
const brand = [s(info.content_description) || field("Their process") || FILL("brand summary from the research"), keywords ? "Keywords: " + keywords : ""].filter(Boolean).join("\n");
const audience = [field("Ideal customer"), field("Pain points") ? "Pain points: " + field("Pain points") : ""].filter(Boolean).join("\n") || FILL("audience");
const goals = [field("Desired outcomes"), field("What makes this a win") ? "A win: " + field("What makes this a win") : ""].filter(Boolean).join("\n") || FILL("goals");
const styleParts = [
  field("Creators for inspiration") ? "Inspiration: " + field("Creators for inspiration").split("\n").join(" · ") : "",
  field("Video look, in their words") ? "Look: " + field("Video look, in their words") : "",
  field("Subtitles") ? "Subtitles: " + field("Subtitles") : "",
  field("Music") ? "Music: " + field("Music") : "",
  field("Thumbnail") ? "Thumbnail: " + field("Thumbnail") : "",
  field("Always / never include") ? "Always / never: " + field("Always / never include") : "",
].filter(Boolean);
const team = ["SMM " + smm, "Lead " + lead, "CCS " + FILL("assign"), "GD " + FILL("assign")];
if (filming === true) team.push("Videographer " + FILL("assign"));
if (filming === null) team.push("Videographer " + FILL("if the scope includes filming"));
const actions = [
  "• " + lead + " book the kickoff call with " + smm,
  "• " + smm + " connect Post for Me" + (manychat === true ? ", and do the ManyChat plan" : manychat === null ? " " + FILL("and the ManyChat plan, if it is in scope") : ""),
  "• CCS / GD " + FILL("assign") + " build the thumbnail Canva template",
];
if (filming === true) actions.push("• " + lead + " book the videographer");
if (filming === null) actions.push("• " + FILL("book the videographer, if the scope includes filming"));
const lines = [
  "*New client — " + (name || FILL("client")) + "* · " + funnel,
  "",
  "*Team*",
  team.join(" · "),
  "",
  "*Resources*",
  "Onboarding form — " + formUrl,
  "Drive folder — " + folder,
  "Filming plan — " + (s(plan.doc_url) || FILL("filming plan link")),
  "Brand deck — " + (deck || "none sent"),
  "Onboarding call — " + FILL("add link"),
  "",
  "*Account access*",
  logins || "_No account access in the form yet: chase it before the first post._",
  "",
  "*The brand*",
  brand,
  "",
  "*Audience*",
  audience,
  "",
  "*Goals*",
  goals,
  "",
  "*Style*",
  styleParts.join("\n") || FILL("style"),
  "",
  "*Scope*",
  scope || FILL("deliverables from the sales intake"),
  "",
  "*Action items*",
  actions.join("\n"),
  "",
  "*Timeline*",
  FILL("Kasper — strategy · first samples · first post"),
  "",
  "Full form answers in the next message.",
];
const kickoff_text = lines.join("\n").split("**").join("*");
return [{ json: { ...base, kickoff_text } }];`;

module.exports = { BUILD_KICKOFF_JS };
