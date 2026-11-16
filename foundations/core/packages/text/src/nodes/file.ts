//
// Copyright © 2023 Hardcore Engineering Inc.
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
import { Node } from '@tiptap/core'

/**
 * @public
 */
export interface FileOptions {
  inline: boolean
  HTMLAttributes: Record<string, any>
}

/**
 * @public
 */
export const FileNode = Node.create<FileOptions>({
  name: 'file',

  addSchemaAwareness () {
    return {
      label: 'Attached file',
      description:
        'Reference to an existing file with a download label. Preserve file identity and metadata; inserting this node does not upload or create a file.',
      attributes: {
        'file-id': { access: 'readonly', description: 'Existing attachment ID. Do not invent it.' },
        'data-file-name': { access: 'readonly', description: 'Download filename.' },
        'data-file-size': { access: 'readonly', description: 'File size in bytes.' },
        'data-file-type': { access: 'readonly', description: 'MIME type.' },
        'data-file-href': { access: 'readonly', description: 'Download URL.' }
      }
    }
  },

  addOptions () {
    return {
      inline: true,
      HTMLAttributes: {}
    }
  },

  inline () {
    return this.options.inline
  },

  group () {
    return this.options.inline ? 'inline' : 'block'
  },

  draggable: true,

  selectable: true,

  addAttributes () {
    return {
      'file-id': {
        default: null,
        validate: 'string|null'
      },
      'data-file-name': {
        default: null,
        validate: 'string|null'
      },
      'data-file-size': {
        default: null,
        validate: 'string|number|null'
      },
      'data-file-type': {
        default: null,
        validate: 'string|null'
      },
      'data-file-href': {
        default: null,
        validate: 'string|null'
      }
    }
  },

  parseHTML () {
    return [
      {
        tag: `div[data-type="${this.name}"]`
      }
    ]
  },

  renderHTML ({ node, HTMLAttributes }) {
    const nodeAttributes = {
      'data-type': this.name
    }

    const fileName = HTMLAttributes['data-file-name']
    const size = HTMLAttributes['data-file-size']
    const fileType = HTMLAttributes['data-file-type']
    const href = HTMLAttributes['data-file-href']
    const linkAttributes = {
      class: 'file-name',
      href,
      type: fileType,
      download: fileName,
      target: '_blank'
    }

    return [
      'div',
      nodeAttributes,
      ['div', {}, ['a', linkAttributes, `${fileName} (${fileType})`]],
      ['div', {}, `${size}`]
    ]
  }
})
