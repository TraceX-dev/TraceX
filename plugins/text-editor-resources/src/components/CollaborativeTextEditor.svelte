<!--
//
// Copyright © 2022, 2023, 2024 Hardcore Engineering Inc.
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
  import {
    AccountRole,
    type Blob,
    Class,
    type CollaborativeDoc,
    type Doc,
    generateId,
    getCurrentAccount,
    hasAccountRole,
    makeDocCollabId,
    type Ref
  } from '@hcengineering/core'
  import { IntlString } from '@hcengineering/platform'
  import {
    DrawingCmd,
    getAttribute,
    getClient,
    getFileUrl,
    getImageSize,
    imageSizeToRatio,
    getPrintContext,
    KeyedAttribute
  } from '@hcengineering/presentation'
  import { isDocCreatedByAccount } from '@hcengineering/contact'
  import { markupToJSON } from '@hcengineering/text'
  import {
    AnySvelteComponent,
    Button,
    getEventPositionElement,
    getPopupPositionElement,
    IconScribble,
    IconSize,
    Loading,
    getRenderContext,
    PopupAlignment,
    themeStore,
    ThrottledCaller,
    trackRenderResource
  } from '@hcengineering/ui'
  import view from '@hcengineering/view'
  import { type Command, Editor, FocusPosition, mergeAttributes } from '@tiptap/core'
  import { isChangeOrigin } from '@tiptap/extension-collaboration'
  import { createEventDispatcher, getAllContexts, getContext, onDestroy, onMount, tick } from 'svelte'
  import { Doc as YDoc } from 'yjs'

  import textEditor, {
    CollaborationIds,
    CollaborationUser,
    RefAction,
    TextEditorCommandHandler,
    TextEditorHandler
  } from '@hcengineering/text-editor'
  import { EditorKitOptions, getEditorKit } from '../../src/kits/editor-kit'
  import { deleteAttachment } from '../command/deleteAttachment'
  import { textEditorCommandHandler } from '../commands'
  import { Provider } from '../provider/types'
  import { createRemoteProvider } from '../provider/utils'
  import { addTableHandler } from '../utils'

  import { noSelectionRender, renderCursor } from './editor/collaboration'
  import { defaultEditorAttributes } from './editor/editorProps'
  import { SavedBoard } from './extension/drawingBoard'
  import { getDefaultImageDisplay } from './extension/imageDisplay'
  import { insertEditableBlock, saveInsertionSelection } from './extension/insertion-selection'
  import { type FileAttachFunction } from './extension/types'
  import { inlineCommandsConfig } from './extensions'

  export let object: Doc
  export let attribute: KeyedAttribute

  export let user: CollaborationUser
  // svelte-ignore unused-export-let
  export let userComponent: AnySvelteComponent | undefined = undefined

  export let readonly = false

  // svelte-ignore unused-export-let
  export let buttonSize: IconSize = 'small'
  export let actionsButtonSize: IconSize = 'medium'
  export let full: boolean = false

  export let placeholder: IntlString = textEditor.string.EditorPlaceholder
  export let placeholderParams: Record<string, any> = {}

  export let refActions: RefAction[] = []

  export let editorAttributes: Record<string, string> = {}
  export let spellcheck: boolean = true
  export let overflow: 'auto' | 'none' = 'none'
  export let boundary: HTMLElement | undefined = undefined

  export let attachFile: FileAttachFunction | undefined = undefined

  export let withSideMenu = true
  export let withInlineCommands = true

  export let kitOptions: Partial<EditorKitOptions> = {}

  export let requestSideSpace: ((width: number) => void) | undefined = undefined

  const client = getClient()
  const dispatch = createEventDispatcher()

  const account = getCurrentAccount()
  const printContext = getPrintContext()
  const svelteContext = getAllContexts()
  const rendering = getRenderContext()
  const trackLoading = trackRenderResource()
  let destroyed = false
  const isGuest =
    account.role === AccountRole.DocGuest || account.role === AccountRole.ReadOnlyGuest || printContext !== undefined

  const objectClass = object._class
  const objectId = object._id
  const objectSpace = object.space
  const objectAttr = attribute.key
  const field = attribute.key
  const content = getAttribute(client, object, attribute)
  const collaborativeDoc = makeDocCollabId(object, objectAttr)

  const ydoc = getContext<YDoc>(CollaborationIds.Doc) ?? new YDoc({ guid: generateId(), gc: false })
  const contextProvider = getContext<Provider>(CollaborationIds.Provider)

  const provider = contextProvider ?? createRemoteProvider(ydoc, collaborativeDoc, content)

  let contentError = false
  let synced = false
  let editorReady = false

  $: loading = !synced || !editorReady
  $: trackLoading(loading && !contentError)
  $: canEditAsGuestCreator = account.role === AccountRole.Guest && isDocCreatedByAccount(object, account)
  $: editable =
    !readonly &&
    !contentError &&
    synced &&
    editorReady &&
    (hasAccountRole(account, AccountRole.User) || canEditAsGuestCreator)

  async function contentReady (): Promise<void> {
    await tick()
    if (destroyed || contentError) return
    dispatch('loaded')
  }

  let editor: Editor
  let element: HTMLElement
  let editorPopupContainer: HTMLElement

  $: dispatch('editor', editor)

  const editorHandler: TextEditorHandler = {
    insertText: (text) => {
      editor?.commands.insertContent(text)
    },
    insertEmoji: (text: string, image?: Ref<Blob>) => {
      editor?.commands.insertEmoji(text, image === undefined ? 'unicode' : 'image', image)
    },
    insertMarkup: (markup) => {
      editor?.commands.insertContent(markupToJSON(markup))
    },
    insertTemplate: (name, markup) => {
      editor?.commands.insertContent(markupToJSON(markup))
    },
    insertTable: (options: { rows?: number, cols?: number, withHeaderRow?: boolean }) => {
      editor?.commands.insertTable(options)
    },
    insertCodeBlock: () => {
      editor?.commands.setCodeBlock()
    },
    insertContent: (content) => {
      editor?.commands.insertContent(content)
    },
    insertSeparatorLine: () => {
      editor?.commands.setHorizontalRule()
    },
    focus: () => {
      focus()
    }
  }

  function handleAction (a: RefAction, evt?: MouseEvent): void {
    a.action(evt?.target as HTMLElement, editorHandler, evt)
  }

  $: commandHandler = textEditorCommandHandler(editor)

  export function commands (): TextEditorCommandHandler | undefined {
    return commandHandler
  }

  export function removeAttachment (id: string): void {
    editor.commands.command(deleteAttachment(id))
  }

  export function isEditable (): boolean {
    return editor?.isEditable ?? false
  }

  let needFocus = false
  let focused = false
  let posFocus: FocusPosition | undefined = undefined

  export function focus (position?: FocusPosition): void {
    posFocus = position
    needFocus = true
  }

  export function isFocused (): boolean {
    return focused
  }

  $: if (editor !== undefined && needFocus) {
    if (!focused) {
      editor.commands.focus(posFocus)
      posFocus = undefined
    }
    needFocus = false
  }

  $: if (editor !== undefined && editorReady && editable !== editor.isEditable) {
    // When the content is invalid, we don't want to emit an update
    // Preventing synchronization of the invalid content
    const emitUpdate = !contentError
    editor.setEditable(editable, emitUpdate)
  }

  let inputImage: HTMLInputElement
  let imageInsertionSelection: Command | undefined

  function selectImage (restoreSelection: Command): void {
    imageInsertionSelection = restoreSelection
    inputImage.click()
  }

  export function handleAttachImage (): void {
    const tiptap = editor
    if (tiptap === undefined || tiptap.isDestroyed || !tiptap.isEditable) return
    selectImage(saveInsertionSelection(tiptap))
  }

  async function createInlineImage (file: File, restoreSelection: Command): Promise<Command> {
    if (!file.type.startsWith('image/') || attachFile === undefined) {
      return restoreSelection
    }

    const tiptap = editor
    if (tiptap === undefined || tiptap.isDestroyed || !tiptap.isEditable) return restoreSelection
    const attached = await attachFile(file)
    if (attached === undefined) {
      return restoreSelection
    }

    const size = await getImageSize(file)
    if (tiptap.isDestroyed || !tiptap.isEditable) return restoreSelection

    tiptap
      .chain()
      .focus()
      .command(restoreSelection)
      .command(({ tr, chain }) => {
        return chain()
          .insertContent({
            type: 'image',
            attrs: {
              'file-id': attached.file,
              width: imageSizeToRatio(size.width, size.pixelRatio),
              display: getDefaultImageDisplay(tr.doc, tr.selection.from)
            }
          })
          .run()
      })
      .run()
    return saveInsertionSelection(tiptap)
  }

  async function fileSelected (): Promise<void> {
    const tiptap = editor
    const restoreSelection = imageInsertionSelection
    imageInsertionSelection = undefined
    const files = Array.from(inputImage.files ?? [])
    inputImage.value = ''
    if (readonly || tiptap === undefined || tiptap.isDestroyed || !tiptap.isEditable) return

    try {
      let nextSelection = restoreSelection ?? saveInsertionSelection(tiptap)
      for (const file of files) {
        nextSelection = await createInlineImage(file, nextSelection)
      }
    } catch (error) {
      console.error('Failed to insert image:', error)
    }
  }

  async function handleLeftMenuClick (id: string, pos: number, targetItem?: MouseEvent | HTMLElement): Promise<void> {
    const tiptap = editor
    if (tiptap === undefined || tiptap.isDestroyed || !tiptap.isEditable) return
    const restoreSelection = saveInsertionSelection(tiptap, pos)
    const insertion = (): ReturnType<typeof tiptap.chain> => tiptap.chain().focus().command(restoreSelection)

    switch (id) {
      case 'image':
        selectImage(restoreSelection)
        break
      case 'table': {
        let position: PopupAlignment | undefined = undefined
        if (targetItem !== undefined) {
          position =
            targetItem instanceof MouseEvent ? getEventPositionElement(targetItem) : getPopupPositionElement(targetItem)
        }

        await addTableHandler((options) => {
          if (!tiptap.isDestroyed && tiptap.isEditable) insertion().insertTable(options).run()
        }, position)
        break
      }
      case 'code-block':
        insertion()
          .command(insertEditableBlock({ type: 'codeBlock' }))
          .run()
        break
      case 'todo-list':
        insertion()
          .command(
            insertEditableBlock({
              type: 'todoList',
              content: [{ type: 'todoItem', content: [{ type: 'paragraph' }] }]
            })
          )
          .run()
        break
      case 'separator-line':
        insertion().setHorizontalRule().run()
        break
      case 'drawing-board':
        insertion()
          .insertContent({ type: 'drawingBoard', attrs: { id: generateId() } })
          .run()
        break
      case 'mermaid':
        insertion()
          .command(insertEditableBlock({ type: 'mermaid' }))
          .run()
        break
    }
  }

  const throttle = new ThrottledCaller(100)
  const updateLastUpdateTime = (): void => {
    provider.awareness?.setLocalStateField('lastUpdate', Date.now())
  }

  interface SavedBoardRaw {
    ydoc: YDoc
    remoteProvider: Provider
    remoteSynced: boolean
  }
  const savedBoards: Record<string, SavedBoardRaw> = {}

  function getSavedBoard (id: string): SavedBoard {
    let board = savedBoards[id]
    if (board === undefined) {
      const ydoc = new YDoc({ guid: id, gc: false })
      // We don't have a real class for boards,
      // but collaborator only needs a string id
      // which is produced from such an id-object
      const collabId: CollaborativeDoc = {
        objectClass: 'DrawingBoard' as Ref<Class<Doc>>,
        objectId: id as Ref<Doc>,
        objectAttr: 'content'
      }
      const remoteProvider = createRemoteProvider(ydoc, collabId, id as Ref<Blob>)
      savedBoards[id] = { ydoc, remoteProvider, remoteSynced: false }
      void remoteProvider.loaded.then(() => (savedBoards[id].remoteSynced = true))
      board = savedBoards[id]
    }
    return {
      document: board.ydoc,
      props: board.ydoc.getMap('props'),
      commands: board.ydoc.getArray<DrawingCmd>('commands'),
      loading: !board.remoteSynced
    }
  }

  async function initialize (): Promise<void> {
    // it is recommended to wait for the local provider to be loaded
    // https://discuss.yjs.dev/t/initial-offline-value-of-a-shared-document/465/4
    await provider.loaded
    if (destroyed) return
    synced = true

    const canAttachFiles = attachFile != null

    const kit = await getEditorKit(
      {
        printContext,
        getSvelteContext: () => svelteContext,
        objectId,
        objectClass,
        objectSpace,

        undoRedo: false,
        shortcuts: {
          imageUpload: canAttachFiles && { attachFile, getFileUrl },
          fileUpload: canAttachFiles && { attachFile }
        },
        submit: false,
        toolbar: {
          boundary,
          popupContainer: editorPopupContainer
        },
        codeSnippets: {
          codeBlockMermaid: { ydoc, ydocContentField: field }
        },
        drawingBoard: { getSavedBoard },
        leftMenu: withSideMenu && {
          width: 20,
          height: 20,
          marginX: 8,
          className: 'tiptap-left-menu no-print',
          icon: view.icon.Add,
          iconProps: {
            className: 'svg-tiny',
            fill: 'currentColor'
          },
          items: [
            { id: 'image', label: textEditor.string.Image, icon: view.icon.Image },
            { id: 'table', label: textEditor.string.Table, icon: view.icon.Table2 },
            { id: 'code-block', label: textEditor.string.CodeBlock, icon: view.icon.CodeBlock },
            { id: 'separator-line', label: textEditor.string.SeparatorLine, icon: view.icon.SeparatorLine },
            { id: 'todo-list', label: textEditor.string.TodoItem, icon: view.icon.TodoList },
            { id: 'drawing-board', label: textEditor.string.DrawingBoard, icon: IconScribble as any },
            { id: 'mermaid', label: textEditor.string.MermaidDiargram, icon: view.icon.Model }
          ],
          handleSelect: handleLeftMenuClick
        },
        inlineCommands:
          withInlineCommands && inlineCommandsConfig(handleLeftMenuClick, canAttachFiles ? [] : ['image']),
        placeholder: {
          placeholderIntl: placeholder,
          placeholderIntlParams: placeholderParams,
          themeStore
        },
        collaboration: {
          collaboration: { document: ydoc, field },
          collaborationCaret: {
            provider,
            user,
            render: renderCursor,
            selectionRender: noSelectionRender
          },
          inlineComments: !isGuest && {
            ydoc,
            boundary,
            popupContainer: editorPopupContainer,
            requestSideSpace,
            whenSync: provider.loaded
          }
        }
      },
      kitOptions
    )
    if (destroyed) return

    // Create editor immediately with cached content
    // BUT keep it read-only until remote sync completes
    // This prevents stale cached content from overwriting newer server content
    editor = new Editor({
      extensions: [kit],
      element,
      editable: !readonly,
      editorProps: {
        attributes: mergeAttributes(defaultEditorAttributes, editorAttributes, {
          class: 'flex-grow',
          translate: readonly ? 'yes' : 'no',
          spellcheck: spellcheck ? 'true' : 'false'
        })
      },
      enableContentCheck: true,
      parseOptions: {
        preserveWhitespace: 'full'
      },
      onCreate: () => {
        editorReady = true
        void contentReady().catch((error) => {
          rendering?.fail(error)
        })
      },
      onTransaction: () => {
        // force re-render so `editor.isActive` works as expected
        editor = editor
      },
      onBlur: ({ event }) => {
        focused = false
        dispatch('blur', event)
      },
      onFocus: () => {
        focused = true
        dispatch('focus')
      },
      onUpdate: ({ transaction }) => {
        // ignore non-document changes
        if (!transaction.docChanged) return
        // ignore non-local changes
        if (isChangeOrigin(transaction)) return

        throttle.call(updateLastUpdateTime)
        dispatch('update')
      },
      onContentError: ({ error, disableCollaboration }) => {
        disableCollaboration()
        contentError = true
        rendering?.fail(error)
        console.error(error)
        Analytics.handleError(error)
      }
    })
  }
  onMount(() => {
    void initialize().catch((error) => {
      rendering?.fail(error)
      contentError = true
      Analytics.handleError(error)
    })
  })

  onDestroy(() => {
    destroyed = true
    if (editor !== undefined) {
      try {
        editor.destroy()
      } catch (err: any) {}
    }
    if (contextProvider === undefined) {
      void provider.destroy()
    }
  })
</script>

<input
  bind:this={inputImage}
  multiple
  type="file"
  name="file"
  id="imageInput"
  accept="image/*"
  style="display: none"
  on:change={fileSelected}
/>
<div class="editorPopupContainer no-print" bind:this={editorPopupContainer}></div>
<!-- svelte-ignore a11y-click-events-have-key-events -->
<!-- svelte-ignore a11y-no-static-element-interactions -->
<div
  style:overflow
  class="ref-container clear-mins"
  class:h-full={full}
  on:click|preventDefault|stopPropagation={() => (needFocus = true)}
>
  {#if loading}
    <div class="flex p-3">
      <Loading />
    </div>
  {/if}

  <div class="textInput">
    <div class="select-text" class:hidden={loading} style="width: 100%;" bind:this={element} />
  </div>

  {#if refActions.length > 0}
    <div class="buttons-panel flex-between clear-mins no-print">
      <div class="buttons-group xsmall-gap mt-3">
        {#each refActions as a, idx (a)}
          {#if idx !== 0 && a.order % 10 === 0}
            <div class="buttons-divider" />
          {/if}

          <Button
            disabled={a.disabled}
            icon={a.icon}
            iconProps={{ size: actionsButtonSize }}
            kind="ghost"
            showTooltip={{ label: a.label }}
            size="medium"
            on:click={(evt) => {
              handleAction(a, evt)
            }}
          />
        {/each}
      </div>
    </div>
  {/if}
</div>

<style lang="scss">
  .ref-container {
    flex-grow: 1;
    display: flex;
    flex-direction: column;
    position: relative;
  }

  .textInput {
    flex-grow: 1;
    gap: 1rem;
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    min-height: 1.25rem;
    background-color: transparent;

    :global(.tiptap-left-menu) {
      color: var(--theme-trans-color);
      width: 20px;
      height: 20px;
      border-radius: 20%;
      display: flex;
      align-items: center;
      justify-content: center;

      &:hover {
        background-color: var(--theme-button-hovered);
        cursor: pointer;
      }

      &:active {
        background-color: var(--theme-button-pressed);
      }
    }
  }

  .hidden {
    display: none;
  }
</style>
