# TraceX MCP Service

This pod exposes TraceX card tools as a Streamable HTTP MCP server.

## Local Docker Compose

Build the image before starting the compose service:

```bash
rush build --to @hcengineering/pod-mcp
rush bundle --to @hcengineering/pod-mcp
rush docker:build --to @hcengineering/pod-mcp
```

Start it from the repository root:

```bash
docker compose -f dev/docker-compose.yaml up -d mcp
```

The local endpoint is:

```text
http://localhost:4020/mcp
```

Health check:

```bash
curl http://localhost:4020/health
```

The service requires a TraceX workspace bearer token on every MCP request:

```http
Authorization: Bearer <workspace-token>
```

One MCP connection is scoped to one workspace token. To use another workspace, add another MCP server connection with a token for that workspace.

## Codex

Codex supports Streamable HTTP MCP servers through `codex mcp add --url`. Put the TraceX workspace token in an environment variable, then register the endpoint:

```bash
export TRACEX_MCP_TOKEN='<workspace-token>'
codex mcp add tracex-cards --url http://localhost:4020/mcp --bearer-token-env-var TRACEX_MCP_TOKEN
codex mcp list
```

Restart Codex after changing MCP configuration if the running session does not pick up the new server.

## Other MCP Clients

Configure a Streamable HTTP MCP server with:

```text
URL: http://localhost:4020/mcp
Authorization: Bearer <workspace-token>
```

Available card tool names use the `card.` namespace, for example `card.list_spaces`, `card.list_types`, `card.list_attributes`, `card.get`, `card.search`, `card.create`, and `card.update`.

Generic object tools use the `object.` namespace. For example, list employees for a card reference attribute with:

```json
{
  "name": "object.find",
  "arguments": {
    "classId": "contact:mixin:Employee",
    "limit": 50,
    "total": true,
    "includeCollaborativeFields": false
  }
}
```

Use `query` for filters and `sort` for ordering. For paging, add cursor conditions directly to `query`, for example `{ "_id": { "$gt": "..." } }`. Legacy `*:class:*` identifiers are resolved to matching `*:mixin:*` identifiers when the class identifier no longer exists.

`includeCollaborativeFields` defaults to `true`. Set it to `false` for reference lists and pickers where markup/collaborative document fields are not needed.

## Environment

The compose service uses:

```text
PORT=4020
SERVER_SECRET=secret
ACCOUNTS_URL=http://tracex.local:3000
COLLABORATOR_URL=ws://tracex.local:3078
SERVICE_ID=mcp-service
WORKSPACE_CLIENT_CACHE_MS=0
```

`COLLABORATOR_URL` is required for correct card content updates and `TypeCollaborativeDoc` attribute updates.

`WORKSPACE_CLIENT_CACHE_MS=0` disables the workspace client cache so runtime card type and space changes are visible to the next tool call. Set a positive value only when schema freshness is less important than reducing model reloads.
