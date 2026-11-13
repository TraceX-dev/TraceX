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
import type { Blob, Ref } from '@hcengineering/core'
import { Node, mergeAttributes } from '@tiptap/core'
import { enumValidator, getDataAttribute } from './utils'

/**
 * @public
 */
export type ImageAlignment = 'center' | 'left' | 'right'

export interface ImageAlignmentOptions {
  align?: ImageAlignment
}

/**
 * `block` (default, same as `null`): own line, `align` applies. `inline`: flows with the text.
 * @public
 */
export type ImageDisplay = 'block' | 'inline'

export interface ImageDisplayOptions {
  display?: ImageDisplay | null
}

export interface ImageSizeOptions {
  height?: number | string
  width?: number | string
}

declare module '@tiptap/core' {
  export interface Commands<ReturnType> {
    image: {
      /**
       * Add an image
       */
      setImage: (options: { src: string, alt?: string, title?: string, display?: ImageDisplay | null }) => ReturnType
      /**
       * Set image alignment
       */
      setImageAlignment: (options: ImageAlignmentOptions) => ReturnType
      /**
       * Set image display mode
       */
      setImageDisplay: (options: ImageDisplayOptions) => ReturnType
      /**
       * Set image size
       */
      setImageSize: (options: ImageSizeOptions) => ReturnType
    }
  }
}

/**
 * Width of an inline image goes on its container so that a percentage resolves against
 * the paragraph; on the `<img>` it resolves against a shrink-to-fit container that stays
 * line-wide for large images and wraps below the text.
 * @public
 */
export function getInlineImageContainerStyle (attrs: Record<string, any>): string | undefined {
  if (attrs.display !== 'inline' || attrs.width == null) return undefined
  const width = String(attrs.width).trim()
  if (!/^\d+(\.\d+)?(px|%)?$/.test(width)) return undefined
  return `width: ${/^[\d.]+$/.test(width) ? width + 'px' : width}`
}

/**
 * @public
 */
export interface ImageOptions {
  inline: boolean
  HTMLAttributes: Record<string, any>

  loadingImgSrc?: string
  getBlobRef: (fileId: Ref<Blob>, filename?: string, size?: number) => Promise<{ src: string, srcset: string }>
}

/**
 * @public
 */
export const ImageNode = Node.create<ImageOptions>({
  name: 'image',

  addSchemaAwareness () {
    return {
      label: 'Stored image',
      description:
        'Image displayed inline or on its own line. Preserve existing file references; this node does not upload or allocate image resources.',
      attributes: {
        'file-id': { access: 'readonly', description: 'Existing attachment ID. Do not invent it.' },
        src: { description: 'Source URL.' },
        alt: { description: 'Alternative text.' },
        title: { description: 'Optional title.' },
        width: { description: 'Displayed width in pixels or a CSS length.' },
        height: { description: 'Displayed height in pixels or a CSS length.' },
        align: { description: 'Horizontal image alignment.' },
        display: { description: 'Image layout mode.' },
        'data-file-type': { access: 'readonly', description: 'MIME type.' }
      }
    }
  },

  addOptions () {
    return {
      inline: true,
      HTMLAttributes: {},
      getBlobRef: async () => ({ src: '', srcset: '' })
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
      width: {
        default: null,
        validate: 'string|number|null'
      },
      height: {
        default: null,
        validate: 'string|number|null'
      },
      src: {
        default: null,
        validate: 'string|null'
      },
      alt: {
        default: null,
        validate: 'string|null'
      },
      title: {
        default: null,
        validate: 'string|null'
      },
      align: getDataAttribute('align', { validate: enumValidator(['left', 'center', 'right'], true) }),
      display: getDataAttribute('display', { validate: enumValidator(['block', 'inline'], true) }),
      'data-file-type': {
        default: null,
        validate: 'string|null'
      }
    }
  },

  parseHTML () {
    return [
      {
        tag: `img[data-type="${this.name}"]`
      },
      {
        tag: 'img[src]'
      }
    ]
  },

  renderHTML ({ node, HTMLAttributes }) {
    const inline = node.attrs.display === 'inline'
    const containerAttributes = {
      class: 'text-editor-image-container',
      'data-type': this.name,
      'data-align': node.attrs.align,
      'data-display': node.attrs.display,
      style: getInlineImageContainerStyle(node.attrs)
    }
    const imgAttributes = mergeAttributes(
      {
        'data-type': this.name
      },
      this.options.HTMLAttributes,
      HTMLAttributes
    )
    const fileId = imgAttributes['file-id']
    if (fileId != null) {
      imgAttributes.src = `platform://platform/files/workspace/?file=${fileId}`
    }

    // `div` is invalid inside a paragraph
    return [inline ? 'span' : 'div', containerAttributes, ['img', imgAttributes]]
  }
})
