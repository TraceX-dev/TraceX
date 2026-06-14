<!--
// Copyright © 2026 TraceX.
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
-->
<script lang="ts">
  import aiBot from '@hcengineering/ai-bot'
  import { type Doc } from '@hcengineering/core'
  import { getClient } from '@hcengineering/presentation'
  import { formatNumberCompact, Label } from '@hcengineering/ui'

  export let message: Doc | undefined

  const hierarchy = getClient().getHierarchy()

  $: usage = hierarchy.asIf(message, aiBot.mixin.AIBotMessage)
</script>

{#if usage !== undefined}
  {@const input = formatNumberCompact(usage.inputTokens)}
  {@const output = formatNumberCompact(usage.outputTokens)}

  <span class="usage text-sm lower">
    <span class="bullet">•</span>
    <Label label={aiBot.string.TokenUsage} params={{ input, output }} />
  </span>
{/if}

<style lang="scss">
  .usage {
    display: inline-flex;
    align-items: center;
    margin-left: 0.5rem;
    color: var(--global-secondary-TextColor);
    cursor: default;
  }

  .bullet {
    margin-right: 0.25rem;
  }
</style>
