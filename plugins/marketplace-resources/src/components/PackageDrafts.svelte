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
  import { getCurrentAccount, SortingOrder } from '@hcengineering/core'
  import marketplace, { type DefinitionPackageDraft } from '@hcengineering/marketplace'
  import { getEmbeddedLabel } from '@hcengineering/platform'
  import { createQuery } from '@hcengineering/presentation'
  import {
    Breadcrumb,
    Button,
    Header,
    Notice,
    Scroller,
    SectionEmpty,
    SettingsCard,
    SettingsCardsLayout,
    Spinner,
    showPopup
  } from '@hcengineering/ui'
  import PackageDraftReviewPopup from './PackageDraftReviewPopup.svelte'

  let drafts: DefinitionPackageDraft[] = []
  let loading = true
  const query = createQuery()
  query.query(
    marketplace.class.DefinitionPackageDraft,
    { author: getCurrentAccount().uuid },
    (result) => {
      drafts = result
      loading = false
    },
    { sort: { modifiedOn: SortingOrder.Descending } }
  )

  function reviewDraft (draft: DefinitionPackageDraft): () => void {
    return (): void => {
      showPopup(PackageDraftReviewPopup, { draft }, 'centered')
    }
  }
</script>

<div class="hulyComponent">
  <Header adaptive="disabled">
    <Breadcrumb icon={marketplace.icon.Marketplace} label={marketplace.string.PackageDrafts} size="large" isCurrent />
  </Header>
  <div class="hulyComponent-content__column content">
    <Scroller align="center" padding="var(--spacing-3)" bottomPadding="var(--spacing-3)">
      <div class="hulyComponent-content flex-gap-4">
        <Notice label={marketplace.string.PackageDraftsDescription} />
        {#if loading}
          <div class="flex-center p-4"><Spinner /></div>
        {:else if drafts.length === 0}
          <SectionEmpty icon={marketplace.icon.Marketplace} label={marketplace.string.NoPackageDrafts} />
        {:else}
          <SettingsCardsLayout columns={2}>
            {#each drafts as draft (draft._id)}
              <div data-id="package-draft">
                <SettingsCard label={getEmbeddedLabel(draft.name)}>
                  <Button label={marketplace.string.ReviewPackageDraft} kind="primary" on:click={reviewDraft(draft)} />
                </SettingsCard>
              </div>
            {/each}
          </SettingsCardsLayout>
        {/if}
      </div>
    </Scroller>
  </div>
</div>
