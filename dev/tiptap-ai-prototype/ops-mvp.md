# MVP ops-слоя

Дата проверки: 10 ноября 2026 года.

Код из приложенного примера адаптирован в общий пакет `@hcengineering/text-agent`, каталог `src/operations`. Адаптер handles находится в `@hcengineering/text-agent/src/operations/yjs-references.ts`. Это исполнимое ядро редактора и стенд его применения к Yjs. HTTP/MCP-инструменты, проверка прав и сохранение через Hocuspocus пока не подключены.

## Что реализовано

- `getEditorContext(awareness)`: реальная схема, ограничения вложенности, атрибуты и разрешённые возможности. Служебные атрибуты видны с признаком запрета редактирования.
- `parseAgentNode(awareness, raw)`: проверка неизвестных nodes, marks и атрибутов до преобразования ProseMirror. Неизвестные поля не отбрасываются молча.
- `createYjsReferences(document, mapping, scope)`: shared live XML/ProseMirror adapter in `text-agent`, using the same client/clock handles as the collaborator.
- `indexAgentDocument(doc, scope, references)`: outline с handles и отпечатками поддеревьев. Сохраняемые `uid`/`id`, путь и содержимое не используются для адресации.
- `indexAgentDocument` / `resolveAgentTarget`: разрешение ссылки на узел текущего снимка; текстовые узлы адресуются через контейнер.
- `findAgentText(node, contentStart, search)`: буквальные совпадения через границы marks, с остановкой на границах блоков, inline atoms и hard breaks. Позиции — внутренние координаты ProseMirror; будущий MCP-поиск должен возвращать ссылки на содержащие узлы.
- `prepareAgentOperations(awareness, state, ops, scope, policy, references)`: подготовка пакета из шести операций без изменения исходного состояния или обращения к DOM. Результат содержит транзакцию и внутренние координаты целей. `state` должен использовать `awareness.schema`.
- `finalizeAgentOperations(prepared, currentIndex)`: после применения к Yjs возвращает handles и fingerprints реальных сохранившихся контейнеров. Удалённые цели получают `deleted: true`.

Операции: `insert_node`, `update_attrs`, `delete_node`, `replace_text`, `add_mark`, `remove_mark`. Максимум — 100 операций. `move_node` отсутствует.

В отличие от исходного примера, ядро не назначает ID и не вызывает `editor.view.dispatch`. Оно возвращает транзакцию ProseMirror только после проверки всех операций. Внутри пакета ссылки разрешаются относительно начального снимка, затем цели отслеживаются через mapping шагов.

Вставка и удаление используют точный `ReplaceStep`: недопустимая структура вызывает ошибку. Автоматической вставки пустого абзаца после удаления обязательного блока нет.

## Политика редактирования

Политика задаётся явно и запрещает неописанные возможности записи. Например:

```typescript
import type { AgentPolicy } from '@hcengineering/text-agent'

const policy: AgentPolicy = {
  nodes: {
    paragraph: {
      insertable: true,
      deletable: true,
      textEditable: true,
      editableAttrs: ['textAlign']
    }
  },
  marks: {
    bold: { editable: true },
    italic: { editable: true },
    link: { editable: true }
  }
}
```

Это пример для соответствующей схемы. Нельзя включать атрибуты, которых нет в реальном профиле редактора. Если схема содержит служебные атрибуты, их можно явно защитить через `protectedAttrs`; ненулевое значение такого атрибута нельзя передавать при вставке. Атрибут `id` встроенной ссылки может обозначать внешний объект и не участвует в адресации.

Marks, не объявленные редактируемыми, защищены от прямой вставки, снятия и косвенного удаления через `excludes` другого mark. При замене текста обычные marks наследуются из начала диапазона. Защищённый mark переносится на новый текст, только если покрывал весь заменяемый диапазон. Частичный anchor не расширяется на весь новый текст; anchor на удалённом тексте может исчезнуть, а его часть за пределами замены сохраняется. Внешняя запись комментария не удаляется.

Extension metadata is supplied through `addSchemaAwareness()`. The collaborator derives capabilities from its active schema; readonly and hidden attribute rules are enforced by the operation layer.

## Handles и проверка удаления

`AgentScope` содержит адрес документа, поле и синхронную функцию hash. В серверном стенде используется SHA-256 из `node:crypto`; общее ядро не зависит от Node.js crypto и может работать в клиентском окружении с подходящим адаптером.

A handle is the base36 `client.clock` creation identity of its `Y.XmlElement`, obtained through `getHandle` and `encodeHandle`. Document and field are passed separately. References resolve only within the index of the selected live field; there is no persistent registry or alternate handle format.

The adapter walks live containers and verifies XML/ProseMirror type agreement and document/field scope. References are valid only within one synchronous read/prepare/commit operation; recreate them after changes or an `await`. No Yjs snapshot is captured or compared.

Handles сохраняются при проверенных правках текста, marks, атрибутов и вставках соседей, а также при бинарной загрузке Yjs. Пересоздание контейнера или документа из JSON инвалидирует handle. Ошибка — `STALE_REFERENCE`, следующее действие — перечитать. Одинаковый блок, появившийся на том же пути, не получает старый handle. Поиска замены по пути, тексту, хэшу или uid нет. Handle не предоставляет права доступа.

`fingerprint` хеширует область документа/поля и весь канонический JSON поддерева. `delete_node` требует `expectedFingerprint`, полученный из чтения. Проверка выполняется на начальном снимке, до собственных операций batch. Изменение текста, marks, атрибутов или вложенных объектов вызывает отказ удаления; собственный `replace_text` перед удалением не вызывает ложный отказ. Для остальных операций общей проверки ревизии нет.

Новый узел задаётся сразу целиком. Его handle появляется только после reconciliation к Yjs и финализации ответа по новому живому mapping. `prepareAgentOperations` не пытается выпустить handle для ещё не существующего контейнера.

## Запуск проверок

Используйте Node >=20 <25; проверено на Node 24.19.0.

Из корня репозитория запустить интеграционный стенд:

```bash
rtk proxy bash dev/tiptap-ai-prototype/run.sh --check-ops
```

Этот режим использует установленные зависимости приложения, не выполняет установку, сборку, форматирование и сетевые запросы. Результат выводится в stdout.

Run isolated operation tests from `foundations/core/packages/text-agent`:

```bash
rtk proxy node node_modules/jest/bin/jest.js --runInBand --coverage=false
```

Run the real editor schema and Yjs adapter integration tests from `server/collaborator`:

```bash
rtk proxy node node_modules/jest/bin/jest.js --runInBand --coverage=false src/agent/__tests__
```

The results below describe the original prototype run, before the package migration.

Результат проверки:

- 44 теста ops-ядра; всего в общем текстовом пакете — 123 теста, 9 наборов, все проходят.
- 11 тестов адаптера; всего в `text-ydoc` — 62 теста, 2 набора, все проходят.
- Проверка типов обоих пакетов через `compile validate` проходит; `text-ydoc` проверен native TypeScript 7.0.2.
- Стенд настоящего `ServerKit`: 14 сценариев, 43 проверки, все проходят.
- Диагностика новых TypeScript-файлов не показывает ошибок.

Сценарии стенда: чтение без Yjs updates и генерации uid; пакет с вставкой, форматированием и изменением ячейки таблицы; сохранение незатронутых Yjs-объектов и comment marks; отказ пакета без записи; сохранение handle после удалённой текстовой правки, обновления атрибутов и бинарной перезагрузки; выдача handles вставленных узлов; запрет удаления после удалённого изменения marks; замена текста с последующим удалением в одном batch; отказ старому handle после удаления и одинаковой вставки; отказ после JSON-пересоздания; отказ на неизвестном атрибуте до нормализации; конкурентные правки в разных блоках и разных диапазонах одного блока.

## Что остаётся до серверного MCP MVP

Стенд работает с двумя репликами в памяти. Он не проверяет живой транспорт Hocuspocus, полномочия пользователя, callbacks сохранения, TTL сессий, клиентское отображение, курсоры или полный паритет схем.

Перед серверным применением необходимо:

1. Авторизовать текущего пользователя и поле до чтения/записи.
2. Проверить сырое содержимое до конвертера, который может его нормализовать. Счётчик updates в стенде обнаруживает нежелательную запись, но не является механизмом её отката.
3. Прочитать живое состояние, подготовить и применить пакет без `await` между этими действиями. Возвращённую транзакцию нельзя применять к более позднему снимку.
4. Применить результат через проверенный мост к существующему fragment, получить свежие mapping и индекс, вызвать `finalizeAgentOperations` и завершить настоящий цикл сохранения. Yjs transaction не предоставляет rollback при исключении.
5. При ошибке после применения сообщить о неопределённом результате. Не повторять запись автоматически.
6. Подключить RPC, ограниченные по размеру ответы чтения и MCP-инструменты, затем проверить сценарии в приложении.

Следующие шаги и статус фаз описаны в [плане исполнения](../../docs/mcp-collaborative-editor-plan.md).
