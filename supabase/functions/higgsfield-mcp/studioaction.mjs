// The connector's studio_action tool: ONE tool for every studio feature, so a
// new studio feature is a new action here and never a new tool (a new tool
// needs every teammate to press "Refresh tool list"; lessons rule 4).
//
//   studio_action(action, args)
//
// Each action has a name, a plain English line saying what it does, its
// arguments, and run(deps, args). An unknown or missing action answers with
// the list (and is logged as not done: the reply opens with "Unknown " or
// "Give ", both refusal openings in who.mjs). Plain JavaScript with no Deno
// parts, so a unit test can run it; index.ts passes in each action's deps.

import { videoCards } from "./videocards.mjs";
import { toolGet, toolList, toolSave } from "./sharedtools.mjs";

export const STUDIO_ACTIONS = {
  review_notes: {
    does: "Everything needed to do a client's tweaks, read from SyncView: per video its batch, number, title, brief (usually the script), status, every note and change request (Frame.io ones with the time in the video), the latest edit link, the raw footage folder, the filming plan Doc, card links and a download link for the latest edit. Read only.",
    args: {
      client: "the client's name as SyncView shows it (required)",
      videos: "the video numbers, e.g. [7, 8, 12] (optional; leave out for the whole newest batch)",
      batch: "which batch, by words from its name or date (e.g. \"19 Oct\") or \"latest\" (optional)",
      frameio: "false for a quicker answer without Frame.io notes and download link (optional, default true)",
    },
    run: (deps, args) => videoCards(deps.reviewNotes(), args),
  },
  tool_save: {
    does: "Save a client kit or a tool you made so every teammate's Claude gets it. Saving the same name again replaces your own version. Refused if the text looks like it holds a key. On the shared team link, pass who (first name) or nothing is saved.",
    args: {
      name: "short lowercase name, e.g. kit-<client> (required)",
      what: "one line saying what it is (required)",
      use: "when and how to use it (required)",
      client: "the client it is for (optional)",
      bundle: "the tool's text, up to 20,000 characters (required)",
    },
    run: (deps, args) => toolSave(deps.tools(), args),
  },
  tool_list: {
    does: "List the shared tools and client kits: name, what it is, when to use it, client, who made it, status, when. Read only.",
    args: { client: "only tools for this client (optional)" },
    run: (deps, args) => toolList(deps.tools(), args),
  },
  tool_get: {
    does: "Get one shared tool's full text (the latest version). Read only.",
    args: { name: "the tool's name from tool_list (required)" },
    run: (deps, args) => toolGet(deps.tools(), args),
  },
};

export const ACTION_NAMES = Object.keys(STUDIO_ACTIONS);

// "Review notes", "review-notes" -> "review_notes".
export function actionName(raw) {
  return String(raw == null ? "" : raw).trim().toLowerCase().replace(/[\s-]+/g, "_");
}

// args may arrive as an object or, from some chat apps, as JSON text.
export function actionArgs(raw) {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw;
  if (typeof raw === "string" && raw.trim().startsWith("{")) {
    try { const v = JSON.parse(raw); if (v && typeof v === "object" && !Array.isArray(v)) return v; } catch { /* below */ }
  }
  return {};
}

export function actionList() {
  return ACTION_NAMES.map((n) => {
    const a = STUDIO_ACTIONS[n];
    return `- ${n}: ${a.does}\n  args: ${Object.entries(a.args).map(([k, v]) => `${k} (${v})`).join("; ")}`;
  }).join("\n");
}

export const TOOL_DESCRIPTION = "One tool for the Synchro video studio's features: pass action (which feature) and args (its arguments). New studio features are added here as actions, so no tool list refresh is needed. Actions:\n" + actionList() + "\nAn unknown action answers with this list.";

export async function studioAction(deps, rawAction, rawArgs) {
  const name = actionName(rawAction);
  const args = actionArgs(rawArgs);
  if (!name) return `Give an action. Studio actions:\n${actionList()}`;
  const action = Object.prototype.hasOwnProperty.call(STUDIO_ACTIONS, name) ? STUDIO_ACTIONS[name] : null;
  if (!action) return `Unknown studio action "${String(rawAction).trim().slice(0, 60)}". Studio actions:\n${actionList()}`;
  return await action.run(deps, args);
}
