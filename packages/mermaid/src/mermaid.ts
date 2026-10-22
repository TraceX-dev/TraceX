//
// Copyright © 2024 Hardcore Engineering Inc.
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

import type { MermaidConfig } from 'mermaid'
import { v4 as uuid } from 'uuid'

let renderQueue: Promise<void> = Promise.resolve()

/**
 * Renders SVG without allowing concurrent callers to overwrite the diagram configuration.
 * @public
 */
export function renderMermaidSvg (
  code: string,
  theme: MermaidConfig['theme'],
  securityLevel: 'strict' | 'antiscript' = 'strict'
): Promise<string> {
  const result = renderQueue.then(async () => {
    const mermaid = (await import(/* webpackMode: "lazy-once" */ 'mermaid')).default
    const useMaxWidth = false

    mermaid.initialize({
      startOnLoad: false,
      securityLevel,
      logLevel: 5,
      theme,
      suppressErrorRendering: true,
      fontFamily: 'var(--font-family)',
      fontSize: 16,
      flowchart: { useMaxWidth },
      sequence: { useMaxWidth },
      gantt: { useMaxWidth },
      journey: { useMaxWidth },
      timeline: { useMaxWidth },
      class: { useMaxWidth },
      state: { useMaxWidth },
      er: { useMaxWidth },
      pie: { useMaxWidth },
      quadrantChart: { useMaxWidth },
      xyChart: { useMaxWidth },
      requirement: { useMaxWidth }
    })

    const { svg } = await mermaid.render(`mermaid-diagram-${uuid()}`, code)
    return svg
  })

  // A failed diagram must not prevent subsequent diagrams from rendering.
  renderQueue = result.then(() => {}, () => {})
  return result
}
