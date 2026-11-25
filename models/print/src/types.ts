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

import { DOMAIN_CONFIGURATION, type Class, type Doc, type Ref } from '@hcengineering/core'
import { Model, Mixin, Prop, TypeBoolean, TypeRef, TypeString } from '@hcengineering/model'
import { TClass, TDoc } from '@hcengineering/model-core'
import type { PrintConfiguration, PrintConfigurationValues, PrintConfig, PrintDataProvider } from '@hcengineering/print'
import print from '@hcengineering/print'
import type { Resource } from '@hcengineering/platform'
import core from '@hcengineering/model-core'

@Model(print.class.PrintConfiguration, core.class.Doc, DOMAIN_CONFIGURATION)
export class TPrintConfiguration extends TDoc implements PrintConfiguration {
  @Prop(TypeRef(core.class.Class), core.string.Class)
    targetClass!: Ref<Class<Doc>>
  @Prop(TypeBoolean(), print.string.Enabled)
    enabled!: boolean
  @Prop(TypeString(), print.string.Header)
    header!: string
  @Prop(TypeString(), print.string.Footer)
    footer!: string
  @Prop(TypeBoolean(), print.string.PrintLogo)
    printLogo!: boolean
}

@Mixin(print.mixin.PrintConfig, core.class.Class)
export class TPrintConfig extends TClass implements PrintConfig {
  provider!: Resource<PrintDataProvider>
  defaultConfiguration?: PrintConfigurationValues
}
