# Workspace API v2

The Workspace API v2 is a separate API pod. It authenticates the caller, opens
a low-level workspace client with that caller's API key, and invokes only
operations declared by the workspace model. It does not add HTTP handlers to
the transactor; the generic capability dispatcher does not use `domainRequest`.

Each model-declared `WorkspaceApiCapability` points to a resource function in
the corresponding `server-plugins/<domain>-resources` package. The API pod is
therefore generic: it resolves the visible class name, obtains the capability,
and calls its resource through the low-level client. Domain rules stay beside
the domain's server resources.

Configure the pod with `TRANSACTOR_URL` (a WebSocket URL), `ACCOUNTS_URL`, and
`COLLABORATOR_URL` when markup fields are used. The API key is sent only to the
account service, the low-level workspace client, and—when reading or changing
collaborative markup—the workspace collaborator service created for that request.

The endpoint reads the current workspace model on every request. Consequently,
the schema and available document types can differ between workspaces.

## OpenAPI

The OpenAPI 3.0 specification is served by the API pod:

- `GET /api/v2/swagger.json`
- `GET /api/v2/openapi.json`
- `GET /api/v2/swagger` — public interactive Swagger UI for the base contract

For a workspace-specific specification, including the currently allowed enum
and status values, use:

- `GET /api/v2/{workspaceId}/swagger.json`
- `GET /api/v2/{workspaceId}/openapi.json`
- `GET /api/v2/{workspaceId}/swagger` — an interactive Swagger UI page

The interactive page asks for the workspace API key, keeps it only in the
current browser page, and applies it to the schema request and Try it out
requests. It loads the pinned Swagger UI assets from unpkg. The JSON URLs can
also be used in another OpenAPI client; they require the same Bearer API key as
the rest of the workspace API.

The public page describes the stable contract for every endpoint, with generic
request and response shapes, parameters, authentication, and errors. Enter the
workspace UUID in the path parameter and use Swagger's **Authorize** button to
provide an API key. For the actual classes, custom fields, enums, statuses, and
allowed space types of one workspace, use its workspace-specific Swagger page.

Every collection `GET` shows an optional `limit` query parameter in Swagger.
It defaults to `100` and must not exceed `1000`. Parameters that select or
filter a collection, such as a document `space`, are shown there as well.

## Authentication

Every workspace endpoint requires a workspace API key. Create and revoke keys
in **Settings → API access**. A key is shown only once, at creation time.

```http
Authorization: Bearer <api-key>
```

The `{workspaceId}` URL parameter must be the workspace UUID embedded in that
key. A key for another workspace is rejected. Revoking a key invalidates it
for subsequent requests.

## Errors

All failed workspace requests return JSON in one stable format:

```json
{
  "error": {
    "code": "validation_error",
    "message": "title is required"
  }
}
```

`message` is safe to show to an API caller for validation errors. When a
platform status provides non-sensitive parameters, they are returned in the
optional `error.details` object.

| HTTP status | `error.code` | Meaning |
| --- | --- | --- |
| `400` | `validation_error` | The request body, visible class/field name, enum/status value, or domain flow is invalid. Correct the request using `/schema`. |
| `401` | `unauthorized` | The Bearer API key is missing, invalid, expired, or revoked. |
| `403` | `forbidden` | The API key is valid, but its user has no permission for the requested create/update/command. This includes denials returned by the transactor security middleware. |
| `404` | `not_found` | The requested object does not exist or is not visible to the API key user. |
| `503` | `internal_error` | A required API service, such as account or transactor, is temporarily unavailable. Retry later. |
| `500` | `internal_error` | An unexpected server error occurred. Internal error details are deliberately not returned. |

For example, a create denied by workspace security returns:

```json
{
  "error": {
    "code": "forbidden",
    "message": "The API key user is not allowed to perform this operation"
  }
}
```

The OpenAPI specification includes the reusable `ApiError` schema and standard
validation, authentication, permission, and not-found response components.

## Discover the workspace schema

Before creating a document, request the schema for the target workspace:

```bash
curl 'https://<api-url>/api/v2/<workspace-id>/schema' \
  -H 'Authorization: Bearer <api-key>'
```

Example response:

```json
{
  "classes": [
    {
      "name": "Document",
      "fields": [
        { "name": "title", "type": "String", "required": true, "custom": false },
        {
          "name": "Confidentiality",
          "type": "EnumOf",
          "required": false,
          "custom": true,
          "values": ["Low", "Medium", "High"]
        }
      ]
    }
  ]
}
```

`classes` contains document types with either a registered creation factory or
a `WorkspaceApiCapability`. `factory: true` means that the integration-factory
document create route is available; capability classes include an `operations`
array. Factories are the same ones used by integrations and take care of
product-specific creation logic, such as document ranks and defaults.

The generic document representation never uses model, field, class, space,
status, or reference ids. For a `RefTo` field, send the referenced object's
unique visible `name` (or `title` when it has no `name`); the API resolves it to
the internal id. Responses convert that reference back to the same visible
value, including arrays of references. A missing or ambiguous name is a
validation error. The only ids intentionally kept in this contract are target
document ids used by routes that read, patch, or otherwise address one exact
object.

Fields whose schema has `"markdown": true` accept ordinary Markdown strings
on create and PATCH and return ordinary Markdown strings from GET and list
responses. This applies to both regular markup and collaborative-document
fields; the API converts them to and from the internal editor representation.
Workspace-specific OpenAPI marks these properties as `format: markdown`.

## Supported classes and capabilities

At present, the built-in integration factories support these class families:

- `Document` and its derived classes, in a Document `Teamspace`.
- `Card` and its derived classes, in a Card space.
- `Issue` and its derived classes, in a Tracker `Project`.

The exact set is workspace-specific: a class is listed by `/schema` only when
the workspace has a matching `IntegrationTargetFactory`. Custom subclasses of
these supported base classes are included automatically.

The generic capability endpoint currently exposes these model-declared classes:

| Class | Read | Create | Patch | Commands |
| --- | --- | --- | --- | --- |
| `Person` | Yes | Yes | Yes | None |
| `Organization` | Yes | Yes | Yes | None |
| `Employee` | Yes | No | No | None |
| `Event` | Yes | Yes | Yes | None |
| `ToDo` | Yes | Yes | Yes, limited | None |
| `ControlledDocument` | Yes | No | No | `versions`, `create-draft`, `send-review`, `send-approval` |
| `ProcessToDo` | Yes | No | Yes, limited | None |
| Any document class | No | No | No | Comments through `/comments` |
| `Channel` | No | No | No | Chat messages through `/chats/messages` |
| `Card` and derived classes | No | No | No | Dedicated `/cards` routes, plus comments and chat messages through the unified routes |

`ProcessToDo` patch accepts only `title`, `description`, `dueDate`, `priority`,
and `visibility`. In particular it cannot set `doneOn`, approve, or otherwise
advance a process.

`Event` creation and listing require the visible `calendar` name outside the
`fields` object. Participants are resolved from unique visible contact names.
`Employee` remains read-only. `ToDo` patch also excludes `doneOn`.

Person contact names use the order configured in the workspace (`First name
Last name` or `Last name First name`). The Contact model stores these parts in
an internal sortable representation, but v2 converts it on every contact
response and accepts the configured display order on create, patch, and
reference fields (including calendar participants and controlled-document
reviewers/approvers). Organization names are unchanged.

The API resolves the messaging backend from workspace capabilities. It prefers
the Communication capability when the target class declares it and otherwise
uses the legacy Chunter capability. Callers never choose a legacy/new route.
Both implementations preserve their product pipelines: legacy comments on a
Controlled Document are created as `DocumentComment`, while Communication
messages preserve its permission, identity, mention and notification handling.

The resource-backed API is exposed only through dedicated routes:

- `Person`, `Organization`, and `Employee` from Contact.
- `Event` from Calendar.
- `ToDo` and `ProcessToDo` from Time and Process.
- `ControlledDocument` versions and their review/approval requests.
- `ChatMessage` comments/messages.

These classes are not necessarily returned by `/schema`: their creation and
lifecycle rules are expressed by their dedicated endpoint. `Employee` and
`ProcessToDo` are never created through v2.

The Issue factory preserves Tracker-specific behaviour: it allocates the issue
number and identifier, applies the project's defaults, resolves the status, and
handles markup descriptions and labels. Status field values are exposed and
accepted as their configured names rather than internal status IDs.

Use the returned `name` values exactly as supplied. Names must be unique within
the workspace model; an ambiguous class or field name is rejected with `400`.
For custom fields, the API uses the user-visible field label rather than the
internal attribute key.

For enum fields, `values` contains every accepted value. For tracker status
fields, it contains the status names configured for that specific field. The
workspace-specific OpenAPI document exposes these values as Swagger `enum`
options as well.

## Spaces

`GET /api/v2/{workspaceId}/spaces?limit=<n>` lists the spaces visible to the
API-key user. Each result contains the visible `name` and `class`.

To discover where a class may be created, provide its visible class name:

```text
GET /api/v2/{workspaceId}/spaces?class=Issue
```

This returns only spaces compatible with the class's registered integration
factory (for example, `Issue` → Project, `Card` → Card space, `Document` →
Teamspace). `/schema` exposes the corresponding space class names in
`createIn`. It is a read-only discovery endpoint; creating or changing spaces
is intentionally not part of v2 because each product has a different
provisioning flow.

## Integration-factory documents

Use the same named class and space representation to read documents:

```bash
curl 'https://<api-url>/api/v2/<workspace-id>/documents?space=Documentation&limit=100' \
  -H 'Authorization: Bearer <api-key>'
```

The response has a `documents` array in the same representation as the create
response, including each document's `id`, plus `total` with the number of
matching documents. `class` is optional and defaults to `Document`; when
provided, it selects only a visible subclass of `Document`. `space` is
optional; it is resolved only among Document Teamspaces, so a same-named Card
space cannot be selected accidentally. Omit it to list the selected class in
all visible Document Teamspaces. `limit` defaults to `100` and can be at most
`1000`.

## Create a document

```bash
curl -X POST 'https://<api-url>/api/v2/<workspace-id>/documents' \
  -H 'Authorization: Bearer <api-key>' \
  -H 'Content-Type: application/json' \
  --data '{
    "class": "Document",
    "space": "Documentation",
    "fields": {
      "title": "Integration guide",
      "content": "<p>Getting started</p>"
    }
  }'
```

Request body:

| Field | Required | Description |
| --- | --- | --- |
| `class` | No | `Document` by default, or a visible subclass of `Document` returned by the schema endpoint. |
| `space` | Yes | The target workspace space name. |
| `fields` | No | An object whose keys are field names returned by the schema endpoint. Values must match the field type. |

If `/schema` exposes a status field, pass one of its `values` names. The API
resolves that name to the workspace status internally, so callers do not need
its identifier.

The successful response uses the same named representation:

```json
{
  "id": "<document-id>",
  "class": "Document",
  "space": "Documentation",
  "fields": {
    "title": "Integration guide",
    "content": "<p>Getting started</p>"
  }
}
```

## Update a document

Use `PATCH` with the document `id` returned by the API and named fields in
`fields` to change it. The document is selected strictly by that ID; the
request does not include a space.

```bash
curl -X PATCH 'https://<api-url>/api/v2/<workspace-id>/documents' \
  -H 'Authorization: Bearer <api-key>' \
  -H 'Content-Type: application/json' \
  --data '{
    "class": "Document",
    "id": "<document-id>",
    "fields": {
      "content": "<p>Updated guide</p>"
    }
  }'
```

`class` and `fields` use the names and allowed values from the schema endpoint.
The class, when provided, must be a `Document` subclass.
When a schema contains status fields, status names are resolved server-side just
as they are during creation. Updates are delegated to the registered integration
target factory, which also handles product-specific markup updates.

## Cards

Cards have dedicated routes; the class defaults to `Card`, so it normally does
not need to be sent. A workspace-specific Card subclass can be selected with
an optional `class` name; classes outside the `Card` hierarchy are rejected.

- `GET /api/v2/{workspaceId}/cards?space=<card-space-name>&limit=<n>` lists
  cards. Both `space` and `limit` are optional; `space` is resolved only among
  Card spaces.
- `GET /api/v2/{workspaceId}/cards/{id}` reads one card strictly by id.
- `POST /api/v2/{workspaceId}/cards` creates a Card. Body: `space`, `fields`,
  and optionally `class`.
- `PATCH /api/v2/{workspaceId}/cards` updates a Card strictly by `id`. Body:
  `id`, `fields`, and optionally `class`.

Creation and updates use the same Card integration factory as other
integrations, including markup handling and Card-space validation. Comments and
messages for a Card use the unified routes below and likewise do not require a
class name.

## Markup fields

Creation factories use the collaborator service for markup fields such as
document or card content. Set `COLLABORATOR_URL` for the transactor to create
or update these fields. The field value must use Huly markup.

## Comments and chats

The workspace model selects the backend; callers use one route per feature.

| API | Read | Write | Target |
| --- | --- | --- | --- |
| Comments | `GET /api/v2/{workspaceId}/comments?id=<id>` for a Card, or `?class=<class-name>&id=<id>` for another target | `POST /api/v2/{workspaceId}/comments` | A document or communication target selected by visible class name and id. |
| Chats | `GET /api/v2/{workspaceId}/chats/messages?id=<id>` for a Card, `?class=<class-name>&id=<id>`, or `?channel=<channel-name>` | `POST /api/v2/{workspaceId}/chats/messages` | A communication target by visible class name and id, or a unique old chat channel by name. |

Comment write body:

```json
{
  "target": { "class": "Issue", "id": "<issue-id>" },
  "content": "<p>Comment text</p>"
}
```

For a Card, `target.class` is optional and defaults to `Card`:

```json
{ "target": { "id": "<card-id>" }, "content": "<p>Comment text</p>" }
```

Chat write body for an old channel:

```json
{ "channel": "Engineering", "content": "<p>Hello</p>" }
```

For a target-based chat, use the same `target` object as a comment. The API
uses the operation declared by that target's workspace capability; its class
also defaults to `Card` when omitted.

## Contacts

The Contact API deliberately covers only `Person`, `Organization` and
`Employee`:

- `GET /api/v2/{workspaceId}/contacts?type=Person|Organization|Employee`.
  `type` is optional and defaults to `Person`; `limit` is optional, defaults to
  `100`, and can be at most `1000`.
- `POST /api/v2/{workspaceId}/contacts` creates a `Person` or `Organization`.
- `PATCH /api/v2/{workspaceId}/contacts` updates a `Person` or `Organization`
  strictly by `id`.

Employees are read-only here. They are tied to workspace accounts and are
managed by the account/contact provisioning flow, so this API cannot create an
employee or assign an account identity to an arbitrary person.

```json
{ "type": "Person", "name": "Ada Lovelace", "city": "London" }
```

`PATCH` accepts `type`, `id`, plus any of `name`, `city`, and (for a Person)
`birthday`.

## Calendar and ToDos

Calendar events use a calendar's visible name, never its internal ID:

- `GET /api/v2/{workspaceId}/calendar/events?calendar=<calendar-name>&limit=<n>`.
  `limit` is optional, defaults to `100`, and can be at most `1000`.
- `POST` and `PATCH` at `/api/v2/{workspaceId}/calendar/events`

Creating an event requires `calendar`, `title`, `date`, and `dueDate`. The
calendar must be visible and writable for the API-key user. Updating is limited
to events owned by that user; recurring-event manipulation is not exposed.
Participants are resolved by unique contact names.

ToDos are available through `/api/v2/{workspaceId}/todos`:

- `GET` lists ordinary tasks by default; `GET ?type=ProcessToDo` lists process
  tasks. `limit` is optional, defaults to `100`, and can be at most `1000`.
- `POST` creates an ordinary personal ToDo only.
- `PATCH` updates title, description, due date, priority, or visibility by id.

There is no `doneOn` input and no completion endpoint. This specifically means
that a `ProcessToDo` cannot be completed, approved, or otherwise advanced via
v2; it must continue through its process action in the product.

## Controlled Documents

Controlled Documents do not use the integration-factory document create or
patch routes. Those routes reject the `ControlledDocument` class family,
avoiding bypasses of the lifecycle implemented by the Controlled Documents UI.
Use the dedicated routes below; they invoke the same model-declared operations
and retain the Controlled Documents lifecycle guards.

- `GET /api/v2/{workspaceId}/controlled-documents?limit=<n>` lists visible
  controlled documents. `limit` defaults to `100` and can be at most `1000`.
- `GET /api/v2/{workspaceId}/controlled-documents/{id}/versions` returns
  `current` and `archived` version arrays.
- `POST /api/v2/{workspaceId}/controlled-documents/{id}/drafts` creates the
  next draft (or restores the latest deleted draft), including the change
  control, project link, content reference, and active attachments.
- `POST /api/v2/{workspaceId}/controlled-documents/{id}/review` sends a draft
  for review. Body: `{ "reviewers": ["Employee name"] }`.
- `POST /api/v2/{workspaceId}/controlled-documents/{id}/approval` sends an
  eligible document for approval. Body: `{ "approvers": ["Employee name"] }`.

Reviewer and approver names must identify one unique active employee. These
operations enforce the same critical UI guards: the API-key user must be the
document owner; the version must be latest; only a draft may enter review; an
approval requires a new draft or a reviewed document, no unresolved document
comments, and released training. Creating either request atomically rejects a
second active review or approval request. External approvers are intentionally
not accepted by v2 yet, because their flow also grants and revokes collaborator
access across the document, project link, and change control.

## Errors

The API returns `400` when a named class or field cannot be found, when a name
is ambiguous, when the document ID is not found for the supplied class, or when
the target class cannot be created or updated by its registered factory.
Existing v1 endpoints remain unchanged.
