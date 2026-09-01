<!--
// Copyright © 2023 Hardcore Engineering Inc.
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
  import { DropdownLabels, EditBox, Label, RadioGroup } from '@hcengineering/ui'
  import core, { type AttachedData, type Data } from '@hcengineering/core'
  import { translate } from '@hcengineering/platform'
  import { createQuery, getClient } from '@hcengineering/presentation'
  import {
    type ChangeControl,
    type ControlledDocument,
    type DocumentCategory,
    type DocumentTemplate,
    DOCUMENT_SEQUENCE_KEY,
    DOCUMENT_SEQUENCE_NAMESPACE,
    getDocumentId,
    TEMPLATE_PREFIX,
    TEMPLATE_SEQUENCE_SCOPE
  } from '@hcengineering/controlled-documents'

  import IconWarning from '../../icons/IconWarning.svelte'
  import { $infoStep as infoStep, infoStepUpdated } from '../../../stores/wizards/create-document'
  import documents from '../../../plugin'

  export let docObject: AttachedData<ControlledDocument> & Partial<Pick<DocumentTemplate, 'docPrefix'>>
  export let ccRecord: Data<ChangeControl> | undefined = undefined
  export let canProceed: boolean
  export let isTemplate: boolean = false

  const client = getClient()

  const newDocCreationIntlString = isTemplate ? documents.string.NewTemplateCreation : documents.string.NewDocCreation
  let newDocCreationText = ''
  translate(newDocCreationIntlString, {}).then(
    (r) => {
      newDocCreationText = r
    },
    (err) => {
      console.warn(`Cannot load translation for: ${newDocCreationIntlString}. Error: ${err})`)
    }
  )

  let templatesCodeTitle = ''
  translate(documents.string.SysTemplate, {}).then(
    (res) => {
      templatesCodeTitle = res
      templateDocPrefixes[TEMPLATE_PREFIX] = templatesCodeTitle
    },
    (err) => {
      console.warn(`Cannot load translation for: ${documents.string.SysTemplate}. Error: ${err})`)
    }
  )

  const templateDocPrefixesQuery = createQuery()
  let templateDocPrefixes: Record<string, string> = {}
  templateDocPrefixesQuery.query(
    documents.mixin.DocumentTemplate,
    {},
    (res) => {
      templateDocPrefixes = { [TEMPLATE_PREFIX]: templatesCodeTitle }
      for (const t of res) {
        templateDocPrefixes[t.docPrefix] = t.title
      }
    },
    {
      projection: { docPrefix: 1, title: 1 }
    }
  )

  let customReason = $infoStep.customReason
  let abstract: string = docObject?.abstract ?? ''

  $: if (docObject !== undefined) {
    docObject.abstract = abstract
  }
  $: if (ccRecord !== undefined && $infoStep.selectedReason === 'newDoc') {
    ccRecord.reason = newDocCreationText
  }
  $: if (ccRecord !== undefined && $infoStep.selectedReason === 'custom') {
    ccRecord.reason = customReason
  }
  $: isCategoryFilled = isTemplate ? docObject.category !== undefined : true
  $: isCodeFilled = isTemplate ? docObject.prefix !== '' && docObject.prefix !== undefined : true
  $: prefixNotUnique = docObject.docPrefix != null && templateDocPrefixes[docObject.docPrefix] !== undefined
  $: canProceed =
    docObject.code !== '' &&
    docObject.title !== '' &&
    ccRecord?.reason !== undefined &&
    ccRecord.reason !== '' &&
    isCodeFilled &&
    isCategoryFilled &&
    !prefixNotUnique &&
    (!isTemplate || (docObject.docPrefix !== undefined && docObject.docPrefix !== ''))
  $: if (docObject !== undefined && docObject.code === '') {
    void setInitialCode()
  }

  async function setInitialCode (): Promise<void> {
    // Preview of the number the server is going to allocate, from the very sequence it allocates from.
    const scope = isTemplate ? TEMPLATE_SEQUENCE_SCOPE : docObject.template
    const numberSequence =
      scope === undefined
        ? undefined
        : await client.findOne(core.class.CustomSequence, {
          namespace: DOCUMENT_SEQUENCE_NAMESPACE,
          scope,
          prefix: DOCUMENT_SEQUENCE_KEY
        })
    const seqNumber = Math.max(docObject.seqNumber, (numberSequence?.sequence ?? 0) + 1)

    if (docObject.code !== '') return

    if (!isTemplate) {
      docObject.seqNumber = seqNumber
    }
    docObject.code = getDocumentId({ prefix: docObject.prefix, seqNumber })
  }

  const radioItems = [
    {
      id: 'newDoc',
      value: 'newDoc',
      labelIntl: isTemplate ? documents.string.NewTemplateCreation : documents.string.NewDocCreation,
      labelSize: 'large' as const,
      labelGap: 'large' as const,
      action: handleSelectedReasonChanged.bind(null, 'newDoc')
    },
    {
      id: 'custom',
      value: 'custom',
      labelIntl: documents.string.CustomReason,
      labelSize: 'large' as const,
      labelGap: 'large' as const,
      action: handleSelectedReasonChanged.bind(null, 'custom')
    }
  ]

  function handleSelectedReasonChanged (selected: 'newDoc' | 'custom'): void {
    infoStepUpdated({ ...$infoStep, selectedReason: selected })
  }

  function handleReasonUpdated (value: string): void {
    infoStepUpdated({ ...$infoStep, customReason: value })
  }

  let categories: DocumentCategory[] = []
  $: if (isTemplate) {
    void client.findAll(documents.class.DocumentCategory, {}).then((cats) => {
      categories = cats
    })
  }
</script>

{#if ccRecord !== undefined}
  <div class="root">
    <div class="sectionTitle">
      <Label label={isTemplate ? documents.string.TemplateCode : documents.string.DocumentCode} />
    </div>
    <div class="sectionContent">
      <EditBox
        placeholder={documents.string.DocumentCodePlaceholder}
        bind:value={docObject.code}
        id="doc-code"
        kind="large-style"
      />
    </div>
    <div class="sectionTitle"><Label label={documents.string.TitleAndDescr} /></div>
    <div class="sectionContent">
      <EditBox
        autoFocus
        bind:value={docObject.title}
        id="doc-title"
        placeholder={isTemplate ? documents.string.NewDocumentTemplate : documents.string.NewDocument}
        kind="large-style"
        fullSize
        on:input={() => {
          if (isTemplate) {
            docObject.docPrefix =
              docObject.title
                .split(' ')
                .map((it) => it[0]?.toUpperCase())
                .filter((it) => it)
                .join('') ?? ''
          }
        }}
      />
    </div>
    <div>
      <EditBox
        bind:value={abstract}
        id="doc-description"
        placeholder={isTemplate ? documents.string.NewTemplatePlaceholder : documents.string.AbstractPlaceholder}
      />
    </div>
    {#if isTemplate}
      <div class="sectionTitle"><Label label={documents.string.DocumentPrefix} /></div>
      <div class="sectionContent">
        <EditBox
          placeholder={documents.string.DocumentPrefixPlaceholder}
          bind:value={docObject.docPrefix}
          kind="large-style"
        />
        {#if prefixNotUnique && docObject.docPrefix !== undefined}
          <div class="error">
            <IconWarning size="small" />
            <Label label={documents.string.PrefixInUse} />
            <span class="name">{templateDocPrefixes[docObject.docPrefix]}</span>
          </div>
        {/if}
      </div>
      <div class="sectionTitle"><Label label={documents.string.Category} /></div>
      <div class="sectionContent">
        <DropdownLabels
          label={documents.string.Category}
          items={categories.map((cat) => ({ id: cat._id, label: cat.title }))}
          showDropdownIcon
          bind:selected={docObject.category}
        />
      </div>
    {/if}
    <div class="sectionTitle"><Label label={documents.string.Reason} /></div>
    <div class="radio">
      <RadioGroup items={radioItems} selected={$infoStep.selectedReason} gap="large" />
    </div>
    {#if $infoStep.selectedReason === 'custom'}
      <div class="mt-4">
        <EditBox
          bind:value={customReason}
          id="doc-reason"
          placeholder={documents.string.ReasonPlaceholder}
          kind="editbox"
          fullSize
          on:blur={(e) => {
            handleReasonUpdated(e.detail)
          }}
        />
      </div>
    {/if}
  </div>
{/if}

<style lang="scss">
  .root {
    height: 100%;
    width: 100%;
    display: flex;
    flex-direction: column;
  }

  .sectionTitle {
    font-size: 0.875rem;
    font-weight: 500;
    line-height: 1.25rem;

    &:not(:first-child) {
      margin-top: 2rem;
    }
  }

  .sectionContent {
    padding: 1rem 0 0.5rem 0;
  }

  .radio {
    margin-top: 1rem;
    font-weight: 500;
    font-size: 0.875rem;
    line-height: 1.25rem;
    overflow-x: visible;
  }

  .error {
    display: flex;
    gap: 0.25rem;
    margin-top: 0.375rem;
    color: var(--negative-button-default);
    font-size: 0.75rem;
    line-height: 1rem;
  }

  .name {
    font-weight: 500;
  }
</style>
