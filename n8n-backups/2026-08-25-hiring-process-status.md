# Hiring Process n8n status - public-safe recovery record (2026-08-25)

No raw workflow JSON, credential IDs, webhook secrets, applicant data, or alert-recipient data is
committed here.

## Capture and current state

Two existing active workflows were changed for the Hiring Process operation:

| Workflow | ID | Pre-edit active version | Current active version |
|---|---|---|---|
| Hiring - Application Capture (iClosed) | `oi4BPg79dykdet6H` | `52274b74-e7d0-4b6f-83fb-6ff36c86e12e` | `759a33ed-7156-4a86-89ed-bac45497ba55` |
| Sales - Call Booked (iClosed) | `xoPqojySDriQ8Mzh` | `d9d981ec-f133-429d-972a-729189612a99` | `a82e2ce1-d062-4997-a812-7621b5c1b635` |

- Application Capture's Slack and Telegram messages now use the real protected SyncView Hiring
  Process deep link. Its dedicated iClosed application gate and all capture/deduplication behavior
  are otherwise unchanged.
- Sales - Call Booked has one new first branch for the exact dedicated interview event. A passing
  booking records only the private hiring status; a nonmatching booking follows the pre-existing
  sales decision unchanged.
- The invitation dispatcher remains inactive and `hiring_invites_enabled` remains false. This is the
  one-step candidate-email kill; neither workflow above can independently release candidate email.

## Snapshot disclosure

No independent private Drive JSON export was available to this task before the edits. n8n's version
history is the durable pre-edit recovery source; the two pre-edit version IDs above were read back
before publication. This public-safe status stub records the gap rather than claiming to replace a
private raw export.

## Recovery

1. Read back the affected workflow's current graph and active version in n8n.
2. If the hiring alert-link repair must be reverted, restore/publish Application Capture version
   `52274b74-e7d0-4b6f-83fb-6ff36c86e12e`.
3. If the dedicated booking-status branch must be contained, restore/publish Sales - Call Booked
   version `d9d981ec-f133-429d-972a-729189612a99`. That stops only the hiring mirror and preserves
   the pre-existing sales receiver behavior.
4. Leave `hiring_invites_enabled` false unless an owner deliberately runs a bounded internal invite
   test. Do not activate the invitation dispatcher as a recovery action.

After any restore, verify the active version and run a bounded non-candidate check before relying on
the restored path.
