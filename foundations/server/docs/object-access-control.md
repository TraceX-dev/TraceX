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

- `core.mixin.AccessControlled` on a document — its policy: `read`, `owners` (server-managed: the creator).
  A document with it is a **security root**.
- `core.mixin.ClassAccessPolicy` on a class — enables the mechanism: `membersField`, `parent` (default `attachedTo`).
- `core.mixin.AccessParent` on a class — which reference fields lead to a root (default `attachedTo`).
  Declared for activity and notification classes that point to an object by `objectId` / `srcDocId` / etc.

To protect a new class: add `ClassAccessPolicy` to it; add `AccessParent` to classes that reference it other than
by `attachedTo`. Helpers shared by client, server and triggers: `foundations/core/packages/core/src/objectAccess.ts`.

## How it works

1. **Marking** — `ObjectAccessMarkerMiddleware` (after `ApplyTxMiddleware`, so it sees user and trigger txes):
   sets `accessRoot` on the root (= its own id), on every descendant at creation, and on every `TxCUD` of them.
   Clients cannot set or change `accessRoot`. Public objects are not marked; restricting a public object
   backfills marks over its subtree and its stored txes.
2. **Reading** — `ObjectSecurityMiddleware` (after `SpaceSecurityMiddleware`): queries on protected domains get
   `accessRoot: { $in: [...readableRoots, null] }`; `$lookup` and full-text results are filtered the same way.
   Unknown roots are closed. Once a workspace has had a restricted object, the filter stays on.
3. **Broadcast** — transactions with `accessRoot` reach only readers; readers whose access changes get
   `WorkspaceEvent.SecurityChange` and refresh their queries.
4. **Writing** — writes into a root the account cannot read are rejected. The policy is changed only by a
   `TxMixin` of `AccessControlled`; raw updates of the mixin data or `accessRoot` are rejected.
5. **Notifications** — triggers notify only readers (`getObjectAccessReaders`), since push and e-mail cannot be
   recalled.

State (roots, members, parent participants) is kept in memory per workspace (one transactor per workspace) and
updated after transactions are stored.

## Permissions

- Change the level, remove private members: owners (creator), maintainers who can read the object,
  workspace owners (also without read access, to recover a locked object).
- Private members can invite others and leave; a private object always keeps at least one member.

## Limitations

- No nested roots; documents cannot move between roots.
- Becoming a collaborator of the parent (following it) grants access to its Participants-level objects.
- Blob/file URLs and queue consumers (AI bot, integrations) are not restricted.
- The allow-list grows with the number of restricted objects.
