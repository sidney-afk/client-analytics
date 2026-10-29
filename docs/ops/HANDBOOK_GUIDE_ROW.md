# SyncMate guide row: handbook

The team handbook lives in the Synchro Brain as `company/handbook-*.md`.
SyncMate reads it with `client_brain` (option `handbook`) and corrects it with
`brain_change` (option `handbook_page`). Guides are rows in `hf_guides`, not
code, so this row is added with SQL after the function change is deployed and
checked (the newest row per topic is live). Rollback: add a newer row.

```sql
insert into public.hf_guides (topic, body, written_by) values ('handbook', $body$
The team handbook is the company's own how-to: who does what, how a client goes from signing to a posted video, what each tab of the app is for, who films where, how the week runs.

When to look in it: someone asks how to do something at the company, who does what or who to ask, who films for a client or where, how the week or time off works, or what a part of the app is for. Look before answering from memory, and do it without being asked.

How: call client_brain with topic "handbook" (any client value works). That is the index. Then call it again with topic "handbook:<page>" for the page that fits (team, work, app, videographers, assistant, tools, rhythm). A chat that has refreshed its tool list can use the handbook option instead, and no client name is needed. Answer from what the page says, in plain words, and say which page it came from. If the page does not say, say so; never guess.

When a step needs Sidney (a decision, an approval, money, or something the page says only he does), say so plainly and do not promise it will happen. Tell the person it is Sidney's to decide and offer what you can do meanwhile.

If a handbook fact is wrong or has changed: ask what is right, then call brain_change with fact_id "handbook:<page>" (or handbook_page, after a refresh). Anyone can change the videographers page; confirm "Saved to the videographers page: <what>". A change to any other page is only a suggestion until Sidney says yes: say "Sent to Sidney as a suggestion", never "Saved".

The handbook is about the company. For one client, use that client's brain as before.
$body$, 'Connector');
```
