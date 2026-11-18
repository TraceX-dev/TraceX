# Text agent

Agent editing core: Yjs handles, schema awareness, document indexing and validated operations.

## Package boundary

`text-agent` owns `AgentOperationFailure`, operation contracts, indexing, fingerprints,
text matching, batch preparation/finalization and the Yjs reference adapter.
`getAgentSchemaCatalog(awareness)` uses a caller-supplied editor configuration.
The package does not import `text`, `text-ydoc`, MCP tools or REST contracts.

`text` owns editor extensions and their descriptive schema hooks. `text-ydoc` owns
ordinary document conversion. Collaborator integration tests cover the real
`ServerKit` and Yjs binding; isolated operation tests live in this package.

## Yjs references

`createYjsReferences(document, mapping, scope)` is the shared adapter for the
collaborator, operation prototype and integration tests. It binds the live XML
containers of `scope.field` to ProseMirror nodes from `initProseMirrorDoc`.
References use `encodeHandle(getHandle(element))`: the element creation identity
`client.clock` in base36. Document and field are supplied separately; they are
not embedded in the handle. Resolution uses the index of the selected live field.

Creating references never adds a missing field or writes IDs. References belong to
one synchronous read/prepare/commit operation. Recreate them after document changes
or an `await`; the adapter does not capture or compare Yjs snapshots. The
collaborator performs preparation and commit without yielding to other requests.
Deletion checks still compare the expected subtree fingerprint with current content.

## Контекст схемы

`Awareness` владеет рабочей схемой и метаданными одной конфигурации Tiptap extensions без создания `Editor`. `getEditorContext(awareness)` возвращает:

- `topNode`: имя корневого типа;
- `nodes`: типы узлов, их описания, атрибуты, выражения `content`, `allowedChildren`, группы, признак inline, разрешённые marks и примеры;
- `marks`: типы marks, их описания, атрибуты, группы и исключения.

Ключи в `nodes`, `marks` и `attributes`, а также поле `name` — технические имена в схеме. Поле `label` — имя для отображения. Каждый атрибут содержит вычисленные `type`, `required`, `nullable` и default при наличии; хук добавляет описание и правила доступа. `required` отвечает за наличие атрибута, а `nullable` — за допустимость значения `null`. Несколько типов перечисляются массивом: `type: ['string', 'number']`. Enum-значения берутся из нативного enum-валидатора.

Контекст можно вычислить один раз для каждой конфигурации расширений:

```typescript
import { ServerKit } from '@hcengineering/text'
import { Awareness, getEditorContext } from '@hcengineering/text-agent'

const awareness = new Awareness([ServerKit])
const schema = awareness.schema
const context = getEditorContext(awareness)
const stored = JSON.stringify(context)

const todo = awareness.of('todoItem')
const linkedTask = awareness.attr('todoItem', 'todoid')
```

Один экземпляр переиспользуется для всех документов с этой конфигурацией расширений. Метаданные находятся внутри `Awareness`, отдельно от ProseMirror `spec`. Методы `of` и `attr` возвращают `undefined`, если описание отсутствует. Все нативные типы и атрибуты остаются в контексте даже без хука.

Эту же `schema` нужно использовать для создания `EditorState`. Операции получают тот же экземпляр первым аргументом: `prepareAgentOperations(awareness, state, ops, scope, policy, references)`. Несовпадение схем отклоняется с `SCHEMA_INVALID`. `parseAgentNode(awareness, raw)` и `getEditorContext(awareness)` используют того же владельца.

Извлечение выполняется локально, без Zod, AI Toolkit, AI API и DOM. Оно не запускает lifecycle редактора или плагины и не читает и не изменяет документ.

## Описания собственных расширений

Описание находится в самом node/mark через `addSchemaAwareness()`. Например:

```typescript
import { Node } from '@tiptap/core'
import type {} from '@hcengineering/text-agent'

const Alert = Node.create({
  name: 'alert',
  group: 'block',
  content: 'inline*',
  addAttributes () {
    return { kind: { default: 'info', validate: 'string' } }
  },
  addSchemaAwareness () {
    return {
      label: 'Alert box',
      description: 'Highlighted content with a semantic kind.',
      attributes: {
        kind: { description: 'Semantic kind.' }
      },
      example: {
        type: this.name,
        content: [{ type: 'text', text: 'Check this information.' }]
      }
    }
  }
})
```

Хук получает `this.name`, `this.options`, `this.storage` и полную скомпилированную `this.schema`. Производные `.extend()` наследуют описание; собственный хук может переопределить его или дополнить результат `this.parent?.()`. Хуки вызываются один раз при создании `Awareness`; чтение контекста повторно их не запускает.

Хук содержит только `label`, `description`, метаданные `attributes` и необязательный JSON `example`. Атрибутам доступны `description`, `access: 'readonly' | 'readwrite'` и `hidden`. Типы, default, обязательность, nullable и допустимые значения задаются в `addAttributes()` и не переопределяются хуком.

Конструктор `Awareness` отклоняет несуществующий ключ атрибута в хуке и невалидный `example`. Пример должен принадлежать своему типу узла и проходить `nodeFromJSON(example).check()`. `required` определяется отсутствием default, а `type` — нативным `validate` либо типом default. Из строкового `validate` значение `null` переносится в `nullable`, а `undefined` не включается в `type`. Для default `null`/`undefined` без дополнительных ограничений тип остаётся `unknown`: для точной проверки нужен нативный `validate` в `addAttributes()`.

`Awareness` сохраняет нативные валидаторы. Если валидатора нет, но default, отличный от `null`/`undefined`, задаёт тип, конструктор добавляет соответствующую проверку типа в агентскую схему. В Tiptap 3.33 передача `validate` в ProseMirror подтверждена тестом. Общие расширения используют `enumValidator` для enum-атрибутов: один список значений служит и проверке, и описанию.

Правила доступа дополняют существующую allowlist `AgentPolicy`: readonly/hidden-атрибуты запрещены в `update_attrs` и не могут явно присутствовать в JSON `insert_node` или новых marks, даже со значением `null`. Пропущенные readonly-атрибуты получают нативные defaults. Неподдерживаемый `move_node` остаётся за пределами MVP.

Общий `ServerKit` описывает references, файлы, изображения, embed, emoji, todo, Markdown, code/Mermaid, note и comment anchors. Описания textStyle/table cells учитывают реально подключённые атрибуты. Идентификаторы ресурсов и комментариев описаны как существующие ссылки; они не служат MCP handles.

## Проверки

Из каталога пакета на Node >=20 <25:

```bash
rtk proxy node node_modules/jest/bin/jest.js --runInBand --coverage=false
rtk proxy node node_modules/@hcengineering/platform-rig/bin/compile.js validate
```

В CI штатный Jest-набор проверяет соответствие ключей хука рабочей схеме, описания всех видимых атрибутов ServerKit, валидность примеров через `nodeFromJSON(example).check()`, настройки вложенности и исполнение правил доступа/валидации в ops-слое.
