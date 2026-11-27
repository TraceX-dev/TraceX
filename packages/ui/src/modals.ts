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

import { writable } from 'svelte/store'
import { type CompAndProps } from './popups'
import { type LabelAndProps } from './types'
import { type ZIndexReservation } from './z-index'

export const modalStore = writable<Array<(LabelAndProps | CompAndProps) & { layer?: ZIndexReservation }>>([])

let activeLayers = new Set<ZIndexReservation>()
modalStore.subscribe((modals) => {
  const previous = activeLayers
  activeLayers = new Set(modals.flatMap(({ layer }) => (layer === undefined ? [] : [layer])))

  for (const layer of previous) {
    if (!activeLayers.has(layer)) {
      // The renderers still hold the old indices until Svelte removes their DOM.
      setTimeout(() => {
        if (!activeLayers.has(layer)) layer.release()
      }, 0)
    }
  }
})
