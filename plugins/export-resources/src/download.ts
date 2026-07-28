//
// Copyright © 2026 TraceX SAS.
//
// Licensed under the PolyForm Shield License 1.0.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://polyformproject.org/licenses/shield/1.0.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//
// See the License for the specific language governing permissions and
// limitations under the License.
//

/**
 * Trigger a browser download for a response body.
 *
 * Kept separate from the request so both the table export and older export buttons can share it.
 * @public
 */
export function downloadBlob (blob: Blob, fileName: string): void {
  const url = window.URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.style.display = 'none'
  anchor.href = url
  anchor.download = fileName
  document.body.appendChild(anchor)
  anchor.click()
  window.URL.revokeObjectURL(url)
  document.body.removeChild(anchor)
}

/**
 * Extract the file name the server chose, falling back to a caller supplied default.
 * @public
 */
export function fileNameFromResponse (res: Response, fallback: string): string {
  const disposition = res.headers.get('Content-Disposition')
  return disposition?.match(/filename="([^"]*)"/)?.[1] ?? fallback
}
