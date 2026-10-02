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

import documents, {
  type ChangeControl,
  type ControlledDocument,
  ControlledDocumentState,
  type DocumentComment,
  type DocumentRequest,
  DocumentState
} from '@hcengineering/controlled-documents'
import core, {
  type AttachedDoc,
  type Class,
  type Doc,
  type DocumentQuery,
  type Ref,
  type Tx,
  type TxCreateDoc,
  type TxCUD,
  type TxMixin,
  type TxUpdateDoc
} from '@hcengineering/core'
import { RequestStatus } from '@hcengineering/request'
import type { GuestTxDecision, GuestTxValidatorControl } from '@hcengineering/server-core'

/**
 * Guest rules of the controlled document lifecycle. A guest acts by its role in the document:
 * - owner: team, release settings, sending for review or approval, editing after review;
 * - co-author: content fields and comments of a draft;
 * - reviewer: comments while the document is in review.
 *
 * Every rule requires the guest to read the document. Transactions that do not match a rule are left to the generic
 * guest rules, except changes of the workflow fields, which are always rejected.
 */

const SUPPORTED_OPERATORS = new Set(['$push', '$pull', '$inc', '$unset'])

/** Fields a guest may never change outside of the workflow rules below. */
const WORKFLOW_FIELDS = new Set([
  'controlledState',
  'state',
  'owner',
  'author',
  'effectiveDate',
  'plannedEffectiveDate'
])

type TeamField = 'coAuthors' | 'reviewers' | 'approvers'

const TEAM_FIELD_STATES: Record<TeamField, Array<ControlledDocumentState | null>> = {
  coAuthors: [null],
  reviewers: [null, ControlledDocumentState.InReview],
  approvers: [
    null,
    ControlledDocumentState.InReview,
    ControlledDocumentState.InApproval,
    ControlledDocumentState.Reviewed
  ]
}

const AUTHOR_FIELDS = new Set(['title', 'abstract'])
const OWNER_FIELDS = new Set([...AUTHOR_FIELDS, 'reviewInterval', 'major', 'minor'])
const TRAINING_FIELDS = new Set(['enabled', 'training', 'roles', 'trainees', 'maxAttempts', 'dueDays'])
const CHANGE_CONTROL_FIELDS = new Set(['description', 'reason', 'impact', 'impactedDocuments'])
const REQUEST_TEAM_FIELDS = new Set(['requested', 'approved', 'approvedDates', 'requiredApprovesCount'])
const REQUEST_CREATE_FIELDS = new Set([
  'requested',
  'approved',
  'requiredApprovesCount',
  'status',
  'tx',
  'rejectedTx',
  'attachedTo',
  'attachedToClass',
  'collection'
])
const SNAPSHOT_CREATE_FIELDS = new Set([
  'name',
  'state',
  'controlledState',
  'content',
  'attachedTo',
  'attachedToClass',
  'collection'
])
const SNAPSHOT_STATES = new Set<ControlledDocumentState | undefined>([
  ControlledDocumentState.Reviewed,
  ControlledDocumentState.Approved,
  ControlledDocumentState.Rejected
])

interface Roles {
  owner: boolean
  coAuthor: boolean
  reviewer: boolean
}

function getUpdatedAttributes (operations: Record<string, unknown>): Set<string> | undefined {
  const result = new Set<string>()
  for (const [key, value] of Object.entries(operations)) {
    if (!key.startsWith('$')) {
      result.add(key)
      continue
    }
    if (!SUPPORTED_OPERATORS.has(key) || value === null || typeof value !== 'object' || Array.isArray(value)) {
      return undefined
    }
    for (const attribute of Object.keys(value)) result.add(attribute)
  }
  return result.size > 0 ? result : undefined
}

function isSubset (values: Set<string>, allowed: Set<string>): boolean {
  return Array.from(values).every((it) => allowed.has(it))
}

function sameItems (a: unknown, b: unknown[]): boolean {
  if (!Array.isArray(a) || a.length !== b.length) return false
  const set = new Set(b)
  return a.every((it) => set.has(it))
}

function getControlledState (doc: ControlledDocument): ControlledDocumentState | null {
  return doc.controlledState ?? null
}

function isDraft (doc: ControlledDocument): boolean {
  return doc.state === DocumentState.Draft
}

function isCleanDraft (doc: ControlledDocument): boolean {
  return isDraft(doc) && getControlledState(doc) === null
}

function getAttachedTo (tx: TxCreateDoc<Doc>): { attachedTo?: Ref<Doc>, attachedToClass?: Ref<Class<Doc>> } {
  const attributes = tx.attributes as Partial<AttachedDoc>
  return {
    attachedTo: tx.attachedTo ?? attributes.attachedTo,
    attachedToClass: tx.attachedToClass ?? attributes.attachedToClass
  }
}

function getCreatedAttributes (tx: TxCreateDoc<Doc>): Set<string> {
  return new Set(Object.keys(tx.attributes))
}

class ControlledDocumentGuestValidator {
  constructor (private readonly control: GuestTxValidatorControl) {}

  private get hierarchy (): GuestTxValidatorControl['hierarchy'] {
    return this.control.hierarchy
  }

  private isDerived (_class: Ref<Class<Doc>>, from: Ref<Class<Doc>>): boolean {
    return this.hierarchy.isDerived(_class, from)
  }

  async validate (tx: TxCUD<Doc>): Promise<GuestTxDecision> {
    if (this.control.person === undefined) return undefined
    const objectClass = tx.objectClass
    if (this.isDerived(objectClass, documents.class.ControlledDocument)) {
      if (tx._class === core.class.TxUpdateDoc) return await this.validateDocumentUpdate(tx as TxUpdateDoc<Doc>)
      if (tx._class === core.class.TxMixin) return await this.validateDocumentMixin(tx as TxMixin<Doc, Doc>)
      return undefined
    }
    if (this.isDerived(objectClass, documents.class.DocumentRequest)) {
      if (tx._class === core.class.TxCreateDoc) return await this.validateRequestCreate(tx as TxCreateDoc<Doc>)
      if (tx._class === core.class.TxUpdateDoc) return await this.validateRequestUpdate(tx as TxUpdateDoc<Doc>)
      return undefined
    }
    if (this.isDerived(objectClass, documents.class.ControlledDocumentSnapshot)) {
      if (tx._class === core.class.TxCreateDoc) return await this.validateSnapshotCreate(tx as TxCreateDoc<Doc>)
      return undefined
    }
    if (this.isDerived(objectClass, documents.class.DocumentComment)) {
      if (tx._class === core.class.TxUpdateDoc) return await this.validateCommentUpdate(tx as TxUpdateDoc<Doc>)
      return undefined
    }
    if (this.isDerived(objectClass, documents.class.ChangeControl)) {
      if (tx._class === core.class.TxUpdateDoc) return await this.validateChangeControlUpdate(tx as TxUpdateDoc<Doc>)
      return undefined
    }
    return undefined
  }

  private async findOne<T extends Doc>(_class: Ref<Class<T>>, _id: Ref<Doc>): Promise<T | undefined> {
    return (await this.control.findAll(_class, { _id } as unknown as DocumentQuery<T>, { limit: 1 }))[0]
  }

  /** The controlled document, if the guest can read it and the transaction targets its space. */
  private async getDocument (_id: Ref<Doc> | undefined, space: Ref<Doc>): Promise<ControlledDocument | undefined> {
    if (_id === undefined) return undefined
    const doc = await this.findOne(documents.class.ControlledDocument, _id)
    if (doc === undefined || doc.space !== space) return undefined
    if (!(await this.control.canRead(doc))) return undefined
    return doc
  }

  private getRoles (doc: ControlledDocument): Roles {
    const person = this.control.person as Ref<any>
    return {
      owner: doc.owner === person,
      coAuthor: (doc.coAuthors ?? []).includes(person),
      reviewer: (doc.reviewers ?? []).includes(person)
    }
  }

  private findApplyTx<T extends Tx>(predicate: (tx: Tx) => boolean): T | undefined {
    return this.control.applyTxes.find(predicate) as T | undefined
  }

  // Controlled document

  private async validateDocumentUpdate (tx: TxUpdateDoc<Doc>): Promise<GuestTxDecision> {
    const operations = tx.operations as Record<string, unknown>
    const updated = getUpdatedAttributes(operations)
    if (updated === undefined) return undefined
    const touchesWorkflow = Array.from(updated).some((it) => WORKFLOW_FIELDS.has(it))
    const reject: GuestTxDecision = touchesWorkflow ? 'deny' : undefined

    const doc = await this.getDocument(tx.objectId, tx.objectSpace)
    if (doc === undefined) return reject
    const roles = this.getRoles(doc)
    if (!roles.owner && !roles.coAuthor && !roles.reviewer) return reject

    if (this.isCommentSequenceUpdate(operations) && this.canComment(doc, roles)) return 'allow'
    if (!roles.owner && !roles.coAuthor) return reject

    if (!touchesWorkflow) {
      if (await this.isContentUpdate(doc, roles, operations, updated)) return 'allow'
      if (roles.owner && this.isTeamUpdate(doc, updated)) return 'allow'
      return undefined
    }

    if (!roles.owner) return 'deny'
    if (this.isSendForReview(tx, doc, operations)) return 'allow'
    if (this.isSendForApproval(tx, doc, operations)) return 'allow'
    if (this.isEditAfterReview(tx, doc, operations)) return 'allow'
    return 'deny'
  }

  private isCommentSequenceUpdate (operations: Record<string, unknown>): boolean {
    const keys = Object.keys(operations)
    if (keys.length !== 1 || keys[0] !== '$inc') return false
    const inc = operations.$inc as Record<string, unknown>
    return Object.keys(inc).length === 1 && inc.commentSequence === 1
  }

  /** Mirrors `canAddDocumentComments` of the client. */
  private canComment (doc: ControlledDocument, roles: Roles): boolean {
    if (!isDraft(doc)) return false
    const state = getControlledState(doc)
    if (state === null) return roles.owner || roles.coAuthor
    if (state === ControlledDocumentState.InReview) return roles.owner || roles.coAuthor || roles.reviewer
    return false
  }

  private async isContentUpdate (
    doc: ControlledDocument,
    roles: Roles,
    operations: Record<string, unknown>,
    updated: Set<string>
  ): Promise<boolean> {
    if (!isCleanDraft(doc)) return false
    if (!isSubset(updated, roles.owner ? OWNER_FIELDS : AUTHOR_FIELDS)) return false
    if (updated.has('major') || updated.has('minor')) {
      return await this.isAllowedVersion(doc, operations)
    }
    return true
  }

  /** A new version may only be the next minor or the next major version after the previous one, see `EditDocRelease`. */
  private async isAllowedVersion (doc: ControlledDocument, operations: Record<string, unknown>): Promise<boolean> {
    const major = operations.major
    const minor = operations.minor
    if (!Number.isSafeInteger(major) || !Number.isSafeInteger(minor)) return false
    const versions = await this.control.findAll(documents.class.ControlledDocument, {
      attachedTo: doc.attachedTo,
      _id: { $ne: doc._id }
    })
    let previous: { major: number, minor: number } | undefined
    for (const it of versions) {
      const isOlder = (it.major === doc.major && it.minor < doc.minor) || it.major < doc.major
      if (!isOlder) continue
      if (
        previous === undefined ||
        it.major > previous.major ||
        (it.major === previous.major && it.minor > previous.minor)
      ) {
        previous = { major: it.major, minor: it.minor }
      }
    }
    const prevMajor = previous?.major ?? 0
    const prevMinor = previous?.minor ?? 0
    return (major === prevMajor + 1 && minor === 0) || (major === prevMajor && minor === prevMinor + 1)
  }

  private isTeamUpdate (doc: ControlledDocument, updated: Set<string>): boolean {
    if (!isDraft(doc)) return false
    const state = getControlledState(doc)
    return Array.from(updated).every((field) => {
      const states = TEAM_FIELD_STATES[field as TeamField]
      return states?.includes(state) ?? false
    })
  }

  private isSendForReview (tx: TxUpdateDoc<Doc>, doc: ControlledDocument, operations: Record<string, unknown>): boolean {
    if (!isCleanDraft(doc)) return false
    if (!isSubset(new Set(Object.keys(operations)), new Set(['reviewers', 'controlledState']))) return false
    if (operations.controlledState !== ControlledDocumentState.InReview) return false
    const reviewers = operations.reviewers ?? doc.reviewers
    return this.hasRequestCreate(tx, documents.class.DocumentReviewRequest, reviewers)
  }

  private isSendForApproval (
    tx: TxUpdateDoc<Doc>,
    doc: ControlledDocument,
    operations: Record<string, unknown>
  ): boolean {
    if (!isDraft(doc)) return false
    const state = getControlledState(doc)
    if (state !== null && state !== ControlledDocumentState.Reviewed) return false
    const allowed = new Set(['approvers', 'externalApprovers', 'controlledState'])
    if (!isSubset(new Set(Object.keys(operations)), allowed)) return false
    if (operations.controlledState !== ControlledDocumentState.InApproval) return false
    // Guests can not grant document access to external approvers.
    if (operations.externalApprovers !== undefined && !sameItems(operations.externalApprovers, doc.externalApprovers)) {
      return false
    }
    const approvers = operations.approvers ?? doc.approvers
    if (!Array.isArray(approvers)) return false
    return this.hasRequestCreate(tx, documents.class.DocumentApprovalRequest, [...approvers, ...doc.externalApprovers])
  }

  private hasRequestCreate (
    update: TxUpdateDoc<Doc>,
    requestClass: Ref<Class<DocumentRequest>>,
    requested: unknown
  ): boolean {
    if (!Array.isArray(requested)) return false
    const create = this.findApplyTx<TxCreateDoc<DocumentRequest>>(
      (it) =>
        it._class === core.class.TxCreateDoc &&
        (it as TxCreateDoc<Doc>).objectClass === requestClass &&
        getAttachedTo(it as TxCreateDoc<Doc>).attachedTo === update.objectId
    )
    return create !== undefined && sameItems(create.attributes.requested, requested)
  }

  private isEditAfterReview (
    tx: TxUpdateDoc<Doc>,
    doc: ControlledDocument,
    operations: Record<string, unknown>
  ): boolean {
    if (!isDraft(doc) || !SNAPSHOT_STATES.has(doc.controlledState)) return false
    const keys = Object.keys(operations)
    if (keys.length !== 1 || keys[0] !== '$unset') return false
    const unset = operations.$unset as Record<string, unknown>
    if (Object.keys(unset).length !== 1 || unset.controlledState === undefined) return false
    return (
      this.findApplyTx(
        (it) =>
          it._class === core.class.TxCreateDoc &&
          this.isDerived((it as TxCreateDoc<Doc>).objectClass, documents.class.ControlledDocumentSnapshot) &&
          getAttachedTo(it as TxCreateDoc<Doc>).attachedTo === tx.objectId
      ) !== undefined
    )
  }

  private async validateDocumentMixin (tx: TxMixin<Doc, Doc>): Promise<GuestTxDecision> {
    if (tx.mixin !== documents.mixin.DocumentTraining) return undefined
    const updated = getUpdatedAttributes(tx.attributes as Record<string, unknown>)
    if (updated === undefined || !isSubset(updated, TRAINING_FIELDS)) return undefined
    const doc = await this.getDocument(tx.objectId, tx.objectSpace)
    if (doc === undefined || !isCleanDraft(doc) || !this.getRoles(doc).owner) return undefined
    return 'allow'
  }

  // Requests

  private async validateRequestCreate (tx: TxCreateDoc<Doc>): Promise<GuestTxDecision> {
    const { attachedTo, attachedToClass } = getAttachedTo(tx)
    if (attachedToClass === undefined || !this.isDerived(attachedToClass, documents.class.ControlledDocument)) {
      return undefined
    }
    const doc = await this.getDocument(attachedTo, tx.objectSpace)
    if (doc === undefined || !this.getRoles(doc).owner || !isDraft(doc)) return 'deny'
    if (!isSubset(getCreatedAttributes(tx), REQUEST_CREATE_FIELDS)) return 'deny'

    const request = tx.attributes as Partial<DocumentRequest>
    const requested = request.requested
    if (!Array.isArray(requested) || requested.length === 0) return 'deny'
    if (!Array.isArray(request.approved) || request.approved.length !== 0) return 'deny'
    if (request.status !== RequestStatus.Active) return 'deny'
    if (request.requiredApprovesCount !== requested.length) return 'deny'

    const isReview = this.isDerived(tx.objectClass, documents.class.DocumentReviewRequest)
    const isApproval = this.isDerived(tx.objectClass, documents.class.DocumentApprovalRequest)
    if (isReview) {
      if (request.rejectedTx !== undefined) return 'deny'
      if (!this.isStateTx(request.tx, doc, ControlledDocumentState.Reviewed)) return 'deny'
      if (!this.hasStateUpdate(doc, ControlledDocumentState.InReview)) return 'deny'
      return 'allow'
    }
    if (isApproval) {
      if (!this.isStateTx(request.tx, doc, ControlledDocumentState.Approved)) return 'deny'
      if (!this.isStateTx(request.rejectedTx, doc, ControlledDocumentState.Rejected)) return 'deny'
      if (!this.hasStateUpdate(doc, ControlledDocumentState.InApproval)) return 'deny'
      return 'allow'
    }
    return 'deny'
  }

  /**
   * The transaction a request applies when it is closed. The request trigger applies it on behalf of the system,
   * so it must be exactly the expected state change of the document.
   */
  private isStateTx (value: unknown, doc: ControlledDocument, state: ControlledDocumentState): boolean {
    if (value === null || typeof value !== 'object') return false
    const tx = value as TxUpdateDoc<Doc>
    if (tx._class !== core.class.TxUpdateDoc || tx.space !== core.space.Tx) return false
    if (tx.objectId !== doc._id || tx.objectClass !== doc._class || tx.objectSpace !== doc.space) return false
    const operations = tx.operations as Record<string, unknown>
    if (operations === null || typeof operations !== 'object') return false
    const keys = Object.keys(operations)
    return keys.length === 1 && keys[0] === 'controlledState' && operations.controlledState === state
  }

  private hasStateUpdate (doc: ControlledDocument, state: ControlledDocumentState): boolean {
    return (
      this.findApplyTx(
        (it) =>
          it._class === core.class.TxUpdateDoc &&
          (it as TxUpdateDoc<Doc>).objectId === doc._id &&
          ((it as TxUpdateDoc<Doc>).operations as Record<string, unknown>).controlledState === state
      ) !== undefined
    )
  }

  /** The owner changes the team of an active request. Approvals can only be withdrawn together with the approver. */
  private async validateRequestUpdate (tx: TxUpdateDoc<Doc>): Promise<GuestTxDecision> {
    const operations = tx.operations as Record<string, unknown>
    const updated = getUpdatedAttributes(operations)
    if (updated === undefined || !isSubset(updated, REQUEST_TEAM_FIELDS)) return undefined
    const request = await this.findOne(documents.class.DocumentRequest, tx.objectId)
    if (request === undefined || request.space !== tx.objectSpace || request.status !== RequestStatus.Active) {
      return undefined
    }
    const doc = await this.getDocument(request.attachedTo, tx.objectSpace)
    if (doc === undefined || !isDraft(doc) || !this.getRoles(doc).owner) return undefined

    if (operations.approved !== undefined) {
      const approved = operations.approved
      const current = new Set(request.approved ?? [])
      if (!Array.isArray(approved) || !approved.every((it) => current.has(it))) return 'deny'
      if (!Array.isArray(operations.approvedDates) || operations.approvedDates.length !== approved.length) {
        return 'deny'
      }
    } else if (updated.has('approved') || updated.has('approvedDates')) {
      // Approving is not a team change, it is left to the request rules.
      return undefined
    }
    if (updated.has('requiredApprovesCount')) {
      const count = operations.requiredApprovesCount
      if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 1) return 'deny'
    }
    return 'allow'
  }

  // Snapshots, comments and change control

  private async validateSnapshotCreate (tx: TxCreateDoc<Doc>): Promise<GuestTxDecision> {
    const { attachedTo } = getAttachedTo(tx)
    const doc = await this.getDocument(attachedTo, tx.objectSpace)
    if (doc === undefined || !this.getRoles(doc).owner) return undefined
    if (!isDraft(doc) || !SNAPSHOT_STATES.has(doc.controlledState)) return 'deny'
    if (!isSubset(getCreatedAttributes(tx), SNAPSHOT_CREATE_FIELDS)) return 'deny'
    const attributes = tx.attributes as Record<string, unknown>
    if (attributes.state !== doc.state || attributes.controlledState !== doc.controlledState) return 'deny'
    if (attributes.content !== doc.content) return 'deny'
    const reset = this.findApplyTx(
      (it) =>
        it._class === core.class.TxUpdateDoc &&
        (it as TxUpdateDoc<Doc>).objectId === doc._id &&
        this.isEditAfterReview(it as TxUpdateDoc<Doc>, doc, (it as TxUpdateDoc<Doc>).operations as any)
    )
    return reset !== undefined ? 'allow' : 'deny'
  }

  private async validateCommentUpdate (tx: TxUpdateDoc<Doc>): Promise<GuestTxDecision> {
    const updated = getUpdatedAttributes(tx.operations as Record<string, unknown>)
    if (updated === undefined || !isSubset(updated, new Set(['resolved']))) return undefined
    const comment = await this.findOne<DocumentComment>(documents.class.DocumentComment, tx.objectId)
    if (comment === undefined || comment.space !== tx.objectSpace) return undefined
    const doc = await this.getDocument(comment.attachedTo, tx.objectSpace)
    if (doc === undefined) return undefined
    // Mirrors `canAddDocumentCommentsFeedback` of the client.
    const roles = this.getRoles(doc)
    return roles.owner || roles.coAuthor || roles.reviewer ? 'allow' : undefined
  }

  private async validateChangeControlUpdate (tx: TxUpdateDoc<Doc>): Promise<GuestTxDecision> {
    const updated = getUpdatedAttributes(tx.operations as Record<string, unknown>)
    if (updated === undefined || !isSubset(updated, CHANGE_CONTROL_FIELDS)) return undefined
    const docs = await this.control.findAll(documents.class.ControlledDocument, {
      changeControl: tx.objectId as Ref<ChangeControl>,
      space: tx.objectSpace as any,
      state: DocumentState.Draft
    })
    for (const doc of docs) {
      if (!isCleanDraft(doc)) continue
      const roles = this.getRoles(doc)
      if ((roles.owner || roles.coAuthor) && (await this.control.canRead(doc))) return 'allow'
    }
    return undefined
  }
}

/**
 * Validates guest transactions of the controlled documents module.
 * @public
 */
export async function ValidateGuestTx (tx: TxCUD<Doc>, control: GuestTxValidatorControl): Promise<GuestTxDecision> {
  return await new ControlledDocumentGuestValidator(control).validate(tx)
}
