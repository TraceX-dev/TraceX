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

An action is allowed when **either** source permits it. That is what makes a static access level
and an admin-configurable permission mutually exclusive designs for the same capability: a
`TxAccessLevel` that opens an action cannot be closed again by turning a permission off. A
capability an administrator is meant to control therefore declares **only** the permission, and
the permission declares every `Tx` kind it covers:

```ts
txClasses?: Ref<Class<Tx>>[]   // defaults to [txClass ?? TxCreateDoc]
```

Approving a request is an update and a mixin; managing collaborators is a create and a remove.
Each is one checkbox to the administrator, so each is one `ClassPermission` listing its tx kinds,
with no `TxAccessLevel` beside it.

This layer never decides whether the caller may access a particular document; that is Layer 2's
responsibility.

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

### One kind carries every ownership rule

There is a single mechanism — a **relation path** from the caller's own identity to the rows it
may reach. Everything else in the union describes the *absence* of a row rule.

```ts
type RowVisibilityPolicy =
  | { kind: 'relation', path: RelationPath, reason?: string }
  | { kind: 'spaceMember' }
  | { kind: 'spaceScoped', reason: string }
  | { kind: 'denyAll' }

interface RelationPath {
  from: IdentityKind          // 'accountUuid' | 'personId' | 'socialId' | 'linkId'
  steps: TraversalStep[]      // 0 … MAX_TRAVERSAL_DEPTH (2)
  to?: string                 // field on the protected document; defaults to `_id`
  includeSelf?: boolean       // union the caller's own identity into the result
}

interface TraversalStep {
  via: Ref<Class<Doc>> | { classFromField: string }
  match: string               // field on `via` compared with the values carried in
  emit: string                // field on `via` whose values are carried on
  where?: NamedConstraint
  keepIncoming?: boolean
}
```

A step reads `via`, keeps the records whose `match` field carries a value from the previous step,
and passes on their `emit` field. Array-valued `match` fields are matched by containment;
array-valued `emit` fields are flattened.

**A path of length zero is plain ownership.** "This field of the document equals my identity" is
"equals a value reached in zero hops", so `ownBy(field, identity)` is sugar, not a separate kind.
`linkedViaCollaborator(...)` is sugar for one or two hops. Model declarations read unchanged.

| Policy | Meaning |
| --- | --- |
| `relation` | The row is reachable from the caller's identity along the declared path. |
| `spaceMember` | Ordinary membership in a real space provides the restriction. |
| `spaceScoped` | No additional row restriction after Layer 1 and ordinary space checks. It does **not** mean anonymous or workspace-wide access. A `reason` records why this is safe. |
| `denyAll` | Access is denied because ownership cannot be verified. |

`spaceScoped` and `spaceMember` declare that a class has no row rule of its own. The middleware
uses that distinction directly: search hides system spaces from restricted roles, and a class
whose policy actually narrows rows (`relation` or `denyAll`) is exempt from that blanket
exclusion, because its own policy is the restriction. A class declaring `spaceScoped` keeps the
exclusion.

### Bounds

A traversal is a small query language inside the security layer, so it is bounded by construction:

- **Depth ≤ `MAX_TRAVERSAL_DEPTH` (2).** Every known rule, person visibility included, fits in two
  hops. A third is a decision to take deliberately, not one more array element.
- **`where` is a `NamedConstraint`, never a free-form query.** Named constraints stay enumerable,
  testable and explainable; arbitrary queries are none of those.
- **Overflow denies.** Each step is capped at `MAX_TRAVERSAL_VALUES`; reaching it answers
  "forbidden", never "allowed". A policy that cannot be evaluated exactly must not resolve to
  access.
- **Steps read with system context**, and the value set is derived from the caller's identity
  alone. This is also what stops recursion: an intermediate class is not re-checked against its
  own row policy.
- **Steps are cached** per (step signature, incoming values), invalidated by transactions on the
  intermediate class.

### `includeSelf`

Unions the caller's own identity values into the result: *me, plus whoever I reach*. Person
visibility needs it — an account with no shared space must still see itself. It is only meaningful
when `to` holds values of the same kind as `from`, and cannot combine with a document-relative
step.

### `classFromField` and per-document evaluation

Some rules depend on a parent whose class is only known from the row itself. `core.class.Collaborator`
is the case in point: a row may hang off a card, a channel, or anything else, and the rule is
"did I create the document it attaches to". Such a step takes its class from a field on the row:

```ts
{ via: { classFromField: 'attachedToClass' }, match: 'createdBy', emit: '_id' }
```

A policy using it cannot be pushed into a query, so the resolver answers `perDocument`. On the
write path the middleware fetches the row and judges it whole; the final step is narrowed to the
value being checked, so the query stays `{ createdBy: <me>, _id: <parent> }` rather than
enumerating everything the caller ever created. **On read paths — `findAll` and full-text search —
`perDocument` denies.** There is no query that expresses the rule, and the safe answer is to
return nothing.

### One description, two forms of application

A policy is compiled once into a set of permitted values, and both application forms come from it:
the predicate merged into the `findAll` query, and the post-filter applied to full-text results.
A policy author writes the rule once and never knows which path applied it. Known-id bypass stays
disabled in the search form: a search hit is not proof that the caller obtained the id from a
document it was allowed to read.

Row policies attach to the single query object that reaches storage. `skipFindCheck` deployments
delegate *space-level* security to the DB adapter and send the caller's original query; everyone
else sends the space-narrowed one. Either way the row policy narrows the query that is executed,
so the two modes need no separate test matrix.

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

The inventory is **read out of the loaded model**, not maintained by hand:
`resolveRegisteredRowVisibilityPolicies` enumerates every class declaring the mixin,
`validateRowVisibilityRegistrations` reports malformed declarations (traversal too deep, a bypass
without justification, a `spaceScoped` exemption with no recorded reason), and
`renderRowVisibilityPolicyTable` generates the kind-level table the invariant test checks.

| Class | Path | Notes |
| --- | --- | --- |
| `core.class.Collaborator` | read: `collaborator == accountUuid`; write: via the row's own `attachedToClass`, `createdBy == socialId`, matched on `attachedTo` | Reading asks "am I the collaborator", writing asks "did I create the parent" — different questions, so two policies. Known-ID lookup enabled for references from an already visible parent (`knownIdBypassFields: ['attachedTo']`). Layer 1 is `card.ids.GuestCollaboratorClassPermission` alone, covering create and remove. |
| `contact.class.Person` | via `Space`, `members` → `members`, matched on `personUuid`, `includeSelf` | People are discoverable through shared real-space membership. Replaces the bespoke middleware branch that used to implement this in code. No known-ID bypass. |
| `contact.class.SocialIdentity` | `attachedTo == personId` | Known-ID lookup enabled for references from an already visible person. |
| `love.class.MeetingMinutes` | via room `Collaborator` | Known-ID lookup enabled for references from an already visible room. |
| `love.class.RoomInfo`, `love.class.ParticipantInfo` | via room collaborators, chained through `MeetingMinutes` | Same shared policy object (`roomActivityVisibility`). |
| `love.class.PendingRecording` | via room collaborators | Known-ID bypass omitted and therefore disabled. |
| `love.class.Room`, `love.class.Floor` | `spaceScoped` | Office layout must render for every guest; meeting content stays collaborator-restricted. |
| `love.class.DevicesPreference` | `createdBy == socialId` | |
| `hr.class.Request` | `attachedTo == personId` | Known-ID lookup enabled for visible workflow references; `attachedTo` is not a bypass field. |
| `notification.class.PushSubscription` | `user == accountUuid` | Known-ID bypass disabled by default. |
| `guest.class.PublicLink` | `_id == linkId` | Known-ID bypass stays disabled: the id is the session's bearer secret. |
| `process.class.ApproveRequest` | `user == personId` | Layer 1 is `process.ids.GuestApproveRequestClassPermission` alone, covering update and mixin. |
| `pulse.class.DocumentPresence`, `pulse.class.TypingIndicator` | `spaceScoped` | Ephemeral, no business data, expires by TTL. |
| `chunter.class.ChatMessage`, `chunter.class.ThreadMessage` | read `spaceScoped` (channel space governs it), write `createdBy == socialId` | |
| `attachment.class.Attachment` | read `spaceScoped`, write `createdBy == socialId` | |
| `activity.class.SavedMessage` | `createdBy == socialId` | |
| `card.class.Card` | read `spaceScoped` (ordinary space membership), write `createdBy == socialId` | `scopeActivityToOwner: true`. |

## Extending the model

- **Restricted role:** add it to `roleOrder` below `AccountRole.User`.
- **Class in a shared or system space:** declare the narrowest suitable `RowVisibilityPolicy`. The
  middleware fails closed for a class with no policy, and the invariant test rejects a malformed
  one.
- **Admin-controlled capability:** declare a `ClassPermission` listing every `Tx` kind it covers in
  `txClasses`, and **no** `TxAccessLevel` for the same action — otherwise the static level opens
  what the permission cannot close.
- **Identity kind:** extend `IdentityKind` and `AccountIdentityResolver` together.

## Known model defect

`hierarchy.isDerived(x, core.class.Doc)` is `false` for 13 classes — every descendant of
`preference.class.Preference`, including `activity.class.SavedMessage`, which carries a row
policy. Their ancestor chains are truncated at `Preference`, so they are also missing from
`getDescendants`. This predates this model and is why the policy inventory reads the classifiers
directly instead of walking descendants. Any security check written as
`isDerived(_class, core.class.Doc | AttachedDoc | …)` silently skips these classes; the direction
of the error is fail-closed, but it is a trap worth fixing at the source.
