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
  import { Breadcrumb, EditBox, Header, Label, Loading } from '@hcengineering/ui'

  import training from '../plugin'

  const DEFAULT_OFFSETS_DAYS = [30, 7, 1]

  const client = getClient()
  const hierarchy = client.getHierarchy()
  const query = createQuery()
  let space: TypedSpace | null = null
  let spaceType: SpaceType | null = null
  let roles: Role[] | null = null
  let rolesAssignment: RolesAssignment | null = null
  let reminderOffsetsInput: string = ''
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
          const offsets = hierarchy.hasMixin(space, training.mixin.TrainingReminderSettings)
            ? (hierarchy.as(space, training.mixin.TrainingReminderSettings).reminderOffsetsDays ?? DEFAULT_OFFSETS_DAYS)
            : DEFAULT_OFFSETS_DAYS
          reminderOffsetsInput = offsets.join(', ')
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

  // Parse a comma/space separated list of positive day offsets, de-duplicated and sorted descending.
  function parseOffsets (input: string): number[] {
    const parsed = input
      .split(/[\s,]+/)
      .map((s) => Number.parseInt(s, 10))
      .filter((n) => Number.isFinite(n) && n > 0)
    return Array.from(new Set(parsed)).sort((a, b) => b - a)
  }

  async function onOffsetsChange (): Promise<void> {
    if (space === null) return
    const reminderOffsetsDays = parseOffsets(reminderOffsetsInput)
    reminderOffsetsInput = reminderOffsetsDays.join(', ')
    await client.updateMixin(space._id, space._class, space.space, training.mixin.TrainingReminderSettings, {
      reminderOffsetsDays
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
          <Label label={training.string.TrainingReminderOffsetsDays} />
        </div>
        <EditBox
          bind:value={reminderOffsetsInput}
          format={'text'}
          placeholder={training.string.TrainingReminderOffsetsDays}
          on:blur={() => {
            void onOffsetsChange()
          }}
        />
      </div>
    {/if}
  </div>
</div>

<style lang="scss">
  .content {
    margin: 2rem 3.25rem;
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
