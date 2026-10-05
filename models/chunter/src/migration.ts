//
// Copyright © 2022 Hardcore Engineering Inc.
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

import { chunterId, type Discussion, type ThreadMessage } from '@hcengineering/chunter'
import core, {
  TxOperations,
  type Class,
  type Doc,
  type Domain,
  type Ref,
  type Space,
  DOMAIN_TX,
  notEmpty
} from '@hcengineering/core'
import {
  tryMigrate,
  tryUpgrade,
  type MigrateOperation,
  type MigrationClient,
  type MigrationDocumentQuery,
  type MigrationUpgradeClient
} from '@hcengineering/model'
import activity, {
  migrateMessagesSpace,
  DOMAIN_ACTIVITY,
  DOMAIN_REACTION,
  DOMAIN_USER_MENTION
} from '@hcengineering/model-activity'
import { DOMAIN_ATTACHMENT } from '@hcengineering/model-attachment'
import notification from '@hcengineering/notification'
import contact, { getAllAccounts } from '@hcengineering/contact'
import { DOMAIN_DOC_NOTIFY, DOMAIN_NOTIFICATION } from '@hcengineering/model-notification'
import { type DocUpdateMessage } from '@hcengineering/activity'

import { DOMAIN_CHUNTER } from './index'
import chunter from './plugin'

export const DOMAIN_COMMENT = 'comment' as Domain

/**
 * Object access: every discussion is a security root from its creation (see
 * foundations/server/docs/object-access-control.md). Existing discussions become public roots and their
 * content is marked, so their level can be changed later. Discussions are processed in batches with one
 * query per domain and reference field; a discussion is marked last, so an interrupted run repeats it.
 */
async function markDiscussionsAsRoots (client: MigrationClient): Promise<void> {
  const discussions = await client.find<Discussion>(
    DOMAIN_CHUNTER,
    { _class: chunter.class.Discussion, accessRoot: { $exists: false } },
    { projection: { _id: 1 } }
  )
  for (const batch of chunks(discussions.map((it) => it._id))) {
    // Document id -> its discussion, per domain.
    const roots = new Map<Domain, Map<Ref<Doc>, Ref<Doc>>>()
    const add = (domain: Domain, _id: Ref<Doc>, root: Ref<Doc>): void => {
      let domainRoots = roots.get(domain)
      if (domainRoots === undefined) {
        domainRoots = new Map()
        roots.set(domain, domainRoots)
      }
      domainRoots.set(_id, root)
    }
    const known = (domain: Domain): Map<Ref<Doc>, Ref<Doc>> => roots.get(domain) ?? new Map()
    // Collects documents whose `field` points to a known document of `parentDomain`.
    const follow = async (
      domain: Domain,
      field: string,
      parents: Map<Ref<Doc>, Ref<Doc>>,
      query: MigrationDocumentQuery<Doc> = {}
    ): Promise<void> => {
      for (const chunk of chunks(Array.from(parents.keys()))) {
        const found = await client.find<Doc>(
          domain,
          { ...query, [field]: { $in: chunk } },
          { projection: { _id: 1, [field]: 1 } }
        )
        for (const doc of found) {
          const root = parents.get((doc as unknown as Record<string, Ref<Doc>>)[field])
          if (root !== undefined) add(domain, doc._id, root)
        }
      }
    }
    const discussionRoots = new Map(batch.map((it) => [it, it]))
    // Messages and activity of the discussions (mentions of them from elsewhere stay), replies and activity
    // about them, mentions from them.
    await follow(DOMAIN_ACTIVITY, 'attachedTo', discussionRoots, { _class: { $ne: activity.class.ActivityReference } })
    await follow(DOMAIN_ACTIVITY, 'objectId', discussionRoots)
    await follow(DOMAIN_ACTIVITY, 'srcDocId', discussionRoots)
    const messages = new Map(known(DOMAIN_ACTIVITY))
    // Mentions from replies, reactions, mention texts and files of the messages, drawings of the files.
    await follow(DOMAIN_ACTIVITY, 'srcDocId', messages, { _class: activity.class.ActivityReference })
    await follow(DOMAIN_REACTION, 'attachedTo', messages)
    await follow(DOMAIN_USER_MENTION, 'attachedTo', messages)
    await follow(DOMAIN_ATTACHMENT, 'attachedTo', messages)
    await follow(DOMAIN_ATTACHMENT, 'parent', new Map(known(DOMAIN_ATTACHMENT)))
    const all = new Map<Ref<Doc>, Ref<Doc>>(discussionRoots)
    for (const domainRoots of roots.values()) {
      for (const [_id, root] of domainRoots) all.set(_id, root)
    }
    // Notifications about them and the stored transactions.
    await follow(DOMAIN_NOTIFICATION, 'objectId', discussionRoots)
    await follow(DOMAIN_NOTIFICATION, 'attachedTo', all)
    await follow(DOMAIN_DOC_NOTIFY, 'objectId', all)
    await follow(DOMAIN_TX, 'objectId', all)

    for (const [domain, domainRoots] of roots) {
      const byRoot = new Map<Ref<Doc>, Ref<Doc>[]>()
      for (const [_id, root] of domainRoots) {
        const ids = byRoot.get(root)
        if (ids !== undefined) ids.push(_id)
        else byRoot.set(root, [_id])
      }
      for (const [root, ids] of byRoot) {
        for (const chunk of chunks(ids)) {
          await client.update(domain, { _id: { $in: chunk } }, { accessRoot: root })
        }
      }
    }
    // Owners are unknown for old discussions: maintainers and workspace owners manage them.
    for (const _id of batch) {
      await client.update(
        DOMAIN_CHUNTER,
        { _id },
        { accessRoot: _id, [core.mixin.AccessControlled]: { read: { kind: 'space' }, owners: [] } }
      )
    }
  }
}

function chunks<T> (items: T[], size: number = 500): T[][] {
  const result: T[][] = []
  for (let i = 0; i < items.length; i += size) result.push(items.slice(i, i + size))
  return result
}

export async function createDocNotifyContexts (
  client: MigrationUpgradeClient,
  tx: TxOperations,
  objectId: Ref<Doc>,
  objectClass: Ref<Class<Doc>>,
  objectSpace: Ref<Space>
): Promise<void> {
  const employees = await client.findAll(contact.mixin.Employee, { active: true })
  const accounts = employees.map((it) => it.personUuid).filter(notEmpty)

  const docNotifyContexts = await client.findAll(notification.class.DocNotifyContext, {
    user: { $in: accounts },
    objectId
  })
  const existingDNCUsers = new Set(docNotifyContexts.map((it) => it.user))

  for (const account of accounts.filter((it) => !existingDNCUsers.has(it))) {
    await tx.createDoc(notification.class.DocNotifyContext, core.space.Space, {
      user: account,
      objectId,
      objectClass,
      objectSpace,
      hidden: false,
      isPinned: false
    })
  }
}

export async function createGeneral (client: MigrationUpgradeClient, tx: TxOperations): Promise<void> {
  const current = await tx.findOne(chunter.class.Channel, { _id: chunter.space.General })
  if (current !== undefined) {
    if (current.autoJoin === undefined) {
      await tx.update(current, {
        autoJoin: true
      })
      await joinEmployees(current, tx)
    }
  } else {
    const createTx = await tx.findOne(core.class.TxCreateDoc, {
      objectId: chunter.space.General
    })

    if (createTx === undefined) {
      await tx.createDoc(
        chunter.class.Channel,
        core.space.Space,
        {
          name: 'general',
          description: 'General Channel',
          topic: 'General Channel',
          private: false,
          archived: false,
          members: await getAllAccounts(tx),
          autoJoin: true
        },
        chunter.space.General
      )
    }
  }

  await createDocNotifyContexts(client, tx, chunter.space.General, chunter.class.Channel, core.space.Space)
}

async function joinEmployees (current: Space, tx: TxOperations): Promise<void> {
  const allAccounts = await getAllAccounts(tx)
  const newMembers = [...current.members]

  for (const account of allAccounts) {
    if (!newMembers.includes(account)) {
      newMembers.push(account)
    }
  }

  await tx.update(current, {
    members: newMembers
  })
}

export async function createRandom (client: MigrationUpgradeClient, tx: TxOperations): Promise<void> {
  const current = await tx.findOne(chunter.class.Channel, { _id: chunter.space.Random })
  if (current !== undefined) {
    if (current.autoJoin === undefined) {
      await tx.update(current, {
        autoJoin: true
      })
      await joinEmployees(current, tx)
    }
  } else {
    const createTx = await tx.findOne(core.class.TxCreateDoc, {
      objectId: chunter.space.Random
    })

    if (createTx === undefined) {
      await tx.createDoc(
        chunter.class.Channel,
        core.space.Space,
        {
          name: 'random',
          description: 'Random Talks',
          topic: 'Random Talks',
          private: false,
          archived: false,
          members: await getAllAccounts(tx),
          autoJoin: true
        },
        chunter.space.Random
      )
    }
  }

  await createDocNotifyContexts(client, tx, chunter.space.Random, chunter.class.Channel, core.space.Space)
}

async function convertCommentsToChatMessages (client: MigrationClient): Promise<void> {
  await client.update(
    DOMAIN_COMMENT,
    { _class: 'chunter:class:Comment' as Ref<Class<Doc>> },
    { _class: chunter.class.ChatMessage }
  )
  await client.move(DOMAIN_COMMENT, { _class: chunter.class.ChatMessage }, DOMAIN_ACTIVITY)
}

async function removeBacklinks (client: MigrationClient): Promise<void> {
  await client.deleteMany(DOMAIN_COMMENT, { _class: 'chunter:class:Backlink' as Ref<Class<Doc>> })
  await client.deleteMany(DOMAIN_ACTIVITY, {
    _class: activity.class.DocUpdateMessage,
    objectClass: 'chunter:class:Backlink'
  })
}

async function removeOldClasses (client: MigrationClient): Promise<void> {
  const classes = [
    'chunter:class:ChunterMessage',
    'chunter:class:Message',
    'chunter:class:Comment',
    'chunter:class:Backlink'
  ] as Ref<Class<Doc>>[]

  for (const _class of classes) {
    await client.deleteMany(DOMAIN_CHUNTER, { _class })
    await client.deleteMany(DOMAIN_ACTIVITY, { attachedToClass: _class })
    await client.deleteMany(DOMAIN_ACTIVITY, { objectClass: _class })
    await client.deleteMany(DOMAIN_NOTIFICATION, { attachedToClass: _class })
    await client.deleteMany(DOMAIN_TX, { objectClass: _class })
    await client.deleteMany(DOMAIN_TX, { 'tx.objectClass': _class })
  }
}

async function removeWrongActivity (client: MigrationClient): Promise<void> {
  await client.deleteMany<DocUpdateMessage>(DOMAIN_ACTIVITY, {
    _class: activity.class.DocUpdateMessage,
    attachedToClass: chunter.class.Channel,
    action: 'update',
    'attributeUpdates.attrKey': { $ne: 'members' }
  })

  await client.deleteMany<DocUpdateMessage>(DOMAIN_ACTIVITY, {
    _class: activity.class.DocUpdateMessage,
    attachedToClass: chunter.class.Channel,
    action: 'create',
    objectClass: { $ne: chunter.class.Channel }
  })

  await client.deleteMany<DocUpdateMessage>(DOMAIN_ACTIVITY, {
    _class: activity.class.DocUpdateMessage,
    attachedToClass: chunter.class.Channel,
    action: 'remove'
  })

  await client.deleteMany<DocUpdateMessage>(DOMAIN_ACTIVITY, {
    _class: activity.class.DocUpdateMessage,
    attachedToClass: chunter.class.DirectMessage,
    action: 'update',
    'attributeUpdates.attrKey': { $ne: 'members' }
  })

  await client.deleteMany<DocUpdateMessage>(DOMAIN_ACTIVITY, {
    _class: activity.class.DocUpdateMessage,
    attachedToClass: chunter.class.DirectMessage,
    action: 'create'
  })

  await client.deleteMany<DocUpdateMessage>(DOMAIN_ACTIVITY, {
    _class: activity.class.DocUpdateMessage,
    attachedToClass: chunter.class.DirectMessage,
    action: 'remove'
  })
}

export const chunterOperation: MigrateOperation = {
  async migrate (client: MigrationClient, mode): Promise<void> {
    await tryMigrate(mode, client, chunterId, [
      {
        state: 'create-chat-messages',
        mode: 'upgrade',
        func: convertCommentsToChatMessages
      },
      {
        state: 'remove-backlinks',
        mode: 'upgrade',
        func: removeBacklinks
      },
      {
        state: 'migrate-chat-messages-space',
        mode: 'upgrade',
        func: async (client) => {
          await migrateMessagesSpace(
            client,
            chunter.class.ChatMessage,
            ({ attachedTo }) => attachedTo,
            ({ attachedToClass }) => attachedToClass
          )
        }
      },
      {
        state: 'migrate-thread-messages-space',
        mode: 'upgrade',
        func: async (client) => {
          await migrateMessagesSpace(
            client,
            chunter.class.ThreadMessage,
            (msg) => (msg as ThreadMessage).objectId,
            (msg) => (msg as ThreadMessage).objectClass
          )
        }
      },
      {
        state: 'remove-old-classes-v1',
        mode: 'upgrade',
        func: async (client) => {
          await removeOldClasses(client)
        }
      },
      {
        state: 'remove-wrong-activity-v1',
        mode: 'upgrade',
        func: async (client) => {
          await removeWrongActivity(client)
        }
      },
      {
        state: 'remove-chat-info-v1',
        mode: 'upgrade',
        func: async (client) => {
          await client.deleteMany(DOMAIN_CHUNTER, { _class: 'chunter:class:ChatInfo' as Ref<Class<Doc>> })
          await client.deleteMany(DOMAIN_TX, { objectClass: 'chunter:class:ChatInfo' })
          await client.update(
            DOMAIN_DOC_NOTIFY,
            { 'chunter:mixin:ChannelInfo': { $exists: true } },
            { $unset: { 'chunter:mixin:ChannelInfo': true } }
          )
          await client.deleteMany(DOMAIN_TX, { mixin: 'chunter:mixin:ChannelInfo' })
        }
      },
      {
        state: 'remove-direct-doc-update-messages',
        mode: 'upgrade',
        func: async (client) => {
          await client.deleteMany<DocUpdateMessage>(DOMAIN_ACTIVITY, {
            _class: activity.class.DocUpdateMessage,
            attachedToClass: chunter.class.DirectMessage
          })
        }
      },
      {
        state: 'discussions-object-access-v1',
        mode: 'upgrade',
        func: markDiscussionsAsRoots
      }
    ])
  },
  async upgrade (state: Map<string, Set<string>>, client: () => Promise<MigrationUpgradeClient>, mode): Promise<void> {
    await tryUpgrade(mode, state, client, chunterId, [
      {
        state: 'create-defaults-v2',
        func: async (client) => {
          const tx = new TxOperations(client, core.account.System)
          await createGeneral(client, tx)
          await createRandom(client, tx)
        }
      }
    ])
  }
}
