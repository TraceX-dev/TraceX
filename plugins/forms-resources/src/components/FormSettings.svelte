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
-->
<script lang="ts">
  import card, { type CardSpace, type MasterTag } from '@hcengineering/card'
  import core, { concatLink, type Ref, type Space } from '@hcengineering/core'
  import { formsId, type FormConfiguration } from '@hcengineering/forms'
  import { getMetadata } from '@hcengineering/platform'
  import presentation, {
    createQuery,
    getClient,
    getCurrentWorkspaceUrl,
    SpaceSelector
  } from '@hcengineering/presentation'
  import { Icon, IconFolder, Label, Toggle } from '@hcengineering/ui'
  import forms from '../plugin'
  import { isBaseTypeWithSubtypes } from '../utils'

  export let masterTag: MasterTag

  const client = getClient()
  const hierarchy = client.getHierarchy()
  let saving = false
  let failed = false
  let targetSpace: Ref<CardSpace> | undefined
  let configuration: FormConfiguration | undefined
  let loaded = false
  const query = createQuery()
  const spacesQuery = createQuery()
  let spaces: CardSpace[] = []

  spacesQuery.query(card.class.CardSpace, { archived: false }, (docs) => {
    spaces = docs
  })

  $: ancestors = hierarchy.getAncestors(masterTag._id)
  $: spaceQuery = {
    archived: false,
    _id: {
      $in: spaces
        .filter((space) => space.types.length === 0 || space.types.some((type) => ancestors.includes(type)))
        .map((space) => space._id)
    }
  }

  $: configurationId = `${formsId}:configuration:${masterTag._id}` as Ref<FormConfiguration>
  $: loadConfiguration(configurationId)
  $: enabled = configuration?.enabled === true
  $: baseType = isBaseTypeWithSubtypes(hierarchy, masterTag._id)
  $: toggleDisabled = saving || !loaded || (!enabled && (targetSpace === undefined || baseType))
  $: link = concatLink(
    getMetadata(presentation.metadata.FrontUrl) || window.location.origin,
    `${formsId}/${encodeURIComponent(getCurrentWorkspaceUrl())}/${encodeURIComponent(masterTag._id)}`
  )

  function loadConfiguration (id: Ref<FormConfiguration>): void {
    loaded = false
    query.query(forms.class.FormConfiguration, { _id: id }, (docs) => {
      configuration = docs[0]
      targetSpace = configuration?.targetSpace
      loaded = true
    })
  }

  function changeEnabled (event: CustomEvent<boolean>): void {
    void save(event.detail, targetSpace)
  }

  function changeSpace (event: CustomEvent<Ref<Space> | undefined>): void {
    void save(enabled, event.detail as Ref<CardSpace> | undefined)
  }

  async function save (publish: boolean, space: Ref<CardSpace> | undefined): Promise<void> {
    if (!loaded || saving || (publish && (space === undefined || baseType))) return
    saving = true
    failed = false
    try {
      const data = { masterTag: masterTag._id, enabled: publish, targetSpace: space }
      if (configuration !== undefined) {
        await client.update(configuration, data)
      } else {
        await client.createDoc(forms.class.FormConfiguration, core.space.Workspace, data, configurationId)
      }
    } catch (error) {
      console.error('[FormSettings.save] Failed to save form configuration', { type: masterTag._id, error })
      failed = true
      targetSpace = configuration?.targetSpace
    } finally {
      saving = false
    }
  }
</script>

<div class="hulyTableAttr-header font-medium-12">
  <Icon icon={IconFolder} size="small" />
  <span><Label label={forms.string.Forms} /></span>
</div>
<div class="hulyTableAttr-content">
  <div class="settings-list">
    <div class="row">
      <Label label={forms.string.TargetSpace} />
      <SpaceSelector
        _class={card.class.CardSpace}
        query={spaceQuery}
        label={forms.string.TargetSpace}
        autoSelect={false}
        bind:space={targetSpace}
        readonly={saving || !loaded}
        on:change={changeSpace}
      />
    </div>
    <div class="row">
      <Label label={forms.string.Enabled} />
      <Toggle on={enabled} disabled={toggleDisabled} on:change={changeEnabled} />
    </div>
    <p><Label label={forms.string.PublicHint} /></p>
    {#if enabled}
      <div class="row">
        <Label label={forms.string.FormLink} />
        <a href={link} target="_blank" rel="noreferrer">{link}</a>
      </div>
    {/if}
    {#if failed}<p role="alert"><Label label={forms.string.Failed} /></p>{/if}
  </div>
</div>

<style lang="scss">
  .settings-list {
    display: flex;
    flex-direction: column;
    gap: var(--spacing-1);
    padding: var(--spacing-2) var(--spacing-2_5);
    width: 100%;
    min-width: 0;
    box-sizing: border-box;
    font-size: 0.875rem;
    line-height: 1.25rem;
  }

  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--spacing-2);
    min-height: 2rem;
  }

  p {
    color: var(--global-secondary-TextColor);
    margin: 0;
  }

  a {
    color: var(--theme-accent-color);
    min-width: 0;
    overflow-wrap: anywhere;
  }
</style>
