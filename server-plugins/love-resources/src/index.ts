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

import contact, { Employee, Person, PersonSpace } from '@hcengineering/contact'
import core, {
  buildSocialIdString,
  Class,
  combineAttributes,
  concatLink,
  Data,
  Doc,
  DocumentUpdate,
  generateId,
  Ref,
  SocialIdType,
  Tx,
  TxCreateDoc,
  TxCUD,
  TxMixin,
  TxProcessor,
  TxUpdateDoc
} from '@hcengineering/core'
import love, {
  isOffice,
  loveId,
  MeetingMinutes,
  MeetingStatus,
  Office,
  ParticipantInfo,
  Room,
  RoomAccess,
  RoomInfo,
  UserMeetingInvite
} from '@hcengineering/love'
import notification, { CommonInboxNotification } from '@hcengineering/notification'
import { getMetadata } from '@hcengineering/platform'
import serverCore, { TriggerControl } from '@hcengineering/server-core'
import { getSocialStrings } from '@hcengineering/server-contact'
import {
  getCommonNotificationTxes,
  getNotificationContent,
  getSenderInfo
} from '@hcengineering/server-notification-resources'
import { ReceiverInfo, SenderInfo } from '@hcengineering/server-notification'
import view from '@hcengineering/view'
import { workbenchId } from '@hcengineering/workbench'

export async function OnEmployee (txes: Tx[], control: TriggerControl): Promise<Tx[]> {
  const result: Tx[] = []
  const assigned = new Set<Ref<Office>>()
  for (const tx of txes) {
    let employeeId: Ref<Person> | undefined
    let active: boolean | undefined

    // Handle TxCreateDoc (direct Employee creation)
    if (tx._class === core.class.TxCreateDoc) {
      const createTx = tx as TxCreateDoc<Employee>
      if (createTx.objectClass === contact.mixin.Employee) {
        const created = TxProcessor.createDoc2Doc(createTx)
        employeeId = createTx.objectId as Ref<Person>
        active = created.active
      }
    } else if (tx._class === core.class.TxMixin) {
      // Handle TxMixin (Employee added as mixin to Person) - used by AI bot
      const mixinTx = tx as TxMixin<Person, Employee>
      if (mixinTx.mixin === contact.mixin.Employee) {
        employeeId = mixinTx.objectId
        active = mixinTx.attributes.active
      }
    }

    // Nothing to do if this tx does not touch the active state of an employee
    if (employeeId === undefined || active === undefined) {
      continue
    }

    // A mixin tx only carries the changed fields, so fetch the full employee to read its role
    const user = (
      await control.findAll(control.ctx, contact.mixin.Employee, { _id: employeeId as Ref<Employee> })
    )[0]
    if (user === undefined) {
      continue
    }
    if (user.role === 'GUEST') {
      continue
    }

    if (active) {
      // AI bot does not need an office
      if (await isAiBotPerson(employeeId, control)) {
        continue
      }

      // Do not assign one more office if the person already has one
      const existingOffice = (
        await control.findAll(control.ctx, love.class.Office, { person: employeeId }, { limit: 1 })
      )[0]
      if (existingOffice !== undefined) {
        continue
      }

      // Find a free office not already assigned in this batch and assign it
      const freeRoom = (await control.findAll(control.ctx, love.class.Office, { person: null })).find(
        (it) => !assigned.has(it._id)
      )
      if (freeRoom !== undefined) {
        assigned.add(freeRoom._id)
        result.push(
          control.txFactory.createTxUpdateDoc(freeRoom._class, freeRoom.space, freeRoom._id, {
            person: employeeId
          })
        )
      }
    } else {
      // Release all offices held by the person
      const rooms = await control.findAll(control.ctx, love.class.Office, { person: employeeId })
      for (const room of rooms) {
        result.push(
          control.txFactory.createTxUpdateDoc(room._class, room.space, room._id, {
            person: null
          })
        )
      }
    }
  }
  return result
}

// Keep in sync with aiBotAccountEmail from @hcengineering/ai-bot
// (not imported to avoid adding the package to server bundles)
export const aiBotAccountEmail = 'huly.ai.bot@hc.engineering'

export const aiBotEmailSocialKey = buildSocialIdString({
  type: SocialIdType.EMAIL,
  value: aiBotAccountEmail
})

const aiBotPersonsCacheKey = 'love:ai-bot-persons'

async function isAiBotPerson (person: Ref<Person>, control: TriggerControl): Promise<boolean> {
  let persons = control.cache.get(aiBotPersonsCacheKey) as Set<Ref<Person>> | undefined
  if (persons === undefined) {
    const identities = await control.findAll(control.ctx, contact.class.SocialIdentity, {
      key: aiBotEmailSocialKey
    })
    // Do not cache the negative result: the bot may join the workspace later
    if (identities.length === 0) return false
    persons = new Set(identities.map((it) => it.attachedTo))
    control.cache.set(aiBotPersonsCacheKey, persons)
  }
  return persons.has(person)
}

export async function OnUserStatus (txes: Tx[], control: TriggerControl): Promise<Tx[]> {
  return []
}

async function roomJoinHandler (info: ParticipantInfo, control: TriggerControl): Promise<Tx[]> {
  const res: Tx[] = []

  // Participants without a LiveKit sessionId (like AI bot) should not be added to RoomInfo.persons
  // to avoid triggering "room empty" logic when they disconnect (e.g., when stopping transcription)
  if (info.sessionId === null || info.sessionId === undefined) {
    return res
  }

  const roomInfos = await control.queryFind(control.ctx, love.class.RoomInfo, {})

  // Prefer MeetingMinutes association: if a ParticipantInfo references a meeting,
  // use the meeting's attached room as the canonical room for RoomInfo updates.
  let targetRoom = info.room
  if (info.meeting !== undefined) {
    const meeting = (await control.findAll(control.ctx, love.class.MeetingMinutes, { _id: info.meeting }))[0]
    if (meeting?.attachedTo !== undefined) {
      targetRoom = meeting.attachedTo as Ref<Room>
    }
  }

  const roomInfo = roomInfos.find((ri) => ri.room === targetRoom)
  if (roomInfo !== undefined && !roomInfo.persons.includes(info.person)) {
    res.push(
      control.txFactory.createTxUpdateDoc(love.class.RoomInfo, core.space.Workspace, roomInfo._id, {
        $push: { persons: info.person }
      })
    )
  } else {
    const room = (await control.findAll(control.ctx, love.class.Room, { _id: targetRoom }))[0]
    if (room === undefined) return []
    res.push(
      control.txFactory.createTxCreateDoc(love.class.RoomInfo, core.space.Workspace, {
        persons: [info.person],
        room: room._id,
        isOffice: isOffice(room)
      })
    )
  }
  if (info.account != null) {
    const meetingMinutes = (
      await control.findAll(control.ctx, love.class.MeetingMinutes, {
        attachedTo: info.room,
        status: MeetingStatus.Active
      })
    )[0]
    if (meetingMinutes !== undefined) {
      const colab = await control.findAll(control.ctx, core.class.Collaborator, {
        attachedTo: meetingMinutes._id,
        collaborator: info.account
      })
      if (colab.length === 0) {
        res.push(
          control.txFactory.createTxCreateDoc(core.class.Collaborator, core.space.Workspace, {
            attachedTo: meetingMinutes._id,
            attachedToClass: meetingMinutes._class,
            collection: 'collaborators',
            collaborator: info.account
          })
        )
      }
    }
  }
  return res
}

async function setDefaultRoomAccess (info: ParticipantInfo, control: TriggerControl): Promise<Tx[]> {
  const res: Tx[] = []
  const roomInfos = await control.queryFind(control.ctx, love.class.RoomInfo, {})
  const oldRoomInfo = roomInfos.find((ri) => ri.persons.includes(info.person))
  if (oldRoomInfo !== undefined) {
    if (oldRoomInfo.persons.length === 1 && oldRoomInfo.persons[0] === info.person) {
      res.push(control.txFactory.createTxRemoveDoc(oldRoomInfo._class, oldRoomInfo.space, oldRoomInfo._id))

      const resetAccessTx = control.txFactory.createTxUpdateDoc(
        oldRoomInfo.isOffice ? love.class.Office : love.class.Room,
        core.space.Workspace,
        oldRoomInfo.room,
        {
          access: oldRoomInfo.isOffice ? RoomAccess.Knock : RoomAccess.Open
        }
      )
      res.push(resetAccessTx)
    } else {
      res.push(
        control.txFactory.createTxUpdateDoc(love.class.RoomInfo, core.space.Workspace, oldRoomInfo._id, {
          $pull: { persons: info.person }
        })
      )
    }
  }
  return res
}

export async function OnParticipantInfo (txes: Tx[], control: TriggerControl): Promise<Tx[]> {
  const result: Tx[] = []
  for (const tx of txes) {
    const actualTx = tx as TxCUD<ParticipantInfo>
    if (actualTx._class === core.class.TxCreateDoc) {
      const info = TxProcessor.createDoc2Doc(actualTx as TxCreateDoc<ParticipantInfo>)
      result.push(...(await roomJoinHandler(info, control)))
    }
    if (actualTx._class === core.class.TxRemoveDoc) {
      const removedInfo = control.removedMap.get(actualTx.objectId) as ParticipantInfo
      if (removedInfo === undefined) {
        continue
      }
      result.push(...(await setDefaultRoomAccess(removedInfo, control)))
      continue
    }
    if (actualTx._class === core.class.TxUpdateDoc) {
      const newRoom = (actualTx as TxUpdateDoc<ParticipantInfo>).operations.room
      if (newRoom === undefined) {
        continue
      }
      const info = (
        await control.findAll(control.ctx, love.class.ParticipantInfo, { _id: actualTx.objectId }, { limit: 1 })
      )[0]
      if (info === undefined) {
        continue
      }
      result.push(...(await setDefaultRoomAccess(info, control)))
      result.push(...(await roomJoinHandler(info, control)))
    }
  }
  return result
}

export async function meetingMinutesHTMLPresenter (doc: Doc, control: TriggerControl): Promise<string> {
  const meetingMinutes = doc as MeetingMinutes
  const front = control.branding?.front ?? getMetadata(serverCore.metadata.FrontUrl) ?? ''

  const panelProps = [view.component.EditDoc, meetingMinutes._id, meetingMinutes._class]
  const fragment = encodeURIComponent(panelProps.join('|'))
  const path = `${workbenchId}/${control.workspace.url}/${loveId}#${fragment}`
  const link = concatLink(front, path)
  return `<a href="${link}">${meetingMinutes.title}</a>`
}

/**
 * @public
 */
export async function meetingMinutesTextPresenter (doc: Doc): Promise<string> {
  const meetingMinutes = doc as MeetingMinutes
  return meetingMinutes.title
}

async function OnRoomInfo (txes: TxCUD<RoomInfo>[], control: TriggerControl): Promise<Tx[]> {
  const result: Tx[] = []
  const personsByRoom = new Map<Ref<RoomInfo>, Ref<Person>[]>()
  for (const tx of txes) {
    if (tx._class === core.class.TxRemoveDoc) {
      const roomInfo = control.removedMap.get(tx.objectId) as RoomInfo
      if (roomInfo === undefined) continue
      if (roomInfo.room === love.ids.Reception) continue
      personsByRoom.delete(tx.objectId)
      // Note: We no longer call finishRoomMeetings here on RoomInfo removal.
      // The love service handles room_finished webhook and finishes the specific meeting by meetingId.
      // Calling finishRoomMeetings here would incorrectly finish ALL active meetings for the room.
      continue
    }
    if (tx._class === core.class.TxUpdateDoc) {
      const updateTx = tx as TxUpdateDoc<RoomInfo>
      const pulled = combineAttributes([updateTx.operations], 'persons', '$pull', '$in')
      const pushed = combineAttributes([updateTx.operations], 'persons', '$push', '$each')

      if (pulled.length === 0 && pushed.length === 0) continue
      const roomInfos = await control.queryFind(control.ctx, love.class.RoomInfo, {})
      const roomInfo = roomInfos.find((r) => r._id === tx.objectId)
      if (roomInfo === undefined) continue
      if (roomInfo.room === love.ids.Reception) continue

      const currentPersons = personsByRoom.get(tx.objectId) ?? roomInfo.persons
      const newPersons = currentPersons.filter((p) => !pulled.includes(p)).concat(pushed)

      personsByRoom.set(tx.objectId, newPersons)
    }
  }
  return result
}

async function getPersonSpace (control: TriggerControl, person: Ref<Person>): Promise<PersonSpace> {
  // Find recipient's personal space (PersonSpace)
  return (await control.findAll(control.ctx, contact.class.PersonSpace, { person }, { limit: 1 }))[0]
}

/**
 * Unified trigger for UserMeetingInvite
 * Handles all events: creation, updates from sender (expiresAt, cancellation), updates from recipient (accept/decline)
 */
export async function OnUserMeetingInvite (txes: Tx[], control: TriggerControl): Promise<Tx[]> {
  const result: Tx[] = []

  for (const tx of txes) {
    // Handle creation of invite-request
    if (tx._class === core.class.TxCreateDoc) {
      const createTx = tx as TxCreateDoc<UserMeetingInvite>
      if (createTx.objectClass !== love.class.UserMeetingInvite) continue

      const invite = TxProcessor.createDoc2Doc(createTx)

      // Only process invite-request kind
      if (invite.kind !== 'invite-request') continue
      if (invite.status !== 'pending') continue

      // Skip self-invites
      if (invite.from === invite.to) continue

      // Find recipient's personal space (PersonSpace)
      const recipientSpace = await getPersonSpace(control, invite.to)
      if (recipientSpace === undefined) continue

      // Create invite-response in recipient's space
      const responseId = generateId<UserMeetingInvite>()
      result.push(
        control.txFactory.createTxCreateDoc(
          love.class.UserMeetingInvite,
          recipientSpace._id,
          {
            kind: 'invite-response',
            from: invite.from,
            to: invite.to,
            meeting: invite.meeting,
            expiresAt: invite.expiresAt,
            status: 'pending'
          },
          responseId
        )
      )

      // Create notification for recipient
      const employee = (
        await control.findAll(
          control.ctx,
          contact.mixin.Employee,
          { _id: invite.to as Ref<Employee>, active: true },
          { limit: 1 }
        )
      )[0]
      if (employee?.personUuid != null) {
        const account = employee.personUuid
        const socialIds = await getSocialStrings(control, employee._id)

        const receiverInfo: ReceiverInfo = {
          account,
          socialIds,
          space: recipientSpace._id,
          employee: employee._id,
          role: employee.role
        }

        const senderInfo: SenderInfo = await getSenderInfo(control.ctx, tx.modifiedBy, control)

        // Check if should notify - we always notify for meeting invites
        const notifyResult = new Map([[notification.providers.InboxNotificationProvider, []]])

        const content = await getNotificationContent(createTx, invite.to, senderInfo, invite, control)

        // Get meeting info if available

        let notificationObjectId: Ref<Doc>
        let notificationObjectClass: Ref<Class<Doc>>

        if (invite.meeting !== undefined) {
          const meeting = await control
            .findAll(control.ctx, love.class.MeetingMinutes, { _id: invite.meeting }, { limit: 1 })
            .then((r) => r[0])
          // Attach to MeetingMinutes if exists
          notificationObjectId = meeting?._id ?? invite._id
          notificationObjectClass = meeting?._class ?? invite._class
        } else {
          // No meeting - attach to sender's Person
          notificationObjectId = invite.from
          notificationObjectClass = contact.class.Person
        }

        // Create notification with i18n message
        // Don't set headerObjectId/headerObjectClass to show sender's avatar instead
        const data: Partial<Data<CommonInboxNotification>> = {
          ...content,
          message: love.string.InvitingYou,
          props: {
            name: ''
          },
          header: love.string.MeetingRequest,
          headerIcon: love.icon.Invite
        }

        const notificationTxes = await getCommonNotificationTxes(
          control.ctx,
          control,
          invite,
          data,
          receiverInfo,
          senderInfo,
          notificationObjectId,
          notificationObjectClass,
          recipientSpace._id,
          createTx.modifiedOn,
          notifyResult,
          notification.class.CommonInboxNotification,
          createTx
        )

        result.push(...notificationTxes)
      }
    }

    // Handle updates
    if (tx._class === core.class.TxUpdateDoc || tx._class === core.class.TxRemoveDoc) {
      const cudTx = tx as TxCUD<UserMeetingInvite>
      if (cudTx.objectClass !== love.class.UserMeetingInvite) continue

      // Get the document being updated
      const sourceDoc =
        (
          await control.findAll(control.ctx, love.class.UserMeetingInvite, { _id: cudTx.objectId }, { limit: 1 })
        ).shift() ?? (control.removedMap.get(cudTx.objectId) as UserMeetingInvite | undefined)

      if (sourceDoc === undefined) continue

      if (sourceDoc.kind === 'invite-request') {
        // Update from sender - sync to recipient's invite-response
        // Find all invite-responses for this pair
        const inviteResponses = await control.findAll(control.ctx, love.class.UserMeetingInvite, {
          kind: 'invite-response',
          from: sourceDoc.from,
          to: sourceDoc.to
        })

        if (inviteResponses.length === 0) continue

        const now = Date.now()
        // Process all found invite-responses
        for (const response of inviteResponses) {
          // Handle cancellation - sync only if status changed
          if (tx._class === core.class.TxRemoveDoc || response.expiresAt < now) {
            // We need to remove other side
            result.push(control.txFactory.createTxRemoveDoc(love.class.UserMeetingInvite, response.space, response._id))
            continue
          }
          const updateTx = tx as TxUpdateDoc<UserMeetingInvite>

          // Handle expiresAt update - only if response is still pending and expiresAt changed
          if (updateTx.operations.expiresAt !== undefined && response.expiresAt !== updateTx.operations.expiresAt) {
            result.push(
              control.txFactory.createTxUpdateDoc(love.class.UserMeetingInvite, response.space, response._id, {
                expiresAt: updateTx.operations.expiresAt
              })
            )
          }
        }
      } else if (sourceDoc.kind === 'invite-response' && tx._class === core.class.TxUpdateDoc) {
        // Find invite-request for this pair
        const inviteRequests = await control.findAll(control.ctx, love.class.UserMeetingInvite, {
          kind: 'invite-request',
          from: sourceDoc.from,
          to: sourceDoc.to
        })

        const updateTx = tx as TxUpdateDoc<UserMeetingInvite>
        // Update from recipient (accept/decline) - sync to sender's invite-request
        const newStatus = updateTx.operations.status
        const newMeeting = updateTx.operations.meeting

        // If nothing changed, skip
        if (newStatus === undefined && newMeeting === undefined) continue

        if (newStatus === 'declined' || (newStatus === 'accepted' && newMeeting !== undefined)) {
          // If we declined or accepted and meeting is set, we can remove the invite-response as it's no longer needed
          result.push(
            control.txFactory.createTxRemoveDoc(love.class.UserMeetingInvite, updateTx.objectSpace, updateTx.objectId)
          )
        }

        for (const request of inviteRequests) {
          const upd: DocumentUpdate<UserMeetingInvite> = {}
          // Sync status if changed
          if (newStatus !== undefined && request.status !== newStatus) {
            upd.status = newStatus
          }
          // Sync meeting reference if provided (recipient created/joined a meeting)
          if (newMeeting !== undefined && request.meeting !== newMeeting) {
            upd.meeting = newMeeting
          }
          if (Object.keys(upd).length > 0) {
            result.push(
              control.txFactory.createTxUpdateDoc(love.class.UserMeetingInvite, request.space, request._id, upd)
            )
          }
        }
      }
    }
  }

  return result
}

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export default async () => ({
  function: {
    MeetingMinutesHTMLPresenter: meetingMinutesHTMLPresenter,
    MeetingMinutesTextPresenter: meetingMinutesTextPresenter
  },
  trigger: {
    OnEmployee,
    OnUserStatus,
    OnParticipantInfo,
    OnRoomInfo,
    OnUserMeetingInvite
  }
})
