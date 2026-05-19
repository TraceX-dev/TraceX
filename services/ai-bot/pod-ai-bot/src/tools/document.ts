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

import core, { type Doc, type AnyAttribute, makeCollabId, Hierarchy } from '@hcengineering/core'
import { markupToHtml } from '@hcengineering/text-html'

import { type RegisteredTool, type ToolContext } from './types'

function isCollaborativeDocType (attr: AnyAttribute): boolean {
  return attr.type._class === core.class.TypeCollaborativeDoc
}

export const readObjectContentTool: RegisteredTool = {
  definition: {
    name: 'readObjectContent',
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
  createExecutor: (toolCtx: ToolContext) => async () => {
    if (toolCtx.objectId === undefined || toolCtx.objectClass === undefined) {
      return {
        text: 'No context document available. This tool can only be used when the conversation is on an object thread.'
      }
    }
    if (toolCtx.workspaceOps === undefined) {
      return { text: 'Workspace operations not available.' }
    }

    const client = await toolCtx.workspaceOps.getClient()
    const doc = await client.findOne(toolCtx.objectClass, { _id: toolCtx.objectId })

    if (doc === undefined) {
      return { text: 'Could not find the context object. It may have been deleted.' }
    }

    try {
      const text = await readCollaborativeContent(toolCtx, client.getHierarchy(), doc)
      return { text }
    } catch {
      return { text: 'Could not read the context object content.' }
    }
  },
  contextMode: 'any'
}

async function readCollaborativeContent (toolCtx: ToolContext, hierarchy: Hierarchy, doc: Doc): Promise<string> {
  const attr = findCollaborativeField(hierarchy, doc)
  if (attr !== undefined) {
    const collabId = makeCollabId(doc._class, doc._id, attr)
    const markup = await toolCtx.collaborator.getMarkup(collabId, (doc as any)[attr])
    return markupToHtml(markup)
  }
  return '<p/>'
}

function findCollaborativeField (hierarchy: Hierarchy, doc: Doc): string | undefined {
  const attributes = hierarchy.getAllAttributes(doc._class)
  for (const [name, attr] of attributes) {
    if (isCollaborativeDocType(attr)) {
      return name
    }
  }
}
