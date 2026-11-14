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

import type { FullParamsType, MeasureContext, ParamsType, WithOptions } from './types'

/**
 * Delegate measurements to every context while executing each operation once.
 * Logs, metadata and readable properties come from the first context. Assigning
 * contextData or id updates every context. Secondary contexts do not log operations.
 * @public
 */
export function createMeasureContextProxy (first: MeasureContext, ...contexts: MeasureContext[]): MeasureContext {
  return createProxy([first, ...contexts])
}

function createProxy (contexts: MeasureContext[], parent?: MeasureContext): MeasureContext {
  function withOperation<T> (
    method: 'with' | 'withCounter',
    name: string,
    params: ParamsType,
    op: (ctx: MeasureContext) => T | PromiseLike<T>,
    fullParams?: FullParamsType | (() => FullParamsType),
    opt?: WithOptions
  ): Promise<T> {
    const children: MeasureContext[] = []
    const run = (index: number): Promise<T> =>
      contexts[index][method](
        name,
        params,
        (child) => {
          children.push(child)
          return index === contexts.length - 1 ? op(createProxy(children, proxy)) : run(index + 1)
        },
        fullParams,
        index === 0 ? opt : { ...opt, log: false }
      )
    return run(0)
  }

  const operations: Pick<
    MeasureContext,
    'with' | 'withCounter' | 'withSync' | 'newChild' | 'end' | 'counter' | 'gauge'
  > = {
    with<T>(
      name: string,
      params: ParamsType,
      op: (ctx: MeasureContext) => T | PromiseLike<T>,
      fullParams?: FullParamsType | (() => FullParamsType),
      opt?: WithOptions
    ): Promise<T> {
      return withOperation('with', name, params, op, fullParams, opt)
    },
    withCounter<T>(
      name: string,
      params: ParamsType,
      op: (ctx: MeasureContext) => T | PromiseLike<T>,
      fullParams?: FullParamsType | (() => FullParamsType),
      opt?: WithOptions
    ): Promise<T> {
      return withOperation('withCounter', name, params, op, fullParams, opt)
    },
    withSync<T>(
      name: string,
      params: ParamsType,
      op: (ctx: MeasureContext) => T,
      fullParams?: ParamsType | (() => FullParamsType),
      opt?: WithOptions
    ): T {
      const children: MeasureContext[] = []
      const run = (index: number): T =>
        contexts[index].withSync(
          name,
          params,
          (child) => {
            children.push(child)
            return index === contexts.length - 1 ? op(createProxy(children, proxy)) : run(index + 1)
          },
          fullParams,
          index === 0 ? opt : { ...opt, log: false }
        )
      return run(0)
    },
    newChild (name, params, opt) {
      return createProxy(
        contexts.map((ctx) => ctx.newChild(name, params, opt)),
        proxy
      )
    },
    end (value) {
      for (const ctx of contexts) {
        ctx.end(value)
      }
    },
    counter (name, value, attributes) {
      for (const ctx of contexts) {
        ctx.counter(name, value, attributes)
      }
    },
    gauge (name, value, attributes) {
      for (const ctx of contexts) {
        ctx.gauge(name, value, attributes)
      }
    }
  }

  const proxy = new Proxy(contexts[0], {
    get (target, property) {
      if (
        property === 'with' ||
        property === 'withCounter' ||
        property === 'withSync' ||
        property === 'newChild' ||
        property === 'end' ||
        property === 'counter' ||
        property === 'gauge'
      ) {
        return operations[property]
      }
      if (property === 'parent' && parent !== undefined) {
        return parent
      }
      const value: unknown = Reflect.get(target, property, target)
      return typeof value === 'function' ? value.bind(target) : value
    },
    set (target, property, value: unknown) {
      if (property === 'contextData' || property === 'id') {
        return contexts.every((ctx) => Reflect.set(ctx, property, value, ctx))
      }
      return Reflect.set(target, property, value, target)
    }
  })
  return proxy
}
