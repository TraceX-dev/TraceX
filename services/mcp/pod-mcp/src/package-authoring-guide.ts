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

import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { packageAuthoringGuideToolId } from './tools/package/tool-ids'

const EXAMPLES = [
  'risk-management-reactive.card.yaml',
  'risk-management.card.yaml',
  'review-task.process.yaml',
  'approval.process.yaml',
  'estimate-review.process.yaml',
  'purchase-approval.process.yaml',
  'procurement-workspace.card.yaml'
]

/** Reads the canonical authoring documentation shipped alongside the MCP bundle. */
export async function readPackageAuthoringGuide (section = 'Start here'): Promise<Record<string, unknown>> {
  let directory = resolve(__dirname, 'authoring')
  let guide: string
  try {
    guide = await readFile(resolve(directory, 'authoring.md'), 'utf8')
  } catch (error) {
    if (typeof error !== 'object' || error === null || !('code' in error) || error.code !== 'ENOENT') throw error
    directory = resolve(__dirname, '../../../../plugins/process/docs')
    guide = await readFile(resolve(directory, 'authoring.md'), 'utf8')
  }
  const headings = [...guide.matchAll(/^(#{1,4}) (.+)$/gm)]
  const sections = headings.map((heading) => heading[2])
  const examples = EXAMPLES.map((name) => `example:${name}`)
  if (section === 'schema') {
    return { section, content: await readFile(resolve(directory, 'authoring-v2.schema.json'), 'utf8') }
  }
  if (examples.includes(section)) {
    return {
      section,
      content: await readFile(resolve(directory, 'examples', section.slice('example:'.length)), 'utf8')
    }
  }
  const index = headings.findIndex((heading) => heading[2] === section)
  if (index === -1) {
    throw new Error(`Unknown guide section; call ${packageAuthoringGuideToolId} without a section to list sections`)
  }
  const heading = headings[index]
  const next = headings.slice(index + 1).find((item) => item[1].length <= heading[1].length)
  return {
    section,
    content: guide.slice(heading.index, next?.index),
    ...(section === 'Start here'
      ? {
          sections,
          examples,
          instructions:
            'Read Design preferences first, then only relevant sections. To add an existing Marketplace process to a package draft, read Reusing a Marketplace process and use package_add_dependency with the inspected release lock and parent bindings. Resolve technical choices yourself; record assumptions in the review. Validate and save the requested private draft.'
        }
      : {})
  }
}
