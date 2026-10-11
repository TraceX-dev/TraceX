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

import type { MasterTag } from '@hcengineering/card'
import { generateId, type Doc, type Ref } from '@hcengineering/core'
import { createContext, parseDSLContext, type Process, type State, type Transition } from '@hcengineering/process'

/** Resolves compiled YAML references structurally, keeping literal names and values intact. */
export function bindYamlProcessDocuments (
  documents: readonly Doc[],
  masterTag: Ref<MasterTag>,
  bindings: Record<string, string>,
  current?: Ref<Process>
): Doc[] {
  const docs = JSON.parse(JSON.stringify(documents)) as Doc[]
  const ids = new Map<string, string>([['__PROCESS__', current ?? generateId()]])
  const register = (key: string): void => {
    if (!ids.has(key)) ids.set(key, generateId())
  }
  for (const doc of docs) {
    register(doc._id)
    if (doc._class === 'process:class:Process') {
      for (const key of Object.keys((doc as Process).context)) register(key)
    } else if (doc._class === 'process:class:Transition') {
      for (const action of (doc as Transition).actions) register(action._id)
    }
  }
  const reference = <T extends string>(key: T): T => {
    const resolved = ids.get(key)
    if (resolved === undefined) throw new Error(`process: Unknown compiled reference ${key}`)
    return resolved as T
  }
  const field = (key: string): string => {
    const slot = /^__SLOT_(.+)__$/.exec(key)?.[1]
    if (slot === undefined || !Object.prototype.hasOwnProperty.call(bindings, slot)) {
      throw new Error(`process: Missing compiled field binding ${key}`)
    }
    return bindings[slot]
  }
  const expression = (source: string): string => {
    const context = parseDSLContext(source)
    if (context === undefined) throw new Error('process: Invalid compiled context expression')
    if (context.type === 'attribute') context.key = field(context.key)
    else if (context.type === 'context') context.id = reference(context.id)
    else if (context.type !== 'const') throw new Error('process: Unsupported compiled context expression')
    context.functions = context.functions?.map((func) => ({
      ...func,
      props: Object.fromEntries(
        Object.entries(func.props).map(([key, value]) => [
          key,
          typeof value === 'string' && value.startsWith('${') ? expression(value) : value
        ])
      )
    }))
    return createContext(context)
  }
  for (const doc of docs) {
    doc._id = reference(doc._id)
    if (doc._class === 'process:class:Process') {
      const definition = doc as Process
      definition.masterTag = masterTag
      definition.context = Object.fromEntries(
        Object.entries(definition.context).map(([key, context]) => [
          reference(key),
          {
            ...context,
            action: reference(context.action),
            producer: reference(context.producer),
            value: { ...context.value, id: reference(context.value.id) }
          }
        ])
      )
      delete definition.requiredSlots
    } else if (doc._class === 'process:class:State') {
      const state = doc as State
      state.process = reference(state.process)
    } else if (doc._class === 'process:class:Transition') {
      const transition = doc as Transition
      transition.process = reference(transition.process)
      if (transition.from !== null) transition.from = reference(transition.from)
      transition.to = reference(transition.to)
      transition.triggerParams =
        transition.trigger === 'process:trigger:OnToDoClose'
          ? { _id: expression(transition.triggerParams._id) }
          : Object.fromEntries(Object.entries(transition.triggerParams).map(([key, value]) => [field(key), value]))
      for (const action of transition.actions) {
        action._id = reference(action._id)
        if (action.context !== null) action.context._id = reference(action.context._id)
        action.params =
          action.methodId === 'process:method:UpdateCard'
            ? Object.fromEntries(
                Object.entries(action.params).map(([key, value]) => [
                  field(key),
                  typeof value === 'string' && value.startsWith('${') ? expression(value) : value
                ])
              )
            : { ...action.params, user: expression(action.params.user as string) }
      }
    }
  }
  return docs
}
