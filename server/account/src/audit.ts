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
import { randomUUID } from 'crypto'

import type { AccountMethods } from './operations'
import type { AccountMethodHandler } from './types'

interface AuditSpec {
  action: string
  parameters?: readonly string[]
  unauthenticated?: boolean
}

interface AuditFields extends Record<string, string | number | boolean | string[] | undefined> {
  event?: string
}

const AUDIT_METHODS: Partial<Record<AccountMethods, AuditSpec>> = {
  login: { action: 'account.login', unauthenticated: true },
  loginOtp: { action: 'account.otp.request', unauthenticated: true },
  loginAsGuest: { action: 'account.guest.login', unauthenticated: true },
  signUp: { action: 'account.signup', unauthenticated: true },
  signUpOtp: { action: 'account.otp.signup.request', unauthenticated: true },
  validateOtp: { action: 'account.otp.validate', unauthenticated: true },
  confirm: { action: 'account.email.confirm' },
  changePassword: { action: 'account.password.change' },
  requestPasswordReset: { action: 'account.password.reset.request', unauthenticated: true },
  requestPasswordSetup: { action: 'account.password.setup.request' },
  restorePassword: { action: 'account.password.restore' },
  generate2faSecret: { action: 'account.2fa.secret.generate' },
  enable2fa: { action: 'account.2fa.enable' },
  disable2fa: { action: 'account.2fa.disable' },
  verify2fa: { action: 'account.2fa.verify' },
  deleteAccount: { action: 'account.delete', parameters: ['uuid'] },
  mergeSpecifiedAccounts: { action: 'account.merge', parameters: ['primaryAccount', 'secondaryAccount'] },
  mergeSpecifiedPersons: { action: 'person.merge', parameters: ['primaryPerson', 'secondaryPerson'] },
  addEmailSocialId: { action: 'account.social.add' },
  addHulyAssistantSocialId: { action: 'account.assistant.add' },
  releaseSocialId: { action: 'account.social.release', parameters: ['personUuid', 'type', 'deleteIntegrations'] },
  addSocialIdToPerson: { action: 'person.social.add', parameters: ['personUuid', 'type'] },
  updateSocialId: { action: 'person.social.update', parameters: ['personUuid', 'type'] },
  createWorkspace: { action: 'workspace.create', parameters: ['region'] },
  deleteWorkspace: { action: 'workspace.deletion.schedule' },
  updateWorkspaceName: { action: 'workspace.rename' },
  performWorkspaceOperation: { action: 'workspace.operation.schedule', parameters: ['workspaceId', 'event'] },
  updateWorkspaceInfo: { action: 'workspace.lifecycle.update', parameters: ['workspaceUuid', 'event'] },
  assignWorkspace: { action: 'workspace.member.assign', parameters: ['workspaceUuid', 'role'] },
  leaveWorkspace: { action: 'workspace.member.remove', parameters: ['account'] },
  updateWorkspaceRole: { action: 'workspace.member.role.change', parameters: ['targetAccount', 'targetRole'] },
  updateWorkspaceRoleBySocialKey: { action: 'workspace.member.role.change', parameters: ['targetRole'] },
  updateAllowReadOnlyGuests: { action: 'workspace.guests.readonly.change', parameters: ['readOnlyGuestsAllowed'] },
  updateAllowGuestSignUp: { action: 'workspace.guests.signup.change', parameters: ['guestSignUpAllowed'] },
  updatePasswordAgingRule: { action: 'workspace.password.policy.change', parameters: ['days'] },
  batchAssignWorkspacePermission: { action: 'workspace.permission.assign', parameters: ['accountIds', 'permission'] },
  batchRevokeWorkspacePermission: { action: 'workspace.permission.revoke', parameters: ['accountIds', 'permission'] },
  createInvite: { action: 'workspace.invite.create', parameters: ['role', 'exp', 'limit', 'autoJoin', 'isShareLink'] },
  createInviteLink: { action: 'workspace.invite.link.create', parameters: ['role', 'expHours', 'autoJoin'] },
  revokeInviteLink: { action: 'workspace.invite.revoke' },
  createAccessLink: { action: 'workspace.access.link.create' },
  sendInvite: { action: 'workspace.invite.send' },
  resendInvite: { action: 'workspace.invite.resend' },
  join: { action: 'workspace.member.join' },
  joinByToken: { action: 'workspace.member.join' },
  checkAutoJoin: { action: 'workspace.member.autojoin' },
  signUpJoin: { action: 'workspace.member.signup.join' },
  createApiKey: { action: 'account.api-key.create' },
  revokeApiKey: { action: 'account.api-key.revoke', parameters: ['id'] },
  createMailbox: { action: 'account.mailbox.create' },
  deleteMailbox: { action: 'account.mailbox.delete' },
  getMailboxSecret: { action: 'account.mailbox.secret.read' },
  createIntegration: { action: 'integration.create', parameters: ['workspaceUuid', 'socialId', 'kind'] },
  updateIntegration: { action: 'integration.update', parameters: ['workspaceUuid', 'socialId', 'kind'] },
  deleteIntegration: { action: 'integration.delete', parameters: ['workspaceUuid', 'socialId', 'kind'] },
  addIntegrationSecret: { action: 'integration.secret.add', parameters: ['workspaceUuid', 'socialId', 'kind'] },
  updateIntegrationSecret: { action: 'integration.secret.update', parameters: ['workspaceUuid', 'socialId', 'kind'] },
  deleteIntegrationSecret: { action: 'integration.secret.delete', parameters: ['workspaceUuid', 'socialId', 'kind'] },
  getIntegrationSecret: { action: 'integration.secret.read', parameters: ['workspaceUuid', 'socialId', 'kind'] },
  listIntegrationsSecrets: { action: 'integration.secrets.list', parameters: ['workspaceUuid', 'kind'] }
}

const PARAMETER_NAMES: Record<string, string> = {
  uuid: 'targetAccountUuid',
  account: 'targetAccountUuid',
  targetAccount: 'targetAccountUuid',
  workspaceId: 'targetWorkspaceUuid',
  workspaceUuid: 'targetWorkspaceUuid',
  event: 'workspaceEvent',
  id: 'apiKeyId'
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
      actorService: identifier(decoded.extra?.service) ?? 'unknown',
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
  for (const key of spec.parameters ?? []) {
    const value = params[key]
    const name = PARAMETER_NAMES[key] ?? key
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

function errorOutcome (code: string): string {
  return code === platform.status.Forbidden || code === platform.status.Unauthorized ? 'denied' : 'failed'
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
    emit(ctx, fields, 'requested')
    try {
      const response: unknown = await handler(ctx, db, branding, request, token, params, meta)
      const rpc = asRecord(response)
      if (rpc.error != null) {
        const code = identifier(asRecord(rpc.error).code) ?? platform.status.InternalServerError
        emit(ctx, { ...fields, errorCode: code }, errorOutcome(code))
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
      emit(ctx, { ...fields, errorCode: code }, errorOutcome(code))
      throw error
    }
  }
}

/** Add unsampled structured outcome logs around selected RPCs, including guest-policy denials. */
export function auditAccountMethods (
  methods: Partial<Record<AccountMethods, AccountMethodHandler>>
): Partial<Record<AccountMethods, AccountMethodHandler>> {
  const result: Partial<Record<AccountMethods, AccountMethodHandler>> = { ...methods }
  for (const method of Object.keys(AUDIT_METHODS)) {
    const key = method as AccountMethods
    const handler = methods[key]
    const spec = AUDIT_METHODS[key]
    if (handler !== undefined && spec !== undefined) result[key] = auditedMethod(key, spec, handler)
  }
  return result
}
