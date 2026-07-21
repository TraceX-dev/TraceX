//
// Copyright © 2026 Hardcore Engineering Inc.
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

import { type Class, type Data, generateId, makeCollabId, type Markup, type MarkupBlobRef, type Ref, SortingOrder } from '@hcengineering/core'
import document, { type Document, type Teamspace } from '@hcengineering/document'
import type {
  CanCreateIntegrationTarget,
  CreateIntegrationTarget,
  GetIntegrationTargetAllowedSpaceClasses,
  UpdateIntegrationTarget
} from '@hcengineering/integration'
import { createMarkup } from '@hcengineering/presentation'
import { makeRank } from '@hcengineering/rank'
import { isEmptyMarkup } from '@hcengineering/text'

function toDocumentData (values: Record<string, unknown>): Partial<Data<Document>> {
  return values as Partial<Data<Document>>
}

async function createContent (
  targetClass: Ref<Class<Document>>,
  documentId: Ref<Document>,
  content: unknown
): Promise<MarkupBlobRef | null> {
  if (typeof content !== 'string' || isEmptyMarkup(content as Markup)) {
    return null
  }

  return await createMarkup(makeCollabId(targetClass, documentId, 'content'), content as Markup)
}

export const canCreateIntegrationTarget: CanCreateIntegrationTarget = async (ctx, target) => {
  if (target.space === undefined) return false

  const space = await ctx.client.findOne(document.class.Teamspace, { _id: target.space as Ref<Teamspace> })
  return (
    space !== undefined &&
    ctx.client.getHierarchy().isDerived(space._class, document.class.Teamspace) &&
    ctx.client.getHierarchy().isDerived(target.targetClass, document.class.Document)
  )
}

export const getAllowedSpaceClasses: GetIntegrationTargetAllowedSpaceClasses = async (client, targetClass) => {
  if (!client.getHierarchy().isDerived(targetClass, document.class.Document)) {
    return []
  }

  return [document.class.Teamspace]
}

export const createIntegrationTarget: CreateIntegrationTarget = async (ctx, target, values) => {
  if (target.space === undefined) {
    throw new Error('Cannot create document integration target without target teamspace')
  }

  const targetClass = target.targetClass as Ref<Class<Document>>
  const id = generateId<Document>()
  const incomingData = toDocumentData(values)
  const lastDocument = await ctx.client.findAll<Document>(
    document.class.Document,
    {
      space: target.space as Ref<Teamspace>,
      parent: document.ids.NoParent
    },
    {
      sort: { rank: SortingOrder.Descending },
      limit: 1
    }
  )
  const lastRank = lastDocument[0]?.rank
  const rank = makeRank(lastRank, undefined)
  const content = await createContent(targetClass, id, incomingData.content)

  await ctx.client.createDoc(
    targetClass,
    target.space,
    {
      title: incomingData.title ?? 'Integration document',
      content,
      parent: incomingData.parent ?? document.ids.NoParent,
      attachments: incomingData.attachments ?? 0,
      embeddings: incomingData.embeddings ?? 0,
      labels: incomingData.labels ?? 0,
      comments: incomingData.comments ?? 0,
      references: incomingData.references ?? 0,
      rank,
      icon: incomingData.icon,
      color: incomingData.color
    } as Data<Document>,
    id
  )

  const doc = await ctx.client.findOne<Document>(targetClass, { _id: id })
  if (doc === undefined) {
    throw new Error(`Created document integration target was not found: ${id}`)
  }

  return doc
}

export const updateIntegrationTarget: UpdateIntegrationTarget = async (ctx, doc, values) => {
  if (!ctx.client.getHierarchy().isDerived(doc._class, document.class.Document)) {
    throw new Error(`Cannot update non-document integration target ${doc._class}`)
  }

  const existing = doc as Document
  const update = toDocumentData(values)
  if (update.content !== undefined) {
    update.content = await createContent(existing._class as Ref<Class<Document>>, existing._id, update.content)
  }

  await ctx.client.update(existing, update)
}
