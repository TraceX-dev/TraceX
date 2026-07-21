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

import card, { type Card } from '@hcengineering/card'
import core, {
  type Class,
  type Data,
  fillDefaults,
  generateId,
  makeCollabId,
  type Markup,
  type MarkupBlobRef,
  type Ref
} from '@hcengineering/core'
import type {
  CanCreateIntegrationTarget,
  CreateIntegrationTarget,
  GetIntegrationTargetAllowedSpaceClasses,
  GetIntegrationTargetCommentBackend,
  UpdateIntegrationTarget
} from '@hcengineering/integration'
import { createMarkup } from '@hcengineering/presentation'
import { isEmptyMarkup } from '@hcengineering/text'

function toCardData (values: Record<string, unknown>): Partial<Data<Card>> {
  return values as Partial<Data<Card>>
}

async function createContent (targetClass: Ref<Class<Card>>, cardId: Ref<Card>, content: unknown): Promise<MarkupBlobRef> {
  if (typeof content !== 'string' || isEmptyMarkup(content as Markup)) {
    return '' as MarkupBlobRef
  }

  return await createMarkup(makeCollabId(targetClass, cardId, 'content'), content as Markup)
}

export const canCreateIntegrationTarget: CanCreateIntegrationTarget = async (ctx, target) => {
  if (target.space === undefined) return false

  const space = await ctx.client.findOne(core.class.Space, { _id: target.space })
  return (
    space !== undefined &&
    ctx.client.getHierarchy().isDerived(space._class, card.class.CardSpace) &&
    ctx.client.getHierarchy().isDerived(target.targetClass, card.class.Card)
  )
}

export const getAllowedSpaceClasses: GetIntegrationTargetAllowedSpaceClasses = async (client, targetClass) => {
  if (!client.getHierarchy().isDerived(targetClass, card.class.Card)) {
    return []
  }

  return [card.class.CardSpace]
}

export const getCommentBackend: GetIntegrationTargetCommentBackend = async () => {
  return 'communication'
}

export const createIntegrationTarget: CreateIntegrationTarget = async (ctx, target, values) => {
  if (target.space === undefined) {
    throw new Error('Cannot create card integration target without target space')
  }

  const targetClass = target.targetClass as Ref<Class<Card>>
  const id = generateId<Card>()
  const incomingData = toCardData(values)
  const content = await createContent(targetClass, id, incomingData.content)
  const data: Data<Card> = {
    ...incomingData,
    title: incomingData.title ?? 'Integration card',
    content,
    blobs: incomingData.blobs ?? {},
    parentInfo: incomingData.parentInfo ?? [],
    rank: incomingData.rank ?? ''
  }

  const filledData = fillDefaults(ctx.client.getHierarchy(), data, targetClass)
  await ctx.client.createDoc<Card>(targetClass, target.space, filledData, id)
  const doc = await ctx.client.findOne<Card>(targetClass, { _id: id })

  if (doc === undefined) {
    throw new Error(`Created card integration target was not found: ${id}`)
  }

  return doc
}

export const updateIntegrationTarget: UpdateIntegrationTarget = async (ctx, doc, values) => {
  if (!ctx.client.getHierarchy().isDerived(doc._class, card.class.Card)) {
    throw new Error(`Cannot update non-card integration target ${doc._class}`)
  }

  const cardDoc = doc as Card
  const update = toCardData(values)

  if (update.content !== undefined) {
    update.content = await createContent(cardDoc._class as Ref<Class<Card>>, cardDoc._id, update.content)
  }

  await ctx.client.update(cardDoc, update)
}
