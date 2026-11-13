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
// See the License for the specific language governing permissions and
// limitations under the License.
//

/** A request failure known to the REST layer; never instructs the client to retry a write. */
import { MeasureMetricsContext } from '@hcengineering/core'
import type { WorkspaceIds } from '@hcengineering/core'
import { Document } from '@hocuspocus/server'
import type { onChangePayload, onStoreDocumentPayload } from '@hocuspocus/server'
import type { Transformer } from '@hocuspocus/transformer'
import type { Context, withContext } from '../../context'
import { StorageExtension } from '../../extensions/storage'
import type { CollabStorageAdapter } from '../../storage/adapter'

it('persists pending edits with their writer when a direct reader triggers the store hook', async () => {
  const wsIds: Partial<WorkspaceIds> = { url: 'workspace' }
  const writer: Context = {
    connectionId: 'writer',
    wsIds: wsIds as WorkspaceIds,
    clientFactory: async () => {
      throw new Error('Unused fixture client')
    }
  }
  const reader: Context = { ...writer, connectionId: 'reader' }
  const saveDocument = jest.fn(async () => ({}))
  const adapter: CollabStorageAdapter = { loadDocument: async () => undefined, saveDocument }
  const transformer: Partial<Transformer> = { fromYdoc: () => ({}) }
  const extension = new StorageExtension({
    ctx: new MeasureMetricsContext('test', {}),
    adapter,
    transformer: transformer as Transformer
  })
  const document = new Document('workspace|class|document|content')
  document.isLoading = false
  const changed: Partial<withContext<onChangePayload>> = { context: writer, document, documentName: document.name }
  const stored: Partial<withContext<onStoreDocumentPayload>> = {
    context: reader,
    document,
    documentName: document.name
  }
  try {
    await extension.onChange(changed as withContext<onChangePayload>)
    await extension.onStoreDocument(stored as withContext<onStoreDocumentPayload>)
    expect(saveDocument).toHaveBeenCalledWith(expect.anything(), document.name, document, writer, expect.anything())
  } finally {
    await extension.onDestroy()
    document.destroy()
  }
})
