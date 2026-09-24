# Process performance in Uptrace

The service uses the existing OpenTelemetry exporter. Set
`OTEL_EXPORTER_OTLP_ENDPOINT` to the collector's HTTP base URL (without `/v1/traces`)
and `OTEL_EXPORTER_OTLP_HEADERS` to its required headers, including `uptrace-dsn`
when required by your collector. Do not commit credentials.
The development Compose service forwards these variables and defaults to the
existing Jaeger collector. An Uptrace deployment must supply its own endpoint.
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
| `process.load-client-model` | REST client initialization: account fetch, full model download and reconstruction. |
| `process.find-transition` | Trigger selection and parameter evaluation. |
| `process.transition-chain` | Execution of the automatic transition chain, including nested parent work. |
| `process.action` | One action; `method` and `transition` identify it. Returned action errors increment `process_action_errors`. |
| `process.apply-transition` | Conditional transaction submission. |
| `process.rest.*` | Logical REST reads, writes, domain requests and searches, nested under the active stage. No query bodies, document contents or tokens are attached. |
| `process.wait-card` | Explicit retry delay while waiting for a newly created card. |
| `process.check-parent`, `process.check-next` | Parent processing and automatic transition selection. |
| `process.update-timers`, `process.set-timers` | Timer maintenance, including queue sends. |
| `rest_calls`, `rest_ms`, `rest_errors` | Per-event logical REST call count, summed duration and thrown errors, excluding client initialization. Internal HTTP retries are part of the same logical call. Parallel calls overlap, so the sum can exceed event duration. |
| `outcome` | `handled`, `duplicate`, `ignored`, or an error caught by the outer handler. `handled` does not imply that a transition occurred or that every action succeeded; inspect child spans/errors. |

Workspace, card, execution and message IDs are trace attributes, not metric
labels. Cache hits/misses and event/action errors are exported as counters.
Duration percentiles come from spans; no new histogram API is introduced.
Existing exporter sampling settings apply, so sampled traces are not an exact
event count. No additional per-operation console logs are emitted. Routine
event, duplicate and no-transition logs require `LOG_LEVEL=debug`.

Interpretation: high event age with a short handler points to delays before the
handler; a long get-client span points to initialization; many REST calls point
to repeated reads/writes; a few long REST spans point to downstream latency;
wait-card spans expose deliberate sleeps. Actual Kafka lag and rebalances must
be checked in broker/consumer monitoring; this instrumentation does not measure
them and does not establish that high event age is caused by Kafka.
