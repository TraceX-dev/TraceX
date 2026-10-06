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

/**
 * Light theme only: email clients get color-scheme: light.
 * @public
 */
export const colors = {
  page: '#F2F2F6',
  card: '#FFFFFF',
  border: '#E4E4E9',
  divider: '#ECECF0',
  header: '#19191B',
  text: '#18181B',
  body: '#27272A',
  secondary: '#52525B',
  muted: '#6B6B76',
  faint: '#71717A',
  chipBg: '#F4F4F6',
  chipText: '#3F3F46',
  quoteBg: '#F8F8FA',
  quoteBar: '#D4D4DA',
  avatar: '#2B2B30',
  buttonBorder: '#D4D4DA',
  accent: '#F26B21',
  mentionBg: '#FFF0E6',
  mentionText: '#A8400C'
} as const

/**
 * @public
 */
export const font = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif"

/**
 * Content width of the email card, px.
 * @public
 */
export const contentWidth = 600

/**
 * Hosted images, relative to the front url.
 * @public
 */
export const assets = {
  logo: { path: '/tracex/email-logo.png', width: 135, height: 20 },
  cardIcon: { path: '/tracex/email-icon-card.png', width: 18, height: 18 }
} as const
