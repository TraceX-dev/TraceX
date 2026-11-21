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

// Lightweight ClientSession used by the concurrency tests: the real one pulls in request
// processing that these tests don't exercise. Workspace and TSessionManager stay real.
export function createFakeClientSession (token: any, workspace: any, account: any, info: any): any {
  return {
    token,
    workspace,
    account,
    info,
    createTime: Date.now(),
    requests: new Map(),
    binaryMode: false,
    useCompression: false,
    sessionId: '',
    sessionInstanceId: '',
    workspaceClosed: undefined,
    lastRequest: Date.now(),
    lastPing: Date.now(),
    total: { find: 0, tx: 0 },
    current: { find: 0, tx: 0 },
    mins5: { find: 0, tx: 0 },
    getUser: () => token.account,
    getRawAccount: () => account,
    getSocialIds: () => info.socialIds ?? [],
    getUserSocialIds: () => (info.socialIds ?? []).map((it: any) => it._id),
    updateLast (): void {
      this.lastRequest = Date.now()
    },
    broadcast: jest.fn()
  }
}
