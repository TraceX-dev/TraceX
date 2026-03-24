//
// Copyright © 2025 Hardcore Engineering Inc.
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

/**
 * Configuration for mapping regulatory document fields to dynamic attributes
 */
export interface AttributeMapping {
  dateAttribute: string
  externalLinkAttribute: string
  qalicoLinkAttribute: string
  applicabilityAttribute?: string
}

/**
 * Get attribute mapping from environment variables or use defaults
 */
export function getAttributeMapping (): AttributeMapping {
  return {
    dateAttribute: process.env.QALICO_DATE_ATTR ?? 'custom69bd83f4f66a7420cb3677f2',
    externalLinkAttribute: process.env.QALICO_EXTERNAL_LINK_ATTR ?? 'custom69bd8450f66a7420cb3677f7',
    qalicoLinkAttribute: process.env.QALICO_LINK_ATTR ?? 'custom69bd8457f66a7420cb3677fb',
    applicabilityAttribute: process.env.QALICO_APPLICABILITY_ATTR ?? 'custom69bd84d8f66a7420cb367809'
  }
}
