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

import documents, { ControlledDocumentState, DocumentState } from '@hcengineering/controlled-documents'
import core, {
  AccountRole,
  generateId,
  MeasureMetricsContext,
  type Class,
  type Doc,
  type PersonId,
  type Ref,
  type Space,
  type Tx,
  type TxCUD,
  TxFactory
} from '@hcengineering/core'
import { RequestStatus } from '@hcengineering/request'
import type { GuestTxDecision, GuestTxValidatorControl } from '@hcengineering/server-core'

import { ValidateGuestTx } from '../guestValidator'

const SPACE = 'test:space:Docs' as Ref<Space>
const HIDDEN_SPACE = 'test:space:Hidden' as Ref<Space>
const GUEST = 'test:person:Guest' as Ref<Doc>
const USER = 'test:person:User' as Ref<Doc>
const STRANGER = 'test:person:Stranger' as Ref<Doc>
const META = 'test:meta:Doc' as Ref<Doc>
const CHANGE_CONTROL = 'test:cc:Doc' as Ref<Doc>

const parents: Record<string, string> = {
  [documents.class.DocumentReviewRequest]: documents.class.DocumentRequest,
  [documents.class.DocumentApprovalRequest]: documents.class.DocumentRequest
}

const factory = new TxFactory('test:guest' as PersonId)

let docs: Map<Ref<Doc>, any>

function makeControlledDoc (_id: string, extra: Record<string, unknown> = {}): any {
  return {
    _id,
    _class: documents.class.ControlledDocument,
    space: SPACE,
    attachedTo: META,
    state: DocumentState.Draft,
    controlledState: undefined,
    owner: GUEST,
    coAuthors: [],
    reviewers: [],
    approvers: [],
    externalApprovers: [],
    major: 1,
    minor: 1,
    content: 'blob:content',
    changeControl: CHANGE_CONTROL,
    ...extra
  }
}

function addDoc (doc: any): any {
  docs.set(doc._id, doc)
  return doc
}

function makeControl (applyTxes: Tx[], person: Ref<Doc> | undefined): GuestTxValidatorControl {
  return {
    ctx: new MeasureMetricsContext('test', {}),
    account: { uuid: 'guest', role: AccountRole.Guest } as any,
    hierarchy: {
      isDerived: (a: string, b: string) => a === b || parents[a] === b
    } as any,
    findAll: async (_class: Ref<Class<Doc>>, query: any): Promise<any> => {
      const all = Array.from(docs.values()).filter((it) => it._class === _class || parents[it._class] === _class)
      return all.filter((it) =>
        Object.entries(query).every(([key, value]: [string, any]) => {
          if (value !== null && typeof value === 'object' && '$ne' in value) return it[key] !== value.$ne
          return it[key] === value
        })
      )
    },
    person,
    canRead: async (doc: Doc) => doc.space === SPACE,
    applyTxes
  }
}

async function validate (tx: Tx, applyTxes: Tx[] = [], person?: Ref<Doc>): Promise<GuestTxDecision> {
  return await ValidateGuestTx(tx as TxCUD<Doc>, makeControl(applyTxes, person ?? GUEST))
}

function update (doc: any, operations: Record<string, unknown>): Tx {
  return factory.createTxUpdateDoc(doc._class, doc.space, doc._id, operations)
}

function stateTx (doc: any, controlledState: ControlledDocumentState): Tx {
  return factory.createTxUpdateDoc(doc._class, doc.space, doc._id, { controlledState } as any)
}

function attach (tx: Tx, doc: any, collection: string): Tx {
  return { ...tx, attachedTo: doc._id, attachedToClass: doc._class, collection } as any
}

function createRequest (doc: any, _class: Ref<Class<Doc>>, attributes: Record<string, unknown>): Tx {
  const tx = factory.createTxCreateDoc(
    _class,
    doc.space,
    {
      requested: [USER],
      approved: [],
      requiredApprovesCount: 1,
      status: RequestStatus.Active,
      tx: stateTx(doc, ControlledDocumentState.Reviewed),
      ...attributes
    },
    generateId()
  )
  return attach(tx, doc, 'requests')
}

function createSnapshot (doc: any, attributes: Record<string, unknown> = {}): Tx {
  const tx = factory.createTxCreateDoc(
    documents.class.ControlledDocumentSnapshot,
    doc.space,
    {
      name: 'Draft revision 1',
      state: doc.state,
      controlledState: doc.controlledState,
      content: doc.content,
      ...attributes
    } as any,
    generateId()
  )
  return attach(tx, doc, 'snapshots')
}

describe('controlled documents guest validator', () => {
  beforeEach(() => {
    docs = new Map()
  })

  describe('team', () => {
    it('lets the owner change the team of a draft', async () => {
      const doc = addDoc(makeControlledDoc('doc'))
      expect(await validate(update(doc, { $push: { reviewers: { $each: [USER], $position: 0 } } }))).toBe('allow')
      expect(await validate(update(doc, { $pull: { coAuthors: { $in: [USER] } } }))).toBe('allow')
    })

    it('follows the states of the team editor', async () => {
      const doc = addDoc(makeControlledDoc('doc', { controlledState: ControlledDocumentState.InReview }))
      expect(await validate(update(doc, { $push: { reviewers: USER } }))).toBe('allow')
      expect(await validate(update(doc, { $push: { approvers: USER } }))).toBe('allow')
      expect(await validate(update(doc, { $push: { coAuthors: USER } }))).toBeUndefined()
    })

    it('is not available to co-authors, other users and released documents', async () => {
      const coAuthored = addDoc(makeControlledDoc('co', { owner: USER, coAuthors: [GUEST] }))
      expect(await validate(update(coAuthored, { $push: { reviewers: USER } }))).toBeUndefined()
      const foreign = addDoc(makeControlledDoc('foreign', { owner: USER }))
      expect(await validate(update(foreign, { $push: { reviewers: USER } }))).toBeUndefined()
      const effective = addDoc(makeControlledDoc('effective', { state: DocumentState.Effective }))
      expect(await validate(update(effective, { $push: { reviewers: USER } }))).toBeUndefined()
    })

    it('does not let guests change external approvers', async () => {
      const doc = addDoc(makeControlledDoc('doc'))
      expect(await validate(update(doc, { $push: { externalApprovers: USER } }))).toBeUndefined()
    })

    it('lets the owner withdraw approvals of removed request members only', async () => {
      const doc = addDoc(makeControlledDoc('doc', { controlledState: ControlledDocumentState.InReview }))
      const request = addDoc({
        _id: 'request',
        _class: documents.class.DocumentReviewRequest,
        space: SPACE,
        attachedTo: doc._id,
        status: RequestStatus.Active,
        requested: [USER, STRANGER],
        approved: [USER]
      })
      expect(await validate(update(request, { $pull: { requested: { $in: [USER] } } }))).toBe('allow')
      expect(await validate(update(request, { approved: [], approvedDates: [], requiredApprovesCount: 1 }))).toBe(
        'allow'
      )
      expect(await validate(update(request, { approved: [USER, STRANGER], approvedDates: [1, 2] }))).toBe('deny')
      expect(await validate(update(request, { requiredApprovesCount: 0 }))).toBe('deny')
    })
  })

  describe('comments', () => {
    const inc = { $inc: { commentSequence: 1 } }

    it('allows authors in a draft and reviewers in review', async () => {
      const draft = addDoc(makeControlledDoc('draft', { owner: USER, coAuthors: [GUEST] }))
      expect(await validate(update(draft, inc))).toBe('allow')
      const reviewedDraft = addDoc(makeControlledDoc('reviewer-draft', { owner: USER, reviewers: [GUEST] }))
      expect(await validate(update(reviewedDraft, inc))).toBeUndefined()
      const inReview = addDoc(
        makeControlledDoc('review', {
          owner: USER,
          reviewers: [GUEST],
          controlledState: ControlledDocumentState.InReview
        })
      )
      expect(await validate(update(inReview, inc))).toBe('allow')
    })

    it('rejects other increments', async () => {
      const doc = addDoc(makeControlledDoc('doc'))
      expect(await validate(update(doc, { $inc: { commentSequence: 5 } }))).toBeUndefined()
    })

    it('lets document participants resolve comments', async () => {
      const doc = addDoc(makeControlledDoc('doc', { owner: USER, reviewers: [GUEST] }))
      const comment = addDoc({
        _id: 'comment',
        _class: documents.class.DocumentComment,
        space: SPACE,
        attachedTo: doc._id
      })
      expect(await validate(update(comment, { resolved: true }))).toBe('allow')
      expect(await validate(update(comment, { resolved: true }), [], STRANGER)).toBeUndefined()
      expect(await validate(update(comment, { message: 'changed' }))).toBeUndefined()
    })
  })

  describe('content and release', () => {
    it('lets authors edit the content fields of a draft', async () => {
      const doc = addDoc(makeControlledDoc('doc', { owner: USER, coAuthors: [GUEST] }))
      expect(await validate(update(doc, { title: 'New' }))).toBe('allow')
      expect(await validate(update(doc, { reviewInterval: 12 }))).toBeUndefined()
      const changeControl = addDoc({ _id: CHANGE_CONTROL, _class: documents.class.ChangeControl, space: SPACE })
      expect(await validate(update(changeControl, { reason: 'Why' }))).toBe('allow')
      expect(await validate(update(changeControl, { reason: 'Why' }), [], STRANGER)).toBeUndefined()
    })

    it('lets the owner pick the next minor or major version only', async () => {
      addDoc(makeControlledDoc('previous', { major: 1, minor: 0, state: DocumentState.Effective }))
      const doc = addDoc(makeControlledDoc('doc', { major: 1, minor: 1 }))
      expect(await validate(update(doc, { major: 2, minor: 0 }))).toBe('allow')
      expect(await validate(update(doc, { major: 1, minor: 1 }))).toBe('allow')
      expect(await validate(update(doc, { major: 5, minor: 0 }))).toBeUndefined()
      expect(await validate(update(doc, { major: 1, minor: 7 }))).toBeUndefined()
    })

    it('lets the owner configure training', async () => {
      const doc = addDoc(makeControlledDoc('doc'))
      const training = factory.createTxMixin(doc._id, doc._class, doc.space, documents.mixin.DocumentTraining, {
        enabled: true,
        training: null,
        roles: [],
        trainees: [],
        maxAttempts: null,
        dueDays: null
      })
      expect(await validate(training)).toBe('allow')
      const foreign = addDoc(makeControlledDoc('foreign', { owner: USER, coAuthors: [GUEST] }))
      const foreignTraining = factory.createTxMixin(
        foreign._id,
        foreign._class,
        foreign.space,
        documents.mixin.DocumentTraining,
        { enabled: true }
      )
      expect(await validate(foreignTraining)).toBeUndefined()
    })
  })

  describe('send for review', () => {
    it('accepts the state change together with the matching request', async () => {
      const doc = addDoc(makeControlledDoc('doc'))
      const change = update(doc, { reviewers: [USER], controlledState: ControlledDocumentState.InReview })
      const request = createRequest(doc, documents.class.DocumentReviewRequest, {})
      expect(await validate(change, [change, request])).toBe('allow')
      expect(await validate(request, [change, request])).toBe('allow')
    })

    it('rejects the state change without a request and the request without the state change', async () => {
      const doc = addDoc(makeControlledDoc('doc'))
      const change = update(doc, { reviewers: [USER], controlledState: ControlledDocumentState.InReview })
      const request = createRequest(doc, documents.class.DocumentReviewRequest, {})
      expect(await validate(change)).toBe('deny')
      expect(await validate(request, [request])).toBe('deny')
      const otherReviewers = createRequest(doc, documents.class.DocumentReviewRequest, { requested: [STRANGER] })
      expect(await validate(change, [change, otherReviewers])).toBe('deny')
    })

    it('rejects a request applying anything but the expected state change', async () => {
      const doc = addDoc(makeControlledDoc('doc'))
      const change = update(doc, { reviewers: [USER], controlledState: ControlledDocumentState.InReview })
      const forged = [
        { tx: stateTx(doc, ControlledDocumentState.Approved) },
        { tx: factory.createTxUpdateDoc(core.class.Space, core.space.Space, SPACE, { members: [] }) },
        { tx: update(doc, { controlledState: ControlledDocumentState.Reviewed, owner: GUEST }) },
        { rejectedTx: stateTx(doc, ControlledDocumentState.Rejected) },
        { approved: [USER] },
        { status: RequestStatus.Completed },
        { requiredApprovesCount: 0 },
        { requested: [] },
        { comments: 1, unexpected: true }
      ]
      for (const attributes of forged) {
        const request = createRequest(doc, documents.class.DocumentReviewRequest, attributes)
        expect(await validate(request, [change, request])).toBe('deny')
      }
    })

    it('is available to the owner of a draft only', async () => {
      const foreign = addDoc(makeControlledDoc('foreign', { owner: USER, coAuthors: [GUEST] }))
      const change = update(foreign, { reviewers: [USER], controlledState: ControlledDocumentState.InReview })
      const request = createRequest(foreign, documents.class.DocumentReviewRequest, {})
      expect(await validate(change, [change, request])).toBe('deny')
      expect(await validate(request, [change, request])).toBe('deny')

      const inReview = addDoc(makeControlledDoc('review', { controlledState: ControlledDocumentState.InReview }))
      const again = update(inReview, { controlledState: ControlledDocumentState.InReview })
      expect(await validate(again, [again, createRequest(inReview, documents.class.DocumentReviewRequest, {})])).toBe(
        'deny'
      )
    })

    it('never lets a guest set the result states directly', async () => {
      const doc = addDoc(makeControlledDoc('doc'))
      for (const state of [ControlledDocumentState.Reviewed, ControlledDocumentState.Approved]) {
        expect(await validate(update(doc, { controlledState: state }))).toBe('deny')
      }
      expect(await validate(update(doc, { state: DocumentState.Effective }))).toBe('deny')
      expect(await validate(update(doc, { owner: STRANGER }))).toBe('deny')
    })

    it('rejects workflow changes of a document the guest can not read', async () => {
      const hidden = addDoc(makeControlledDoc('hidden', { space: HIDDEN_SPACE }))
      const change = update(hidden, { reviewers: [USER], controlledState: ControlledDocumentState.InReview })
      expect(await validate(change, [change, createRequest(hidden, documents.class.DocumentReviewRequest, {})])).toBe(
        'deny'
      )
    })

    it('leaves guests without a person to the generic rules', async () => {
      const doc = addDoc(makeControlledDoc('doc'))
      expect(await ValidateGuestTx(update(doc, { title: 'New' }) as any, makeControl([], undefined))).toBeUndefined()
    })
  })

  describe('send for approval', () => {
    function approvalRequest (doc: any, attributes: Record<string, unknown> = {}): Tx {
      return createRequest(doc, documents.class.DocumentApprovalRequest, {
        requested: [USER, STRANGER],
        requiredApprovesCount: 2,
        tx: stateTx(doc, ControlledDocumentState.Approved),
        rejectedTx: stateTx(doc, ControlledDocumentState.Rejected),
        ...attributes
      })
    }

    it('accepts the request after review with unchanged external approvers', async () => {
      const doc = addDoc(
        makeControlledDoc('doc', { controlledState: ControlledDocumentState.Reviewed, externalApprovers: [STRANGER] })
      )
      const change = update(doc, {
        approvers: [USER],
        externalApprovers: [STRANGER],
        controlledState: ControlledDocumentState.InApproval
      })
      const request = approvalRequest(doc)
      expect(await validate(change, [change, request])).toBe('allow')
      expect(await validate(request, [change, request])).toBe('allow')
    })

    it('rejects new external approvers and requests without a reject transaction', async () => {
      const doc = addDoc(makeControlledDoc('doc'))
      const change = update(doc, {
        approvers: [USER],
        externalApprovers: [STRANGER],
        controlledState: ControlledDocumentState.InApproval
      })
      expect(await validate(change, [change, approvalRequest(doc)])).toBe('deny')

      const ownApprovers = update(doc, { approvers: [USER], controlledState: ControlledDocumentState.InApproval })
      const noReject = approvalRequest(doc, { requested: [USER], requiredApprovesCount: 1, rejectedTx: undefined })
      expect(await validate(noReject, [ownApprovers, noReject])).toBe('deny')
    })
  })

  describe('edit after review', () => {
    it('accepts the reset of a reviewed document together with a snapshot', async () => {
      const doc = addDoc(makeControlledDoc('doc', { controlledState: ControlledDocumentState.Reviewed }))
      const snapshot = createSnapshot(doc)
      const reset = update(doc, { $unset: { controlledState: true } })
      expect(await validate(snapshot, [snapshot, reset])).toBe('allow')
      expect(await validate(reset, [snapshot, reset])).toBe('allow')
    })

    it('rejects the reset without a snapshot, in other states and with a foreign snapshot content', async () => {
      const doc = addDoc(makeControlledDoc('doc', { controlledState: ControlledDocumentState.Reviewed }))
      const reset = update(doc, { $unset: { controlledState: true } })
      expect(await validate(reset)).toBe('deny')
      const forged = createSnapshot(doc, { content: 'blob:other' })
      expect(await validate(forged, [forged, reset])).toBe('deny')

      const inReview = addDoc(makeControlledDoc('review', { controlledState: ControlledDocumentState.InReview }))
      const snapshot = createSnapshot(inReview)
      const resetReview = update(inReview, { $unset: { controlledState: true } })
      expect(await validate(resetReview, [snapshot, resetReview])).toBe('deny')
      expect(await validate(snapshot, [snapshot, resetReview])).toBe('deny')
    })
  })
})
