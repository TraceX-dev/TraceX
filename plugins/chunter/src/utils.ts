import { deepEqual } from 'fast-equals'
import core, {
  type AccountUuid,
  type AttachedData,
  type Doc,
  type ObjectVisibility,
  type Ref,
  TxOperations,
  visibilityToAudience
} from '@hcengineering/core'

import chunter, { type DefaultDiscussion, type Discussion, DirectMessage } from '.'

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

/**
 * Adds the access policy for a non-public discussion. The policy goes with the create tx,
 * so the discussion is never visible to the whole space.
 * @public
 */
export function withDiscussionVisibility (
  data: AttachedData<Discussion>,
  visibility: ObjectVisibility
): AttachedData<Discussion> {
  if (visibility === 'public') return data
  // The computed mixin key is not checked as an excess property, so no assertion is needed.
  const attributes: AttachedData<Discussion> = {
    ...data,
    [core.mixin.AccessControlled]: { read: visibilityToAudience(visibility) }
  }
  return attributes
}

/**
 * Visibility levels allowed for default discussions: a private one would be visible to its creator only,
 * so other participants of the object could never open it.
 * @public
 */
export const defaultDiscussionVisibilityLevels: ObjectVisibility[] = ['public', 'participants']

/**
 * The visibility a default discussion is created with. Private is not allowed for default discussions.
 * @public
 */
export function getDefaultDiscussionVisibility (config: Pick<DefaultDiscussion, 'visibility'>): ObjectVisibility {
  return defaultDiscussionVisibilityLevels.includes(config.visibility) ? config.visibility : 'participants'
}

/**
 * @public
 */
export async function ensureObjectCollaborator (
  client: TxOperations,
  object: Pick<Doc, '_id' | '_class' | 'space'>,
  account: AccountUuid
): Promise<void> {
  const current = await client.findOne(core.class.Collaborator, { attachedTo: object._id, collaborator: account })
  if (current !== undefined) return
  await client.addCollection(core.class.Collaborator, object.space, object._id, object._class, 'collaborators', {
    collaborator: account
  })
}

/**
 * Returns the default discussion of the object, creating it on first access.
 * The notMatch check is done by the server without object access filtering, so a discussion
 * hidden from the user is never duplicated. Returns undefined when it exists but stays hidden.
 * @public
 */
export async function getOrCreateDefaultDiscussion (
  client: TxOperations,
  object: Doc,
  config: DefaultDiscussion,
  account: AccountUuid
): Promise<Ref<Discussion> | undefined> {
  const query = { attachedTo: object._id, defaultDiscussion: config._id }
  const existing = await client.findOne(chunter.class.Discussion, query)
  if (existing !== undefined) return existing._id

  const visibility = getDefaultDiscussionVisibility(config)
  const operations = client.apply(`chunter.createDefaultDiscussion.${object._id}`, 'chunter.createDefaultDiscussion')
  operations.notMatch(chunter.class.Discussion, query)
  // The creator must be a collaborator of the object to keep access.
  if (visibility === 'participants') {
    await ensureObjectCollaborator(operations, object, account)
  }
  const data: AttachedData<Discussion> = {
    name: config.name,
    resolved: false,
    // Members exist only for a private discussion.
    members: [],
    defaultDiscussion: config._id
  }
  const discussionId = await operations.addCollection(
    chunter.class.Discussion,
    object.space,
    object._id,
    object._class,
    'discussions',
    withDiscussionVisibility(data, visibility)
  )
  const { result } = await operations.commit()
  if (result) return discussionId

  // It already exists but may be hidden: participants of the object get access by becoming collaborators.
  const current = await client.findOne(chunter.class.Discussion, query)
  if (current !== undefined) return current._id
  await ensureObjectCollaborator(client, object, account)
  return (await client.findOne(chunter.class.Discussion, query))?._id
}
