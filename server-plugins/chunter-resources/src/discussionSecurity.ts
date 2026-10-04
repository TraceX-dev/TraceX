//
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

import activity from '@hcengineering/activity'
import chunter from '@hcengineering/chunter'

/**
 * Tables (domains) restricted by {@link discussionSecurityRule}.
 * @public
 */
export const DISCUSSION_SECURITY_DOMAINS: string[] = ['chunter', 'activity', 'attachment', 'reaction', 'tx']

// Workspaces that have (or had, since the process start) 'participants' discussions; maintained by
// DiscussionSecurityMiddleware. Other workspaces do not pay for the rule.
const restrictedWorkspaces = new Set<string>()

/**
 * @public
 */
export function markWorkspaceWithRestrictedDiscussions (workspaceId: string): void {
  restrictedWorkspaces.add(workspaceId)
}

/**
 * Mirrors `SecurityRuleContext` of the postgres adapter.
 * @public
 */
export interface DiscussionSecurityContext {
  table: string
  workspaceId: string
  account: string
  workspace: string
  value: (value: string) => string
}

/**
 * Postgres read restriction for 'participants' discussions: the discussion and everything inside it
 * (messages, replies, activity, mentions, attachments, reactions, transactions) are visible only to
 * the collaborators of the parent object. Admins bypass it, as they bypass space security.
 * @public
 */
export function discussionSecurityRule (ctx: DiscussionSecurityContext): string | undefined {
  const { table, workspace } = ctx
  if (!DISCUSSION_SECURITY_DOMAINS.includes(table) || !restrictedWorkspaces.has(ctx.workspaceId)) return undefined

  // Parameters are added only when the rule applies: postgres rejects unused ones.
  const account = ctx.value(ctx.account)
  const discussionClass = ctx.value(chunter.class.Discussion)
  const restricted = ctx.value('participants')
  const messageClasses = (): string =>
    `(${[
      chunter.class.ChatMessage,
      chunter.class.ThreadMessage,
      activity.class.DocUpdateMessage,
      activity.class.ActivityReference
    ]
      .map((it) => ctx.value(it))
      .join(', ')})`

  // `row` is a discussion the account cannot see.
  const isHiddenDiscussion = (row: string): string =>
    `${row}.data->>'visibility' = ${restricted} AND NOT EXISTS (SELECT 1 FROM collaborator dsec_c WHERE dsec_c."workspaceId" = ${workspace} AND dsec_c."attachedTo" = ${row}."attachedTo" AND dsec_c.collaborator = ${account})`
  const hiddenDiscussion = (ref: string): string =>
    `EXISTS (SELECT 1 FROM chunter dsec WHERE dsec."workspaceId" = ${workspace} AND dsec._id = ${ref} AND ${isHiddenDiscussion('dsec')})`
  // Transactions outlive the discussion, so the history of a removed one is hidden as well.
  const missingOrHiddenDiscussion = (ref: string): string =>
    `NOT EXISTS (SELECT 1 FROM chunter dsec WHERE dsec."workspaceId" = ${workspace} AND dsec._id = ${ref} AND NOT COALESCE(${isHiddenDiscussion('dsec')}, false))`

  // `row` is an activity message of a hidden discussion: a message or activity of the discussion,
  // a thread reply (objectId points to the discussion) or a mention from a message of it.
  const isOwnHiddenMessage = (row: string): string =>
    `(${row}.data->>'attachedToClass' = ${discussionClass} AND ${hiddenDiscussion(`${row}."attachedTo"`)})` +
    ` OR (${row}.data->>'objectClass' = ${discussionClass} AND ${hiddenDiscussion(`${row}.data->>'objectId'`)})` +
    ` OR (${row}.data->>'srcDocClass' = ${discussionClass} AND ${hiddenDiscussion(`${row}.data->>'srcDocId'`)})`
  // A mention from a thread reply points to the parent message.
  const isHiddenMessage = (row: string): string =>
    `${isOwnHiddenMessage(row)}` +
    ` OR (${row}.data->>'srcDocClass' IN ${messageClasses()} AND EXISTS (SELECT 1 FROM activity dsec_s WHERE dsec_s."workspaceId" = ${workspace} AND dsec_s._id = ${row}.data->>'srcDocId' AND COALESCE(${isOwnHiddenMessage('dsec_s')}, false)))`
  const hiddenMessage = (ref: string): string =>
    `EXISTS (SELECT 1 FROM activity dsec_m WHERE dsec_m."workspaceId" = ${workspace} AND dsec_m._id = ${ref} AND COALESCE(${isHiddenMessage('dsec_m')}, false))`

  // `row` is attached to a hidden discussion or to a message of one.
  const isAttachedToHidden = (row: string): string =>
    `(${row}.data->>'attachedToClass' = ${discussionClass} AND ${hiddenDiscussion(`${row}."attachedTo"`)})` +
    ` OR (${row}.data->>'attachedToClass' IN ${messageClasses()} AND ${hiddenMessage(`${row}."attachedTo"`)})`

  // Missing fields make comparisons NULL, which must not hide the row.
  const visible = (hidden: string): string => `NOT COALESCE((${hidden}), false)`

  switch (table) {
    case 'chunter':
      return visible(`chunter."_class" = ${discussionClass} AND ${isHiddenDiscussion('chunter')}`)
    case 'activity':
      return visible(isHiddenMessage('activity'))
    case 'attachment':
    case 'reaction':
      return visible(isAttachedToHidden(table))
    case 'tx':
      return visible(
        `(tx.data->>'objectClass' = ${discussionClass} AND ${missingOrHiddenDiscussion('tx."objectId"')})` +
          ` OR (tx.data->>'attachedToClass' = ${discussionClass} AND ${missingOrHiddenDiscussion('tx."attachedTo"')})` +
          ` OR (tx.data->>'attachedToClass' IN ${messageClasses()} AND ${hiddenMessage('tx."attachedTo"')})` +
          ` OR (tx.data->>'objectClass' IN ${messageClasses()} AND ${hiddenMessage('tx."objectId"')})`
      )
  }
  return undefined
}
