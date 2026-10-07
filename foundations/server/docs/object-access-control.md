# Object access control

Restricts who can see a single object (and everything that belongs to it) inside its space.
Effective access = **space access ∩ object policy**: a policy can only narrow access, never widen it.
First consumer: discussions (`chunter.class.Discussion`).

## Levels

| Level | `AccessControlled.read` | Readers |
|---|---|---|
| Public | no mixin, or `{ kind: 'space' }` | everyone with access to the space |
| Participants | `{ kind: 'parentParticipants' }` | collaborators of the parent object |
| Private | `{ kind: 'members' }` | members of the object (`ClassAccessPolicy.membersField`) |

Readers can read and write. Members are used only by Private.

## Model

- `core.mixin.ClassAccessPolicy` on a class — enables the mechanism: `membersField`, `parent` (default `attachedTo`).
  **Every** document of the class is a security root from its creation (public ones too), so a level change never
  re-marks existing content. Objects created before the class got its policy need a migration that marks them
  and their content (discussions: `discussions-object-access-v1` in `models/chunter`).
- `core.mixin.AccessControlled` on a root — its policy: `read` and `owners` (server-managed: the creator).
- `core.mixin.AccessParent` on a class — opts it in: the reference fields leading to a root
  (e.g. messages, replies, reactions, attachments, activity and notifications).

Classes opt in with `ClassAccessPolicy` or `AccessParent`; other classes are not affected and add no overhead.
Helpers shared by client, server and triggers: `foundations/core/packages/core/src/objectAccess.ts`.

## How it works

Nothing is loaded at workspace start. Roots, parent participants and document marks are read on demand
and kept in bounded in-memory caches (one transactor per workspace), updated after transactions are stored.

1. **Marking** — `ObjectAccessMarkerMiddleware` (after `ApplyTxMiddleware`, so it sees user and trigger txes)
   sets `accessRoot` on documents of protected classes and on their `TxCUD`s. Marks are server-managed.
2. **Reading** — `ObjectSecurityMiddleware` (after `SpaceSecurityMiddleware`) filters query results, lookups and
   full-text results by the mark. Filtering happens after the query, so a page of a mixed list may come shorter
   than its limit.
3. **Broadcast** — marked transactions reach only readers; readers whose access changes get
   `WorkspaceEvent.SecurityChange` and refresh their queries.
4. **Writing** — writes into a root the account cannot read are rejected. The policy is changed only by a
   `TxMixin` of `AccessControlled`.
5. **Notifications** — triggers notify only readers (`getObjectAccessReaders`).

## Reference presentation (PostgreSQL)

Ref attributes can request a limited object for its existing presenter, even without access to its space.
Relations remain subject to access checks and omit inaccessible targets.

1. Declare `requiredFields?: string[]` in the class's `view.mixin.ObjectPresenter` model configuration.
   This is the list of object fields allowed for reference presentation, for example `['title', 'version']`.
2. Queries that load saved Ref values use `{ unsecured: true }` in `FindOptions`. Queries listing candidates
   for selection keep normal access checks.
3. `FindSecurityMiddleware` preserves the flag. Immediately after it, `ObjectProjectionMiddleware` resolves
   the queried class's presenter mixin (including inheritance) and **replaces** the client's projection with
   `requiredFields` plus `_id`, `_class` and `space`.
   If `requiredFields` is absent, it removes `unsecured` and preserves the original projection.
   An explicit empty list allows only the three mandatory fields.
4. The PostgreSQL adapter skips its access predicate for the direct query and its `total` count when
   `unsecured` is still true. The existing presenter renders the returned object.
5. The client caches normal and `unsecured` objects separately, including lookup fallback and transaction
   refresh queries, so a limited reference object cannot satisfy a normal read from the shared ID cache.

This flag does not bypass `ObjectSecurityMiddleware` or enable unsecured nested queries. Object security may
still hide protected targets and add its internal `accessRoot` field to the projection.
Dynamic Card fields marked `showInPresenter` and data
loaded through additional queries or `$lookup` are not automatically included in `requiredFields`.

## Permissions

- Change the level, remove private members: owners (creator), maintainers who can read the object,
  workspace owners (also without read access, to recover a locked object). Migrated objects have no owners.
- Private members can invite others and leave; a private object always keeps at least one member. Members of a
  non-private object are set only by managers.

## Constraints

- No nested roots; documents cannot move between roots.
- Becoming a collaborator of the parent grants access to its Participants-level objects. A client that is not
  connected when its access changes sees the change after a reload.
- The number of objects in a parent's collection (e.g. its discussions) includes restricted ones.
