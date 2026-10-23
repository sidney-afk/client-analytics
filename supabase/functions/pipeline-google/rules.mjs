// What a filming pipeline pass may do in pipeline-google. Plain JavaScript
// with no Deno parts, so a unit test can run every rule offline.
//
// Files. A pass belongs to one client and one target. Its client's own files
// come from that client's config.json in the file store (fp_files): the ideas
// Sheet (sheet.id), the live filming plan Doc (filming_plan_live_doc), the
// test Doc (filming_plan_test_doc) and the Drive folder (sheet.drive_folder).
// The TEST Sheet comes from fp_settings (key test_sheet).
//   Reads (docs.get, sheets.get, sheets.values.get, drive.get): the client's
//   own files, plus the files the pass may write.
//   Company files: fp_settings key company_read_files (a JSON list of file
//   ids) names company-wide files, such as the format library, that every
//   pass may READ for any client and target. Never written.
//   Writes: target "client" -> the ideas Sheet and the live plan Doc;
//           target "test"   -> the TEST Sheet and the client's test Doc.
//   drive.copy and drive.folder: never with a pass.
//
// Tabs. Inside a file a pass may add a tab (recorded in fp_pass_tabs), and
// write, format or move-to-first only inside tabs created through a pass.
// Every request must name its tab; one that does not (Google would use the
// first tab) or that names any other tab refuses the whole call. Deleting,
// renaming, hiding or copying a tab is always refused.

export const ID_RE = /^[A-Za-z0-9_-]{10,100}$/;
export const READ_ACTIONS = new Set(["docs.get", "sheets.get", "sheets.values.get", "drive.get"]);
export const WRITE_ACTIONS = new Set(["docs.batchUpdate", "sheets.batchUpdate", "sheets.values.update", "sheets.values.append"]);
export const FILE_KEY = {
  "docs.get": "documentId",
  "docs.batchUpdate": "documentId",
  "sheets.get": "spreadsheetId",
  "sheets.batchUpdate": "spreadsheetId",
  "sheets.values.get": "spreadsheetId",
  "sheets.values.update": "spreadsheetId",
  "sheets.values.append": "spreadsheetId",
  "drive.get": "fileId",
};

const str = (v) => (typeof v === "string" ? v.trim() : "");
const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);

// A file id from a config value: a bare id or { id }.
export function idOf(v) {
  const s = isObj(v) ? str(v.id) : str(v);
  return ID_RE.test(s) ? s : "";
}

export function clientFiles(config) {
  const c = isObj(config) ? config : {};
  return {
    sheet: idOf(c.sheet),
    liveDoc: idOf(c.filming_plan_live_doc),
    testDoc: idOf(c.filming_plan_test_doc),
    folder: isObj(c.sheet) ? idOf(c.sheet.drive_folder) : "",
  };
}

// The company files every pass may read: the fp_settings value is a JSON list
// of ids (as an array or as text); anything unreadable means none.
export function companyReadFiles(value) {
  let v = value;
  if (typeof v === "string") { try { v = JSON.parse(v); } catch (_) { return []; } }
  return Array.isArray(v) ? v.map(idOf).filter(Boolean) : [];
}

export function allowedFiles(target, files, testSheet, companyRead = []) {
  const write = target === "client" ? [files.sheet, files.liveDoc] : [idOf(testSheet), files.testDoc];
  const read = [files.sheet, files.liveDoc, files.testDoc, files.folder, ...write, ...companyRead];
  return { read: new Set(read.filter(Boolean)), write: new Set(write.filter(Boolean)) };
}

const refuse = (error, status = 403) => ({ ok: false, status, error });

// The file check, before any tab rule. Answers { ok: true, fileId } or a refusal.
export function checkFile(action, body, allowed, target) {
  if (action === "whoami") return { ok: true, fileId: "" };
  if (action === "drive.copy" || action === "drive.folder") {
    return refuse("A pipeline pass cannot copy files or make folders in Drive. Use the Doc's version history instead of a copy.");
  }
  if (!READ_ACTIONS.has(action) && !WRITE_ACTIONS.has(action)) {
    return refuse(`The action ${JSON.stringify(action)} is not allowed with a pipeline pass.`);
  }
  const key = FILE_KEY[action];
  const id = str(isObj(body) ? body[key] : "");
  if (!ID_RE.test(id)) return refuse(`missing or bad ${key}`, 400);
  if (READ_ACTIONS.has(action)) {
    if (allowed.read.has(id)) return { ok: true, fileId: id };
    return refuse("This pass can only read its client's own files (the ideas Sheet, the filming plan Doc, the test Doc and the Drive folder named in the client's config).");
  }
  if (allowed.write.has(id)) return { ok: true, fileId: id };
  return refuse(target === "client"
    ? "This pass can only write to its client's ideas Sheet and live filming plan Doc."
    : "This test pass can only write to the TEST Sheet and its client's test Doc. Ask for a pass with target \"client\" to publish to the real files.");
}

const NOT_ALLOWED_TAB = "A pipeline pass writes only inside tabs created through a pass; add a new tab first.";
const RENAME = "Renaming a tab is never allowed with a pipeline pass.";
const DELETE = "Deleting a tab is never allowed with a pipeline pass.";

function onlyKey(req) {
  if (!isObj(req)) return "";
  const keys = Object.keys(req);
  return keys.length === 1 && isObj(req[keys[0]]) ? keys[0] : "";
}

function fieldList(fields) {
  return typeof fields === "string" ? fields.replace(/\s+/g, "").split(",").filter(Boolean) : [];
}

function checkRefs(n, type, refs, allowed) {
  if (!refs.length || refs.includes("")) {
    return refuse(`Request ${n} (${type}) does not say which tab it changes (Google would use the first tab), so it is refused. ${NOT_ALLOWED_TAB}`);
  }
  if (refs.some((r) => !allowed.has(r))) return refuse(`Request ${n} (${type}) touches a tab that was not created through a pipeline pass. ${NOT_ALLOWED_TAB}`);
  return null;
}

// ---- Sheets ---------------------------------------------------------------

// Grid ranges and coordinates that leave out sheetId mean sheet 0 (the first
// tab Google made), so they count as "0".
const SHEET_GRID_KEYS = new Set(["range", "ranges", "source", "destination", "gridRange", "coordinate", "start", "sourceRange"]);

export const SHEET_WRITES = new Set([
  "repeatCell", "updateCells", "updateDimensionProperties", "setDataValidation", "mergeCells", "unmergeCells",
  "updateBorders", "autoResizeDimensions", "insertDimension", "deleteDimension", "appendDimension", "moveDimension",
  "appendCells", "insertRange", "deleteRange", "sortRange", "setBasicFilter", "clearBasicFilter",
  "addConditionalFormatRule", "findReplace", "pasteData", "copyPaste", "cutPaste", "textToColumns",
  "trimWhitespace", "deleteDuplicates", "autoFill",
]);
const SHEET_PROP_FIELDS = new Set(["index", "gridProperties.frozenRowCount", "gridProperties.frozenColumnCount"]);

function sheetRefs(node, out) {
  if (Array.isArray(node)) { for (const v of node) sheetRefs(v, out); return; }
  if (!isObj(node)) return;
  if ("sheetId" in node) out.push(String(node.sheetId));
  for (const [k, v] of Object.entries(node)) {
    if (SHEET_GRID_KEYS.has(k)) for (const g of Array.isArray(v) ? v : [v]) if (isObj(g) && !("sheetId" in g)) out.push("0");
    sheetRefs(v, out);
  }
}

// Answers { ok: true, adds } or a refusal naming the first request refused.
export function checkSheetsBatch(requests, passTabs) {
  if (!Array.isArray(requests) || !requests.length) return refuse("requests must be a non-empty list", 400);
  const allowed = new Set(passTabs);
  let adds = 0;
  for (let i = 0; i < requests.length; i++) {
    const n = i + 1;
    const type = onlyKey(requests[i]);
    if (!type) return refuse(`Request ${n} must be one Google request object.`, 400);
    const r = requests[i][type];
    if (type === "addSheet") {
      const p = isObj(r.properties) ? r.properties : {};
      if (p.hidden === true) return refuse(`Request ${n} (addSheet): a pass may not add a hidden tab.`);
      // A tab added with its own sheetId may be written later in the same call.
      if (p.sheetId !== undefined && p.sheetId !== null) allowed.add(String(p.sheetId));
      adds++;
      continue;
    }
    if (type === "deleteSheet") return refuse(`Request ${n} (deleteSheet): ${DELETE}`);
    if (type === "duplicateSheet") return refuse(`Request ${n} (duplicateSheet): copying a tab is not allowed with a pipeline pass; add a new tab instead.`);
    if (type === "updateSheetProperties") {
      const p = isObj(r.properties) ? r.properties : {};
      const fields = fieldList(r.fields);
      if (fields.some((f) => /title/i.test(f))) return refuse(`Request ${n} (updateSheetProperties): ${RENAME}`);
      if (!fields.length || fields.some((f) => !SHEET_PROP_FIELDS.has(f))) {
        return refuse(`Request ${n} (updateSheetProperties): a pass may only move its own tab first or freeze its header rows.`);
      }
      if (fields.includes("index") && p.index !== 0) return refuse(`Request ${n} (updateSheetProperties): a pass may only move its own tab to the first place.`);
      const bad = checkRefs(n, type, [String(p.sheetId ?? 0)], allowed);
      if (bad) return bad;
      continue;
    }
    if (!SHEET_WRITES.has(type)) return refuse(`Request ${n} (${type}) is not allowed with a pipeline pass.`);
    if (type === "findReplace" && r.allSheets === true) return refuse(`Request ${n} (findReplace) covers every tab. ${NOT_ALLOWED_TAB}`);
    const refs = [];
    sheetRefs(r, refs);
    const bad = checkRefs(n, type, refs, allowed);
    if (bad) return bad;
  }
  return { ok: true, adds };
}

// The tab a values range names: 'My tab'!A1 or Tab!A1:B2. A range with no tab
// (A1:B2, or a named range) answers null: Google would pick the tab itself.
export function rangeSheetTitle(range) {
  const r = str(range);
  if (!r) return null;
  if (r.startsWith("'")) {
    let i = 1;
    let title = "";
    while (i < r.length) {
      if (r[i] === "'") {
        if (r[i + 1] === "'") { title += "'"; i += 2; continue; }
        break;
      }
      title += r[i++];
    }
    if (i >= r.length) return null;
    const rest = r.slice(i + 1);
    if (rest !== "" && !rest.startsWith("!")) return null;
    return title || null;
  }
  const bang = r.indexOf("!");
  return bang > 0 ? r.slice(0, bang) : null;
}

// values.update / values.append: the range's tab, found among the Sheet's
// tabs ([{ sheetId, title }]), must be one created through a pass.
export function checkValuesRange(range, tabs, passTabs) {
  const title = rangeSheetTitle(range);
  if (title === null) return refuse(`The range ${JSON.stringify(str(range))} does not name its tab, so it is refused. ${NOT_ALLOWED_TAB}`);
  const list = Array.isArray(tabs) ? tabs : [];
  let tab = list.find((t) => t.title === title);
  if (!tab) {
    const loose = list.filter((t) => String(t.title).toLowerCase() === title.toLowerCase());
    tab = loose.length === 1 ? loose[0] : undefined;
  }
  if (!tab) return refuse(`The Sheet has no tab called ${JSON.stringify(title)}.`, 404);
  if (!new Set(passTabs).has(String(tab.sheetId))) return refuse(`The tab ${JSON.stringify(title)} was not created through a pipeline pass. ${NOT_ALLOWED_TAB}`);
  return { ok: true, sheetId: String(tab.sheetId) };
}

// ---- Docs -----------------------------------------------------------------

// A location or range without tabId means the Doc's first tab, so it counts
// as "" (not attributable).
const DOC_LOC_KEYS = new Set(["location", "range", "endOfSegmentLocation", "tableStartLocation"]);

export const DOC_WRITES = new Set([
  "insertText", "deleteContentRange", "updateTextStyle", "updateParagraphStyle", "createParagraphBullets",
  "deleteParagraphBullets", "replaceAllText", "insertInlineImage", "insertTable", "insertTableRow",
  "insertTableColumn", "deleteTableRow", "deleteTableColumn", "updateTableCellStyle", "updateTableColumnProperties",
  "updateTableRowStyle", "mergeTableCells", "unmergeTableCells", "pinTableHeaderRows", "insertPageBreak",
  "insertSectionBreak", "updateDocumentStyle", "updateSectionStyle",
]);

function docRefs(node, out) {
  if (Array.isArray(node)) { for (const v of node) docRefs(v, out); return; }
  if (!isObj(node)) return;
  if ("tabId" in node) out.push(str(node.tabId));
  if (isObj(node.tabsCriteria)) {
    const ids = node.tabsCriteria.tabIds;
    if (Array.isArray(ids) && ids.length) for (const t of ids) out.push(str(t));
    else out.push("");
  }
  for (const [k, v] of Object.entries(node)) {
    if (k === "tabsCriteria") continue;
    if (DOC_LOC_KEYS.has(k) && isObj(v) && !("tabId" in v)) out.push("");
    docRefs(v, out);
  }
}

export function checkDocsBatch(requests, passTabs) {
  if (!Array.isArray(requests) || !requests.length) return refuse("requests must be a non-empty list", 400);
  const allowed = new Set(passTabs);
  let adds = 0;
  for (let i = 0; i < requests.length; i++) {
    const n = i + 1;
    const type = onlyKey(requests[i]);
    if (!type) return refuse(`Request ${n} must be one Google request object.`, 400);
    const r = requests[i][type];
    if (type === "addDocumentTab") {
      const p = isObj(r.tabProperties) ? r.tabProperties : {};
      const parent = str(p.parentTabId);
      if (parent && !allowed.has(parent)) return refuse(`Request ${n} (addDocumentTab): a pass may add a tab inside another tab only when that tab was created through a pass.`);
      adds++;
      continue;
    }
    if (type === "deleteTab") return refuse(`Request ${n} (deleteTab): ${DELETE}`);
    if (type === "updateDocumentTabProperties") {
      const p = isObj(r.tabProperties) ? r.tabProperties : {};
      const fields = fieldList(r.fields);
      if (fields.some((f) => /title|\*/i.test(f))) return refuse(`Request ${n} (updateDocumentTabProperties): ${RENAME}`);
      if (fields.length !== 1 || fields[0] !== "index" || p.index !== 0) {
        return refuse(`Request ${n} (updateDocumentTabProperties): a pass may only move its own tab to the first place.`);
      }
      const bad = checkRefs(n, type, [str(p.tabId)], allowed);
      if (bad) return bad;
      continue;
    }
    if (!DOC_WRITES.has(type)) return refuse(`Request ${n} (${type}) is not allowed with a pipeline pass.`);
    const refs = [];
    docRefs(r, refs);
    if (type === "replaceAllText" && !isObj(r.tabsCriteria)) refs.push("");
    const bad = checkRefs(n, type, refs, allowed);
    if (bad) return bad;
  }
  return { ok: true, adds };
}

// ---- After Google answers ---------------------------------------------------

// The ids of the tabs a successful batchUpdate created, from Google's replies.
export function createdTabIds(kind, result) {
  const replies = isObj(result) && Array.isArray(result.replies) ? result.replies : [];
  const out = [];
  for (const r of replies) {
    if (!isObj(r)) continue;
    if (kind === "sheets" && isObj(r.addSheet) && isObj(r.addSheet.properties) && r.addSheet.properties.sheetId !== undefined) {
      out.push(String(r.addSheet.properties.sheetId));
    }
    if (kind === "docs" && isObj(r.addDocumentTab) && isObj(r.addDocumentTab.tabProperties) && str(r.addDocumentTab.tabProperties.tabId)) {
      out.push(str(r.addDocumentTab.tabProperties.tabId));
    }
  }
  return out;
}
