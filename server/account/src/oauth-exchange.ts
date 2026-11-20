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

import {
  docGuestAccountUuid,
  readOnlyGuestAccountUuid,
  systemAccountUuid,
  type Branding,
  type MeasureContext
} from '@hcengineering/core'
import platform, { PlatformError, Severity, Status } from '@hcengineering/platform'
import { decodeTokenVerbose } from '@hcengineering/server-token'
import { issueExternalAccess } from './external-access'
import { getLoginInfoByToken } from './operations'
import type { AccountDB } from './types'

/** Exchanges a complete user session only for the authenticated, short-lived OAuth issuer. */
export async function exchangeOAuthToken (
  ctx: MeasureContext,
  db: AccountDB,
  branding: Branding | null,
  serviceToken: string,
  params: { accountToken: string, source: string, connectionId: string }
): Promise<string> {
  const service = decodeTokenVerbose(ctx, serviceToken)
  const now = Math.floor(Date.now() / 1000)
  if (
    service.account !== systemAccountUuid ||
    service.extra?.service !== 'openauth' ||
    service.workspace != null ||
    service.grant != null ||
    service.sub != null ||
    typeof service.exp !== 'number' ||
    !Number.isFinite(service.exp) ||
    service.exp <= now ||
    service.exp > now + 60
  ) {
    throw new PlatformError(new Status(Severity.ERROR, platform.status.Forbidden, {}))
  }
  const { accountToken: token, connectionId } = params
  if (
    typeof token !== 'string' ||
    token === '' ||
    typeof connectionId !== 'string' ||
    connectionId.length === 0 ||
    connectionId.length > 128
  ) {
    throw new PlatformError(new Status(Severity.ERROR, platform.status.BadRequest, {}))
  }
  const decoded = decodeTokenVerbose(ctx, token)
  const { account, extra } = decoded
  if (
    account === systemAccountUuid ||
    account === readOnlyGuestAccountUuid ||
    account === docGuestAccountUuid ||
    decoded.grant != null ||
    decoded.sub != null ||
    extra?.externalSocialId != null ||
    extra?.apiKey != null ||
    extra?.service != null ||
    extra?.guest != null ||
    extra?.restoreEmail != null ||
    extra?.confirmEmail != null ||
    extra?.tfaAccount != null
  ) {
    throw new PlatformError(new Status(Severity.ERROR, platform.status.Forbidden, {}))
  }
  const login = await getLoginInfoByToken(ctx, db, branding, token)
  if (
    login == null ||
    'request' in login ||
    login.tfaRequired === true ||
    login.account !== account ||
    login.token == null
  ) {
    throw new PlatformError(new Status(Severity.ERROR, platform.status.Unauthorized, {}))
  }
  const issued = await issueExternalAccess(db, account, params.source, {
    kind: 'oauth',
    connectionId,
    session: { extra, exp: decoded.exp, nbf: decoded.nbf }
  })
  return issued.token
}
