// Copyright © 2025 Hardcore Engineering Inc.
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
// See the License for the specific language governing permissions and
// limitations under the License.
import { type Class, type Doc, type DocumentQuery, type Ref } from '@hcengineering/core'
import presentation from '@hcengineering/presentation'
import { addNotification, NotificationSeverity } from '@hcengineering/ui'
import { getMetadata, translate } from '@hcengineering/platform'
import { type RelationDefinition } from '@hcengineering/export'
import { getCurrentLanguage } from '@hcengineering/theme'
import ExportNotification from './components/ExportNotification.svelte'
import plugin from './plugin'

/** What to do with selected documents that an earlier export already imported. */
export type ExistingDocumentsMode = 'skip' | 'newVersion'

interface ExportToWorkspaceReport {
  message?: string
  exportedCount?: number
  newVersionCount?: number
  skippedDocuments?: Array<{ docId: string, name: string, reason: string }>
}

export async function exportToWorkspace (
  _class: Ref<Class<Doc>>,
  query: DocumentQuery<Doc> | undefined,
  selectedDocs: Doc[],
  targetWorkspace: string | undefined,
  relations?: RelationDefinition[] | undefined,
  skipDeletedObsolete?: boolean,
  exportOnlyEffective?: boolean,
  includeChildren?: boolean,
  existingDocuments: ExistingDocumentsMode = 'skip'
): Promise<void> {
  const lang = getCurrentLanguage()

  addNotification(
    await translate(plugin.string.ExportStarted, {}, lang),
    await translate(plugin.string.ExportStartedMessage, {}, lang),
    ExportNotification,
    undefined,
    NotificationSeverity.Info
  )

  try {
    const baseUrl = getMetadata(plugin.metadata.ExportUrl)
    const token = getMetadata(presentation.metadata.Token)
    if (token == null) {
      throw new Error('No token available')
    }

    const fieldMappers = {
      'documents:class:ControlledDocument': {
        author: '$currentUser',
        owner: '$currentUser',
        state: 'draft',
        major: 1,
        minor: 0,
        // Team members are Employee refs of the source workspace and do not exist in the target one.
        // Keeping them creates "phantom" members that block review/approval of the exported document.
        reviewers: [],
        approvers: [],
        externalApprovers: [],
        coAuthors: [],
        controlledState: '',
        seqNumber: '$generateSeqNumber',
        code: '$preserveUniqueCode'
      },
      'documents:class:DocumentMeta': {
        author: '$currentUser',
        owner: '$currentUser'
      },
      'products:class:ProductVersion': {
        major: 1,
        minor: 0,
        patch: 0
      }
    }

    const body: any = {
      targetWorkspace,
      _class,
      fieldMappers,
      skipDeletedObsolete,
      exportOnlyEffective,
      includeChildren,
      existingDocuments
    }
    if (relations != null) {
      body.relations = relations
    }

    body.query =
      selectedDocs.length > 0
        ? {
            _id: { $in: selectedDocs.map((d) => d._id) }
          }
        : query

    const res = await fetch(`${baseUrl}/export-to-workspace`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    })

    if (!res.ok) {
      let errorMessage = 'Unknown error occurred'
      let noDocuments = false
      try {
        const errorData = await res.json()
        errorMessage = errorData.message ?? errorData.error ?? `HTTP ${res.status}: ${res.statusText}`
        if (res.status === 400 && errorMessage === 'No documents found to export') {
          noDocuments = true
        }
      } catch {
        errorMessage = `HTTP ${res.status}: ${res.statusText}`
      }
      console.error('Export request failed:', errorMessage)

      if (noDocuments) {
        await showNoDocumentsNotification()
      } else {
        await showFailureNotification(errorMessage)
      }
      return
    }

    let report: ExportToWorkspaceReport = {}
    try {
      report = await res.json()
    } catch {
      // Older export services reply without a report.
    }
    await showCompletionNotification(report)
  } catch (err) {
    console.error('Export failed:', err)
    const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred'
    await showFailureNotification(errorMessage)
  }
}

async function showCompletionNotification (report: ExportToWorkspaceReport): Promise<void> {
  const lang = getCurrentLanguage()
  const skipped = report.skippedDocuments?.length ?? 0
  const newVersions = report.newVersionCount ?? 0
  const nothingExported = (report.exportedCount ?? 0) === 0 && skipped > 0

  const lines: string[] = []
  if (!nothingExported) {
    lines.push(await translate(plugin.string.ExportToWorkspaceCompletedMessage, {}, lang))
  }
  if (newVersions > 0) {
    lines.push(await translate(plugin.string.NewDraftVersionsCreated, { count: newVersions }, lang))
  }
  if (skipped > 0) {
    const names = report.skippedDocuments?.map((d) => d.name).join(', ') ?? ''
    lines.push(`${await translate(plugin.string.AlreadyImportedSkipped, { count: skipped }, lang)} (${names})`)
  }

  addNotification(
    await translate(
      nothingExported ? plugin.string.NothingToExport : plugin.string.ExportToWorkspaceCompleted,
      {},
      lang
    ),
    lines.join(' '),
    ExportNotification,
    undefined,
    nothingExported ? NotificationSeverity.Info : NotificationSeverity.Success
  )
}

async function showNoDocumentsNotification (): Promise<void> {
  const lang = getCurrentLanguage()
  addNotification(
    await translate(plugin.string.ExportToWorkspaceFailed, {}, lang),
    await translate(plugin.string.NoDocumentsMatchedFilters, {}, lang),
    ExportNotification,
    undefined,
    NotificationSeverity.Error
  )
}

async function showFailureNotification (errorDetails?: string): Promise<void> {
  const lang = getCurrentLanguage()
  const message =
    errorDetails !== undefined
      ? `${await translate(plugin.string.ExportFailed, {}, lang)}: ${errorDetails}`
      : await translate(plugin.string.ExportFailed, {}, lang)
  addNotification(
    await translate(plugin.string.ExportToWorkspaceFailed, {}, lang),
    message,
    ExportNotification,
    undefined,
    NotificationSeverity.Error
  )
}
