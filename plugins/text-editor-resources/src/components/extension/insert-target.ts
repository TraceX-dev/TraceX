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

import type { ChainedCommands, CommandProps, Editor, EditorEvents } from '@tiptap/core'
import type { Node } from '@tiptap/pm/model'
import {
  absolutePositionToRelativePosition,
  relativePositionToAbsolutePosition,
  type SyncPluginState,
  ySyncPluginKey
} from '@tiptap/y-tiptap'
import { XmlElement } from 'yjs'
import { saveInsertionSelection } from './insertion-selection'

type BuildInsertion = (chain: ChainedCommands) => ChainedCommands

export interface InsertTarget {
  readonly pos: number | null
  readonly started: boolean
  begin: () => void
  insert: (build: BuildInsertion) => boolean
  insertNext: (build: BuildInsertion) => boolean
  onRelease: (listener: () => void) => () => void
  release: () => void
}

function sharedBlockAt (sync: SyncPluginState, doc: Node, pos: number): XmlElement | null {
  const index = doc.resolve(pos).index(0)
  const block = sync.type.get(index)
  return block instanceof XmlElement && sync.binding.mapping.get(block) === doc.maybeChild(index) ? block : null
}

function sharedBlockStart (sync: SyncPluginState, doc: Node, block: XmlElement): number | null {
  const node = sync.binding.mapping.get(block)
  if (node === undefined) return null
  let result: number | null = null
  doc.forEach((child, offset) => {
    if (child === node) result = offset
  })
  return result
}

export function trackInsertTarget (
  editor: Editor,
  from: number,
  onRelease?: (target: InsertTarget) => void
): InsertTarget {
  return trackTarget(editor, from, onRelease)
}

export function trackSelectionTarget (editor: Editor): InsertTarget {
  return trackTarget(editor, undefined)
}

function trackTarget (
  editor: Editor,
  from: number | undefined,
  onRelease?: (target: InsertTarget) => void
): InsertTarget {
  let bookmark = from === undefined ? editor.state.selection.getBookmark() : undefined
  let cur = from ?? editor.state.selection.from
  let start = cur
  let assoc: 1 | -1 = 1
  let started = false
  let alive = Number.isInteger(cur) && cur >= 0 && cur <= editor.state.doc.content.size
  const releaseListeners = new Set<() => void>()
  const sync = ySyncPluginKey.getState(editor.state)
  let originalBlock =
    alive && sync !== undefined && bookmark === undefined ? sharedBlockAt(sync, editor.state.doc, cur) : null

  function getCursorAnchor (pos: number): (() => number | null) | undefined {
    if (sync === undefined) return
    const doc = editor.state.doc
    const block = sharedBlockAt(sync, doc, pos)
    if (block === null) return
    const relative = absolutePositionToRelativePosition(pos, sync.type, sync.binding.mapping)
    return () => {
      const resolved = relativePositionToAbsolutePosition(sync.doc, sync.type, relative, sync.binding.mapping)
      const currentDoc = editor.state.doc
      if (resolved === null || resolved < 0 || resolved > currentDoc.content.size) return null
      return sharedBlockAt(sync, currentDoc, resolved) === block ? resolved : null
    }
  }

  const atBlockStart = alive && bookmark === undefined && editor.state.doc.resolve(cur).depth === 0
  let resolveCursor = alive && bookmark === undefined && !atBlockStart ? getCursorAnchor(cur) : undefined

  function onTransaction ({ transaction, appendedTransactions }: EditorEvents['transaction']): void {
    if (!alive) return
    const transactions = [transaction, ...appendedTransactions]
    if (!transactions.some((tr) => tr.docChanged)) return
    if (bookmark !== undefined) {
      for (const tr of transactions) bookmark = bookmark.map(tr.mapping)
      return
    }
    const remote = transactions.some((tr) => tr.getMeta(ySyncPluginKey)?.isChangeOrigin === true)

    // Remote sync can replace an entire ProseMirror block for an edit inside it.
    if (remote && sync !== undefined && originalBlock !== null) {
      const blockStart = sharedBlockStart(sync, editor.state.doc, originalBlock)
      const pos = resolveCursor !== undefined ? resolveCursor() : assoc === 1 && atBlockStart ? blockStart : null
      if (blockStart === null || pos === null) {
        target.release()
        return
      }
      start = blockStart
      cur = pos
      return
    }

    for (const tr of transactions) {
      const origin = tr.mapping.mapResult(start, 1)
      const cursor = tr.mapping.mapResult(cur, assoc)
      if (origin.deleted || cursor.deleted) {
        target.release()
        return
      }
      start = origin.pos
      cur = cursor.pos
    }
  }

  function restoreSelection (props: CommandProps): boolean {
    const pos = target.pos
    if (pos === null) return false
    if (bookmark === undefined) return saveInsertionSelection(editor, pos)(props)
    if (props.dispatch !== undefined) props.tr.setSelection(bookmark.resolve(props.tr.doc))
    return true
  }

  function applyInsertion (build: BuildInsertion): boolean {
    if (target.pos === null) return false
    started = true
    // Tiptap runs subsequent chain commands even if an earlier command returns false.
    return editor.commands.command((props) => restoreSelection(props) && build(props.chain().focus()).run())
  }

  function advance (pos: number): void {
    if (!alive) return
    if (bookmark !== undefined) {
      bookmark = undefined
      start = pos
      originalBlock = sync !== undefined ? sharedBlockAt(sync, editor.state.doc, pos) : null
    }
    cur = pos
    assoc = -1
    resolveCursor = getCursorAnchor(pos)
  }

  const target: InsertTarget = {
    get pos () {
      if (!alive || editor.isDestroyed || !editor.isEditable) return null
      return bookmark?.resolve(editor.state.doc).from ?? cur
    },
    get started () {
      return started
    },
    begin () {
      if (alive) started = true
    },
    insert (build) {
      try {
        return applyInsertion(build)
      } finally {
        target.release()
      }
    },
    insertNext (build) {
      const inserted = applyInsertion(build)
      if (inserted && alive) advance(editor.state.selection.to)
      return inserted
    },
    onRelease (listener) {
      if (!alive) {
        listener()
      } else {
        releaseListeners.add(listener)
      }
      return () => {
        releaseListeners.delete(listener)
      }
    },
    release () {
      if (!alive) return
      alive = false
      editor.off('transaction', onTransaction)
      editor.off('destroy', target.release)
      onRelease?.(target)
      for (const listener of releaseListeners) listener()
      releaseListeners.clear()
    }
  }

  if (alive && !editor.isDestroyed) {
    editor.on('transaction', onTransaction)
    editor.on('destroy', target.release)
  }
  return target
}
