# Restricted-role security model

This model protects data accessed by accounts with a role below `AccountRole.User`:
`ReadOnlyGuest`, `DocGuest`, `Guest`, and any future role ordered below `User`.
It combines a permission to perform an action with a rule that limits the records available to
that account. Accounts with the `User` role or higher are outside this model.

## Restricted-role threshold

`roleOrder` in `@hcengineering/core` defines role privilege. A restricted role is any role below
`AccountRole.User`:

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

A new role automatically uses this model when its `roleOrder` value is below `User`.

## Layer 1 — class/action access

Layer 1 answers: *may this role perform this action on this class?* It combines two sources:

1. **Admin-configurable**: `ModulePermissionGroup` docs, each listing `Ref<Permission>`s enabled
   for a role; `ClassPermission` resolves a permission to the target class and `Tx` kind it
   covers. These are edited in Settings → Guest permissions.
2. **Code-declared, not admin-configurable**: `core.mixin.TxAccessLevel`, giving a class a static
   minimum role for create/update/remove:

   ```ts
   export interface TxAccessLevel extends Class<Doc> {
     createAccessLevel?: AccountRole
     removeAccessLevel?: AccountRole
     updateAccessLevel?: AccountRole
     isIdentity?: boolean
     allowViewerWrite?: boolean
   }
   ```

   `isIdentity: true` additionally lets an account update/mixin a document that *is* its own
   identity (a `Person`/`SocialIdentity` matching the caller), independent of `updateAccessLevel`.
   `allowViewerWrite: true` is reserved for non-business, ephemeral UI state such as presence and
   typing indicators. It does not grant viewer writes to ordinary application data.

An action is allowed when either source permits it. This layer never decides whether the caller may
access a particular document; that is Layer 2's responsibility.

## Layer 2 — row visibility

Layer 2 answers: *which records may this account see or change?* It applies to reads, full-text
search, and mutations after Layer 1 has allowed the class and action.

The plugin author declares `core.mixin.RowVisibility` next to each protected class. It is a
structural rule, not an administrator setting:

```ts
export interface RowVisibility extends Class<Doc> {
  policy: RowVisibilityPolicy
  writePolicy?: RowVisibilityPolicy   // stricter policy for create/update/remove; defaults to policy
  allowKnownIdBypass?: boolean
  knownIdBypassReason?: string
  knownIdBypassFields?: string[]
  scopeActivityToOwner?: boolean
}
```

### Policy kinds (`RowVisibilityPolicy`)

| Kind | Meaning |
| --- | --- |
| `ownerField` | `doc[field]` must equal the caller's resolved identity (`IdentityKind`: `accountUuid` \| `personId` \| `socialId` \| `linkId`). |
| `linkedViaRecord` | Ownership via a separate link record (e.g. `core.class.Collaborator`); optionally chained `through` another class before narrowing the protected document. |
| `spaceMember` | Ordinary membership in a real space provides the restriction. |
| `denyAll` | Access is denied because ownership cannot be verified. |
| `spaceScoped` | No additional row restriction applies after Layer 1 and ordinary space checks. It does not mean anonymous or workspace-wide access. A `reason` records why this is safe. |

### `allowKnownIdBypass`

Known-ID bypass is disabled when `allowKnownIdBypass` is omitted. When explicitly enabled, a
`findAll` query narrowed to `_id` or a field from `knownIdBypassFields` may skip the
row policy. Enable it only when that reference can originate from a document the caller is already
allowed to read. It must be disabled when the value is a secret, such as a public-link ID, or when
knowing the identifier does not demonstrate authorization. Every enabled bypass must provide a
non-empty `knownIdBypassReason`.

Full-text search and mutations never use this bypass: a caller-provided identifier is not proof of
authorization.

Person and Employee discovery never uses a known-ID bypass. Even an `_id`-scoped query is
intersected with the people who share a real space with the caller.

### `scopeActivityToOwner`

`GuestActivitySettings` stores both the selected security profile and its advanced activity scope.
`scopeActivityToOwner` lets `activityScope` limit activity attached to a personal
document: to the caller's own activity, to activity on documents where they collaborate, or to any
activity they can otherwise read. The default is `own`. Do not enable it for shared documents such
as channels.

## Administration

Settings → Guest permissions provides three presets for the `Guest` role:

- **Viewer:** application data can be viewed, but configurable class actions are disabled.
- **Participant:** standard create/edit-own actions are enabled; collaborator management and
  process approval remain disabled.
- **Advanced participant:** all configured class actions are enabled.

Configurations that do not match a preset are displayed as **Custom**. The Effective access view
shows the resulting applications, actions, row scopes, and permission sources. Technical module
and class permissions, together with activity visibility, remain available under Advanced
settings.

`ReadOnlyGuest`, `DocGuest`, and `Guest` are displayed separately. `DocGuest` intentionally uses a
fixed viewer profile and inherits the regular guest application availability rules; its document
access is established by the document-link session rather than by configurable class permissions.

## Declared policies

Classes in shared or system spaces need an explicit policy or exemption. Without either,
`SpaceSecurityMiddleware` denies restricted roles by default.
`securityPolicyRegistry.ts` is the central inventory used to validate registrations and generate a
policy table from the loaded model.

| Class | Policy | Notes |
| --- | --- | --- |
| `core.class.Collaborator` | `ownerField(collaborator, accountUuid)` | Known-ID lookup is enabled for references from an already visible parent; `knownIdBypassFields: ['attachedTo']`. Layer 1 create/remove remains gated by `card.ids.GuestCollaboratorClassPermission`. |
| `contact.class.SocialIdentity` | `ownerField(attachedTo, personId)` | Known-ID lookup is enabled for references from an already visible person. |
| `love.class.MeetingMinutes` | `linkedViaRecord` via room `Collaborator` | Known-ID lookup is enabled for references from an already visible room. |
| `love.class.RoomInfo`, `love.class.ParticipantInfo` | `linkedViaRecord` via room collaborators, chained `through` `MeetingMinutes` | Same shared policy object (`roomActivityVisibility`). |
| `love.class.PendingRecording` | `linkedViaRecord` via room collaborators | Known-ID bypass is omitted and therefore disabled. |
| `love.class.Room`, `love.class.Floor` | `spaceScoped` | Office layout must render for every guest; the meeting content itself stays collaborator-restricted. |
| `love.class.DevicesPreference` | `ownerField(createdBy, socialId)` | |
| `hr.class.Request` | `ownerField(attachedTo, personId)` | Known-ID lookup is enabled for visible workflow references; `attachedTo` is not a bypass field. |
| `notification.class.PushSubscription` | `ownerField(user, accountUuid)` | Known-ID bypass is disabled by default. |
| `guest.class.PublicLink` | `ownerField(_id, linkId)` | Known-ID bypass stays disabled: the id is the session's bearer secret. |
| `process.class.ApproveRequest` | `ownerField(user, personId)` | Layer 1 update open from `ReadOnlyGuest`. |
| `pulse.class.DocumentPresence`, `pulse.class.TypingIndicator` | `spaceScoped` | Ephemeral, no business data, expires by TTL. |
| `chunter.class.ChatMessage`, `chunter.class.ThreadMessage` | read `spaceScoped` (channel space governs it), write `ownerField(createdBy, socialId)` | |
| `attachment.class.Attachment` | read `spaceScoped`, write `ownerField(createdBy, socialId)` | |
| `activity.class.SavedMessage` | `ownerField(createdBy, socialId)` | |
| `card.class.Card` | read `spaceScoped` (ordinary space membership), write `ownerField(createdBy, socialId)` | `scopeActivityToOwner: true`. |

## Extending the model

- **Restricted role:** add it to `roleOrder` below `AccountRole.User`.
- **Class in a shared or system space:** declare the narrowest suitable `RowVisibilityPolicy` and
  add it to `restrictedRolePolicyClasses`. Add a class/action permission when the role must write it.
- **Identity kind:** extend `IdentityKind` and `AccountIdentityResolver` together.
