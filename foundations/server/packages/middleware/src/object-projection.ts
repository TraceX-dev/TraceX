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

import {
  type Class,
  type Doc,
  type DocumentQuery,
  type FindOptions,
  type FindResult,
  type MeasureContext,
  type Projection,
  type Ref,
  type SessionData
} from '@hcengineering/core'
import { BaseMiddleware, type Middleware, type PipelineContext } from '@hcengineering/server-core'
import view, { type ObjectPresenter } from '@hcengineering/view'

/**
 * Restricts unsecured queries to the fields declared by their object presenter.
 * @public
 */
export class ObjectProjectionMiddleware extends BaseMiddleware implements Middleware {
  private constructor (context: PipelineContext, next?: Middleware) {
    super(context, next)
  }

  static async create (
    ctx: MeasureContext,
    context: PipelineContext,
    next: Middleware | undefined
  ): Promise<ObjectProjectionMiddleware> {
    return new ObjectProjectionMiddleware(context, next)
  }

  findAll<T extends Doc>(
    ctx: MeasureContext<SessionData>,
    _class: Ref<Class<T>>,
    query: DocumentQuery<T>,
    options?: FindOptions<T>
  ): Promise<FindResult<T>> {
    if (options?.unsecured !== true) return this.provideFindAll(ctx, _class, query, options)

    const presenter = this.context.hierarchy.classHierarchyMixin<Doc, ObjectPresenter>(
      _class,
      view.mixin.ObjectPresenter
    )
    if (presenter?.requiredFields === undefined) {
      const { unsecured, ...securedOptions } = options
      return this.provideFindAll(ctx, _class, query, securedOptions)
    }
    const projection = Object.fromEntries(
      [...presenter.requiredFields, '_id', '_class', 'space'].map((field) => [field, 1])
    ) as Projection<T>

    return this.provideFindAll(ctx, _class, query, { ...options, projection })
  }
}
