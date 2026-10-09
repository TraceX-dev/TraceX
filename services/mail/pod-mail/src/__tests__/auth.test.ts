/**

Copyright © 2026 TraceX SAS.

Licensed under the PolyForm Shield License 1.0.0 (the "License");
you may not use this file except in compliance with the License. You may
obtain a copy of the License at https://polyformproject.org/licenses/shield/1.0.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { Request, Response } from 'express'
import { requireAuth } from '../auth'

function run (token: string | undefined, req: Partial<Request>): { status?: number, next: boolean } {
  const result: { status?: number, next: boolean } = { next: false }
  const res = {
    status: jest.fn().mockImplementation((s: number) => {
      result.status = s
      return res
    }),
    send: jest.fn()
  } as unknown as Response
  requireAuth(token)({ headers: {}, body: {}, ...req } as unknown as Request, res, () => {
    result.next = true
  })
  return result
}

describe('requireAuth', () => {
  it('rejects every request when no token is configured', () => {
    expect(run(undefined, {})).toEqual({ status: 401, next: false })
    expect(run('', { headers: { authorization: 'Bearer ' } })).toEqual({ status: 401, next: false })
  })

  it('rejects requests without credentials', () => {
    expect(run('secret', {})).toEqual({ status: 401, next: false })
  })

  it('rejects wrong token', () => {
    expect(run('secret', { headers: { authorization: 'Bearer nope' } })).toEqual({ status: 401, next: false })
    expect(run('secret', { body: { apiKey: 'nope' } })).toEqual({ status: 401, next: false })
  })

  it('accepts Bearer token', () => {
    expect(run('secret', { headers: { authorization: 'Bearer secret' } }).next).toBe(true)
  })

  it('accepts legacy apiKey in body', () => {
    expect(run('secret', { body: { apiKey: 'secret' } }).next).toBe(true)
  })
})
