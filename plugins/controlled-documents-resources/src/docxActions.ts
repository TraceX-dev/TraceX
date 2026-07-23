//
// Copyright © 2026 TraceX SAS.
//
// Licensed under the PolyForm Shield License 1.0.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://polyformproject.org/licenses/shield/1.0.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//
// See the License for the specific language governing permissions and
// limitations under the License.
//

import attachment from '@hcengineering/attachment'
import { getClient as getCollaboratorClient } from '@hcengineering/collaborator-client'
import { makeDocCollabId } from '@hcengineering/core'
import { type ControlledDocument } from '@hcengineering/controlled-documents'
import exportPlugin from '@hcengineering/export'
import { getMetadata, getResource, setPlatformStatus, translate, unknownError } from '@hcengineering/platform'
import presentation from '@hcengineering/presentation'
import { jsonToMarkup, type MarkupNode } from '@hcengineering/text'
import { showPopup, withProgress } from '@hcengineering/ui'
import { getCurrentLanguage } from '@hcengineering/theme'

import ImportDocxPopup from './components/document/ImportDocxPopup.svelte'
import plugin from './plugin'

function getExportBaseUrl (): string {
  const url = getMetadata(exportPlugin.metadata.ExportUrl)
  if (url === undefined || url === '') {
    throw new Error('Export service URL (export.metadata.ExportUrl) is not configured')
  }
  return url
}

function getToken (): string {
  return getMetadata(presentation.metadata.Token) ?? ''
}

function authHeaders (): Record<string, string> {
  return {
    Authorization: `Bearer ${getToken()}`,
    'Content-Type': 'application/json'
  }
}

/** Export a document's body to a .docx file and trigger a browser download. */
export async function exportDocumentToWord (obj: ControlledDocument | ControlledDocument[]): Promise<void> {
  const doc = Array.isArray(obj) ? obj[0] : obj
  if (doc === undefined) {
    return
  }

  const response = await fetch(`${getExportBaseUrl()}/document-export`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ _class: doc._class, _id: doc._id, format: 'docx' })
  })
  if (!response.ok) {
    throw new Error('Failed to export document to Word')
  }

  const blob = await response.blob()
  const contentDisposition = response.headers.get('Content-Disposition')
  const filename = contentDisposition?.match(/filename="([^"]*)"/)?.[1] ?? `${doc.title ?? 'document'}.docx`

  // Attach the anchor to the DOM before click() (detached anchors are ignored by some
  // browsers) and defer the revoke — revoking synchronously drops the blob mid-read and
  // the download stalls.
  const url = window.URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.style.display = 'none'
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  setTimeout(() => {
    document.body.removeChild(anchor)
    window.URL.revokeObjectURL(url)
  }, 10000)
}

/** Import an edited .docx: convert, preview the diff, and on confirm write it back. */
export async function importWordIntoDocument (obj: ControlledDocument | ControlledDocument[]): Promise<void> {
  const doc = Array.isArray(obj) ? obj[0] : obj
  if (doc === undefined) {
    return
  }
  const file = await pickFile('.docx')
  if (file === undefined) {
    return
  }

  const lang = getCurrentLanguage()
  let converted: { current: MarkupNode, candidate: MarkupNode }
  try {
    // Conversion can take a while with no incremental progress, so a shared
    // long-running-task toast shows a spinner until it settles.
    converted = await withProgress(
      {
        title: await translate(plugin.string.ImportingFromWord, {}, lang),
        message: await translate(plugin.string.ConvertingWordDocument, {}, lang),
        done: await translate(plugin.string.DocumentConverted, {}, lang),
        failed: await translate(plugin.string.ImportFailed, {}, lang)
      },
      async () => {
        const uploadFile = await getResource(attachment.helper.UploadFile)
        const { uuid } = await uploadFile(file)

        const diffResponse = await fetch(`${getExportBaseUrl()}/document-import`, {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({ blobId: uuid, _class: doc._class, _id: doc._id, format: 'docx' })
        })
        if (!diffResponse.ok) {
          throw new Error('Failed to convert Word document')
        }
        return (await diffResponse.json()) as { current: MarkupNode, candidate: MarkupNode }
      }
    )
  } catch {
    // The progress toast already surfaced the failure.
    return
  }

  showPopup(ImportDocxPopup, { current: converted.current, candidate: converted.candidate }, undefined, (apply) => {
    if (apply === true) {
      void applyImportedContent(doc, converted.candidate).catch((err) => {
        void setPlatformStatus(unknownError(err))
      })
    }
  })
}

async function applyImportedContent (doc: ControlledDocument, markup: MarkupNode): Promise<void> {
  // NOTE: writes into the current (Draft) document's content. Creating a brand-new
  // version/snapshot before applying (createNewDraftForControlledDoc + snapshot) is a
  // follow-up — it needs project/version resolution owned by the CD "new draft" flow.
  //
  // The write goes through the collaborator (updateMarkup), NOT a raw content-blob
  // write: the editor and collaborator serve the live Y.Doc, and a document that has
  // ever been opened has a Y.Doc blob that takes precedence over the JSON content blob.
  // Only updateMarkup updates that live Y.Doc, so the change actually becomes visible.
  const token = getMetadata(presentation.metadata.Token) ?? ''
  const collaboratorUrl = getMetadata(presentation.metadata.CollaboratorUrl) ?? ''
  const workspace = getMetadata(presentation.metadata.WorkspaceUuid)
  if (workspace === undefined || collaboratorUrl === '') {
    throw new Error('Collaborator service is not configured')
  }

  const collaborator = getCollaboratorClient(workspace, token, collaboratorUrl)
  await collaborator.updateMarkup(makeDocCollabId(doc, 'content'), jsonToMarkup(markup))
}

async function pickFile (accept: string): Promise<File | undefined> {
  return await new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    input.onchange = () => {
      resolve(input.files?.[0])
    }
    input.click()
  })
}
