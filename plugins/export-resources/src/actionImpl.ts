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

import { type Class, type Doc, type Ref } from '@hcengineering/core'
import { showPopup } from '@hcengineering/ui'
import { viewletContextStore } from '@hcengineering/view-resources'
import { get } from 'svelte/store'

import ExportTableDialog from './components/ExportTableDialog.svelte'

export interface ExportTableActionProps {
  cardClass?: Ref<Class<Doc>>
}

/**
 * Open the export dialog for the table currently on screen.
 *
 * Both scopes come from what the tab already holds: the selection arrives as the action argument,
 * and the rendered rows come from the viewlet context, which also carries the column config the
 * table was drawn with — including the user's own column customisation.
 * @public
 */
export async function exportTableAction (
  doc: Doc | Doc[] | undefined,
  evt: Event | undefined,
  props: ExportTableActionProps = {}
): Promise<void> {
  const context = get(viewletContextStore).getLastContext()

  const selected = Array.isArray(doc) ? doc : doc !== undefined ? [doc] : []
  const cardClass = props.cardClass ?? context?._class ?? selected[0]?._class
  if (cardClass === undefined) {
    return
  }

  showPopup(ExportTableDialog, {
    _class: cardClass,
    props: {
      cardClass,
      viewlet: context?.viewlet,
      config: context?.config,
      query: context?.query
    },
    selected,
    page: context?.objects ?? []
  })
}
