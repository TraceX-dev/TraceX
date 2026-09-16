<!--
// Copyright © 2022-2023 Hardcore Engineering Inc.
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
-->
<script lang="ts">
  import { Analytics } from '@hcengineering/analytics'
  import { Employee } from '@hcengineering/contact'
  import { AssigneeBox, SpaceSettingsForm } from '@hcengineering/contact-resources'
  import core, {
    AccountRole,
    AccountUuid,
    Data,
    DocumentUpdate,
    Ref,
    Role,
    RolesAssignment,
    SortingOrder,
    SpaceType,
    generateId,
    getCurrentAccount
  } from '@hcengineering/core'
  import { Asset } from '@hcengineering/platform'
  import presentation, { IconWithEmoji, Card, createQuery, getClient } from '@hcengineering/presentation'
  import task, { ProjectType, TaskType } from '@hcengineering/task'
  import { taskTypeStore, typeStore } from '@hcengineering/task-resources'
  import { IssueStatus, Project, TimeReportDayType, TrackerEvents } from '@hcengineering/tracker'
  import { permissions, IconPicker } from '@hcengineering/view-resources'
  import {
    Button,
    Component,
    EditBox,
    Label,
    FormInputField,
    FormRow,
    getColorNumberByText,
    getPlatformColorDef,
    getPlatformColorForTextDef,
    showPopup,
    themeStore
  } from '@hcengineering/ui'
  import view from '@hcengineering/view'
  import { deepEqual } from 'fast-equals'
  import { createEventDispatcher } from 'svelte'

  import tracker from '../../plugin'
  import StatusSelector from '../issues/StatusSelector.svelte'

  export let project: Project | undefined = undefined
  export let namePlaceholder: string = ''
  export let descriptionPlaceholder: string = ''

  const client = getClient()
  const hierarchy = client.getHierarchy()
  const projectsQuery = createQuery()

  let name: string = project?.name ?? namePlaceholder
  let description: string = project?.description ?? descriptionPlaceholder
  let isPrivate: boolean = project?.private ?? false
  let icon: Asset | undefined = project?.icon ?? tracker.icon.Home
  let color = project?.color ?? getColorNumberByText(name)
  let isColorSelected = false
  let defaultAssignee: Ref<Employee> | null | undefined = project?.defaultAssignee ?? null
  let members: AccountUuid[] =
    project?.members !== undefined ? hierarchy.clone(project.members) : [getCurrentAccount().uuid]
  let owners: AccountUuid[] =
    project?.owners !== undefined ? hierarchy.clone(project.owners) : [getCurrentAccount().uuid]
  let projectsIdentifiers = new Set<string>()
  let isSaving = false
  let defaultStatus: Ref<IssueStatus> | undefined = project?.defaultIssueStatus
  let rolesAssignment: RolesAssignment | undefined

  let typeId: Ref<ProjectType> | undefined = project?.type
  $: typeType = typeId !== undefined ? $typeStore.get(typeId) : undefined
  let autoJoin = project?.autoJoin ?? typeType?.autoJoin ?? false
  let autoJoinForRoles: AccountRole[] =
    project?.autoJoinForRoles != null ? hierarchy.clone(project.autoJoinForRoles) : []

  const dispatch = createEventDispatcher()

  function normalizeAutoJoinForRoles (roles: AccountRole[]): AccountRole[] | undefined {
    return roles.length > 0 ? [...roles] : undefined
  }

  function autoJoinRolesEqual (a: AccountRole[] | undefined, b: AccountRole[] | undefined): boolean {
    return deepEqual([...(a ?? [])].sort(), [...(b ?? [])].sort())
  }

  $: isNew = project == null
  // An existing project may be opened by a user who is not allowed to change it,
  // in that case the dialog is shown in a read only mode.
  $: readonly = !isNew && !$permissions.canEditSpace(project)

  async function handleSave (): Promise<void> {
    if (isNew) {
      await createProject()
    } else {
      await updateProject()
    }
  }

  let identifier: string = project?.identifier ?? 'TSK'

  function getProjectData (): Omit<Data<Project>, 'type'> {
    return {
      name,
      description,
      private: isPrivate,
      members,
      owners,
      archived: false,
      autoJoin,
      identifier: identifier.toUpperCase(),
      sequence: 0,
      defaultAssignee: defaultAssignee ?? undefined,
      icon,
      color,
      defaultIssueStatus: defaultStatus ?? ('' as Ref<IssueStatus>),
      defaultTimeReportDay: project?.defaultTimeReportDay ?? TimeReportDayType.PreviousWorkDay,
      autoJoinForRoles: normalizeAutoJoinForRoles(autoJoinForRoles)
    }
  }

  function getRolesAssignment (): RolesAssignment {
    if (project === undefined || typeType?.targetClass === undefined || roles === undefined) {
      return {}
    }

    const asMixin = hierarchy.as(project, typeType?.targetClass)

    return roles.reduce<RolesAssignment>((prev, { _id }) => {
      prev[_id] = (asMixin as any)[_id] ?? []

      return prev
    }, {})
  }

  async function updateProject (): Promise<void> {
    if (!project || typeType?.targetClass === undefined) {
      return
    }

    const { sequence, ...projectData } = getProjectData()
    const update: DocumentUpdate<Project> = {}
    if (projectData.name !== project?.name) {
      update.name = projectData.name
    }
    if (projectData.description !== project?.description) {
      update.description = projectData.description
    }
    if (projectData.private !== project?.private) {
      update.private = projectData.private
    }
    if (projectData.defaultAssignee !== project?.defaultAssignee) {
      update.defaultAssignee = projectData.defaultAssignee
    }
    if (projectData.defaultIssueStatus !== project?.defaultIssueStatus) {
      update.defaultIssueStatus = projectData.defaultIssueStatus
    }
    if (projectData.icon !== project?.icon) {
      update.icon = projectData.icon
    }
    if (projectData.color !== project?.color) {
      update.color = projectData.color
    }
    if (projectData.defaultTimeReportDay !== project?.defaultTimeReportDay) {
      update.defaultTimeReportDay = projectData.defaultTimeReportDay
    }
    if (projectData.autoJoin !== project?.autoJoin) {
      update.autoJoin = projectData.autoJoin
    }
    if (!autoJoinRolesEqual(projectData.autoJoinForRoles, project?.autoJoinForRoles)) {
      update.autoJoinForRoles = projectData.autoJoinForRoles
    }
    if (projectData.members.length !== project?.members.length) {
      update.members = projectData.members
    } else {
      for (const member of projectData.members) {
        if (project.members.findIndex((p) => p === member) === -1) {
          update.members = projectData.members
          break
        }
      }
    }
    if (projectData.owners?.length !== project?.owners?.length) {
      update.owners = projectData.owners
    } else {
      for (const owner of projectData.owners || []) {
        if (project.owners?.findIndex((p) => p === owner) === -1) {
          update.owners = projectData.owners
          break
        }
      }
    }

    if (Object.keys(update).length > 0) {
      isSaving = true
      await client.update(project, update)
      isSaving = false
    }

    if (rolesAssignment && !deepEqual(rolesAssignment, getRolesAssignment())) {
      await client.updateMixin(
        project._id,
        tracker.class.Project,
        core.space.Space,
        typeType.targetClass,
        rolesAssignment
      )
    }

    close()
  }

  $: setDefaultMembers(typeType)

  function setDefaultMembers (typeType: ProjectType | undefined): void {
    if (typeType === undefined) return
    if (membersChanged) return
    if (project !== undefined) return
    autoJoin = typeType.autoJoin ?? false
    if (typeType.members === undefined || typeType.members.length === 0) return
    members = typeType.members
  }

  function findTaskTypes (typeId: Ref<SpaceType>): TaskType[] {
    return Array.from($taskTypeStore.values()).filter(
      (it) => it.parent === typeId && it.ofClass === tracker.class.Issue
    )
  }

  $: if (defaultStatus === undefined && typeId !== undefined) {
    const sts = findTaskTypes(typeId)?.[0]?.statuses
    defaultStatus = sts?.[0]
  }

  async function createProject (): Promise<void> {
    const projectId = generateId<Project>()
    const projectData = getProjectData()
    if (typeId !== undefined && typeType !== undefined) {
      const ops = client
        .apply('create-project')
        .notMatch(tracker.class.Project, { identifier: projectData.identifier.toUpperCase() })

      isSaving = true
      await ops.createDoc(tracker.class.Project, core.space.Space, { ...projectData, type: typeId }, projectId)
      const succeeded = await ops.commit()
      Analytics.handleEvent(TrackerEvents.ProjectCreated, {
        ok: succeeded.result,
        id: projectData.identifier
      })
      if (succeeded.result) {
        // Add space type's mixin with roles assignments
        await client.createMixin(
          projectId,
          tracker.class.Project,
          core.space.Space,
          typeType.targetClass,
          rolesAssignment ?? {}
        )

        close(projectId)
      } else {
        isSaving = false
      }
    }
  }

  function chooseIcon (ev: MouseEvent): void {
    const update = (result: any) => {
      if (result !== undefined && result !== null) {
        icon = result.icon
        color = result.color
        isColorSelected = true
      }
    }
    showPopup(IconPicker, { icon, color }, 'top', update, update)
  }

  function close (id?: Ref<Project>): void {
    dispatch('close', id)
  }

  let membersChanged: boolean = false

  $: projectsQuery.query(tracker.class.Project, { _id: { $nin: project ? [project._id] : [] } }, (res) => {
    projectsIdentifiers = new Set(res.map(({ identifier }) => identifier))
  })

  function handleTypeChange (evt: CustomEvent<Ref<ProjectType>>): void {
    typeId = evt.detail
    defaultStatus = undefined
  }

  $: identifier = identifier.toLocaleUpperCase().replaceAll('-', '_').replaceAll(' ', '_').substring(0, 5)

  let roles: Role[] = []
  const rolesQuery = createQuery()
  $: if (typeType !== undefined) {
    rolesQuery.query(
      core.class.Role,
      { attachedTo: typeType._id },
      (res) => {
        roles = res

        if (rolesAssignment === undefined && typeType !== undefined) {
          rolesAssignment = getRolesAssignment()
        }
      },
      {
        sort: {
          name: SortingOrder.Ascending
        }
      }
    )
  } else {
    rolesQuery.unsubscribe()
  }

  $: canSave =
    !readonly &&
    name.trim().length > 0 &&
    identifier.trim().length > 0 &&
    !projectsIdentifiers.has(identifier.toUpperCase()) &&
    !(members.length === 0 && isPrivate) &&
    owners.length > 0 &&
    (!isPrivate || owners.some((o) => members.includes(o)))
</script>

<Card
  label={isNew ? tracker.string.NewProject : tracker.string.EditProject}
  okLabel={isNew ? presentation.string.Create : presentation.string.Save}
  okAction={handleSave}
  {canSave}
  accentHeader
  width={'medium'}
  gap={'gapV-6'}
  onCancel={close}
  on:changeContent
>
  <SpaceSettingsForm
    bind:owners
    bind:members
    bind:isPrivate
    bind:autoJoin
    bind:autoJoinForRoles
    bind:rolesAssignment
    {roles}
    {readonly}
    ownersAllowGuests
    membersLabel={tracker.string.Members}
    privateToggleId={'project-private'}
    on:membersChange={() => {
      membersChanged = true
    }}
  >
    <FormRow label={task.string.ProjectType}>
      <Component
        is={task.component.ProjectTypeSelector}
        disabled={!isNew}
        props={{
          descriptors: [tracker.descriptors.ProjectType],
          type: typeId,
          focusIndex: 4,
          kind: 'regular',
          size: 'large'
        }}
        on:change={handleTypeChange}
      />
    </FormRow>

    <FormRow label={tracker.string.ProjectTitle}>
      <EditBox
        id="project-title"
        bind:value={name}
        placeholder={tracker.string.ProjectTitlePlaceholder}
        disabled={readonly}
        kind={'medium-style'}
        fullSize
        autoFocus
        on:input={() => {
          if (isNew) {
            identifier = name.toLocaleUpperCase().replaceAll('-', '_').replaceAll(' ', '_').substring(0, 5)
            color = isColorSelected ? color : getColorNumberByText(name)
          }
        }}
      />
    </FormRow>

    <FormRow label={tracker.string.Identifier} description={tracker.string.UsedInIssueIDs}>
      <div class="flex-col">
        <FormInputField disabled={!isNew || readonly}>
          <EditBox
            id="project-identifier"
            bind:value={identifier}
            disabled={!isNew || readonly}
            placeholder={tracker.string.ProjectIdentifierPlaceholder}
            uppercase
          />
        </FormInputField>
        {#if !isSaving && projectsIdentifiers.has(identifier.toUpperCase())}
          <div class="overflow-label duplicated-identifier">
            <Label label={tracker.string.IdentifierExists} />
          </div>
        {/if}
      </div>
    </FormRow>

    <FormRow label={tracker.string.Description}>
      <FormInputField multiline disabled={readonly}>
        <EditBox
          id="project-description"
          bind:value={description}
          placeholder={tracker.string.IssueDescriptionPlaceholder}
          disabled={readonly}
        />
      </FormInputField>
    </FormRow>

    <FormRow label={tracker.string.ChooseIcon}>
      <Button
        icon={icon === view.ids.IconWithEmoji ? IconWithEmoji : (icon ?? tracker.icon.Home)}
        iconProps={icon === view.ids.IconWithEmoji
          ? { icon: color, size: 'medium' }
          : {
              fill:
                color !== undefined && typeof color !== 'string'
                  ? getPlatformColorDef(color, $themeStore.dark).icon
                  : getPlatformColorForTextDef(name, $themeStore.dark).icon
            }}
        size={'large'}
        on:click={chooseIcon}
      />
    </FormRow>

    <FormRow label={tracker.string.DefaultAssignee}>
      <AssigneeBox
        label={tracker.string.Assignee}
        placeholder={tracker.string.Assignee}
        kind={'regular'}
        size={'large'}
        avatarSize={'card'}
        bind:value={defaultAssignee}
        titleDeselect={tracker.string.Unassigned}
        showNavigate={false}
        showTooltip={{ label: tracker.string.DefaultAssignee }}
      />
    </FormRow>

    <FormRow label={tracker.string.DefaultIssueStatus}>
      {#if typeId !== undefined}
        <StatusSelector
          taskType={findTaskTypes(typeId)[0]?._id}
          bind:value={defaultStatus}
          type={typeId}
          kind={'regular'}
          size={'large'}
        />
      {/if}
    </FormRow>
  </SpaceSettingsForm>
</Card>

<style lang="scss">
  .duplicated-identifier {
    padding-left: 0.625rem;
    font-size: 0.75rem;
    color: var(--theme-warning-color);
  }
</style>
