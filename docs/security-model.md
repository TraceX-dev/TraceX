# Restricted-role security model

Referenced from `foundations/server/packages/middleware/src/tests/rowVisibilityInvariant.test.ts`
as "the design doc" - this is that doc. It covers accounts on a role ordered below
`AccountRole.User` (today: `ReadOnlyGuest`, `DocGuest`, `Guest`; any future role added below
`User` is covered automatically, see [Restricted-role threshold](#restricted-role-threshold)).
`User` and above bypass everything described here.

The type declarations referenced throughout live in
`foundations/core/packages/core/src/security.ts`. The enforcement code lives in
`foundations/server/packages/middleware/src/{accessGate,rowVisibility,spaceSecurity,guestPermissions,guestVisibility}.ts`.

## Restricted-role threshold

`roleOrder` (`@hcengineering/core`) is the single source of truth for how privileged a role is:

```ts
export const roleOrder: Record<AccountRole, number> = {
  [AccountRole.ReadOnlyGuest]: 5,
  [AccountRole.DocGuest]: 10,
  [AccountRole.Guest]: 20,
  [AccountRole.User]: 30,
  [AccountRole.Maintainer]: 40,
  [AccountRole.Owner]: 50,
  [AccountRole.Admin]: 100
}

export function isRowLevelRestricted (role: AccountRole): boolean {
  return roleOrder[role] < roleOrder[AccountRole.User]
}
```

Both layers below are gated on `isRowLevelRestricted(account.role)`. Neither layer hardcodes a
list of guest roles, so a new role added below `User` is covered without touching either layer -
only its own `roleOrder` entry decides whether it's restricted.

## Layer 1 — class/action access

*"May this role reach this class/tx kind at all?"* Enforced in `accessGate.ts`, called from
`GuestPermissionsMiddleware`. Two independent sources are combined:

1. **Admin-configurable**: `ModulePermissionGroup` docs, each listing `Ref<Permission>`s enabled
   for a role; `ClassPermission` resolves a permission to the target class and `Tx` kind it
   covers. Edited from Settings → Guest permissions
   (`plugins/setting-resources/src/components/SpaceAccessSettings.svelte`). Cached in
   `ClassAccessResolver`, invalidated when a `ModulePermissionGroup`/`ClassPermission` document
   changes (including nested inside a `TxApplyIf`).
2. **Code-declared, not admin-configurable**: `core.mixin.TxAccessLevel`, giving a class a static
   minimum role for create/update/remove:

   ```ts
   export interface TxAccessLevel extends Class<Doc> {
     createAccessLevel?: AccountRole
     removeAccessLevel?: AccountRole
     updateAccessLevel?: AccountRole
     isIdentity?: boolean
   }
   ```

   `isIdentity: true` additionally lets an account update/mixin a document that *is* its own
   identity (a `Person`/`SocialIdentity` matching the caller), independent of `updateAccessLevel`.

`isClassAccessAllowed` (`accessGate.ts`) returns true if either source allows the tx. Ownership of
the target document (`createdBy`) is **not** considered at this layer - that's Layer 2.

## Layer 2 — row visibility

*"Given a class Layer 1 already allows, which specific rows may this role see or touch?"*
Enforced in `rowVisibility.ts`, called from both `SpaceSecurityMiddleware` (`findAll`,
`searchFulltext`) and `GuestPermissionsMiddleware` (create/update/remove).

Declared once per class via `core.mixin.RowVisibility`, next to the class definition, by the
plugin author - never admin-configurable:

```ts
export interface RowVisibility extends Class<Doc> {
  policy: RowVisibilityPolicy
  writePolicy?: RowVisibilityPolicy   // stricter policy for create/update/remove; defaults to policy
  allowKnownIdBypass: boolean
  knownIdBypassFields?: string[]
  scopeActivityToOwner?: boolean
}
```

### Policy kinds (`RowVisibilityPolicy`)

| Kind | Meaning |
| --- | --- |
| `ownerField` | `doc[field]` must equal the caller's resolved identity (`IdentityKind`: `accountUuid` \| `personId` \| `socialId` \| `linkId`). |
| `linkedViaRecord` | Ownership via a separate link record (e.g. `core.class.Collaborator`); optionally chained `through` another class before narrowing the protected document. |
| `spaceMember` | No extra narrowing - ordinary real-space membership already covers it. |
| `denyAll` | No way to verify ownership; always denied (subject to `allowKnownIdBypass`). |
| `publicReadable` | Deliberately open to any role Layer 1 already let in. Requires a `reason` string, so the intent survives code review and isn't confused with "policy not written yet". |

### `allowKnownIdBypass`

If `true`, a `findAll`/`searchFulltext` query that already narrows one of `knownIdBypassFields`
(defaulting to `_id`) to a specific value or `$in` set skips the policy check - the caller is
trusted to only know that identifier because it already saw the referencing document. Set this to
`false` whenever the identifier doubles as a secret (`guest.class.PublicLink._id`, a session
`linkId`) or whenever knowing the id says nothing about being allowed to see it.

`allowKnownIdBypass` is **not honored** for full-text search results or for mutation checks
(`resolveMutation`/`canUpdate`/`canCreate` in `rowVisibility.ts`) - a caller-supplied identifier is
never sufficient proof of authorization there, independent of the per-class setting.

### `scopeActivityToOwner`

Opts a class into `GuestActivitySettings.activityScope` (`own` / `collaborator` / `any`, default
`any`): restricted-role reads of an `AttachedDoc` (chat message, etc.) attached to this class get
narrowed to the caller's own activity, or activity on documents it collaborates on, instead of the
attached class's own (often `publicReadable`) policy. Only set on "personal" document classes
(e.g. `card.class.Card`) - leave unset for shared spaces like channels, where every member should
keep seeing all activity.

## Declared policies

Source of truth: `grep -rn "core.mixin.RowVisibility" models/ server-plugins/`. The list below is
also enforced by `rowVisibilityInvariant.test.ts`'s `SENSITIVE_CLASSES` - a class landing in a
shared or system space (`core.space.Workspace`, `contact.space.Contacts`, ...) is expected to
either appear there with a real policy or be covered by an explicit, reviewed exemption; that test
fails the build otherwise.

| Class | Policy | Notes |
| --- | --- | --- |
| `core.class.Collaborator` | `ownerField(collaborator, accountUuid)` | `knownIdBypassFields: ['attachedTo']`; Layer 1 create/remove open from `ReadOnlyGuest`, still gated by `card.ids.GuestCollaboratorClassPermission` (see `canEditDocCollaborator`). |
| `contact.class.SocialIdentity` | `ownerField(attachedTo, personId)` | `allowKnownIdBypass: true`. |
| `love.class.MeetingMinutes` | `linkedViaRecord` via room `Collaborator` | |
| `love.class.RoomInfo`, `love.class.ParticipantInfo` | `linkedViaRecord` via room collaborators, chained `through` `MeetingMinutes` | Same shared policy object (`roomActivityVisibility`). |
| `love.class.PendingRecording` | `linkedViaRecord` via room collaborators | `allowKnownIdBypass: false`. |
| `love.class.Room`, `love.class.Floor` | `publicReadable` | Office layout must render for every guest; the meeting content itself stays collaborator-restricted. |
| `love.class.DevicesPreference` | `ownerField(createdBy, socialId)` | |
| `hr.class.Request` | `ownerField(attachedTo, personId)` | `allowKnownIdBypass: true`, but `attachedTo` itself is excluded from known-id bypass fields. |
| `notification.class.PushSubscription` | `ownerField(user, accountUuid)` | `allowKnownIdBypass: false`. |
| `guest.class.PublicLink` | `ownerField(_id, linkId)` | `allowKnownIdBypass: false` - the id is the session's bearer secret. |
| `process.class.ApproveRequest` | `ownerField(user, personId)` | Layer 1 update open from `ReadOnlyGuest`. |
| `pulse.class.DocumentPresence`, `pulse.class.TypingIndicator` | `publicReadable` | Ephemeral, no business data, expires by TTL. |
| `chunter.class.ChatMessage`, `chunter.class.ThreadMessage` | read `publicReadable` (channel space governs it), write `ownerField(createdBy, socialId)` | |
| `attachment.class.Attachment` | read `publicReadable`, write `ownerField(createdBy, socialId)` | |
| `activity.class.SavedMessage` | `ownerField(createdBy, socialId)` | |
| `card.class.Card` | read `publicReadable` (ordinary space membership), write `ownerField(createdBy, socialId)` | `scopeActivityToOwner: true`. |

A class in a shared/system space with **no** `RowVisibility` mixin and no explicit exemption is
denied outright for restricted roles by `SpaceSecurityMiddleware` - the default is closed, not
open.

## Extending the model

- **New restricted role**: add it to `roleOrder` below `AccountRole.User`. Both layers pick it up
  automatically.
- **New class living in a shared/system space that a restricted role must reach**: declare
  `core.mixin.RowVisibility` next to the class, picking the narrowest `RowVisibilityPolicy` kind
  that fits; add it to `SENSITIVE_CLASSES` in `rowVisibilityInvariant.test.ts` and to the table
  above. Add a `core.mixin.TxAccessLevel` (or a `ModulePermissionGroup`/`ClassPermission`) if the
  role also needs to write it.
- **New identity kind** (beyond `accountUuid`/`personId`/`socialId`/`linkId`): extend `IdentityKind`
  and `AccountIdentityResolver.resolve` (`rowVisibility.ts`) together.
