// BACKUP — n8n workflow "VIDEO PRODUCTION AUTOMATION" (id: BrJSe8zCKUccfmIq)
// Node: "Code in JavaScript7"  (handler for webhook path /webhook/linear-issues — powers the Workload view)
// Captured: 2026-06-17, BEFORE adding the server-side Linear state filter.
// This node contains NO hardcoded secret (Linear API keys are read from the SMM Google Sheet at runtime).
// _backup_note: exact live jsCode at capture time.
//
// CHANGE APPLIED (2026-06-17): added `filter: { state: { type: { nin: ["completed","canceled"] } } }`
//   to the LINEAR_QUERY `issues(...)` call. Nothing else changed.
//   Pre-change live version : 6fe6ff13-eae2-4b3c-86f6-9f5807e914f7   <-- ROLLBACK target
//   Post-change live version: 89d575e6-01d8-4102-9e52-a9fc86f38efe
//   To roll back: n8n MCP publish_workflow with versionId 6fe6ff13-eae2-4b3c-86f6-9f5807e914f7
//                 (or n8n UI version history → republish that version).

const SMM_CSV_URL = 'https://docs.google.com/spreadsheets/d/10QQnWOQY73Aj44R8AumYJzFpxMd_bZZiCMXkZ6QqAU8/gviz/tq?tqx=out:csv&sheet=Social%20Media%20Managers';

const LINEAR_QUERY = `query($after: String) {
  issues(first: 250, after: $after, orderBy: updatedAt) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id identifier title url dueDate createdAt updatedAt
      state { name type }
      team { id key name }
      assignee { id name email }
      project { id name }
      parent { id identifier title project { name } }
    }
  }
}`;

const MAX_PAGES_PER_WORKSPACE = 10; // safety cap: 10 * 250 = 2500 issues max per workspace

function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/);
  const rows = lines.map(line => {
    const out = []; let cur = ''; let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
        else inQ = !inQ;
      } else if (c === ',' && !inQ) { out.push(cur); cur = ''; }
      else cur += c;
    }
    out.push(cur);
    return out;
  });
  const headers = rows.shift().map(h => h.trim().toLowerCase());
  return rows.map(r => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = (r[i] || '').trim(); });
    return obj;
  });
}

async function fetchOneWorkspace(apiKey) {
  const allNodes = [];
  let after = null;
  let pageCount = 0;

  try {
    while (pageCount < MAX_PAGES_PER_WORKSPACE) {
      const resp = await this.helpers.httpRequest({
        method: 'POST',
        url: 'https://api.linear.app/graphql',
        headers: {
          'Authorization': apiKey,
          'Content-Type': 'application/json',
        },
        body: { query: LINEAR_QUERY, variables: { after } },
        json: true,
        returnFullResponse: false,
      });

      if (resp && resp.errors) {
        return { nodes: allNodes, error: 'graphql: ' + JSON.stringify(resp.errors).slice(0, 300) };
      }
      if (!resp || !resp.data || !resp.data.issues) {
        return { nodes: allNodes, error: 'unexpected_response: ' + JSON.stringify(resp).slice(0, 300) };
      }

      const page = resp.data.issues;
      if (Array.isArray(page.nodes)) allNodes.push(...page.nodes);
      pageCount++;

      if (!page.pageInfo || !page.pageInfo.hasNextPage) break;
      after = page.pageInfo.endCursor;
    }

    return { nodes: allNodes, error: null, pagesFetched: pageCount };
  } catch (e) {
    return { nodes: allNodes, error: 'http: ' + (e.message || String(e)).slice(0, 300) };
  }
}

function normalize(node) {
  const isSub = node.parent != null;
  const clientName = (node.project && node.project.name)
    || (node.parent && node.parent.project && node.parent.project.name)
    || null;
  return {
    id: node.id,
    identifier: node.identifier,
    title: node.title,
    url: node.url,
    isSubIssue: isSub,
    parentId: node.parent ? node.parent.id : null,
    parentIdentifier: node.parent ? node.parent.identifier : null,
    dueDate: node.dueDate || null,
    createdAt: node.createdAt,
    updatedAt: node.updatedAt,
    status: node.state ? node.state.name : null,
    statusType: node.state ? node.state.type : null,
    teamKey: node.team ? node.team.key : null,
    teamName: node.team ? node.team.name : null,
    assigneeId: node.assignee ? node.assignee.id : null,
    assigneeName: node.assignee ? node.assignee.name : null,
    assigneeEmail: node.assignee ? node.assignee.email : null,
    clientName: clientName,
  };
}

let csvText = '';
try {
  csvText = await this.helpers.httpRequest({
    method: 'GET',
    url: SMM_CSV_URL,
    json: false,
  });
} catch (e) {
  return [{ json: { issues: [], fetchedAt: new Date().toISOString(), error: 'smm_csv_fetch_failed: ' + (e.message || String(e)) } }];
}

const smmRows = parseCsv(csvText);
const apiKeys = Array.from(new Set(
  smmRows.map(r => r.linear_api_key).filter(k => k && k.startsWith('lin_api_'))
));

if (apiKeys.length === 0) {
  return [{ json: { issues: [], fetchedAt: new Date().toISOString(), error: 'no_api_keys_found', smmRowCount: smmRows.length } }];
}

const results = await Promise.all(apiKeys.map(k => fetchOneWorkspace.call(this, k)));

const seen = new Set();
const issues = [];
const workspaceErrors = [];
let totalRaw = 0;

results.forEach((r, idx) => {
  if (r.error) workspaceErrors.push({ keyIndex: idx, keyPrefix: apiKeys[idx].slice(0, 14), error: r.error, pagesFetched: r.pagesFetched });
  totalRaw += r.nodes.length;
  for (const n of r.nodes) {
    if (!n || !n.id || seen.has(n.id)) continue;
    seen.add(n.id);
    const norm = normalize(n);
    if (norm.statusType === 'completed' || norm.statusType === 'canceled') continue;
    issues.push(norm);
  }
});

return [{
  json: {
    issues,
    fetchedAt: new Date().toISOString(),
    workspaceCount: apiKeys.length,
    totalRaw,
    workspaceErrors,
    pagesPerWorkspace: results.map(r => r.pagesFetched),
  }
}];
