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

import { ClassifierKind, generateId as generateDocId, type Doc, type Ref } from '@hcengineering/core'
import { type APIRequestContext } from '@playwright/test'

import { WorkspaceRestClient } from '../API/workspace-rest-client'
import { PlatformUser, PlatformUserQara, PlatformUserSecond, PlatformUserThird, generateId } from '../utils'

// Ids from the platform models. The test package does not depend on the plugins, so they are spelled out here.
export const ids = {
  product: 'products:class:Product',
  productVersion: 'products:class:ProductVersion',
  productTypeData: 'products:mixin:ProductTypeData',
  productType: 'products:spaceType:ProductType',
  noParentVersion: 'products:ids:NoParentVersion',
  roleQara: 'products:role:QARA',
  roleQualifiedUser: 'products:role:QualifiedUser',
  documentMeta: 'documents:class:DocumentMeta',
  controlledDocument: 'documents:class:ControlledDocument',
  changeControl: 'documents:class:ChangeControl',
  changeControlCategory: 'documents:category:DOC - CC',
  masterTag: 'card:class:MasterTag',
  card: 'card:class:Card',
  cardIcon: 'card:icon:MasterTag',
  cardSpace: 'card:space:Default',
  association: 'core:class:Association',
  relation: 'core:class:Relation',
  model: 'core:space:Model',
  spaces: 'core:space:Space',
  workspace: 'core:space:Workspace'
} as const

export enum ProductVersionState {
  Active = 0,
  Released = 1
}

export interface ChangeControlOption {
  _id: Ref<Doc>
  /** Text shown for the option in the picker. */
  label: string
}

export interface ChangeControlFixture {
  product: Ref<Doc>
  productName: string
  /** Released version 1.0.0. */
  released: Ref<Doc>
  /** Latest, active version 1.1.0. */
  latest: Ref<Doc>
  /** Change control of the released version. */
  releasedChangeControl: ChangeControlOption
  /** Change control assigned to the latest version by mistake. */
  wrongChangeControl: ChangeControlOption
  /** Change control the latest version should have. */
  rightChangeControl: ChangeControlOption
  /** The association used for change control in the card mode. */
  association?: Ref<Doc>
  /** Its name on the side of the card, the title of its block in Relations. */
  relationName?: string
}

export interface Clients {
  /** Prepares the data. A QARA of the product and its owner. */
  user1: WorkspaceRestClient
  /** Workspace owner, the only one who can change the model (card types and relations). */
  user2: WorkspaceRestClient
  /** Qualified User of the product. */
  user3: WorkspaceRestClient
  /** QARA of the product, not its owner. */
  qara: WorkspaceRestClient
}

export async function connectClients (request: APIRequestContext): Promise<Clients> {
  return {
    user1: await WorkspaceRestClient.connect(request, PlatformUser),
    user2: await WorkspaceRestClient.connect(request, PlatformUserSecond),
    user3: await WorkspaceRestClient.connect(request, PlatformUserThird),
    qara: await WorkspaceRestClient.connect(request, PlatformUserQara)
  }
}

async function create (
  client: WorkspaceRestClient,
  _class: string,
  space: string,
  attributes: Record<string, unknown>,
  _id: Ref<Doc> = generateDocId()
): Promise<Ref<Doc>> {
  await client.tx(client.factory.createTxCreateDoc(_class as any, space as any, attributes, _id))
  return _id
}

async function createProduct (clients: Clients, name: string, changeControlRelation?: Ref<Doc>): Promise<Ref<Doc>> {
  const { user1, user3, qara } = clients
  const product = await create(user1, ids.product, ids.spaces, {
    name,
    description: '',
    private: false,
    members: [user1.account.uuid, user3.account.uuid, qara.account.uuid],
    owners: [user1.account.uuid],
    archived: false,
    type: ids.productType,
    fullDescription: '',
    ...(changeControlRelation !== undefined ? { changeControlRelation } : {})
  })
  await user1.tx(
    user1.factory.createTxMixin(
      product,
      ids.product as any,
      ids.spaces as any,
      ids.productTypeData as any,
      {
        [ids.roleQara]: [user1.account.uuid, qara.account.uuid],
        [ids.roleQualifiedUser]: [user3.account.uuid]
      } as any
    )
  )
  return product
}

async function createVersions (
  client: WorkspaceRestClient,
  product: Ref<Doc>,
  releasedChangeControl: Ref<Doc> | undefined,
  latestChangeControl: Ref<Doc> | undefined
): Promise<{ released: Ref<Doc>, latest: Ref<Doc> }> {
  const base = { codename: '', description: '' }
  const released = await create(client, ids.productVersion, product, {
    ...base,
    name: '1.0.0',
    major: 1,
    minor: 0,
    patch: 0,
    parent: ids.noParentVersion,
    readonly: true,
    state: ProductVersionState.Released,
    ...(releasedChangeControl !== undefined ? { changeControl: releasedChangeControl } : {})
  })
  const latest = await create(client, ids.productVersion, product, {
    ...base,
    name: '1.1.0',
    major: 1,
    minor: 1,
    patch: 0,
    parent: released,
    readonly: false,
    state: ProductVersionState.Active,
    ...(latestChangeControl !== undefined ? { changeControl: latestChangeControl } : {})
  })
  return { released, latest }
}

/** An effective controlled document of the Change Control category in the product. */
async function createChangeControlDocument (
  client: WorkspaceRestClient,
  product: Ref<Doc>,
  title: string,
  seqNumber: number
): Promise<ChangeControlOption> {
  const code = `CC-${generateId(6)}`
  const meta = await create(client, ids.documentMeta, product, { documents: 0, title: `${code} ${title}` })
  const changeControl = await create(client, ids.changeControl, product, {
    description: '',
    reason: '',
    impact: '',
    impactedDocuments: []
  })
  const _id = await create(client, ids.controlledDocument, product, {
    attachedTo: meta,
    attachedToClass: ids.documentMeta,
    collection: 'documents',
    title,
    code,
    prefix: 'CC',
    seqNumber,
    major: 1,
    minor: 0,
    category: ids.changeControlCategory,
    state: 'effective',
    content: null,
    abstract: '',
    commentSequence: 0,
    requests: 0,
    labels: 0,
    reviewers: [],
    approvers: [],
    externalApprovers: [],
    coAuthors: [],
    changeControl,
    effectiveDate: Date.now()
  })
  return { _id, label: title }
}

/** A product whose change control is a controlled document. */
export async function prepareDocumentChangeControl (clients: Clients): Promise<ChangeControlFixture> {
  const id = generateId(6)
  const productName = `CC documents ${id}`
  const product = await createProduct(clients, productName)
  const releasedChangeControl = await createChangeControlDocument(clients.user1, product, `Released CC ${id}`, 1)
  const wrongChangeControl = await createChangeControlDocument(clients.user1, product, `Wrong CC ${id}`, 2)
  const rightChangeControl = await createChangeControlDocument(clients.user1, product, `Right CC ${id}`, 3)
  const { released, latest } = await createVersions(
    clients.user1,
    product,
    releasedChangeControl._id,
    wrongChangeControl._id
  )
  return {
    product,
    productName,
    released,
    latest,
    releasedChangeControl,
    wrongChangeControl,
    rightChangeControl
  }
}

/** A product whose change control is a card linked by a relation. */
export async function prepareCardChangeControl (clients: Clients): Promise<ChangeControlFixture> {
  const { user1, user2 } = clients
  const id = generateId(6)
  const typeName = `Change request ${id}`

  const cardType = await create(user2, ids.masterTag, ids.model, {
    extends: ids.card,
    label: `embedded:embedded:${typeName}`,
    kind: ClassifierKind.CLASS,
    icon: ids.cardIcon,
    background: 0
  })
  const association = await create(user2, ids.association, ids.model, {
    classA: ids.productVersion,
    classB: cardType,
    nameA: `Product version ${id}`,
    nameB: typeName,
    type: 'N:N'
  })

  const createCard = async (title: string): Promise<ChangeControlOption> => {
    const _id = await create(user2, cardType, ids.cardSpace, {
      title,
      parentInfo: [],
      blobs: {},
      rank: '',
      content: ''
    })
    return { _id, label: title }
  }
  const releasedChangeControl = await createCard(`Released CR ${id}`)
  const wrongChangeControl = await createCard(`Wrong CR ${id}`)
  const rightChangeControl = await createCard(`Right CR ${id}`)

  const productName = `CC cards ${id}`
  const product = await createProduct(clients, productName, association)
  const { released, latest } = await createVersions(user1, product, undefined, undefined)

  const link = async (version: Ref<Doc>, card: Ref<Doc>): Promise<void> => {
    await create(user1, ids.relation, ids.workspace, { association, docA: version, docB: card })
  }
  await link(released, releasedChangeControl._id)
  await link(latest, wrongChangeControl._id)

  return {
    product,
    productName,
    released,
    latest,
    releasedChangeControl,
    wrongChangeControl,
    rightChangeControl,
    association,
    relationName: typeName
  }
}

/** Cards linked to the version by the change control relation. */
export async function getChangeControlCards (
  client: WorkspaceRestClient,
  association: Ref<Doc>,
  version: Ref<Doc>
): Promise<Array<Ref<Doc>>> {
  const relations = await client.findAll<Doc & { docB: Ref<Doc> }>(ids.relation as any, {
    association,
    docA: version
  })
  return relations.map((it) => it.docB)
}

export async function getVersionChangeControl (
  client: WorkspaceRestClient,
  version: Ref<Doc>
): Promise<Ref<Doc> | undefined> {
  const doc = await client.findOne<Doc & { changeControl?: Ref<Doc> }>(ids.productVersion as any, { _id: version })
  return doc?.changeControl
}
