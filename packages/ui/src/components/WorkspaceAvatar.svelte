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
//
// See the License for the specific language governing permissions and
// limitations under the License.
-->
<script lang="ts">
  import { themeStore } from '@hcengineering/theme'

  import { getPlatformColorForText } from '../colors'
  import { getWorkspaceInitial } from '../workspace'

  export let colorSeed: string
  export let displayName: string
  export let avatarUrl: string | null | undefined = undefined
  export let size: 'small' | 'medium' = 'small'
  export let hasUnread: boolean = false
  // Color of the surface the avatar sits on, so the unread ring stays
  // visible instead of blending into the avatar itself.
  export let ringColor: string = 'var(--theme-popup-color)'

  $: color = getPlatformColorForText(colorSeed, $themeStore.dark)
</script>

<div class="workspaceAvatar-wrap {size}">
  {#if avatarUrl != null && avatarUrl !== ''}
    <img class="workspaceAvatar-circle" src={avatarUrl} alt={displayName} />
  {:else}
    <div class="workspaceAvatar-circle" style:background-color={color}>
      {getWorkspaceInitial(displayName)}
    </div>
  {/if}
  {#if hasUnread}
    <div class="workspaceAvatar-unread" style:box-shadow={`0 0 0 0.125rem ${ringColor}`} />
  {/if}
</div>

<style lang="scss">
  .workspaceAvatar-wrap {
    position: relative;
    display: flex;
    flex-shrink: 0;

    &.small {
      width: 1.75rem;
      height: 1.75rem;
    }
    &.medium {
      width: 2rem;
      height: 2rem;
    }
  }
  .workspaceAvatar-circle {
    width: 100%;
    height: 100%;
    // Rounded square, matching the sidebar workspace logo (Logo.svelte)
    // instead of a plain circle.
    border-radius: 0.25rem;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.75rem;
    font-weight: 600;
    color: #fff;
    object-fit: cover;
  }
  .workspaceAvatar-unread {
    position: absolute;
    top: -0.0625rem;
    right: -0.0625rem;
    width: 0.5rem;
    height: 0.5rem;
    border-radius: 50%;
    background-color: var(--global-higlight-Color);
    pointer-events: none;
  }
</style>
