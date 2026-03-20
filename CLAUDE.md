# Project Notes

## N8N Workflow Access
- Always check the N8N workflow directly using the MCP tools (search_workflows, get_workflow_details) — do NOT rely only on the JSON file in the repo.
- The main workflow is called "MARKET RESEARCH" (ID: FD2QUIOlobkdLOgs).

## Google Sheets
- Client config sheet: https://docs.google.com/spreadsheets/d/10QQnWOQY73Aj44R8AumYJzFpxMd_bZZiCMXkZ6QqAU8/edit?usp=sharing
- The sheet tab is called "Clients Info" (not "Clients").

## Workflow Versions (inside MARKET RESEARCH)
- **Current/active version**: Uses Webhook4 → Claude API1 → Convert to JSON1
- **Old version (reference, had great results)**: Uses Webhook5 → Claude API5 → Convert to JSON3
