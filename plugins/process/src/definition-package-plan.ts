// Copyright © 2026 TraceX SAS.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import { compileProcessYaml } from './authoring'
import { authoringDataEqual } from './authoring-validation'
import { compareDefinitionPackageVersions, createDefinitionPackageRelease, DefinitionPackageError } from './definition-package'
import { definitionPackageComponents, definitionPackageDifferencePaths, definitionPackageImpact } from './definition-package-model'
import type { DefinitionPackageChange, DefinitionPackageRelease, DefinitionPackageUpgradePlan } from './definition-package-types'

/** Performs read-only B/L/N comparison using logical package identities, not arbitrary workspace storage ids. */
export async function planDefinitionPackageUpgrade (
  installed: DefinitionPackageRelease,
  incoming: DefinitionPackageRelease,
  localSource?: string
): Promise<DefinitionPackageUpgradePlan> {
  // Recompile and verify digests instead of trusting caller-supplied derived documents.
  const [base, next] = await Promise.all([installed, incoming].map(async (release) =>
    await createDefinitionPackageRelease({ package: release.package, source: release.source, contentHash: release.contentHash })
  ))
  if (base.package.id !== next.package.id) throw new DefinitionPackageError('package.id', 'Cannot upgrade a different package')
  if (base.definition.kind !== next.definition.kind) throw new DefinitionPackageError('source.kind', 'Cannot change the installed definition kind')
  const precedence = compareDefinitionPackageVersions(next.package.version, base.package.version)
  if (precedence < 0) throw new DefinitionPackageError('package.version', 'Downgrades require a separate rollback plan')
  if (precedence === 0 && base.contentHash !== next.contentHash) {
    throw new DefinitionPackageError('package.version', 'Cannot replace release content at the same SemVer precedence')
  }
  const local = localSource === undefined ? base.definition : compileProcessYaml(localSource)
  if (local.kind !== base.definition.kind) throw new DefinitionPackageError('local.kind', 'Local definition kind differs from the installed package')
  const baseline = definitionPackageComponents(base.definition)
  const current = definitionPackageComponents(local)
  const target = definitionPackageComponents(next.definition)
  const changes: DefinitionPackageChange[] = []
  for (const key of [...new Set([...baseline.keys(), ...current.keys(), ...target.keys()])].sort()) {
    const before = baseline.get(key)
    const actual = current.get(key)
    const after = target.get(key)
    const upstreamChanged = !authoringDataEqual(before, after)
    const locallyChanged = !authoringDataEqual(before, actual)
    if (!upstreamChanged && !locallyChanged) continue
    const resolution = !upstreamChanged ? 'local' : !locallyChanged ? 'upstream' : authoringDataEqual(actual, after) ? 'converged' : 'conflict'
    const destination = upstreamChanged ? after : actual
    changes.push({
      key,
      class: (destination ?? before ?? actual)?.class ?? '',
      operation: before === undefined ? 'added' : destination === undefined ? 'removed' : 'modified',
      resolution,
      ...definitionPackageImpact(before, destination),
      paths: resolution === 'conflict'
        ? [...new Set([...definitionPackageDifferencePaths(before, actual), ...definitionPackageDifferencePaths(before, after)])].sort()
        : definitionPackageDifferencePaths(before, destination)
    })
  }
  const reasons = new Set<string>()
  if (base.package.version.split('.')[0] !== next.package.version.split('.')[0]) reasons.add('major-release')
  if ([base.package.version, next.package.version].some((version) => version.split('+')[0].includes('-'))) reasons.add('prerelease')
  if (changes.some((change) => change.resolution === 'local' || change.resolution === 'conflict' || change.resolution === 'converged')) reasons.add('local-customization')
  for (const change of changes) {
    if (change.resolution === 'conflict') reasons.add('conflict')
    if (['behavioral', 'destructive', 'unknown'].includes(change.impact)) reasons.add(`${change.impact}-change`)
    if (change.class === 'process:class:Process') reasons.add('process-revisions-required')
  }
  const status = reasons.has('conflict') ? 'conflict' : reasons.size > 0 ? 'review-required' : changes.length === 0 ? 'unchanged' : 'compatible-candidate'
  return {
    packageId: base.package.id,
    fromVersion: base.package.version,
    toVersion: next.package.version,
    status,
    changes,
    reviewReasons: [...reasons, 'workspace-analysis-required', 'server-apply-not-implemented'],
    canAutoApply: false
  }
}
