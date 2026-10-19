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

import { Request, Response } from 'express'
import { type SendMailOptions } from 'nodemailer'
import Mail from 'nodemailer/lib/mailer'
import { join } from 'path'

import { Analytics } from '@hcengineering/analytics'
import { configureAnalytics, createOpenTelemetryMetricsContext, SplitLogger } from '@hcengineering/analytics-service'
import { MeasureContext, newMetrics } from '@hcengineering/core'
import { initStatisticsContext } from '@hcengineering/server-core'

import config from './config'
import { MailClient } from './mail'
import { createServer, listen } from './server'
import { Endpoint } from './types'

export const main = async (): Promise<void> => {
  configureAnalytics('mail', process.env.VERSION ?? '0.7.0')
  Analytics.setTag('application', 'mail')
  const measureCtx = initStatisticsContext('mail', {
    factory: () =>
      createOpenTelemetryMetricsContext(
        'mail',
        {},
        {},
        newMetrics(),
        new SplitLogger('mail', {
          root: join(process.cwd(), 'logs'),
          enableConsole: (process.env.ENABLE_CONSOLE ?? 'true') === 'true'
        })
      )
  })
  const client = new MailClient()
  measureCtx.info('Mail service has been started')

  const endpoints: Endpoint[] = [
    {
      endpoint: '/send',
      type: 'post',
      handler: async (req, res) => {
        const { to } = req.body
        await measureCtx.with('send email', {}, (ctx) => handleSendMail(client, req, res, ctx), { to })
      }
    }
  ]

  if (config.authToken === undefined) {
    measureCtx.error('MAIL_AUTH_TOKEN is not set: all requests to the mail service will be rejected')
  }

  const server = listen(createServer(endpoints, { authToken: config.authToken }), config.port)

  const shutdown = (): void => {
    server.close(() => {
      process.exit()
    })
  }

  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
  process.on('uncaughtException', (e: any) => {
    measureCtx.error(e.message)
  })
  process.on('unhandledRejection', (e: any) => {
    measureCtx.error(e.message)
  })
}

export async function handleSendMail (
  client: MailClient,
  req: Request,
  res: Response,
  ctx: MeasureContext
): Promise<void> {
  // Authentication is enforced by the requireAuth middleware in server.ts
  const { from, to, subject, text, html, attachments, headers, password } = req.body ?? {}
  const typeError = validateTypes({ from, to, subject, text, html, password })
  if (typeError !== undefined) {
    ctx.warn('Invalid email request', { err: typeError })
    res.status(400).send({ err: typeError })
    return
  }
  const fromAddress = from ?? config.source
  if (text === undefined && html === undefined) {
    ctx.warn('Text and html are missing in email request', { from, to })
    res.status(400).send({ err: "'text' and 'html' are missing" })
    return
  }
  if (subject === undefined) {
    ctx.warn('Subject is missing in email request', { from, to })
    res.status(400).send({ err: "'subject' is missing" })
    return
  }
  if (to === undefined) {
    ctx.warn('To address is missing in email request', { from })
    res.status(400).send({ err: "'to' is missing" })
    return
  }
  if (fromAddress === undefined) {
    ctx.warn('From address is missing in email request', { to })
    res.status(400).send({ err: "'from' is missing" })
    return
  }
  const message: SendMailOptions = {
    from: fromAddress,
    to,
    subject,
    text,
    // Never let request data make nodemailer read local files or fetch URLs
    disableFileAccess: true,
    disableUrlAccess: true
  }
  // When sending system message, ensure we enable replying to a different domain as needed
  if (config.replyTo !== undefined && fromAddress === config.source) {
    message.replyTo = config.replyTo
  }
  if (html !== undefined) {
    message.html = html
  }
  if (headers !== undefined) {
    if (!isPlainObject(headers) || !Object.values(headers).every((v) => typeof v === 'string')) {
      res.status(400).send({ err: "'headers' must be an object with string values" })
      return
    }
    message.headers = headers as Record<string, string>
  }
  if (attachments !== undefined) {
    message.attachments = getAttachments(attachments)
  }
  try {
    await client.sendMessage(message, ctx, password)
  } catch (err: any) {
    ctx.error(err.message)
  }

  res.send()
}

function isPlainObject (v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

const isOptString = (v: unknown): boolean => v === undefined || typeof v === 'string'
const isAddress = (v: unknown): boolean =>
  typeof v === 'string' || (Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === 'string'))

function validateTypes (fields: Record<string, unknown>): string | undefined {
  // nodemailer treats objects like { path } / { href } in text/html as file/URL sources
  for (const key of ['from', 'subject', 'text', 'html', 'password']) {
    if (!isOptString(fields[key])) return `'${key}' must be a string`
  }
  if (fields.to !== undefined && !isAddress(fields.to)) return "'to' must be a string or array of strings"
  return undefined
}

function getAttachments (attachments: unknown): Mail.Attachment[] | undefined {
  if (attachments === undefined || attachments === null) {
    return undefined
  }
  if (!Array.isArray(attachments)) {
    console.error('attachments is not array')
    return undefined
  }
  // Only inline content is allowed. `path`, `href` and `raw` are intentionally not
  // forwarded: they make nodemailer read local files or fetch remote URLs.
  return attachments
    .filter((a): a is Record<string, unknown> => isPlainObject(a) && typeof a.content === 'string')
    .map((a) => {
      const attachment: Mail.Attachment = {
        content: a.content as string,
        contentType: typeof a.contentType === 'string' ? a.contentType : undefined,
        filename: typeof a.filename === 'string' ? a.filename : undefined,
        cid: typeof a.cid === 'string' ? a.cid : undefined,
        encoding: typeof a.encoding === 'string' ? a.encoding : undefined,
        contentTransferEncoding:
          a.contentTransferEncoding === 'base64' ||
          a.contentTransferEncoding === 'quoted-printable' ||
          a.contentTransferEncoding === '7bit'
            ? a.contentTransferEncoding
            : undefined
      }
      return attachment
    })
}
