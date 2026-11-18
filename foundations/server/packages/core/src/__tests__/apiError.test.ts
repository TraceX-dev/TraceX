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

import { ApiError, classifyApiError } from '../apiError'

test('uses a default message per status and treats 401/403 as denials', () => {
  expect(new ApiError(404).message).toBe('Not Found')
  expect(new ApiError(503).message).toBe('Service temporary unavailable')
  expect(new ApiError(418).message).toBe('Error')
  expect(new ApiError(403).denied).toBe(true)
  expect(new ApiError(404).denied).toBe(false)
  expect(new ApiError(404, 'x', { denied: true }).denied).toBe(true)
  const cause = new RangeError('inner')
  expect(new ApiError(500, 'Export failed', { cause }).cause).toBe(cause)
})

test('classifies failures from the exception without leaking error messages', () => {
  expect(classifyApiError(new ApiError(403, 'secret detail'))).toEqual({ outcome: 'denied', errorCode: '403' })
  expect(classifyApiError(new ApiError(401, 'x', { reason: 'not_workspace_owner' }))).toEqual({
    outcome: 'denied',
    errorCode: 'not_workspace_owner'
  })
  expect(classifyApiError(new ApiError(404, 'x', { reason: 'target_not_accessible', denied: true }))).toEqual({
    outcome: 'denied',
    errorCode: 'target_not_accessible'
  })
  expect(classifyApiError(new ApiError(404, 'Document not found'))).toEqual({ outcome: 'failed', errorCode: '404' })
  expect(classifyApiError(new ApiError(500, 'Export failed', { cause: new RangeError('/tmp/x') }))).toEqual({
    outcome: 'failed',
    errorCode: 'RangeError'
  })
  expect(classifyApiError(new TypeError('boom /etc/passwd'))).toEqual({ outcome: 'failed', errorCode: 'TypeError' })
  expect(classifyApiError('weird')).toEqual({ outcome: 'failed', errorCode: 'UnknownError' })
})

test('malformed requests are not audited, but a 400 with a domain reason is', () => {
  expect(classifyApiError(new ApiError(400, 'Missing required parameters'))).toBeUndefined()
  expect(classifyApiError(new ApiError(400, 'No documents found to export', { reason: 'no_documents' }))).toEqual({
    outcome: 'failed',
    errorCode: 'no_documents'
  })
})
