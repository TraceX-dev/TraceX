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

import { MeasureMetricsContext } from '@hcengineering/core'

jest.mock('../', () => ({
  __esModule: true,
  default: jest.fn(() => ({ getTxes: () => [{ _id: 'generated-model', modifiedOn: 1 }] }))
}))

beforeEach(() => {
  jest.resetModules()
  jest.spyOn(console, 'log').mockImplementation(() => {})
  jest.spyOn(console, 'info').mockImplementation(() => {})
})

afterEach(() => {
  jest.restoreAllMocks()
})

it('generates the model without loading an existing artifact or logging into JSON output', async () => {
  jest.doMock(
    '../../bundle/model.json',
    () => {
      throw new Error('Model artifact does not exist yet')
    },
    { virtual: true }
  )
  await import('../show')
  expect(console.log).toHaveBeenCalledTimes(1)
  expect(console.log).toHaveBeenCalledWith(JSON.stringify([{ _id: 'generated-model', modifiedOn: 1 }]))
  expect(console.info).not.toHaveBeenCalled()
})

it('logs the system transaction chain hash through the startup context', async () => {
  jest.doMock(
    '../../bundle/model.json',
    () => [
      { _id: 'bundled-model-1', modifiedOn: 1 },
      { _id: 'bundled-model-2', modifiedOn: 2 }
    ],
    { virtual: true }
  )
  const { logModelHash } = await import('../model')
  expect(console.info).not.toHaveBeenCalled()
  const ctx = new MeasureMetricsContext('test-model', {})
  const info = jest.spyOn(ctx, 'info').mockImplementation(() => {})
  logModelHash(ctx)
  expect(info).toHaveBeenCalledTimes(1)
  expect(info).toHaveBeenCalledWith('System model loaded', {
    hash: '5ec90729a5a9c5283d55ec875d5c4baa81e22b9d',
    transactions: 2
  })
  expect(console.log).not.toHaveBeenCalled()
})
