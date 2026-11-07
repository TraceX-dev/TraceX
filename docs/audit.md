# Audit events

Application audit records are delivered through Redpanda into the account PostgreSQL database.
Use `MeasureContext` for delivery diagnostics; see [Observability](./observability.md) for the
application instrumentation contract.

## Recording events

Use `recordAuditEvent` from `@hcengineering/server-core` after an applied domain change.
Await publication; delivery failures are diagnosed without changing the business result.
Supply safe event names and attributes explicitly, never request bodies, credentials or raw errors.

```ts
import { recordAuditEvent } from '@hcengineering/server-core'

await repository.publish(documentId)
await recordAuditEvent(ctx, {
  event: 'document.publish',
  actorAccountUuid: account,
  workspaceUuid: workspace,
  documentId
})
```

`withAuditEvent(ctx, event, action)` records a settled action's outcome while preserving its
result or error. The default outcome is `succeeded`; alternatives are `denied` and `failed`.
A failed publication does not produce an additional failed business event.

Account and workspace services configure `startAuditPublisher` once at startup using their
service context and real `PlatformQueue`. The publisher uses the global `Audit` topic;
`account-service` consumes it into the account PostgreSQL schema's `audit_events` table.
Other services must explicitly configure a publisher before calling the helper. A dummy or
missing queue is unavailable audit delivery, not a successful persistence fallback.

Delivery settings are selected by these audit entry points using the shared queue options:
`getProducer(ctx, topic, QueueProducerOptions)` and
`createConsumer(ctx, topic, group, handler, QueueConsumerOptions)`. The Kafka adapter does not
choose a policy by event domain. Producer options cover idempotence, acknowledgements,
request timeout, in-flight requests and retries; consumer options cover auto-creation and
partition concurrency. Existing callers can omit options. A cached producer rejects conflicting
options for the same topic rather than silently ignoring them. JSON/metadata decoding,
connection recovery and payload-free retry diagnostics are common to all consumers/producers.


## Guarantees and schema

The first version uses **business commit → Redpanda → PostgreSQL**, without a SQL outbox.
A crash or exhausted send retries before broker acceptance can lose an event. Audit failures
never roll back business changes. The publisher waits at most 10 seconds; a timed-out send
may still reach the broker. Client retries are bounded and reuse the record's `eventId`.
This is not an exactly-once producer guarantee.

Every record carries `schemaVersion: 1`, `eventId`, `occurredAt`, `sourceService`, `event` and
`outcome`. Optional actor, target, workspace and operation identities are independent of live
database rows. The `AuditEvent` type limits additional attributes to scalar values or string arrays.
Event producers explicitly select safe fields. New domain events can reuse this typed envelope
without transport changes.
Bulk permission events contain every recipient in chunks of at most 100, linked by
`operationId`, `chunkIndex` and `chunkCount`.

The journal adds `recorded_at` at insertion, stores additional attributes in JSONB and has no
foreign keys to accounts or workspaces. It has no automatic retention or user erase API.
Only append is exposed by `AuditEventStore`. This is not administrator-proof immutable storage:
DB owners retain their normal privileges. In deployments with separate migration and runtime
roles, grant the audit runtime role INSERT (and SELECT if needed), never UPDATE, DELETE or
TRUNCATE; retain table ownership with the migration role. Include this schema in account DB
backups and periodically verify recovery into an isolated database.

## Topic provisioning

The topic is global across service regions and includes the usual `QUEUE_CONFIG` postfix:
`audit<postfix>`. The transactor's existing `createTopics()` bootstrap creates it with three
partitions if missing, alongside the other application topics. Replication and retention
inherit broker defaults; an existing topic is left unchanged. Audit producers/consumers do
not request broker auto-creation. For controlled production settings, provision the topic
before starting services. For example, a three-broker production cluster can use:

```sh
rpk topic create 'audit<postfix>' --partitions 3 --replicas 3 \
  -c cleanup.policy=delete -c retention.ms=604800000 -c retention.bytes=-1
```

Replace `<postfix>` with the actual suffix (or omit it). Seven days here is a queue recovery
window, not the journal's retention. Size it for the maximum expected outage, throughput and
available disk. A single-broker development cluster requires `--replicas 1` and does not offer
replica fault tolerance. Use `acks=all` (the audit producer sets it explicitly), configure the
broker's minimum in-sync replicas and disk-flush/write-caching policy for the deployment's
required durability, and disable compaction. Topic storage is finite: monitor retention headroom,
disk space and consumer lag so unprocessed events do not expire during an outage.

Both producing services need `QUEUE_CONFIG`; keep their postfix consistent. Workspace regions
may differ: the audit adapter deliberately omits region prefixes. `account-service-audit-v1`
is the shared consumer group suffix across account replicas. A new group reads retained
messages from the beginning. The account DB migration must complete before consumption starts.
No session management, user history UI, object archive or MongoDB audit backend is introduced.

## Failures and recovery

- Producer failure: `Audit delivery failed` includes event name/id and error type without
  credentials or the event payload. There is no durable producer retry after process restart.
- DB failure: the consumer retries with backoff and heartbeats without completing the message.
  Restore PostgreSQL availability; the same event is then inserted. Offsets advance only after
  a successful handler. A repeated delivery after commit is ignored by the `event_id` primary key.
- Message decoding or storage error: the affected partition is blocked and
  retried. The shared queue diagnostic `Queue message processing failed; message will be retried`
  identifies topic/partition/offset without logging the payload. Do not reset
  its offset to skip evidence. Fix the producer or recover the offending record through
  a reviewed operator procedure, then restart the consumer. Other partitions can continue.
- Graceful shutdown: stop accepting work, drain publications and close consumers before the DB.
  Workspace startup cancels its handshake HTTP request and retry backoff on shutdown. In-flight
  workspace work has a 30-second drain deadline; after that the service logs a warning and closes
  the audit publisher and queue. Work interrupted by this deadline or forced termination still
  has the pre-broker loss window described above.

To validate the actual transport, the opt-in `server/account` integration test creates an
isolated random PostgreSQL schema and Redpanda topic, exercises replay, temporary table
unavailability, restart and duplicate delivery, and removes its resources:

```sh
AUDIT_POSTGRES_URL=postgresql://postgres:postgres@localhost:5432/postgres \
AUDIT_BROKERS=localhost:19092 \
  ./node_modules/.bin/jest src/__tests__/audit-integration.test.ts --runInBand --coverage=false
```
