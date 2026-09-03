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
//

import core, {
  type Account,
  AccountRole,
  type Class,
  type DocumentQuery,
  GuestActivityScope,
  type GuestActivitySettings,
  GuestSecurityProfile,
  type Hierarchy,
  type MeasureContext,
  type ModulePermissionGroup,
  type Ref,
  type SessionData,
  type Space
} from '@hcengineering/core'
import type { Middleware } from '@hcengineering/server-core'

export type SpaceWithMembers = Pick<Space, '_id' | 'members' | 'private' | '_class' | 'archived'>

/**
 * True when `query[field]` already narrows the result to a specific, known set of refs
 * (a bare value, or `{ $in: [...] }` with nothing else combined on the same key). Any other
 * shape (`$ne`, `$nin`, `$gt`, the field missing entirely, etc.) is treated as an open
 * browse/search query for the purposes of guest visibility restrictions.
 */
export function hasNarrowFieldQuery (query: Record<string, any> | null | undefined, field: string): boolean {
  const val = query?.[field]
  if (val === undefined) return false
  if (typeof val === 'string') return true
  if (Array.isArray(val)) return false
  if (typeof val === 'object' && val !== null) {
    const keys = Object.keys(val)
    return keys.length === 1 && keys[0] === '$in' && Array.isArray(val.$in)
  }
  return false
}

/**
 * Settings → Guest permissions lets an admin disable a whole module/application for a role via
 * `ModulePermissionGroup.enabled`. Today that only hides the app icon in the sidebar and gates
 * write transactions (`GuestPermissionsMiddleware`) — search/mention never consulted it, so a
 * disabled module's objects (e.g. Products cards) still turned up in the @-mention picker.
 * Returns the `Space` classes (`ModulePermissionGroup.spaceClass`) disabled for the caller's role.
 */
export async function getDisabledModuleSpaceClasses (
  next: Middleware | undefined,
  ctx: MeasureContext<SessionData>,
  account: Account
): Promise<Set<Ref<Class<Space>>>> {
  const groupQuery: DocumentQuery<ModulePermissionGroup> = { role: account.role, enabled: false }
  const groups = ((await next?.findAll(ctx, core.class.ModulePermissionGroup, groupQuery, {
    projection: { spaceClass: 1 }
  })) ?? []) as Array<Pick<ModulePermissionGroup, 'spaceClass'>>
  const classes = new Set<Ref<Class<Space>>>()
  for (const group of groups) {
    if (group.spaceClass !== undefined) {
      classes.add(group.spaceClass)
    }
  }
  return classes
}

/** Resolves `getDisabledModuleSpaceClasses`'s class refs into concrete space ids, using the
 * space-membership tracking state (`spacesMap`) `SpaceSecurityMiddleware` already maintains. */
export function resolveDisabledModuleSpaceIds (
  hierarchy: Hierarchy,
  disabledClasses: Set<Ref<Class<Space>>>,
  spacesMap: Map<Ref<Space>, SpaceWithMembers>
): Set<Ref<Space>> {
  const ids = new Set<Ref<Space>>()
  if (disabledClasses.size === 0) return ids
  for (const space of spacesMap.values()) {
    for (const spaceClass of disabledClasses) {
      if (hierarchy.isDerived(space._class, spaceClass)) {
        ids.add(space._id)
        break
      }
    }
  }
  return ids
}

/**
 * Excludes `excluded` space ids from a space-field query condition (the `space` / `objectSpace` /
 * `_id` field `SpaceSecurityMiddleware.findAll` narrows queries to, depending on domain), whatever
 * shape it is already in (`undefined`, a bare ref, or an object with `$in`/`$nin`/other
 * operators). Returns `{ deny: true }` when the exclusion would leave no space eligible at all.
 */
export function excludeSpacesFromQuery (
  current: Record<string, any> | Ref<Space> | undefined,
  excluded: Set<Ref<Space>>
): { query: Record<string, any> | Ref<Space> | undefined } | { deny: true } {
  if (excluded.size === 0) return { query: current }
  if (current === undefined) {
    return { query: { $nin: Array.from(excluded) } }
  }
  if (typeof current !== 'object' || current === null) {
    return excluded.has(current) ? { deny: true } : { query: current }
  }
  if (Array.isArray(current.$in)) {
    const filtered = (current.$in as Ref<Space>[]).filter((id) => !excluded.has(id))
    if (filtered.length === 0) return { deny: true }
    return { query: { ...current, $in: filtered } }
  }
  const existingNin = new Set<Ref<Space>>((current.$nin as Ref<Space>[] | undefined) ?? [])
  for (const id of excluded) existingNin.add(id)
  return { query: { ...current, $nin: Array.from(existingNin) } }
}

/** Resolves the configured activity scope, defaulting to `Own`. */
export async function resolveGuestActivityScope (
  next: Middleware | undefined,
  ctx: MeasureContext<SessionData>,
  account: Account
): Promise<GuestActivityScope> {
  const query: DocumentQuery<GuestActivitySettings> = { role: account.role }
  const docs = ((await next?.findAll(ctx, core.class.GuestActivitySettings, query, { limit: 1 })) ??
    []) as GuestActivitySettings[]
  return docs[0]?.activityScope ?? GuestActivityScope.Own
}

export async function resolveGuestSecurityProfile (
  next: Middleware | undefined,
  ctx: MeasureContext<SessionData>,
  account: Account
): Promise<GuestSecurityProfile> {
  if (account.role !== AccountRole.Guest) return GuestSecurityProfile.Viewer
  const query: DocumentQuery<GuestActivitySettings> = { role: account.role }
  const docs = ((await next?.findAll(ctx, core.class.GuestActivitySettings, query, { limit: 1 })) ??
    []) as GuestActivitySettings[]
  return docs[0]?.securityProfile ?? GuestSecurityProfile.Participant
}
