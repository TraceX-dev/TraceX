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

import type { BlobType } from '@hcengineering/core'
import { getJsonOrEmpty } from '@hcengineering/presentation'
import type { LinkPreviewAttachmentMetadata, LinkPreviewDetails } from '@hcengineering/presentation'

/** Read preview metadata, falling back to stored JSON for older attachments. */
export async function getLinkPreviewDetails (
  attachment: Pick<BlobType, 'file' | 'name' | 'metadata'>
): Promise<LinkPreviewDetails> {
  const metadata: LinkPreviewAttachmentMetadata | undefined = attachment.metadata
  if (metadata?.url !== undefined) return metadata

  const details = await getJsonOrEmpty<LinkPreviewDetails>(attachment.file, attachment.name)
  return { ...metadata, ...details }
}
