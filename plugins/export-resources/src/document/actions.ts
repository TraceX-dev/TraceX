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

// Shared export/import of a Doc's collaborative "content" field (round-tripping through
// Word/Markdown via the pod-export service). Originally written for controlled documents,
// generalized so it can be reused for any class whose content is a collaborative markup
// field named `content` (e.g. Card) — see server-side `exportDocumentHandler` in
// services/export/pod-export, which resolves the field generically by that name.

import attachment from '@hcengineering/attachment'
import { getClient as getCollaboratorClient } from '@hcengineering/collaborator-client'
import { type Doc, makeDocCollabId } from '@hcengineering/core'
import exportPlugin from '@hcengineering/export'
import { getMetadata, getResource, setPlatformStatus, translate, unknownError } from '@hcengineering/platform'
import presentation from '@hcengineering/presentation'
import { jsonToMarkup, type MarkupNode } from '@hcengineering/text'
import { showPopup, withProgress } from '@hcengineering/ui'
import { getCurrentLanguage } from '@hcengineering/theme'

import { downloadBlob, fileNameFromResponse } from '../download'
import DocumentImportDiffPopup from './components/DocumentImportDiffPopup.svelte'

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

async function readErrorMessage (response: Response): Promise<string | undefined> {
  const body = await response.json().catch((): undefined => undefined)
  return typeof body?.message === 'string' && body.message.length > 0 ? body.message : undefined
}

/** Any object with a collaborative `content` blob field, addressable as a doc (Card, ControlledDocument, ...). */
export type DocumentContentTarget = Pick<Doc, '_class' | '_id'> & { title?: string }

/** Export a doc's `content` field in the given format ('docx' | 'md') and download it. */
export async function exportDocumentContent (doc: DocumentContentTarget, format: string): Promise<void> {
  const lang = getCurrentLanguage()
  try {
    // The conversion can take a while with no incremental progress, so a shared
    // long-running-task toast shows a spinner until it settles and surfaces failures
    // (e.g. content the exporter can't convert) instead of silently doing nothing.
    await withProgress(
      {
        title: await translate(exportPlugin.string.ExportingDocumentContent, {}, lang),
        done: await translate(exportPlugin.string.DocumentContentExported, {}, lang),
        failed: await translate(exportPlugin.string.DocumentContentExportFailed, {}, lang)
      },
      async () => {
        const response = await fetch(`${getExportBaseUrl()}/document-export`, {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({ _class: doc._class, _id: doc._id, format })
        })
        if (!response.ok) {
          const message = await readErrorMessage(response)
          throw new Error(message ?? `Failed to export document (${response.status})`)
        }

        const blob = await response.blob()
        const filename = fileNameFromResponse(response, `${doc.title ?? 'document'}.${format}`)
        downloadBlob(blob, filename)
      }
    )
  } catch {
    // The progress toast already surfaced the failure.
  }
}

/** Import an edited doc's `content` field ('docx' | 'md'): convert, preview the diff, apply. */
export async function importDocumentContent (doc: DocumentContentTarget, format: string): Promise<void> {
  const accept = format === 'md' ? '.md,.markdown' : '.docx'
  const file = await pickFile(accept)
  if (file === undefined) {
    return
  }

  const lang = getCurrentLanguage()
  let converted: { current: MarkupNode, candidate: MarkupNode }
  try {
    converted = await withProgress(
      {
        title: await translate(exportPlugin.string.ImportingDocumentContent, {}, lang),
        message: await translate(exportPlugin.string.ConvertingDocumentContent, {}, lang),
        done: await translate(exportPlugin.string.DocumentContentConverted, {}, lang),
        failed: await translate(exportPlugin.string.DocumentContentImportFailed, {}, lang)
      },
      async () => {
        const uploadFile = await getResource(attachment.helper.UploadFile)
        const { uuid } = await uploadFile(file)

        const diffResponse = await fetch(`${getExportBaseUrl()}/document-import`, {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({ blobId: uuid, _class: doc._class, _id: doc._id, format })
        })
        if (!diffResponse.ok) {
          const message = await readErrorMessage(diffResponse)
          throw new Error(message ?? 'Failed to convert document')
        }
        return (await diffResponse.json()) as { current: MarkupNode, candidate: MarkupNode }
      }
    )
  } catch {
    // The progress toast already surfaced the failure.
    return
  }

  showPopup(
    DocumentImportDiffPopup,
    { current: converted.current, candidate: converted.candidate },
    undefined,
    (apply) => {
      if (apply === true) {
        void applyImportedDocumentContent(doc, converted.candidate).catch((err) => {
          void setPlatformStatus(unknownError(err))
        })
      }
    }
  )
}

async function applyImportedDocumentContent (doc: DocumentContentTarget, markup: MarkupNode): Promise<void> {
  // The write goes through the collaborator (updateMarkup), NOT a raw content-blob write:
  // the editor and collaborator serve the live Y.Doc, and a document that has ever been
  // opened has a Y.Doc blob that takes precedence over the JSON content blob. Only
  // updateMarkup updates that live Y.Doc, so the change actually becomes visible.
  const token = getMetadata(presentation.metadata.Token) ?? ''
  const collaboratorUrl = getMetadata(presentation.metadata.CollaboratorUrl) ?? ''
  const workspace = getMetadata(presentation.metadata.WorkspaceUuid)
  if (workspace === undefined || collaboratorUrl === '') {
    throw new Error('Collaborator service is not configured')
  }

  const collaborator = getCollaboratorClient(workspace, token, collaboratorUrl)
  await collaborator.updateMarkup(makeDocCollabId(doc as unknown as Doc, 'content'), jsonToMarkup(markup))
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
