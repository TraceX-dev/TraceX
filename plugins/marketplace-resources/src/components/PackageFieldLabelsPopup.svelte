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
  import { type Ref } from '@hcengineering/core'
  import marketplace, {
    parseDefinitionPackageRelease,
    type CatalogPackage,
    type DefinitionPackageDraft,
    type DefinitionPackageRelease
  } from '@hcengineering/marketplace'
  import { getEmbeddedLabel, translate, type IntlString } from '@hcengineering/platform'
  import ui, { Button, Dialog, EditBox, Label, Notice, Spinner, themeStore } from '@hcengineering/ui'
  import { createEventDispatcher, onMount } from 'svelte'
  import { downloadCatalogRelease } from '../catalog'
  import { createPackageDraftPreview } from '../package-draft-preview'
  import { createFieldLabelsVersionDraft, renameDraftFields } from '../package-field-labels'

  interface Field {
    id: string
    original: string
    value: string | number | undefined
  }

  interface FieldGroup {
    id: string
    label: IntlString
    fields: Field[]
  }

  export let base: { draft: DefinitionPackageDraft } | { publication: CatalogPackage }

  const dispatch = createEventDispatcher<{ close: Ref<DefinitionPackageDraft> | undefined }>()
  const name = 'draft' in base ? base.draft.name : base.publication.name
  let release: DefinitionPackageRelease | undefined
  let groups: FieldGroup[] = []
  let loading = true
  let busy = false
  let error = ''

  function displayLabel (label: unknown, fallback: string): IntlString {
    if (typeof label !== 'string') return getEmbeddedLabel(fallback)
    return /^[^:\s]+:[^:\s]+:/.test(label) ? (label as IntlString) : getEmbeddedLabel(label)
  }

  async function load (): Promise<void> {
    try {
      const source =
        'draft' in base ? base.draft.release : await downloadCatalogRelease(base.publication, base.publication.version)
      release = await parseDefinitionPackageRelease(source)
      const language = $themeStore.language
      groups = await Promise.all(
        createPackageDraftPreview(release)
          .cards.filter((item) => item.fields.length > 0)
          .map(async (item) => ({
            id: item.definition._id,
            label: displayLabel(item.definition.label, item.definition._id),
            fields: await Promise.all(
              item.fields.map(async (field) => {
                const original = await translate(
                  displayLabel(field.label, String(field.name ?? field._id)),
                  {},
                  language,
                  true
                )
                return { id: field._id, original, value: original }
              })
            )
          }))
      )
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause)
    } finally {
      loading = false
    }
  }

  onMount(() => {
    void load()
  })

  $: changed = groups
    .flatMap((group) => group.fields)
    .filter((field) => String(field.value ?? '').trim() !== field.original.trim())
  $: canSave = changed.length > 0 && changed.every((field) => String(field.value ?? '').trim().length > 0)

  async function save (): Promise<void> {
    if (busy || !canSave || release === undefined) return
    busy = true
    error = ''
    try {
      const labels = new Map(changed.map((field) => [field.id, String(field.value ?? '')]))
      const id =
        'draft' in base
          ? await renameDraftFields(base.draft, labels)
          : await createFieldLabelsVersionDraft(base.publication, release, labels)
      dispatch('close', id)
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause)
    } finally {
      busy = false
    }
  }

  function close (): void {
    if (!busy) dispatch('close', undefined)
  }
</script>

<Dialog
  label={marketplace.string.EditFieldLabels}
  width="44rem"
  height="min(44rem, calc(100dvh - 2rem))"
  scrollable
  padding="var(--spacing-4)"
  on:close={close}
>
  <div class="flex-col flex-gap-4" data-id="package-field-labels">
    <div class="text-sm content-dark-color">
      {name}{#if release}
        · v{release.package.version}{/if}
    </div>
    {#if loading}
      <div class="flex-center p-4"><Spinner /></div>
    {:else if release !== undefined && groups.length === 0 && !error}
      <Notice label={marketplace.string.NoEditableFields} />
    {/if}
    {#each groups as group (group.id)}
      <section class="flex-col flex-gap-2">
        <h3><Label label={group.label} /></h3>
        {#each group.fields as field (field.id)}
          <div class="flex-col flex-gap-1" data-id="package-field-label">
            <EditBox
              label={getEmbeddedLabel(field.original)}
              bind:value={field.value}
              disabled={busy}
              fullSize
              required
            />
          </div>
        {/each}
      </section>
    {/each}
    {#if error}<Notice label={getEmbeddedLabel(error)} kind="error" />{/if}
  </div>
  <svelte:fragment slot="footerRight">
    <Button
      label={'draft' in base ? ui.string.SaveDraft : marketplace.string.CreateVersionDraft}
      kind="primary"
      loading={busy}
      disabled={busy || loading || !canSave}
      on:click={save}
    />
  </svelte:fragment>
</Dialog>
