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
 * The name, or undefined for an untitled discussion.
 * @public
 */
export function getDiscussionTitle (discussion: Pick<Discussion, 'name'>): string | undefined {
  const name = discussion.name?.trim() ?? ''
  return name !== '' ? name : undefined
}
