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

/// <reference types="node" />

import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

it('validates the collab wire contracts and descriptions with real TypeBox and editor context', () => {
  const result = spawnSync(process.execPath, [join(__dirname, 'contracts-probe.mjs')], {
    encoding: 'utf8', timeout: 30000
  })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) throw new Error(result.stderr || result.stdout)
  const report: { checks: number } = JSON.parse(result.stdout)
  expect(report.checks).toBeGreaterThan(50)
})
