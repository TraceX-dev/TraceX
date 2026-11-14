# Agent token identification

Checked against Intabia Platform `develop` commit
[`9ce254979cb6492e6d5a52141f4d61cdd2c43bd4`](https://github.com/intabia-fusion/platform/commit/9ce254979cb6492e6d5a52141f4d61cdd2c43bd4),
dated October 28, 2026. This upstream snapshot differs from the local TraceX checkout.

External integrations using API keys and internal service agents use different identity markers.
There is no dedicated agent field in the shared token interface: it carries `account`, `workspace`,
optional `extra`, and optional grant and lifetime fields.
[Token interface](https://github.com/intabia-fusion/platform/blob/9ce254979cb6492e6d5a52141f4d61cdd2c43bd4/foundations/core/packages/token/src/token.ts#L17-L26).

## External agents using API keys

The raw API key has the format `fus_<ws-short>_<64 hex>`. The workspace segment is normalized
to lowercase alphanumeric characters and truncated to twelve characters. `isApiKey` recognizes
the `fus_` prefix; recognition alone does not authenticate the key. The server stores a SHA-256
hash rather than the raw key.
[Key generation and recognition](https://github.com/intabia-fusion/platform/blob/9ce254979cb6492e6d5a52141f4d61cdd2c43bd4/server/account/src/apiKeys.ts#L32-L93).

`loginWithApiKey` hashes the presented key, looks up its integration secret, checks expiry/revocation,
and issues a workspace token containing:

| Claim | Meaning |
| --- | --- |
| `extra.apikey` | UUID identifying the API key (`secret.keyId`) |
| `extra.apisid` | The key's own social identity (`row.socialId`) |
| `extra.apiws = '1'` | Integration key; absent for personal keys issued by this path |
| `extra.apiops` | Optional comma-separated permitted write operations |
| `extra.apiall = '1'` | Personal key with unrestricted operations, subject to the user's rights |
| `extra.apispaces` | Optional comma-separated space restrictions |
| `account` | Person/account acting as the principal |
| `workspace` | Workspace bound to the key |

The token receives an expiration and is passed through `selectWorkspace`, which preserves its
key identity and permissions.
[API key login](https://github.com/intabia-fusion/platform/blob/9ce254979cb6492e6d5a52141f4d61cdd2c43bd4/server/account/src/operations.ts#L3940-L4005).

Every key receives a fresh UUID and a dedicated webhook social identity. A personal key attaches
that identity to its creator's person. An integration key receives its own person and account,
assigned to the workspace, so its writes are attributed to the key rather than its issuer.
[Identity creation](https://github.com/intabia-fusion/platform/blob/9ce254979cb6492e6d5a52141f4d61cdd2c43bd4/server/account/src/operations.ts#L3782-L3809).

The product documentation describes personal and integration keys, permitted operations, space
restrictions, and a token lifetime of 1–90 days (30 by default). Revoking a key does not revoke
tokens it has already issued.
[Integration documentation](https://github.com/intabia-fusion/platform/blob/9ce254979cb6492e6d5a52141f4d61cdd2c43bd4/docs/features/integrations.md#L114-L119).

## Internal service agents

The account module's `isServiceToken(extra, account)` helper checks all three conditions:

```ts
extra?.service !== undefined &&
extra?.guest !== 'true' &&
account !== readOnlyGuestAccountUuid
```

`verifyAllowedServices` additionally checks the service name against an allowlist.
[Service token checks](https://github.com/intabia-fusion/platform/blob/9ce254979cb6492e6d5a52141f4d61cdd2c43bd4/server/account/src/utils.ts#L2335-L2354).

The shared generator can add `extra.service` from pod metadata, except for guest tokens.
The decoder verifies the signature by default.
[Generation and verification](https://github.com/intabia-fusion/platform/blob/9ce254979cb6492e6d5a52141f4d61cdd2c43bd4/foundations/core/packages/token/src/token.ts#L89-L119),
[Decoder](https://github.com/intabia-fusion/platform/blob/9ce254979cb6492e6d5a52141f4d61cdd2c43bd4/foundations/core/packages/token/src/token.ts#L141-L171).

`love-agent` generates a token with `account = systemAccountUuid`, `extra.service = 'love-agent'`,
and optionally `extra.roomName`. Its local generator signs it using `config.ServerSecret`.
The system account UUID is `1749089e-22e6-48de-af4e-165e18fbd2f9`.
[Agent calls](https://github.com/intabia-fusion/platform/blob/9ce254979cb6492e6d5a52141f4d61cdd2c43bd4/services/ai-bot/love-agent/src/agent.ts#L70-L73),
[Agent generator](https://github.com/intabia-fusion/platform/blob/9ce254979cb6492e6d5a52141f4d61cdd2c43bd4/services/ai-bot/love-agent/src/token.ts#L16-L50).

The bot's workspace client uses its own `personUuid`, the workspace UUID, and
`extra.service = 'aibot'`.
[Bot workspace connection](https://github.com/intabia-fusion/platform/blob/9ce254979cb6492e6d5a52141f4d61cdd2c43bd4/services/ai-bot/pod-ai-bot/src/controller.ts#L348).

Authorization is endpoint-specific. The love identity endpoint checks `account === systemAccountUuid`;
the audio ingestion endpoints accept either that account or the bot's `personUuid`.
These checks do not require `extra.service === 'love-agent'`.
[Identity endpoint](https://github.com/intabia-fusion/platform/blob/9ce254979cb6492e6d5a52141f4d61cdd2c43bd4/services/ai-bot/pod-ai-bot/src/server/server.ts#L268-L275),
[Audio endpoint](https://github.com/intabia-fusion/platform/blob/9ce254979cb6492e6d5a52141f4d61cdd2c43bd4/services/ai-bot/pod-ai-bot/src/server/server.ts#L344-L350).

The practical distinction is key identity (`extra.apikey`, `extra.apisid`) for API-key callers,
service identity (`extra.service`) for backend services, and principal identity (`account`) for both.
None of these markers alone identifies an individual running agent process.

## Agents acting as a user

A personal API key preserves the user's account and workspace membership while assigning each
key its own social identity. During session creation, the server chooses the verified social id
matching `extra.apisid` as the primary author, falling back to the normal primary social id if
there is no match. Thus account-level rights remain the user's, while the key's writes can be
attributed separately. A dedicated personal key per agent identifies that agent's credential;
`extra.apikey` alone identifies API-key usage, not whether the caller is an AI model.
[Personal key creation](https://github.com/intabia-fusion/platform/blob/9ce254979cb6492e6d5a52141f4d61cdd2c43bd4/server/account/src/operations.ts#L3782-L3790),
[Session author selection](https://github.com/intabia-fusion/platform/blob/9ce254979cb6492e6d5a52141f4d61cdd2c43bd4/foundations/server/packages/server/src/sessionManager.ts#L533-L557).

There is also an assistant-specific token issuance path: `refreshHulyAssistantToken` issues
`generateToken(account, undefined, { userAiAssistant: 'true' })` and stores it as the
`ai-assistant` integration's `access_token`. It preserves the user's account and explicitly
marks the token as an assistant token. This is a specialized integration path rather than a
per-agent credential identifier.
[Assistant token issuance](https://github.com/intabia-fusion/platform/blob/9ce254979cb6492e6d5a52141f4d61cdd2c43bd4/server/account/src/operations.ts#L2842-L2880).
