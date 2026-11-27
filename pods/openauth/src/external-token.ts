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

import { getClient } from '@hcengineering/account-client'
import {
  docGuestAccountUuid,
  externalIdentityValue,
  normalizeExternalSource,
  readOnlyGuestAccountUuid,
  SocialIdType,
  systemAccountUuid,
  type AccountUuid
} from '@hcengineering/core'
import type { MeasureContext } from '@hcengineering/measurements'
import { decodeToken, generateToken, TokenError } from '@hcengineering/server-token'
import type { OAuthConnection } from './types'

export class InvalidOAuthSessionError extends Error {
  constructor () {
    super('Invalid OAuth user session')
  }
}

/** Validates an ordinary user session for consent and access renewal. */
export async function authenticateOAuthSession (
  ctx: MeasureContext,
  accountsUrl: string,
  secret: string,
  token: string,
  requireAccountToken: boolean
): Promise<{ account: AccountUuid, token: string }> {
  return await ctx.with(
    'openauth.accounts.authenticate',
    {},
    async (authCtx) => {
      let decoded: ReturnType<typeof decodeToken>
      try {
        decoded = decodeToken(token, true, secret)
      } catch (error: unknown) {
        if (error instanceof TokenError) throw new InvalidOAuthSessionError()
        throw error
      }
      if (
        decoded.account === systemAccountUuid ||
        decoded.account === readOnlyGuestAccountUuid ||
        decoded.account === docGuestAccountUuid ||
        decoded.grant != null ||
        decoded.sub != null ||
        decoded.extra?.externalSocialId != null ||
        decoded.extra?.apiKey != null ||
        decoded.extra?.service != null ||
        decoded.extra?.restoreEmail != null ||
        decoded.extra?.confirmEmail != null ||
        decoded.extra?.tfaAccount != null ||
        decoded.extra?.guest != null
      ) {
        throw new InvalidOAuthSessionError()
      }
      const login = await authCtx.with(
        'openauth.accounts.get-login-info',
        {},
        async () => await getClient(accountsUrl, token).getLoginInfoByToken(),
        undefined,
        { suspendErrors: true }
      )
      if (
        login == null ||
        'request' in login ||
        login.account !== decoded.account ||
        login.tfaRequired === true ||
        login.primarySocialId == null
      ) {
        throw new InvalidOAuthSessionError()
      }
      // Same normalization as accounts PUT /cookie: ordinary sessions can be used without a workspace.
      const accountToken =
        requireAccountToken && decoded.workspace != null
          ? generateToken(decoded.account, undefined, decoded.extra, secret, { exp: decoded.exp, nbf: decoded.nbf })
          : token
      return { account: decoded.account, token: accountToken }
    },
    undefined,
    { suspendErrors: true }
  )
}

/** Resolves an external author through the account RPC and signs access limited by the original session. */
export async function exchangeExternalAccess (
  ctx: MeasureContext,
  accountsUrl: string,
  secret: string,
  connection: Pick<OAuthConnection, 'id' | 'account' | 'accountToken' | 'source'>,
  accessExpiresAt: number
): Promise<{ token: string, expiresAt: number }> {
  return await ctx.with(
    'openauth.accounts.exchange-external-access',
    {},
    async (exchangeCtx) => {
      const authenticated = await authenticateOAuthSession(
        exchangeCtx,
        accountsUrl,
        secret,
        connection.accountToken,
        false
      )
      if (authenticated.account !== connection.account) throw new InvalidOAuthSessionError()
      const session = decodeToken(authenticated.token, true, secret)
      const expiresAt = Math.min(accessExpiresAt, session.exp ?? accessExpiresAt)
      if (!Number.isFinite(expiresAt) || expiresAt <= Math.floor(Date.now() / 1000)) {
        throw new Error('Invalid OAuth account delegation expiration')
      }
      const source = normalizeExternalSource(connection.source ?? 'external')
      const serviceToken = generateToken(systemAccountUuid, undefined, { service: 'openauth' }, secret, {
        exp: Math.floor(Date.now() / 1000) + 60
      })
      const externalSocialId = await getClient(accountsUrl, serviceToken).addSocialIdToPerson(
        session.account,
        SocialIdType.EXTERNAL,
        externalIdentityValue(session.account, source),
        true,
        source
      )
      if (typeof externalSocialId !== 'string' || externalSocialId === '') {
        throw new Error('Invalid OAuth external identity response')
      }
      const extra = {
        ...session.extra,
        externalSource: source,
        externalSocialId,
        externalConnectionId: connection.id
      }
      return {
        token: generateToken(session.account, undefined, extra, secret, { exp: expiresAt, nbf: session.nbf }),
        expiresAt
      }
    },
    undefined,
    { suspendErrors: true }
  )
}
