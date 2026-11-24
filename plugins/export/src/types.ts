//
// Copyright © 2025 Hardcore Engineering Inc.
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
import type { Blob as StorageBlob, Class, Doc, Ref } from '@hcengineering/core'
import type { IntlString, Resource } from '@hcengineering/platform'

export type DocumentExportOrientation = 'portrait' | 'landscape'

/** A generated file, backed by browser data or workspace storage. */
export interface DocumentExportResult {
  file: Blob | Ref<StorageBlob>
  name: string
  contentType: string
}

export interface DocumentExporterOptions {
  format: string
  orientation?: DocumentExportOrientation
  printHeaderFooter?: boolean
}

/** Additional action parameters are forwarded unchanged to the implementation. */
export type DocumentExportFunction<P = Record<string, unknown>> = (
  doc: Doc,
  options: DocumentExporterOptions,
  params?: P
) => Promise<DocumentExportResult>
export type DocumentBulkExportFunction<P = Record<string, unknown>> = (
  docs: Doc[],
  options: DocumentExporterOptions,
  params?: P
) => Promise<void>
export type DocumentExportPreviewFunction = (result: DocumentExportResult) => Promise<void>
export type DocumentExportAvailabilityFunction = (doc: Doc) => Promise<boolean>

/** Model registration of a document format and its implementation resources. */
export interface DocumentExporter extends Doc {
  format: string
  label: IntlString
  export: Resource<DocumentExportFunction>
  supportsOrientation: boolean
  supportsHeaderFooter?: boolean
  preview?: Resource<DocumentExportPreviewFunction>
  isAvailable?: Resource<DocumentExportAvailabilityFunction>
  bulkExport?: Resource<DocumentBulkExportFunction>
  order: number
}

export interface DocumentExportSettingsValues {
  exporter: Ref<DocumentExporter>
  orientation: DocumentExportOrientation
  preview: boolean
  printHeaderFooter?: boolean
}

export type DocumentExportFormat = 'docx' | 'md'

export interface DocumentExportOptions {
  orientation?: DocumentExportOrientation
  title?: string
}

export interface DocumentContentTarget {
  _class: Ref<Class<Doc>>
  _id: Ref<Doc>
  title?: string
}

/**
 * @public
 */
export interface ExportResultDoc {
  docId: Ref<Doc>
  name: string
}

/**
 * @public
 */
export interface ExportResultRecord extends Doc {
  sourceWorkspace: string
  targetWorkspace: string
  exportedCount: number
  exportedDocumentIds: Ref<Doc>[]
  objectClass: Ref<Class<Doc>>
  title?: string
}

export enum OperationType {
  IDENTITY = 'identity',
  GROUP_BY = 'group_by'
  // JOIN = 'join',
  // EXTRACT = 'extract',
  // MAP = 'map'
}

export interface OperationConfig {
  [OperationType.IDENTITY]: undefined
  [OperationType.GROUP_BY]: {
    keyField: string
    valueField?: string
  }
}

export interface TransformOperation {
  type: OperationType
  config: OperationConfig[OperationType]
}

export interface AttributeTransform {
  operations: TransformOperation[]
}

export interface TransformConfig {
  skipAttributes?: string[]
  attributeKeyMap?: Record<string, string>
  attributeTransforms?: Record<string, AttributeTransform>
}

export interface RelationDefinition {
  /** When set, this relation applies only to documents of this class (or its subclasses). */
  sourceClass?: Ref<Class<Doc>>
  field: string
  class: Ref<Class<Doc>>
  direction?: 'forward' | 'inverse'
}
