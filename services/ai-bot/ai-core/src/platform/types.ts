//
// Copyright © 2026 TraceX.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//

import { type CollaboratorClient } from '@hcengineering/collaborator-client'
import { type Hierarchy, type ModelDb, type TxOperations, type WorkspaceUuid } from '@hcengineering/core'
import { type StorageAdapter } from '@hcengineering/server-core'
import { type Token } from '@hcengineering/server-token'

import { type ToolExecutorContext } from '../tools'

export interface PlatformContext extends ToolExecutorContext {
  token: Token
  rawToken: string
  workspace: WorkspaceUuid
  client: TxOperations
  hierarchy: Hierarchy
  model: ModelDb
  storage: StorageAdapter
  collaborator: CollaboratorClient
}
