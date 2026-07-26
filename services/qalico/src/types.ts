//
// Copyright © 2026 TraceX.
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

export interface RegulatoryDocument {
  uuid: string
  date: string
  title: string
  summary: {
    type: 'html' | 'markdown'
    content: string
  }
  externalLink: string
  qalicoLink: string
  applicability: boolean
}

export function isValidRegulatoryDocument (data: any): data is RegulatoryDocument {
  if (typeof data !== 'object' || data === null) {
    return false
  }

  //  Validate UUID
  if (typeof data.uuid !== 'string') {
    return false
  }

  // Validate date (ISO string format)
  if (typeof data.date !== 'string') {
    return false
  }
  const dateObj = new Date(data.date)
  if (isNaN(dateObj.getTime())) {
    return false
  }

  // Validate title
  if (typeof data.title !== 'string' || data.title.trim() === '') {
    return false
  }

  // Validate summary
  if (
    typeof data.summary !== 'object' ||
    data.summary === null ||
    (data.summary.type !== 'html' && data.summary.type !== 'markdown') ||
    typeof data.summary.content !== 'string'
  ) {
    return false
  }

  // Validate externalLink
  if (data.externalLink != null) {
    if (typeof data.externalLink !== 'string' || data.externalLink.trim() === '') {
      return false
    }
  }

  // Validate qalicoLink
  if (data.qalicoLink != null) {
    if (typeof data.qalicoLink !== 'string' || data.qalicoLink.trim() === '') {
      return false
    }
  }

  // Validate applicability
  if (data.applicability != null) {
    if (typeof data.applicability !== 'boolean') {
      return false
    }
  }

  return true
}
