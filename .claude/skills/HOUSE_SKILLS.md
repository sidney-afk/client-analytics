# House copies of four outside skills

Sidney asked (2026-11-02) that every build session use the Karpathy guidelines and a front-end design skill. They
are installed as plugins on his claude.ai account, but plugins do not reach the cloud sessions the supervisor
starts, so these copies live here, where every session that checks out this repo loads them.

| Folder | From | Licence |
|---|---|---|
| `karpathy-guidelines/` | Agent Protocols plugin (Arneesh Aima) | MIT, `LICENSE` in the folder |
| `test-driven-development/` | Agent Protocols plugin | MIT |
| `frontend-ui-engineering/` | Agent Protocols plugin | MIT |
| `frontend-design/` | Anthropic's frontend-design plugin | Apache 2.0, `LICENSE.txt` in the folder |

Copied as published, unchanged. Two of them point at `references/` files and Chrome DevTools MCP that are not
included here; skip those parts.

**How they apply in SyncView.** SyncView is an existing app with its own look. `frontend-design` is written for
new, distinctive designs; inside SyncView, use its discipline (one deliberate choice, restraint, real copy, every
state designed, keyboard focus, reduced motion, mobile) and keep SyncView's existing tokens, type and components.
Do not restyle the app. The house UI rules still apply: no coloured left-edge highlights; skeletons match the real
layout; hovers light only what is under the mouse; every opened page has a Back button; check 1440 and 390 wide.
