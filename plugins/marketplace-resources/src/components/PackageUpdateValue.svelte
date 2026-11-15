<!--
// Copyright © 2026 TraceX SAS.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
-->
<script lang="ts">
  import { type Doc, type Ref } from '@hcengineering/core'
  import marketplace from '@hcengineering/marketplace'
  import { getEmbeddedLabel, type IntlString } from '@hcengineering/platform'
  import { getClient } from '@hcengineering/presentation'
  import { Label } from '@hcengineering/ui'
  import { packageUpdateDocumentLabel, packageUpdatePropertyLabel } from '../package-update-review'

  export let value: unknown
  export let documents: readonly Record<string, unknown>[]

  const client = getClient()
  function referenceLabel (value: string): IntlString | undefined {
    if (value.startsWith('embedded:')) return value as IntlString
    const local = documents.find((doc) => doc._id === value)
    if (local !== undefined) return packageUpdateDocumentLabel(local, documents)
    const model = client.getModel().findObject<Doc & { label?: IntlString, name?: string }>(value as Ref<Doc>)
    return model?.label ?? (model?.name === undefined ? undefined : getEmbeddedLabel(model.name))
  }
</script>

{#if value === undefined}
  <span class="content-dark-color">—</span>
{:else if value === null}
  <span class="content-dark-color"><Label label={marketplace.string.EmptyValue} /></span>
{:else if typeof value === 'string'}
  {@const label = referenceLabel(value)}
  <span class="text"
    >{#if label !== undefined}<Label {label} />{:else if value === ''}“”{:else}{value}{/if}</span
  >
{:else if Array.isArray(value)}
  {#if value.length === 0}[]{:else}
    <ol>
      {#each value as item}<li><svelte:self value={item} {documents} /></li>{/each}
    </ol>
  {/if}
{:else if typeof value === 'object'}
  {#if Object.keys(value).length === 0}{'{}'}{:else}
    <dl>
      {#each Object.entries(value) as [key, item] (key)}
        <div>
          <dt><Label label={packageUpdatePropertyLabel(key)} /></dt>
          <dd><svelte:self value={item} {documents} /></dd>
        </div>
      {/each}
    </dl>
  {/if}
{:else}
  {String(value)}
{/if}

<style>
  .text {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  ol {
    margin: 0;
    padding-left: var(--spacing-4);
  }
  li + li {
    margin-top: var(--spacing-2);
  }
  dl,
  dd {
    margin: 0;
  }
  dl > div + div {
    margin-top: var(--spacing-2);
  }
  dt {
    color: var(--theme-dark-color);
    font-size: 0.75rem;
  }
  dd {
    padding-left: var(--spacing-2);
    overflow-wrap: anywhere;
  }
</style>
