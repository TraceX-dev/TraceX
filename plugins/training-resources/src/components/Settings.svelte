<!--
//
// Copyright © 2024 Hardcore Engineering Inc.
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
-->

<script lang="ts">
  import contact from '@hcengineering/contact-resources/src/plugin'
  import { AccountArrayEditor } from '@hcengineering/contact-resources'
  import core, {
    type AccountUuid,
    type Ref,
    type Role,
    type RolesAssignment,
    type SpaceType,
    type TypedSpace,
    type WithLookup
  } from '@hcengineering/core'
  import { createQuery, getClient } from '@hcengineering/presentation'
  import { Breadcrumb, Header, Label, Loading, Toggle } from '@hcengineering/ui'
  import NullablePositiveNumberEditor from './NullablePositiveNumberEditor.svelte'

  import training from '../plugin'

  const DEFAULT_OFFSETS_DAYS = [30, 7, 1]
  // Number of configurable reminders in the series (e.g. a month / a week / a day before the deadline).
  const REMINDER_SLOTS = 3

  const client = getClient()
  const hierarchy = client.getHierarchy()
  const query = createQuery()
  let space: TypedSpace | null = null
  let spaceType: SpaceType | null = null
  let roles: Role[] | null = null
  let rolesAssignment: RolesAssignment | null = null
  let reminderOffsets: Array<number | null> = new Array(REMINDER_SLOTS).fill(null)
  let remindersEnabled: boolean = true
  $: {
    query.query<TypedSpace>(
      core.class.TypedSpace,
      {
        _id: training.space.Trainings
      },
      (result) => {
        space = result.shift() ?? null
        spaceType = (space as WithLookup<TypedSpace>)?.$lookup?.type ?? null
        roles = ((spaceType as WithLookup<SpaceType>)?.$lookup?.roles as Role[]) ?? null

        if (space === null || spaceType === null || roles === null) {
          rolesAssignment = {}
        } else {
          const mixin = hierarchy.as(space, spaceType.targetClass) as unknown as RolesAssignment
          rolesAssignment = roles.reduce<RolesAssignment>(
            (rolesAssignment, { _id }) => ({
              ...rolesAssignment,
              [_id]: mixin[_id]
            }),
            {}
          )
        }

        if (space !== null) {
          const settings = hierarchy.hasMixin(space, training.mixin.TrainingReminderSettings)
            ? hierarchy.as(space, training.mixin.TrainingReminderSettings)
            : undefined
          remindersEnabled = settings?.remindersEnabled !== false
          const configured = settings?.reminderOffsetsDays ?? DEFAULT_OFFSETS_DAYS
          const sorted = [...(configured.length > 0 ? configured : DEFAULT_OFFSETS_DAYS)].sort((a, b) => b - a)
          reminderOffsets = Array.from({ length: REMINDER_SLOTS }, (_, i) => sorted[i] ?? null)
        }
      },
      {
        lookup: {
          type: [core.class.SpaceType, { _id: { roles: core.class.Role } }]
        }
      }
    )
  }

  async function onChange (roleId: Ref<Role>, members: AccountUuid[]): Promise<void> {
    if (space === null || spaceType === null) {
      return
    }

    rolesAssignment ??= {}
    rolesAssignment[roleId] = members
    await client.updateMixin(space._id, space._class, space.space, spaceType.targetClass, rolesAssignment)
  }

  // Each slot is already constrained to a positive integer (or null) by NullablePositiveNumberEditor;
  // here we just drop empty slots, de-duplicate and store the series sorted descending.
  async function onOffsetChange (index: number, value: number | null): Promise<void> {
    if (space === null) return

    reminderOffsets[index] = value
    reminderOffsets = reminderOffsets

    const reminderOffsetsDays = Array.from(
      new Set(reminderOffsets.filter((v): v is number => v !== null && v > 0))
    ).sort((a, b) => b - a)

    await client.updateMixin(space._id, space._class, space.space, training.mixin.TrainingReminderSettings, {
      reminderOffsetsDays
    })
  }

  // Disabling keeps the deadline visible on trainees' calendars — it only stops the reminders.
  async function onRemindersEnabledChange (enabled: boolean): Promise<void> {
    if (space === null) return
    remindersEnabled = enabled
    await client.updateMixin(space._id, space._class, space.space, training.mixin.TrainingReminderSettings, {
      remindersEnabled: enabled
    })
  }
</script>

<div class="hulyComponent">
  <Header adaptive={'disabled'}>
    <Breadcrumb icon={training.icon.Training} label={training.string.Trainings} size="large" isCurrent />
  </Header>
  <div class="hulyComponent-content__column content">
    {#if space === null || spaceType === null || roles === null || rolesAssignment === null}
      <Loading />
    {:else}
      <div class="grid">
        {#each roles as role}
          <div class="labelOnPanel">
            {role.name}
          </div>
          <AccountArrayEditor
            value={rolesAssignment?.[role._id] ?? []}
            label={contact.string.Members}
            onChange={(refs) => {
              void onChange(role._id, refs)
            }}
            kind="regular"
            size="large"
            allowGuests
          />
        {/each}

        <div class="labelOnPanel">
          <Label label={training.string.TrainingRemindersEnabled} />
        </div>
        <Toggle
          on={remindersEnabled}
          on:change={(ev) => {
            void onRemindersEnabledChange(ev.detail)
          }}
        />

        <div class="labelOnPanel">
          <Label label={training.string.TrainingReminderOffsetsDays} />
        </div>
        <div class="offsets">
          {#each reminderOffsets as offset, index}
            <NullablePositiveNumberEditor
              value={offset}
              placeholder={training.string.NotSelected}
              kind="regular"
              size="large"
              width="6rem"
              readonly={!remindersEnabled}
              onChange={(value) => {
                void onOffsetChange(index, value)
              }}
            />
          {/each}
        </div>
      </div>
    {/if}
  </div>
</div>

<style lang="scss">
  .content {
    margin: 2rem 3.25rem;
  }

  .offsets {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .grid {
    display: grid;
    grid-template-columns: max-content 1fr;
    justify-content: start;
    align-items: center;
    row-gap: 1rem;
    column-gap: 8rem;
    width: 100%;
    height: min-content;
  }
</style>
