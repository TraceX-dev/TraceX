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

import platform, { PlatformError } from '@hcengineering/platform'

interface EmailCodeInfo {
  retryOn: number
}
interface EmailCodeClient {
  loginOtp: (email: string) => Promise<EmailCodeInfo>
  signUpOtp: (email: string, firstName: string, lastName: string) => Promise<EmailCodeInfo>
}

/** Requests email verification for an existing or new form author. */
export async function requestFormEmailCode (client: EmailCodeClient, email: string): Promise<EmailCodeInfo> {
  try {
    return await client.loginOtp(email)
  } catch (error) {
    if (!(error instanceof PlatformError) || error.status.code !== platform.status.AccountNotFound) throw error
    try {
      return await client.signUpOtp(email, email.split('@')[0], '')
    } catch (error) {
      if (!(error instanceof PlatformError) || error.status.code !== platform.status.AccountAlreadyExists) throw error
      return await client.loginOtp(email)
    }
  }
}
