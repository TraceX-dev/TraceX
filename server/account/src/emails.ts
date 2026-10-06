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

import { type Branding } from '@hcengineering/core'
import {
  emailAppName,
  join,
  link,
  renderEmail,
  text,
  trusted,
  type EmailAction,
  type EmailBlock
} from '@hcengineering/email-templates'
import { getMetadata, translate, type IntlString } from '@hcengineering/platform'

import { accountPlugin } from './plugin'

/**
 * Emails sent by the account service.
 * @public
 */
export type AccountEmail = 'otp' | 'confirmation' | 'invite' | 'resendInvite' | 'recovery' | 'passwordSetup'

interface AccountEmailSpec {
  title: IntlString
  body: IntlString
  /** Second paragraph. */
  details?: IntlString
  /** Show `code` from the params as a large code. */
  code?: boolean
  /** Button label; the button opens `link` from the params. */
  button?: IntlString
  note: IntlString
}

const specs: Record<AccountEmail, AccountEmailSpec> = {
  otp: {
    title: accountPlugin.string.OtpEmailTitle,
    body: accountPlugin.string.OtpEmailBody,
    code: true,
    note: accountPlugin.string.OtpEmailNote
  },
  confirmation: {
    title: accountPlugin.string.ConfirmationEmailTitle,
    body: accountPlugin.string.ConfirmationEmailBody,
    button: accountPlugin.string.ConfirmationEmailButton,
    note: accountPlugin.string.ConfirmationEmailNote
  },
  invite: {
    title: accountPlugin.string.InviteEmailTitle,
    body: accountPlugin.string.InviteEmailBody,
    button: accountPlugin.string.InviteEmailButton,
    note: accountPlugin.string.InviteEmailNote
  },
  resendInvite: {
    title: accountPlugin.string.ResendInviteEmailTitle,
    body: accountPlugin.string.ResendInviteEmailBody,
    button: accountPlugin.string.InviteEmailButton,
    note: accountPlugin.string.ResendInviteEmailNote
  },
  recovery: {
    title: accountPlugin.string.RecoveryEmailTitle,
    body: accountPlugin.string.RecoveryEmailBody,
    button: accountPlugin.string.RecoveryEmailButton,
    note: accountPlugin.string.RecoveryEmailNote
  },
  passwordSetup: {
    title: accountPlugin.string.PasswordSetupEmailTitle,
    body: accountPlugin.string.PasswordSetupEmailBody,
    details: accountPlugin.string.PasswordSetupEmailDetails,
    button: accountPlugin.string.PasswordSetupEmailButton,
    note: accountPlugin.string.PasswordSetupEmailNote
  }
}

/**
 * Product name shown in account emails.
 * @public
 */
export function getEmailAppName (branding: Branding | null): string {
  return emailAppName(branding?.title, getMetadata(accountPlugin.metadata.ProductName))
}

/**
 * HTML of an account email in the shared TraceX email layout, translated to the branding language.
 * Params are plain values (`code`, `link`, `ws`, `name`, `expHours`); they are escaped when rendered.
 * @public
 */
export async function renderAccountEmail (
  kind: AccountEmail,
  params: Record<string, string | number>,
  branding: Branding | null
): Promise<string> {
  const spec = specs[kind]
  const lang = branding?.language
  const app = getEmailAppName(branding)
  const values: Record<string, string | number> = { app, ...params }
  const t = async (id: IntlString): Promise<string> => await translate(id, values, lang)

  const body = await t(spec.body)
  const blocks: EmailBlock[] = [{ type: 'paragraph', body: text(body) }]
  if (spec.details !== undefined) {
    blocks.push({ type: 'paragraph', body: text(await t(spec.details)) })
  }
  if (spec.code === true) {
    blocks.push({ type: 'code', code: String(params.code ?? '') })
  }

  const actions: EmailAction[] = []
  const afterActions: EmailBlock[] = []
  const href = params.link !== undefined ? String(params.link) : undefined
  if (spec.button !== undefined && href !== undefined) {
    actions.push({ label: await t(spec.button), href, primary: true })
    afterActions.push({
      type: 'note',
      body: join([text(await t(accountPlugin.string.EmailLinkFallback)), trusted('<br>'), link(href, href)])
    })
  }

  return renderEmail({
    frontUrl: branding?.front ?? getMetadata(accountPlugin.metadata.FrontURL) ?? '',
    appName: app,
    lang,
    preheader: body,
    title: await t(spec.title),
    blocks,
    actions,
    afterActions,
    reason: await t(spec.note),
    copyright: await t(accountPlugin.string.EmailCopyright)
  })
}
