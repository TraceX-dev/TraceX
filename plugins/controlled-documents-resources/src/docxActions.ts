//
// Copyright © 2025 Hardcore Engineering Inc.
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

import attachment from '@hcengineering/attachment'
import { type Blob, type Ref } from '@hcengineering/core'
import { type ControlledDocument } from '@hcengineering/controlled-documents'
import exportPlugin from '@hcengineering/export'
import { getMetadata, getResource } from '@hcengineering/platform'
import presentation, { getClient } from '@hcengineering/presentation'
import { type MarkupNode } from '@hcengineering/text'
import { showPopup } from '@hcengineering/ui'

import ImportDocxPopup from './components/document/ImportDocxPopup.svelte'

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
export async function exportDocumentToWord (doc: ControlledDocument): Promise<void> {
  const response = await fetch(`${getExportBaseUrl()}/document-to-docx`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ _class: doc._class, _id: doc._id })
  })
  if (!response.ok) {
    throw new Error('Failed to export document to Word')
  }
  const blob = await response.blob()
  const objectUrl = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = objectUrl
  anchor.download = `${doc.title ?? 'document'}.docx`
  anchor.click()
  URL.revokeObjectURL(objectUrl)
}

/** Import an edited .docx: convert, preview the diff, and on confirm write it back. */
export async function importWordIntoDocument (doc: ControlledDocument): Promise<void> {
  const file = await pickFile('.docx')
  if (file === undefined) {
    return
  }

  const uploadFile = await getResource(attachment.helper.UploadFile)
  const { uuid } = await uploadFile(file)

  const diffResponse = await fetch(`${getExportBaseUrl()}/docx-diff`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ blobId: uuid, _class: doc._class, _id: doc._id })
  })
  if (!diffResponse.ok) {
    throw new Error('Failed to convert Word document')
  }
  const { current, candidate }: { current: MarkupNode, candidate: MarkupNode } = await diffResponse.json()

  showPopup(ImportDocxPopup, { current, candidate }, undefined, (apply) => {
    if (apply === true) {
      void applyImportedContent(doc, candidate)
    }
  })
}

async function applyImportedContent (doc: ControlledDocument, markup: MarkupNode): Promise<void> {
  // NOTE: writes into the current (Draft) document's content. Creating a brand-new
  // version/snapshot before applying (createNewDraftForControlledDoc + snapshot) is a
  // follow-up — it needs project/version resolution owned by the CD "new draft" flow.
  const response = await fetch(`${getExportBaseUrl()}/markup-to-content`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ _class: doc._class, _id: doc._id, objectAttr: 'content', markup })
  })
  if (!response.ok) {
    throw new Error('Failed to apply imported content')
  }
  const { blobId }: { blobId: Ref<Blob> } = await response.json()

  const client = getClient()
  await client.updateDoc(doc._class, doc.space, doc._id, { content: blobId })
}

function pickFile (accept: string): Promise<File | undefined> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    input.onchange = () => {
      resolve(input.files?.[0])
    }
    input.click()
  })
}
