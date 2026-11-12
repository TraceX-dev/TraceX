# Agent editing of Tiptap and ProseMirror documents

Research date: 2026-11-09. Scope: rich-text content in the current `feat-qms-mcp` working tree, including uncommitted changes. This is an architectural assessment, not a completed integration or an empirical comparison of model reliability.

## Assessment

Keep the editor schema as the source of structural truth. Generate an agent-facing description from the configured editor capabilities, enrich custom extensions with explicit semantic metadata, and execute edits through deterministic editor/collaboration code. A larger generic JSON Schema alone will not solve document preservation or concurrent editing.

The branch already reflects a real ProseMirror schema rather than maintaining a hard-coded node catalog. That is useful work to retain. The main concerns are schema fidelity to the actual client, insufficient semantic information for custom elements, and the coupling of full replacement with position-based protection.

## External implementations

### Trainual: MCP wrapper around document REST operations

The provided repository implements document reads and replace/append writes. Its update tool accepts `content` as `z.object({}).passthrough()` and sends it to the collaboration REST endpoint. It does not derive a schema-specific agent contract in this tool. This is a small integration example, not evidence of a comprehensive custom-node editing design. [README](https://github.com/trainual/tiptap-collaboration-mcp), [update tool source](https://github.com/trainual/tiptap-collaboration-mcp/blob/main/src/tools/update-document.ts).

### Tiptap: schema awareness plus editor-owned tools

`getEditorContext(editor)` collects context from a configured editor. The JSON can be stored and regenerated when extensions/schema change. Generation requires the actual editor configuration or an environment able to instantiate the same extensions. [Editor context](https://tiptap.dev/docs/ai/ai-toolkit/api-reference/editor-context).

Custom nodes/marks can provide `addJsonSchemaAwareness`: a human-readable name, description and explicit Zod schemas for attributes. Official extensions have built-in descriptions. Structural reflection and semantic descriptions are complementary. [Custom nodes](https://tiptap.dev/docs/ai/ai-toolkit/advanced-guides/custom-nodes).

The client toolkit also supports an HTML schema description through `getHtmlSchemaAwareness()` and custom `addHtmlSchemaAwareness` metadata. Thus native JSON is not the only supported model-facing representation. [Client schema awareness](https://tiptap.dev/docs/ai/ai-toolkit/client/agents/schema-awareness).

The current server REST API is v4. `fetch-tools` returns a system prompt and tool input schemas; `execute-tool` accepts either a Cloud document or inline JSON. Cloud execution documents a `409 concurrent_edit_conflict` response. Inline execution does not provide concurrency control for our own storage. [REST reference](https://tiptap.dev/docs/ai/ai-toolkit/api-reference/rest-api).

Tiptap Query selects content by type, text, attributes or `_hash`, then reads, replaces, inserts, changes attributes or applies ordinary marks. `expect` constrains match count. Reserved attributes and comment/tracked-change marks have dedicated restrictions. Its `_hash` values are maintained identifiers, not content revisions: existing values can survive replacement. The format is alpha. A failed operation stops the batch but retains earlier successful operations; reads can add hashes. [Query reference](https://tiptap.dev/docs/ai/ai-toolkit/api-reference/tiptap-query).

Adopting the toolkit is a separate integration decision. The current installation requires service access and authentication, and `ServerAiToolkit` modifies the editor schema. The package is described as open source, while execution is a Cloud/on-premises service. This does not establish compatibility with TraceX's Tiptap 2 packages or proprietary extensions. [Installation](https://tiptap.dev/docs/ai/ai-toolkit/install).

### BlockNote: block tools and an agent document projection

BlockNote AI separates the document-state builder from the tool provider. HTML is the default AI format; add/update/delete block tools and accept/reject actions are exposed. Both state and tools can be customized. [AI reference](https://www.blocknotejs.org/docs/features/ai/reference).

Block IDs are stable during a block's lifetime. This is a BlockNote model property, not a property of arbitrary ProseMirror nodes. [Document structure](https://www.blocknotejs.org/docs/foundations/document-structure).

Ordinary HTML import is explicitly lossy, so HTML round-tripping cannot be assumed to preserve arbitrary proprietary nodes or attributes. [HTML import](https://www.blocknotejs.org/docs/features/import/html).

### Liveblocks/Flexum: generate a document, compute edits deterministically

One production case study reports unstable model-generated operation streams referencing node IDs. The team switched to generating a complete edited document in restricted JSX-like markup, then deriving structured edits with a custom diff. Certain blocks are immutable; proposed changes are previewed locally while collaborators continue editing. Accept publishes the change set. This is evidence for an alternative, not a universal reliability result. The article's illustrative diff helpers are not a complete reusable concurrency algorithm. [Case study](https://liveblocks.io/blog/building-an-ai-copilot-inside-your-tiptap-text-editor).

### Convex ProseMirror Sync: native execution with explicit versions

The server uses the same schema-affecting extensions as the client. Slow AI generation happens before a transform callback, which receives the latest document and may run again after concurrent edits. Version comparison, stable identifiers or position mapping are explicit application concerns; returning `null` aborts a transform. This implementation uses ProseMirror OT rather than Yjs, so it is an execution-layer reference, not a drop-in transport replacement. [Server-side transforms](https://github.com/convex/prosemirror-sync#transforming-the-document-server-side).

ProseMirror distinguishes unchecked node creation from checked construction and `node.check()`. [Schema guide](https://prosemirror.net/docs/guide/#schema). Yjs relative positions address shared elements rather than raw offsets and can become unresolvable after deletion; they do not establish whether a stale edit still preserves intent. [Relative positions](https://docs.yjs.dev/api/relative-positions).

## Findings in the current working tree

1. **The structural catalog is already generated.** `contentSchema()` reflects node groups, content expressions, permitted child marks, attribute defaults and available validators. Retain this rather than introducing another manually maintained structural grammar. Its recursive `documentSchema` is only a generic JSON envelope; the implementation already says that editor rules live in the catalog and native validation. [Schema implementation](../services/ai-bot/ai-tools/src/tools/controlled-document/content-schema.ts).

2. **The selected schema is the static server schema.** `editorSchema` is extracted via `jsonToPmNode()` without explicit extensions. That selects `defaultSchema`, built from `defaultExtensions = [ServerKit]`. The client separately builds its editor kit and incorporates model-registered factories. These paths do not establish schema equivalence. This is a structural risk, not proof that a particular current QMS node is missing. [Conversion](../foundations/core/packages/text/src/markup/utils.ts), [default extensions](../foundations/core/packages/text/src/extensions.ts), [server kit](../foundations/core/packages/text/src/kits/server-kit.ts), [client kit](../plugins/text-editor-resources/src/kits/editor-kit.ts).

3. **Native schema reflection cannot recover missing semantics.** Descriptions such as `Editor node reference` do not explain reference resolution, resource allocation or permitted values. `describeAttribute()` serializes explicit string validators but cannot serialize arbitrary validator functions; defaults are deliberately not treated as constraints. For example, the shared reference node has domain-bearing attributes, and image attributes mostly declare defaults. Add intentional metadata beside owning extensions instead of guessing constraints from values or field names. [Catalog](../services/ai-bot/ai-tools/src/tools/controlled-document/content-schema.ts), [reference](../foundations/core/packages/text/src/nodes/reference.ts), [image](../foundations/core/packages/text/src/nodes/image.ts).

4. **Protection is tied to array positions.** `protectedFragments()` records structural paths; `validateReplacement()` compares each protected value at its original path. Inserting an ordinary paragraph before a protected node changes its pointer even if the protected node itself is preserved. Depending on the surrounding content, the edit will fail or cannot demonstrate preservation by identity. This follows directly from the comparison, without runtime reproduction. [Protection discovery](../services/ai-bot/ai-tools/src/tools/controlled-document/content.ts), [replacement validation](../services/ai-bot/ai-tools/src/tools/controlled-document/content-validation.ts).

5. **Ownership is inferred from names.** `managed()` matches IDs, UUIDs and threads with a regex. That is a conservative heuristic, not an extension-owned declaration distinguishing a node identity, a reference target and an editable business value. [JSON utilities](../services/ai-bot/ai-tools/src/tools/controlled-document/content-json.ts).

6. **Schema identity is not content concurrency control.** `schemaId` fingerprints the catalog/validators. `editContent()` rereads content and lifecycle facts but ultimately calls `updateMarkup()` without a base content revision. The protocol explicitly documents full replacement and no revision precondition. A lifecycle recheck does not protect edits made during model generation or between content validation and persistence. [Write handler](../services/ai-bot/ai-tools/src/tools/controlled-document/tools/edit-content.ts), [existing specification](./controlled-documents-mcp.md).

7. **Unknown nodes require a deliberately limited guarantee.** The validator preserves opaque fragments, explores possible child types for unknown children and skips the final full-tree `node.check()` when unknown nodes remain. This is a compatibility policy, not complete validation against the actual unknown node schema. [Validation](../services/ai-bot/ai-tools/src/tools/controlled-document/content-validation.ts).

## Recommended direction for TraceX

The following are design recommendations, not capabilities already present in the collaborator API.

1. Establish a shared, headless schema definition for every supported editor profile. Require parity with the client for all schema-affecting extensions; keep view-only behavior client-side. Identify the schema by profile/version, separately from content revisions.
2. Generate structural context from that definition. Attach names, descriptions, explicit attribute constraints and create/edit/preserve capabilities to custom extension owners. Keep authorization and domain checks authoritative on the server; agent context only explains them.
3. Start the agent interface with a small set of targeted read/edit operations. Resolve text/identity selectors in application code, reject ambiguity, and leave low-level ProseMirror steps to the executor. A stable target ID still needs a stale-content policy.
4. Apply changes inside the collaboration authority against a known base revision, with atomic conflict rejection or an explicitly defined mapping/rebase policy. A preflight reread followed by ordinary `updateMarkup()` is insufficient. New collaboration API support may be required.
5. Preserve protected data through ownership and untouched native nodes/marks, rather than demanding identical JSON array indexes. Where the actual schema is unavailable, avoid editing through the opaque region; do not claim that guessed validation is complete.
6. Keep QMS lifecycle tools as domain orchestration. Put reusable editor schema/context and mutation behavior in a shared rich-text layer, with QMS-specific resource rules supplied explicitly.

For broad rewrites, a proposed fragment/document plus deterministic structured diff is also viable. It adds serializer, diff, identity and concurrent-application work. Do not introduce HTML, Markdown or a new shorthand merely to shrink JSON until custom-node preservation is demonstrated.

## Decision checks before implementation

Compare a narrow operation interface with fragment generation plus diff on the same cases: nested lists, table cells, custom atoms, references, images, comment-marked text, insertion before protected content, duplicate text matches, and a target edited/deleted while the model responds. Measure task success, unintended changes, resource/identity preservation and retries, not only parse success.

No application source was modified for this research. No builds, formatters, tests, deployment or workspace mutations were run. The existing MCP specification remains unchanged; revising its agreed full-replacement scope requires a separate design decision.

## Follow-up: ready-made AI support and Tiptap 3

Verified 2026-11-09. There is a ready-made document-agent layer worth evaluating before implementing a proprietary operation protocol. Migrating core packages alone does not install this layer.

| Option | Ready-made functionality | Integration boundary |
| --- | --- | --- |
| Server AI Toolkit | Editor context, generated tool definitions/prompt, document read/edit execution and review options | Paid service, Cloud or on-premises. The public `@tiptap/ai-toolkit` package supplies editor-side integration. |
| Client AI Toolkit | Direct editor tool execution, streaming, schema awareness and local suggestions | Paid private package `@tiptap-pro/client-ai-toolkit`; executes in the browser against an editor. |
| Tiptap Compare | Structured document comparison, with comparison usable without an editor instance | Separate paid `@tiptap-pro/compare` package. Comparison does not itself establish safe concurrent persistence. |

Sources: [server overview](https://tiptap.dev/docs/ai/ai-toolkit/overview), [client overview](https://tiptap.dev/docs/ai/ai-toolkit/client/overview), [Compare overview](https://tiptap.dev/docs/compare/getting-started/overview).

### Version and licensing facts

- The public `@tiptap/ai-toolkit` package was version `0.4.1` when checked. Its metadata declares MIT and peers `@tiptap/core ^3.0.1`, `@tiptap/pm ^3.0.1`, `@tiptap/y-tiptap ^3.0.0` and `yjs ^13.6.23`. The package license does not make the separately authenticated AI execution service free. [Package metadata](https://registry.npmjs.org/@tiptap%2Fai-toolkit/latest), [server installation](https://tiptap.dev/docs/ai/ai-toolkit/install).
- The client toolkit's installation guide explicitly requires all `@tiptap/*` packages to be `3.12.0` or higher and access to the private registry. [Client installation](https://tiptap.dev/docs/ai/ai-toolkit/client/install).
- Both toolkits are currently described as paid add-ons in beta. AI model choice remains ours. [Client overview](https://tiptap.dev/docs/ai/ai-toolkit/client/overview).
- Local suggestions have preview-before-apply and review-after-apply modes. Persisted collaborative Tracked Changes is a separately sold product. [Review modes](https://tiptap.dev/docs/ai/ai-toolkit/client/agents/review-changes).
- The old client `diffUtility` is deprecated in favor of Tiptap Compare. Do not start a new integration around the deprecated API. [Diff utility notice](https://tiptap.dev/docs/ai/ai-toolkit/client/api-reference/diff-utility).

### Fit for TraceX

For background MCP operations, first evaluate the Server AI Toolkit with inline JSON. The documented `execute-tool` request accepts `{ type: 'inline', content: ... }` and returns the resulting document. This allows an adapter to supply our own stored content without first moving documents to Tiptap Cloud. It still calls the toolkit service. Our adapter must handle authorization, QMS rules and atomic persistence/conflicts in our collaborator; Cloud-document conflict guarantees cannot be assumed for our independent storage. Inline mode has limitations, including no streaming endpoint support and no `getThreads`/`editThreads`. [REST contract](https://tiptap.dev/docs/ai/ai-toolkit/api-reference/rest-api).

For an assistant inside the open editor, the client toolkit is a closer execution fit: model-generated tool calls are applied through `toolkit.executeTool(...)`. Its experimental `beforeOperation` hook can inspect/reject operations or alter inserted fragments, providing an integration point for application-specific protection rules. Browser-side protection remains additional to server authorization. Our existing QMS comment marks are not automatically equivalent to Tiptap's Comments product. [Execution](https://tiptap.dev/docs/ai/ai-toolkit/client/api-reference/execute-tool), [edit hooks](https://tiptap.dev/docs/ai/ai-toolkit/client/advanced-guides/tiptap-edit-hooks), [comment tool requirements](https://tiptap.dev/docs/ai/ai-toolkit/client/agents/tools).

General editor collaboration still accepts an existing `Y.Doc` or `Y.XmlFragment`; upgrading the editor does not inherently require moving to Tiptap Cloud. This does not certify compatibility of every paid AI feature with our Hocuspocus integration. [Collaboration extension](https://tiptap.dev/docs/editor/extensions/functionality/collaboration).

### Migration scope and decision

Our source declares Tiptap 2.11.x in seven package manifests, including shared text, editor resources and the collaborator server. The official v3 migration changes table/list imports, history naming, collaboration cursor naming, menu positioning, command signatures/update events and `getPos()` types. These APIs appear in our implementation; this is a cross-package migration. [Upgrade guide](https://tiptap.dev/docs/guides/upgrade-tiptap-v2), [shared text dependencies](../foundations/core/packages/text/package.json), [editor dependencies](../plugins/text-editor-resources/package.json), [collaborator dependencies](../server/collaborator/package.json).

Recommended sequence: obtain toolkit access, exercise a minimal Tiptap 3 editor with representative TraceX nodes/marks, verify editor-context fidelity and preservation of comments/references/tables, and exercise simultaneous edits through our collaborator adapter. If that succeeds, target a supported v3 release satisfying the chosen toolkit, migrate the shared schema/editor/server packages together, and replace the provisional content tools with the vendor integration. Keep domain lifecycle tools in TraceX.

This recommendation supersedes starting with a custom editing protocol as the default: evaluate the existing vendor execution layer first. No dependency migration or executable prototype was performed during this follow-up.
