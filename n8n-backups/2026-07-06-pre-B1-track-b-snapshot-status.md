# Track B B1 pre-snapshot status - 2026-07-06

Public-safe status only. Raw workflow JSON, Supabase rows, and secrets are not committed to this
public repo.

## Git

- Tag: `pre-B1-track-b-2026-07-06`
- Target commit: `f7d77561c823335964e6d78dd854b0086957884d`

## n8n

- B1 does not edit any n8n workflow.
- The weekly backup workflow was hardened on 2026-07-06 so its workflow export covers all 120
  live workflows, including `MJbMZ789B5ExZz9x`.
- No raw n8n workflow JSON is committed here.

## Supabase

Private JSON snapshots were written outside the public repo under:

`C:\Users\Sidney\Documents\Codex\private-backups\2026-07-06-pre-B1-track-b\supabase`

| File | Rows | SHA-256 |
|---|---:|---|
| `calendar_posts.pre-B1.json` | 3438 | `31dc39266edc239942724c9f07837f124f97ceee58628715d6e65419284f7c6d` |
| `sample_reviews.pre-B1.json` | 2654 | `84d8832ea9195b0ef8c44c64ce6194ecb817fbd76b6b2e37add632f64db62b82` |
| `clients.pre-B1.json` | 33 | `9b1ba734bf000025bfca269f58b34297a70262438517c09f9dd281f9068788a6` |
| `team_members.pre-B1.json` | 14 | `b4431955a5727559dd55e1fb36ebf961c2fed8b781144af20f98266e459025af` |
| `client_access.pre-B1.json` | 32 | `d651e3b17daf27d0f7bfd00dcc9aa8792470e4018ab3bc9679f35eab35910808` |
| `client_access_events.pre-B1.json` | 3 | `0e8acaf658378f3753c156c7bbf26700841f8792613f4408815cacb15459899b` |
| `syncview_auth_events.pre-B1.json` | 2 | `a223dc6a57eaff83de0931b581bccd0907377a9173e0a1c71888280c4113a2ee` |
| `flag_flips.pre-B1.json` | 5 | `a8c7853676565c47dc69450c1ee09af2e7abef4ff0f4a85842f7d37caaf89e61` |
| `syncview_runtime_flags.pre-B1.json` | 6 | `a40ff701019e26842e1a642542197f153ae4a23e5fd2617773fc2783dcf20dc7` |

## Linear

The B1 Linear pull is read-only and must run from an environment variable key. At snapshot time,
no supported Linear key environment variable was visible in this process, so the dry-run evidence
is blocked until `LINEAR_API_KEY` or an equivalent supported env var is available.
