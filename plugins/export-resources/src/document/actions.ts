//
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

// Shared export/import of a Doc's collaborative "content" field (round-tripping through
// Word/Markdown via the pod-export service). Originally written for controlled documents,
// generalized so it can be reused for any class whose content is a collaborative markup
// field named `content` (e.g. Card) — see server-side `exportDocumentHandler` in
// services/export/pod-export, which resolves the field generically by that name.

import attachment from '@hcengineering/attachment'
import { getClient as getCollaboratorClient } from '@hcengineering/collaborator-client'
import { type Doc, makeDocCollabId } from '@hcengineering/core'
import exportPlugin, { hasDocumentContent } from '@hcengineering/export'
import type {
  DocumentContentTarget,
  DocumentExportFormat,
  DocumentExportOptions,
  DocumentExporterOptions,
  DocumentExportResult
} from '@hcengineering/export'
export type { DocumentContentTarget } from '@hcengineering/export'
import { getMetadata, getResource, setPlatformStatus, translate, unknownError } from '@hcengineering/platform'
import presentation, { getClient } from '@hcengineering/presentation'
import { jsonToMarkup, type MarkupNode } from '@hcengineering/text'
import { addNotification, NotificationSeverity, showPopup, withProgress } from '@hcengineering/ui'
import { getCurrentLanguage } from '@hcengineering/theme'
import { getDocTitle } from '@hcengineering/view-resources'

import { downloadBlob, fileNameFromResponse } from '../download'
import DocumentImportDiffPopup from './components/DocumentImportDiffPopup.svelte'
import ExportNotification from '../components/ExportNotification.svelte'

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

/** Convert editor content without starting a download or opening a popup. */
async function prepareDocumentContent (
  doc: DocumentContentTarget,
  format: DocumentExportFormat,
  options?: DocumentExportOptions
): Promise<DocumentExportResult> {
  const response = await fetch(`${getExportBaseUrl()}/document-export`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ _class: doc._class, _id: doc._id, format, ...options })
  })
  if (!response.ok) {
    const message = await readErrorMessage(response)
    throw new Error(message ?? `Failed to export document (${response.status})`)
  }

  const blob = await response.blob()
  const title = options?.title?.trim() || doc.title?.trim()
  const filename = fileNameFromResponse(response, title ? `${title}.${format}` : '')
  if (filename === '') throw new Error('Document title is required for export')
  return { file: blob, name: filename, contentType: blob.type }
}

/** Model exporter for the Word and Markdown content formats. */
export async function exportContent (doc: Doc, options: DocumentExporterOptions): Promise<DocumentExportResult> {
  if (options.format !== 'docx' && options.format !== 'md') {
    throw new Error(`Unsupported content format: ${options.format}`)
  }
  const title = await getDocTitle(getClient(), doc._id, doc._class, doc)
  return await prepareDocumentContent(doc, options.format, { orientation: options.orientation, title })
}

export async function canExportContent (doc: Doc): Promise<boolean> {
  return (
    (getMetadata(exportPlugin.metadata.ExportUrl) ?? '') !== '' && hasDocumentContent(getClient().getHierarchy(), doc)
  )
}

/** Export a doc's editor content and download it for direct callers. */
export async function exportDocumentContent (
  doc: DocumentContentTarget,
  format: DocumentExportFormat,
  options?: DocumentExportOptions
): Promise<boolean> {
  try {
    const result = await prepareDocumentContent(doc, format, options)
    if (typeof result.file === 'string') throw new Error('Expected converted document data')
    downloadBlob(result.file, result.name)
    return true
  } catch (error) {
    addNotification(
      await translate(exportPlugin.string.DocumentContentExportFailed, {}, getCurrentLanguage()),
      error instanceof Error ? error.message : String(error),
      ExportNotification,
      undefined,
      NotificationSeverity.Error
    )
    return false
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
