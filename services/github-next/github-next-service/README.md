# GitHub Next service

Service for GitHub Next OAuth authorization and slot-based GitHub sync.

## Local OAuth setup

Create a GitHub OAuth App:

1. Open GitHub: `Settings` -> `Developer settings` -> `OAuth Apps` -> `New OAuth App`.
2. Use any clear app name, for example `Huly GitHub Next Local`.
3. Set `Homepage URL` to:

   ```text
   http://huly.local:8087
   ```

4. Set `Authorization callback URL` to:

   ```text
   http://huly.local:3510/api/v1/oauth/callback
   ```

5. Copy the generated `Client ID`.
6. Generate and copy a `Client secret`.

For local docker compose, put these values into the environment used by compose:

```bash
GITHUB_NEXT_CLIENT_ID=<github-oauth-client-id>
GITHUB_NEXT_CLIENT_SECRET=<github-oauth-client-secret>
```

Use the `Client ID` from this new GitHub Next OAuth App. Do not reuse the existing `GITHUB_CLIENTID`
unless that OAuth App has exactly this callback URL configured:

```text
http://huly.local:3510/api/v1/oauth/callback
```

`dev/docker-compose.yaml` maps `GITHUB_NEXT_CLIENT_ID` into the frontend as `GITHUB_NEXT_CLIENTID`
and into the service as `CLIENT_ID`. It maps `GITHUB_NEXT_CLIENT_SECRET` into the service as
`CLIENT_SECRET`. It also sets local `FRONT_URL` and `COLLABORATOR_URL` for markup conversion.

## Service env

The service reads env variables from `src/config.ts`.

Required:

```text
SERVER_SECRET
ACCOUNTS_URL
FRONT_URL
COLLABORATOR_URL
CLIENT_ID
CLIENT_SECRET
```

Optional:

```text
SERVICE_ID          default: github-next-service
PORT                default: 3510
PUBLIC_URL          default: http://huly.local:<PORT>
POLL_INTERVAL_MS    default: 300000
OUTBOUND_DEBOUNCE_MS default: 1000
SYNC_INBOUND        default: true
SYNC_OUTBOUND       default: true
HULYLAKE_URL        default: http://huly.local:8096
QUEUE_CONFIG        default from kafka package: huly.local:9092
QUEUE_REGION        default: empty
OTEL_EXPORTER_OTLP_ENDPOINT optional: OpenTelemetry collector URL
ENABLE_CONSOLE      default: true
LOG_LEVEL           default: info
VERSION             default: 0.7.0
```

Telemetry uses `SERVICE_ID` as the service name. The local Docker overlay exports traces to
`http://jaeger:4318/v1/traces`. Service logs are written to `logs/` and to the console when
`ENABLE_CONSOLE=true`.

Sync diagnostics include `GitHub Next sync phase started/finished` records for each inbound and
outbound provider. Finished records contain elapsed milliseconds, process CPU time, current RSS and
heap usage in bytes, heap change, success status and sync result counts. CPU and memory readings cover
the whole process, including any overlapping work; heap changes include garbage collection and do not
measure retained memory. Outbound transaction acceptance checks also log `validationDurationMs`.
Correlate these records with `outbound queue sync` reasons and `workspace client created` messages
when investigating idle load. The dev overlay sets `POLL_INTERVAL_MS=30000`, so inbound scans run every
30 seconds even when the repository has no changes.

## Workspace client reuse

Inbound sync, outbound sync and outbound transaction checks share a stateless REST client, loaded
model and markup operations per account service URL and workspace. Concurrent callers share the
initial load. The cache holds up to 10 workspaces, evicts the least recently used entry, and expires
each entry after five minutes even if it is continuously used. Expiry timers release idle entries
without requiring another request. Failed loads are not cached; operation failures invalidate the
context used by that operation without evicting a newer replacement.

Workspace upgrade, restore, deletion and archival notifications invalidate the cached context.
Model transactions, bulk updates and manual sync requests also invalidate it. Both queue consumers
remain active when only inbound sync is enabled so model changes can invalidate the cache. The
maximum age also refreshes endpoint credentials and provides a fallback for missed notifications.
Invalidation affects future operations; active operations keep their current REST context.
These REST contexts do not own persistent connections requiring a close operation. Shutdown clears
cached references and timers.

Integration settings, slot bindings, routes and sync states are read afresh rather than cached.
For update/delete transactions without an existing sync state, outbound checks return before loading
provider configuration, since outbound creation routes apply only to create transactions.

For local docker, `PUBLIC_URL` must match the GitHub OAuth callback host:

```text
http://huly.local:3510
```

## Repository sync availability

Issue sync checks the repository's `has_issues` flag before importing issues, creating or updating
issues, or syncing their comments. Repositories with issues disabled are skipped, including existing
issue sync states. Discussion sync checks `has_discussions` before importing, creating or updating
discussions, including existing discussion sync states. The two flags are checked independently;
pull request sync does not depend on either flag.

The full response from `GET /repos/{owner}/{repo}` is cached as `Promise<GithubRepositoryResponse>` in
`GithubRequestContext.repositoryCache`, using `owner/name` as the key, like milestones. Repository
lookups and issue availability checks within the same context share one metadata request. Each new
sync pass creates a new context and refreshes the metadata. Metadata request failures stop that sync attempt.

## Frontend config

The frontend needs `GITHUB_NEXT_CLIENTID` and `GITHUB_NEXT_URL` so it can open OAuth and call this service:

```text
GITHUB_NEXT_CLIENTID=<github-oauth-client-id>
GITHUB_NEXT_URL=http://huly.local:3510
```

Local docker compose already sets it for the `front` service.





Необходимо перезапускать воркер иначе он не знает об интеграции.
