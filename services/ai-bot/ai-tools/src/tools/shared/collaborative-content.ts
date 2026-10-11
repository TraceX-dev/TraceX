//
// Copyright © 2026 TraceX.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//

import { type PlatformContext } from '@hcengineering/ai-core'
import { type Card, type MasterTag } from '@hcengineering/card'
import { makeCollabId, makeDocCollabId, type Markup, type MarkupBlobRef, type Ref } from '@hcengineering/core'
import { htmlToMarkup, isEmptyMarkup, jsonToHTML, markupToJSON } from '@hcengineering/text'

const CONTENT_ATTR = 'content'

export function htmlToCollaborativeMarkup (html: string): Markup {
  return htmlToMarkup(html)
}

export function collaborativeMarkupToHtml (markup: Markup): string {
  if (isEmptyMarkup(markup)) {
    return ''
  }

  return jsonToHTML(markupToJSON(markup))
}

export async function readCardContentHtml (toolCtx: PlatformContext, doc: Card): Promise<string> {
  if (isEmptyMarkupRef(doc.content)) {
    return ''
  }

  const markup = await toolCtx.collaborator.getMarkup(makeDocCollabId(doc, CONTENT_ATTR), doc.content)
  return collaborativeMarkupToHtml(markup)
}

export async function createCardContentRef (
  toolCtx: PlatformContext,
  masterTagId: Ref<MasterTag>,
  cardId: Ref<Card>,
  html: string | undefined
): Promise<MarkupBlobRef> {
  if (html === undefined) {
    return '' as MarkupBlobRef
  }

  const markup = htmlToCollaborativeMarkup(html)
  if (isEmptyMarkup(markup)) {
    return '' as MarkupBlobRef
  }

  return await toolCtx.collaborator.createMarkup(makeCollabId(masterTagId, cardId, CONTENT_ATTR), markup)
}

export async function updateCardContentHtml (
  toolCtx: PlatformContext,
  doc: Card,
  html: string
): Promise<MarkupBlobRef | undefined> {
  const markup = htmlToCollaborativeMarkup(html)
  const collabId = makeDocCollabId(doc, CONTENT_ATTR)

  if (isEmptyMarkupRef(doc.content)) {
    return isEmptyMarkup(markup) ? ('' as MarkupBlobRef) : await toolCtx.collaborator.createMarkup(collabId, markup)
  }

  await toolCtx.collaborator.updateMarkup(collabId, markup)
  return undefined
}

function isEmptyMarkupRef (ref: MarkupBlobRef | null | undefined): boolean {
  return ref == null || ref === ''
}
