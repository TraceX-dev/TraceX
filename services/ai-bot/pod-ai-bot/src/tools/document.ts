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

import core, { type Doc, type AnyAttribute, makeCollabId, Hierarchy, type Class, type Ref } from '@hcengineering/core'
import drive, { type File, type FileVersion } from '@hcengineering/drive'
import { markupToHtml } from '@hcengineering/text-html'

import { pdfToMarkdown, stream2buffer } from './pdf'
import { ToolExecutorResult, type RegisteredTool, type ToolContext, type WorkspaceOps } from './types'

function isCollaborativeDocType (attr: AnyAttribute): boolean {
  return attr.type._class === core.class.TypeCollaborativeDoc
}

export const readObjectContentTool: RegisteredTool = {
  definition: {
    name: 'readObjectContent',
    description:
      'Read the content of the object whose thread this conversation is in, including rich text objects and Drive files. ' +
      'When the user says "this document", "this file", "the document", "this issue", "this object", or similar phrases referring to the current context, ' +
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
        error: 'No context document available. This tool can only be used when the conversation is on an object thread.'
      }
    }

    const client = await toolCtx.workspaceOps.getClient()
    const doc = await client.findOne(toolCtx.objectClass, { _id: toolCtx.objectId })

    if (doc === undefined) {
      return { error: 'Could not find the context object. It may have been deleted.' }
    }

    try {
      if (doc._class === drive.class.File) {
        return await readDriveFile(toolCtx.workspaceOps, doc as File)
      }
      const text = await readCollaborativeContent(toolCtx, client.getHierarchy(), doc)
      return { text }
    } catch {
      return { error: 'Could not read the context object content.' }
    }
  },
  contextMode: 'any'
}

export const readReferencedObjectContentTool: RegisteredTool = {
  definition: {
    name: 'readReferencedObjectContent',
    description:
      'Read the content of one explicitly referenced document or Drive file. ' +
      'Use this when the user asks about a referenced object from the message References list. ' +
      'Pass objectId and objectClass.',
    parameters: {
      type: 'object',
      properties: {
        objectId: {
          type: 'string',
          description: 'Referenced object id from the prompt References list.'
        },
        objectClass: {
          type: 'string',
          description: 'Referenced object class from the prompt References list.'
        }
      }
    }
  },
  createExecutor:
    (toolCtx: ToolContext) =>
      async (args: ReferencedObjectArgs): Promise<ToolExecutorResult> => {
        const objectId = args.objectId as Ref<Doc>
        const objectClass = args.objectClass as Ref<Class<Doc>>

        if (objectId === undefined || objectId.trim() === '') {
          return { error: 'Missing objectId for referenced object.' }
        }

        if (objectClass === undefined || objectClass.trim() === '') {
          return { error: 'Missing objectClass for referenced object.' }
        }

        const client = await toolCtx.workspaceOps.getClient()
        const doc = await client.findOne(objectClass, { _id: objectId })

        if (doc === undefined) {
          return {
            error: `Could not find referenced object "${objectId}" of class "${objectClass}". It may have been deleted.`
          }
        }

        try {
          if (doc._class === drive.class.File) {
            return await readDriveFile(toolCtx.workspaceOps, doc as File)
          }

          const attr = findCollaborativeField(client.getHierarchy(), doc)
          if (attr === undefined) {
            return {
              error: `Referenced object "${objectId}" of class "${objectClass}" does not have readable document content.`
            }
          }

          const text = await readCollaborativeContent(toolCtx, client.getHierarchy(), doc)
          return { text }
        } catch {
          return {
            error: `Could not read referenced object "${objectId}" of class "${objectClass}".`
          }
        }
      },
  contextMode: 'any'
}

interface ReferencedObjectArgs {
  objectId: string
  objectClass: string
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

export async function readDriveFile (ops: WorkspaceOps, file: File): Promise<ToolExecutorResult> {
  const client = await ops.getClient()
  const version = await client.findOne(drive.class.FileVersion, { _id: file.file })
  if (version === undefined) {
    return { error: `Could not find the current version of Drive file "${file.title}".` }
  }

  return await readDriveFileVersion(ops, file, version)
}

async function readDriveFileVersion (ops: WorkspaceOps, file: File, version: FileVersion): Promise<ToolExecutorResult> {
  const type = normalizeMimeType(version.type)

  if (isPdf(type)) {
    const markdown = await pdfToMarkdown(ops, version.file, version.title ?? file.title)
    return markdown !== undefined && markdown !== ''
      ? { text: markdown }
      : { error: `Could not read PDF content from Drive file "${file.title}".` }
  }

  if (isTextLike(type)) {
    try {
      const stream = await ops.storage.get(ops.ctx, ops.wsIds, version.file)
      const buffer = await stream2buffer(stream)
      return { text: buffer.toString('utf8') }
    } catch {
      return { error: `Could not read content from Drive file "${file.title}".` }
    }
  }

  return { error: `Drive file "${file.title}" has unsupported content type "${version.type}".` }
}

function normalizeMimeType (type: string | undefined): string {
  return (type ?? '').split(';')[0].trim().toLowerCase()
}

function isPdf (type: string): boolean {
  return type === 'application/pdf'
}

function isTextLike (type: string): boolean {
  return (
    type.startsWith('text/') ||
    type === 'application/json' ||
    type === 'application/markdown' ||
    type === 'application/x-markdown'
  )
}
