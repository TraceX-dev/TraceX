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

import type { MeasureContext } from '@hcengineering/core'
import platform, { PlatformError } from '@hcengineering/platform'
import { decodeToken } from '@hcengineering/server-token'
import { createHmac, randomUUID } from 'crypto'

import type { AccountMethods } from './operations'
import type { AccountMethodHandler } from './types'

interface AuditSpec {
  action: string
  parameters?: Readonly<Record<string, string>>
  hashedParameters?: Readonly<Record<string, string>>
  outcomeOnly?: boolean
  unauthenticated?: boolean
}

interface AuditFields extends Record<string, string | number | boolean | string[] | undefined> {
  event?: string
}

export const ACCOUNT_AUDIT_SPECS: Partial<Record<AccountMethods, AuditSpec>> = {
  login: { action: 'account.login', unauthenticated: true, hashedParameters: { email: 'subjectEmailHash' } },
  loginOtp: { action: 'account.otp.request', unauthenticated: true, hashedParameters: { email: 'subjectEmailHash' } },
  loginAsGuest: { action: 'account.guest.login', unauthenticated: true },
  signUp: { action: 'account.signup', unauthenticated: true, hashedParameters: { email: 'subjectEmailHash' } },
  signUpOtp: {
    action: 'account.otp.signup.request',
    unauthenticated: true,
    hashedParameters: { email: 'subjectEmailHash' }
  },
  validateOtp: {
    action: 'account.otp.validate',
    unauthenticated: true,
    hashedParameters: { email: 'subjectEmailHash' }
  },
  confirm: { action: 'account.email.confirm' },
  changeUsername: { action: 'account.profile.name.change' },
  selectWorkspace: {
    action: 'workspace.token.issue',
    parameters: { workspaceUrl: 'targetWorkspaceUrl', kind: 'endpointKind' }
  },
  exchangeGuestToken: { action: 'account.guest.token.exchange' },
  refreshHulyAssistantToken: { action: 'account.assistant.token.refresh' },
  changePassword: { action: 'account.password.change' },
  requestPasswordReset: {
    action: 'account.password.reset.request',
    unauthenticated: true,
    hashedParameters: { email: 'subjectEmailHash' }
  },
  requestPasswordSetup: { action: 'account.password.setup.request' },
  restorePassword: { action: 'account.password.restore' },
  generate2faSecret: { action: 'account.2fa.secret.generate' },
  enable2fa: { action: 'account.2fa.enable' },
  disable2fa: { action: 'account.2fa.disable' },
  verify2fa: { action: 'account.2fa.verify' },
  deleteAccount: { action: 'account.delete', parameters: { uuid: 'targetAccountUuid' } },
  mergeSpecifiedAccounts: {
    action: 'account.merge',
    parameters: { primaryAccount: 'primaryAccount', secondaryAccount: 'secondaryAccount' }
  },
  mergeSpecifiedPersons: {
    action: 'person.merge',
    parameters: { primaryPerson: 'primaryPerson', secondaryPerson: 'secondaryPerson' }
  },
  addEmailSocialId: { action: 'account.social.add' },
  addHulyAssistantSocialId: { action: 'account.assistant.add' },
  releaseSocialId: {
    action: 'account.social.release',
    parameters: { personUuid: 'personUuid', type: 'type', deleteIntegrations: 'deleteIntegrations' }
  },
  addSocialIdToPerson: { action: 'person.social.add', parameters: { person: 'targetPersonUuid', type: 'type' } },
  updateSocialId: { action: 'person.social.update', parameters: { personId: 'targetSocialId' } },
  createWorkspace: { action: 'workspace.create', parameters: { region: 'region' } },
  deleteWorkspace: { action: 'workspace.deletion.schedule' },
  updateWorkspaceName: { action: 'workspace.rename' },
  performWorkspaceOperation: {
    action: 'workspace.operation.schedule',
    parameters: { workspaceId: 'targetWorkspaceUuid', event: 'workspaceEvent' }
  },
  updateWorkspaceInfo: {
    action: 'workspace.lifecycle.update',
    parameters: { workspaceUuid: 'targetWorkspaceUuid', event: 'workspaceEvent' }
  },
  assignWorkspace: {
    action: 'workspace.member.assign',
    parameters: { workspaceUuid: 'targetWorkspaceUuid', role: 'role' },
    hashedParameters: { email: 'targetEmailHash' }
  },
  leaveWorkspace: { action: 'workspace.member.remove', parameters: { account: 'targetAccountUuid' } },
  updateWorkspaceRole: {
    action: 'workspace.member.role.change',
    parameters: { targetAccount: 'targetAccountUuid', targetRole: 'targetRole' }
  },
  updateWorkspaceRoleBySocialKey: {
    action: 'workspace.member.role.change',
    parameters: { targetRole: 'targetRole' },
    hashedParameters: { socialKey: 'targetSocialKeyHash' }
  },
  updateAllowReadOnlyGuests: {
    action: 'workspace.guests.readonly.change',
    parameters: { readOnlyGuestsAllowed: 'readOnlyGuestsAllowed' }
  },
  updateAllowGuestSignUp: {
    action: 'workspace.guests.signup.change',
    parameters: { guestSignUpAllowed: 'guestSignUpAllowed' }
  },
  updatePasswordAgingRule: { action: 'workspace.password.policy.change', parameters: { days: 'days' } },
  batchAssignWorkspacePermission: {
    action: 'workspace.permission.assign',
    parameters: { accountIds: 'accountIds', permission: 'permission' }
  },
  batchRevokeWorkspacePermission: {
    action: 'workspace.permission.revoke',
    parameters: { accountIds: 'accountIds', permission: 'permission' }
  },
  createInvite: {
    action: 'workspace.invite.create',
    parameters: { role: 'role', exp: 'exp', limit: 'limit', autoJoin: 'autoJoin', isShareLink: 'isShareLink' }
  },
  createInviteLink: {
    action: 'workspace.invite.link.create',
    parameters: { role: 'role', expHours: 'expHours', autoJoin: 'autoJoin' }
  },
  revokeInviteLink: { action: 'workspace.invite.revoke', hashedParameters: { id: 'inviteIdHash' } },
  createAccessLink: { action: 'workspace.access.link.create' },
  sendInvite: { action: 'workspace.invite.send' },
  resendInvite: { action: 'workspace.invite.resend' },
  join: { action: 'workspace.member.join', unauthenticated: true },
  joinByToken: { action: 'workspace.member.join' },
  checkAutoJoin: { action: 'workspace.member.autojoin' },
  signUpJoin: { action: 'workspace.member.signup.join', unauthenticated: true },
  createApiKey: { action: 'account.api-key.create' },
  revokeApiKey: { action: 'account.api-key.revoke', parameters: { id: 'apiKeyId' } },
  createMailbox: { action: 'account.mailbox.create' },
  deleteMailbox: { action: 'account.mailbox.delete' },
  getMailboxSecret: { action: 'account.mailbox.secret.read' },
  createIntegration: {
    action: 'integration.create',
    parameters: { workspaceUuid: 'targetWorkspaceUuid', socialId: 'socialId', kind: 'kind' }
  },
  updateIntegration: {
    action: 'integration.update',
    parameters: { workspaceUuid: 'targetWorkspaceUuid', socialId: 'socialId', kind: 'kind' }
  },
  deleteIntegration: {
    action: 'integration.delete',
    parameters: { workspaceUuid: 'targetWorkspaceUuid', socialId: 'socialId', kind: 'kind' }
  },
  addIntegrationSecret: {
    action: 'integration.secret.add',
    parameters: { workspaceUuid: 'targetWorkspaceUuid', socialId: 'socialId', kind: 'kind' }
  },
  updateIntegrationSecret: {
    action: 'integration.secret.update',
    parameters: { workspaceUuid: 'targetWorkspaceUuid', socialId: 'socialId', kind: 'kind' }
  },
  deleteIntegrationSecret: {
    action: 'integration.secret.delete',
    parameters: { workspaceUuid: 'targetWorkspaceUuid', socialId: 'socialId', kind: 'kind' }
  },
  getIntegrationSecret: {
    action: 'integration.secret.read',
    outcomeOnly: true,
    parameters: { workspaceUuid: 'targetWorkspaceUuid', socialId: 'socialId', kind: 'kind' }
  },
  listIntegrationsSecrets: {
    action: 'integration.secrets.list',
    outcomeOnly: true,
    parameters: { workspaceUuid: 'targetWorkspaceUuid', kind: 'kind' }
  }
}

function asRecord (value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function identifier (value: unknown): string | undefined {
  return typeof value === 'string' && /^[a-zA-Z0-9_:.-]{1,128}$/.test(value) ? value : undefined
}

function getActor (token: string | undefined, unauthenticated: boolean | undefined): AuditFields {
  if (unauthenticated === true || token == null || token === '') return {}
  try {
    // Never attribute an operation using unverified claims or a stale public-method token.
    const decoded = decodeToken(token)
    return {
      actorAccountUuid: identifier(decoded.account),
      workspaceUuid: identifier(decoded.workspace),
      actorService: identifier(decoded.extra?.service),
      actorIsAdmin: decoded.extra?.admin === 'true',
      actorUsesApiKey: decoded.extra?.apiKey != null,
      authenticationSubjectUuid: identifier(decoded.extra?.tfaAccount),
      authenticationPending: decoded.extra?.tfaAccount != null
    }
  } catch {
    return {}
  }
}

function getParameters (spec: AuditSpec, params: Record<string, unknown>): AuditFields {
  const fields: AuditFields = {}
  for (const [key, name] of Object.entries(spec.parameters ?? {})) {
    const value = params[key]
    if (typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) {
      fields[name] = value
    } else if (Array.isArray(value)) {
      fields[name] = value
        .slice(0, 100)
        .map(identifier)
        .filter((it): it is string => it !== undefined)
      fields[`${name}Count`] = value.length
    } else {
      fields[name] = identifier(value)
    }
  }
  const hashKey = process.env.ACCOUNT_AUDIT_HMAC_KEY || process.env.SERVER_SECRET
  for (const [key, name] of Object.entries(spec.hashedParameters ?? {})) {
    const value = params[key]
    if (hashKey == null || typeof value !== 'string' || value.length === 0 || value.length > 4096) continue
    const normalized = key === 'email' || key === 'socialKey' ? value.trim().toLowerCase() : value
    fields[name] = createHmac('sha256', hashKey)
      .update('tracex-account-audit:v1\0')
      .update(name)
      .update('\0')
      .update(normalized)
      .digest('hex')
  }
  return fields
}

function emit (ctx: MeasureContext, fields: AuditFields, outcome: string): void {
  try {
    const event: AuditFields = { ...fields, eventId: randomUUID(), outcome }
    if (outcome === 'denied') {
      ctx.warn('Account audit event', event)
    } else if (outcome === 'failed') {
      ctx.error('Account audit event', event)
    } else {
      ctx.info('Account audit event', event)
    }
  } catch {
    // Telemetry failures must not replace the business result or error.
  }
}

function errorCode (error: unknown): string {
  if (error instanceof PlatformError) return error.status.code
  return identifier(asRecord(error).code) ?? platform.status.InternalServerError
}

const CREDENTIAL_METHODS = new Set<string>([
  'login',
  'loginOtp',
  'signUpOtp',
  'validateOtp',
  'verify2fa',
  'enable2fa',
  'disable2fa',
  'changePassword'
])
const CREDENTIAL_DENIALS = new Set<string>([
  platform.status.AccountNotFound,
  platform.status.PasswordLoginLocked,
  platform.status.InvalidOtp,
  platform.status.OtpLocked
])

/** Distinguish expected credential/access denials from operation and server failures. */
export function isAccountAuditDenial (method: string, code: string): boolean {
  return (
    code === platform.status.Forbidden ||
    code === platform.status.Unauthorized ||
    (CREDENTIAL_METHODS.has(method) && CREDENTIAL_DENIALS.has(code))
  )
}

function errorOutcome (method: string, code: string): string {
  return isAccountAuditDenial(method, code) ? 'denied' : 'failed'
}

function auditedMethod (method: string, spec: AuditSpec, handler: AccountMethodHandler): AccountMethodHandler {
  return async (ctx, db, branding, request, token, params, meta) => {
    const parameters = asRecord(asRecord(request).params)
    // Heartbeats and progress are high volume and do not describe a lifecycle transition.
    if (method === 'updateWorkspaceInfo' && ['ping', 'progress'].includes(String(parameters.event))) {
      return await handler(ctx, db, branding, request, token, params, meta)
    }
    const fields: AuditFields = {
      audit: true,
      event: spec.action,
      method,
      operationId: randomUUID(),
      ...getActor(token, spec.unauthenticated),
      ...getParameters(spec, parameters)
    }
    if (spec.outcomeOnly !== true) emit(ctx, fields, 'requested')
    try {
      const response: unknown = await handler(ctx, db, branding, request, token, params, meta)
      const rpc = asRecord(response)
      if (rpc.error != null) {
        const code = identifier(asRecord(rpc.error).code) ?? platform.status.InternalServerError
        emit(ctx, { ...fields, errorCode: code }, errorOutcome(method, code))
      } else {
        const result = asRecord(rpc.result)
        const completion: AuditFields = {
          ...fields,
          subjectAccountUuid: identifier(result.account),
          resultWorkspaceUuid: identifier(result.workspace),
          apiKeyId: identifier(asRecord(result.apiKey).id) ?? fields.apiKeyId
        }
        if (typeof result.tfaRequired === 'boolean') completion.tfaRequired = result.tfaRequired
        if (['login', 'loginAsGuest', 'verify2fa'].includes(method)) {
          completion.authenticationComplete =
            typeof result.token === 'string' && result.token.length > 0 && result.tfaRequired !== true
        }
        // Success describes the RPC outcome, not full authentication or an asynchronous job's completion.
        emit(ctx, completion, rpc.result === false ? 'not-applied' : 'succeeded')
      }
      return response
    } catch (error) {
      const code = errorCode(error)
      emit(ctx, { ...fields, errorCode: code }, errorOutcome(method, code))
      throw error
    }
  }
}

/** Add unsampled structured outcome logs around selected RPCs, including guest-policy denials. */
export function auditAccountMethods (
  methods: Partial<Record<AccountMethods, AccountMethodHandler>>
): Partial<Record<AccountMethods, AccountMethodHandler>> {
  const result: Partial<Record<AccountMethods, AccountMethodHandler>> = { ...methods }
  for (const method of Object.keys(ACCOUNT_AUDIT_SPECS)) {
    const key = method as AccountMethods
    const handler = methods[key]
    const spec = ACCOUNT_AUDIT_SPECS[key]
    if (handler !== undefined && spec !== undefined) result[key] = auditedMethod(key, spec, handler)
  }
  return result
}
