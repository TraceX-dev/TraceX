# Integration Slots/Link MVP

Статус: черновик

## Контекст

Карточки являются конфигурируемыми платформенными объектами, но состояние
интеграции не должно принадлежать карточкам. Сейчас базовая модель интеграций
живет в `setting`:

- `setting.IntegrationType` описывает тип интеграции и ее UI/resources.
- `setting.Integration` описывает конкретное подключение или конфигурацию.
- Сегодня многие интеграции сами владеют своими доменными объектами и
  состоянием синхронизации.

Примеры:

- Gmail хранит mail-specific объекты в Gmail-домене.
- Bitrix хранит свои entity/field mappings в Bitrix-домене.

Цель: дать интеграции способ объявить, какая форма platform object ей нужна, и
вынести общие части подключения и настройки в платформенный слой: routing,
slot binding, target class/factory selection, базовые resolvers и process-facing
events/actions. Внутренности интеграции остаются внутренностями интеграции:
provider-specific модели, raw payload, конвертация форматов, edge cases и
решение конфликтов не должны насильно сводиться к общей абстракции.

## Не цели

- Не вводить общий `CardIntegrationLink`.
- Не переносить sync-state интеграций в card/card-resources.
- Не делать card sections контрактом интеграции.
- Не требовать, чтобы все интеграции использовали одну generic mapping-модель.
- Не прятать integration-specific модели объектов за слишком общей и бедной
  абстракцией.
- Не заставлять интеграции заново писать routing UI, slot binding UI,
  target factory selection и базовые resolver-настройки.
- Не унифицировать provider internals: raw payload, provider-specific sync
  details, format converters и conflict policy остаются на стороне конкретной
  интеграции.

## MVP

Первый шаг не реализует GitLab/Jira/Confluence/GitHub интеграции. MVP должен
содержать только общие слои:

- model contracts;
- routing policy;
- slot binding;
- target factories;
- value resolvers;
- common configure UI;
- process-facing normalized events/actions.

Проверять дизайн можно на fixture/dev provider, который отдает заранее заданные
normalized external objects и не ходит ни в один внешний API.

Object families, под которые проектируется общий слой:

- `gitlab.issue`
- `gitlab.mergeRequest`
- `github.issue`
- `github.pullRequest`
- `jira.issue`
- `confluence.page`

Эти provider-ы являются design constraints, но не входят в MVP реализации.

## Оценка отвязки от MasterTag

Идея отвязать routing/binding от `Ref<MasterTag>` и перейти к
`Ref<Class<Doc>> + target factory` выглядит правильной.

Плюсы:

- одна схема работает для cards, tracker issues, documents, contacts и будущих
  объектных моделей;
- интеграция не знает, что такое card type, document type или contact subtype;
- common link/setup layer может оставаться общим, а создание конкретного объекта
  уходит в registered factory;
- Confluence можно синкать в documents, Jira/GitLab/GitHub issues в tracker или
  cards, внешних пользователей в contacts;
- появляется явная точка для class invariants: required fields, default space,
  permissions, content initialization, task status setup.

Риски:

- `Class<Doc>` сам по себе недостаточен для создания объекта: нужен factory;
- разные классы имеют разные требования к `space`, collections, mixins,
  collaborative content и permissions;
- UI выбора target class должен фильтровать только классы с registered factory,
  иначе пользователь выберет несоздаваемый target;
- update тоже может быть class-specific, поэтому нужен не только `create`, но и
  optional `update/canCreate`.

Вывод: плюсов больше, если сделать factory обязательной для каждого selectable
target class. Routing target хранит `targetClass`, а factory резолвится по этому
классу из модели, где класс объявлен.

## Предлагаемая форма

### Разделение ответственности

Интеграция не должна владеть всем setup pipeline, но и общий слой не должен
присваивать себе provider internals. Более устойчивое разделение:

- общий слой владеет routing, slot binding, target class/factory selection,
  common value resolution и common configure UI;
- интеграция владеет API, provider-specific объектами, raw payload,
  provider-specific sync loop/state, связью external object -> platform doc,
  format converters и conflict policy;
- platform object не владеет состоянием интеграции;
- если provider-у нужны специальные данные, они лежат в provider-specific docs,
  а не становятся обязательной архитектурной точкой для всех.

Общий слой не вводит `IntegrationContainer` и `IntegrationExternalObject`.
Контейнеры и внешние объекты являются provider-specific docs: GitHub repository,
GitLab project, Jira project, Confluence space/page и т.д. В общих routing
rules они проходят только как `Ref<Doc>`, без попытки привести их к единой
схеме.

Это не `CardIntegrationLink` и не общий `DocSyncInfo`. Базовый слой описывает,
как настроить routing/binding/create target, а не где хранить внутреннее
состояние синхронизации конкретного provider-а.

Provider-specific документы допустимы, но только как extension point. Например,
GitHub PR review threads или Confluence page ancestors могут потребовать
отдельных docs, потому что это уже доменная модель provider-а, а не общий sync
state.

### Минимальный контракт интеграции

Общий слой не должен диктовать интеграции полный adapter contract. В common-only
MVP не вводим общий `IntegrationCapabilities` и общий `container`. Когда UI
настройки понадобится показать GitHub repositories, GitLab projects, Jira
projects или Confluence spaces, конкретная интеграция отдаст свои docs своими
resources или своим configure component.

Минимально provider делает:

- подключение и хранение credentials через существующий `setting.Integration`;
- discovery контейнеров: GitLab projects, GitHub repositories, Jira projects,
  Confluence spaces;
- чтение или выдачу списка внешних объектов в форме, достаточной для common UI;
- создание/обновление собственных provider-specific docs и собственного sync
  state;
- provider-specific converters для markdown/adf/storage-format, webhooks,
  transitions, retries и conflict policy.

Общими должны быть только платформенные части:

- routing external object -> target space/target class;
- slot binding;
- user/status/label/milestone resolution;
- создание/обновление platform doc через target factory;
- link metadata между external object и platform doc;
- базовый UI настройки routing/bindings/resolvers;
- process triggers/methods на основе normalized events.

В common-only MVP реальные provider resources не реализуются. Граница такая:
общие слои умеют настраивать routing/binding/target creation, а не управлять
всем жизненным циклом GitLab/Jira/GitHub/Confluence.

### Контракт slot provider

Общий платформенный контракт должен быть небольшим. Тип внешнего объекта
объявляет, какие слоты ему нужны от workspace model.

Черновик:

```ts
interface IntegrationSlotProvider extends Doc {
  integrationType: Ref<IntegrationType>
  label: IntlString
  requiredSlots: Record<string, IntegrationSlotModel>
  optionalSlots?: Record<string, IntegrationSlotModel>
  configureComponent?: AnyComponent
  presenter?: AnyComponent
}
```

`IntegrationSlotProvider` лучше хранить отдельными docs, а не напрямую внутри
`IntegrationType`. Тогда один тип интеграции может объявлять несколько provider
docs, например отдельно для issue, merge request или page. Дополнительный
`objectKind` не нужен: `_id`/класс самого `IntegrationSlotProvider` уже является
идентификатором конкретного slot provider-а.

Для GitLab issue:

```ts
requiredSlots: {
  title: IntegrationAttributeSlotModel
  description: IntegrationAttributeSlotModel
  state: IntegrationAttributeSlotModel
  assignee: IntegrationSlotModel
  labels: IntegrationSlotModel
  dueDate: IntegrationAttributeSlotModel
  externalUrl: IntegrationAttributeSlotModel
}
```

Для Jira issue профиль почти тот же, но с другими provider fields:

```ts
requiredSlots: {
  title: IntegrationAttributeSlotModel
  description: IntegrationAttributeSlotModel
  state: IntegrationAttributeSlotModel
  issueType: IntegrationSlotModel
  assignee: IntegrationSlotModel
  reporter: IntegrationSlotModel
  labels: IntegrationSlotModel
  priority: IntegrationAttributeSlotModel
  externalUrl: IntegrationAttributeSlotModel
}
```

Для Confluence page это уже content family:

```ts
requiredSlots: {
  title: IntegrationAttributeSlotModel
  content: IntegrationAttributeSlotModel
  author: IntegrationSlotModel
  space: IntegrationSlotModel
  parent: IntegrationSlotModel
  labels: IntegrationSlotModel
  externalUrl: IntegrationAttributeSlotModel
}
```

Для GitHub/GitLab PR/MR это code review family:

```ts
requiredSlots: {
  title: IntegrationAttributeSlotModel
  description: IntegrationAttributeSlotModel
  state: IntegrationAttributeSlotModel
  author: IntegrationSlotModel
  reviewers: IntegrationSlotModel
  repository: IntegrationSlotModel
  targetBranch: IntegrationAttributeSlotModel
  sourceBranch: IntegrationAttributeSlotModel
  externalUrl: IntegrationAttributeSlotModel
}
```

Идея похожа на required slots у процессов, но типы не должны быть общими.
У integration свой более узкий slot contract, сейчас только `attribute | class`.
Process slots остаются внутри process package.

### Target class и factory

Binding/routing не должны быть завязаны на `MasterTag`. Интеграция может
синхронизироваться не только с карточками, но и с tracker issues, documents,
contacts или любым другим platform class. Поэтому target должен описываться
через класс и функцию создания.

Черновик:

```ts
interface IntegrationTargetFactory extends Doc {
  targetClass: Ref<Class<Doc>>
  create: Resource<CreateIntegrationTarget>
  update?: Resource<UpdateIntegrationTarget>
  canCreate?: Resource<CanCreateIntegrationTarget>
}

type CreateIntegrationTarget = (
  ctx: IntegrationTargetContext,
  target: IntegrationRoutingTarget,
  values: Record<string, unknown>
) => Promise<Doc>

type UpdateIntegrationTarget = (
  ctx: IntegrationTargetContext,
  doc: Doc,
  values: Record<string, unknown>
) => Promise<void>

type CanCreateIntegrationTarget = (
  ctx: IntegrationTargetContext,
  target: IntegrationRoutingTarget
) => Promise<boolean>
```

Это сохраняет общий setup/create pipeline, но не заставляет common layer знать, как
создать конкретный тип объекта. Например:

- Card factory может создать `card.class.Card` или конкретный card-derived
  class;
- Tracker factory может создать issue в project space с нужным task type/status;
- Document factory может создать документ и подготовить collaborative content;
- Contact factory может создать person/organization и заполнить social ids.

Если для класса нет registered factory, этот класс нельзя выбрать как target
для import/sync.

Factory регистрируется там же, где объявлен соответствующий target class. Это
сохраняет инварианты рядом с моделью, которая их реально знает: card factory в
card model/plugin, document factory в document model/plugin, tracker factory в
tracker model/plugin. Общий слой только резолвит factory по `targetClass`.

### Slot binding

Binding может быть generic, если останется узким:

```ts
interface IntegrationSlotBinding extends Doc {
  provider: Ref<IntegrationSlotProvider>
  targetClass: Ref<Class<Doc>>
  bindings: Record<string, string>
}
```

Binding связывает имена слотов provider с конкретными platform ids:

```ts
{
  title: 'card:attribute:title',
  description: 'card:attribute:content',
  state: 'tracker:attribute:status',
  assignee: 'contact:class:Person',
  labels: 'card:attribute:tags',
  dueDate: 'tracker:attribute:dueDate'
}
```

Это не sync-state объект. Это только конфигурация, которая говорит интеграции,
как конкретный platform class удовлетворяет ее required slots.

### Routing и resolution policy

Обычного field mapping недостаточно. Нужна общая policy-логика, похожая на то,
что уже есть в GitHub/tracker интеграции:

- конкретный workspace/project/space может быть связан с конкретным external
  container: GitLab project, GitHub repository, Jira project, Confluence space;
- другой space может быть связан с другим container;
- часть внешних объектов может падать в fallback/default space;
- при создании объекта из Huly пользователь может выбирать target container;
- assignee/reviewer/author нельзя надежно смапить простым полем, нужен resolver
  пользователей;
- labels/status/milestone/component могут требовать стратегий, а не прямого
  `field -> field`.

Поэтому рядом со слотами нужен не generic field mapping object, а общий routing
и resolver слой.

Ориентир из текущего GitHub/tracker: repository является отдельным объектом
интеграции, project получает GitHub mixin со списком repositories, а при
создании issue есть preference/выбор target repository для space. Общий слой
должен сохранить этот уровень гибкости, а не свести все к прямому field mapping.

Черновая форма:

```ts
interface IntegrationRoutingPolicy extends Doc {
  integration: Ref<Integration>
  provider: Ref<IntegrationSlotProvider>
  rules: IntegrationRoutingRule[]
  fallback?: IntegrationRoutingTarget
}

interface IntegrationRoutingRule {
  externalPattern?: string
  space?: Ref<Space>
  targetClass?: Ref<Class<Doc>>
  target?: IntegrationRoutingTarget
  resolver?: Resource<ResolveIntegrationRoute>
}

interface IntegrationRoutingTarget {
  space?: Ref<Space>
  targetClass: Ref<Class<Doc>>
}

type ResolveIntegrationRoute = (
  integration: Integration,
  external: unknown,
  context: Record<string, unknown>
) => Promise<IntegrationRoutingTarget | undefined>
```

И отдельно resolver-ы для сложных значений:

```ts
interface IntegrationValueResolver extends Doc {
  provider: Ref<IntegrationSlotProvider>
  slot: string
  resolver: Resource<ResolveIntegrationValue>
}

type ResolveIntegrationValue = (
  integration: Integration,
  external: unknown,
  context: Record<string, unknown>
) => Promise<unknown>
```

Для разных provider-ов это могут быть:

```ts
IntegrationUserResolver
IntegrationLabelResolver
IntegrationStatusResolver
IntegrationMilestoneResolver
IntegrationRouteResolver
```

User mapping пока выносим в отдельный дизайн. Здесь важно только, что общий
слой должен иметь extension point для resolver-а, а конкретная стратегия
`email/login/social identity/manual mapping/unassigned` будет спроектирована
отдельно.

Это не замена `IntegrationSlotBinding`. Binding отвечает на вопрос
`какое поле/отношение target class соответствует слоту`. Policy/resolver отвечает
на вопросы `куда класть объект` и `как получить корректное платформенное
значение из внешнего значения`.

Пример:

```ts
slot binding:
  assignee -> tracker:attribute:assignee

resolver:
  gitlab user id/login/email -> contact.Person | null

routing policy:
  GitLab group/backend -> Backend project space
  GitHub repo mobile-app -> Mobile project space
  Jira project OPS -> Operations space
  Confluence space DOCS -> Documentation space
  everything else -> Triage space
```

Такой подход лучше, чем пытаться описать все через одну таблицу маппинга.

Варианты routing, которые стоит поддержать:

```ts
// declarative rule: понятно отображается в UI и покрывает 80% случаев
{
  container: gitlabBackendProject,
  target: {
    space: backendSpace,
    targetClass: tracker.class.Issue
  }
}

// declarative fallback: все неразобранное падает в triage
fallback: {
  space: triageSpace,
  targetClass: tracker.class.Issue
}

// provider-owned resolver: когда правило зависит от внутренней логики
// интеграции, например issue type, labels, Jira workflow или Confluence tree.
{
  resolver: jiraRoutingResolver,
  targetClass: tracker.class.Issue
}
```

То есть базовая форма должна быть гибридной: declarative rules как основной и
видимый в UI путь, плюс optional provider-owned routing resolver для сложных
случаев. Resolver возвращает тот же `IntegrationRoutingTarget`, но его логика
не обязана быть универсальной.

## Provider examples

### GitHub/GitLab

Provider-owned internals:

- discover repositories/projects;
- pull issues и pull/merge requests;
- push issue/PR/MR updates;
- normalize webhooks;
- convert markdown и comments/reviews, если нужно;
- хранить provider-specific sync state/conflicts/raw, если требуется.

Common layer:

- repository/project -> space routing;
- issue/PR/MR -> target class binding;
- assignee/reviewer/author resolution;
- labels -> tags или enum strategy;
- status/open/closed/merged -> platform status;
- platform object creation/update через common target factory.

### Jira

Provider-owned internals:

- discover sites/projects/issue types;
- pull issues и schema fields;
- push issue updates/transitions;
- normalize Jira webhooks;
- convert Atlassian Document Format в platform markup;
- хранить provider-specific sync state/conflicts/raw, если требуется.

Common layer:

- Jira project/issue type -> space/target class routing;
- issue slots -> target class fields binding;
- assignee/reporter resolution;
- priority/status/labels/components resolution;
- platform object creation/update через common target factory.

### Confluence

Provider-owned internals:

- discover sites/spaces;
- pull pages/blog posts;
- push page updates, если включен export/sync;
- normalize webhooks;
- convert Confluence storage format/ADF в platform markup;
- хранить provider-specific sync state/conflicts/raw, если требуется.

Common layer:

- Confluence space/page tree -> target space/target class routing;
- page title/content/parent/labels/author slot binding;
- author resolution;
- page hierarchy resolution;
- platform object creation/update через common target factory.

## MVP flow без реальной интеграции

1. Dev/fixture provider регистрирует `IntegrationSlotProvider` для
   `fixture.workItem`.
2. Dev/fixture provider отдает provider-owned external objects через свой
   resource/configure component.
3. Админ настраивает routing policy: какие правила попадают в какие
   spaces/target classes, и куда складывать fallback.
4. Общий slot binding UI привязывает required slots к полям/relations
   выбранного target class.
5. Общий resolver UI настраивает пользователей/status/labels, если defaults
   недостаточно.
6. Fixture отдает normalized external objects без обращения к внешнему API.
7. Общий setup layer выбирает target через routing policy и создает/обновляет
   platform objects через target factory, resolved slot bindings и value
   resolvers.
8. Fixture/provider-owned слой остается владельцем external objects, raw
   payload, links to platform docs, cursors, retries и conflict state.

## Взаимодействие с процессами

Процессы должны потреблять тот же slot vocabulary и normalized events, а не
внутреннее состояние конкретного provider-а.

Возможные будущие triggers:

```ts
OnIntegrationObjectCreated
OnIntegrationObjectUpdated
OnIntegrationObjectDeleted
OnIntegrationObjectStateChanged
```

Возможные будущие methods:

```ts
CreateIntegrationObject
UpdateIntegrationObject
PushIntegrationObject
LinkIntegrationObject
```

Provider-specific triggers/methods можно добавлять как aliases или тонкие
wrappers, но payload должен оставаться основанным на resolved slots/context.

Process layer должен получать resolved context values от общего setup/resolver
слоя. Он не должен напрямую читать или мутировать произвольные provider
internals.

## UI surface

MVP UI должен быть общим и не зависеть от конкретной integration:

- список slot providers/fixture providers;
- routing policy editor: rule -> target space/target class;
- fallback target selector;
- выбор target class;
- slot binding editor;
- resolver settings для assignee/author/reviewer/labels/status/parent;
- setup/import controls;
- setup errors, scoped to routing policies/provider-owned objects.

Provider-specific UI должен быть extension point, а не основным путем. Например,
Confluence может показать preview page tree, Jira может показать issue type
schema, GitHub/GitLab могут показать repository permissions. Card UI опционален:
если позже понадобится, provider может добавить легкий presenter или extension,
который читает provider-owned data. Это должно быть только presentation, а не
источник состояния интеграции.

## Фазы реализации

### Фаза 1: Model contract

- Добавить маленькую модель integration slot provider.
- Добавить узкую slot binding модель.
- Добавить общий routing policy model.
- Добавить общий value resolver contract.
- Не зависеть от process `SlotModel`; у integration свой узкий slot contract.

### Фаза 2: Common setup layer

- Добавить helper для валидации required slots в `IntegrationSlotBinding`.
- Добавить helper для выбора `IntegrationRoutingTarget` через declarative rules
  или provider-owned route resolver.
- Добавить helper для применения `IntegrationSlotBinding` к slot values.
- Добавить helper для поиска `IntegrationTargetFactory` по `targetClass`.
- Добавить helper для создания/обновления platform docs через target factory.
- Добавить helper для применения `IntegrationValueResolver` к значениям слотов.
- User resolver оставить extension point до отдельного дизайна user mapping.

### Фаза 3: Fixture/dev provider

- Добавить fixture builders для `IntegrationSlotProvider`, `IntegrationSlotBinding`,
  `IntegrationRoutingPolicy`, `IntegrationTargetFactory` и `IntegrationValueResolver`.
- Добавить простой `IntegrationFixtureExternalObject` как provider-owned shape
  для ручных сценариев/тестов.
- Не реализовывать реальные GitLab/Jira/GitHub/Confluence API calls.

### Фаза 4: Configure UI

- Добавить `SlotBindingEditor` popup для настройки `IntegrationSlotBinding`.
- Добавить `IntegrationSetupEditor` popup для общего setup-flow:
  `targetClass`, `fallback.space`, `IntegrationSlotBinding.bindings`.
- Держать UI близким к process bindings/import slots mapping: `Card`, список
  slots, `Button + SelectPopup`.
- Routing policy editor: rule -> target space/target class.
- Fallback target selector.
- Target class selector.
- Resolver settings для assignee/author/reviewer/labels/status/parent.
- Базовая валидация отсутствующих required slots.
- Первый UI слой не сохраняет provider-specific state сам. Он возвращает
  выбранные настройки вызывающему settings/provider экрану, который уже решает,
  создавать или обновлять `IntegrationSlotBinding` и `IntegrationRoutingPolicy`.

### Фаза 5: Расширение на Jira/Confluence/GitHub

- Jira интеграция позже проверяет issue family и ADF conversion.
- Confluence интеграция позже проверяет content/page family и hierarchy routing.
- GitHub интеграция позже проверяет repository/code review family.
- Общие модели/flow не должны меняться, кроме provider-specific resources.

### Проверочный mock GitLab

Для ручной проверки общего слоя добавлен минимальный mock provider без GitLab
API:

- `Mock GitLab` integration type;
- `GitLab issue` slot provider;
- `IntegrationTargetFactory` для `card.class.Card`;
- resources для `create/update/canCreate` card target;
- configure popup, который сохраняет setup и умеет создать/обновить mock card.

Ручной сценарий:

1. Открыть Settings -> Integrations -> `Mock GitLab`.
2. Нажать Connect/Configure.
3. В popup нажать `Setup mapping`.
4. Выбрать target class `Card`.
5. Выбрать fallback space, желательно card space.
6. Замапить required slot `Title` на card attribute `Title`.
7. Сохранить setup.
8. Нажать `Create card`.
9. Нажать `Update created card`, чтобы проверить update factory.

Этот mock intentionally не хранит external sync-state и не создает GitLab
доменные docs. Он проверяет только common flow:
`slot provider -> binding -> routing fallback -> target factory`.

### Фаза 6: Process hooks

- Экспортировать normalized integration events как process triggers.
- Экспортировать provider operations как process methods.
- Держать process payloads основанными на resolved slots/context.

## Зафиксированные решения

- `IntegrationSlotProvider` хранится отдельным doc. Дополнительный `objectKind`
  не нужен: конкретный provider определяется самим doc/id.
- Integration slots не переиспользуют process slots. Для MVP хватает
  `attribute | class`.
- Existing platform docs, которые не были созданы интеграцией, обрабатывает сама
  интеграция. Общий слой не пытается угадывать merge/link стратегию.
- Общий `IntegrationExternalObject` не вводим. Связь external object ->
  platform doc хранит конкретная интеграция.
- `IntegrationTargetFactory` регистрируется в моделях/plugins, где объявлен
  соответствующий target class.
- Routing target хранит `targetClass`, а factory всегда резолвится по
  `targetClass`.
- Conflict policy является вопросом конкретной интеграции.
- Raw external payload хранит только сама интеграция.
- Provider-specific converters, например Jira ADF, Confluence storage format и
  GitHub/GitLab markdown, остаются внутренностью интеграции.

## Осталось отдельно спроектировать

- User mapping: email, username/social identity, ручная таблица соответствий,
  fallback на unassigned или гибрид.
- Где хранить user mapping, если он понадобится: common integration docs,
  social identities/contact channels или provider-specific docs.
