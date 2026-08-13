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

import type { Class, Hierarchy, Ref, Space } from '@hcengineering/core'

import type { Application, ApplicationNavModel } from './types'

export interface SpaceApplicationGroup<T extends Space = Space> {
  application: Application | undefined
  spaces: T[]
}

export interface SpaceApplicationResolver {
  resolve: (space: Space) => Application | undefined
  group: <T extends Space>(spaces: T[]) => Array<SpaceApplicationGroup<T>>
}

interface ApplicationCandidate {
  application: Application
  explicit: boolean
}

type SpaceHierarchy = Pick<Hierarchy, 'getAncestors'>

function compareApplications (left: Application, right: Application): number {
  const order = (left.order ?? Number.MAX_SAFE_INTEGER) - (right.order ?? Number.MAX_SAFE_INTEGER)
  if (order !== 0) return order

  const alias = left.alias.localeCompare(right.alias)
  return alias !== 0 ? alias : left._id.localeCompare(right._id)
}

function getApplicationSpaceClasses (
  application: Application,
  navigationModels: ApplicationNavModel[]
): Array<{ spaceClass: Ref<Class<Space>>, explicit: boolean }> {
  const result = new Map<Ref<Class<Space>>, boolean>()

  for (const spaceClass of application.spaceClasses ?? []) result.set(spaceClass, true)

  const models = [application.navigatorModel, ...navigationModels.filter((model) => model.extends === application._id)]
  for (const model of models) {
    for (const space of model?.spaces ?? []) {
      if (!result.has(space.spaceClass)) result.set(space.spaceClass, false)
    }
  }

  return [...result].map(([spaceClass, explicit]) => ({ spaceClass, explicit }))
}

export function createSpaceApplicationResolver (
  hierarchy: SpaceHierarchy,
  applications: Application[],
  navigationModels: ApplicationNavModel[] = []
): SpaceApplicationResolver {
  const candidatesByClass = new Map<Ref<Class<Space>>, ApplicationCandidate[]>()
  const applicationBySpaceId = new Map<Ref<Space>, Application>()

  for (const application of [...applications].sort(compareApplications)) {
    for (const spaceId of application.spaceIds ?? []) {
      if (!applicationBySpaceId.has(spaceId)) applicationBySpaceId.set(spaceId, application)
    }
    for (const { spaceClass, explicit } of getApplicationSpaceClasses(application, navigationModels)) {
      const candidates = candidatesByClass.get(spaceClass) ?? []
      candidates.push({ application, explicit })
      candidatesByClass.set(spaceClass, candidates)
    }
  }

  for (const candidates of candidatesByClass.values()) {
    candidates.sort((left, right) => {
      if (left.explicit !== right.explicit) return left.explicit ? -1 : 1
      return compareApplications(left.application, right.application)
    })
  }

  const applicationBySpaceClass = new Map<Ref<Class<Space>>, Application | undefined>()

  const resolve = (space: Space): Application | undefined => {
    const applicationById = applicationBySpaceId.get(space._id)
    if (applicationById !== undefined) return applicationById

    const cached = applicationBySpaceClass.get(space._class)
    if (cached !== undefined || applicationBySpaceClass.has(space._class)) return cached

    const classes = [space._class, ...[...hierarchy.getAncestors(space._class)].reverse()]
    for (const spaceClass of classes) {
      const application = candidatesByClass.get(spaceClass as Ref<Class<Space>>)?.[0]?.application
      if (application !== undefined) {
        applicationBySpaceClass.set(space._class, application)
        return application
      }
    }
    applicationBySpaceClass.set(space._class, undefined)
    return undefined
  }

  const group = <T extends Space>(spaces: T[]): Array<SpaceApplicationGroup<T>> => {
    const spacesByApplication = new Map<Application | undefined, T[]>()
    for (const space of spaces) {
      const application = resolve(space)
      const applicationSpaces = spacesByApplication.get(application) ?? []
      applicationSpaces.push(space)
      spacesByApplication.set(application, applicationSpaces)
    }

    return [...spacesByApplication]
      .map(([application, applicationSpaces]) => ({ application, spaces: applicationSpaces }))
      .sort((left, right) => {
        if (left.application === undefined) return 1
        if (right.application === undefined) return -1
        return compareApplications(left.application, right.application)
      })
  }

  return { resolve, group }
}
