//
// Copyright © 2026 TraceX.
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

import qalico, { qalicoId } from '@tracex/qalico'
import { type IntlString, mergeIds } from '@hcengineering/platform'

export default mergeIds(qalicoId, qalico, {
  string: {
    RegulatoryUpdate: '' as IntlString,
    Applicability: '' as IntlString,
    ExternalLink: '' as IntlString,
    QalicoLink: '' as IntlString,
    Date: '' as IntlString,
    Owner: '' as IntlString,
    ActionsNeeded: '' as IntlString
  }
})
