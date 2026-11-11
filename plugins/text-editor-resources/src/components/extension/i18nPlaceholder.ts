//
// Copyright © 2025 Hardcore Engineering Inc.
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

import { type IntlString, translate } from '@hcengineering/platform'
import { type ThemeOptions } from '@hcengineering/theme'
import { type PlaceholderOptions, Placeholder } from '@tiptap/extensions'
import { type Readable, get } from 'svelte/store'

export interface I18nPlaceholderOptions extends PlaceholderOptions {
  placeholderIntl: IntlString
  placeholderIntlParams?: Record<string, any>
  themeStore: Readable<ThemeOptions>
}

export interface I18nPlaceholderStorage {
  placeholder: string
  unsubscribe?: () => void
}

const I18N_PLACEHOLDER_NAME = 'i18n-placeholder'

export const I18nPlaceholderExtension = Placeholder.extend<I18nPlaceholderOptions, I18nPlaceholderStorage>({
  name: I18N_PLACEHOLDER_NAME,

  addOptions () {
    return {
      ...this.parent?.(),
      // Tiptap 3 hands every hook a fresh copy of `options`, so assigning `this.options.placeholder`
      // in onCreate never reaches the placeholder plugin. Read the translated text from the
      // per-editor storage instead, which is shared across all hooks of this editor instance.
      placeholder: ({ editor }) =>
        (editor.storage as unknown as Record<string, I18nPlaceholderStorage | undefined>)[I18N_PLACEHOLDER_NAME]
          ?.placeholder ?? '',
      placeholderIntl: '' as IntlString,
      placeholderIntlParams: {},
      emptyEditorClass: 'is-editor-empty',
      emptyNodeClass: 'is-empty',
      dataAttribute: 'placeholder',
      showOnlyWhenEditable: true,
      showOnlyCurrent: true,
      includeChildren: false,
      themeStore: undefined as any
    }
  },

  addStorage () {
    return {
      placeholder: '',
      unsubscribe: undefined
    }
  },

  onCreate () {
    const options = this.options
    const storage = this.storage

    const placeholderIntl = options.placeholderIntl
    const placeholderIntlParams = options.placeholderIntlParams

    // Get initial translation
    const theme = get(options.themeStore)
    if (placeholderIntl !== undefined) {
      void translate(placeholderIntl, placeholderIntlParams, theme?.language ?? 'en').then((translated) => {
        storage.placeholder = translated
        // Force initial update
        if (this.editor !== undefined && this.editor !== null) {
          this.editor.view.dispatch(this.editor.state.tr)
        }
      })
    }

    // Subscribe to theme store changes
    if (options.themeStore !== undefined && options.themeStore !== null) {
      storage.unsubscribe = options.themeStore.subscribe((theme) => {
        if (placeholderIntl !== undefined) {
          void translate(placeholderIntl, placeholderIntlParams, theme.language).then((translated) => {
            storage.placeholder = translated
            // Force editor update to show new translation
            if (this.editor !== undefined && this.editor !== null) {
              this.editor.view.dispatch(this.editor.state.tr)
            }
          })
        }
      })
    }
  },

  onDestroy () {
    this.storage.unsubscribe?.()
  }
})
