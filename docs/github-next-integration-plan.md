# GitHub Next Integration Plan

Статус: черновик для передачи в отдельного агента.

## Контекст

Нужна новая реальная GitHub-интеграция, которая проверяет общий integration-slot
слой на настоящем внешнем API и сразу целится в 2-way sync.

Название новой интеграции: `github-next`.

Важно: это не миграция старой GitHub-интеграции и не рефакторинг старого
`@hcengineering/github`. Старую интеграцию не импортируем, не расширяем и не
меняем. Максимум допустимо скопировать иконку или визуальный asset, если это не
создает runtime/API dependency.

Первый функциональный объект: GitHub Issue.

Следующие объекты:

- GitHub Discussion;
- GitHub Pull Request metadata;
- PR diff/review/approve capabilities позже отдельным слоем, не в первом
  generic object sync.

## Что уже есть в общем integration-layer

Общий слой находится в:

- `plugins/integration`;
- `models/integration`;
- `plugins/integration-resources`.

Ключевые контракты:

- `IntegrationSlotProvider` описывает provider object family и нужные slots.
- `IntegrationSlotBinding` связывает provider slots с attributes target class.
- `IntegrationRoutingPolicy` выбирает target space/class.
- `IntegrationTargetFactory` создает/обновляет platform doc конкретного класса.
- `IntegrationValueMapping` мапит значения enum/status-like slots в обе стороны.
- `IntegrationValueResolver` оставлен как extension point для специальных
  provider-specific значений.

Текущий подход:

- интеграция объявляет один или несколько `IntegrationSlotProvider`;
- пользователь выбирает target class, target space и bindings через общий UI;
- общий слой не владеет provider API, raw payload, retries, webhooks,
  conflict policy и sync loop;
- конкретная интеграция владеет внешним API, provider-specific docs и sync
  state;
- platform object не должен хранить внутреннее состояние интеграции;
- target object создается и обновляется только через registered
  `IntegrationTargetFactory`.

Уже есть target factories:

- card factory в `plugins/card-resources/src/integrationTargetFactory.ts`;
- tracker issue factory в `plugins/tracker-resources/src/integrationTargetFactory.ts`.

При добавлении новых plugin ids помнить правило: id в описании plugin
размещается только один раз на одном уровне. Если model plugin merge-ит
resources plugin, resource ids остаются в resources plugin и не дублируются в
model plugin.

## Account integrations: обязательный слой хранения подключений

Данные авторизации и подключения должны храниться в accounts DB через
существующий account integration слой, а не в workspace model docs.

Типы находятся в `server/account/src/types.ts`:

```ts
interface Integration {
  socialId: PersonId
  kind: IntegrationKind
  workspaceUuid: WorkspaceUuid | null
  data?: Record<string, any>
}

interface IntegrationSecret {
  socialId: PersonId
  kind: IntegrationKind
  workspaceUuid: WorkspaceUuid | null
  key: string
  secret: string
}
```

Операции находятся в `server/account/src/serviceOperations.ts`:

- `createIntegration`;
- `updateIntegration`;
- `deleteIntegration`;
- `listIntegrations`;
- `getIntegration`;
- `addIntegrationSecret`;
- `updateIntegrationSecret`;
- `deleteIntegrationSecret`;
- `getIntegrationSecret`;
- `listIntegrationsSecrets`.

Сервисные токены проверяются через `integrationServices` в
`server/account/src/utils.ts`. Если `github-next` worker/service будет читать
или писать integrations/secrets от service token `{ service: 'github-next' }`,
нужно добавить `'github-next'` в этот список.

### Как делает старый GitHub

Старый GitHub service использует account integrations:

- workspace-level integration:
  - `kind: 'github'`;
  - `workspaceUuid: <workspace uuid>`;
  - `data.installationId`;
- user-level integration:
  - `kind: 'github-user'`;
  - `workspaceUuid: null`;
  - `data.login`;
  - secret по `key: <github login>`.

Новый `github-next` должен использовать тот же account-layer pattern, но свои
`kind` значения и свои data/secret payloads.

## Предлагаемый account contract для github-next

### Workspace integration

`kind: 'github-next'`

`workspaceUuid: <workspace uuid>`

`data` содержит только несекретную информацию:

```ts
interface GithubNextIntegrationData {
  accountLogin: string
  accountType?: 'User' | 'Organization'
  installationId?: number
  repositories: GithubNextRepositorySelection[]
  capabilities: {
    issues: boolean
    discussions: boolean
    pullRequests: boolean
  }
}

interface GithubNextRepositorySelection {
  owner: string
  name: string
  repositoryId?: number
  nodeId?: string
  defaultBranch?: string
  htmlUrl?: string
}
```

Для PAT MVP `installationId` может отсутствовать. Для GitHub App flow он станет
основной ссылкой на installation.

### Secrets

Для MVP с PAT:

```ts
{
  kind: 'github-next',
  workspaceUuid,
  socialId,
  key: 'token',
  secret: '<encrypted-or-plain-current-account-secret-format>'
}
```

Если позже будет OAuth/GitHub App:

- `key: 'oauth'`;
- `key: 'installation:<installationId>'`;
- `key: 'refresh-token'`.

Точные форматы secrets должны быть provider-specific и не попадать в workspace
docs.

### User integration

`kind: 'github-next-user'` нужен только если outbound operations должны идти от
имени конкретного пользователя, а не от installation/PAT owner.

Для первого MVP можно не вводить `github-next-user`, если выбран PAT на
workspace integration. Но дизайн не должен мешать добавить его позже.

## Packages

Минимальный набор:

- `plugins/github-next`
  - public ids/types/kind;
  - constants;
  - provider-specific interfaces;
  - no UI implementation.
- `models/github-next`
  - model classes;
  - `setting.class.IntegrationType`;
  - `IntegrationSlotProvider` docs for issue/discussion/PR;
  - workspace-side provider state docs.
- `plugins/github-next-resources`
  - settings configure UI;
  - icon;
  - API helpers for account-client usage in browser/resources;
  - optional presenters.
- `server-plugins/github-next` or `services/github-next`
  - worker/sync runner;
  - GitHub API client;
  - inbound/outbound sync.

Decision point:

- If sync is periodic/webhook-heavy, prefer `services/github-next`.
- If it fits existing server plugin lifecycle, use `server-plugins/github-next`.

Для первого MVP можно начать с server-side package skeleton и manual sync entry,
не добавляя полноценный pod orchestration.

## Workspace model docs

Workspace docs не должны хранить credentials.

Предлагаемые docs:

```ts
interface GithubNextRepository extends Doc {
  integration: Ref<setting.Integration>
  owner: string
  name: string
  repositoryId?: number
  nodeId?: string
  htmlUrl?: string
  defaultBranch?: string
  enabled: boolean
}
```

```ts
interface GithubNextObjectSyncState extends Doc {
  integration: Ref<setting.Integration>
  provider: Ref<IntegrationSlotProvider>
  repository: Ref<GithubNextRepository>

  externalId: string
  externalNumber?: number
  externalUrl?: string
  externalNodeId?: string

  targetClass: Ref<Class<Doc>>
  targetId: Ref<Doc>

  externalVersion?: string
  externalUpdatedAt?: Timestamp
  externalHash: string
  targetHash: string

  lastDirection: 'inbound' | 'outbound'
  lastSyncedOn: Timestamp
  lastActor?: PersonId

  error?: Record<string, any>
  retryAfter?: Timestamp
}
```

`externalHash` и `targetHash` считаются по normalized mapped payload, а не по
raw GitHub JSON. Это важно для loop prevention.

Можно добавить provider-specific fields позже, но не превращать этот doc в
копию GitHub raw object.

## Slot providers

### GitHub Issue provider

Первый provider.

Slots:

```ts
requiredSlots: {
  title: attribute string
}

optionalSlots: {
  description: attribute markup/string
  state: attribute string with values ['open', 'closed']
  stateReason: attribute string with values ['completed', 'not_planned', 'reopened']
  assignee: class/person-like slot
  labels: attribute string array
  number: attribute number
  externalUrl: attribute string
  repository: attribute string
}
```

MVP fields:

- `title`;
- `description`;
- `state`;
- `externalUrl`;
- `number`.

Second iteration:

- `assignee`;
- `labels`;
- `stateReason`;
- milestones.

### GitHub Discussion provider

Second provider.

Slots:

```ts
requiredSlots: {
  title: attribute string
}

optionalSlots: {
  body: attribute markup/string
  category: attribute string
  answered: attribute boolean/string
  locked: attribute boolean/string
  externalUrl: attribute string
  number: attribute number
}
```

Default target should probably be card or document. If document target factory is
not ready, use card first.

Comments/replies are explicitly out of MVP.

### GitHub Pull Request provider

Third provider, metadata-only first.

Slots:

```ts
requiredSlots: {
  title: attribute string
}

optionalSlots: {
  description: attribute markup/string
  state: attribute string
  reviewDecision: attribute string
  mergeable: attribute string
  draft: attribute boolean
  headBranch: attribute string
  baseBranch: attribute string
  externalUrl: attribute string
  number: attribute number
}
```

No diff/review/approve in first PR provider. Those are separate capabilities,
not generic object sync.

## GitHub API client

Do not import old GitHub service/client.

For issue MVP REST is enough:

- `GET /user` to validate token and get account login;
- `GET /repos/{owner}/{repo}`;
- `GET /repos/{owner}/{repo}/issues`;
- `GET /repos/{owner}/{repo}/issues/{issue_number}`;
- `POST /repos/{owner}/{repo}/issues`;
- `PATCH /repos/{owner}/{repo}/issues/{issue_number}`.

Need to filter out PRs from issues endpoint:

- GitHub REST issues list includes pull requests;
- object with `pull_request` field is PR, not Issue provider object.

Discussion likely needs GraphQL:

- list repository discussions;
- read discussion;
- update discussion title/body/category if API permits current token.

PR metadata can use REST first, GraphQL later for review decision/mergeability if
needed.

## Sync architecture

### Inbound flow

1. Worker reads account integrations:
   - `listIntegrations({ kind: 'github-next' })`.
2. For every workspace integration:
   - read secret `key: 'token'` or installation token;
   - discover repositories from `Integration.data.repositories`;
   - ensure/update workspace `GithubNextRepository` docs.
3. Fetch external objects for enabled providers.
4. Normalize external object to provider slots:
   - `external -> Record<string, unknown>`.
5. Resolve routing:
   - `IntegrationRoutingPolicy`;
   - selected provider;
   - target class/space.
6. Resolve slot bindings and value mappings.
7. Find existing `GithubNextObjectSyncState` by:
   - integration;
   - provider;
   - repository;
   - external id/node id/url.
8. If state does not exist:
   - call target factory `create`;
   - create sync state.
9. If state exists:
   - calculate normalized hash;
   - skip if same as `externalHash`;
   - call target factory `update`;
   - update sync state.

### Outbound flow

1. Detect changed target docs that have `GithubNextObjectSyncState`.
2. Read current target doc.
3. Convert target doc through binding/value mappings back to provider slots.
4. Compare mapped target hash with `targetHash`.
5. If unchanged, skip.
6. Convert provider slots to GitHub patch.
7. Send GitHub update.
8. Store returned external version/hash and target hash.
9. Set `lastDirection: 'outbound'`.

Detection options:

- explicit trigger on Tx for target classes;
- periodic scan of sync states and target modifiedOn;
- both, later.

For MVP, periodic scan is easier and safer. Trigger can be added later for
latency.

## Loop prevention

Basic rule: compare normalized mapped data hashes, not raw docs.

Inbound:

- fetch external;
- normalize to slots;
- apply binding/value mapping;
- hash mapped target values;
- if hash equals state `externalHash`, skip;
- after target update, set both:
  - `externalHash` to incoming mapped hash;
  - `targetHash` to resulting target mapped hash;
  - `lastDirection: 'inbound'`.

Outbound:

- read target;
- map target back to provider slots;
- hash outbound slots;
- if hash equals state `targetHash`, skip;
- send patch only if actual GitHub patch is non-empty;
- after GitHub response, update:
  - `targetHash`;
  - `externalHash`;
  - external version fields;
  - `lastDirection: 'outbound'`.

Provider remains responsible for GitHub-specific anti-loop details:

- ignore own webhook events if webhooks are added;
- handle GitHub updated_at precision;
- handle API no-op responses;
- handle rate limits/retries.

The common layer should not own provider webhooks, rate limits or conflict
policy.

## Conflict policy

MVP policy:

- last writer wins based on sync order;
- if both external and target changed since last sync, prefer external inbound
  for the first version unless outbound scan is explicitly running;
- record conflict-ish details in `error` or later `conflict` field, but do not
  block MVP on conflict UI.

Future policy:

- per-provider conflict resolver;
- per-slot conflict policy;
- manual conflict UI.

## Settings UI

Use existing `setting` integrations pattern and common integration setup UI.

Minimal flow:

1. User opens Settings -> Integrations -> GitHub Next.
2. Configure component asks for token/PAT for MVP.
3. Component validates token through backend/resource call.
4. Component lists accessible repos.
5. User selects repos and capabilities.
6. Component creates or updates account `Integration`.
7. Component creates or updates account `IntegrationSecret`.
8. User configures provider mapping:
   - provider: GitHub issue;
   - target class: tracker issue or card;
   - target space filtered by target factory allowed spaces;
   - slot bindings;
   - value mappings.

Do not store token in workspace docs.

Do not build custom mapping UI unless the common one cannot express a required
case.

## Implementation phases

### Phase 0: Documentation and boundaries

- Add this doc.
- Confirm package names and service shape.
- Confirm PAT MVP vs GitHub App first.
- Confirm that old `@hcengineering/github` is not imported.

### Phase 1: Package skeleton and model

- Add `plugins/github-next`.
- Add `models/github-next`.
- Add `plugins/github-next-resources`.
- Add integration type:
  - `kind: 'github-next'`;
  - label/icon/configure component.
- Add `IntegrationSlotProvider` docs for GitHub Issue.
- Add placeholder providers for Discussion/PR only if useful, otherwise leave
  documented but not modeled.
- Add workspace model docs:
  - `GithubNextRepository`;
  - `GithubNextObjectSyncState`.

No real sync yet.

### Phase 2: Account integration setup UI

- Configure component for PAT MVP.
- Create/update account integration `kind: 'github-next'`.
- Add/update secret `key: 'token'`.
- Validate token and list repos through backend/resource endpoint.
- Store selected repositories in `Integration.data.repositories`.
- Do not write credentials to workspace model.

### Phase 3: GitHub API client

- Implement small standalone client.
- Validate token.
- List repositories or validate selected repository.
- List issues.
- Get issue.
- Patch issue.
- Create issue if outbound create is included in MVP.

No dependency on old GitHub service.

### Phase 4: Issue inbound sync

- Worker/manual sync reads account integrations.
- Ensures `GithubNextRepository` docs.
- Pulls issues.
- Skips PRs from REST issues endpoint.
- Normalizes issue slots.
- Uses existing common routing/binding/value mapping.
- Creates/updates target through target factory.
- Writes `GithubNextObjectSyncState`.

Manual verification:

- GitHub issue creates tracker issue/card.
- Title/body/status updates from GitHub update Huly target.
- Space selection respects target factory allowed spaces.

### Phase 5: Issue outbound sync

- Periodic outbound scan of sync states.
- Read target doc.
- Map target values back to provider slots.
- Build GitHub issue patch.
- PATCH GitHub issue.
- Update hashes/version fields.
- Verify no ping-pong after inbound update.

Manual verification:

- Change title in Huly -> GitHub title changes.
- Change status in Huly -> GitHub issue opens/closes via value mapping.
- GitHub inbound after outbound does not loop.

### Phase 6: Assignee and labels

- Add user mapping/resolver strategy.
- Add labels array mapping.
- Many-to-one value mapping is allowed.
- One-to-many value mapping is not supported.
- Arrays apply mapping per value.

### Phase 7: Discussion provider

- Add provider model.
- Add GraphQL client methods.
- Inbound discussion -> card/document target.
- Outbound title/body/category if supported.
- Comments/replies remain out of scope.

### Phase 8: PR metadata provider

- Add provider model.
- Sync metadata only.
- No diff/review/approve.
- Later add separate capability layer for code review actions.

## MVP acceptance criteria

- `github-next` can be configured without touching old GitHub integration.
- Account integration and secret are created in account DB.
- Selected repo is stored as non-secret integration data.
- GitHub issue provider can be mapped to tracker issue or card.
- Inbound issue create/update works.
- Outbound title/status update works.
- Loop prevention avoids repeated updates for the same mapped state.
- No import from old `@hcengineering/github` packages except optional copied
  static icon asset.

## Explicit non-goals for first implementation

- No migration from old GitHub.
- No shared `DocSyncInfo` with old GitHub.
- No reuse of old pod sync managers.
- No PR diff viewer.
- No approve/request changes.
- No comments sync.
- No custom mapping UI unless common integration UI is insufficient.
- No credentials in workspace docs.

