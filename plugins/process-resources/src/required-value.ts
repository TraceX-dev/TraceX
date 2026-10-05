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

import core, { type Type } from '@hcengineering/core'
import { isEmptyMarkup } from '@hcengineering/text-core'

/** Checks required workflow values without rejecting valid false or zero values. */
export function isRequiredValueFilled (value: unknown, type?: Type<unknown>): boolean {
  if (value == null) return false
  if (Array.isArray(value)) return value.length > 0
  if (type?._class === core.class.TypeMarkup) {
    return typeof value === 'string' && !isEmptyMarkup(value)
  }
  if (typeof value === 'string') return value.trim().length > 0
  return true
}
