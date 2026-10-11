# Process performance in Uptrace

The service uses the existing OpenTelemetry exporter. Set
`OTEL_EXPORTER_OTLP_ENDPOINT` to the collector's HTTP base URL (without `/v1/traces`)
and `OTEL_EXPORTER_OTLP_HEADERS` to its required headers, including `uptrace-dsn`
when required by your collector. Do not commit credentials.
Pass these variables into the process-service container in your deployment.
The current development Compose service does not supply them automatically.
An Uptrace deployment must supply its own endpoint.
`OTEL_LOGGER_ENABLED=false` disables duplicate OTLP log export, not traces.

After rebuilding and recreating process-service, find service `process-service`
and span `process.event` in your tracing UI. Inspect the duration distribution
and open a slow trace. The consumer's `handle-msg` span is its parent, preserving
the queue trace metadata.

| Span or field | Meaning |
| --- | --- |
| `event_age_ms` | Event creation to handler entry, before obtaining the client. Includes producer delay, backlog and, for scheduled events, intentional waiting; not broker latency or consumer lag. Clock skew can produce negative values. |
| `process.get-client` | Total client acquisition, including waiting on concurrent initialization. |
| `process.account-login` | Account service lookup on a cache miss. |
| `process.load-client-model` | WebSocket connection and initial full model download/reconstruction. Only cache misses initialize a client. |
| `process.find-transition` | Trigger selection and parameter evaluation. |
| `process.transition-chain` | Execution of the automatic transition chain, including nested parent work. |
| `process.action` | One action; `method` and `transition` identify it. Returned action errors increment `process_action_errors`. |
| `process.apply-transition` | Conditional transaction submission. |
| `process.client.*` | Logical client reads, writes, domain requests and searches over WebSocket, nested under the active stage. No query bodies, document contents or tokens are attached. |
| `process.wait-card` | Explicit retry delay while waiting for a newly created card. |
| `process.check-parent`, `process.check-next` | Parent processing and automatic transition selection. |
| `process.update-timers`, `process.set-timers` | Timer maintenance, including queue sends. |
| `client_calls`, `client_ms`, `client_errors` | Per-event logical client call count, summed duration and thrown errors, excluding client initialization. Internal reconnect retries are part of the same logical call. Parallel calls overlap, so the sum can exceed event duration. |
| `outcome` | `handled`, `duplicate`, `ignored`, or an error caught by the outer handler. `handled` does not imply that a transition occurred or that every action succeeded; inspect child spans/errors. |

Workspace, card, execution and message IDs are trace attributes, not metric
labels. Cache hits/misses and event/action errors are exported as counters.
Duration percentiles come from spans; no new histogram API is introduced.
Existing exporter sampling settings apply, so sampled traces are not an exact
event count. No additional per-operation console logs are emitted. Routine
event, duplicate and no-transition logs require `LOG_LEVEL=debug`.

Interpretation: high event age with a short handler points to delays before the
handler; a long get-client span points to initialization; many client calls point
to repeated reads/writes; a few long client spans point to downstream latency;
wait-card spans expose deliberate sleeps. Actual Kafka lag and rebalances must
be checked in broker/consumer monitoring; this instrumentation does not measure
them and does not establish that high event age is caused by Kafka.

## WebSocket client cache

Clients retain the full model, including server method and trigger implementations.
The platform client applies model transactions received over WebSocket and uses
its existing hash-based synchronization on reconnect. Unchanged models are not
periodically downloaded. A changed hash may require a full snapshot; this change
adds no new server-side diff protocol or persistent model cache.

| Environment variable | Default | Meaning |
| --- | --- | --- |
| `PROCESS_CLIENT_IDLE_TIMEOUT_MS` | `600000` | Close a client after ten minutes without any active users. Reuse cancels its idle timer. |
| `PROCESS_CLIENT_CACHE_MAX_SIZE` | `32` | Retain at most this many clients when idle entries are available for eviction. Busy entries can temporarily exceed the limit and are trimmed on release. |
| `PROCESS_CLIENT_CONNECTION_TIMEOUT_MS` | `30000` | Timeout for initial WebSocket connection establishment. |

All values must be positive integers. Idle entries are evicted in least-recently-used
order. Consumer shutdown closes the cached clients after message processing stops.
Model-upgrade notifications invalidate a connection; it is closed after its users
release it and the next event creates a fresh client. Concurrent new acquisitions
of an invalidated busy entry fail rather than use the invalidated connection.
Existing active events are not cancelled by cache eviction.

`process_cached_clients` reports cache entries (including initialization), not heap
bytes or physically open sockets. `process_clients_opened`, `process_clients_closed`,
`process_client_reconnects` and `process_client_model_upgrades` report connection
lifecycle activity. Connection telemetry uses the service context so the cache does
not retain the event context that originally opened it.

The former `process.rest.*` spans and `rest_*` attributes are now named
`process.client.*` and `client_*`. Update saved queries accordingly.

Before deployment, run dependency installation and rebuild the process-service image.
Manually verify a transition using server method/trigger implementations, edit a
process schema while its workspace client is cached, restart the transactor and
verify recovery, then verify that idle/evicted clients close and memory stabilizes.
The model is live and can change during an event; edits are not isolated to an
immutable per-event model snapshot. Validate this behavior when editing running
process definitions. Cold initialization still downloads the full model.
