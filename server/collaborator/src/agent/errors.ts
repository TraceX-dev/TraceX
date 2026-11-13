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

/** A request failure known to the REST layer; never instructs the client to retry a write. */
export class AgentApiFailure extends Error {
  constructor (
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message)
    this.name = 'AgentApiFailure'
  }
}
