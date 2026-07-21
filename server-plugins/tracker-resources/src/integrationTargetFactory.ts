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

import core, {
  fillDefaults,
  generateId,
  type AttachedData,
  type Class,
  type Doc,
  type MarkupBlobRef,
  type Ref
} from '@hcengineering/core'
import type {
  CanCreateIntegrationTarget,
  CreateIntegrationTarget,
  GetIntegrationTargetAllowedSpaceClasses,
  IntegrationTargetContext,
  UpdateIntegrationTarget
} from '@hcengineering/integration'
import tags, { type ExpertKnowledge, type InitialKnowledge, type MeaningfullKnowledge } from '@hcengineering/tags'
import task from '@hcengineering/task'
import { isEmptyMarkup } from '@hcengineering/text'
import tracker, { IssuePriority, type Issue, type IssueStatus, type Project } from '@hcengineering/tracker'

interface MarkupUploader {
  uploadMarkup: (
    objectClass: Ref<Class<Doc>>,
    objectId: Ref<Doc>,
    objectAttr: string,
    markup: string,
    format: 'markup'
  ) => Promise<MarkupBlobRef>
  updateMarkup?: (
    objectClass: Ref<Class<Doc>>,
    objectId: Ref<Doc>,
    objectAttr: string,
    markup: string,
    format: 'markup'
  ) => Promise<void>
}

function getMarkupUploader (ctx: IntegrationTargetContext): MarkupUploader {
  const markup = (ctx as IntegrationTargetContext & { markup?: MarkupUploader }).markup
  if (markup === undefined) {
    throw new Error('Server integration target context requires markup operations')
  }
  return markup
}

async function uploadMarkup<T extends Doc> (
  ctx: IntegrationTargetContext,
  targetClass: Ref<Class<T>>,
  objectId: Ref<T>,
  attr: string,
  value: unknown
): Promise<MarkupBlobRef | null> {
  if (typeof value !== 'string' || isEmptyMarkup(value)) {
    return null
  }

  return await getMarkupUploader(ctx).uploadMarkup(
    targetClass as unknown as Ref<Class<Doc>>,
    objectId as Ref<Doc>,
    attr,
    value,
    'markup'
  )
}

async function updateMarkup<T extends Doc> (
  ctx: IntegrationTargetContext,
  targetClass: Ref<Class<T>>,
  objectId: Ref<T>,
  attr: string,
  value: unknown,
  current: MarkupBlobRef | null | undefined
): Promise<MarkupBlobRef | null | undefined> {
  if (typeof value !== 'string' || isEmptyMarkup(value)) {
    return null
  }

  const uploader = getMarkupUploader(ctx)
  if (current !== undefined && current !== null && current !== '' && uploader.updateMarkup !== undefined) {
    await uploader.updateMarkup(targetClass as unknown as Ref<Class<Doc>>, objectId as Ref<Doc>, attr, value, 'markup')
    return undefined
  }

  return await uploadMarkup(ctx, targetClass, objectId, attr, value)
}

function toIssueData (values: Record<string, unknown>): Partial<AttachedData<Issue>> {
  return values as Partial<AttachedData<Issue>>
}

function getLabelTitles (value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim() !== '')
    : []
}

async function syncIssueLabels (
  ctx: IntegrationTargetContext,
  issueId: Ref<Issue>,
  issueClass: Ref<Class<Issue>>,
  labels: string[]
): Promise<void> {
  const existing = await ctx.client.findAll(tags.class.TagReference, {
    attachedTo: issueId,
    attachedToClass: issueClass,
    collection: 'labels'
  })
  const existingByTitle = new Map(existing.map((tag) => [tag.title, tag]))
  const seen = new Set<string>()
  let weight = 0

  for (const title of labels) {
    if (seen.has(title)) continue
    seen.add(title)

    let tagElement = await ctx.client.findOne(tags.class.TagElement, {
      title,
      targetClass: issueClass
    })
    if (tagElement === undefined) {
      const id = await ctx.client.createDoc(tags.class.TagElement, core.space.Workspace, {
        title,
        targetClass: issueClass,
        description: '',
        color: 1,
        category: tags.category.NoCategory
      })
      tagElement = await ctx.client.findOne(tags.class.TagElement, { _id: id })
    }
    if (tagElement === undefined) {
      continue
    }

    const tagWeight = Math.min(weight, 8) as InitialKnowledge | MeaningfullKnowledge | ExpertKnowledge
    const existingRef = existingByTitle.get(title)
    if (existingRef !== undefined) {
      await ctx.client.update(existingRef, {
        tag: tagElement._id,
        color: tagElement.color,
        weight: tagWeight
      })
      existingByTitle.delete(title)
    } else {
      await ctx.client.addCollection(tags.class.TagReference, core.space.Workspace, issueId, issueClass, 'labels', {
        tag: tagElement._id,
        title,
        color: tagElement.color,
        weight: tagWeight
      })
    }
    weight++
  }

  for (const ref of existingByTitle.values()) {
    await ctx.client.removeCollection(
      ref._class,
      ref.space,
      ref._id,
      ref.attachedTo,
      ref.attachedToClass,
      ref.collection
    )
  }
}

async function getDefaultIssueStatus (ctx: IntegrationTargetContext, project: Project): Promise<Ref<IssueStatus>> {
  if (project.defaultIssueStatus !== undefined) {
    return project.defaultIssueStatus
  }

  const taskType = await ctx.client.findOne(task.class.TaskType, { _id: tracker.taskTypes.Issue })
  const status = taskType?.statuses[0] as Ref<IssueStatus> | undefined
  if (status === undefined) {
    throw new Error(`Cannot create tracker issue without default status in project ${project._id}`)
  }

  return status
}

export const canCreateIntegrationTarget: CanCreateIntegrationTarget = async (ctx, target) => {
  if (target.space === undefined) return false

  const project = await ctx.client.findOne(tracker.class.Project, { _id: target.space as Ref<Project> })
  return (
    project !== undefined &&
    ctx.client.getHierarchy().isDerived(project._class, tracker.class.Project) &&
    ctx.client.getHierarchy().isDerived(target.targetClass, tracker.class.Issue)
  )
}

export const getAllowedSpaceClasses: GetIntegrationTargetAllowedSpaceClasses = async (client, targetClass) => {
  if (!client.getHierarchy().isDerived(targetClass, tracker.class.Issue)) {
    return []
  }

  return [tracker.class.Project]
}

export const createIntegrationTarget: CreateIntegrationTarget = async (ctx, target, values) => {
  if (target.space === undefined) {
    throw new Error('Cannot create tracker issue integration target without target project')
  }

  const project = await ctx.client.findOne(tracker.class.Project, { _id: target.space as Ref<Project> })
  if (project === undefined) {
    throw new Error(`Cannot create tracker issue integration target in missing project ${target.space}`)
  }

  const targetClass = target.targetClass as Ref<Class<Issue>>
  const id = generateId<Issue>()
  const incomingData = toIssueData(values)
  const labelTitles = getLabelTitles(values.labels)
  delete incomingData.labels
  const incResult = await ctx.client.updateDoc(
    tracker.class.Project,
    core.space.Space,
    project._id,
    {
      $inc: { sequence: 1 }
    },
    true
  )
  const number = (incResult as { object: Project }).object.sequence
  const description = await uploadMarkup(ctx, targetClass, id, 'description', incomingData.description)
  const status = incomingData.status ?? (await getDefaultIssueStatus(ctx, project))
  const data: AttachedData<Issue> = {
    ...incomingData,
    title: incomingData.title ?? 'Integration issue',
    description,
    assignee: incomingData.assignee ?? project.defaultAssignee ?? null,
    component: incomingData.component ?? null,
    milestone: incomingData.milestone ?? null,
    number,
    status,
    priority: incomingData.priority ?? IssuePriority.NoPriority,
    rank: incomingData.rank ?? '',
    comments: incomingData.comments ?? 0,
    subIssues: incomingData.subIssues ?? 0,
    startDate: incomingData.startDate ?? null,
    dueDate: incomingData.dueDate ?? null,
    parents: incomingData.parents ?? [],
    reportedTime: incomingData.reportedTime ?? 0,
    remainingTime: incomingData.remainingTime ?? 0,
    estimation: incomingData.estimation ?? 0,
    reports: incomingData.reports ?? 0,
    relations: incomingData.relations ?? [],
    childInfo: incomingData.childInfo ?? [],
    kind: incomingData.kind ?? tracker.taskTypes.Issue,
    identifier: incomingData.identifier ?? `${project.identifier}-${number}`
  }

  const filledData = fillDefaults(ctx.client.getHierarchy(), data, targetClass)
  await ctx.client.addCollection(
    targetClass,
    project._id,
    tracker.ids.NoParent,
    tracker.class.Issue,
    'subIssues',
    filledData as AttachedData<Issue>,
    id
  )
  const doc = await ctx.client.findOne<Issue>(targetClass, { _id: id })

  if (doc === undefined) {
    throw new Error(`Created tracker issue integration target was not found: ${id}`)
  }

  if (labelTitles.length > 0) {
    await syncIssueLabels(ctx, doc._id, doc._class as Ref<Class<Issue>>, labelTitles)
  }

  return doc
}

export const updateIntegrationTarget: UpdateIntegrationTarget = async (ctx, doc, values) => {
  if (!ctx.client.getHierarchy().isDerived(doc._class, tracker.class.Issue)) {
    throw new Error(`Cannot update non-issue integration target ${doc._class}`)
  }

  const issue = doc as Issue
  const update = toIssueData(values)
  const labelTitles = getLabelTitles(values.labels)
  delete update.labels

  if (update.description !== undefined) {
    const description = await updateMarkup(
      ctx,
      issue._class,
      issue._id,
      'description',
      update.description,
      issue.description
    )
    if (description === undefined) {
      delete update.description
    } else {
      update.description = description
    }
  }

  await ctx.client.update(issue, update)
  if (values.labels !== undefined) {
    await syncIssueLabels(ctx, issue._id, issue._class, labelTitles)
  }
}
