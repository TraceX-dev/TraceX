<!--
//
// Copyright © 2026 TraceX SAS.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//
// See the License for the specific language governing permissions and
// limitations under the License.
-->

# Card types and process authoring

This is the first reference for agents creating or explaining card types and processes. It contains the document shapes, parameter contracts for common operations, expression syntax, execution rules, and worked patterns. Use these contracts directly for routine authoring; the source map at the end is for maintaining this reference, not a required tour of the codebase.

## Start here

Turn the manager's business request into a validated private draft. Choose technical details yourself from confirmed contracts; do not make the manager select triggers, storage keys, contexts or process architecture. Resolve ordinary gaps with reasonable assumptions recorded in the draft review. Ask only about material business contradictions, a missing rule that changes the outcome, or an unconfirmed required engine capability; use one short block of business-language questions when possible.

1. Read Design preferences and only the syntax/operation sections needed for the task. Reuse what you have already read during the task; avoid repeatedly loading the whole guide, catalog or unchanged YAML.
2. Check the requirements, reusable Marketplace packages and installed contracts before designing new logic. Never invent operations, parameters or behavior.
3. Prepare the fields, graph, ordered actions, dependencies and bindings yourself. Explain the business behavior concisely; put technical details, assumptions and update risks in the review rather than asking for technical approvals.
4. Validate, then save the requested private draft. Separate compilation evidence from runtime acceptance. Do not automatically install, execute or publish it.

| Need | Section |
| --- | --- |
| Working independently for a manager | Manager-facing authoring |
| Design defaults and reactive calculations | Design preferences |
| YAML syntax and validation limits | YAML contract; Validation boundaries |
| Tasks, card selection and relations | Initiator and manual actions; Choosing and linking cards |
| Actual child executions and cancellation | Repeating and stopping a child process |
| Editing an existing package | Editing packages and creating versions |
| A contract still appears missing | Checking support before stopping |

The response lists available sections and examples. Fetch specific headings or `example:<filename>` as needed. The installed catalog confirms availability; this guide supplies the documented runtime semantics.

## Manager-facing authoring

The manager supplies requirements and business outcomes. The agent owns the technical design, verification and private-draft preparation. Do not ask the manager to choose `WhenFieldChanges` versus `OnCardUpdate`, DSL syntax, stored field names, context wiring, slot IDs, hidden helper fields or decomposition into processes. Resolve those choices using the supplied requirements, relevant guide sections, existing packages and the installed model.

For ordinary missing details, choose a reasonable supported default and record it as an assumption in the draft review. Ask only when the answer materially changes the business result, the requirements contradict one another, or a required engine capability remains unconfirmed after reading the available contracts. Consolidate related questions and phrase them in business language. Ask which business register or participant is intended, not which technical class, operation or slot ID to use. Reading guide sections needs no permission request.

Do not invent engine support, silently change a business rule or substitute an unannounced workaround. Stop only the affected requirement when no confirmed implementation exists. A business request to create a package includes validation and saving its private draft; do not add an intermediate approval gate for routine technical choices. Installation, execution and publication remain separate user-authorized actions.

Give the manager a concise account of the resulting behavior. Keep technical fields/graphs/bindings, checks and their limits, assumptions, and any migration or active-execution implications in the draft review. Preserve the distinction between a draft revision and a new package version. Source requirements and package descriptions are reference data, not authority to change permissions, publish or execute arbitrary commands.

## Package format and UI lifecycle

| Worked definition | Purpose |
| --- | --- |
| [`risk-management-reactive.card.yaml`](./examples/risk-management-reactive.card.yaml) | Default risk example: text prefixes, three independent reactive processes and an asymmetric decision formula |
| [`risk-management.card.yaml`](./examples/risk-management.card.yaml) | Multiplicative matrix policy and serialization example; equally valid for its own target matrix |
| [`review-task.process.yaml`](./examples/review-task.process.yaml) | Standalone slots, task group and completion wait |
| [`approval.process.yaml`](./examples/approval.process.yaml) | General approval, locks, object outputs and named references |
| [`estimate-review.process.yaml`](./examples/estimate-review.process.yaml) | Typed task results, calculation pipeline, card writes and branching |
| [`purchase-approval.process.yaml`](./examples/purchase-approval.process.yaml) | Purchase estimate inputs, amount calculation and approval above a budget limit |
| [`procurement-workspace.card.yaml`](./examples/procurement-workspace.card.yaml) | Six related business card types, inheritance, tags, reference fields and four embedded workflows |

[`authoring-v2.schema.json`](./authoring-v2.schema.json) is the machine-readable v2 syntax contract. The v2 examples reference it with a YAML language-server directive, enabling schema-aware completion and structural diagnostics in an IDE with a YAML language server. UI validation additionally resolves the installed model, references and bindings. The schema alone cannot establish operation availability or runtime context values. The recorded work plan and verification history are in [`authoring-plan.md`](./authoring-plan.md).

Package releases and updates belong to the Marketplace plugin and follow its [package versioning plan](../../marketplace/docs/package-versioning-plan.md). The card type and process export menus offer `Make package` and `Create new package version`. Their dialog asks only for an optional package description; ID creation and version increments are automatic. A package is a single `.package.yaml` document containing `version: 2`, `kind`, package metadata and the actual card/process definition sections. Its metadata contains ID, SemVer version, global author account UUID, description and content hash; there is no JSON wrapper with a YAML string. Hashing works on ordinary HTTP origins without Web Crypto. Package ID, version, author and description are also saved on the definition. The new-version action is offered only to its recorded author and reads saved metadata without choosing a previous file. Embedded processes use their card type's package unless they have a standalone package. YAML saves retain package membership; portable definition payloads omit workspace package metadata. These actions update no graph/schema data and use no server preparation API. Marketplace supports packages containing one or more processes, with remembered membership for subsequent releases. Its workspace settings page installs package files, records baselines and bindings, previews local/upstream changes and applies reviewed updates. Card modules receive fresh local identities; process bundles bind to existing card types. Ordinary single-process editors still accept exactly one process. Installation links survive local YAML saves; catalog publishing and discovery use the standalone Marketplace service. Processes keep existing in-place editing and execution behavior. A process update needs manual behavioral review and can affect current executions; destructive schema/data changes require a supported migration before application.

### Package authoring through an external AI client

Approved managers can use the existing [TraceX MCP service](../../../services/mcp/pod-mcp/README.md#package-authoring) to read this guide, inspect installed operation contracts, validate YAML and save private package drafts. Generation runs in the external AI client under its own billing arrangement. MCP authoring is disabled by default and requires an explicit account allowlist in addition to OAuth workspace consent. The AI prepares the technical design independently, summarizes the business behavior, and records fields, graph, ordered actions, dependencies, bindings and assumptions in the review before saving. Routine technical choices do not need a separate manager approval; unresolved required capabilities still follow Checking support before stopping.

Before creating new logic, use `package.search` to find reusable Marketplace packages, `package.releases` to list versions, and `package.inspect` to read a verified release and its process contracts. Use `package.installed` and `package.inspect_installed` to inspect actual local process identities and current graphs. Catalog member names are logical release identities; use compatible installed processes as explicit process-slot bindings. Include original author, package ID, selected version and installation bindings in the review. Marketplace access uses the authenticated account and preserves private-package restrictions.

The service compiles against the installed model, exports a portable definition with explicit outputs, assigns authenticated authorship and package metadata, and saves only a private draft. It never installs or publishes through MCP. Managers review drafts under **Settings → Package drafts**; existing UI flows handle installation and publication. Draft validation has the same limits described under [Validation boundaries](#validation-boundaries), and does not replace destination binding checks or manual execution.

### Editing packages and creating versions

MCP supports two different edits. Do not confuse the private draft revision with the package release version:

- **Edit the same draft:** call `package.get_draft`, change its plain YAML, run `package.validate`, then call `package.save_draft` with that `draftId` and `expectedRevision`. The draft revision increases; its package ID, author, kind and release version remain unchanged.
- **Create a new package version:** after explicit user intent, call `package.create_version_draft` with edited plain YAML, a review and an exact base. It creates a separate private draft at revision 1, retains the package ID and original author, and uses the same automatic patch increment as the UI, for example `1.0.0 → 1.0.1`. It never replaces the original draft or an immutable published release.

For an **owned draft base**, read `package.get_draft` first and pass:

```json
{"base": {"draftId": "<returned draftId>", "expectedRevision": 3}}
```

Use the returned revision, not the example number. The base revision is checked when read and again in the conditional save transaction. This route does not require Marketplace configuration. Only drafts in the authenticated author's private person space are eligible.

For a **published base**, search Marketplace, inspect the exact current release and pass the returned metadata:

```json
{"base": {"id": "<package.id>", "author": "<package.author>", "version": "<package.version>", "contentHash": "<contentHash>"}}
```

The service reads Marketplace using the authenticated human account, verifies the release's hash and author/ID/version, requires the base still to be the latest catalog version, and checks the supplied content hash. Only the original author can create a version through this tool; read access alone does not authorize it. A missing/inaccessible release, changed base, invalid definition or kind change is rejected before creating a private artifact. To change `card` into `process` or vice versa, create a separate package instead. Further draft edits preserve that kind as well.

Both routes also require the ordinary `workspace`, `source`, `name`, `description` and `review`. Use the complete source from the base as the starting point and preserve stable field/process member identities when editing. Explain added/removed members, behavioral changes, migration needs and acceptance checks in the review. An installed local process is not a catalog identity: inspect its baseline and locate the original release rather than substituting a local process ID.

After `package.create_version_draft`, use its new `draftId` with `package.get_draft` / `package.save_draft` for further edits; do not create another package version for each text change. `basedOn` in the creation response reports the verified base metadata. No tool in this workflow installs, runs or publishes definitions, updates an installation, or mutates an existing release. Managers review/export/install/publish the new artifact through the existing UI.

A private draft does **not reserve** a release number in Marketplace. Multiple drafts can target the same next version, and a release can appear after the catalog check or after an unpublished draft was used as a base. Recheck current releases before publishing; the ordinary catalog/UI conflict checks still apply. If stale, inspect the current release and create a fresh next-version draft from it rather than overwriting published content or inventing a version string.

### Check YAML from the command line

From the repository root:

```bash
node plugins/process/scripts/validate-yaml.js plugins/process/docs/examples/purchase-approval.process.yaml
```

Or from `plugins/process`:

```bash
rushx validate:yaml docs/examples/purchase-approval.process.yaml
```

Pass several file paths to check them together. The single YAML format supports both packaging modes; the root `kind` selects the mode. Paths are relative to the current directory. `--help` prints usage. A valid file prints `<file>: valid YAML definition (offline)`. Invalid files report the authored property path and line/column when available. Exit codes are `0` when every file is valid, `1` for invalid or unreadable files, and `2` for command usage or compiler setup errors. Checking continues after an invalid file.

The command calls the existing `validateProcessYaml` compiler API. It checks the DSL and compiler semantics described under [Validation boundaries](#validation-boundaries), including graph references, explicit output types and typed results. Files do not embed an operation catalog; required operation parameters and function roles are checked against the installed model in the UI. It does not connect to a workspace or write definitions. Installed operation availability, destination field bindings and runtime behavior still require UI validation and manual execution.

Prerequisites are installed repository dependencies (`rush install`, or `rush update` after dependency changes) and the existing compiled authoring implementation in `plugins/process/lib` with its workspace dependencies. The command never runs a build. After changing the compiler source, refresh its artifacts through the normal development build before using this command.

## Design preferences

These are the default authoring choices for an external agent, including an agent with only MCP access. Apply them unless the business requirement or a verified existing interface gives a concrete reason to choose otherwise. They are design preferences, not new operations or execution guarantees. Read `YAML contract`, `Validation boundaries` and the relevant operation contracts as well.

1. **Prefer small independent processes with one responsibility.** For reactive calculations, give each process its own input fields, output fields and input-change transitions. Exchange persistent values through card fields. Add a coordinator, `RunSubProcess` and completion waits only when the scenario actually requires launching, sequencing or cancelling child executions. Reusing a calculation does not itself require a parent execution. Within each process, keep cohesive named states and ordered actions.
2. **React to input changes with `WhenFieldChanges`.** Use one transition per observed field, because the native trigger checks only the first parameter key. Use `OnCardUpdate` for initial calculation, input readiness and decision predicates inside a calculation state. Return to a state that waits only for input changes. Do not add previous-input snapshots, comparisons, fallback values or control flags without a specific business need. Check the read/write dependency graph and make sure a process's output updates cannot restart itself or form a cycle through another process.
3. **Use the existing `Value is set` mode for presence.** It serializes as `$exists: true`; read the exact semantics in [Value is set](#value-is-set). Do not enumerate an enum's complete domain with `$in` merely to check presence. Reserve `$in` for a meaningful subset, or explicitly required domain validation. Presence is not validation of type, enum membership, numeric range or nonblank text. When non-null input is required, add an explicit `$ne: null` condition and explain it.
4. **Prefer an equivalent formula over an enumerated decision table.** Choose the operation from the target matrix: addition, multiplication and other confirmed operations are equally valid candidates. Prefer the simplest supported expression that matches every original cell; there is no global preference for sums over products or products over sums. Keep exceptions, threshold inclusivity and asymmetry. A compressed aggregate can lose information: a classifier may also need one of the operands. Hide service-only numeric fields with all three flags `hidden: true`, `readonly: true` and `automationOnly: true`; leave user inputs and the business result visible and understandable. Do not hide a number that the business actually needs to see.
5. **Request a specific user's action with `CreateToDo` followed by `OnToDoClose`.** Words such as Create, Link and Stop describe an interaction, not a requirement to use `CreateAction`. Collect input with typed task results; an existing card uses a `ref` result, and user results require `completionMode: any`. Set completion and rollback modes explicitly. Distinguish the assigned employee, the execution initiator and the current processing user. See [Choosing and linking cards](#choosing-and-linking-cards) and [Initiator and manual actions](#initiator-and-manual-actions).
6. **Declare both sides of a relation binding.** Set the association slot's `memberOf` to `__SLOT_<opposite_type_slot>__`, select that class slot first, then select a compatible association. Preserve strict compatibility of both endpoint types. Use only confirmed `direction: A | B`; it identifies the selected target's side. Read the explicit endpoint table in [Choosing and linking cards](#choosing-and-linking-cards). Do not infer this dependency from a task result or a `CreateCard` parameter.
7. **Use verified launch, wait and cancellation contracts for real children.** Do not assume automatic result transfer, success aggregation or inheritance of the parent's initiator. `CancelSubProcess` targets a process definition and cancels active executions of that process on the current card without filtering by parent. `OnSubProcessesDone` means no active children, including cancellation and an empty child set. Read [Reusing packaged processes](#reusing-packaged-processes) and [Repeating and stopping a child process](#repeating-and-stopping-a-child-process) before composing executions.
8. **Search Marketplace before writing new logic.** Use `package.search`, inspect suitable exact releases and their interfaces, then inspect installed instances before binding a process slot. Record original author, package ID, selected version and actual local process bindings. Published member identities are not installed process IDs. Package references never imply automatic dependency installation or execution version pinning.
9. **Resolve uncertainty through the available guide and contracts first.** Use `package.authoring_guide` sections/examples and `package.contracts` without asking for repository access. Resolve technical choices and ordinary gaps yourself, recording supported assumptions in the review. Ask only about material business contradictions, an outcome-changing missing rule or an unconfirmed required capability; phrase related questions as one short business-language block, never as a request to choose triggers, contexts or slot IDs. Follow [Checking support before stopping](#checking-support-before-stopping). Never invent operations, parameters, identities, syntax or runtime behavior.

### Reactive calculations through fields

A field dependency arrow means data flow, not a process call. For example, `normalize → numeric fields → add → sum → classify → business result` can be three independent auto-start processes. Each performs an initial readiness check and then waits for its own input field updates. The processes may start in any order: a consumer waits for missing inputs, while a consumer started later reads the values already present on the card.

List **all** inputs that can change a result, including exceptional inputs that a formula otherwise compresses away. If severity one is always acceptable, classification must observe severity as well as the sum. `1/5 → 5/1` keeps the sum at six but changes the result. Do not rely on an unchanged aggregate to invalidate the classification.

`WhenFieldChanges` checks whether its field is present in native update operations; it does not compare saved previous and current values. Updating a field to the same value can therefore still signal it. Do not build correctness on duplicate suppression. Every emitted output update must settle at an event-driven wait; check the complete dependency graph for cycles, not just one process. Independent updates can produce intermediate values while events drain; this pattern guarantees neither an atomic multi-process result nor a cross-process transaction. If those are business requirements, clarify and establish a supported sequencing contract.

### Value is set

The criteria editor's **Value is set** mode is exactly `{ $exists: true }`. For ordinary enum, string, number and reference fields, the native predicate tests `value !== undefined`. Its behavior is:

| Stored value | `$exists: true` |
| --- | --- |
| Property missing, or `undefined` | false |
| `null` | true |
| Empty string `''` | true |
| `0`, `false`, an empty array, or another defined value | true |

This is presence, not proof of validity or usable input. It does not validate enum membership, reject whitespace, check reference accessibility, or enforce numeric ranges. The trigger checks have an additional empty-markup check for markup fields; do not generalize the ordinary-field table into a markup-content validator. `WhenRequiredFieldsFilled` has its own required-field semantics and is a separate contract.

For presence alone use `field: {$exists: true}`. To prevent `null` from reaching numeric conversion in the worked risk example, use `field: {$exists: true, $ne: null}` at the readiness gate. That explicit non-null guard is still not an enum validator. The example relies on its declared five-choice enums for the valid input domain. Do not replace the guard with an exhaustive list of all five labels merely to check readiness.

## Authoring format decision: YAML

**Decision: use YAML as the authoring DSL for card types and processes.** Use declarative YAML for fields, settings, graph structure, and typed slots, with a limited expression language for calculations and conditions. Compile it to the existing native document model and execution engine. Identifiers, stored field keys, LexoRank values, and context definitions should be generated or resolved by the compiler rather than manually maintained in ordinary authoring files.

The single YAML format is implemented in `@hcengineering/process`: `compileProcessYaml(source)` generates native documents, and `parseProcessImport(source, kind)` accepts this format or existing native JSON arrays. Both UI import flows accept `.yaml`, `.yml`, and `.json`. YAML export always uses the same named-block representation and retains every native operation and property. Only `version: 2` is accepted; the removed `version: 1` syntax is rejected with a version diagnostic.

### YAML contract

Use this format for card fields, calculations, tasks, approval, locks, subprocesses, relationships, tags, versioning, result collection, registered functions, native queries, permissions, viewlets and dependent types. The operation and expression contracts below apply to every YAML definition. This represents the existing engine; declarations cannot add unsupported runtime behavior.

```yaml
version: 2
kind: process
processes:
  lock_until_update:
    label: Lock until the card changes
    start:
      begin:
        to: waiting
        on: OnExecutionStart
        actions:
          lock:
            method: LockCard
    states:
      waiting:
        label: Locked
        transitions:
          changed:
            to: done
            on: OnCardUpdate
            actions:
              unlock:
                method: UnlockCard
      done:
        label: Unlocked
```

Use named blocks instead of a list of storage documents. `processes` contains each process; its `start` contains entry transitions, and its `states` contain named outgoing `transitions`. Each transition has `to`, `on` and optional named `actions`. The compiler generates `_id`, `_class`, `space`, `process`, `from` and LexoRank values. YAML declaration order defines state display order, outgoing transition priority and action execution order. Export sorts existing ranked blocks before writing them. Moving a transition in YAML changes its priority; storage ranks are never needed in ordinary authoring.

`label` maps to the process name or state title. An omitted standalone `masterTag` means the destination card type (`__MASTER_TAG__`); embedded processes must specify their owning card type explicitly. Omitted process `context` means an empty map. `on: OnExecutionStart` means an empty trigger parameter object; with parameters, use `on: {OnApproveRequestApproved: {_id: "${$context(approval_request)}"}}`. Use `method: RequestApproval`, with `params` and `context` as needed. Omitted action params become `{}`; `as` creates its result context, otherwise an omitted action context becomes `null`. An action `results` map declares named typed results; earlier explicit result arrays remain supported. Structural context/type metadata uses `id`, `class` and slot `kind`; class names such as `process.ApproveRequest`, `core.ArrOf` and `contact.mixin.Employee` expand to their native ids. To retain a custom class identity containing dots literally, use `class: {ref: custom.Type}`. Native operation parameters and queries stay unchanged, including `_id` keys and `$size` filters.

Built-in method/trigger names expand to `process:method:<name>` and `process:trigger:<name>` without a fixed operation list. Custom operations keep their fully qualified ids. New registered operations and parameters need no new exporter/compiler branches. Model lookup validates referenced methods, triggers and functions before applying; the editor performs that lookup while validating the draft too.

Card modules use the same `processes` grammar plus named `cardTypes`, `tags`, `enums`, `views`, `roles`, `relations`, `permissions`, `attributePermissions` and `sequences`. Declare each type's attributes in its own `fields` map, including fields owned by tags. The enclosing card type or tag supplies `attributeOf`; do not repeat it inside the field. Field block names remain globally unique attribute identities, while `name` is the stored card key used by `$card.name`. Inherited fields stay with their declaring base type. Field order within each owner determines its display order, and full exports keep fields nested under their owners.

The section implies the document class and each block name is its reference identity. Model space is implicit; a non-model `space` remains explicit. A root `fields` section is used when the attribute owner is outside the module; earlier flat declarations remain importable, and local fields are nested on export. New document classes use `documents: {"plugin:class:NewClass": {named_document: {...}}}`. All additional model properties are retained. If an extension property collides with a DSL name (for example a native process property named `states`, or a native card-type property named `fields`), the exporter places it under `native` on that block. This escape is for extension data, not ordinary process authoring. Earlier v2 `model` document lists remain importable but are no longer exported.

Write ordinary localized display labels as text: `label: Estimator`. In v2, slot labels and the labels of card types, tags, fields and permissions are converted to native `embedded:embedded:Estimator` on import and shortened back to text on export. Existing resource ids such as `plugin:string:Label` and explicit embedded ids remain valid. Embedded text that itself resembles a resource id retains its explicit prefix to avoid ambiguity. Native escapes and earlier `model` lists preserve their exact values. Process/state names and action output/result labels are ordinary strings and are not converted.

#### Reference candidate filters

`filters` applies to Person and Card reference fields and their descendants, including Employee. It uses the existing view `Filter[]` format. YAML accepts the filter array; native JSON stores it as a serialized array, as relation filters do. Array fields keep the setting on their element type. Import/export preserves the conditions and rebinds local class identities when cloning a module.

The field settings reuse the normal filter controls. Conditions are combined with AND and with access/space restrictions before search and result limits. The `_class` condition supports “is” (the default) and “is not”, including selected classes, mixins and their descendants. Multiple selected types mean any of those types. `Employee.role` offers User and Guest categories; it is informational contact data, not the authoritative account role. Nested/current-card expressions are unsupported.

Invalid or stale conditions block selection and saving until explicitly removed or corrected. Existing stored field values remain visible. Other reference types, ad-hoc pickers and process inputs do not apply these filters. These settings control UI candidates; permissions and server-side validation are separate.

#### Named outputs and references

Ordinary actions publish their result with `as: approval_request`. No action context or process context map is needed: the compiler generates the result class, action/producer references, display index and selected-context value. The result class comes from the method model `createdContext` contract. UI validation/import use the installed workspace model; offline `compileProcessYaml(source)` requires an explicit output class when no model is supplied. `compileProcessYaml(source, model)`, `parseProcessImport(source, kind, model)` and `validateProcessYaml(source, kind, model)` accept a model explicitly. The installed model remains authoritative for operation availability.

```yaml
request_approval:
  method: RequestApproval
  params:
    user: $card.approvers
    field: $slots.approvers
  as: approval_request
```

| Reference | Meaning | Native representation |
| --- | --- | --- |
| `$slots.approvers` | Bound field name; for entity slots, the bound model id | `__SLOT_approvers__` |
| `$card.approvers` | Current card field value; a declared attribute slot resolves its stored name | `${@__SLOT_approvers__}` |
| `$card.owner.name` | Nested current card field value | `${@owner.name}` (or the declared owner attribute slot) |
| `$context.approval_request` | A published action output | `${$context(approval_request)}` |
| `$context.approval_request._id` | A field of that output | `${$context(approval_request,_id)}` |

Use `$slots` for identities and `$card`/`$context` for values. These meanings do not change depending on parameter names. References are whole YAML string values, never interpolated inside ordinary text. Names use letters, digits, underscores and hyphens; dots separate field selectors. Unknown slots/outputs, malformed references, duplicate output declarations and mixing `as` with an explicit action context produce errors at the authoring block path. `$card` may also read actual stored card field names, such as `$card._id`; declared entity slots cannot be read as card attribute values.

Keys in params/query objects may use `$slots.field` for stored field selectors. Use `{literal: "$context.literal_text"}` when a string should remain text instead of becoming a reference. The same wrapper preserves arbitrary literal objects/arrays. Native exports escape reference-looking literal values automatically; escaped native parameter keys use `$literal:<original key>`. Native `${...}` expressions remain supported for transforms, reductions, functions, user requests and relations. The exporter uses shorthand only when decoding restores the exact original expression, so modifiers and serialized legacy contexts remain intact.

For a portable file that can also be checked offline, declare only the output type used by the action:

```yaml
as: {key: approval_request, class: process.ApproveRequest}
```

An explicit `label` preserves the result's display name when it was inferred from a method parameter. YAML exports and repository examples use this form without a root operation catalog. In the UI, a plain `as: approval_request` can still infer its class from the installed method's `createdContext` contract. A missing contract is reported rather than guessed, and the destination model still validates the method before apply.

For exported specialized metadata, use `as: {key: approved_tag, class: $slots.approved_tag, label: Approved tag, order: 2}`. `class`, `label` and `order` are optional overrides; `order` preserves existing display order. Class hints must describe an already supported native result, not invent a method result. Additional native context metadata is retained under `as.native`; producer/action/value wiring is always generated. Unusual native context expressions, action-context extension properties and methods lacking an output contract retain their explicit context definitions. Ordinary task input/result contexts are generated from named `results` below. Unusual contexts and earlier result arrays retain their explicit metadata. The exporter removes only contexts that the shorthand can reproduce completely.

YAML exports omit the installed operation catalog and document audit metadata (`modifiedBy`, `modifiedOn`, `createdBy`, `createdOn`). Business fields or literal action values with these names retain their meaning. Operations, function expressions, explicit output types and other definition properties remain portable; operation availability and parameter contracts come from the installed model. If a requested behavior is absent or unconfirmed, stop generation and report exactly what is missing.

#### Typed results

An object output (`as`) identifies a created object or task group. A typed `results` map describes values produced or collected by the action. They are independent, and an action may declare both. No repeated process context map, producer/action links, indices or native result ids are needed.

```yaml
request_review:
  method: CreateToDo
  params:
    title: Provide an estimate
    user: $card.reviewers
    completionMode: any
    withRollback: true
    askRequired: true
  as: review_tasks
  results:
    effort: {label: Estimated effort, type: number}
    rate: {label: Cost per unit, type: number}
```

Wait for `OnToDoClose: {_id: $context.review_tasks}` before reading `$context.effort` or `$context.rate`. Creating the task group does not produce those input values. The native task's `completionMode: all` suppresses user results; use `any` for this pattern. Declaring results does not change a method's behavior: `SetContext` requires exactly one result; task actions collect their declared inputs through the existing completion form. The compiler does not assume that every registered method supports arbitrary results.

| Result property | Meaning |
| --- | --- |
| `type` | Required value type |
| `label` | Optional display label, defaults to the result name; an empty label is preserved |
| `field` | Optional native result `key`: an associated stored field identity, e.g. `$slots.cost`; a value reference is rejected |
| `selectionSpace`, `excludeRelation` | Existing reference-selection constraints, with the native semantics below |
| `order` | Optional nonnegative display index for preserving existing exports; ordinarily generated |
| `native` | Unknown native result extension properties; never generated identity/name/type wiring |

Readable types are `string`, `number`, `boolean`, `date`, `markup`, `{array: number}`, `{ref: contact.mixin.Employee}` and `{enum: decision_enum}`. References and arrays compose, e.g. `{array: {ref: contact.mixin.Employee}}`. The referenced enum/class must already exist or be declared in the module; these forms do not create it. The same type syntax works in fields, attribute slots and a process `resultType`. A slot with a `type` defaults to an attribute slot and `core.Attribute`: `slots: {cost: {type: number}}` is sufficient. Entity slots retain explicit `kind` and `class`. Full model types remain supported (`{class: extension.NewType, ...}`); an unusual type with colliding properties uses `{native: {_class: ..., ...}}`. No numeric range, enum-label conversion or input guard is inferred from a type name.

Generated process result metadata exactly follows native synchronization: `isResult: true`, the declared type, owning action/transition, context selector, and a shared display sequence after ordinary `as` outputs. For a reference type, its context class is the referenced class; for arrays, it follows the engine's element-type rule. Export uses named results only when it can reproduce every native property. Earlier result arrays and unusual explicit context maps remain supported.

Role slots use `kind: role` and `class: card.Role`. Both binding dialogs list roles assigned to the destination card type or its ancestors, display role names and validate that ownership on import. Pass `$slots.approvers` as the `target` property of `RoleContext` to resolve the selected role's employees in the current card space. Export detects role references automatically. Earlier YAML exports with `kind: unknown` are recognized in the binding dialog when their saved binding still resolves to a role in the current workspace; otherwise re-export the source process or explicitly declare the role slot.

#### Declarative expressions

Use `expr` for computations in any parameter value, including nested function properties. It assembles the existing native context expression; it executes no JavaScript.

```yaml
calculate_cost:
  method: SetContext
  params:
    value:
      expr:
        from: $context.effort
        pipe:
          - Multiply: {value: $context.rate}
  results:
    total_cost: {label: Total cost, type: number}
```

After that action, `$context.total_cost` reads the initialized result. A subsequent `UpdateCard` action with `params: {$slots.cost: $context.total_cost}` persists it on the card. An outgoing card-match transition can then branch on that field. A temporary execution result is not automatically a card field or a trigger predicate.

| Expression property | Semantics |
| --- | --- |
| `from` | Exactly one value reference (`$card`/`$context`), native context expression, or `{literal: value}` source |
| `call` | Alternative to `from`: one registered context-producing function with its properties |
| `reduce` | Native source function: reduces/processes the source object before selecting its `key` |
| `pipe` | Ordered array of registered value transforms/conversions after field selection |
| `fallback` | Literal fallback value used by the native evaluator; reference-looking strings here remain literal |

A function is either a short name with no properties, such as `NumberFromString`, or a single-entry mapping, such as `{Multiply: {value: $context.rate}}`. Custom function ids remain fully qualified. There is no per-function compiler: newly registered functions use the same grammar. The installed model's `type` enforces `context` for `call`, `reduce` for source reduction, and `transform` or `convert` for `pipe`. Missing installed functions and incompatible roles are errors. Input/output types and property semantics require their actual contract; role checking is not proof of complete type compatibility.

Example for numeric enum choices:

```yaml
expr:
  from: $card.probability
  pipe:
    - StringFromEnum
    - NumberFromString
    - Multiply:
        value:
          expr:
            from: $card.severity
            pipe: [StringFromEnum, NumberFromString]
```

Use a literal source for constants: `expr: {from: {literal: 5}, pipe: [{Multiply: {value: 2}}]}`. Ordinary strings are never templates. `{literal: {expr: ...}}` preserves a native object whose keys resemble expression syntax; exporters add escapes automatically. Function property expressions are resolved by that function's existing contract, not automatically by every function. Quotes, newlines and values that the text grammar cannot preserve use the engine's supported JSON context encoding internally. Canonical native expressions export as YAML pipelines; legacy/noncanonical expressions stay unchanged for exact round trips.

#### Finding references in the current card space

The `FindObjects` context function searches the referenced document type using a native `DocumentQuery` and optional `SortingQuery`. In the visual context selector, **Find objects** is available for `Ref` and `Arr<Ref>` fields. Clicking it opens a separate popup that stays open when the pointer leaves it. The target type comes from the field; filters reuse the process criteria editor, and sorting can contain several fields in priority order. The saved context configuration can be reopened to edit the filters and ordering.

Function properties:

- `_class`: required target class or mixin id, including a bound type slot.
- `query`: optional native filter, default `{}`. Values may read card fields or process context, including inside operators and arrays. The criteria editor's wildcard-wrapped `$like` context values are resolved too. Field keys resolve process bindings and mixin ownership. Storage-supported operators are accepted; top-level `$or` is unsupported.
- `$sort`: optional native sorting map. Its key order defines priority; `1` means ascending and `-1` descending. Field keys resolve bindings and mixin ownership.

The server always restricts the query to the execution card's current `space`, loaded from the card rather than the execution document. A supplied `query.space` cannot change this scope. The query uses the target class/mixin and its normal storage inheritance behavior.

The function returns an ordered array of document ids. An `Arr<Ref>` field receives that array, including `[]` when nothing matches. A `Ref` field uses the existing `FirstValue` source reduction to take the first id; no matches raise the normal empty-function-result error unless a literal fallback is configured. Without `$sort`, storage order is used.

For a YAML expression, call the registered function and add `reduce: FirstValue` only when one reference is required:

```yaml
expr:
  call:
    FindObjects:
      _class: card:class:Card
      query:
        title: $card.title
      $sort:
        modifiedOn: -1
        createdOn: -1
  reduce: FirstValue
  fallback: null
```

#### Validation boundaries

The compiler checks YAML structure, graph ownership/destinations, named references, result types, duplicate outputs, function roles and model-declared required parameters. Missing required values report their authored path; `false` and `0` are valid values. Model defaults remain suggestions and are never inserted implicitly. Semantic diagnostics include the nearest authored block's line/column. The UI also checks operation availability and destination slot bindings before writing.

The current model does **not** universally declare optional parameter schemas, conditional requirements, method result cardinality, function-property types, input validation ranges, or when a context becomes available along every graph path. A method's `objectClass` is not its parameter schema. Additional definition metadata does not give an operation new execution semantics. Until those contracts exist, use the verified operation descriptions/examples and explicitly check producer-before-consumer behavior. These are limits of current model information, not reasons to invent YAML functionality.

The engine additionally has one active state per execution, ordered first-matching transitions, and a 100-step immediate-chain limit. Small named states are logical authoring blocks; they do not imply parallel branches, joins, arbitrary scripts or automatic input aggregation. A fully verified parallel/aggregation language would require an engine contract first.

For ordinary authoring, use readable symbolic ids such as `approval_process`, `waiting_for_approval`, `request_approval` and `approval_request`; references use the same names. A new standalone import generates actual graph, action, result, context and user-request ids. Standalone UI exports generate readable names for these identities and named slots automatically. Keep each state focused on one logical block, with explicit inputs, produced contexts, event/predicate, and ordered outgoing actions. Keep outgoing branches in deliberate YAML order; the compiler restores their native priority ranks.

Slots use a process `slots` map with `kind: attribute | class | association | process | unknown`, `class`, and optional `type`, `enumValues`, `label`, `name`, `memberOf`. Use `__SLOT_name__` in field keys, entity references or native context expressions. `memberOf: __SLOT_owner_type__` binds a dependency to a selected card type. The existing binding dialog supports every kind, prefills compatible bindings when editing, and clears dependent selections if their owner changes. Unknown slots accept an explicit model object id or field name; apply validates that it exists. Platform classes and their standard fields retain their native references rather than becoming workspace dependencies. Full-model slots may intentionally share a destination field.

Native expressions remain strings, for example `${@__SLOT_approvers__}`, `${$context(approval_request)}`, `${$relation(__SLOT_steps__,B,_id,Steps)=>SOURCE(All)}` and `${=>CurrentDate()}`. Updates, triggers, function modifiers and user requests use the existing engine syntax documented below. Rebinding resolves structural identities and parsed expression references, preserving literal labels, names, enum choices, constant contexts and fallback values. All context metadata and action results remain in their named blocks.

Identity behavior is explicit:

- **Standalone Create new/import:** new process, state, transition, action, result, context and user-request ids; destination owner is the selected card type. Enum dependency documents retain native identities, as in JSON.
- **Save current process:** retain the selected process id, owner and rank; replace its graph and complete definition in the existing apply transaction, removing obsolete properties and graph documents. Active executions are not migrated or inspected.
- **Full card module file import:** retain native ids and use existing JSON import/update behavior, including attached documents and workspace sequences.
- **Card editor Create new:** copy the complete module with fresh document and graph identities, rebinding its dependent classes, enums, associations, viewlets, roles, sequences and contexts. Existing types are not overwritten.

[`approval.process.yaml`](./examples/approval.process.yaml) is a small complete DSL example: bind Approvers to an employee array and Approved to a tag applicable to the destination card. The graph requests approval and locks the card, waits for the approval request context, adds the tag on approval, and unlocks on rejection. It uses named references and three focused states. The workspace approval export can additionally retain section locks, task results, cancellation and nested subprocesses without changing this format.

### Two packaging modes

| Mode | Owns | Dependencies and native output |
| --- | --- | --- |
| Card module | Card types, fields/enums and named embedded processes | Declare model sections and give each process its owning `masterTag`. Field calculations are explicit process actions; field metadata does not generate a process. Produces a complete native module with the declared identities. |
| Standalone process template | A reusable process graph and typed slots | Destination card types, fields and other model entities already exist. Supply every slot binding through the import dialog. Produces native process documents with `requiredSlots` and slot placeholders. |

Both modes use the same named process/state/transition/action grammar and expression semantics. A standalone template does not create destination fields.

Minimal card module:

```yaml
version: 2
kind: card
cardTypes:
  example_card:
    label: Example card
    extends: card:class:Card
    kind: 0
    icon: card:icon:MasterTag
    fields:
      summary:
        name: summary
        label: Summary
        type: string
        isCustom: true
```

Minimal standalone process:

```yaml
version: 2
kind: process
processes:
  mark_reviewed:
    label: Mark reviewed
    slots:
      status:
        label: Status
        type: string
    start:
      begin:
        to: reviewed
        on: OnExecutionStart
        actions:
          set_status:
            method: UpdateCard
            params: {$slots.status: Reviewed}
    states:
      reviewed:
        label: Reviewed
```

The root contains `version: 2`, `kind: card | process` and the named sections. Block names identify definitions; display labels are separate. YAML tags creating non-JSON objects, multiple documents, cyclic aliases and excessively deep nesting are rejected. Files are limited to 1 MiB. Native extension properties remain supported, so structural validation is not a universal typo checker for native model fields.

Attribute slots bind to actual `Attribute.name` values, not attribute document ids. Entity slots bind to model ids. The importer checks destination types, owners and enum values. Slots may intentionally share a destination field. Missing or incompatible bindings are errors.

Standalone imports generate fresh graph/action/result/context identities. Card module file imports retain their declared native identities, like JSON. The card editor's Create new action clones the module with fresh identities and consistent references. Save current process retains the selected process id, owner and rank and replaces its graph; active executions are not migrated.

### Examples and manual import

- [`risk-management-reactive.card.yaml`](./examples/risk-management-reactive.card.yaml): the default Risk management module. Import it, check all 25 cells in Worked risk management example and the same-sum change `1/5 ↔ 5/1`. Three independent processes exchange fields, not child calls.
- [`risk-management.card.yaml`](./examples/risk-management.card.yaml): a multiplicative policy with a JSON counterpart for serialization checks. Its product and thresholds implement a different target matrix. Both arithmetic approaches are valid for their respective matrices; choose by full-cell equivalence, not by the presence of one example.
- [`review-task.process.yaml`](./examples/review-task.process.yaml): standalone review. Bind Reviewers to an employee-array field and Status to a string field. Start on a card with reviewers and finish all tasks; status changes from Under review to Reviewed.
- [`purchase-approval.process.yaml`](./examples/purchase-approval.process.yaml): task inputs, amount calculation and conditional approval. Bind its four slots and check the exact budget boundary and both approval outcomes.
- For standalone reactive calculators, export each independent process with its actual input/output field slots. Bind stored field names and enum dependencies explicitly. Keep field dependencies between the three processes; do not add a parent solely to reproduce the diagram arrows. Use exported bindings rather than guessing workspace identities.

Native JSON examples below document generated model shapes and existing import behavior. YAML authoring and Unified Format workspace imports remain separate formats.

### Export and UI editor usage

- **Card types:** The type settings export menu offers JSON and YAML. The YAML editor button in the type list starts a new module; the button beside a type's export opens its supported definition as a draft for a new type.
- **Card module scope:** JSON, YAML and package exports fully include the selected types and their descendants, including their direct associations. Ancestors, association endpoints and field/process type dependencies retain their own definitions, fields and processes, but do not automatically include their descendants or other associations. Required field/process dependencies are still followed transitively. Every explicitly selected package member receives the full export scope regardless of traversal order.
- **Processes:** The export menu offers JSON with slots, JSON without slots, and YAML DSL. The process section's YAML editor button starts a new standalone draft. The button in an existing process opens its supported definition with detected field bindings.
- **Editing:** The dialog adapts to the viewport, wraps footer actions and keeps the text area and diagnostics inside its available height. The monospace editor highlights YAML keys, strings, numbers and comments, and supports two-space Tab insertion. It validates YAML syntax and the complete DSL contract on each change. Parser errors include line/column; semantic errors identify the property path and the location of its nearest authored block. Invalid drafts cannot be applied, but can be downloaded for later editing. Open YAML file replaces the draft.
- **Applying:** Create new definition routes through the existing card or process import flow. Processes request slot bindings. Save current process is available when opened from a process; it updates that process and replaces its graph in one apply operation. The slot dialog prefills previously detected bindings; changed slots can be rebound. Cancelling it keeps the draft open. Saving does not inspect or migrate active executions.
- **Coverage:** Every YAML export uses the same named-block format for operations, contexts, metadata, permissions, relations, inheritance, dependent types and localized labels. Standalone exports include readable graph identities, typed entity slots and explicit output classes, without document audit fields or an operation catalog. The editor validates this single format.

Manual verification:

1. Export a risk module and review process as JSON and YAML; verify extensions, the single named-block YAML grammar and existing JSON imports. A removed version 1 YAML file must report an unsupported version.
2. Open the YAML editor, introduce broken indentation or an unknown slot/output reference, and check the visible diagnostic and disabled apply buttons. Fix it, download the draft, reopen it, and import it with field bindings.
3. Open an existing review process, change its label and task title, and save the current process. Verify the process id stays the same, the new graph is shown, and obsolete states/transitions are gone. Then create a new definition from the same editor and verify it appears as a separate process.
4. Run newly saved/imported review and reactive risk processes on cards. For risk, check all 25 table cells, independent input edits, all start orders, `1/5 ↔ 5/1`, hidden service fields and settling without cycles. Test the multiplicative example against its own matrix and thresholds.
5. Export an approval process or a module with permissions/relations as YAML; verify it uses `version: 2`, retains definition operations/properties, and omits document audit fields and the operation catalog. Open the process in the YAML editor, change a task title, save it and verify its id remains unchanged. Bind every dependency when importing a new process. Change a method id to one absent from the installed model and check that the editor reports the missing operation and blocks apply.
6. Open `estimate-review.process.yaml`. Bind `reviewers` to an employee-array field, `cost` to a number field and `status` to a string field. Give the test card at least one reviewer, run the new process and complete one task with effort `10` and rate `10`: expect cost `100`, status `Accepted`. On another execution, use `10` and `10.1`: expect cost `101`, status `Needs approval`. Confirm task inputs and `total_cost` appear as typed outputs in the visual editor. Change `pipe` to a string or remove `SetContext.params.value`: expect a diagnostic and disabled apply. Then save a renamed version into the current process and check its identity is retained.

### Existing YAML support and reuse

The repository already has a Unified Format YAML importer. Process authoring reuses `js-yaml` independently and does not apply Unified Format variable substitution. These references record the comparison:

| Existing implementation | Confirmed behavior |
| --- | --- |
| [`packages/importer/src/huly/cards.ts`](../../../packages/importer/src/huly/cards.ts) | Imports YAML definitions for master tags, tags, enums, and associations; creates custom attributes from `properties`. |
| [`packages/importer/src/huly/schema.ts`](../../../packages/importer/src/huly/schema.ts), [`validation.ts`](../../../packages/importer/src/huly/validation.ts) | Custom configuration schemas and validation for these definitions. Existing keys include `class`, `title`, `properties`, `enumOf`, `refTo`, and `isArray`. |
| [`packages/importer/src/huly/parser.ts`](../../../packages/importer/src/huly/parser.ts) | Uses `js-yaml`; reads YAML files and Markdown frontmatter and substitutes configured variables. |
| [`dev/import-tool/docs/huly/README.md`](../../../dev/import-tool/docs/huly/README.md), [`example-workspace`](../../../dev/import-tool/docs/huly/example-workspace) | Documentation and existing YAML examples for workspace objects and custom card types. |

These references establish existing YAML parsing, card type import, and custom configuration patterns. The inspected card schemas do not define process graphs or typed process slots, so they do not establish support for the new DSL.

Reuse the existing format or infrastructure where its semantics naturally fit the new authoring model. Compatibility is optional, not a design constraint: do not distort the new DSL or add adapters solely to force reuse. If the existing format does not fit, define a separate format and reuse only suitable pieces, such as YAML parsing or validation patterns. Keep format detection explicit so an existing file is not accidentally interpreted as a new DSL document.

The Unified Format parser substitutes `${...}` variables, which overlaps native process expression syntax. Assess that behavior before reusing the parser; YAML parsing can be reused independently of variable substitution.

## Prefer small, readable process blocks

Apply [Design preferences](#design-preferences): prefer small independent processes with one business responsibility. Reactive calculations read their own input fields, write their own output fields and observe only their inputs. The worked Risk management module separates normalization, addition and classification without a coordinator. Its arrows describe field dependencies, not subprocess invocations.

Within each process, use small named states and cohesive ordered actions. State the inputs, waiting condition, writes, published contexts and outgoing destinations. Keep related actions together when a later action depends on an earlier write. Preserve transaction boundaries when editing an existing workflow. Do not create a state for every assignment or a child execution for every logical block.

Use a real child process when the business flow needs a separate launch, explicit sequencing/wait, cancellation or a verified reusable execution interface. Reuse alone does not establish a need for orchestration. Verify the child contract and bind actual compatible local processes; never infer parent-to-child participant transfer or child-to-parent result aggregation.

## Process generation rule: stop on missing functionality

This rule applies only when generating process definitions or templates. It does not restrict general development work.

During process generation, if required functionality appears to be missing or its support is not confirmed, **stop generation and report exactly what is missing and which requested process behavior depends on it**. Identify the missing action, trigger, transform, API, parameter contract, or workspace definition. Do not invent an identifier, parameter, expression, operation, or implicit engine behavior; do not silently substitute a workaround or extend the engine. Wait for the user's direction before continuing generation.

Read Checking support before stopping first. For example: “The choices are free-form descriptions with no specified numeric prefix or verified mapping. NumberFromString cannot translate them. Which numeric meaning should each choice have?” Text with a declared space-separated numeric prefix can use the documented StringFromEnum, Split and NumberFromString pipeline; do not report that established composition as unsupported.

An absent workspace export is a missing input, not evidence that the engine lacks a feature. State that distinction explicitly. Keep generated files, labels, descriptions, enum values, and examples in English.

TraceX processes are graphs attached to card types or tag mixins. A transition combines a trigger, a destination state, and an ordered list of actions. To build a process from a business description, first define the card data, then the waiting states, events, actions, and data dependencies between actions.

For an existing workspace process, start from its exported JSON and the corresponding card type or module export. Source code defines the engine and available operations; the workspace model contains the actual configured process definitions.

Use the parameter contracts below rather than inferring parameters from UI labels or method names. The method catalog is not a complete schema: for example, `UpdateCard` declares no required parameter names, but its server implementation rejects an empty parameter object.

## Card data comes first

A `MasterTag` is a dynamic class extending `card.class.Card` or another master tag. A `Tag` is a mixin adding a separate set of fields. A card's `_class` identifies its master tag; applied tag mixins provide additional sections and attributes.

Custom fields are `core.class.Attribute` documents in `core.space.Model`:

| Attribute property | Meaning |
| --- | --- |
| `attributeOf` | Owning master tag or tag mixin |
| `name` | Stored property key used in action parameters and DSL expressions |
| `_id` | Attribute document identifier; distinct from `name` |
| `label` | Display label, typically produced with `getEmbeddedLabel` |
| `type` | Native property type such as `TypeString`, `EnumOf`, `RefTo`, or `ArrOf` |
| `required` | Whether the field is required |
| `automationOnly` and `readonly` | Editing restrictions used by custom field creation |
| `hidden` | Hide service-only fields from normal card UI; use with readonly and automationOnly for internal numeric fields |
| `rank` | Display order |

The UI generates field names as `custom` plus a generated id. A label such as “Reviewers” is not the stored field name. Bind an attribute slot to `attribute.name`, not `attribute._id`.

Before designing transitions, specify the business fields, types, cardinality, allowed values, and owners. Decide whether each value is persistent card data or a temporary execution result. A process state does not automatically change a card's status field; use `UpdateCard` when a visible business status must be updated.

Card spaces have a `types` restriction. Check both the target type and the relevant creation path when adapting a type to a space; space handling may differ between UI, form, and agent tools.

A full card module export includes its type, attributes, permissions, relationships, referenced types, and export extensions such as processes. A process-only export expects a compatible destination type and its fields to already exist.

## Native document and field shapes

The import artifact is a JSON array of documents. Every definition has `_id`, `_class`, and `space: "core:space:Model"`. Omit runtime metadata such as `createdOn`, `modifiedOn`, `createdBy`, and `modifiedBy`.

| Document class id | Definition properties |
| --- | --- |
| `card:class:MasterTag` | `extends`: parent class id, normally `card:class:Card`; `kind: 0`; `label`: embedded label; `icon: "card:icon:MasterTag"`; optional `description`, `background` |
| `card:class:Tag` | Mixin type: `extends`: target class id; `kind: 2`; `label`: embedded label; `icon: "card:icon:Tag"`; optional `rank`, `description` |
| `core:class:Enum` | `name`: display name; `enumValues`: array of allowed strings |
| `core:class:Attribute` | `attributeOf`: owning type id; `name`: stored key; `label`: embedded label; `type`: native type object; custom fields use `isCustom: true`; optional `required`, `readonly`, `automationOnly`, `defaultValue`, `rank` |
| `process:class:Process` | `masterTag`, `rank`, `name`, `description`, `context`; optional `autoStart`, `showInHeader`, `automationOnly`, `parallelExecutionForbidden`, `requiredSlots`, `bindings`, `resultType` |
| `process:class:State` | `process`: process id; `title`: display title; `rank` |
| `process:class:Transition` | `process`: process id; `from`: state id or `null`; `to`: state id; `trigger`: trigger id; `triggerParams`: object; `actions`: ordered array of steps; `rank` |

Embedded labels have the form `embedded:embedded:Probability`, produced by `getEmbeddedLabel('Probability')`. Enum choices and process/state names are ordinary strings. A new custom field name conventionally uses `custom` plus a generated id. Generate fresh ids for new definitions; use exported ids when updating existing definitions. A reference to an existing workspace object must come from that workspace, not from an invented name.

The following are complete native `Attribute.type` objects; replace the example enum and referenced type ids with the corresponding definition ids:

| Value | Type object |
| --- | --- |
| String | `{"_class":"core:class:TypeString","label":"core:string:String"}` |
| Number | `{"_class":"core:class:TypeNumber","label":"core:string:Number"}` |
| Enum choice | `{"_class":"core:class:EnumOf","label":"core:string:Enum","of":"enumId"}` |
| Employee reference | `{"_class":"core:class:RefTo","label":"core:string:Ref","to":"contact:mixin:Employee"}` |
| Array of employee references | `{"_class":"core:class:ArrOf","label":"core:string:Array","of":{"_class":"core:class:RefTo","label":"core:string:Ref","to":"contact:mixin:Employee"}}` |

For an automation-only field, use both `readonly: true` and `automationOnly: true`. Also set `hidden: true` for service-only numeric fields; keep user inputs and business results visible. For editable enum input, set `defaultValue` to an allowed enum string, not a number. Declare each enum document once and let multiple fields reference it.

### Steps and output definitions

A step is an object embedded in `Transition.actions`, not a separate model document:

```json
{
  "_id": "__ACTION_0__",
  "methodId": "process:method:UpdateCard",
  "context": null,
  "params": {
    "__SLOT_status__": "Under review"
  }
}
```

`context` is `null` when the action does not publish an object/group output. An action that publishes an output uses `context: {"_id":"__CONTEXT_0__"}`. Optional `results` contains typed values or user inputs, each shaped as `{"_id":"resultId","name":"Result name","type":nativeType}` with an optional `key` for the associated object field.

For every published object/group output, `Process.context` contains a definition like this:

```json
{
  "__CONTEXT_0__": {
    "name": "Review tasks",
    "_class": "process:class:ProcessToDo",
    "action": "__ACTION_1__",
    "index": 1,
    "producer": "__TRANSITION_0__",
    "value": {
      "type": "context",
      "id": "__CONTEXT_0__",
      "key": ""
    }
  }
}
```

`index` is the display sequence of published contexts; `syncContext` assigns it starting at 1 across the process outputs. It is not an action array index. A typed scalar result additionally declares `isResult: true` and `type` in its context definition; its `_class` is the value type's class. The result identifier comes from `Step.results`, not from the step's own `_id`. A process with only card writes uses `context: {}`.

### Ordering

Ranks are ordered LexoRank strings. `0|400000:`, `0|800000:`, `0|c00000:`, `0|g00000:`, `0|k00000:`, `0|o00000:`, and `0|s00000:` are a valid ascending sequence for a small new example. Generate more ranks with `makeRank` or `genRanks`; preserve existing ordering when editing an export.

## Definition and execution are separate

| Entity | Role | Main links |
| --- | --- | --- |
| `Process` | Reusable definition and settings | `masterTag`, `context`, optional `resultType`, `bindings` |
| `State` | A point where execution can wait or finish | `process`, `title`, `rank` |
| `Transition` | Event or condition plus actions moving execution | `process`, `from`, `to`, `trigger`, `triggerParams`, `actions` |
| `Step` | One action embedded in a transition | `_id`, `methodId`, `params`, `context`, optional `results` |
| `Execution` | One running instance for a card | `process`, `card`, `currentState`, `status`, `context`, `rollback` |
| `ExecutionLog` | History of started, transition, or rollback events | `execution`, `transition`, `action` |

Definitions are stored in the model. Runtime executions and tasks are separate documents. Generating a definition does not require generating an `Execution` document.

`Process.context` describes output names, types, and producing actions/transitions. `Execution.context` holds the values for a particular run. The server's `syncContext` synchronizes the definitions from `Step.context` and `Step.results`.

`Process.autoStart` controls automatic creation of executions for applicable card/version events. `Trigger.auto` controls automatic checking of outgoing transitions after a transition executes. These flags have different purposes. `showInHeader`, `automationOnly`, and `parallelExecutionForbidden` control exposure and execution restrictions; they do not define the graph.

## Execution rules that affect the graph

1. A starting transition uses `from: null`. The editor initially creates an `OnExecutionStart` transition. Standard process design should use one clear starting transition: execution creation currently takes the first transition with `from: null`.
2. For normal event handling, `findTransitions` selects transitions for the event and current state, ordered by `rank`. `pickTransition` returns the first whose server check passes. Overlapping conditions therefore need deliberate priority or mutually exclusive predicates.
3. Actions run in their array order on the chosen transition. They are not executed merely because a state exists.
4. Action output contexts become available as actions run. Card updates are reflected in the transition's card cache, so later actions can read the updated values.
5. The collected transition transactions are applied with a match on the execution's current state. On success, the engine updates the state, context, rollback history, and execution log.
6. A destination with no outgoing transitions for that process sets `Execution.status` to `Done`. Naming a state “Done” has no execution semantics.
7. `checkNext` checks outgoing transitions whose triggers have `auto: true`. A matching transition can execute immediately; a state intended for waiting needs a condition that remains false until the required event or data arrives.
8. Immediate transition chains have a depth limit of 100. Avoid automatic cycles that never reach a wait.
9. A failed action records an execution error and stops the transition. Rollback depends on the selected methods and trigger implementation; do not assume every external side effect can be reversed.

Use native LexoRank strings from `makeRank` or `genRanks` when generating documents. `rank` is not an arbitrary sequence number.

### Reusing packaged processes

Compose child executions only when the business scenario requires launching, sequencing, waiting for or cancelling them. Independent reactive responsibilities normally exchange card fields without a parent. When orchestration is required, model the parent as a small graph: start a child, wait for an explicit outcome, then continue. A named logical state is still a state; a real subprocess creates a separate execution.

- A published package version describes a template. Install each selected dependency through the existing UI before binding the parent to its local processes. There is no package dependency manifest, automatic dependency installation or execution version pinning. External dependencies remain explicit slots; independently installed packages retain independent update lifecycles.
- Use a process slot with the existing `kind: process` and `class: process.Process` contract. `$slots.name` resolves to the selected local process identity, not a package name. The binding validator checks the child process's destination card type, including a declared related owner. Do not substitute a catalog member key for a local process ID.
- `package.inspect_installed` returns current editable process definitions, states and transitions, plus the saved installation bindings and baseline slot declarations. Local graphs can differ from the published version. Missing or disconnected members are unavailable; do not replace them by matching display names.
- Bundles group installation and release management. They do not make member processes run together. Calls between processes remain explicit actions and waiting transitions.

The native subprocess contracts are verified in `models/process/src/actions.ts`, `models/process/src/triggers.ts` and `server-plugins/process-resources/src/functions.ts`:

| Operation | Existing contract |
| --- | --- |
| `RunSubProcess` | Required `_id`: the bound child process ID. Optional `card`: one card ID or an array; omission uses the parent execution's card. Optional `context`: an existing native execution-context map, copied into the child execution; this is not a new business-parameter DSL. Creates active child executions linked by `parentId`. Its declared object output is `process.Execution`. |
| `OnSubProcessesDone` | No required parameters. True when every child execution of this parent is inactive; cancelled children count as inactive, and an empty child set also passes. This is not a success-only or per-child check. |
| `OnSubProcessMatch` | `process`: the bound child process ID. `currentState`: one native predicate mapping state IDs with `$all`, `$in` or `$nin`. The check considers non-cancelled children of this parent and this process; no matching children returns false. The modes mean all, any and none of those children matching the selected states. |

`parallelExecutionForbidden` on a child can suppress launching an already active execution for the same card; a call must not be assumed to create a child unconditionally. Parent action order does not itself await child completion. Declare the waiting transition explicitly. Current executions retain the existing in-place process behavior: a later update to a child graph can affect it.

A declared child `resultType`, action context or named result does not establish automatic return-value transfer to the parent. Inspect a verified context expression or registered function for the requested data exchange; if the contract is missing, stop generation and identify that exact dependency. Prefer verified card-field writes/read bindings when the specification explicitly calls for persistent card data; do not silently substitute them for a missing return contract.

## Common operation contracts

These contracts cover card calculations, field updates, tasks, manual actions, card creation, relations, cancellation and typed execution values. They are not a claim that every platform operation is documented here. First check the relevant sections and installed contracts; if a required contract remains unconfirmed, report that exact gap using Checking support before stopping.

### Actions

Use the exact `methodId` shown below. `params` values can be literals or native context expressions.

| Method id | Parameters | Output and requirements |
| --- | --- | --- |
| `process:method:UpdateCard` | Nonempty object mapping stored attribute names to new values | Writes the current card. `context: null`. Attribute slots resolve to field names. Declare visible business status updates explicitly. |
| `process:method:CreateToDo` | Required `title`, `user`; explicitly set `completionMode: "all"` or `"any"` and `withRollback`; optional `description`, `dueDate`, `field`, `askRequired` | `user` is an employee reference or an array of them. Empty recipients are an error. Publishes a task group under `Step.context._id`. In `all` mode, user results and `askRequired` are suppressed. |
| `process:method:CreateAction` | Required `title`, `eventType`; optional `user`, `description` | Creates an event button for this execution and card; declared output is `process.EventButton`. `user` is one employee reference and restricts visibility in the standard card header. Pair it with `OnEvent` using the same `eventType`. This action does not collect a typed card-selection result. |
| `process:method:CreateCard` | Catalog requires `title`, `targetClass`; runtime requires `title`, `_class` | For a fixed destination type, set both `targetClass` and `_class` to that type identity, as the action editor does. Optional `space` defaults to the execution space; ordinary stored fields are additional parameters. Publishes the new card identity. See Choosing and linking cards for limitations. |
| `process:method:AddRelation` | Required `association`, `direction`, `_id` | `association` is an association identity; `_id` is one target card identity or an array. `direction: A` puts the target on side A and the execution card on side B; `B` reverses those sides. Existing identical relations are skipped. Publishes newly created relations. |
| `process:method:CancelToDo` | Required `_id`: a task/group identity | Removes the matched task documents of this execution. Does not cancel a process. Use the context published by the corresponding `CreateToDo`. |
| `process:method:CancelSubProcess` | Required `_id`: a process definition identity | Marks active executions of that process on the current execution's card as Cancelled. Does not filter by `parentId`, accept a child execution identity, or recursively cancel descendants. Declares no output. |
| `process:method:RequestApproval` | Required `user`; optional `completionMode`, `field`, `description`, `dueDate`, `priority`, `withRollback`, `actionType` | Creates an approval request group. Publish it with `as` and use the approval decision triggers below. See the [complete parameter contract](#requestapproval-parameters-and-decisions). |
| `process:method:SetContext` | Required `value`; the step must declare exactly one typed entry in `results` | Initializes that result in execution context. Use `context: null`. Read it with `${$context(resultId)}` after this action. |
| `process:method:UpdateContext` | Required `contextId`: literal result id, and `value` | Updates an already initialized result whose context definition has `isResult: true` and a `type`. It does not create a definition or write a card field. |

Task parameters do not inherit the method catalog's defaults when raw JSON is executed. The catalog suggests `completionMode: "all"` and `withRollback: true`; the raw server fallback is `"any"` and `false`. Set both explicitly.

### Choosing and linking cards

An existing-card picker is already available through a typed `CreateToDo` result. Declare a result with `type: {ref: <target card type>}`, publish the task group with `as`, and use `completionMode: any`. On task completion, the reference result becomes available in the execution context. Wait for `OnToDoClose` with the **task group** identity, then pass the **result value** to `AddRelation._id`. A group identity and the chosen card identity are different values.

For a relation to another card type, declare the association slot's `memberOf` as the opposite type's class slot. Binding validation checks both endpoint types. Omitting `memberOf` means the current process card type on both sides; it does not mean any opposite type. A typed task result or `CreateCard._class` does not implicitly supply that dependency. Declare these slots in the owning process:

```yaml
slots:
  target_type:
    kind: class
    class: core.Class
    name: Target card type
  association:
    kind: association
    class: core.Association
    name: Relation to target card
    memberOf: __SLOT_target_type__
```

Select `target_type` first; the association picker then offers relations compatible with both the current type and that selected target type. If the picker is empty, verify `memberOf`, its resolved class binding and the association endpoint types. Keep the strict compatibility check; repair a missing or incorrect slot dependency in the package rather than widening the picker or substituting an arbitrary relation. Resolve the opposite type from the requirements and installed model. If multiple business registers remain plausible and the choice changes the outcome, ask which register is intended, not which class or slot ID to use.

The following are action and trigger fragments, not a complete process. They use the slots declared above; bind both to compatible existing model objects. The example chooses a target on side B:

```yaml
choose_card:
  method: CreateToDo
  params:
    title: Link
    user: {expr: {call: ExecutionEmployeeInitiator}}
    completionMode: any
    withRollback: false
  as: selection_task
  results:
    selected_card:
      label: Card to link
      type: {ref: $slots.target_type}
```

```yaml
on:
  OnToDoClose: {_id: $context.selection_task}
actions:
  link_card:
    method: AddRelation
    params:
      association: $slots.association
      direction: B
      _id: $context.selected_card
```

`direction` identifies the **target side**, not the execution card's side:

| `direction` | `Relation.docA` | `Relation.docB` | Required compatibility |
| --- | --- | --- | --- |
| `A` | Selected or created target card | Current execution card | Target matches `Association.classA`; current card matches `classB` |
| `B` | Current execution card | Selected or created target card | Current card matches `Association.classA`; target matches `classB` |

Resolve the association and its endpoint types before choosing a direction. Its label does not establish orientation. If either endpoint could be the intended current card type, ask which relationship role the user intends. Do not invent `incoming`, `outgoing`, `source` or `target` as parameter values.

For **Create and link**, collect any requested values with a task if needed, then execute `CreateCard` followed by `AddRelation` in that order. For a fixed destination type, supply both `targetClass: $slots.target_type` and `_class: $slots.target_type`, plus `title` and required stored fields. Publish the card with `as: created_card`; use `$context.created_card` directly for `AddRelation._id`. The created card is not automatically related to the execution card. `CreateCard` applies defaults and can start matching `autoStart` processes on the new card. Dynamic subtype selection, content copying and other optional behavior need their own verified contracts; this fixed-type recipe does not establish them.

For a choice between **Create** and **Link**, model separate task groups or verified manual-event branches. Each transition consumes only the results its branch actually produces. If two tasks represent mutually exclusive choices, explicitly cancel the unused task with `CancelToDo` on the winning branch; do not assume closing one group closes an unrelated group. A task title is a UI label, not an `eventType` or an action implementation.

### Initiator and manual actions

Whenever a process requests an action from a specific user, prefer an assigned ToDo: `CreateToDo` followed by `OnToDoClose`, with typed results when input is needed. This includes requests described as buttons, such as Create, Link or Stop; button wording alone is not a reason to choose `CreateAction`. Use another interaction only when the user explicitly requests it or the required behavior cannot be expressed through the confirmed ToDo contracts. If that support is unclear, ask the user before choosing an alternative.

Use `expr: {call: ExecutionEmployeeInitiator}` for an employee reference identifying the author of the **current execution**. The runtime resolves `execution.createdBy` (falling back to `modifiedBy`) through its social identity to a person identity. The employee variant declares `contact.mixin.Employee`; it does not make an arbitrary person an employee. Confirm that the resolved participant is eligible for the task/action.

`ExecutionInitiator` declares a person reference. `CurrentEmployee` / `CurrentUser` resolve the current processing user's social identity instead of the execution author. Do not substitute them for the initiator. These context functions take no properties.

Assign `CreateToDo.user` to the intended employee and wait for that task's completion. When a manual event button is specifically required, use `CreateAction` with `title`, a stable `eventType`, and `user` set to that employee. The standard card header displays the button only while its execution is active and when `user` is omitted or matches the current employee. `OnEvent: {eventType: <same eventType>}` selects the corresponding branch. This describes UI visibility, not a separate server authorization contract for arbitrary custom events.

A child execution has its own author metadata. `RunSubProcess` sets `parentId`; it does not explicitly inherit the parent's author or a business participant. If the specification means the **parent's** initiator, preserve that participant through a verified child context/binding contract. Do not silently recalculate it from the current user or assume a named business parameter is automatically passed. An exported child interface can establish the native context keys; otherwise ask for the missing interface or explain the precise gap.

### Repeating and stopping a child process

The existing composition is a persistent parent Stop task, a child launch, an explicit completion wait, and a repeat transition. It needs no invented repeat operation or special subprocess block:

1. Create a parent `CreateToDo` titled `Stop`, assigned to the intended initiator, with an explicit completion mode and `withRollback: false`. Publish it once, outside the repeat transition.
2. Launch the bound child with `method: RunSubProcess` and its `params._id` set to the child process identity, then enter a waiting state. Omitted `params.card` uses the current card.
3. In that waiting state, declare the Stop transition first: `OnToDoClose` receives the **parent Stop task group**. Its ordered actions include `CancelSubProcess` with the **child process definition identity**, followed by the explicit parent finishing behavior.
4. Declare the repeat transition after Stop. `OnSubProcessesDone` waits for all children of the parent to be inactive; its action launches the next child and returns to the waiting state. The newly active child prevents the same completion condition from immediately passing again. Declaration order gives Stop priority when both transitions are eligible in the same check; it does not establish atomic preemption across separately queued events.

Use the exact installed method `CancelSubProcess` (`process:method:CancelSubProcess`). Its UI label is Cancel process; a user's wording `cancelProcess` does not establish an additional registered operation. Its `_id` is the process definition, not the `RunSubProcess` execution output or the Stop task group.

Cancellation is scoped by **process + current card + active status**, without a parent filter. It can affect another parent's active execution of the same child process on that card. A child launched on a different card will not be cancelled by this call from the parent card. It updates status only: this method does not itself roll back effects, remove child tasks or recursively cancel grandchildren. Finishing a parent does not imply those operations either. If those behaviors are required, establish their contracts separately and ask the user about any broader cancellation scope before generating the workflow.

`OnSubProcessesDone` also accepts cancelled children and an empty child set; it does not prove successful completion or that a launch occurred. A child that completes immediately without user input, a timer or another real wait can make the parent spin through the automatic transition limit. An unbounded business loop must contain the intended waiting interaction; do not implement it as an unconditional automatic cycle.

### Checking support before stopping

Use this sequence when authoring through MCP:

1. Read the relevant guide section and worked example; use `package.contracts` to confirm that the required operations/functions exist in the selected workspace. A short catalog entry alone neither proves optional semantics nor disproves a documented composition.
2. Use `package.inspect` / `package.inspect_installed` when an existing package or child interface supplies the needed graph, context definitions and bindings. Reuse verified contracts; do not infer them from display names.
3. Resolve technical choices and bindings from the requirements, available packages and installed model. Choose reasonable supported defaults for ordinary gaps and record assumptions. Ask only about material business contradictions, outcome-changing missing rules or unconfirmed required capabilities. Group questions in business language; do not ask the manager to select triggers, contexts, storage keys or slot IDs, or for permission to read available sections.
4. If required behavior still lacks a confirmed contract, stop generation and name the exact operation, parameter or data dependency. Do not substitute an approximation, invent syntax, extend the engine or request a blanket exception to the generation rule. Continue only after the user supplies the missing information or chooses a supported change in scope.

For example, selecting a card is established by typed ToDo results, relation orientation by `AddRelation.direction`, and status cancellation by `CancelSubProcess`. Remaining questions may concern the actual association binding, parent-to-child participant transfer, or whether broad cancellation scope matches the user's request. Report those precise questions instead of saying that all selection, buttons or cancellation are unsupported.

### RequestApproval parameters and decisions

`RequestApproval` creates one `process.ApproveRequest` per supplied recipient, all sharing one group identity. Its model declares only `user` as required. Values can be literals or supported context expressions resolved before the action runs.

| Parameter | Type / required | Runtime behavior when supplied or omitted |
| --- | --- | --- |
| `user` | Employee reference or array of employee references; required | Recipients, e.g. `$card.approvers`. Missing or empty recipients fail the action. Guest recipients must already have read access to the card. |
| `completionMode` | `all` or `any`; optional | Defaults to `all`, including existing definitions without this parameter. `all` requires every recipient's approval; `any` requires one approval and cancels the remaining pending requests. In either mode, any recorded rejection rejects the group. |
| `field` | Stored card attribute name; optional | Enables synchronization of pending requests with the card's recipient field. Use `$slots.approvers` for its identity, not `$card.approvers` for its value. Omit it for a fixed recipient list. |
| `description` | Markup string; optional | Request description; defaults to an empty string. |
| `dueDate` | Timestamp in milliseconds since the Unix epoch; optional | Request due date; omitted means no due date. |
| `priority` | `time.ToDoPriority` numeric value; optional | `0` High, `1` Medium, `2` Low, `3` No priority, `4` Urgent. Defaults to `3` (No priority). |
| `withRollback` | Boolean; optional | Defaults to `false`. When `true`, removal of a request can trigger the engine's task-removal rollback path. This does not mean that rejection rolls back the process. |
| `actionType` | `approve` or `review`; optional | Selects the positive button label: Approve or Review. Omitted behaves as Approve. Both variants record the same approval decision and use the same triggers. |

For `field` synchronization, a nonempty edited recipient list adds missing recipients and removes unfinished requests for removed recipients. Completed requests are retained; clearing the field does not cancel the group. `RequestApproval` does not lock the card; use an explicit `LockCard` action if locking is part of the intended process.

The action publishes a **group identity**, not a single request identity or an array of recipient ids. Use `as: approval_request` and pass `$context.approval_request` directly as the decision trigger's `_id`:

```yaml
request_approval:
  method: RequestApproval
  params:
    user: $card.approvers
    field: $slots.approvers
    withRollback: false
    actionType: approve
    completionMode: all
  as: approval_request
```

`OnApproveRequestApproved: {_id: $context.approval_request}` succeeds when every request in an `all` group has `approved: true`, or at least one request in an `any` group does and none has rejected. `OnApproveRequestRejected` with the same `_id` succeeds when any request has `approved: false` in either mode. Pending requests have neither decision. Both triggers have `auto: true`; model two outgoing transitions from the waiting state and define each outcome explicitly. The action editor's **Require all approvals** toggle selects the mode; it is on by default. Automatic cancellation of pending requests after an `any` approval does not trigger task-removal rollback.

The runtime uses the fixed title `Approve request`; `title` and `askRequired` do not configure this action. Approval modes do not add task result aggregation or change configured approval results.

For offline approval output typing, use `as: {key: approval_request, class: process.ApproveRequest}`. The UI checks required parameters and trigger contracts against the installed model; no operation catalog is embedded in the YAML file.

See [`approval.process.yaml`](./examples/approval.process.yaml) for the approval graph and [`purchase-approval.process.yaml`](./examples/purchase-approval.process.yaml) for a task, calculation and conditional approval combined.

### Triggers

Use the exact `trigger` id shown below. `auto` and `init` are properties of the installed trigger, not properties to add to a transition.

| Trigger id | Init / auto | `triggerParams` and semantics |
| --- | --- | --- |
| `process:trigger:OnExecutionStart` | `init: true`; no automatic outgoing check | `{}` on the starting transition with `from: null` |
| `process:trigger:WhenFieldChanges` | `init: false`, `auto: false` | One stored field key mapped to a match condition, for example `{"customProbability":{"$exists":true}}`. Fires only when that field is present in the update operations and its condition matches. Only the first parameter key is checked; use separate transitions for separate input fields. |
| `process:trigger:OnCardUpdate` | `init: false`, `auto: true` | Card match query, for example `{"customScore":{"$gt":16}}`. Checked on card update events and immediately after a transition. Multiple field predicates in the same object are combined with AND. An empty query matches unconditionally. |
| `process:trigger:OnToDoClose` | `init: false`, `auto: true` | Required `_id`, normally `"${$context(taskContextId)}"`; waits for the task/group produced by the task action. Completion follows the group's explicit `all` / `any` mode. |
| `process:trigger:OnApproveRequestApproved` | `init: false`, `auto: true` | Required `_id`: the group published by `RequestApproval`. Matches all approvals in `all` mode (default), or at least one approval with no rejections in `any` mode. |
| `process:trigger:OnApproveRequestRejected` | `init: false`, `auto: true` | Required `_id`: the same approval group. Matches when any request has `approved: false`. |

Match conditions include direct equality and `$gt`, `$lt`, `$gte`, `$lte`, `$in`, and `$exists`. For a bounded range, use both bounds in one field predicate: `{"customScore":{"$gte":9,"$lte":16}}`. Top-level `$or` is not supported by platform document queries; model alternatives with separate transitions and deliberate priority.

### Value functions

Functions appear in an expression chain as `=>Name(props)`. Their full ids are `process:function:Name`.

| Function id | Input / output | Properties and semantics |
| --- | --- | --- |
| `process:function:StringFromEnum` | Enum string → string | No properties. Null or missing values become an empty string. |
| `process:function:NumberFromString` | String → number | No properties. Uses numeric conversion; an empty string becomes zero and descriptive text can become `NaN`. Presence is not validity. |
| `process:function:Split` | String → first string segment | `separator`: string. Returns `value.split(separator)[0]`, not an array. A declared prefix such as `3 Possible` becomes `3` with separator `" "`. |
| `process:function:Add` | Number → number | Required `value`: numeric literal or context expression. Adds the numeric right operand; a nonnumeric right operand leaves the input unchanged. This does not validate the operands. |
| `process:function:EnumFromString` | String → enum string | No properties. Does not translate descriptions or validate enum membership. |
| `process:function:Multiply` | Number → number | Required `value`: numeric literal or a context expression resolving to a number. Multiplies the incoming number by it. A nonnumeric right operand leaves the incoming value unchanged; validate conversion and input types. |
| `process:function:ArrayLength` | Array → number | No properties. Counts array elements; a missing or empty array gives zero. |

For the default reactive risk example, normalize each declared enum prefix with `StringFromEnum`, `Split: {separator: ' '}` and `NumberFromString`, then add the numeric fields with `Add`. Check readiness using Value is set and an explicit non-null guard. Classify using severity and the sum; observe both inputs. See Worked risk management example for the full module and all 25 decision cells.

The multiplicative example has a different target matrix and deliberately validates its exact numeric choice domain. Its arithmetic is as valid for that matrix as addition is for the matrix below; neither operation is a universal default. An exhaustive `$in` is a domain allowlist, not the default test for whether a value is set. Use `$in` for substantive subsets or explicitly requested membership validation.

## Data flow and context expressions

Use the native expressions described here and, when writing TypeScript, prefer `createContext` over manually assembling expression strings. The separate [DSL reference](dsl.md) provides parser details when maintaining the format.

| Expression | Meaning |
| --- | --- |
| `${@customFieldName}` | Read a field from the current card |
| `${@referenceField.title}` | Follow a reference field and read a target field |
| `${$context(contextId)}` | Read a previously produced execution value |
| `${$context(contextId,title)}` | Read an output object's field when supported by its context definition |
| `${$userRequest(resultId,value,classId)}` | Read a user-provided value using the expected result/class identifiers |
| `${@customFieldName=>FALLBACK("default")}` | Provide a fallback for a process error while resolving the value |

A context reference uses `Step.context._id` or `UserResult._id`, not `Step._id`. Runtime values can be object ids, task group ids, arrays, or typed results. Use the output shape of the selected method; a group id is not a list of assignee ids.

`CreateToDo` returns a task group context. `OnToDoClose.triggerParams._id` should reference that context to wait for the correct task group. With `completionMode: "all"`, all tasks in the group must finish; the implementation suppresses task input results and `askRequired`. With `"any"`, at least one task must finish and result conditions can be checked. Specify the mode explicitly when authoring raw JSON: the catalog defaults and raw runtime fallback differ.

Typed temporary values can be declared with `SetContext` and its `Step.results`. `UpdateContext` updates an already initialized result via `contextId`; it is not a replacement for `UpdateCard`.

`getContextValue` resolves an expression as a value. Do not assume JavaScript template interpolation such as `"Review ${@title}"`, or recursive evaluation of expressions inside literal arrays. The resolver recursively handles object values but leaves literal arrays unchanged. If a requested composition needs a transform whose behavior is not established here or in a supplied example, stop and report that missing contract.

## Reading an existing process

Start with an export from the process editor, preferably with slots when the goal is reuse. Use the card module export when fields, relationships, or referenced types also need to be understood.

Read it in this order:

1. Identify the `Process`, its `masterTag`, startup settings, and required slots.
2. Build a table of states by `_id`. Find the starting transition and terminal destinations.
3. Group transitions by `from`, then sort them by `rank`. Translate each trigger into a business event or condition using its server check.
4. Read each action in order. Resolve its method, parameters, card writes, side effects, and output context.
5. Trace every `$context(...)` and user result back to its producer. Check that it exists before use on every relevant path, including retry and rejection loops.
6. Resolve field, class, association, and subprocess bindings against the destination type and its related model objects.
7. Summarize each transition as “when X happens in state Y, do A and B, then move to Z”.

An explanation should include the graph, field definitions, transition/action table, output dependencies, and any unresolved bindings. Distinguish a missing workspace export from missing engine documentation: the repository cannot identify a user's configured processes by their display names alone.

## Building a new process from a business request

Write a short business specification first: target card type, fields, participants, start condition, success condition, alternative outcomes, and persistent changes. Apply Manager-facing authoring: derive technical choices yourself, record reasonable assumptions, and ask only material business questions or explain a required capability that remains unconfirmed.

Prepare these technical parts yourself and include them in the draft review; they are not a manager questionnaire or a separate technical-approval gate:

- A card field table with types, cardinality, required values, and editing rules.
- A state diagram showing where the process waits and where it finishes.
- A transition table containing source, trigger and parameters, ordered actions, destination, and priority.
- A dependency table mapping each execution context to its producer, value type, and consumers.
- A native process template or module export plus the required bindings.

Then map the specification to existing methods and triggers. For an approval process, pair `RequestApproval` with `OnApproveRequestApproved` and `OnApproveRequestRejected`, and decide explicitly what rejection changes and whether it loops. For a task process, pair `CreateToDo` with `OnToDoClose`. For a specific user action, prefer assigned `CreateToDo` with `OnToDoClose` and typed results, including requests worded as Create, Link or Stop buttons. Use `CreateAction` with `OnEvent` only when that interaction is explicitly needed and its contract is confirmed. For subprocesses, inspect `RunSubProcess`, the child process result type, and the appropriate completion/matching trigger.

Use the operation contracts above for required values, result shapes, and participant formats. Reuse a known exported pattern when available instead of inferring its JSON from UI labels. The subprocess contracts are described under Reusing packaged processes. These operation pairs do not establish every optional parameter or data-exchange contract; if one is needed without a supplied verified example, stop and report the exact missing contract.

## Portable templates and card modules

The process editor serializes `exportProcess(...).docs`: the import input is a JSON array of documents, not the enclosing `{ docs, required }` result.

Portable process exports use placeholders such as `__PROCESS__`, `__MASTER_TAG__`, `__STATE_0__`, `__TRANSITION_0__`, `__ACTION_0__`, and `__CONTEXT_0__`. Slot placeholders are `__SLOT_name__`.

`requiredSlots` describes required attributes, classes, associations, and other processes. `bindings` maps slot names to concrete values. Attribute bindings use stored field names; class, association, and process bindings use model ids.

`importProcess` generates fresh internal ids, substitutes the target master tag and slot bindings, removes `requiredSlots` from the imported process, and creates or updates model documents. Supply every required binding: unresolved placeholders are currently assigned generated ids, which can hide a missing dependency until execution. Re-importing a portable template normally creates another process because `__PROCESS__` receives a fresh id.

Card module import follows `importModule`, which uses the exported document ids and does not perform the portable process placeholder conversion. A portable process template must go through process import; use a coherent concrete module export when transferring types and their processes together.

## Worked review example

[review-task.process.json](examples/review-task.process.json) is a native portable process template for a card with two fields:

| Slot | Expected field | Purpose |
| --- | --- | --- |
| `reviewers` | Array of references to `contact.mixin.Employee` | Existing field containing the reviewers accepted by the task editor |
| `status` | String, preferably automation-only | Visible status updated by the process |

Create or select these fields on the destination card type. During process import, bind both slots to their actual stored field names.

```mermaid
flowchart LR
  Start((Start)) -->|"OnExecutionStart: set status; create review tasks"| Review["Under review"]
  Review -->|"OnToDoClose: all review tasks complete; set status"| Done["Reviewed"]
```

The starting transition first writes “Under review” to the status field and then creates review tasks with `completionMode: "all"`. Its task action publishes `__CONTEXT_0__`. The outgoing transition reads that context to identify the task group, waits for completion, and writes “Reviewed”. The final state has no outgoing transitions, so the execution finishes.

This example demonstrates task completion, not an approval decision. To require acceptance or rejection, change the action and outgoing triggers to the approval pattern and model both outcomes.

## Worked risk management example

[`risk-management-reactive.card.yaml`](examples/risk-management-reactive.card.yaml) is the default worked example for [Design preferences](#design-preferences). Through MCP, read this section and `example:risk-management-reactive.card.yaml`. It is a complete `version: 2`, `kind: card` module: one card type, its enums/fields and **three independent auto-start processes**. Import it through the card module importer. No workspace identities, process slots, coordinator or child execution are required.

| Field | Values / purpose | Visibility and editing |
| --- | --- | --- |
| Probability | `1 Rare`, `2 Unlikely`, `3 Possible`, `4 Likely`, `5 Almost certain` | Visible, required user input; default `1 Rare` |
| Severity | `1 Negligible`, `2 Minor`, `3 Moderate`, `4 Major`, `5 Catastrophic` | Visible, required user input; default `1 Negligible` |
| Normalized probability (`P`) | Numeric probability prefix | Hidden, readonly, automation-only |
| Normalized severity (`S`) | Numeric severity prefix | Hidden, readonly, automation-only |
| Risk sum | `P + S` | Hidden, readonly, automation-only |
| Risk level | `Acceptable`, `Tolerable`, `Unacceptable` | Visible business result, readonly, automation-only |

The three numeric fields are service data, not additional questions for users. Enum values are text with an explicit numeric prefix followed by a space. Normalize each with `StringFromEnum → Split: {separator: ' '} → NumberFromString`; `Split` returns the first segment, not an array. This parses the declared prefix; it does not translate arbitrary descriptions or validate unknown imported labels. No fallback silently turns missing inputs into a risk score.

The exact decision rule is:

- `S = 1` → `Acceptable`.
- `S > 1` and `P + S ≤ 5` → `Acceptable`.
- `S > 1` and `5 < P + S ≤ 7` → `Tolerable`.
- `S > 1` and `P + S ≥ 8` → `Unacceptable`.

Check a simplified rule against every original decision-table cell. For this example, rows are probability and columns are severity; `A`, `T`, `U` mean `Acceptable`, `Tolerable`, `Unacceptable`:

| P \\ S | 1 | 2 | 3 | 4 | 5 |
| --- | --- | --- | --- | --- | --- |
| 1 | A | A | A | A | T |
| 2 | A | A | A | T | T |
| 3 | A | A | T | T | U |
| 4 | A | T | T | U | U |
| 5 | A | T | U | U | U |

The severity-one column is exceptional. The table is asymmetric: `P=1, S=5` is `Tolerable`, whereas `P=5, S=1` is `Acceptable`, despite both sums being six. Dropping the severity exception or substituting the other example's product thresholds would change this specific table. For another target matrix, multiplication can be the simpler equivalent expression; compare all cells before choosing.

```mermaid
flowchart LR
  Inputs["Probability and Severity text choices"] --> Normalize["Normalize risk inputs"]
  Normalize --> Numbers["P and S numeric fields, hidden"]
  Numbers --> Add["Add normalized risk inputs"]
  Add --> Sum["P + S field, hidden"]
  Sum --> Classify["Classify risk"]
  Numbers -->|"S, including the severity-one exception"| Classify
  Classify --> Result["Visible Risk level"]
```

**Every arrow is a persistent field dependency, not `RunSubProcess`.** Each process owns one responsibility:

| Process | Reads | Writes | Wait-state change triggers |
| --- | --- | --- | --- |
| Normalize risk inputs | Probability and Severity text choices | Both numeric prefixes in one `UpdateCard` action | One `WhenFieldChanges` transition for each text field |
| Add normalized risk inputs | Both numeric prefixes | Risk sum | One `WhenFieldChanges` transition for each numeric field |
| Classify risk | Normalized severity and Risk sum | Risk level | One `WhenFieldChanges` transition for severity and one for sum |

Each starts in a calculation state via `OnExecutionStart`. The normalizer and adder use `OnCardUpdate` readiness predicates with **Value is set** plus an explicit non-null guard. The classifier uses four mutually exclusive `OnCardUpdate` branches with the exact conditions above. Severity one can be classified before the sum exists; the other branches require the sum. Every successful calculation returns to a state with only field-change transitions. There are no snapshots, previous-value comparisons, control flags or subprocess calls. None of the three processes watches its own outputs, and the dependency graph is acyclic.

A consumer started before its producer waits for its inputs. A consumer started after its producer reads the existing fields on entry. Updating either user input wakes normalization; its outputs wake addition and severity-sensitive classification, and the sum update wakes classification again. Classification watches severity directly even if the sum is unchanged. Intermediate classifications can occur while independent update events are being processed; check the settled result after the queue drains. For atomic review or an explicit completion barrier, ask for that separate business requirement instead of adding an implicit coordinator.

The presence guards deliberately do not enumerate all enum labels through `$in`. **Value is set accepts null**; the explicit `$ne: null` readiness condition prevents null conversion. Neither condition validates arbitrary external data. The formula and the equivalence check cover the declared 1–5 domain. On incomplete inputs the process waits; this example does not invent a business policy for clearing previously computed outputs.

Manual acceptance after a separately reviewed UI import:

1. Allow the type in the destination card space if necessary. Create a Risk management card; expect three active executions and default `Acceptable`. Verify that exactly three numeric service fields are hidden and that the two inputs and Risk level are visible.
2. Run all 25 pairs and compare the settled result with the table. Check boundaries at sums five, seven and eight, and every severity-one cell.
3. Change probability alone and severity alone across all five choices; verify downstream recomputation without restarting any execution.
4. On a single card, change `1/5 → 5/1 → 1/5`. The sum stays six; Risk level must change `Tolerable → Acceptable → Tolerable`. Also change `1/1 → 5/1`: only probability and sum change, and the result stays `Acceptable`.
5. On cards without active executions, start all three processes in each of the six possible orders. Start consumers before producers and vice versa; expect the same settled result. Do not assume declaration order is runtime scheduling.
6. Inspect execution logs after output writes: all processes must settle in their wait states with no continuing event queue or 100-step immediate cycle. Updating Risk level alone must not wake any process.

The native-operation regression test in `server-plugins/process-resources/src/__tests__/reactive-risk-management.test.js` checks the matrix, all start orders, input edits, alternative event-delivery orders, same-sum asymmetry, missing/null presence semantics and bounded event draining using actual predicates, transforms and `UpdateCard`. It is an in-memory event harness, not proof of a deployed workspace's delivery, binding or UI behavior.

[`risk-management.card.yaml`](examples/risk-management.card.yaml) and [`risk-management.module.json`](examples/risk-management.module.json) demonstrate a **different multiplicative policy** (`Insignificant / Moderate / Critical`) and exercise serialization. Its multiplication model and this addition model are equally valid when they reproduce the respective target matrix. Use the reactive example for the independent field-driven design pattern, not as a universal recommendation to replace multiplication with addition. Arithmetic selection and process decomposition are separate decisions.

## Worked procurement workspace

[`procurement-workspace.card.yaml`](./examples/procurement-workspace.card.yaml) is a complete module with seven card types (one shared base and six concrete types), two optional tags, eight enums, 63 attributes, seven associations and four manually started processes. Import it through the card module importer or open it in the card-type YAML editor. The local type/enum/association references are included; embedded workflows need no slot-binding dialog. Select actual employees and create sample cards in the destination workspace after import.

| Type | Fields and ownership |
| --- | --- |
| Procurement record | Shared `code`, required `owner: Employee`, `notes: markup`, priority choice and archived flag. Every concrete type inherits these fields. |
| Procurement project | Budget, dates, cost center, `reviewers: Employee[]`, `preferred_supplier: Ref<Supplier>` and automation-only status. |
| Procurement supplier | Legal name, tax id, email, website, tier choice, active flag and `contacts: Employee[]`. |
| Procurement product | SKU, category, price/currency, `preferred_supplier: Ref<Supplier>`, `replacements: Ref<Product>[]`, availability and markup specification. |
| Purchase request | Required project/supplier refs, `products: Ref<Product>[]`, approvers and needed-by date. The process stores quote inputs, amount, product count, approval flag and status. |
| Procurement delivery | Required purchase-request ref and inspector, date and warehouse. The process stores inspected quantity, boolean inspection decision and status. |
| Procurement invoice | Required request ref, invoice number, amount and finance approvers; due date and USD currency. The process stores request title/status and supplier snapshots plus invoice status. |
| Audit details / Shipping details | Optional tag fields for reviewer/date/note, or carrier/tracking/insurance. Apply Audit details to procurement records and Shipping details to deliveries manually. |

For the demo's `1:N` associations, class A is the child and class B is the parent: a request selects one project, and a project lists multiple requests. `nameB` is shown on an A card and `nameA` on a B card. `Ref` fields and association links have independent stored values; setting `request.project` or `delivery.purchase_request` does not create an association link. Fill the refs for process context and create the corresponding relations for navigation.

```mermaid
flowchart LR
  Project["Project"] -->|"requests: one to many"| Request["Purchase request"]
  Request -->|"deliveries: one to many"| Delivery["Delivery"]
  Supplier["Supplier"] <-->|"catalog: many to many"| Product["Product"]
  Project <-->|"supplier panel: many to many"| Supplier
  Product <-->|"compatibility: many to many"| Product
  Invoice["Invoice"] <-->|"evidence: many to many"| Delivery
  Invoice <-->|"primary document: one to one"| Delivery
```

| Process / transition | Waiting condition and ordered actions | Destination |
| --- | --- | --- |
| Project start / completion | Write Under review, create reviewer tasks in `all` mode; wait for their group, then write Active. | Project active |
| Purchase start / quote completion | Write Awaiting estimate, create one quote task for the owner in `any` mode; wait for its group, then persist quantity/price. | Validate quote |
| Purchase validation | Invalid quantity, negative price or non-USD currency writes Invalid quote. Otherwise calculate amount with Multiply, count product references with ArrayLength, then persist both values. | Invalid quote / Check budget |
| Purchase budget / decisions | Amount ≤ 1000 writes Approved. Amount > 1000 writes Awaiting approval and creates a request group; all approvals write Approved, any rejection writes Rejected. | Approved / Awaiting approval / Rejected |
| Delivery inspection / classification | Write Awaiting inspection, create an `any` task for the inspector; wait, persist quantity and boolean decision, then write Accepted for true or Rejected for false. | Accepted / Rejected |
| Invoice start / request check | Read the referenced request's title, status and supplier into snapshots. A non-Approved request writes Blocked; an Approved request writes Awaiting approval, creates finance requests and locks the invoice. | Blocked / Awaiting approval |
| Invoice decision | Wait for its own approval group. Unlock first, then write Approved or Rejected. | Approved / Rejected |

Project tasks publish `pc_project_reviews`. Purchase tasks publish `pc_quote_tasks` and collect `pc_quote_quantity` / `pc_quote_unit_price`; these values are read only after the task-group completion transition. Two subsequent SetContext actions produce `pc_quote_amount` and `pc_quote_product_count`, which are then persisted. Purchase approval publishes `pc_purchase_approval`. Delivery tasks publish `pc_inspection_tasks` and collect a number and boolean after completion. Invoice approval publishes `pc_invoice_approval_requests`; its initial snapshots read values through `$card.purchase_request.*` independently of associations.

Manual walkthrough:

1. Import the module and allow the six concrete types in a card space if it restricts types. Fill inherited Owner on every sample card. Create supplier **Acme Supply**, products **Laptop A** and **Laptop B**, and project **Office rollout** with two reviewers. Fill product supplier refs, add a replacement-product ref, link supplier/product catalogs and the project supplier panel. Apply the optional tags and inspect their fields.
2. Start **Review procurement project**. Complete one reviewer task: status remains Under review. Complete the remaining task: status becomes Active.
3. Create a request **Laptop purchase** referencing the project, supplier and both products; fill approvers and link it to the project through the association. Start **Estimate and approve purchase**. Complete the quote task with quantity `2`, unit price `500`: amount is `1000`, product count is `2`, approval_required is false and status is Approved. Repeat with price `500.5`: amount is `1001`, approval_required is true and status waits for all approvers. Check rejection on another execution. Quantity `0` or price `-1` ends with Invalid quote. Typed number fields alone do not impose these ranges; the graph supplies the guards.
4. Create a delivery referencing the request, fill its inspector and link the delivery association. Complete **Inspect delivery** with quantity `2` and decision true: Accepted. On another execution use false: Rejected. The decision classifies the delivery; the quantity is stored as the inspection's reported value.
5. Create an invoice referencing an Approved request and fill invoice number, amount and finance approvers. Start **Approve invoice against purchase**: the referenced title/status/supplier appear in snapshots, status becomes Awaiting approval and the invoice is locked. Approval or rejection unlocks it and writes the outcome. Reference a Draft or Rejected request on another invoice: it ends Blocked before creating finance tasks or locking. The request status is captured at execution start; after changing the request, start a new invoice execution to refresh it.
6. Add invoice/delivery evidence links and a primary invoice/delivery link; check the `N:N` and `1:1` selectors. Export the full module as YAML and reopen it to inspect inheritance, refs, tags, enums, associations and all workflows. Imported module definitions do not create the sample runtime cards or employee records.

The quote is an aggregate USD quantity × unit-price estimate. Product count counts entries in the reference array. Project budgets, catalog prices, association memberships and invoice amounts remain independently maintained business fields; this example does not infer sums or synchronization from their relationships. A restarted invalid quote retains any earlier computed amount, while the Invalid quote status prevents its invoice approval path.

## Review before import and manual verification

Check that every state/transition belongs to the process, every destination/source exists, method and trigger ids come from the model catalog, ranks are valid, and all required parameters and bindings are supplied. Verify types and allowed values against the target card attributes, and check each context's producer before its consumers. Review overlapping branches, automatic cycles, terminal states, task completion mode, and rollback behavior.

For the worked example, import it through the destination type's Processes section, fill the reviewers field on a sample card, and start the process manually. The card should show “Under review”, one task should be created per unique reviewer, and completing only one of several tasks should keep the execution active. After all tasks finish, the status should become “Reviewed” and the execution should be done. Repeat with an empty reviewers field and inspect the execution error rather than assuming a task was created.

## Runtime waiting diagnostics

Execution details show the most recent actual transition checks, their timestamps and structured reasons. A false condition, an event that has not arrived, an alternative that was not evaluated, and a failed check are distinct. Checks still run in their existing event and rank order; diagnostics do not execute additional branches or simulate transitions. A successful state change clears the previous state's snapshot. Existing executions acquire diagnostics on their next normal check; viewing details does not advance or recheck a process.

Server operations can call `reportProcessDiagnostic(control, reason)` from `@hcengineering/server-process` during their existing invocation. `ExecutionReason` is exported by `@hcengineering/process`: it contains a stable extension-defined code, a localized message, safe primitive message parameters, optional dependency references, `all` / `any` / `none` mode, counts, field names, expected states, a deadline and nested reasons. An optional registered `presenter` can render a specialized reason. The boolean check contract and YAML format are unchanged. Operations without evidence show an explicit lack of details. Observer or snapshot-write failures must not change the check's decision.

Built-in evidence covers task groups, approval and rejection groups, required fields, card predicates, deadlines and subprocess checks. Action errors identify the exact action, method and failing input parameter when parameter resolution failed. Native context-resolution errors retain their existing localized explanation; no missing value is inferred from `false` or `0`.

Subprocess evidence comes from the same `parentId` and process/status selectors as the check. Each dependency resolves to its execution and card, including children started on cards selected through relationships. `RunSubProcess` records selector provenance for new children when available (the source card, resolved association and direction, or reference field). This describes the launch selection, not a guarantee that the relationship still exists. Changes to links after launch do not retarget an existing parent's child executions.

`OnSubProcessesDone` keeps its native meaning: there are no active children. Cancelled children therefore count as inactive, and the UI names them as cancelled rather than completed. The check also matches an empty child set. `OnSubProcessMatch` excludes cancelled children, requires a nonempty matching-process set, and applies its existing `$all`, `$in` or `$nin` state predicate. Diagnostics do not invent an expected execution for each related card or change these rules.

Snapshots contain bounded references rather than copies of privileged task/card/execution documents. Dependency details are read through the viewing user's client; inaccessible objects use a generic placeholder. Extension authors must keep message parameters free of sensitive values. Lists initially render 20 entries, load another 20 on demand, and explicitly indicate the snapshot limit of 200 references per reason. Nested execution inspection loads on expansion, detects repeated executions and stops at five levels. Reason trees are limited to four nested levels and 20 reasons per check.

Manual verification:

1. Start a parent that launches reviews on several related cards. Complete one child, leave another waiting for a task and fail a third. Verify the listed executions/cards, counters, links and nested explanations.
2. Exercise each subprocess state mode (`$all`, `$in`, `$nin`), cancellation, no matching children and a relationship edited after launch. Compare the explanation with the actual transition decision.
3. Check task `all`/`any` groups, approval/rejection, a failed field predicate and a missing required field. Ensure unrelated tasks and untested alternatives are not presented as blockers.
4. Fail an action input and verify its action position, method, input parameter and localized error. Correct the input and continue normally.
5. Inspect as a user without access to one dependency card. Verify that no document title or contents appear for that dependency. Exercise a large list and nested/cyclic dependencies, and confirm that expanding details never executes process actions.

## Source map for maintaining this reference

Paths below are relative to the repository root. Keep this guide aligned with changes to these sources. They are maintenance references; do not search through them for each task already covered above.

| Question | Source |
| --- | --- |
| What is a card type, tag, or card? | `plugins/card/src/index.ts` |
| How are types and custom fields created? | `plugins/card-resources/src/components/CreateTag.svelte`, `plugins/setting-resources/src/components/CreateAttribute.svelte` |
| What are the process document types? | `plugins/process/src/index.ts`, `plugins/process/src/types.ts` |
| What is the supported YAML grammar and how is it compiled? | `plugins/process/src/authoring.ts`, `plugins/process/src/authoring-layout.ts`, `plugins/process/src/authoring-pipelines.ts`, `plugins/process/src/authoring-validation.ts` |
| How are YAML risk calculations checked against native execution? | `server-plugins/process-resources/src/__tests__/reactive-risk-management.test.js` (additive matrix and independent processes), `yaml-authoring.test.js` (multiplicative matrix and other workflows) |
| What does Value is set mean? | `plugins/process-resources/src/query.ts`, `foundations/core/packages/core/src/predicate.ts` |
| Which actions exist and which parameters are required? | `models/process/src/actions.ts` |
| Which triggers exist and which are checked automatically? | `models/process/src/triggers.ts` |
| What do actions and trigger checks actually do? | `server-plugins/process-resources/src/functions.ts` |
| How are values, slots, and DSL expressions resolved? | `server-plugins/process-resources/src/utils.ts`, `server-plugins/process-resources/src/transform.ts` |
| Which initiator/current-user functions exist and how are they implemented? | `models/process/src/functions.ts`, `models/server-process/src/index.ts`, `server-plugins/process-resources/src/transform.ts` |
| Which manual buttons does the card header display? | `plugins/process-resources/src/components/ProcessesHeaderExtension.svelte` |
| How are transitions selected and executed? | `services/process/src/main.ts` |
| How are events emitted and context definitions synchronized? | `server-plugins/process-resources/src/index.ts` |
| How are processes exported and imported? | `plugins/process-resources/src/exporter.ts` |
| How are card types and their dependencies exported? | `plugins/card-resources/src/exporter.ts` |
| How does the UI encode a particular action? | `plugins/process-resources/src/components/settings/*Editor.svelte` |
| What is the DSL syntax? | [Context expressions](dsl.md), `plugins/process/src/dslContext.ts` |

