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

import { MarkupBlobRef, Ref } from '@hcengineering/core'
import document, { Document, getFirstRank, Teamspace } from '@hcengineering/document'
import { makeRank } from '@hcengineering/rank'
import { markdownToMarkup } from '@hcengineering/text-markdown'
import { Stream } from 'stream'
import { v4 as uuid } from 'uuid'

import config from '../config'
import { RegisteredTool, ToolDependencies, WorkspaceOps } from './types'

export const getDataBeforeImportTool: RegisteredTool = {
  definition: {
    name: 'getDataBeforeImport',
    description:
      'Get folders and parents for documents. This step necessery before saveFile tool. YOU MUST USE IT BEFORE import file.',
    parameters: {
      type: 'object',
      properties: {}
    }
  },
  createExecutor: (deps: ToolDependencies) => async () => {
    if (deps.workspaceOps === undefined) return { text: 'Workspace operations not available' }
    return { text: await getFoldersForDocuments(deps) }
  },
  contextMode: 'any'
}

export const saveFileTool: RegisteredTool = {
  definition: {
    name: 'saveFile',
    description:
      'Parse pdf to markdown and save it, using for import files. Use only if provide file in current message and user require to import/save, if file not provided ask user to attach it. You MUST call getDataBeforeImport tool before for get ids. Use file name as name if user not provide it, don`t use old parameters. You can ask user about folder if you have not enough data to get folder id',
    parameters: {
      type: 'object',
      required: ['fileId, folder, name'],
      properties: {
        fileId: { type: 'string', description: 'File id to parse' },
        folder: {
          type: 'string',
          default: '',
          description:
            'Folder, id from getDataBeforeImport. If not provided you can guess by file name and folder name, or by another file names, if you can`t, just ask user. Don`t provide empty, this field is required. If no folders at all, you should stop pipeline execution and ask user to create teamspace'
        },
        parent: {
          type: 'string',
          default: '',
          description:
            'Parent document, use id from getDataBeforeImport, leave empty string if not provided, it is not necessery, please feel free to pass empty string'
        },
        name: {
          type: 'string',
          description: 'Name for file, try to recognize from user input, if not provided use attached file name'
        }
      }
    }
  },
  createExecutor:
    (deps: ToolDependencies) =>
      async (args: { fileId: string, folder: string | undefined, parent: string | undefined, name: string }) => {
        if (deps.workspaceOps === undefined) return { text: 'Workspace operations not available' }
        return { text: await saveFile(deps.workspaceOps, args) }
      },
  contextMode: 'any'
}

async function getFoldersForDocuments (deps: ToolDependencies): Promise<string> {
  const ops = deps.workspaceOps
  if (ops === undefined) return 'Workspace operations not available'
  const client = await ops.getClient()
  const spaces = await client.findAll(
    document.class.Teamspace,
    deps.user !== undefined ? { members: deps.user, archived: false } : { archived: false }
  )
  let res = 'Folders:\n'
  for (const space of spaces) {
    res += `Id: ${space._id} Name: ${space.name}\n`
  }
  res += 'Parents:\n'
  const parents = await client.findAll(document.class.Document, { space: { $in: spaces.map((p) => p._id) } })
  for (const parent of parents) {
    res += `Id: ${parent._id} Name: ${parent.title}\n`
  }
  return res
}

async function saveFile (
  ops: WorkspaceOps,
  args: { fileId: string, folder: string | undefined, parent: string | undefined, name: string }
): Promise<string> {
  console.log('Save file', args)
  const content = await pdfToMarkdown(ops, args.fileId, args.name)
  if (content === undefined) {
    return 'Error while converting pdf to markdown'
  }
  const converted = JSON.stringify(markdownToMarkup(content))

  const client = await ops.getClient()
  const fileId = uuid()
  await ops.storage.put(ops.ctx, ops.wsIds, fileId, converted, 'application/json')

  const teamspaces = await client.findAll(document.class.Teamspace, {})
  const parent = await client.findOne(document.class.Document, { _id: args.parent as Ref<Document> })
  const teamspaceId = getTeamspace(args.folder, parent, teamspaces)
  const parentId = parent?._id ?? document.ids.NoParent
  const lastRank = await getFirstRank(client, teamspaceId, parentId)
  const rank = makeRank(lastRank, undefined)
  const _id = await client.createDoc(document.class.Document, teamspaceId, {
    title: args.name,
    parent: parentId,
    content: fileId as MarkupBlobRef,
    rank
  })

  return `File saved as ${args.name} with id ${_id}, always provide mention link as: [](ref://?_class=document%3Aclass%3ADocument&_id=${_id}&label=${args.name})`
}

async function pdfToMarkdown (ops: WorkspaceOps, fileId: string, name: string | undefined): Promise<string | undefined> {
  if (config.DataLabApiKey !== '') {
    try {
      const stat = await ops.storage.stat(ops.ctx, ops.wsIds, fileId)
      if (stat?.contentType !== 'application/pdf') {
        return
      }
      const file = await ops.storage.get(ops.ctx, ops.wsIds, fileId)
      const buffer = await stream2buffer(file)

      const url = 'https://www.datalab.to/api/v1/marker'
      const formData = new FormData()
      formData.append('file', new Blob([new Uint8Array(buffer)], { type: 'application/pdf' }), name ?? 'test.pdf')
      formData.append('force_ocr', 'false')
      formData.append('paginate', 'false')
      formData.append('output_format', 'markdown')
      formData.append('use_llm', 'false')
      formData.append('strip_existing_ocr', 'false')
      formData.append('disable_image_extraction', 'false')

      const headers = { 'X-Api-Key': config.DataLabApiKey }

      const response = await fetch(url, {
        method: 'POST',
        body: formData,
        headers
      })

      const data = await response.json()

      if (data.request_check_url !== undefined) {
        for (let attempt = 0; attempt < 10; attempt++) {
          const resp = await fetch(data.request_check_url, { headers })
          const result = await resp.json()
          if (result.status === 'complete' && result.markdown !== undefined) {
            return result.markdown
          }
          await new Promise((resolve) => setTimeout(resolve, 2000))
        }
      }
    } catch (e) {
      console.error(e)
    }
  }
}

function getTeamspace (
  folder: string | undefined,
  parent: Document | undefined,
  teamspaces: Teamspace[]
): Ref<Teamspace> {
  if (parent !== undefined) return parent.space
  if (folder !== undefined) {
    const teamspace = teamspaces.find(
      (p) => p.name.trim().toLowerCase() === folder.trim().toLowerCase() || p._id === folder
    )
    if (teamspace !== undefined) return teamspace._id
  }
  return teamspaces[0]._id
}

async function stream2buffer (stream: Stream): Promise<Buffer> {
  return await new Promise<Buffer>((resolve, reject) => {
    const _buf = Array<any>()
    stream.on('data', (chunk) => {
      _buf.push(chunk)
    })
    stream.on('end', () => {
      resolve(Buffer.concat(_buf))
    })
    stream.on('error', (err) => {
      reject(new Error(`error converting stream - ${err}`))
    })
  })
}
