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

import core, {
  type Class,
  type Data,
  type Doc,
  type DocumentQuery,
  type Hierarchy,
  type Ref,
  type TxOperations
} from '@hcengineering/core'
import print, { defaultPrintConfiguration, type PrintConfiguration, type PrintConfig } from '@hcengineering/print'
import { ensurePrintConfigurations } from './configuration'

it.each([false, true])(
  'creates two defaults once and preserves edits and disabled records (legacy=%s)',
  async (withLegacy) => {
    const cardId = 'test:class:Card' as Ref<Class<Doc>>
    const documentId = 'test:class:ControlledDocument' as Ref<Class<Doc>>
    const card: Partial<Class<Doc>> = { _id: cardId }
    const document: Partial<Class<Doc>> = { _id: documentId }
    const cardDefaults: Partial<PrintConfig> = { defaultConfiguration: { ...defaultPrintConfiguration, footer: '' } }
    const documentDefaults: Partial<PrintConfig> = { defaultConfiguration: defaultPrintConfiguration }
    const definitions = new Map([
      [cardId, cardDefaults],
      [documentId, documentDefaults]
    ])
    const legacy: Partial<PrintConfiguration> = {
      _id: print.ids.PrintConfiguration,
      _class: print.class.PrintConfiguration,
      space: core.space.Workspace,
      header: 'Custom title',
      footer: 'Custom disclaimer',
      printLogo: false
    }
    const records = new Map<Ref<PrintConfiguration>, Partial<PrintConfiguration>>()
    if (withLegacy) records.set(print.ids.PrintConfiguration, legacy)
    const hierarchy: Partial<Hierarchy> = {
      hasMixin: jest.fn().mockReturnValue(true),
      as: jest.fn().mockImplementation((target: Class<Doc>) => definitions.get(target._id))
    }
    const tx: Pick<TxOperations, 'findOne' | 'findAll' | 'getHierarchy' | 'createDoc' | 'updateDoc'> = {
      getHierarchy: jest.fn().mockReturnValue(hierarchy),
      findAll: jest.fn().mockResolvedValue([card, document]),
      findOne: jest
        .fn()
        .mockImplementation(async (_class: unknown, query: DocumentQuery<PrintConfiguration>) =>
          Array.from(records.values()).find((record) =>
            query._id !== undefined ? record._id === query._id : record.targetClass === query.targetClass
          )
        ),
      createDoc: jest
        .fn()
        .mockImplementation(
          async (_class: unknown, _space: unknown, data: Data<PrintConfiguration>, id: Ref<PrintConfiguration>) => {
            records.set(id, { ...data, _id: id })
            return id
          }
        ),
      updateDoc: jest
        .fn()
        .mockImplementation(
          async (_class: unknown, _space: unknown, id: Ref<PrintConfiguration>, data: Partial<PrintConfiguration>) => {
            records.set(id, { ...records.get(id), ...data })
          }
        )
    }

    await ensurePrintConfigurations(tx, documentId)
    expect(records.size).toBe(2)
    const migrated = Array.from(records.values()).find((record) => record.targetClass === documentId)
    expect(migrated).toMatchObject({
      targetClass: documentId,
      enabled: true,
      header: withLegacy ? 'Custom title' : defaultPrintConfiguration.header,
      footer: withLegacy ? 'Custom disclaimer' : defaultPrintConfiguration.footer,
      printLogo: !withLegacy
    })
    const initializedCard = Array.from(records.values()).find((record) => record.targetClass === cardId)
    expect(initializedCard).toMatchObject({ enabled: true, header: defaultPrintConfiguration.header, footer: '' })
    if (initializedCard === undefined) throw new Error('Card defaults not created')
    initializedCard.enabled = false
    await ensurePrintConfigurations(tx, documentId)
    expect(tx.createDoc).toHaveBeenCalledTimes(withLegacy ? 1 : 2)
    expect(initializedCard.enabled).toBe(false)
  }
)
