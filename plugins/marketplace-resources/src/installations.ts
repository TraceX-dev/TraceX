// Copyright © 2026 TraceX SAS.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import core, {
  generateId,
  type ApplyOperations,
  type AttachedDoc,
  type Doc,
  type Ref,
  type Sequence
} from '@hcengineering/core'
import marketplace, {
  prepareDefinitionPackageInstallation,
  prepareDefinitionPackageUpdate,
  parseDefinitionPackageRelease,
  type DefinitionPackageDestination,
  type DefinitionPackageInstallation,
  type DefinitionPackageOwner,
  type DefinitionPackageRelease,
  type PreparedDefinitionPackageUpdate
} from '@hcengineering/marketplace'
import { getClient } from '@hcengineering/presentation'
import process, { authoringDataEqual } from '@hcengineering/process'
import card from '@hcengineering/card'

function definitionData (doc: Doc): Record<string, unknown> {
  const { _id, _class, space, createdOn, createdBy, modifiedOn, modifiedBy, ...data } = doc
  return data
}

async function createDefinition (apply: ApplyOperations, doc: Doc): Promise<void> {
  const { _id, _class, space, createdOn, createdBy, modifiedOn, modifiedBy, ...data } = doc
  if (getClient().getHierarchy().isDerived(_class, core.class.AttachedDoc)) {
    const { attachedTo, attachedToClass, collection, ...values } = data as unknown as AttachedDoc
    await apply.addCollection(_class, space, attachedTo, attachedToClass, collection, values, _id as Ref<AttachedDoc>)
  } else await apply.createDoc(_class, space, data, _id)
}

/** Applies the complete validated definition set and its installation record in one workspace batch. */
export async function installDefinitionPackage (
  release: DefinitionPackageRelease,
  destinations: Record<string, DefinitionPackageDestination>
): Promise<Ref<DefinitionPackageInstallation>> {
  const client = getClient()
  const id = generateId<DefinitionPackageInstallation>()
  const prepared = await prepareDefinitionPackageInstallation(
    release,
    destinations,
    id,
    client.getModel(),
    client.getHierarchy()
  )
  const apply = client.apply('Install definition package')
  for (const doc of prepared.documents) {
    apply.notMatch(doc._class, { _id: doc._id })
    await createDefinition(apply, doc)
  }
  await apply.createDoc(
    marketplace.class.DefinitionPackageInstallation,
    core.space.Configuration,
    prepared.installation,
    id
  )
  if (!(await apply.commit(true)).result) throw new Error('Installing the package failed')
  return id
}

/** Loads identifier counters outside ModelDb before comparing the installed package. */
export async function reviewDefinitionPackageUpdate (
  installation: DefinitionPackageInstallation,
  incoming: DefinitionPackageRelease,
  destinations: Record<string, DefinitionPackageDestination>,
  resolutions: Readonly<Record<string, 'local' | 'upstream'>>
): Promise<PreparedDefinitionPackageUpdate> {
  const client = getClient()
  const baseline = await parseDefinitionPackageRelease(installation.release)
  const ids = baseline.definition.docs
    .filter((doc) => doc._class === core.class.Sequence || doc._class === core.class.CustomSequence)
    .map((doc) => installation.identities[doc._id] as Ref<Sequence>)
  const sequences = ids.length === 0 ? [] : await client.findAll(core.class.Sequence, { _id: { $in: ids } })
  return await prepareDefinitionPackageUpdate(
    installation,
    incoming,
    destinations,
    resolutions,
    client.getModel(),
    client.getHierarchy(),
    sequences
  )
}

/** Rechecks the reviewed model snapshot and applies an update with workspace transaction conditions. */
export async function updateDefinitionPackage (
  installation: DefinitionPackageInstallation,
  incoming: DefinitionPackageRelease,
  destinations: Record<string, DefinitionPackageDestination>,
  resolutions: Readonly<Record<string, 'local' | 'upstream'>>,
  fingerprint: string
): Promise<void> {
  const client = getClient()
  const current = await client.findOne(marketplace.class.DefinitionPackageInstallation, { _id: installation._id })
  if (current === undefined || current.release !== installation.release) {
    throw new Error('The installed package changed; reopen the update')
  }
  const prepared = await reviewDefinitionPackageUpdate(current, incoming, destinations, resolutions)
  if (prepared.blocked) throw new Error('Resolve package conflicts and unsupported changes before updating')
  if (prepared.fingerprint !== fingerprint) throw new Error('Local definitions changed; review the update again')
  const apply = client.apply('Update definition package')
  apply.match(current._class, { _id: current._id, modifiedOn: current.modifiedOn })
  for (const doc of prepared.current) {
    apply.match(doc._class, { _id: doc._id, modifiedOn: doc.modifiedOn })
    if (doc._class === process.class.Process) {
      for (const clazz of [process.class.State, process.class.Transition]) {
        apply.notMatch<Doc>(clazz, { process: doc._id, _id: { $nin: prepared.current.map((item) => item._id) } })
      }
    }
    if (doc._class === card.class.MasterTag || doc._class === card.class.Tag) {
      apply.notMatch<Doc>(core.class.Attribute, {
        attributeOf: doc._id,
        _id: { $nin: prepared.current.map((item) => item._id) }
      })
    }
  }
  for (const doc of prepared.removed) await apply.removeDoc(doc._class, doc.space, doc._id)
  for (const doc of prepared.documents) {
    const existing =
      prepared.current.find((current) => current._id === doc._id) ?? client.getModel().findObject(doc._id)
    if (existing === undefined) {
      apply.notMatch(doc._class, { _id: doc._id })
      await createDefinition(apply, doc)
      continue
    }
    const values = definitionData(doc)
    if (authoringDataEqual(values, definitionData(existing))) continue
    const unset = Object.fromEntries(
      Object.keys(existing)
        .filter(
          (key) =>
            !['_id', '_class', 'space', 'createdOn', 'createdBy', 'modifiedOn', 'modifiedBy'].includes(key) &&
            !(key in values)
        )
        .map((key) => [key, true])
    )
    await apply.updateDoc(doc._class, doc.space, doc._id, { ...values, $unset: unset })
  }
  await apply.updateDoc(
    marketplace.class.DefinitionPackageInstallation,
    current.space,
    current._id,
    prepared.installation
  )
  if (!(await apply.commit(true)).result) throw new Error('Updating the package failed; refresh and review again')
}

/** Detaches package ownership metadata while retaining every installed definition and its runtime data. */
export async function disconnectDefinitionPackage (installation: DefinitionPackageInstallation): Promise<void> {
  const client = getClient()
  const apply = client.apply('Disconnect definition package')
  for (const localId of Object.values(installation.identities)) {
    const id = localId as Ref<Doc>
    const doc = client.getModel().findObject<DefinitionPackageOwner>(id)
    if (doc?.definitionPackageInstallation?.id !== installation._id) continue
    await apply.updateDoc<DefinitionPackageOwner>(doc._class, doc.space, doc._id, {
      $unset: {
        definitionPackageInstallation: true,
        ...(doc.definitionPackage?.id === installation.package.id ? { definitionPackage: true } : {})
      }
    })
  }
  await apply.removeDoc(installation._class, installation.space, installation._id)
  if (!(await apply.commit(true)).result) throw new Error('Disconnecting the package failed')
}
