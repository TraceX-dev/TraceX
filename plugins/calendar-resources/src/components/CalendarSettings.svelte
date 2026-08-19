<script lang="ts">
  import core, { getCurrentAccount, groupByArray, Ref } from '@hcengineering/core'
  import { createQuery, getClient } from '@hcengineering/presentation'
  import { Breadcrumb, Header, Label, Scroller, SettingsCard, SettingsCardsLayout, Toggle } from '@hcengineering/ui'
  import calendar from '../plugin'
  import { Calendar, ExternalCalendar, getPrimaryCalendar, PrimaryCalendar, Visibility } from '@hcengineering/calendar'
  import VisibilityEditor from './VisibilityEditor.svelte'
  import CalendarSelector from './CalendarSelector.svelte'

  const client = getClient()

  const myAcc = getCurrentAccount()
  const socialStrings = myAcc.socialIds

  let calendars: Calendar[] = []

  const query = createQuery()
  query.query(
    calendar.class.Calendar,
    {
      user: { $in: socialStrings }
    },
    (res) => {
      calendars = res
      calendarsLoaded = true
      setPrimaryCalendar(calendars, pref)
    }
  )

  $: categories = groupByArray(calendars, (c) => {
    return (c as ExternalCalendar).externalUser ?? 'HULY'
  })

  async function changeHidden(calendar: Calendar, value: boolean): Promise<void> {
    if (value === undefined) return
    await client.update(calendar, {
      hidden: value
    })
  }

  async function changeVisibility(calendar: Calendar, value: Visibility): Promise<void> {
    if (value === undefined) return
    await client.update(calendar, {
      visibility: value
    })
  }

  let primaryCalendar: Ref<Calendar> | undefined = undefined
  let pref: PrimaryCalendar | undefined = undefined

  let prefsLoaded = false
  let calendarsLoaded = false

  const prefQ = createQuery()
  prefQ.query(calendar.class.PrimaryCalendar, {}, (res) => {
    pref = res[0]
    prefsLoaded = true
    setPrimaryCalendar(calendars, pref)
  })

  function setPrimaryCalendar(calendars: Calendar[], pref: PrimaryCalendar | undefined): void {
    if (!prefsLoaded || !calendarsLoaded) return
    primaryCalendar = getPrimaryCalendar(calendars, pref, getCurrentAccount().uuid)
  }

  async function changePrimary(e: CustomEvent): Promise<void> {
    if (e.detail === undefined) return
    if (pref !== undefined) {
      if (pref.attachedTo === e.detail._id) return
      await client.update(pref, {
        attachedTo: e.detail._id
      })
    } else {
      await client.createDoc(calendar.class.PrimaryCalendar, core.space.Workspace, {
        attachedTo: e.detail._id
      })
    }
  }
</script>

<div class="hulyComponent">
  <Header adaptive={'disabled'}>
    <Breadcrumb icon={calendar.icon.Calendar} label={calendar.string.Calendar} size={'large'} isCurrent />
  </Header>
  <div class="hulyComponent-content__column content">
    <Scroller align={'center'} padding={'var(--spacing-3)'} bottomPadding={'var(--spacing-3)'}>
      <div class="hulyComponent-content w-full">
        <SettingsCardsLayout columns={1}>
          <SettingsCard label={calendar.string.PrimaryCalendar}>
            <div class="flex-between flex-gap-4">
              <Label label={calendar.string.PrimaryCalendar} />
              <CalendarSelector value={primaryCalendar} on:change={changePrimary} withIcon={false} kind={'regular'} />
            </div>
          </SettingsCard>

          {#each categories as cat}
            <div class="flex-col flex-gap-4">
              {#each cat[1] as _calendar}
                <SettingsCard label={calendar.string.Calendar} labelText={cat[0]}>
                  <div class="flex-col flex-gap-4">
                    <div class="flex-between flex-gap-4">
                      <div class="flex-grow"><Label label={calendar.string.Visibility} /></div>
                      <VisibilityEditor
                        value={_calendar.visibility}
                        kind={'regular'}
                        size={'medium'}
                        on:change={(res) => changeVisibility(_calendar, res.detail)}
                      />
                    </div>
                    <div class="flex-between flex-gap-4">
                      <Label label={calendar.string.Hidden} />
                      <Toggle
                        on={_calendar.hidden}
                        disabled={_calendar._class === calendar.class.Calendar}
                        on:change={(res) => changeHidden(_calendar, res.detail)}
                      />
                    </div>
                  </div>
                </SettingsCard>
              {/each}
            </div>
          {/each}
        </SettingsCardsLayout>
      </div>
    </Scroller>
  </div>
</div>
