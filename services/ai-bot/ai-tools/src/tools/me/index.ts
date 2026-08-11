//
// Copyright © 2026 TraceX SAS.
//
// Licensed under the PolyForm Shield License 1.0.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://polyformproject.org/licenses/shield/1.0.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//
// See the License for the specific language governing permissions and
// limitations under the License.
//

import { meAccountTool } from './me.account'
import { meInboxTool } from './me.inbox'
import { meInboxReadAllTool } from './me.inbox_read_all'
import { meWorkspaceTool } from './me.workspace'

export { meAccountTool } from './me.account'
export { meInboxTool } from './me.inbox'
export { meInboxReadAllTool } from './me.inbox_read_all'
export { meWorkspaceTool } from './me.workspace'
export * from './tool-ids'

export const meTools = [meAccountTool, meInboxTool, meInboxReadAllTool, meWorkspaceTool]
