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

/** Creation identity of a Yjs XML element, scoped to its original Y.Doc. */
export interface Handle {
  client: number
  clock: number
}

export class InvalidHandleError extends Error {
  constructor (handle: string | Handle) {
    const value = typeof handle === 'string' ? handle : JSON.stringify(handle)
    super(`Malformed handle ${value}`)
    this.name = 'InvalidHandleError'
  }
}

const HANDLE_PATTERN = /^[0-9a-z]+\.[0-9a-z]+$/

export function assertHandle (handle: Handle): void {
  if (!Number.isSafeInteger(handle.client) || !Number.isSafeInteger(handle.clock)) {
    throw new InvalidHandleError(handle)
  }
}

/** Encode a client.clock pair in lowercase base36. */
export function encodeHandle (handle: Handle): string {
  assertHandle(handle)
  return `${handle.client.toString(36)}.${handle.clock.toString(36)}`
}

/** Decode a lowercase base36 client.clock pair. */
export function decodeHandle (value: string): Handle {
  if (!HANDLE_PATTERN.test(value)) {
    throw new InvalidHandleError(value)
  }
  const [client, clock] = value.split('.')
  const handle: Handle = { client: Number.parseInt(client, 36), clock: Number.parseInt(clock, 36) }
  assertHandle(handle)
  return handle
}
