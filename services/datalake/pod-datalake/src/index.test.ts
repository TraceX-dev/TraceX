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

jest.mock('./main', () => ({ main: jest.fn() }))
jest.mock('dotenv', () => ({ config: jest.fn() }))

describe('datalake entry point', () => {
  beforeEach(() => {
    jest.resetModules()
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('logs startup failure before exiting with code 1', async () => {
    const { main } = await import('./main')
    const error = new Error('Failed to initialize S3 bucket "blobs" at "http://minio:9000" (HTTP status: 503)')
    jest.mocked(main).mockRejectedValueOnce(error)
    const log = jest.spyOn(console, 'error').mockImplementation(() => {})
    const exit = jest.spyOn(process, 'exit').mockReturnValue(undefined as never)

    await import('./index')

    expect(log).toHaveBeenCalledWith('Failed to start datalake:', error)
    expect(exit).toHaveBeenCalledWith(1)
    expect(log.mock.invocationCallOrder[0]).toBeLessThan(exit.mock.invocationCallOrder[0])
  })

  it('does not exit after successful startup', async () => {
    const { main } = await import('./main')
    jest.mocked(main).mockResolvedValueOnce(undefined)
    const exit = jest.spyOn(process, 'exit').mockReturnValue(undefined as never)

    await import('./index')

    expect(exit).not.toHaveBeenCalled()
  })
})
