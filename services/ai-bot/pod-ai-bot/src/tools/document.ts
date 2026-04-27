//
// Copyright © 2026 TraceX.
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

import core, { type AnyAttribute, type MarkupBlobRef } from '@hcengineering/core'
import { markupToText } from '@hcengineering/text'

import { type RegisteredTool, type ToolDependencies, type WorkspaceOps } from './types'

function isCollaborativeDocType (attr: AnyAttribute): boolean {
  return attr.type._class === core.class.TypeCollaborativeDoc
}

function isMarkupType (attr: AnyAttribute): boolean {
  return attr.type._class === core.class.TypeMarkup
}

export const getObjectContentTool: RegisteredTool = {
  definition: {
    name: 'get_object_content',
    description:
      'Read the rich text content of the object whose thread this conversation is in. ' +
      'When the user says "this document", "the document", "this issue", "this object", or similar phrases referring to the current context, ' +
      'they mean the object attached to this thread — use this tool to retrieve its content. ' +
      'Do NOT ask the user to upload or provide a document; the content is already available via this tool.',
    parameters: {
      type: 'object',
      properties: {}
    }
  },
  createExecutor: (deps: ToolDependencies) => async () => {
    if (deps.objectId === undefined || deps.objectClass === undefined) {
      return {
        text: 'No context document available. This tool can only be used when the conversation is on an object thread.'
      }
    }
    if (deps.workspaceOps === undefined) {
      return { text: 'Workspace operations not available.' }
    }

    const ops = deps.workspaceOps
    const client = await deps.workspaceOps.getClient()
    const doc = await client.findOne(deps.objectClass, { _id: deps.objectId })

    if (doc === undefined) {
      return { text: 'Could not find the context object. It may have been deleted.' }
    }

    const hierarchy = client.getHierarchy()
    const attributes = hierarchy.getAllAttributes(doc._class)
    const sections: string[] = []

    for (const [name, attr] of attributes) {
      const value = (doc as any)[name]
      if (value === undefined) continue

      try {
        if (isCollaborativeDocType(attr)) {
          const text = await readCollaborativeContent(ops, value as MarkupBlobRef)
          sections.push(`--- ${name} ---\n${text}`)
        } else if (isMarkupType(attr)) {
          const text = markupToText(value as string)
          sections.push(`--- ${name} ---\n${text}`)
        }
      } catch {}
    }

    return { text: sections.join('\n\n') }
  },
  contextMode: 'any'
}

async function readCollaborativeContent (ops: WorkspaceOps, blobRef: MarkupBlobRef): Promise<string> {
  const buffers = await ops.storage.read(ops.ctx, ops.wsIds, blobRef)
  const markup = Buffer.concat(buffers).toString()
  return markupToText(markup)
}
