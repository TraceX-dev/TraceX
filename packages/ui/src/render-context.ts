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

import { getContext, setContext } from 'svelte'

const RENDER_CONTEXT = Symbol('render-context')

/** Optional owner of asynchronous rendering work and failures. @public */
export interface RenderContext {
  readonly registerResource: () => () => void
  readonly fail: (error: unknown) => void
}

/** Install lifecycle handling for a component subtree during initialization. @public */
export function provideRenderContext (context: RenderContext): void {
  setContext(RENDER_CONTEXT, context)
}

/** Capture the lifecycle owner during component initialization. @public */
export function getRenderContext (): RenderContext | undefined {
  return getContext(RENDER_CONTEXT)
}
