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

import { type IntlString } from '@hcengineering/platform'
import { derived, get } from 'svelte/store'
import type { AnyComponent, AnySvelteComponent, LabelAndProps, TooltipAlignment } from './types'
import { modalStore } from './modals'
import { type CompAndProps } from './popups'
import { reserveZIndex, type ZIndexReservation } from './z-index'

interface TooltipEntry extends LabelAndProps {
  layer?: ZIndexReservation
}

function isTooltip (modal: CompAndProps | TooltipEntry): modal is TooltipEntry {
  return modal.type === 'tooltip'
}

const emptyTooltip: TooltipEntry = {
  label: undefined,
  element: undefined,
  direction: undefined,
  component: undefined,
  props: undefined,
  anchor: undefined,
  onUpdate: undefined,
  keys: undefined,
  kind: 'tooltip',
  style: undefined,
  noArrow: false,
  textAlign: undefined
}
export const tooltipstore = derived(modalStore, (modals): TooltipEntry => {
  return modals.find(isTooltip) ?? emptyTooltip
})

let toHandler: any
export function tooltip (node: HTMLElement, options?: LabelAndProps): any {
  let opt = options
  const show = (): void => {
    const current = get(tooltipstore)
    const shown = current.label !== undefined || current.component !== undefined
    if (!shown) {
      if (opt?.kind !== 'submenu' || opt.timeout !== undefined) {
        clearTimeout(toHandler)
        toHandler = setTimeout(() => {
          showTooltip(
            opt?.label,
            node,
            opt?.direction,
            opt?.component,
            opt?.props,
            opt?.anchor,
            opt?.onUpdate,
            opt?.kind,
            opt?.keys,
            opt?.style,
            opt?.noArrow,
            opt?.textAlign
          )
        }, opt?.timeout ?? 10)
      } else {
        showTooltip(
          opt?.label,
          node,
          opt?.direction,
          opt?.component,
          opt?.props,
          opt?.anchor,
          opt?.onUpdate,
          opt?.kind,
          opt?.keys,
          opt?.style,
          opt?.noArrow,
          opt?.textAlign
        )
      }
    }
  }
  const hide = (): void => {
    clearTimeout(toHandler)
  }

  const hasContent = (o?: LabelAndProps): boolean => o?.label !== undefined || o?.component !== undefined

  if (hasContent(options)) {
    node.addEventListener('mouseleave', hide)
    node.addEventListener('mousemove', show)
  }

  return {
    update (options: LabelAndProps) {
      const hadContent = hasContent(opt)
      const hasNowContent = hasContent(options)
      opt = options

      if (!hadContent && hasNowContent) {
        node.addEventListener('mousemove', show)
        node.addEventListener('mouseleave', hide)
      } else if (hadContent && !hasNowContent) {
        node.removeEventListener('mousemove', show)
        node.removeEventListener('mouseleave', hide)
      }

      const current = get(tooltipstore)
      if (hasNowContent && node === current.element) {
        const shown = current.label !== undefined || current.component !== undefined
        if (shown) {
          showTooltip(
            opt.label,
            node,
            opt.direction,
            opt.component,
            opt.props,
            opt.anchor,
            opt.onUpdate,
            opt.kind,
            opt.keys,
            opt.style,
            opt.noArrow,
            opt.textAlign
          )
        }
      }
    },

    destroy () {
      const currentTooltip = get(tooltipstore)
      if (currentTooltip?.element != null && currentTooltip.element === node) {
        closeTooltip()
      }
      node.removeEventListener('mousemove', show)
      node.removeEventListener('mouseleave', hide)
    }
  }
}

export function showTooltip (
  label: IntlString | undefined,
  element: HTMLElement,
  direction?: TooltipAlignment,
  component?: AnySvelteComponent | AnyComponent,
  props?: any,
  anchor?: HTMLElement,
  onUpdate?: (result: any) => void,
  kind?: 'tooltip' | 'submenu' | 'popup',
  keys?: string[],
  style?: 'default' | 'modern',
  noArrow?: boolean,
  textAlign?: 'left' | 'center' | 'right'
): void {
  modalStore.update((old) => {
    const current = old.find(isTooltip)
    const nextKind = kind ?? (current?.component === component ? current?.kind : undefined) ?? 'tooltip'
    const next: TooltipEntry = {
      label,
      element,
      direction,
      component,
      props,
      anchor,
      onUpdate,
      kind: nextKind,
      keys,
      type: 'tooltip',
      style,
      noArrow,
      textAlign,
      layer: (current?.element === element ? current.layer : undefined) ?? reserveZIndex()
    }
    return [...old.filter((modal) => modal.type !== 'tooltip'), next]
  })
}

export function closeTooltip (): void {
  clearTimeout(toHandler)
  modalStore.update((old) => {
    old = old.filter((m) => m?.type !== 'tooltip')
    return old
  })
}
