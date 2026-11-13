# Collaborative document tools

Every MCP call requires an explicit `workspace` ID from `my_workspaces`. The editor and MCP must use the same collaborator service.

## Discover a document

Use `card_search`, `card_get`, `object_lookup`, or `fulltext_search`. Results include:

```json
{
  "collaborativeFields": [
    {
      "key": "content",
      "label": "Content",
      "docName": "<opaque address returned by the tool>"
    }
  ]
}
```

Copy the chosen `docName` unchanged. It addresses one field in the selected workspace. Never construct it from object IDs or blob references, decode it, or reuse it in a different workspace. Addresses do not contain workspace IDs. The current internal representation may change to generated IDs later.

Visible class-owned and inherited `TypeCollaborativeDoc` fields are discoverable. Tag mixin fields are excluded until editor, API and storage identities are aligned. Readonly fields can be read; their presence in this list does not grant write access.

All node and mark types in the active editor schema are available to operations. There is no separate type allowlist; native structure, attribute validation and readonly metadata still apply.

## Read only the schema you need

The `collab_schema` tool description contains one complete static catalog of nodes and marks, their writable attributes, short descriptions, and non-obvious nesting rules. It is generated from Awareness and the same ServerKit used by collaborator when the tool is initialized. Discover names from this description; request details and JSON examples only for the types you need. No workspace schema index or schema-version cache is needed.

```json
{
  "workspace": "<workspace ID>",
  "nodes": ["paragraph"],
  "marks": ["bold"]
}
```

Pass this to `collab_schema`. Without filters it returns the full model. When either filter is present, only explicitly named definitions are returned; an omitted category selects none. Empty arrays select no definitions. References in content constraints remain type names; dependencies are not expanded. Unknown names are errors. `topNode` is always returned.

## Find and edit

`collab_outline.typesPresent` lists the addressable node types in the entire document, including nested nodes and nodes outside the requested page. Use these values with `collab_find.type`. Unknown type names are rejected with nearby schema names; a known type absent from the document returns no matches. Invalid node content and insertion positions include schema or position hints.

1. Call `collab_find` with `workspace`, the returned `docName`, `type: "paragraph"`, and `text: "MCP_E2E_BEFORE"`. At least one of `text` or `type` is required by the server. Both filters use AND. Ancestors and descendants can both match; choose the intended node.
2. If the target and literal change are unambiguous, pass its returned `ref` directly to `collab_apply`:

```json
{
  "workspace": "<workspace ID>",
  "docName": "<returned docName>",
  "ops": [
    {
      "op": "replace_text",
      "ref": "<returned ref>",
      "search": "MCP_E2E_BEFORE",
      "replace": "MCP_E2E_AFTER"
    }
  ]
}
```

Use `collab_read` first when context is needed, the intended target is unclear, or the task requires rewriting content. An explicit mark change on known literal text can also use `find → apply`. Server checks still reject absent or ambiguous text matches and invalid operations. Successful writes return current node handles and subtree hashes; later operations in one batch follow their targets. A failed batch applies no operations.

3. Verify the result with `collab_read` and in the open editor. API changes should appear without reloading. Edit the same paragraph manually, then read it through MCP again. Reload the editor to verify persistence.

## Delete a subtree

Always call `collab_read` immediately before deletion, inspect the complete subtree, and copy its hash:

```json
{
  "workspace": "<workspace ID>",
  "docName": "<returned docName>",
  "ops": [
    {
      "op": "delete_node",
      "ref": "<read ref>",
      "expect": { "hash": "<read hash>" }
    }
  ]
}
```

The hash covers attributes, marks and nested content. A change after the read causes `STALE_REFERENCE`; read again before deciding on a new deletion. Never automatically retry a write after an uncertain timeout or connection failure. Read the current state first.

## Common errors

Collab tool-execution failures use the MCP error channel (`isError: true`) with the same JSON shape:

```json
{
  "error": {
    "code": "TEXT_NOT_FOUND",
    "message": "No literal text match in the target.",
    "retryable": false,
    "outcome": "not_applied",
    "opIndex": 0
  }
}
```

`outcome: "not_applied"` means the request was rejected before changing the document. A failed atomic batch includes the zero-based `error.opIndex`; other failures omit it. `outcome: "unknown"` means a write may have reached the document: read its current state before deciding on another write. No collab error permits automatic retry. Confirmed `collab_apply` success returns `{ "ok": true, "results": [...] }`.

For `paragraph` and `heading`, `textAlign` is a nullable string whose enum is derived from the configured TextAlign extension. The shared profile allows `left`, `center`, and `right`, with `null` restoring the default. Table cell text alignment has the same values. Attribute updates and inserted JSON are checked against these native validators. `collab_schema` also includes a minimal valid `paragraph.example` that can be used with `insert_node`.

## API contracts

MCP schemas live beside the tools. Independent REST schemas live in `server/collaborator/src/agent/schema.ts`; both are checked against the plain TypeScript API contracts. The client package has no TypeBox dependency. Every REST method validates decoded input before calling the document service and validates output before sending it. Invalid request shapes return `invalid_request` with `outcome: "not_applied"`. An invalid response after a write is treated as `outcome: "unknown"`; the write may already have committed. Native editor validation still checks schema-specific attribute values, content structure and readonly metadata.
