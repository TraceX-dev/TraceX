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

import type { Blob, BlobType, Ref } from '@hcengineering/core'
import { getJsonOrEmpty } from '@hcengineering/presentation'
import type { LinkPreviewDetails } from '@hcengineering/presentation'
import { getLinkPreviewDetails } from './link-preview'

jest.mock('@hcengineering/presentation', () => ({ getJsonOrEmpty: jest.fn() }))

const readJson = jest.mocked(getJsonOrEmpty)

beforeEach(() => {
  readJson.mockReset()
})

describe('getLinkPreviewDetails', () => {
  it('uses saved URL and display metadata without fetching the blob', async () => {
    const attachment: Pick<BlobType, 'file' | 'name' | 'metadata'> = {
      file: 'preview-blob' as Ref<Blob>,
      name: 'https://example.com/article',
      metadata: { url: 'https://example.com/article', title: 'Article title', icon: 'https://example.com/icon.png' }
    }

    expect(await getLinkPreviewDetails(attachment)).toEqual(attachment.metadata)
    expect(readJson).not.toHaveBeenCalled()
  })

  it('recovers the original URL and display details from legacy UUID attachments', async () => {
    const attachment: Pick<BlobType, 'file' | 'name' | 'metadata'> = {
      file: 'legacy-preview-blob' as Ref<Blob>,
      name: '8fb292ab-cc26-483b-a09e-343212fc892a',
      metadata: { title: 'Article title', description: 'Article summary' }
    }
    const details: LinkPreviewDetails = {
      url: 'https://example.com/article',
      title: 'Article title',
      icon: 'https://example.com/icon.png'
    }
    readJson.mockResolvedValue(details)

    expect(await getLinkPreviewDetails(attachment)).toEqual({
      ...attachment.metadata,
      ...details
    })
    expect(readJson).toHaveBeenCalledWith(attachment.file, attachment.name)
  })

  it('keeps the readable title if a legacy preview blob cannot be loaded', async () => {
    const attachment: Pick<BlobType, 'file' | 'name' | 'metadata'> = {
      file: 'missing-preview-blob' as Ref<Blob>,
      name: '8fb292ab-cc26-483b-a09e-343212fc892a',
      metadata: { title: 'Article title' }
    }
    readJson.mockResolvedValue(undefined)

    expect(await getLinkPreviewDetails(attachment)).toEqual({ title: 'Article title' })
  })
})
