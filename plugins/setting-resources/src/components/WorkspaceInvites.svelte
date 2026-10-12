<!--
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
  import type { WorkspaceInvite } from '@hcengineering/account-client'
  import { Analytics } from '@hcengineering/analytics'
  import { AccountRole, concatLink } from '@hcengineering/core'
  import { loginId } from '@hcengineering/login'
  import { getMetadata, type IntlString } from '@hcengineering/platform'
  import presentation, { copyTextToClipboard, MessageBox } from '@hcengineering/presentation'
  import setting from '@hcengineering/setting'
  import {
    Button,
    DateTimePresenter,
    IconCopy,
    IconDelete,
    Label,
    Loading,
    Notice,
    SettingsCard,
    locationToUrl,
    showPopup,
    showTooltipForDuration
  } from '@hcengineering/ui'
  import { onDestroy, onMount } from 'svelte'

  import settingRes from '../plugin'
  import { getAccountClient } from '../utils'

  let invitations: WorkspaceInvite[] = []
  let loading = true
  let loaded = false
  let deletingId: string | undefined
  let copyingId: string | undefined
  let destroyed = false
  let dismissCopyTooltip: (() => void) | undefined
  let error: IntlString | undefined
  let now = Date.now()

  const roleLabels: Record<AccountRole, IntlString> = {
    [AccountRole.ReadOnlyGuest]: settingRes.string.ReadonlyGuest,
    [AccountRole.DocGuest]: settingRes.string.Guest,
    [AccountRole.Guest]: settingRes.string.Guest,
    [AccountRole.User]: settingRes.string.User,
    [AccountRole.Maintainer]: settingRes.string.Maintainer,
    [AccountRole.Owner]: settingRes.string.Owner,
    [AccountRole.Admin]: settingRes.string.Admin
  }

  async function loadInvitations (): Promise<void> {
    loading = true
    error = undefined
    try {
      invitations = (await getAccountClient().getWorkspaceInvites()).sort(
        (left: WorkspaceInvite, right: WorkspaceInvite) =>
          right.expiresOn - left.expiresOn || left.id.localeCompare(right.id, undefined, { numeric: true })
      )
      loaded = true
      now = Date.now()
    } catch (err: unknown) {
      error = settingRes.string.InvitationsLoadFailed
      Analytics.handleError(err instanceof Error ? err : new Error(String(err)))
    } finally {
      loading = false
    }
  }

  async function deleteInvitation (inviteId: string): Promise<void> {
    if (deletingId !== undefined) return
    deletingId = inviteId
    error = undefined
    try {
      await getAccountClient().deleteWorkspaceInvite(inviteId)
      invitations = invitations.filter((invite) => invite.id !== inviteId)
    } catch (err: unknown) {
      error = settingRes.string.InvitationDeleteFailed
      Analytics.handleError(err instanceof Error ? err : new Error(String(err)))
    } finally {
      deletingId = undefined
    }
  }

  async function copyInvitationLink (inviteId: string, event: MouseEvent): Promise<void> {
    if (copyingId !== undefined) return
    const button = event.currentTarget
    if (!(button instanceof HTMLElement)) return
    copyingId = inviteId
    error = undefined
    try {
      const url = locationToUrl({ path: [loginId, 'join'], query: { inviteId } })
      const host = getMetadata(presentation.metadata.FrontUrl) ?? document.location.origin
      await copyTextToClipboard(concatLink(host, url))
      if (!destroyed && button.isConnected) {
        dismissCopyTooltip?.()
        dismissCopyTooltip = showTooltipForDuration(presentation.string.DocumentUrlCopied, button, 2000, 'top')
      }
    } catch (err: unknown) {
      error = settingRes.string.InvitationCopyFailed
      Analytics.handleError(err instanceof Error ? err : new Error(String(err)))
    } finally {
      copyingId = undefined
    }
  }

  function confirmDelete (invite: WorkspaceInvite): void {
    showPopup(MessageBox, {
      label: settingRes.string.DeleteInvitation,
      message: settingRes.string.DeleteInvitationConfirm,
      params: { invitation: invite.email || invite.id },
      dangerous: true,
      okLabel: setting.string.Delete,
      action: async () => {
        await deleteInvitation(invite.id)
      }
    })
  }

  onMount(() => {
    void loadInvitations()
    const timer = setInterval(() => {
      now = Date.now()
    }, 60000)
    return () => clearInterval(timer)
  })

  onDestroy(() => {
    destroyed = true
    dismissCopyTooltip?.()
  })
</script>

<SettingsCard label={settingRes.string.Invitations}>
  <Button
    slot="actions"
    label={settingRes.string.RefreshInvitations}
    size="small"
    {loading}
    disabled={loading || deletingId !== undefined}
    on:click={() => void loadInvitations()}
  />
  <div class="flex-col flex-gap-4">
    {#if error !== undefined}
      <div role="alert"><Notice label={error} kind="error" /></div>
    {/if}
    {#if loading && !loaded}
      <div class="flex-center"><Loading /></div>
    {:else if invitations.length === 0 && error === undefined}
      <div class="empty"><Label label={settingRes.string.NoInvitations} /></div>
    {:else if invitations.length > 0}
      <div class="table-scroll">
        <table>
          <thead>
            <tr>
              <th scope="col"><Label label={settingRes.string.InvitationExpires} /></th>
              <th scope="col"><Label label={settingRes.string.Role} /></th>
              <th scope="col"><Label label={settingRes.string.InvitationUses} /></th>
              <th scope="col"><Label label={settingRes.string.InvitationStatus} /></th>
              <th scope="col" />
            </tr>
          </thead>
          <tbody>
            {#each invitations as invite (invite.id)}
              <tr>
                <td>
                  {#if invite.expiresOn > 0}
                    <DateTimePresenter value={invite.expiresOn} />
                  {/if}
                </td>
                <td><Label label={roleLabels[invite.role]} /></td>
                <td>
                  {#if invite.remainingUses !== undefined && invite.remainingUses >= 0}
                    {invite.remainingUses}
                  {/if}
                </td>
                <td>
                  <Label
                    label={invite.expiresOn > 0 && invite.expiresOn < now
                      ? settingRes.string.InvitationExpired
                      : invite.remainingUses === 0
                        ? settingRes.string.InvitationExhausted
                        : settingRes.string.Active}
                  />
                </td>
                <td>
                  <div class="flex-row-center flex-gap-1">
                    <Button
                      icon={IconCopy}
                      showTooltip={{ label: presentation.string.CopyLink }}
                      kind="ghost"
                      size="small"
                      disabled={loading || deletingId !== undefined || copyingId !== undefined}
                      loading={copyingId === invite.id}
                      on:click={(event) => void copyInvitationLink(invite.id, event)}
                    />
                    <Button
                      icon={IconDelete}
                      showTooltip={{ label: setting.string.Delete }}
                      kind="ghost"
                      size="small"
                      disabled={loading || deletingId !== undefined}
                      loading={deletingId === invite.id}
                      on:click={() => confirmDelete(invite)}
                    />
                  </div>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </div>
</SettingsCard>

<style lang="scss">
  .empty {
    color: var(--theme-content-color);
    opacity: 0.6;
  }
  .table-scroll {
    overflow-x: auto;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    text-align: left;
  }
  th,
  td {
    padding: 0.75rem 0.5rem;
    border-bottom: 1px solid var(--theme-divider-color);
    vertical-align: middle;
    overflow-wrap: anywhere;
  }
  th {
    font-weight: 500;
  }
  th:last-child,
  td:last-child {
    width: 1%;
    white-space: nowrap;
  }
  tbody tr:last-child td {
    border-bottom: 0;
  }
</style>
