# TraceX OAuth issuer

This service adapts OpenAuth 0.4.3 to TraceX account authorization for MCP. It uses the existing TraceX login UI, account session validation, workspace membership, and `selectWorkspace` exchange.

## Configuration

Required variables:

| Variable | Purpose |
| --- | --- |
| `ACCOUNTS_URL` | Server-side accounts API address |
| `SERVER_SECRET` | Installation secret used to verify TraceX sessions and authenticate MCP; also derives the encryption key for issuer storage |
| `OPENAUTH_DATABASE_URL` | PostgreSQL connection string for persistent issuer state |
| `OPENAUTH_PUBLIC_URL` | Public issuer URL, optionally including a path prefix, for example `https://stage.example.com/oauth` |
| `OPENAUTH_MCP_RESOURCE_URL` | Exact public MCP URL, for example `https://mcp.example.com/mcp` |
| `OPENAUTH_LOGIN_URL` | Trusted front login page, for example `https://app.example.com/login/oauth` |

`PORT` defaults to `3001`. `OPENAUTH_ALLOW_HTTP=true` enables HTTP URLs for local development only. Configure HTTPS public URLs behind a reverse proxy in production; the service uses the configured public URL for issuer redirects and scopes cookies to its path. The issuer URL must not contain a query or fragment. `OPENAUTH_STORAGE` must not override the persistent adapter.

The issuer owns the `openauth` PostgreSQL schema and applies ordered migrations from `src/migrations.ts` at startup. Applied names and timestamps are recorded in `openauth.migrations`; restarts skip them. Pending migrations and their history entries run in one transaction under an advisory lock shared by issuer replicas. A failure rolls back that transaction and prevents startup. The initial migration also accepts tables created before migration tracking, preserving their data. Add a new named migration for future schema changes; never edit an applied migration.

The issuer does not access account tables directly. Its database principal needs permission to create and use its schema. Keep the installation secret stable across restarts. Credentials and issuer key material are encrypted at rest; bearer storage keys and access tokens are hashed.

Production and staging require different public issuer and resource URLs and separate issuer databases. The front service must receive the matching `OPENAUTH_PUBLIC_URL`; it publishes this trusted address as `OPENAUTH_URL` in `/config.json`. Configure `OPENAUTH_ISSUER_URL`, optional `OPENAUTH_INTERNAL_URL`, and the matching `OPENAUTH_MCP_RESOURCE_URL` on MCP.

## One origin with path-based routing

The issuer, MCP and front can share one HTTPS origin. For example:

```dotenv
# OpenAuth
OPENAUTH_PUBLIC_URL=https://stage.example.com/oauth
OPENAUTH_MCP_RESOURCE_URL=https://stage.example.com/mcp
OPENAUTH_LOGIN_URL=https://stage.example.com/login/oauth

# MCP
OPENAUTH_ISSUER_URL=https://stage.example.com/oauth
OPENAUTH_INTERNAL_URL=http://openauth:3001/oauth
OPENAUTH_MCP_RESOURCE_URL=https://stage.example.com/mcp

# Front
OPENAUTH_PUBLIC_URL=https://stage.example.com/oauth
```

The internal issuer URL must include the same path prefix as its public URL. The proxy must preserve request paths, including the issuer prefix, and forward the public `Host` to MCP. OpenAuth uses its configured public URL rather than forwarded headers to construct redirects and cookies. `/health` remains available at the issuer's upstream root for internal health checks; `/oauth/health` also works in this example.

OAuth discovery needs separate routes at the domain root. Per [RFC 8414](https://www.rfc-editor.org/rfc/rfc8414.html#section-3.1) and [RFC 9728](https://www.rfc-editor.org/rfc/rfc9728.html#section-3.1), the issuer or resource path follows the well-known suffix. For the URLs above, use the following routes inside the existing HTTPS server block:

```nginx
location ^~ /oauth/ {
    proxy_pass http://openauth:3001;
    proxy_set_header Host $host;
}

location = /.well-known/oauth-authorization-server/oauth {
    proxy_pass http://openauth:3001;
    proxy_set_header Host $host;
}

location = /mcp {
    proxy_pass http://mcp:4020;
    proxy_set_header Host $host;
    proxy_buffering off;
}

location = /.well-known/oauth-protected-resource/mcp {
    proxy_pass http://mcp:4020;
    proxy_set_header Host $host;
}
```

These `proxy_pass` directives intentionally have no URI or trailing slash, which [preserves the original request path](https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_pass). Keep the installation's existing front routes, including `/login/oauth`. Other prefixes work too: for issuer `/services/oauth` and resource `/services/mcp`, update both service routes and the corresponding `/.well-known/.../services/...` routes. MCP listens on the exact path configured in `OPENAUTH_MCP_RESOURCE_URL`.

## Authorization lifecycle

1. A public client registers its exact HTTPS or native-loopback redirect URIs using `/register`.
2. `/authorize` requires authorization code flow, PKCE S256, and this installation's MCP resource.
3. A short-lived login request sends the browser to the configured TraceX UI. Password, OTP, MFA, and existing external-provider flows remain owned by TraceX.
4. The user explicitly chooses one workspace or all accessible workspaces, including future memberships. Single-workspace access is selected initially and requires choosing a workspace before approval. The issuer validates current membership at approval and stores the selected stable workspace ID on the connection (`workspace_id = NULL` means all accessible workspaces). The UI sends the session token only to the configured issuer. No destination URL is accepted from query input.
5. A browser-bound, one-use completion creates a separate connection. The TraceX account token stays encrypted on the server. It is not included in the OAuth JWT, access token, browser callback URL, or connection-management response.
6. OpenAuth handles codes and refresh rotation. Externally issued access tokens are opaque and expire after five minutes. Refresh credentials expire after thirty days of inactivity. Rotation is serialized across replicas; a ten-second reuse window handles concurrent client refreshes, followed by reuse detection and revocation.
7. Every MCP request resolves the access token through the authenticated server-to-server `/internal/resolve` endpoint. The issuer checks token expiration, connection revocation, resource binding, and the underlying TraceX session, then returns the persisted workspace restriction. Refresh cannot change this restriction. MCP limits workspace discovery to that grant, rejects other workspace IDs before using cached clients, checks current membership, and exchanges the account token for the explicitly selected workspace.
8. The user can revoke each connection in **Account settings → Authentication → MCP connections**. New requests and renewal stop immediately. Already-running operations are not rolled back. If the TraceX session expires, the client must sign in again.

The adapter intentionally supports dynamic public-client registration for Codex. CIMD, confidential clients, custom URI callbacks, stdio, and verified ChatGPT integration are outside this first implementation.

## Tests

Run `rushx test` for in-process OAuth tests. To exercise PostgreSQL persistence, encryption, replica locking, rollback, ownership, and revocation, supply `OPENAUTH_TEST_DATABASE_URL` pointing to a **disposable** database and run the same tests. The integration suite initializes the private schema and leaves its fixtures in that test database.

## Manual acceptance

- Connect Codex by URL and browser sign-in without creating an API key.
- Exercise the normal password, OTP, external-provider, and MFA login paths used by the installation.
- List workspaces, then read and write explicitly in two different workspaces through one connection. Duplicate names must not select a workspace implicitly.
- Authorize a connection for one workspace, verify that discovery returns only it, and confirm that another workspace ID is rejected even when the account has access to both. Repeat after refreshing the token.
- Remove membership between opening consent and approving it; approval for the removed workspace must fail. Remove membership after authorization and verify that subsequent tool calls are denied.
- Remove membership and verify that the next operation is denied with workspace-client caching enabled.
- Check refresh after access expiration and issuer restart.
- Authorize two connections, revoke one in settings, and verify that its old access and refresh tokens fail while the other connection continues working.
- Confirm that production and staging connections remain separate.
