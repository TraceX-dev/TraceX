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

import { reportTelemetryFailure } from '../context-utils'

beforeEach(() => {
  jest.useFakeTimers({ now: 0 })
})
afterEach(() => {
  jest.useRealTimers()
  jest.restoreAllMocks()
})

it('reports a burst of telemetry failures once and resumes after 30 seconds', () => {
  const log = jest.spyOn(console, 'error').mockImplementation(() => {})
  const failure = new Error('telemetry failure')
  reportTelemetryFailure(failure)
  for (let i = 0; i < 100; i++) reportTelemetryFailure(failure)
  expect(log).toHaveBeenCalledTimes(1)
  jest.advanceTimersByTime(29999)
  reportTelemetryFailure(failure)
  expect(log).toHaveBeenCalledTimes(1)
  jest.advanceTimersByTime(1)
  reportTelemetryFailure(failure)
  expect(log).toHaveBeenCalledTimes(2)
  expect(log).toHaveBeenCalledWith('Failed to record telemetry', failure)
})

it('contains failures in the diagnostic console too', () => {
  const log = jest.spyOn(console, 'error').mockImplementation(() => {
    throw new Error('console failure')
  })
  expect(() => {
    reportTelemetryFailure(new Error('telemetry failure'))
  }).not.toThrow()
  expect(log).toHaveBeenCalledTimes(1)
})
