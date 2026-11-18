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

import { Mark } from '@tiptap/core'
import { enumValidator, getDataAttribute } from '../nodes/utils'

export const name = 'note'
export enum NoteKind {
  Neutral = 'neutral',
  Dangerous = 'dangerous',
  DangerousLight = 'dangerous-light',
  Warning = 'warning',
  WarningLight = 'warning-light',
  Positive = 'positive',
  PositiveLight = 'positive-light',
  Primary = 'primary',
  PrimaryLight = 'primary-light'
}

declare module '@tiptap/core' {
  export interface Commands<ReturnType> {
    [name]: {
      setNote: (text: string, kind: NoteKind) => ReturnType
      unsetNote: () => ReturnType
    }
  }
}

export const NoteBaseExtension = Mark.create({
  name,

  addSchemaAwareness () {
    return {
      label: 'Highlighted note',
      description: 'Inline note with a semantic color and optional title.',
      attributes: { title: { description: 'Optional title.' }, kind: { description: 'Semantic note kind.' } }
    }
  },

  parseHTML () {
    return [
      {
        tag: `span[data-mark="${name}"]`
      }
    ]
  },

  renderHTML ({ HTMLAttributes, mark }) {
    return [
      'span',
      { ...HTMLAttributes, 'data-mark': this.name, class: `theme-text-editor-note-anchor ${mark.attrs.kind}` },
      0
    ]
  },

  addAttributes () {
    return {
      title: {
        default: null,
        validate: 'string|null'
      },
      kind: getDataAttribute('kind', { default: NoteKind.Neutral, validate: enumValidator(Object.values(NoteKind)) })
    }
  }
})
