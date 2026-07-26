//
// Copyright © 2026 TraceX.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//

import { type PlatformContext } from '@hcengineering/ai-core'
import { type MasterTag, type Tag } from '@hcengineering/card'
import core, { type AnyAttribute, type Ref } from '@hcengineering/core'

const systemFields = new Set([
  '_id',
  '_class',
  'id',
  'space',
  'modifiedOn',
  'modifiedBy',
  'createdOn',
  'createdBy',
  'rank',
  'title',
  'content',
  'version',
  'icon',
  'color',
  'todos',
  'comments',
  'parentInfo',
  'blobs',
  'children',
  'attachments',
  'peerId',
  'readonlySections',
  'readonlyFields',
  '%hash%'
])

export function isSystemAttribute (attr: AnyAttribute): boolean {
  return systemFields.has(attr.name)
}

export function isCollaborativeAttribute (attr: AnyAttribute): boolean {
  return attr.type._class === core.class.TypeCollaborativeDoc
}

export function isReadonlyAttribute (attr: AnyAttribute): boolean {
  return attr.readonly === true || attr.type._class === core.class.TypeIdentifier
}

export function attributesForOwner (
  toolCtx: PlatformContext,
  ownerId: Ref<MasterTag | Tag>,
  includeHidden: boolean,
  includeReadonly: boolean
): AnyAttribute[] {
  const { hierarchy } = toolCtx

  const attrs = hierarchy.isMixin(ownerId)
    ? hierarchy.getOwnAttributes(ownerId)
    : hierarchy.getAllAttributes(ownerId, core.class.Doc)

  const result: AnyAttribute[] = []

  for (const [, attr] of attrs) {
    const hidden = attr.hidden === true
    const readonly = isReadonlyAttribute(attr)

    if (!includeHidden && hidden) continue
    if (!includeReadonly && readonly) continue
    if (isSystemAttribute(attr)) continue
    if (isCollaborativeAttribute(attr)) continue

    result.push(attr)
  }

  return result
}
