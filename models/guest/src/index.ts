import { type Class, type IndexingConfiguration, type Doc, type Domain, type Ref } from '@hcengineering/core'
import { type PublicLink, type Restrictions } from '@hcengineering/guest'
import { type Builder, Model } from '@hcengineering/model'
import core, { TDoc } from '@hcengineering/model-core'
import { type Location } from '@hcengineering/ui/src/types'
import guest from './plugin'

export const GUEST_DOMAIN = 'guest' as Domain

@Model(guest.class.PublicLink, core.class.Doc, GUEST_DOMAIN)
export class TPublicLink extends TDoc implements PublicLink {
  url!: string
  location!: Location
  restrictions!: Restrictions
  revokable!: boolean
  attachedTo!: Ref<Doc>
}

export function createModel (builder: Builder): void {
  builder.createModel(TPublicLink)

  // `_id` doubles as the link's bearer secret (see exchangeGuestToken), so unlike other
  // RowVisibility classes it must NOT allow a known-id bypass - only the caller's own linkId.
  builder.mixin(guest.class.PublicLink, core.class.Class, core.mixin.RowVisibility, {
    policy: core.ownBy('_id', 'linkId')
  })

  builder.createDoc(core.class.DomainIndexConfiguration, core.space.Model, {
    domain: GUEST_DOMAIN,
    disabled: [
      { createdOn: -1 },
      { space: 1 },
      { modifiedBy: 1 },
      { createdBy: 1 },
      { attachedToClass: 1 },
      { createdOn: -1 }
    ]
  })
  builder.mixin<Class<PublicLink>, IndexingConfiguration<PublicLink>>(
    guest.class.PublicLink,
    core.class.Class,
    core.mixin.IndexConfiguration,
    {
      searchDisabled: true,
      indexes: []
    }
  )
}

export { guestId } from '@hcengineering/guest'
export * from './migration'
export * from './utils'
