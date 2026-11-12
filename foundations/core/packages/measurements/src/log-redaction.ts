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

const SENSITIVE_LOG_KEYS = new Set([
  'authorization',
  'cookie',
  'set-cookie',
  'password',
  'secret',
  'token',
  'accesstoken',
  'access_token',
  'refreshtoken',
  'refresh_token',
  'id_token',
  'client_secret',
  'apikey',
  'api_key',
  'privatekey'
])

// Fields of HTTP client errors (axios/gaxios/fetch wrappers) that carry request headers or response bodies
const SENSITIVE_ERROR_FIELDS = new Set(['config', 'request', 'response', 'headers', 'options'])

const errorPrinter = ({ message, stack, ...rest }: Error): object => {
  const safe: Record<string, any> = {}
  for (const [k, v] of Object.entries(rest)) {
    if (SENSITIVE_ERROR_FIELDS.has(k)) continue
    safe[k] = v
  }
  const status = (rest as any)?.response?.status
  if (status !== undefined) safe.responseStatus = status
  return { message, stack, ...safe }
}

/**
 * JSON replacer used for log output: expands errors without request/response details
 * and masks values of well-known sensitive keys.
 * @public
 */
export function logReplacer (key: string, value: any): any {
  if (key !== '' && SENSITIVE_LOG_KEYS.has(key.toLowerCase()) && value != null && value !== '') {
    return '[REDACTED]'
  }
  return value instanceof Error ? errorPrinter(value) : value
}

/**
 * Returns a copy of value that is safe to pass to a logger which does not use `logReplacer` itself
 * (util.inspect / prettyPrint based output). `key` is the field name the value is logged under, if any.
 * @public
 */
export function sanitizeForLog (value: any, key: string = ''): any {
  const replaced = logReplacer(key, value)
  if (replaced === null || typeof replaced !== 'object') return replaced
  try {
    return JSON.parse(JSON.stringify(replaced, logReplacer))
  } catch {
    // Not serializable (e.g. circular): keep original value
    return value
  }
}

const SENSITIVE_QUERY_PARAMS = new Set([
  'token',
  'inviteid',
  'access_token',
  'refresh_token',
  'id_token',
  'apikey',
  'api_key',
  'secret',
  'password',
  'code',
  'otp'
])

// JWT-like values: three base64url segments, header starts with `eyJ`
const JWT_PATTERN = /^eyJ[\w-]+\.[\w-]+\.[\w-]*$/

function safeDecode (value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

/**
 * Removes credentials (tokens, invite ids, OAuth codes, JWT-like values) from URL query string before logging.
 * @public
 */
export function redactUrl (url: string | undefined): string {
  if (url === undefined) return ''
  const qIdx = url.indexOf('?')
  if (qIdx === -1) return url
  const parts = url
    .slice(qIdx + 1)
    .split('&')
    .map((part) => {
      const eq = part.indexOf('=')
      if (eq === -1) return part
      const key = part.slice(0, eq)
      const value = safeDecode(part.slice(eq + 1))
      if (SENSITIVE_QUERY_PARAMS.has(safeDecode(key).toLowerCase()) || JWT_PATTERN.test(value)) {
        return `${key}=[REDACTED]`
      }
      return part
    })
  return `${url.slice(0, qIdx)}?${parts.join('&')}`
}

type HttpLogToken = (req: any, res: any, arg?: string) => string | undefined

/**
 * Access log format function for `morgan`: same output as morgan `short` format, but URL is passed through `redactUrl`.
 * Usage: `app.use(morgan(safeHttpLogFormat, { stream }))`
 * @public
 */
export function safeHttpLogFormat (tokens: Record<string, HttpLogToken>, req: any, res: any): string {
  const t = (name: string, arg?: string): string => tokens[name]?.(req, res, arg) ?? '-'
  const url = redactUrl(req.originalUrl ?? req.url)
  return `${t('remote-addr')} ${t('remote-user')} ${t('method')} ${url} HTTP/${t('http-version')} ${t('status')} ${t('res', 'content-length')} - ${t('response-time')} ms`
}
