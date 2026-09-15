# Native intake completion

`native-intake-completion.yml` and `native-intake-completion-monitor.yml` are
prepared source only. They stay **dormant** until the protected repository
variable `NATIVE_INTAKE_COMPLETION_ENABLED` is exactly `true`. Enabling it is a
separate production decision after the installed native-intake reconciliation
SQL, card-materialization boundary, grants, and disposable PostgreSQL journey
have been verified.

The mutator calls only the canonical reconciliation RPCs with the service role.
It can recover missing native children and bind a card slot that the SQL proves
was empty since creation. It never creates a missing card: `card_creation_held`
remains visible operator debt because the frozen tokenless writers do not carry
a server-owned creation identity that distinguishes an old browser replay from
a later human edit.

The independent monitor calls only `production_intake_reconcile_summary()` and
fails closed on an unreadable summary, terminal-receipt debt, identity conflict,
or configured age/count threshold. Both workflows write separate watchdog
heartbeats. The dead-man switch pages a failed or silent lane, but GitHub
schedules are best effort; the documented multi-hour delivery gaps mean these
workflows provide no prompt recovery SLO. A reliable external scheduler and
observer are required before claiming one.

Do not upload a private report from either workflow. Public logs contain only
bounded aggregate counts and reason codes. No n8n workflow, runtime flag,
client-facing writer, card creator, or provider transport is changed here.
