/*!
// Copyright © 2020, 2021 Anticrm Platform Contributors.
// Copyright © 2021 Hardcore Engineering Inc.
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
*/

import type { IntlString, StatusCode } from '@hcengineering/platform'
import { mergeIds } from '@hcengineering/platform'

import login, { loginId } from '@hcengineering/login'

export default mergeIds(loginId, login, {
  status: {
    RequiredField: '' as StatusCode<{ field: string }>,
    FieldsDoNotMatch: '' as StatusCode<{ field: string, field2: string }>,
    ConnectingToServer: '' as StatusCode,
    IncorrectValue: '' as StatusCode<{ field: string }>
  },
  string: {
    CreateWorkspace: '' as IntlString,
    HaveWorkspace: '' as IntlString,
    LastName: '' as IntlString,
    FirstName: '' as IntlString,
    HaveAccount: '' as IntlString,
    LoadingAccount: '' as IntlString,
    Join: '' as IntlString,
    JoinWorkspace: '' as IntlString<{ workspaceName: string }>,
    Workspace: '' as IntlString,
    SignUp: '' as IntlString,
    DoNotHaveAnAccount: '' as IntlString,
    Copy: '' as IntlString,
    Copied: '' as IntlString,
    Close: '' as IntlString,
    InviteDescription: '' as IntlString,
    WantAnotherWorkspace: '' as IntlString,
    NotSeeingWorkspace: '' as IntlString,
    ChangeAccount: '' as IntlString,
    ForgotPassword: '' as IntlString,
    Recover: '' as IntlString,
    KnowPassword: '' as IntlString,
    PasswordRecovery: '' as IntlString,
    RecoveryLinkSent: '' as IntlString,
    UseWorkspaceInviteSettings: '' as IntlString,
    NoExpiration: '' as IntlString,
    InviteLinkCreationFailed: '' as IntlString,
    CreateInviteLink: '' as IntlString,
    InviteLinkCreated: '' as IntlString,
    InviteLinkHint: '' as IntlString,
    InviteLinkReadyHint: '' as IntlString,
    InviteSummary: '' as IntlString,
    InviteLinkLabel: '' as IntlString,
    InviteLinkRevokeHint: '' as IntlString,
    ConfigureInvitation: '' as IntlString,
    InviteRole: '' as IntlString,
    InviteExpiration: '' as IntlString,
    InviteUseLimit: '' as IntlString,
    InvitePositiveNumber: '' as IntlString,
    CreateAnotherInviteLink: '' as IntlString,
    CopyInviteLink: '' as IntlString,
    InviteLinkCopyFailed: '' as IntlString,
    InviteHours: '' as IntlString<{ hours: number }>,
    InviteHoursUnit: '' as IntlString,
    InviteSevenDays: '' as IntlString,
    InviteUnlimitedUses: '' as IntlString,
    InviteSingleUse: '' as IntlString,
    InviteCustom: '' as IntlString,
    InviteUses: '' as IntlString<{ count: number }>,
    InviteReadonlyGuest: '' as IntlString,
    InviteGuest: '' as IntlString,
    InviteMember: '' as IntlString,
    InviteMaintainer: '' as IntlString,
    InviteOwner: '' as IntlString,
    InviteAdmin: '' as IntlString,
    GetLink: '' as IntlString,
    AlreadyJoined: '' as IntlString,
    ConfirmationSent: '' as IntlString,
    ConfirmationSent2: '' as IntlString,
    ContinueWith: '' as IntlString,
    HaventReceivedCode: '' as IntlString,
    ResendCode: '' as IntlString,
    WrongEmail: '' as IntlString,
    ChangeEmail: '' as IntlString,
    SentTo: '' as IntlString,
    CanFindCode: '' as IntlString,
    LoginWithCode: '' as IntlString,
    LoginWithPassword: '' as IntlString,
    LoginAsGuest: '' as IntlString,
    SignUpWithCode: '' as IntlString,
    SignUpWithPassword: '' as IntlString,
    Hello: '' as IntlString,
    ProcessingInvite: '' as IntlString,
    SignToProceed: '' as IntlString,
    Proceed: '' as IntlString,
    SetPasswordLater: '' as IntlString,
    SetPasswordNow: '' as IntlString,
    SignUpToCreateWorkspace: '' as IntlString,
    WhatIsYourName: '' as IntlString,
    AccessExpired: '' as IntlString,
    AccessNotActive: '' as IntlString,
    JoinWithThisAccount: '' as IntlString,
    UseDifferentAccount: '' as IntlString,
    UseCurrentAccountToJoin: '' as IntlString,
    LogInAndJoin: '' as IntlString,
    SignUpAndJoin: '' as IntlString,
    CreateNewAccount: '' as IntlString,
    SignedInAs: '' as IntlString<{ name: string }>,
    CreateSampleProjects: '' as IntlString
  }
})
