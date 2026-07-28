# F44 durable-received intake fallback — public-safe n8n snapshot stub

Workflow: `VIDEO PRODUCTION AUTOMATION` (`BrJSe8zCKUccfmIq`)

## Capture and current state

- Before the 2026-07-27 generalized fallback update, a fresh private JSON
  snapshot of active version `af7671ab-deca-4470-a08b-ce591f59e08b` was captured
  outside this public repository.
- The current active version is `28dacc7f-4dd7-4d65-ba88-31db737c2c65`.
- The update makes a valid, durably captured intake a strict HTTP 202
  `received` handoff when server-owned Linear prerequisites prevent creation.
  `created` remains reserved for exact confirmed Linear work.
- Protected filming-plan reads remain staff-gated. Missing plans, SMM
  credentials, project/team mappings, roster/assignee resolution, Linear/API
  confirmation, and post-receipt authority failures are staff triage, not a
  client refusal. The triage notification targets an unconditional human
  fallback rather than a per-client SMM recipient.

## Recovery record

- The direct emergency rollback is n8n version history restore/publish of
  `af7671ab-deca-4470-a08b-ce591f59e08b`, followed by active-version and graph
  readback. It reintroduces internal-prerequisite client refusal and is not a
  normal recovery path.
- `66e41fca-a86f-4ef3-a977-8ba960bc152d` must not be restored because it
  exposed a protected filming-plan URL. `9e5abc46-91f0-49f8-b815-fcc6baa93891`
  is pruned and unavailable.
- The earlier F44 live edit had no private pre-edit JSON export. n8n version
  history is the only historical recovery record for that edit; this stub does
  not claim to repair the omission.

No raw workflow JSON, credential, client payload, or alert recipient appears in
this public artifact.
