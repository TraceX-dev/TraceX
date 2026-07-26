# TraceX MCP Service

This pod exposes TraceX workspace tools as a Streamable HTTP MCP server.

## Endpoints

The default local endpoints are:

```text
MCP:    http://localhost:4020/mcp
Health: http://localhost:4020/health
```

Every MCP request must include a TraceX workspace bearer token:

```http
Authorization: Bearer <workspace-token>
```

One MCP connection is scoped to one workspace token. To work with another workspace, create another MCP server connection with a token for that workspace.

## Local Docker Compose

Build the image before starting the compose service:

```bash
rush build --to @hcengineering/pod-mcp
rush bundle --to @hcengineering/pod-mcp
rush docker:build --to @hcengineering/pod-mcp
```

Start the service from the repository root:

```bash
docker compose -f dev/docker-compose.yaml up -d mcp
```

Check that the service is running:

```bash
curl http://localhost:4020/health
```

## Codex

Register the local Streamable HTTP MCP endpoint with a TraceX workspace token:

```bash
export TRACEX_MCP_TOKEN='<workspace-token>'
codex mcp add tracex --url http://localhost:4020/mcp --bearer-token-env-var TRACEX_MCP_TOKEN
codex mcp list
```

Restart Codex after changing MCP configuration if the running session does not pick up the new server.

## Other MCP Clients

Configure a Streamable HTTP MCP server with:

```text
URL: http://localhost:4020/mcp
Authorization: Bearer <workspace-token>
```

The server returns JSON text for all tool results and also fills MCP `structuredContent` when a tool has an output schema.

## Tools

### Cards

Card tools use the `card.` namespace:

```text
card.list_spaces
card.list_master_tags
card.master_tag_details
card.get
card.search
card.create
card.update
```

Use `card.list_spaces` to discover visible card spaces. Use `card.list_master_tags` and `card.master_tag_details` to discover available card types, master attributes, versioning settings, and tag mixins before creating or updating cards.

`card.get`, `card.create`, and `card.update` support top-level collaborative card content as HTML. `card.update` also supports `TypeCollaborativeDoc` attribute updates through the collaborator service.

### Fulltext

Use `fulltext.search` to search indexed workspace objects and return compact object references:

```json
{
  "name": "fulltext.search",
  "arguments": {
    "query": "risk",
    "classes": ["card:class:Card"],
    "limit": 20
  }
}
```

Optional filters include `classes`, `spaces`, and `includeClassDescendants`.

### Object Lookup

Use `object.lookup` to list recent objects by class or mixin and return compact references:

```json
{
  "name": "object.lookup",
  "arguments": {
    "classId": "contact:mixin:Employee",
    "limit": 50
  }
}
```

Results are sorted by `modifiedOn` descending. `limit` defaults to `50` and is capped at `200`.

## Environment

The compose service uses:

```text
PORT=4020
SERVER_SECRET=secret
ACCOUNTS_URL=http://tracex.local:3000
COLLABORATOR_URL=ws://tracex.local:3078
SERVICE_ID=mcp-service
WORKSPACE_CLIENT_CACHE_MS=0
STORAGE_CONFIG=${STORAGE_CONFIG}
```

`ACCOUNTS_URL` and `COLLABORATOR_URL` are required. `COLLABORATOR_URL` is used for correct card content updates and `TypeCollaborativeDoc` attribute updates.

`SERVER_SECRET` is used to decode workspace bearer tokens and falls back to `SECRET`, then to `secret`.

`WORKSPACE_CLIENT_CACHE_MS=0` disables the workspace client cache so runtime card type and space changes are visible to the next tool call. Set a positive value only when schema freshness is less important than reducing model reloads.
