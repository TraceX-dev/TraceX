import { deepEqual } from 'fast-equals'
import core, { type AccountUuid, type Ref, TxOperations } from '@hcengineering/core'

import chunter, { type Discussion, DirectMessage } from '.'

/**
 * @public
 */
export async function getDirectChannel (
  client: TxOperations,
  me: AccountUuid,
  employeeAccount: AccountUuid
): Promise<Ref<DirectMessage>> {
  const accIds = [me, employeeAccount].sort()
  const existingDms = await client.findAll(chunter.class.DirectMessage, {})
  for (const dm of existingDms) {
    if (deepEqual(dm.members, accIds)) {
      return dm._id
    }
  }

  return await client.createDoc(chunter.class.DirectMessage, core.space.Space, {
    name: '',
    description: '',
    private: true,
    archived: false,
    members: accIds
  })
}

/**
 * @public
 */
export const DISCUSSION_EXCERPT_LENGTH = 140

/**
 * @public
 */
export function makeDiscussionExcerpt (text: string): string {
  const line = text.replace(/\s+/g, ' ').trim()
  if (line.length <= DISCUSSION_EXCERPT_LENGTH) return line
  return `${line.slice(0, DISCUSSION_EXCERPT_LENGTH - 1).trimEnd()}…`
}

/**
 * Name, otherwise excerpt; undefined when there is neither.
 * @public
 */
export function getDiscussionTitle (discussion: Pick<Discussion, 'name' | 'excerpt'>): string | undefined {
  const name = discussion.name?.trim() ?? ''
  if (name !== '') return name
  const excerpt = discussion.excerpt?.trim() ?? ''
  return excerpt !== '' ? excerpt : undefined
}
