<!--
// Copyright © 2024 Hardcore Engineering Inc.
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
  import { Class, Doc, Ref, Blob } from '@hcengineering/core'
  import { AttrValue, MarkupNode, MarkupNodeType } from '@hcengineering/text'
  import { MermaidDiagram } from '@hcengineering/mermaid'
  import { CheckBox, humanReadableFileSize } from '@hcengineering/ui'

  import CodeBlockNode from './CodeBlockNode.svelte'
  import ObjectNode from './ObjectNode.svelte'
  import MarkdownNode from './MarkdownNode.svelte'
  import Node from './Node.svelte'
  import FileTypeIcon from '../FileTypeIcon.svelte'
  import { getFileUrl } from '../../file'
  import { getBlobRef } from '../../preview'
  import { ParsedTextWithEmojis } from '@hcengineering/emoji'

  export let node: MarkupNode
  export let singleTextNode = false
  export let preview = false
  export let parseEmojisFunction: ((text: string) => ParsedTextWithEmojis) | undefined = undefined

  let parsedTextWithEmojis: ParsedTextWithEmojis | undefined = undefined

  function toRefBlob (blobId: AttrValue): Ref<Blob> {
    return blobId as Ref<Blob>
  }

  function toRef (objectId: string): Ref<Doc> {
    return objectId as Ref<Doc>
  }

  function toClassRef (objectClass: string): Ref<Class<Doc>> {
    if (objectClass === 'contact:class:Employee') {
      return 'contact:mixin:Employee' as Ref<Class<Doc>>
    }
    return objectClass as Ref<Class<Doc>>
  }

  function toString (value: AttrValue | undefined): string | undefined {
    return value != null ? `${value}` : undefined
  }

  function toNumber (value: AttrValue | undefined): number | undefined {
    if (typeof value === 'boolean') {
      return value ? 1 : 0
    }

    return value != null ? (typeof value === 'string' ? parseInt(value) : value) : undefined
  }

  function columnWidth (value: unknown): string | undefined {
    if (!Array.isArray(value) || value.length === 0) return undefined
    const widths = value.filter((width: unknown): width is number =>
      typeof width === 'number' && Number.isFinite(width) && width > 0
    )
    if (widths.length !== value.length) return undefined
    return `${widths.reduce((sum, width) => sum + width, 0)}px`
  }

  $: if (node.type === MarkupNodeType.text && parseEmojisFunction) {
    parsedTextWithEmojis = parseEmojisFunction(node.text ?? '')
  }
</script>

{#if node}
  {@const attrs = node.attrs ?? {}}
  {@const nodes = node.content ?? []}

  {#if node.type === MarkupNodeType.doc}
    {#if nodes.length > 0}
      {#each nodes as node}
        <Node {parseEmojisFunction} {node} {preview} singleTextNode={nodes.length === 1} />
      {/each}
    {/if}
  {:else if node.type === MarkupNodeType.text}
    {#if parsedTextWithEmojis === undefined}
      {node.text}
    {:else}
      {#each parsedTextWithEmojis.nodes as textOrEmoji}
        {#if typeof textOrEmoji === 'string'}
          {textOrEmoji}
        {:else}
          <span
            class="emoji"
            style="display: inline-block"
            class:emojiOnly={parsedTextWithEmojis.emojisOnly && singleTextNode}
            class:custom={'image' in textOrEmoji}
          >
            {#if 'image' in textOrEmoji}
              {@const blob = toRefBlob(textOrEmoji.image)}
              {@const alt = toString(textOrEmoji.emoji)}
              {#await getBlobRef(blob) then blobSrc}
                <img src={blobSrc.src} {alt} />
              {/await}
            {:else}
              {textOrEmoji.emoji}
            {/if}
          </span>
        {/if}
      {/each}
    {/if}
  {:else if node.type === MarkupNodeType.emoji}
    <span class="emoji" class:emojiOnly={singleTextNode}>
      {#if node.attrs?.kind === 'image'}
        {@const blob = toRefBlob(attrs.image)}
        {@const alt = toString(attrs.emoji)}
        {#await getBlobRef(blob) then blobSrc}
          <img src={blobSrc.src} {alt} />
        {/await}
      {:else}
        {node.attrs?.emoji}
      {/if}
    </span>
  {:else if node.type === MarkupNodeType.paragraph}
    <p class="p-inline contrast" class:overflow-label={preview} style:text-align={toString(attrs.textAlign)}>
      {#if nodes.length > 0}
        {#each nodes as node}
          <Node {parseEmojisFunction} {node} {preview} singleTextNode={singleTextNode && nodes.length === 1} />
        {/each}
      {/if}
    </p>
  {:else if node.type === MarkupNodeType.blockquote}
    <blockquote class="proseBlockQuote" style:margin={preview ? '0' : null}>
      {#if nodes.length > 0}
        {#each nodes as node}
          <Node {parseEmojisFunction} {node} {preview} />
        {/each}
      {/if}
    </blockquote>
  {:else if node.type === MarkupNodeType.horizontal_rule}
    <hr />
  {:else if node.type === MarkupNodeType.heading}
    {@const level = toNumber(node.attrs?.level) ?? 1}
    {@const element = `h${level}`}
    <svelte:element this={element} style:text-align={toString(attrs.textAlign)}>
      {#if nodes.length > 0}
        {#each nodes as node}
          <Node {node} {preview} />
        {/each}
      {/if}
    </svelte:element>
  {:else if node.type === MarkupNodeType.mermaid || (node.type === MarkupNodeType.code_block && attrs.language === 'mermaid')}
    {@const code = nodes.map((child) => child.text ?? '').join('')}
    <MermaidDiagram {code} {preview} />
  {:else if node.type === MarkupNodeType.code_block}
    <CodeBlockNode {node} {preview} />
  {:else if node.type === MarkupNodeType.image}
    {@const fileId = toString(attrs['file-id'])}
    {@const src = fileId !== undefined ? getFileUrl(fileId) : toString(attrs.src)}
    {@const alt = toString(attrs.alt)}
    {@const width = toString(attrs.width)}
    {@const height = toString(attrs.height)}
    <div class="imgContainer max-h-60 max-w-60">
      <img {src} {alt} {width} {height} />
    </div>
  {:else if node.type === MarkupNodeType.file}
    {@const fileId = toString(attrs['file-id'])}
    {@const fileName = toString(attrs['data-file-name']) ?? ''}
    {@const fileSize = toNumber(attrs['data-file-size'])}
    <span class="text-editor-file-container">
      <span class="file-name-container">
        <FileTypeIcon name={fileName} />
        {#if fileId !== undefined}
          <a class="file-name" href={getFileUrl(fileId, fileName)} download={fileName} target="_blank" rel="noopener noreferrer">
            {fileName}
          </a>
        {:else}
          <span class="file-name">{fileName}</span>
        {/if}
      </span>
      {#if fileSize !== undefined && Number.isFinite(fileSize)}
        <span class="file-size">{humanReadableFileSize(fileSize)}</span>
      {/if}
    </span>
  {:else if node.type === MarkupNodeType.reference}
    {@const objectId = toString(attrs.id)}
    {@const objectClass = toString(attrs.objectclass)}
    {@const objectLabel = toString(attrs.label)}

    {#if objectClass !== undefined && objectId !== undefined}
      <ObjectNode _id={toRef(objectId)} _class={toClassRef(objectClass)} title={objectLabel} />
    {:else if nodes.length > 0}
      {#each nodes as node}
        <Node {parseEmojisFunction} {node} {preview} />
      {/each}
    {/if}
  {:else if node.type === MarkupNodeType.hard_break}
    <br />
  {:else if node.type === MarkupNodeType.ordered_list}
    {@const start = toNumber(attrs.start) ?? 1}
    <ol style:margin={preview ? '0' : null} {start}>
      {#if nodes.length > 0}
        {#each nodes as node}
          <Node {parseEmojisFunction} {node} {preview} />
        {/each}
      {/if}
    </ol>
  {:else if node.type === MarkupNodeType.bullet_list}
    <ul style:margin={preview ? '0' : null}>
      {#if nodes.length > 0}
        {#each nodes as node}
          <Node {parseEmojisFunction} {node} {preview} />
        {/each}
      {/if}
    </ul>
  {:else if node.type === MarkupNodeType.list_item}
    <li>
      {#if nodes.length > 0}
        {#each nodes as node}
          <Node {parseEmojisFunction} {node} {preview} />
        {/each}
      {/if}
    </li>
  {:else if node.type === MarkupNodeType.taskList || node.type === MarkupNodeType.todoList}
    <ul class="todo-list" data-type={node.type} style:margin={preview ? '0' : null}>
      {#each nodes as child}
        <Node {parseEmojisFunction} node={child} {preview} />
      {/each}
    </ul>
  {:else if node.type === MarkupNodeType.taskItem || node.type === MarkupNodeType.todoItem}
    {@const checked = attrs.checked === true || attrs.checked === 'true'}
    <li class="todo-item" data-type={node.type} data-checked={checked}>
      <div class="task-row">
        <div class="task-checkbox"><CheckBox {checked} readonly kind="todo" /></div>
        <div class="task-content">
          {#each nodes as child}
            <Node {parseEmojisFunction} node={child} {preview} />
          {/each}
        </div>
      </div>
    </li>
  {:else if node.type === MarkupNodeType.subLink}
    <sub>
      {#if nodes.length > 0}
        {#each nodes as node}
          <Node {parseEmojisFunction} {node} {preview} />
        {/each}
      {/if}
    </sub>
  {:else if node.type === MarkupNodeType.table}
    <table class="proseTable">
      <tbody>
        {#if nodes.length > 0}
          {#each nodes as node}
            <Node {parseEmojisFunction} {node} {preview} />
          {/each}
        {/if}
      </tbody>
    </table>
  {:else if node.type === MarkupNodeType.table_row}
    <tr>
      {#if nodes.length > 0}
        {#each nodes as node}
          <Node {parseEmojisFunction} {node} {preview} />
        {/each}
      {/if}
    </tr>
  {:else if node.type === MarkupNodeType.table_cell}
    {@const colspan = toNumber(attrs.colspan)}
    {@const rowspan = toNumber(attrs.rowspan)}
    <td
      {colspan}
      {rowspan}
      style:width={columnWidth(attrs.colwidth)}
      style:background-color={toString(attrs.backgroundColor)}
      style:text-align={toString(attrs.textAlign)}
      style:vertical-align={toString(attrs.verticalAlign)}
    >
      {#if nodes.length > 0}
        {#each nodes as node}
          <Node {parseEmojisFunction} {node} {preview} />
        {/each}
      {/if}
    </td>
  {:else if node.type === MarkupNodeType.table_header}
    {@const colspan = toNumber(attrs.colspan)}
    {@const rowspan = toNumber(attrs.rowspan)}
    <th
      {colspan}
      {rowspan}
      style:width={columnWidth(attrs.colwidth)}
      style:background-color={toString(attrs.backgroundColor)}
      style:text-align={toString(attrs.textAlign)}
      style:vertical-align={toString(attrs.verticalAlign)}
    >
      {#if nodes.length > 0}
        {#each nodes as node}
          <Node {parseEmojisFunction} {node} {preview} />
        {/each}
      {/if}
    </th>
  {:else if node.type === MarkupNodeType.markdown}
    <MarkdownNode {node} {preview} />
  {:else if node.type === MarkupNodeType.comment}
    <!-- Ignore -->
  {:else}
    unknown node: "{node.type}"
    {#if nodes.length > 0}
      {#each nodes as node}
        <Node {parseEmojisFunction} {node} {preview} />
      {/each}
    {/if}
  {/if}
{/if}

<style lang="scss">
  .task-row {
    display: flex;
    align-items: flex-start;
    gap: 0.5rem;
  }
  .task-checkbox {
    display: flex;
    align-items: center;
    min-height: 1.5rem;
  }
  .task-content {
    flex: 1;
    min-width: 0;
  }
  .imgContainer {
    display: inline;
  }
  .emojiOnly {
    font-size: 2rem;
    line-height: 115%;

    &.custom {
      min-height: 2.625rem;
    }
  }

  .img {
    :global(img) {
      object-fit: contain;
      height: 100%;
      width: 100%;
    }
  }
</style>
