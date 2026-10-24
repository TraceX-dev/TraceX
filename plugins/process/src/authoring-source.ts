//
// Copyright © 2026 TraceX SAS.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//

interface ParserState {
  position: number
  result: unknown
}

/** Retains parser positions without interpreting indentation or searching for repeated names. */
export class AuthoringSource {
  private readonly starts: number[] = []
  private readonly positions = new WeakMap<object, number>()

  constructor (private readonly source: string) {}

  readonly listener = (event: 'open' | 'close', state: ParserState): void => {
    if (event === 'open') this.starts.push(state.position)
    else {
      const position = this.starts.pop() ?? 0
      if (state.result !== null && typeof state.result === 'object' && !this.positions.has(state.result)) {
        this.positions.set(state.result, position)
      }
    }
  }

  /** Points to the closest authored container, including missing properties and dotted keys. */
  location (root: unknown, path: string): { line: number, column: number } | undefined {
    let value = root
    let position: number | undefined
    let remaining = path.replace(/^\$\.?/, '').replace(/\[(\d+)\]/g, '.$1')
    while (value !== null && typeof value === 'object') {
      position = this.positions.get(value) ?? position
      const data = value as Record<string, unknown>
      const key = Object.keys(data)
        .filter((key) => remaining === key || remaining.startsWith(key + '.'))
        .sort((a, b) => b.length - a.length)[0]
      if (key === undefined) break
      value = data[key]
      remaining = remaining.slice(key.length).replace(/^\./, '')
    }
    if (position === undefined) return undefined
    // The parser opens nodes before leading whitespace/comments are consumed.
    while (position < this.source.length) {
      if (/\s/.test(this.source[position])) {
        position++
        continue
      }
      if (this.source[position] === '#') {
        const end = this.source.indexOf('\n', position)
        position = end === -1 ? this.source.length : end + 1
        continue
      }
      break
    }
    const before = this.source.slice(0, position)
    return { line: before.split('\n').length, column: position - before.lastIndexOf('\n') }
  }
}
