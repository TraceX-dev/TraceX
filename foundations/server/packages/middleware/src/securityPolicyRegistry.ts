//
// Copyright © 2026 TraceX SAS.
//
// Licensed under the PolyForm Shield License 1.0.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://polyformproject.org/licenses/shield/1.0.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//
// See the License for the specific language governing permissions and
// limitations under the License.
//

import core, {
  type Class,
  type Doc,
  type Hierarchy,
  type Ref,
  type RowVisibility,
  validateRowVisibilityPolicy
} from '@hcengineering/core'

export interface RegisteredRowVisibilityPolicy {
  name: string
  _class: Ref<Class<Doc>>
  policy: RowVisibility
}

/**
 * Every class the loaded model declares a row policy on, read out of the model itself.
 *
 * This used to be a hand-written array of string literals, which meant the inventory could drift
 * from the model silently. It is derived now, and `validateRowVisibilityRegistrations` is what
 * guards it: the middleware already fails closed for a class with no policy at all
 * (see `SpaceSecurityMiddleware.findAll`), so what a registry can usefully catch is a policy that
 * is declared but malformed - too deep a traversal, a bypass with no justification, a
 * `spaceScoped` exemption with no reason recorded.
 */
export function resolveRegisteredRowVisibilityPolicies (hierarchy: Hierarchy): RegisteredRowVisibilityPolicy[] {
  const result: RegisteredRowVisibilityPolicy[] = []
  // Deliberately not `getDescendants(core.class.Doc)`: that index is built from ancestor chains,
  // and in the current model 13 classes (every descendant of `preference.class.Preference`,
  // `activity.class.SavedMessage` among them) have a truncated chain, so they are missing from it
  // and `isDerived(x, core.class.Doc)` is false for them. Reading the classifiers directly makes
  // this inventory independent of that defect.
  const classifiers = (hierarchy as unknown as { classifiers: Map<Ref<Class<Doc>>, Doc> }).classifiers
  for (const [_class, classifier] of classifiers.entries()) {
    if (classifier._class !== core.class.Class) continue
    const clazz = hierarchy.getClass(_class)
    // `hasMixin` (not `classHierarchyMixin`) so a class only shows up where it declares its own
    // policy, instead of once per descendant that inherits it.
    if (!hierarchy.hasMixin(clazz, core.mixin.RowVisibility)) continue
    result.push({
      name: _class as string,
      _class,
      policy: hierarchy.as(clazz, core.mixin.RowVisibility)
    })
  }
  return result.sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Problems found in the declared policies, empty when the model is well formed. Intended to be
 * asserted empty by a test that loads the real model.
 */
export function validateRowVisibilityRegistrations (hierarchy: Hierarchy): string[] {
  const problems: string[] = []
  for (const { name, policy } of resolveRegisteredRowVisibilityPolicies(hierarchy)) {
    for (const [label, candidate] of [
      ['policy', policy.policy],
      ['writePolicy', policy.writePolicy]
    ] as const) {
      if (candidate === undefined) continue
      for (const problem of validateRowVisibilityPolicy(candidate)) {
        problems.push(`${name}: ${label} ${problem}`)
      }
      if (candidate.kind === 'spaceScoped' && candidate.reason.trim() === '') {
        problems.push(`${name}: ${label} spaceScoped without a recorded reason`)
      }
    }
    if (policy.allowKnownIdBypass === true && (policy.knownIdBypassReason ?? '').trim() === '') {
      problems.push(`${name}: known-id bypass enabled without a justification`)
    }
    if (policy.allowKnownIdBypass !== true && (policy.knownIdBypassFields ?? []).length > 0) {
      problems.push(`${name}: declares knownIdBypassFields while the bypass is disabled`)
    }
  }
  return problems
}

/** Renders the policy table embedded in `docs/security-model.md`, so the doc cannot drift. */
export function renderRowVisibilityPolicyTable (hierarchy: Hierarchy): string {
  const header = ['| Class | Read policy | Write policy |', '| --- | --- | --- |']
  const rows = resolveRegisteredRowVisibilityPolicies(hierarchy).map(({ name, policy }) => {
    return `| \`${name}\` | \`${policy.policy.kind}\` | \`${policy.writePolicy?.kind ?? policy.policy.kind}\` |`
  })
  return [...header, ...rows].join('\n')
}
