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

/** Characters that mean the user is writing explicit simple_query_string syntax. */
const ADVANCED_SYNTAX_RE = /["*~|()+\\]/

/** Terms shorter than this are sent as-is: `t*` would expand to almost every word. */
export const MIN_PREFIX_TERM_LENGTH = 2

/**
 * Turn search-as-you-type input into a prefix full-text query, so typing `def`
 * matches `defgh` (from `ABC_DEFGH-12`) and `default`.
 *
 * Each whitespace-separated term of at least {@link MIN_PREFIX_TERM_LENGTH}
 * characters gets a trailing `*`. Input that already uses query syntax
 * (quotes, `*`, `~`, `|`, parentheses, `+`, escapes) or excludes a term with a
 * leading `-` is returned unchanged.
 *
 * @public
 */
export function toPrefixFulltextQuery (input: string): string {
  const trimmed = input.trim()
  if (trimmed === '') return ''
  const terms = trimmed.split(/\s+/)
  if (ADVANCED_SYNTAX_RE.test(trimmed) || terms.some((it) => it.startsWith('-'))) {
    return trimmed
  }
  return terms.map((it) => (it.length >= MIN_PREFIX_TERM_LENGTH ? `${it}*` : it)).join(' ')
}
