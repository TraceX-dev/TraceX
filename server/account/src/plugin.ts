import { type IntlString, type Metadata, plugin, type Plugin } from '@hcengineering/platform'

/**
 * @public
 */
export const accountId = 'account' as Plugin

/**
 * @public
 */
export const accountPlugin = plugin(accountId, {
  metadata: {
    FrontURL: '' as Metadata<string>,
    MAIL_URL: '' as Metadata<string>,
    MAIL_AUTH_TOKEN: '' as Metadata<string>,
    ProductName: '' as Metadata<string>,
    Transactors: '' as Metadata<string>,
    OtpTimeToLiveSec: '' as Metadata<number>,
    OtpRetryDelaySec: '' as Metadata<number>,
    WsLivenessDays: '' as Metadata<number>,
    DefaultBrandingKey: '' as Metadata<string>
  },
  string: {
    ConfirmationText: '' as IntlString,
    ConfirmationSubject: '' as IntlString,
    RecoveryText: '' as IntlString,
    RecoverySubject: '' as IntlString,
    PasswordSetupText: '' as IntlString,
    PasswordSetupSubject: '' as IntlString,
    InviteText: '' as IntlString,
    InviteSubject: '' as IntlString,
    ResendInviteText: '' as IntlString,
    ResendInviteSubject: '' as IntlString,
    OtpText: '' as IntlString,
    OtpSubject: '' as IntlString,
    EmailLinkFallback: '' as IntlString,
    EmailCopyright: '' as IntlString,
    OtpEmailTitle: '' as IntlString,
    OtpEmailBody: '' as IntlString,
    OtpEmailNote: '' as IntlString,
    ConfirmationEmailTitle: '' as IntlString,
    ConfirmationEmailBody: '' as IntlString,
    ConfirmationEmailButton: '' as IntlString,
    ConfirmationEmailNote: '' as IntlString,
    InviteEmailTitle: '' as IntlString,
    InviteEmailBody: '' as IntlString,
    InviteEmailButton: '' as IntlString,
    InviteEmailNote: '' as IntlString,
    ResendInviteEmailTitle: '' as IntlString,
    ResendInviteEmailBody: '' as IntlString,
    ResendInviteEmailNote: '' as IntlString,
    RecoveryEmailTitle: '' as IntlString,
    RecoveryEmailBody: '' as IntlString,
    RecoveryEmailButton: '' as IntlString,
    RecoveryEmailNote: '' as IntlString,
    PasswordSetupEmailTitle: '' as IntlString,
    PasswordSetupEmailBody: '' as IntlString,
    PasswordSetupEmailDetails: '' as IntlString,
    PasswordSetupEmailButton: '' as IntlString,
    PasswordSetupEmailNote: '' as IntlString
  }
})
