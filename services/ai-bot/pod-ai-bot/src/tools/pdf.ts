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
import { createTool, toolOk } from '@hcengineering/ai-core'
import { Type, type Static } from 'typebox'
import { Stream } from 'stream'
import { v4 as uuid } from 'uuid'

import config from '../config'

import { type AIBotToolContext } from './types'

const SaveFileParametersSchema = Type.Object({
  fileId: Type.String({ description: 'File id to parse' }),
  folder: Type.String({
    default: '',
    description:
      'Folder, id from getDataBeforeImport. If not provided you can guess by file name and folder name, or by another file names, if you can`t, just ask user. Don`t provide empty, this field is required. If no folders at all, you should stop pipeline execution and ask user to create teamspace'
  }),
  parent: Type.Optional(
    Type.String({
      default: '',
      description:
        'Parent document, use id from getDataBeforeImport, leave empty string if not provided, it is not necessery, please feel free to pass empty string'
    })
  ),
  name: Type.String({
    description: 'Name for file, try to recognize from user input, if not provided use attached file name'
  })
})

type SaveFileArgs = Static<typeof SaveFileParametersSchema>

export const getDataBeforeImportTool = createTool({
  name: 'getDataBeforeImport',
  description:
    'Get folders and parents for documents. This step necessery before saveFile tool. YOU MUST USE IT BEFORE import file.',
  inputSchema: Type.Object({}),
  execute: async (args, toolCtx: AIBotToolContext) => {
    return toolOk(await getFoldersForDocuments(toolCtx))
  },
  metadata: {
    contextMode: 'any'
  }
})

export const saveFileTool = createTool({
  name: 'saveFile',
  description:
    'Parse pdf to markdown and save it, using for import files. Use only if provide file in current message and user require to import/save, if file not provided ask user to attach it. You MUST call getDataBeforeImport tool before for get ids. Use file name as name if user not provide it, don`t use old parameters. You can ask user about folder if you have not enough data to get folder id',
  inputSchema: SaveFileParametersSchema,
  execute: async (args, toolCtx: AIBotToolContext) => {
    return toolOk(await saveFile(toolCtx, args))
  },
  metadata: {
    contextMode: 'any'
  }
})

async function getFoldersForDocuments (toolCtx: AIBotToolContext): Promise<string> {
  const { client } = toolCtx
  const spaces = await client.findAll(document.class.Teamspace, { members: toolCtx.user, archived: false })
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

async function saveFile (toolCtx: AIBotToolContext, args: SaveFileArgs): Promise<string> {
  const { client } = toolCtx

  const content = await pdfToMarkdown(toolCtx, args.fileId, args.name)
  if (content === undefined) {
    return 'Error while converting pdf to markdown'
  }
  const converted = JSON.stringify(markdownToMarkup(content))

  const fileId = uuid()
  await toolCtx.storage.put(toolCtx.ctx, toolCtx.wsIds, fileId, converted, 'application/json')

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

export async function pdfToMarkdown (
  toolCtx: AIBotToolContext,
  fileId: string,
  name: string | undefined
): Promise<string | undefined> {
  if (config.DataLabApiKey !== '') {
    try {
      const stat = await toolCtx.storage.stat(toolCtx.ctx, toolCtx.wsIds, fileId)
      if (stat?.contentType !== 'application/pdf') {
        return
      }
      const file = await toolCtx.storage.get(toolCtx.ctx, toolCtx.wsIds, fileId)
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

export async function stream2buffer (stream: Stream): Promise<Buffer> {
  return await new Promise<Buffer>((resolve, reject) => {
    const _buf = Array<Buffer | Uint8Array>()
    stream.on('data', (chunk) => {
      _buf.push(typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk)
    })
    stream.on('end', () => {
      resolve(Buffer.concat(_buf))
    })
    stream.on('error', (err) => {
      reject(new Error(`error converting stream - ${err}`))
    })
  })
}
