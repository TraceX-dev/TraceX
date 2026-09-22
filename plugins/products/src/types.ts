//
// Copyright © 2024 Hardcore Engineering Inc.
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

import { type Document, type DocumentCategory, ExternalSpace, Project } from '@hcengineering/controlled-documents'
import { Attachment } from '@hcengineering/attachment'
import { type Association, type CollectionSize, type Configuration, type Ref, Markup } from '@hcengineering/core'
import { IconProps } from '@hcengineering/view'

/** @public */
export enum ProductVersionState {
  Active,
  Released
}

/** @public */
export const productVersionStates = [ProductVersionState.Active, ProductVersionState.Released]

/** @public */
export enum ChangeControlMode {
  ControlledDocument = 'controlledDocument',
  Cards = 'cards'
}

/**
 * @public
 *
 * Category of controlled documents used as change control when no category is configured.
 */
export const DEFAULT_CHANGE_CONTROL_CATEGORY = 'documents:category:DOC - CC' as Ref<DocumentCategory>

/**
 * @public
 *
 * Workspace level products settings. Used as defaults for all products.
 */
export interface ProductsSettings extends Configuration {
  // Default change control mode for products, ControlledDocument when not set
  changeControlMode?: ChangeControlMode
  // Category of controlled documents that can be used as change control
  changeControlCategory?: Ref<DocumentCategory>
  // Relations (ProductVersion <-> Card) allowed to be used as change control
  changeControlRelations?: Array<Ref<Association>>
  // Relation used by products that inherit the workspace settings in Cards mode
  defaultChangeControlRelation?: Ref<Association>
}

/** @public */
export interface Product extends ExternalSpace, IconProps {
  fullDescription?: Markup
  attachments?: CollectionSize<Attachment>
  // Product override of the workspace change control mode, undefined means inherit
  changeControlMode?: ChangeControlMode
  // Used when changeControlMode is Cards, must be one of the workspace allowed relations
  changeControlRelation?: Ref<Association>
}

/** @public */
export interface ProductVersion extends Project<Product> {
  major: number
  minor: number
  patch: number
  codename?: string
  description: Markup
  state: ProductVersionState
  parent: Ref<ProductVersion>
  changeControl?: Ref<Document>
}
