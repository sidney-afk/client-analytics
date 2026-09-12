# Followup supervisor preparation

The portable Node supervisor is disabled by default. Importing it or launching
without both `--run` and `LINEAR_EXIT_SUPERVISOR_ENABLED=true` dispatches nothing.
No schedule, deployment or provider execution is installed by this preparation.

An authorized operator must configure `LINEAR_EXIT_SUPERVISOR_PROJECT_REF` and
the private `LINEAR_EXIT_FOLLOWUP_RUNNER_KEY` through the hosting secret store.
The only destination is that project's HTTPS `/functions/v1/card-followup-worker`.
Concurrency defaults to two, configurable from one through four with
`LINEAR_EXIT_SUPERVISOR_CONCURRENCY`. Request deadlines default to 75 seconds;
the programmatic adapter accepts deadlines up to 120 seconds. Idle polling is
15 seconds and failures back off 30 seconds. Health polls occur at most once
per 15 seconds. SIGINT/SIGTERM stop new work and abort outstanding HTTP requests.

Every invocation asks the endpoint to claim pending work. The supervisor never
resubmits a task or lease token. Failed, unknown and ambiguous requests remain
attention-required; an authorized operator must inspect the durable ledger and
perform its explicit recovery procedure. An aborted request may have committed
or claimed work and requires the same ledger check. Authentication refusal stops
dispatch. Logs contain fixed status/count fields, never response bodies or keys.

Configure a separate independent observer before operational use. It must detect
missing heartbeats, process loss and unhealthy backlog even when this process or
host disappears. The callback and stdout here are telemetry interfaces, not proof
of a working deadman, off-device hosting, durable delivery or production drain.
Worker enablement, service configuration and operational acceptance remain
separate owner-authorized gates.
