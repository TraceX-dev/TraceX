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

import type { MasterTag } from '@hcengineering/card'
import core, { type Doc, type Ref } from '@hcengineering/core'
import { getEmbeddedLabel } from '@hcengineering/platform'
import { getClient } from '@hcengineering/presentation'
import { compileProcessYaml, type Process } from '@hcengineering/process'
import { denormalizeIds, exportProcess, exportProcessDraft, exportProcessSource, updateProcessYaml } from '../exporter'

jest.mock('@hcengineering/presentation', () => ({ getClient: jest.fn() }))

const source = `version: 2
kind: process
processes:
  update_status:
    label: Update status
    slots:
      status: {label: Status, type: string}
    start:
      begin:
        to: done
        on: OnExecutionStart
        actions:
          mark_done:
            method: UpdateCard
            params: {$slots.status: Done}
    states:
      done: {}
`

function setup (): {
  proc: Process
  docs: Doc[]
  createDoc: jest.Mock
  updateDoc: jest.Mock
  removeDoc: jest.Mock
  commit: jest.Mock
} {
  const docs = denormalizeIds(compileProcessYaml(source).docs as unknown as Doc[], 'risk-type' as Ref<MasterTag>, {
    status: 's'
  })
  const proc = docs.find((doc) => doc._class === 'process:class:Process') as Process
  const registry = [
    { _id: 'process:method:UpdateCard', _class: 'process:class:Method', objectClass: 'card:class:Card' },
    { _id: 'process:trigger:OnExecutionStart', _class: 'process:class:Trigger' }
  ]
  proc.rank = 'original-rank'
  proc.automationOnly = true
  const createDoc = jest.fn().mockResolvedValue(undefined)
  const updateDoc = jest.fn().mockResolvedValue(undefined)
  const removeDoc = jest.fn().mockResolvedValue(undefined)
  const commit = jest.fn().mockResolvedValue({ result: true })
  ;(getClient as jest.Mock).mockReturnValue({
    getHierarchy: () => ({
      findAttribute: (_class: string, name: string) =>
        name === 's'
          ? {
              name,
              _class: core.class.Attribute,
              attributeOf: proc.masterTag,
              label: getEmbeddedLabel('Status'),
              type: { _class: core.class.TypeString, label: core.string.String }
            }
          : undefined,
      isDerived: () => false
    }),
    getModel: () => ({
      findObject: (id: string) => docs.find((doc) => doc._id === id) ?? registry.find((doc) => doc._id === id),
      findAllSync: (_class: string, query: Record<string, unknown>) =>
        [...docs, ...registry].filter(
          (doc) =>
            doc._class === _class &&
            Object.entries(query).every(([key, value]) => (doc as unknown as Record<string, unknown>)[key] === value)
        )
    }),
    apply: () => ({ createDoc, updateDoc, removeDoc, commit })
  })
  return { proc, docs, createDoc, updateDoc, removeDoc, commit }
}

describe('YAML export and saving an existing process', () => {
  it('exports short stored field keys into typed slots and prefills their bindings', () => {
    const { proc } = setup()
    const draft = exportProcessDraft(proc)
    expect(draft.bindings).toEqual({ slot_status: 's' })
    const compiled = compileProcessYaml(draft.source)
    expect(compiled.docs.find((doc) => doc.from === null)?.actions).toEqual([
      expect.objectContaining({ params: { __SLOT_slot_status__: 'Done' } })
    ])
    expect(exportProcessSource(proc, 'yaml')).toBe(draft.source)
  })

  it.each([true, false])('keeps JSON serialization unchanged with slots=%p', (withSlots) => {
    const { proc } = setup()
    expect(JSON.parse(exportProcessSource(proc, 'json', withSlots))).toEqual(exportProcess(proc, withSlots).docs)
  })

  it('replaces the old graph while retaining process identity, destination fields and rank', async () => {
    const { proc, docs, createDoc, updateDoc, removeDoc, commit } = setup()
    await updateProcessYaml(proc, source.replace('Update status', 'Changed status').replace('Done}', 'Reviewed}'), {
      status: 's'
    })
    expect(removeDoc).toHaveBeenCalledTimes(2)
    for (const doc of docs.filter((doc) => doc._id !== proc._id)) {
      expect(removeDoc).toHaveBeenCalledWith(doc._class, doc.space, doc._id)
    }
    expect(updateDoc).toHaveBeenCalledWith(
      proc._class,
      proc.space,
      proc._id,
      expect.objectContaining({
        name: 'Changed status',
        masterTag: proc.masterTag,
        rank: 'original-rank',
        bindings: { status: 's' },
        $unset: { automationOnly: true, requiredSlots: true }
      })
    )
    expect(createDoc).toHaveBeenCalledTimes(2)
    expect(createDoc.mock.calls.find((call) => call[0] === 'process:class:Transition')?.[2]).toEqual(
      expect.objectContaining({ process: proc._id, actions: [expect.objectContaining({ params: { s: 'Reviewed' } })] })
    )
    expect(commit).toHaveBeenCalledWith(true)
  })

  it.each([
    ['invalid syntax', 'version: [', { status: 's' }],
    ['missing binding', source, {}],
    ['wrong destination field', source, { status: 'missing' }],
    ['wrong kind', 'version: 2\nkind: card\ncardTypes: {empty: {label: Empty, extends: card:class:Card, kind: 0}}', {}]
  ])('rejects %s before any write', async (_, draft, bindings) => {
    const { proc, createDoc, updateDoc, removeDoc, commit } = setup()
    await expect(updateProcessYaml(proc, draft, bindings as Record<string, string>)).rejects.toThrow()
    expect(createDoc).not.toHaveBeenCalled()
    expect(updateDoc).not.toHaveBeenCalled()
    expect(removeDoc).not.toHaveBeenCalled()
    expect(commit).not.toHaveBeenCalled()
  })

  it('reports a failed apply operation', async () => {
    const { proc, commit } = setup()
    commit.mockResolvedValue({ result: false })
    await expect(updateProcessYaml(proc, source, { status: 's' })).rejects.toThrow('Saving the process failed')
  })

  it('preserves marker-like text while saving into the current process', async () => {
    const { proc, updateDoc, createDoc } = setup()
    const literal = '__PROCESS__ __SLOT_status__ __STATE_0__'
    await updateProcessYaml(
      proc,
      source.replace('Update status', literal).replace('status: Done', `status: ${literal}`),
      { status: 's' }
    )
    expect(updateDoc.mock.calls[0][3].name).toBe(literal)
    expect(createDoc.mock.calls.find((call) => call[0] === 'process:class:Transition')?.[2].actions[0].params.s).toBe(
      literal
    )
  })
})
