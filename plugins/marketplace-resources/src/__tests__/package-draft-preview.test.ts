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

import { createDefinitionPackageRelease } from '@hcengineering/marketplace'
import { createPackageDraftPreview, draftCodeMarkup, draftProcessDiagram } from '../package-draft-preview'

const source = `version: 2
kind: card
cardTypes:
  purchase:
    label: Purchase
    extends: card:class:Card
    fields:
      amount: { name: amount, label: Amount, type: number, defaultValue: 0 }
  supplier:
    label: Supplier
    extends: card:class:Card
    fields:
      supplier_name: { name: name, label: Name, type: string }
processes:
  review:
    label: Review
    masterTag: purchase
    start:
      begin:
        to: waiting
        on: OnExecutionStart
    states:
      waiting:
        label: Waiting
        transitions:
          first:
            to: approved
            on: OnExecutionStart
          second:
            to: rejected
            on: OnExecutionStart
      approved:
        label: 'Same "label" <tag> #34;'
      rejected:
        label: 'Same "label" <tag> #34;'
  delivery:
    label: Delivery
    masterTag: supplier
    states:
      delivered: {}
`

describe('package draft preview', () => {
  it('keeps card fields and process graphs with their owners, preserving authored branch priority', async () => {
    const release = await createDefinitionPackageRelease({ package: { id: 'test/review', version: '1.0.0' }, source })
    release.definition.docs.reverse()
    const preview = createPackageDraftPreview(release)
    expect(preview.cards.find((item) => item.definition._id === 'purchase')?.fields.map((field) => field.name)).toEqual(
      ['amount']
    )
    expect(preview.cards.find((item) => item.definition._id === 'purchase')?.fields[0].defaultValue).toBe(0)
    expect(preview.cards.find((item) => item.definition._id === 'supplier')?.fields.map((field) => field.name)).toEqual(
      ['name']
    )
    const review = preview.processes.find((item) => item.definition._id === 'review')
    expect(review?.transitions.map((transition) => transition._id)).toEqual(['begin', 'first', 'second'])
    expect(review?.states.map((state) => state._id)).toEqual(['waiting', 'approved', 'rejected'])
    expect(
      preview.processes.find((item) => item.definition._id === 'delivery')?.states.map((state) => state._id)
    ).toEqual(['delivered'])
  })

  it('uses separate graph identities for equal state names and escapes label syntax', async () => {
    const release = await createDefinitionPackageRelease({ package: { id: 'test/review', version: '1.0.0' }, source })
    const preview = createPackageDraftPreview(release).processes[0]
    const diagram = draftProcessDiagram(preview)
    expect(diagram).toContain('start -->|1| state0')
    expect(diagram).toContain('state0 -->|2| state1')
    expect(diagram).toContain('state0 -->|3| state2')
    expect(diagram).toContain('state1(["Same #34;label#34; #60;tag#62; #35;34;"])')
    expect(diagram).toContain('state2(["Same #34;label#34; #60;tag#62; #35;34;"])')
    expect(diagram).not.toContain('<tag>')
  })

  it('preserves the exact downloadable source as selectable code, including markup-like text', () => {
    const text = 'description: "<script>alert(1)</script>"\n'
    expect(JSON.parse(draftCodeMarkup(text, 'yaml'))).toMatchObject({
      type: 'doc',
      content: [{ type: 'codeBlock', attrs: { language: 'yaml' }, content: [{ type: 'text', text }] }]
    })
  })
})
