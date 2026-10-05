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

Only classes with `ClassAccessPolicy` or `AccessParent`, and the (stored) domains holding them, are ever looked
at. Helpers shared by client, server and triggers: `foundations/core/packages/core/src/objectAccess.ts`.

## How it works

Nothing is loaded at workspace start. Roots, parent participants and document marks are read on demand
and kept in bounded in-memory caches (one transactor per workspace), updated after transactions are stored.

1. **Marking** — `ObjectAccessMarkerMiddleware` (after `ApplyTxMiddleware`, so it sees user and trigger txes)
   sets `accessRoot` on documents of protected classes and on their `TxCUD`s. The root of a new document is
   looked up only when its reference points to a protected class (a message in a card needs no lookup).
   Storage addresses documents by id within a domain, so neither the class nor the space a transaction claims
   is trusted: updates and removals in a protected domain resolve the stored mark by id (cache, else one query
   per domain for the whole request). Marks sent by clients are dropped.
2. **Reading** — `ObjectSecurityMiddleware` (after `SpaceSecurityMiddleware`) filters results of protected
   domains (and the tx domain), `$lookup`, `$associations` and full-text by the mark after the query. Queries
   get no extra conditions, so a page of a mixed list may come shorter than its limit. A requested `total` of a
   paged query is corrected by one `groupBy` of marked matches per root.
3. **Broadcast** — marked transactions reach only readers; readers whose access changes get
   `WorkspaceEvent.SecurityChange` and refresh their queries.
4. **Writing** — writes into a root the account cannot read are rejected. The policy is changed only by a
   `TxMixin` of `AccessControlled`; raw updates of the mixin data or `accessRoot` are rejected.
5. **Notifications** — triggers notify only readers (`getObjectAccessReaders`), since push and e-mail cannot be
   recalled.

## Permissions

- Change the level, remove private members: owners (creator), maintainers who can read the object,
  workspace owners (also without read access, to recover a locked object). Migrated objects have no owners.
- Private members can invite others and leave; a private object always keeps at least one member. Members of a
  non-private object are set only by managers.

## Limitations

- No nested roots; documents cannot move between roots.
- Becoming a collaborator of the parent (following it) grants access to its Participants-level objects.
  Access changes through collaborators are pushed to clients only for parents in the cache; otherwise the
  client sees them after a reload.
- Counters, `groupBy` and collaborators of a root are not restricted; a full-text `total` may count hidden
  matches on other pages.
- A client can attach its own new document to a root it cannot read by naming an unprotected class in the
  reference (no lookup is made for unprotected parents). It cannot read the root this way.
- Checks run before storage: a write racing with a concurrent level or member change may pass the old rules.
- Notifications created before access was lost stay with their receivers (hidden on read, as they are marked).
- Blob/file URLs and queue consumers (AI bot, integrations) are not restricted.
