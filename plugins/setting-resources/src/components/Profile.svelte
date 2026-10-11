<!--
// Copyright © 2020, 2021 Anticrm Platform Contributors.
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
  import contact, { combineName, getFirstName, getLastName } from '@hcengineering/contact'
  import { ChannelsEditor, EditableAvatar, myEmployeeStore } from '@hcengineering/contact-resources'
  import { AccountRole, getCurrentAccount, SocialIdType } from '@hcengineering/core'
  import login, { loginId } from '@hcengineering/login'
  import platform, { getResource, PlatformError } from '@hcengineering/platform'
  import { AttributeEditor, createQuery, getClient, hasResource, MessageBox } from '@hcengineering/presentation'
  import {
    Breadcrumb,
    Component,
    createFocusManager,
    EditBox,
    FocusHandler,
    Header,
    Label,
    navigate,
    Scroller,
    SettingsCard,
    SettingsCardsLayout,
    SettingsFooterAction,
    showPopup
  } from '@hcengineering/ui'
  import { logIn, logOut } from '@hcengineering/workbench-resources'

  import rating, { type PersonRating } from '@hcengineering/rating'
  import setting from '../plugin'
  import SocialIdsEditor from './socialIds/SocialIdsEditor.svelte'

  const client = getClient()
  const account = getCurrentAccount()
  const email = account.fullSocialIds.find((si) => si.type === SocialIdType.EMAIL)?.value ?? ''

  const levelQuery = createQuery()

  let personRating: PersonRating | undefined

  levelQuery.query(rating.class.PersonRating, { accountId: account.uuid }, (res) => {
    personRating = res[0]
  })

  let firstName = ''
  let lastName = ''
  let initialized = false

  // Initialize names only once when store value changes from undefined
  // not to interfere with further user editing
  $: if ($myEmployeeStore !== undefined && !initialized) {
    firstName = getFirstName($myEmployeeStore.name)
    lastName = getLastName($myEmployeeStore.name)
    initialized = true
  }

  let avatarEditor: EditableAvatar
  async function onAvatarDone (): Promise<void> {
    if ($myEmployeeStore === undefined) return

    if ($myEmployeeStore.avatar != null) {
      await avatarEditor.removeAvatar($myEmployeeStore.avatar)
    }
    const avatar = await avatarEditor.createAvatar()
    await client.diffUpdate($myEmployeeStore, avatar)
  }

  const manager = createFocusManager()

  async function leave (): Promise<void> {
    showPopup(MessageBox, {
      label: setting.string.Leave,
      message: setting.string.LeaveDescr,
      action: async () => {
        const leaveWorkspace = await getResource(login.function.LeaveWorkspace)
        try {
          const loginInfo = await leaveWorkspace(account.uuid)

          if (loginInfo?.token != null) {
            await logIn(loginInfo)
            navigate({ path: [loginId, 'selectWorkspace'] })
          } else {
            await logOut()
            navigate({ path: [loginId] })
          }
        } catch (err: any) {
          if (
            err instanceof PlatformError &&
            err.status?.code === platform.status.Forbidden &&
            account.role === AccountRole.Owner
          ) {
            showPopup(MessageBox, {
              label: setting.string.LastOwnerLeaveTitle,
              message: setting.string.LastOwnerLeaveMessage,
              canSubmit: false
            })
          } else {
            throw err
          }
        }
      }
    })
  }

  async function nameChange (): Promise<void> {
    if ($myEmployeeStore !== undefined) {
      await client.diffUpdate($myEmployeeStore, {
        name: combineName(firstName, lastName)
      })
    }
  }
</script>

<FocusHandler {manager} />

<div class="hulyComponent">
  <Header adaptive={'disabled'}>
    <Breadcrumb icon={setting.icon.AccountSettings} label={setting.string.AccountSettings} size={'large'} isCurrent />
  </Header>
  <div class="hulyComponent-content__column content">
    <Scroller align={'center'} padding={'var(--spacing-3)'} bottomPadding={'var(--spacing-3)'}>
      <div class="hulyComponent-content profile-content">
        {#if $myEmployeeStore}
          <SettingsCardsLayout columns={2}>
            <div class="profile-column">
              <SettingsCard label={setting.string.AccountSettings}>
                <div class="profile-card-content">
                  <div class="profile-card-main">
                    <div class="avatar-column">
                      <EditableAvatar
                        person={$myEmployeeStore}
                        {email}
                        size={'large'}
                        name={$myEmployeeStore.name}
                        bind:this={avatarEditor}
                        on:done={onAvatarDone}
                      />
                      {#if hasResource(rating.component.RatingRing)}
                        <div class="flex-row-center">
                          <Component
                            is={rating.component.RatingRing}
                            props={{ rating: personRating?.rating ?? 0, showValues: true }}
                          />
                        </div>
                      {/if}
                    </div>
                    <div class="name-fields">
                      <EditBox
                        placeholder={contact.string.PersonFirstNamePlaceholder}
                        bind:value={firstName}
                        kind={'large-style'}
                        autoFocus
                        focusIndex={1}
                        on:change={nameChange}
                      />
                      <EditBox
                        placeholder={contact.string.PersonLastNamePlaceholder}
                        bind:value={lastName}
                        kind={'large-style'}
                        focusIndex={2}
                        on:change={nameChange}
                      />
                    </div>
                  </div>

                  <div class="attribute-field">
                    <div class="field-label"><Label label={contact.string.Location} /></div>
                    <div class="field-input">
                      <AttributeEditor
                        maxWidth="100%"
                        _class={contact.class.Person}
                        object={$myEmployeeStore}
                        focusIndex={3}
                        key="city"
                        editKind={'default'}
                      />
                    </div>
                  </div>

                  <div class="attribute-field">
                    <div class="field-label"><Label label={contact.string.Position} /></div>
                    <div class="field-input">
                      <AttributeEditor
                        maxWidth="100%"
                        _class={contact.mixin.Employee}
                        object={$myEmployeeStore}
                        focusIndex={4}
                        key="position"
                        editKind={'default'}
                      />
                    </div>
                  </div>

                  <div class="attribute-field">
                    <div class="field-label"><Label label={contact.string.Contacts} /></div>
                    <ChannelsEditor
                      attachedTo={$myEmployeeStore._id}
                      attachedClass={$myEmployeeStore._class}
                      focusIndex={10}
                      allowOpen={false}
                      restricted={[contact.channelProvider.Email]}
                    />
                  </div>
                </div>

                {#if hasResource(rating.component.RatingRing) === true && personRating != null}
                  <div class="separator" />
                  <div class="flex-row-center mt-2">
                    <Component is={rating.component.RatingActivities} props={{ rating: personRating }} />
                  </div>
                {/if}
              </SettingsCard>

              <SettingsCard label={setting.string.Leave}>
                <Label label={setting.string.LeaveWorkspaceDescription} />
                <SettingsFooterAction
                  slot="footer"
                  icon={setting.icon.Signout}
                  label={setting.string.Leave}
                  color="dangerous"
                  on:click={() => {
                    void leave()
                  }}
                />
              </SettingsCard>
            </div>

            <div class="profile-column">
              <SettingsCard label={setting.string.ManageIdentities}>
                <SocialIdsEditor rating={personRating} showTitle={false} />
              </SettingsCard>
            </div>
          </SettingsCardsLayout>
        {/if}
      </div>
    </Scroller>
  </div>
</div>

<style lang="scss">
  .profile-content {
    width: 100%;
  }

  .profile-column {
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
    min-width: 0;
  }

  .profile-card-content {
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
    min-width: 0;
  }

  .profile-card-main {
    display: flex;
    align-items: flex-start;
    gap: 1.25rem;
    min-width: 0;
  }

  .avatar-column {
    display: flex;
    flex-direction: column;
    align-items: center;
    flex: 0 0 auto;
  }

  .name-fields {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    flex: 1 1 auto;
    min-width: 0;
  }

  .attribute-field {
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
    align-self: stretch;
    width: 100%;
    min-width: 0;
  }

  .field-label {
    color: var(--theme-caption-color);
    font-size: 0.75rem;
    font-weight: 500;
    line-height: 1rem;
  }

  .field-input {
    width: 100%;
    min-height: 2.25rem;
  }

  .separator {
    margin: 1rem 0;
    height: 1px;
    background-color: var(--divider-color);
  }

  @media (max-width: 40rem) {
    .profile-card-main {
      flex-direction: column;
    }

    .avatar-column {
      align-items: flex-start;
    }
  }
</style>
