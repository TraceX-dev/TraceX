<!--
Copyright © 2026 TraceX SAS.

Licensed under the Eclipse Public License, Version 2.0 (the "License");
you may not use this file except in compliance with the License. You may
obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.

See the License for the specific language governing permissions and
limitations under the License.
-->

# Guest permissions

## Purpose

`GuestPermissionsMiddleware` is the server-side authority for transactions made by guest accounts. Client checks may hide unavailable actions, but they must not be treated as access control.

The middleware combines three sources of access:

1. account role rules;
2. `TxAccessLevel` class mixins and the generic own-document rule;
3. guest policies resolved from `ModulePermissionGroup` and `ClassPermission` documents.

## Role behavior

| Role | Behavior |
| --- | --- |
| `User` and higher | Transactions pass through this middleware. Changes to permission documents invalidate the guest policy cache. |
| `DocGuest` and `ReadOnlyGuest` | All transactions are rejected. |
| `Guest` | Every CUD transaction is checked against the rules below. |

Space transactions have separate restrictions. Guests cannot remove spaces or update membership, ownership, privacy, archive, or auto-join fields. Space creation and other updates still depend on `TxAccessLevel`.

## Policy activation

A module guest policy is active for a role when all of the following are true:

1. an enabled `ModulePermissionGroup` grants an effective permission whose `guestCreate` field is `true`;
2. the group has a `spaceClass`;
3. the policy is a `ClassPermission` whose `application` matches the group application;
4. the target document belongs to a space derived from the group's `spaceClass`.

Permissions listed in `disabledPermissions` are not effective. Legacy groups may provide a `roles` array instead of `role`; if neither contains a role, `Guest` is used.

Class permissions listed directly in a permission group remain supported. They apply to their target class in any space and do not require the module activation flow.

## Class permission fields

| Field | Meaning |
| --- | --- |
| `targetClass` | Class covered by the policy, including derived classes. |
| `application` | Module that owns the policy. |
| `guestUpdateAttributes` | Attributes a guest may update on its own target document. When absent, the generic own-document rule remains available. |
| `guestUpdateMixinAttributes` | Map of mixin IDs to attributes a guest may update on its own target document. |
| `guestCreateMixinAttributes` | Map of mixin IDs to attributes allowed while the target is created in the same apply scope. Defining this field also makes later mixin updates policy-controlled. |
| `relatedCreateClasses` | Classes that may be created with a target, or attached later to a qualifying document created by the same account. |
| `sequenceNamespaces` | `CustomSequence` namespaces required by the module's creation workflow. |

An attribute whitelist accepts direct assignments and the supported update operators `$push`, `$pull`, `$inc`, `$unset`, and `$update`. Unknown operators are rejected by the policy check.

## Transaction rules

### Target creation

A guest may create a policy target when its class and space match an active policy. A policy match is authoritative and does not require a `TxAccessLevel` create permission.

If no policy covers the class, the existing `TxAccessLevel` behavior applies.

### Updates and removals

For a target with `guestUpdateAttributes`, a guest may update its own document when every changed attribute is whitelisted. A failed policy update may still be accepted by an explicit `TxAccessLevel` rule; it does not fall back to the generic own-document rule.

The generic own-document rule continues to apply to uncovered classes and to removals.

### Mixins

A creation mixin must:

- target a policy target created in the same effective apply scope;
- use the same space;
- contain only attributes listed for that mixin in `guestCreateMixinAttributes`.

Later mixin updates use `guestUpdateMixinAttributes` and require a document created by the current account. Mixins remain unrestricted for classes without a restricting policy, preserving the previous guest behavior.

### Related documents

A related class may be created in either of these cases:

- the same effective apply scope creates a permitted target in the same space;
- the new document is attached to an existing target or related document created by the same account, covered by the same policy, and stored in the same space.

Listing a related class grants creation access. Callers must therefore keep `relatedCreateClasses` minimal.

## `TxApplyIf` scope boundaries

Policy-derived creation access follows the transaction tree:

- an apply inspects only its immediate create transactions;
- its scope is inherited by nested applies;
- a nested apply extends its own scope without granting that access back to its parent or siblings;
- related classes and creation mixins must use the same space as the target that granted access.

These boundaries are security-sensitive. Recursively collecting creates from nested applies would grant access even when a nested apply's conditions do not match.

## Custom sequences

`CustomSequence` does not use the generic own-document rule. A policy must explicitly list its namespace.

Sequence creation is accepted only when:

- it occurs in `core.space.Workspace`;
- the initial value is `0`;
- the enclosing apply has an exact `notMatch` guard for `namespace`, `scope`, and `prefix`;
- no additional sequence attributes are supplied.

Sequence updates may only increment `sequence` by a positive safe integer within the hard increment limit. Resetting, decrementing, or changing other fields is rejected.

## Cache behavior

Resolved policies are cached by account role. Transactions from `User` or higher invalidate the cache when they change a `ModulePermissionGroup` or any class derived from `Permission`.

Space classes loaded during one middleware call are cached only in that call's scope.

If policy loading fails, the error is logged and the policy cache is left empty. Existing non-policy guest rules still apply.

## Client checks

Client code may mirror module activation to prevent opening workflows that the server will reject. It must use the shared effective-permission helpers and treat the result as presentation state only.

For controlled documents, the reactive check is implemented by `canGuestCreateDocumentsStore`. Server validation remains mandatory even when the UI action is hidden.

## Adding a module policy

1. Reuse a module-level permission with `guestCreate: true`, or define one if the module has no suitable switch.
2. Define each policy as a `ClassPermission` with `targetClass` and `application`.
3. Add only the update attributes, mixins, related classes, and sequence namespaces required by the workflow.
4. Keep policy IDs in the owning model plugin; do not redeclare them in a resources plugin merged into that model plugin.
5. Add the activation permission to an enabled guest `ModulePermissionGroup` with the correct `spaceClass`.
6. Add server tests for permitted operations, wrong spaces, foreign documents, disabled permissions, and nested apply boundaries.
7. Add client gating only after server enforcement is covered.

## Implementation references

- `foundations/server/packages/middleware/src/guestPermissions.ts`
- `foundations/server/packages/middleware/src/guest-permission-policies.ts`
- `foundations/core/packages/core/src/modulePermissions.ts`
- `foundations/server/packages/middleware/src/tests/guestCreatePolicies.test.ts`
- `models/controlled-documents/src/guestPolicies.ts`
