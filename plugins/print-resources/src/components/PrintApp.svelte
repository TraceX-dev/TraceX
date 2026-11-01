<!--
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
-->
<script lang="ts">
  import { Analytics } from '@hcengineering/analytics'
  import type { Class, Doc, Ref } from '@hcengineering/core'
  import { getMetadata } from '@hcengineering/platform'
  import presentation, { decodeTokenPayload, printSessionStore } from '@hcengineering/presentation'
  import { getCurrentLocation, getPanelURI, Label, Loading, Notifications, type Location } from '@hcengineering/ui'
  import view from '@hcengineering/view'
  import workbench from '@hcengineering/workbench'
  import { onDestroy } from 'svelte'
  import {
    connectEmbeddedWorkspace,
    disconnectEmbeddedWorkspace,
    EmbeddedWorkspace
  } from '@hcengineering/workbench-resources'

  printSessionStore.set(true)

  async function open (): Promise<Location> {
    const loc = getCurrentLocation()
    const token = sessionStorage.getItem('print-token')
    sessionStorage.removeItem('print-token')
    const workspace = loc.path[1]
    const objectId = loc.query?.objectId
    const objectClass = loc.query?.objectClass
    if (token === null || workspace === undefined || !objectId || !objectClass) {
      throw new Error('Print session is missing')
    }
    const payload = decodeTokenPayload(token)
    if (payload.extra?.readonly !== 'true' || payload.extra?.guest === 'true') {
      throw new Error('Print session requires a read-only user token')
    }
    const client = await connectEmbeddedWorkspace(
      getMetadata(workbench.metadata.PlatformTitle) ?? 'Platform',
      workspace,
      token
    )
    const _class = objectClass as Ref<Class<Doc>>
    const _id = objectId as Ref<Doc>
    const doc = await client.findOne(_class, { _id })
    if (doc === undefined) throw new Error('Document is not accessible')
    const component =
      client.getHierarchy().classHierarchyMixin(_class, view.mixin.ObjectPanel)?.component ?? view.component.EditDoc
    return { path: ['print', workspace], fragment: getPanelURI(component, _id, _class, 'content') }
  }

  onDestroy(() => {
    void disconnectEmbeddedWorkspace().catch(Analytics.handleError)
  })
</script>

{#await open()}
  <Loading />
{:then target}
  <Notifications><EmbeddedWorkspace {target} documentOnly /></Notifications>
{:catch}
  <div data-print-root data-print-state="error">
    <Label label={presentation.string.AccessDenied} />
  </div>
{/await}
