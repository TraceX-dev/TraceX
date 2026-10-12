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

const emptyTooltip: LabelAndProps = {
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
let storedValue: LabelAndProps = emptyTooltip
export const tooltipstore = derived(modalStore, (modals) => {
  if (modals.length === 0) {
    return emptyTooltip
  }
  const tooltip = modals.filter((m) => m?.type === 'tooltip')
  return tooltip.length > 0 ? (tooltip[tooltip.length - 1] as LabelAndProps) : emptyTooltip
})

let toHandler: any
let dismissHandler: ReturnType<typeof setTimeout> | undefined
export function tooltip (node: HTMLElement, options?: LabelAndProps): any {
  let opt = options
  const show = (): void => {
    const shown = !!(storedValue.label !== undefined || storedValue.component !== undefined)
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

      if (hasNowContent && node === storedValue.element) {
        const shown = !!(storedValue.label !== undefined || storedValue.component !== undefined)
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
  clearTimeout(toHandler)
  clearTimeout(dismissHandler)
  dismissHandler = undefined
  storedValue = {
    label,
    element,
    direction,
    component,
    props,
    anchor,
    onUpdate,
    kind,
    keys,
    type: 'tooltip',
    style,
    noArrow,
    textAlign
  }
  modalStore.update((old) => {
    const tooltip = old.find((m) => m?.type === 'tooltip') as LabelAndProps | undefined
    if (tooltip !== undefined && tooltip.component === storedValue.component) {
      if (tooltip.kind !== undefined && storedValue.kind === undefined) {
        storedValue.kind = tooltip.kind
      }
    }

    if (storedValue.kind == null) {
      storedValue.kind = 'tooltip'
    }

    old.push(storedValue)
    return old
  })
}

/**
 * Show a tooltip immediately and dismiss it after the given duration in milliseconds.
 * Returns a cleanup function that closes only this tooltip, without affecting a replacement.
 * @public
 */
export function showTooltipForDuration (
  label: IntlString,
  element: HTMLElement,
  durationMs: number = 2000,
  direction?: TooltipAlignment
): () => void {
  if (!Number.isFinite(durationMs) || durationMs < 0) {
    throw new RangeError('Tooltip duration must be a finite non-negative number')
  }
  showTooltip(label, element, direction)
  const shownTooltip = storedValue
  const dismiss = (): void => {
    if (storedValue === shownTooltip) {
      closeTooltip()
    }
  }
  dismissHandler = setTimeout(dismiss, durationMs)
  return dismiss
}

export function closeTooltip (): void {
  clearTimeout(toHandler)
  clearTimeout(dismissHandler)
  dismissHandler = undefined
  storedValue = emptyTooltip
  modalStore.update((old) => {
    old = old.filter((m) => m?.type !== 'tooltip')
    return old
  })
}
