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

import core from '@hcengineering/core'
import type { Doc, ModelDb, Ref } from '@hcengineering/core'
import card from '@hcengineering/card'
import { getClient } from '@hcengineering/presentation'
import { createContext, parseDSLContext } from '@hcengineering/process'
import { getRequiredSlots, importProcess, matchesSlotType } from '../exporter'

jest.mock('@hcengineering/presentation', () => ({ getClient: jest.fn() }))
// eslint-disable-next-line @typescript-eslint/naming-convention -- Standard CommonJS runtime global.
declare const __dirname: string

const source = `version: 2
kind: process
processes:
  simple:
    label: Simple update
    slots:
      status:
        type: string
    start:
      begin:
        to: done
        on: OnExecutionStart
        actions:
          mark_done:
            method: UpdateCard
            params:
              $slots.status: Done
    states:
      done: {}
`

function setup (): { createDoc: jest.Mock, commit: jest.Mock } {
  const createDoc = jest.fn().mockResolvedValue(undefined)
  const commit = jest.fn().mockResolvedValue({ result: true })
  const registry = [
    { _id: 'process:method:UpdateCard', _class: 'process:class:Method', objectClass: 'card:class:Card' },
    {
      _id: 'process:method:CreateToDo',
      _class: 'process:class:Method',
      createdContext: { _class: 'process:class:ProcessToDo', nameField: 'title' }
    },
    { _id: 'process:trigger:OnExecutionStart', _class: 'process:class:Trigger' },
    { _id: 'process:trigger:OnToDoClose', _class: 'process:class:Trigger' }
  ]
  ;(getClient as jest.Mock).mockReturnValue({
    getHierarchy: () => ({
      findAttribute: (_class: string, name: string) =>
        name === 'customStatus' ? { type: { _class: core.class.TypeString } } : undefined
    }),
    getModel: () => ({ findObject: (id: string) => registry.find((doc) => doc._id === id) }),
    apply: () => ({ createDoc, commit })
  })
  return { createDoc, commit }
}

describe('YAML process import', () => {
  it('preserves literal text that resembles portable ids', async () => {
    const { createDoc } = setup()
    const literal = 'Value __PROCESS__ __STATE_0__ __SLOT_status__'
    await importProcess(
      card.class.Card,
      source.replace('label: Simple update', `label: ${literal}`).replace('status: Done', `status: ${literal}`),
      { status: 'customStatus' }
    )
    expect(createDoc.mock.calls.find((call) => call[0] === 'process:class:Process')?.[2].name).toBe(literal)
    expect(
      createDoc.mock.calls.find((call) => call[0] === 'process:class:Transition')?.[2].actions[0].params.customStatus
    ).toBe(literal)
  })

  it('reports a rejected import commit', async () => {
    const { commit } = setup()
    commit.mockResolvedValue({ result: false })
    const log = jest.spyOn(console, 'error').mockImplementation(() => {})
    try {
      await expect(importProcess(card.class.Card, source, { status: 'customStatus' })).rejects.toThrow(
        'Importing the process failed'
      )
    } finally {
      log.mockRestore()
    }
  })

  it('binds task recipients and keeps produced and consumed task contexts consistent', async () => {
    const { createDoc, commit } = setup()
    const client = (getClient as jest.Mock)()
    client.getHierarchy = () => ({
      findAttribute: (_class: string, name: string) =>
        name === 'r'
          ? {
              type: { _class: core.class.ArrOf, of: { _class: core.class.RefTo, to: 'contact:mixin:Employee' } }
            }
          : name === 'customStatus'
            ? { type: { _class: core.class.TypeString } }
            : undefined
    })
    const { readFileSync } = jest.requireActual<{ readFileSync: (path: string, encoding: 'utf8') => string }>('fs')
    const review = readFileSync(`${__dirname}/../../../process/docs/examples/review-task.process.yaml`, 'utf8')
    const title = 'Review __PROCESS__ __CONTEXT_0__ __ACTION_0__'
    await importProcess(card.class.Card, review.replace('title: Review card', `title: ${title}`), {
      reviewers: 'r',
      status: 'customStatus'
    })
    const definition = createDoc.mock.calls.find((call) => call[0] === 'process:class:Process')?.[2]
    const start = createDoc.mock.calls.find((call) => call[0] === 'process:class:Transition' && call[2].from === null)
    const task = start?.[2].actions[1]
    expect(task.params.title).toBe(title)
    expect(task.params.user).toBe(createContext({ type: 'attribute', key: 'r' }))
    const published = definition.context[task.context._id]
    expect(published).toEqual(expect.objectContaining({ action: task._id, producer: start?.[3], name: title }))
    const consumer = createDoc.mock.calls.find((call) => call[2].trigger === 'process:trigger:OnToDoClose')
    expect(parseDSLContext(consumer?.[2].triggerParams._id)).toEqual({ type: 'context', id: task.context._id, key: '' })
    expect(commit).toHaveBeenCalledWith(true)
  })

  it('exposes slots through the existing binding workflow', () => {
    expect(getRequiredSlots(source)).toEqual(
      expect.objectContaining({ status: expect.objectContaining({ slotKind: 'attribute' }) })
    )
    expect(() => getRequiredSlots(source.replace('type: string', 'type: unsupported'))).toThrow('Unknown scalar type')
  })

  it('imports native documents with bound stored field keys', async () => {
    const { createDoc, commit } = setup()
    await importProcess(card.class.Card, source, { status: 'customStatus' })
    expect(createDoc).toHaveBeenCalledTimes(3)
    const transition = createDoc.mock.calls.find((call) => call[0] === 'process:class:Transition')
    expect(transition?.[2].actions[0].params).toEqual({ customStatus: 'Done' })
    expect(JSON.stringify(createDoc.mock.calls)).not.toContain('__SLOT_')
    expect(commit).toHaveBeenCalledWith(true)
  })

  it.each<Record<string, string>>([{}, { status: 'unknown' }])(
    'rejects invalid bindings %p before writing',
    async (bindings) => {
      const { createDoc, commit } = setup()
      const log = jest.spyOn(console, 'error').mockImplementation(() => {})
      try {
        await expect(importProcess(card.class.Card, source, bindings)).rejects.toThrow('slots.status')
        expect(createDoc).not.toHaveBeenCalled()
        expect(commit).not.toHaveBeenCalled()
      } finally {
        log.mockRestore()
      }
    }
  )

  it('matches choice values across different workspace enum identifiers', () => {
    const model = {
      findObject: (id: Ref<Doc>) => (id === 'localEnum' ? { enumValues: ['1', '2', '3', '4', '5'] } : undefined)
    } as unknown as ModelDb
    const expected = { _class: core.class.EnumOf, label: core.string.Enum, of: 'templateEnum' }
    const actual = { _class: core.class.EnumOf, label: core.string.Enum, of: 'localEnum' }
    expect(matchesSlotType(expected, actual, ['1', '2', '3', '4', '5'], model)).toBe(true)
    expect(matchesSlotType(expected, actual, ['6'], model)).toBe(false)
  })

  it('allows explicitly declared slots to share a destination field', async () => {
    const { createDoc } = setup()
    const log = jest.spyOn(console, 'error').mockImplementation(() => {})
    const aliased = source.replace('    start:', '      duplicate:\n        type: string\n    start:')
    try {
      await importProcess(card.class.Card, aliased, { status: 'customStatus', duplicate: 'customStatus' })
      expect(createDoc).toHaveBeenCalledTimes(3)
      expect(createDoc.mock.calls.find((call) => call[0] === 'process:class:Transition')?.[2].actions[0].params).toEqual({
        customStatus: 'Done'
      })
    } finally {
      log.mockRestore()
    }
  })
})
