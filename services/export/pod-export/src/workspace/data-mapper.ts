//
// Copyright © 2025 Hardcore Engineering Inc.
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

import contact, { type Person } from '@hcengineering/contact'
import core, {
  parseIdentifier,
  type ArrOf,
  type Class,
  type Doc,
  type MeasureContext,
  type Ref,
  type RefTo,
  type Space,
  type TxOperations
} from '@hcengineering/core'
import { type ExportState } from './types'

/**
 * Handles data preparation, remapping, and field mapping for document export
 */
export class DataMapper {
  // Cache of person refs already checked in the target workspace: ref -> exists
  private readonly personExistence = new Map<Ref<Person>, boolean>()

  constructor (
    private readonly context: MeasureContext,
    private readonly targetClient: TxOperations,
    private readonly state: ExportState,
    private readonly fieldMappers: Record<string, Record<string, any>>,
    private readonly currentAccountEmployeeId: Ref<any> | undefined
  ) {}

  /**
   * Prepare document data for export, remapping references and applying field mappers
   */
  async prepareDocumentData (doc: Doc, targetSpace: Ref<Space>, isAttached: boolean): Promise<Record<string, any>> {
    const hierarchy = this.targetClient.getHierarchy()
    const attributes = hierarchy.getAllAttributes(doc._class)
    const data: Record<string, any> = {}

    // First pass: Copy attributes using hierarchy info
    for (const [key] of Array.from(attributes)) {
      if (key === '_id' || key === '_class' || key === 'space') {
        continue
      }

      const value = (doc as any)[key]
      if (value === undefined) {
        continue
      }

      // For attached docs, still remap attachedTo reference (but not attachedToClass/collection)
      if (isAttached && key === 'attachedTo') {
        // Remap the attachedTo reference to the new target ID
        data[key] = this.remapValue(value, key)
        continue
      }

      if (isAttached && (key === 'attachedToClass' || key === 'collection')) {
        data[key] = value
        continue
      }

      // Remap references - use recursive remapping for all values
      data[key] = this.remapValue(value, key)
    }

    // Second pass: Check all doc properties for any missed references
    // This catches fields that might not be in getAllAttributes
    for (const key of Object.keys(doc)) {
      if (
        key === '_id' ||
        key === '_class' ||
        key === 'space' ||
        key === 'modifiedOn' ||
        key === 'modifiedBy' ||
        key === 'createdOn' ||
        key === 'createdBy'
      ) {
        continue
      }

      // Skip if already processed
      if (data[key] !== undefined) {
        continue
      }

      const value = (doc as any)[key]
      if (value === undefined) {
        continue
      }

      data[key] = this.remapValue(value, key)
    }

    // Apply field mappers for specific document classes
    await this.applyFieldMappers(doc._class, data)

    // Person refs are workspace-local, drop the ones that do not exist in the target workspace
    await this.dropUnknownPersonRefs(doc._class, data)

    return data
  }

  /**
   * Removes references to persons that do not exist in the target workspace from
   * array attributes typed as ArrOf(RefTo(Person | Employee)), e.g. approvers/reviewers.
   * Such dangling refs are invisible in the UI but still counted, which leads to
   * "phantom" members (e.g. an approval request that can never be completed).
   */
  private async dropUnknownPersonRefs (docClass: Ref<Class<Doc>>, data: Record<string, any>): Promise<void> {
    const hierarchy = this.targetClient.getHierarchy()
    const personFields: string[] = []

    for (const [key, attr] of hierarchy.getAllAttributes(docClass)) {
      const value = data[key]
      if (!Array.isArray(value) || value.length === 0) continue
      if (attr.type._class !== core.class.ArrOf) continue

      const itemType = (attr.type as ArrOf<Doc>).of
      if (itemType._class !== core.class.RefTo) continue

      const to = (itemType as RefTo<Doc>).to
      if (!hierarchy.isDerived(to, contact.class.Person)) continue

      personFields.push(key)
    }

    if (personFields.length === 0) return

    const unchecked = new Set<Ref<Person>>()
    for (const field of personFields) {
      for (const ref of data[field] as Array<Ref<Person>>) {
        if (typeof ref === 'string' && !this.personExistence.has(ref)) {
          unchecked.add(ref)
        }
      }
    }

    if (unchecked.size > 0) {
      const found = await this.targetClient.findAll(contact.class.Person, { _id: { $in: Array.from(unchecked) } })
      const foundIds = new Set<Ref<Person>>(found.map((p) => p._id))
      for (const ref of unchecked) {
        this.personExistence.set(ref, foundIds.has(ref))
      }
    }

    for (const field of personFields) {
      const refs = data[field] as Array<Ref<Person>>
      const filtered = refs.filter((ref) => this.personExistence.get(ref) === true)
      if (filtered.length !== refs.length) {
        this.context.warn(
          `Dropped ${refs.length - filtered.length} unknown person ref(s) from ${field} of ${docClass} in target workspace`
        )
        data[field] = filtered
      }
    }
  }

  /**
   * Apply field mappers for specific document classes.
   * Field mappers format: { className: { fieldName: value, ... } }
   * Special values:
   * - '$currentUser' is replaced with current account's employee ID
   * - '$generateSeqNumber' generates seqNumber based on minimum available value
   * - '$preserveUniqueCode' marks the code as allocated on document creation, which
   *   preserves it when free and renumbers it on conflict
   */
  private async applyFieldMappers (docClass: Ref<Class<Doc>>, data: Record<string, any>): Promise<void> {
    const fieldMapper = this.findFieldMapper(docClass)

    if (fieldMapper === undefined) {
      return
    }

    // Apply field mappings
    for (const [fieldName, fieldValue] of Object.entries(fieldMapper)) {
      // Handle special $currentUser value
      if (fieldValue === '$currentUser') {
        if (this.currentAccountEmployeeId !== undefined) {
          data[fieldName] = this.currentAccountEmployeeId
          this.context.info(`Mapped ${fieldName}: $currentUser -> ${this.currentAccountEmployeeId}`)
        } else {
          this.context.warn(`Cannot map ${fieldName}: $currentUser but current account employee not found`)
        }
      } else if (fieldValue === '$generateSeqNumber') {
        // Generate seqNumber based on minimum available value
        await this.generateSeqNumber(docClass, data)
      } else if (fieldValue === '$preserveUniqueCode') {
        await this.preserveUniqueCode(docClass, data)
      } else if (fieldValue === '') {
        // Empty string means clear the field
        data[fieldName] = undefined
      } else {
        // Direct value assignment
        data[fieldName] = fieldValue
      }
    }
  }

  /**
   * Generate seqNumber based on minimum available value.
   * Uses max + 1 from existing seqNumbers with the same prefix.
   * Similar to calculateNextSeqNumberWithCheck.
   */
  private async generateSeqNumber (docClass: Ref<Class<Doc>>, data: Record<string, any>): Promise<void> {
    const documentPrefix = data.prefix
    if (documentPrefix === undefined || typeof documentPrefix !== 'string' || documentPrefix === '') {
      this.context.warn('generateSeqNumber: prefix is required but not found, skipping seqNumber generation')
      return
    }

    // Query all documents with the same prefix
    const query: any = { prefix: documentPrefix }
    const projection = { seqNumber: 1, prefix: 1 } as any

    const existingDocs = await this.targetClient.findAll(docClass, query, { projection })

    // Extract all seqNumbers from existing documents
    const existingSeqNumbers = new Set<number>()
    for (const doc of existingDocs) {
      const seqNum = (doc as any).seqNumber
      if (seqNum !== undefined && seqNum !== null && typeof seqNum === 'number') {
        existingSeqNumbers.add(seqNum)
      }
    }

    // Also check values used in this export batch for this specific prefix
    // Use composite key to track seqNumbers per prefix
    const seqNumberKey = `seqNumber:${documentPrefix}`
    if (this.state.uniqueFieldValues !== undefined) {
      const classKey = docClass
      const fieldMap = this.state.uniqueFieldValues.get(classKey)
      if (fieldMap !== undefined) {
        const usedValues = fieldMap.get(seqNumberKey)
        if (usedValues !== undefined) {
          for (const usedValue of usedValues) {
            if (typeof usedValue === 'number') {
              existingSeqNumbers.add(usedValue)
            }
          }
        }
      }
    }

    // Find next available seqNumber (max + 1)
    const minAvailable = existingSeqNumbers.size > 0 ? Math.max(...Array.from(existingSeqNumbers)) + 1 : 1

    data.seqNumber = minAvailable

    // Track this value in uniqueFieldValues per prefix
    if (this.state.uniqueFieldValues === undefined) {
      this.state.uniqueFieldValues = new Map()
    }
    const classKey = docClass
    if (!this.state.uniqueFieldValues.has(classKey)) {
      this.state.uniqueFieldValues.set(classKey, new Map())
    }
    let fieldMap = this.state.uniqueFieldValues.get(classKey)
    if (fieldMap === undefined) {
      fieldMap = new Map()
      this.state.uniqueFieldValues.set(classKey, fieldMap)
    }
    if (!fieldMap.has(seqNumberKey)) {
      fieldMap.set(seqNumberKey, new Set())
    }
    const usedValues = fieldMap.get(seqNumberKey)
    if (usedValues !== undefined) {
      usedValues.add(minAvailable)
    }

    this.context.info(
      `generateSeqNumber: Generated seqNumber ${minAvailable} for prefix "${documentPrefix}" (class: ${docClass})`
    )
  }

  /**
   * Validates the code and leaves it as is: the value is allocated by the document exporter,
   * which can retry the creation when the code turns out to be taken.
   */
  private async preserveUniqueCode (docClass: Ref<Class<Doc>>, data: Record<string, any>): Promise<void> {
    if (typeof data.code !== 'string' || data.code === '') {
      this.context.warn('preserveUniqueCode: code is required but not found, skipping code preservation')
      return
    }

    const parsedCode = parseIdentifier(data.code)
    if (parsedCode === null) {
      this.context.warn(`preserveUniqueCode: code ${data.code} has no numeric suffix, skipping conflict resolution`)
      return
    }

    this.context.info(
      `preserveUniqueCode: Deferred allocation of code ${data.code} for class ${docClass} to document creation`
    )
  }

  shouldAllocateIdentifier (docClass: Ref<Class<Doc>>): boolean {
    return this.findFieldMapper(docClass)?.code === '$preserveUniqueCode'
  }

  private findFieldMapper (docClass: Ref<Class<Doc>>): Record<string, any> | undefined {
    const exact = this.fieldMappers[docClass]
    if (exact !== undefined) return exact

    const hierarchy = this.targetClient.getHierarchy()
    let bestMapper: Record<string, any> | undefined
    let bestMapperClass: Ref<Class<Doc>> | undefined
    for (const [className, mapper] of Object.entries(this.fieldMappers)) {
      const mapperClass = className as Ref<Class<Doc>>
      if (
        hierarchy.isDerived(docClass, mapperClass) &&
        (bestMapperClass === undefined || hierarchy.isDerived(mapperClass, bestMapperClass))
      ) {
        bestMapper = mapper
        bestMapperClass = mapperClass
      }
    }
    return bestMapper
  }

  /**
   * Recursively remap a value, handling nested objects and arrays.
   */
  remapValue (value: any, fieldPath: string = ''): any {
    if (value === null || value === undefined) {
      return value
    }

    // String - check if it's an ID that needs remapping
    if (typeof value === 'string') {
      const refValue = value as Ref<Doc>
      const remapped = this.state.idMapping.get(refValue)
      if (remapped !== undefined) {
        return remapped
      }
      return value
    }

    // Array - remap each element
    if (Array.isArray(value)) {
      return value.map((v, i) => this.remapValue(v, `${fieldPath}[${i}]`))
    }

    // Object - recursively remap all properties
    if (typeof value === 'object') {
      const result: Record<string, any> = {}
      for (const [key, v] of Object.entries(value)) {
        result[key] = this.remapValue(v, fieldPath !== '' ? `${fieldPath}.${key}` : key)
      }
      return result
    }

    return value
  }
}
