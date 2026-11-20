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
import { getImageSize, imageSizeToRatio } from '@hcengineering/presentation'
import { getDefaultImageDisplay } from './imageDisplay'
import type { InsertTarget } from './insert-target'
import type { FileAttachFunction } from './types'

export async function insertInlineImages (
  files: File[],
  attachFile: FileAttachFunction | undefined,
  target: InsertTarget
): Promise<void> {
  if (attachFile === undefined) return
  const canInsert = (): boolean => target.pos !== null

  for (const file of files) {
    if (!canInsert()) break
    if (!file.type.startsWith('image/')) continue
    target.begin()
    const attached = await attachFile(file)
    if (!canInsert()) break
    if (attached === undefined) continue

    const size = await getImageSize(file)
    if (!canInsert()) break
    target.insertNext((insertion) =>
      insertion.command(({ tr, commands }) =>
        commands.insertContent({
          type: 'image',
          attrs: {
            'file-id': attached.file,
            width: imageSizeToRatio(size.width, size.pixelRatio),
            display: getDefaultImageDisplay(tr.doc, tr.selection.from)
          }
        })
      )
    )
  }
}
