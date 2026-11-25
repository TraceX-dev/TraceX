import { Employee, Person } from '@hcengineering/contact'
import { Data, generateId, Ref, WorkspaceUuid } from '@hcengineering/core'

import love from './plugin'
import { MeetingMinutes, Office, ParticipantInfo, Room, RoomAccess, RoomType } from './types'

/**
 * Parsed LiveKit room name components
 */
export interface ParsedRoomName {
  workspace: WorkspaceUuid
  meetingId: Ref<MeetingMinutes>
}

/**
 * Parse LiveKit room name to extract workspace and meeting ID.
 * Room name format: workspaceUuid_meetingMinutesId (2 non-empty parts separated by underscore)
 *
 * @param roomName - The LiveKit room name string
 * @returns ParsedRoomName if valid, undefined otherwise
 */
export function parseRoomName (roomName: string): ParsedRoomName | undefined {
  const parts = roomName.split('_')
  if (parts.length < 2) return undefined

  const workspace = parts[0]
  const meetingId = parts[parts.length - 1]

  // Both parts must be non-empty
  if (workspace === '' || meetingId === '') return undefined

  return {
    workspace: workspace as WorkspaceUuid,
    meetingId: meetingId as Ref<MeetingMinutes>
  }
}

export const GRID_WIDTH = 15

interface Slot {
  _id?: Ref<Room>
  width: number
  height: number
  x: number
  y: number
}

export function isOffice (room: Data<Room>): room is Office {
  return (room as Office).person !== undefined
}

type RoomAccessFields = Pick<Data<Room>, 'access' | 'owners' | 'defaultAccess'> & Partial<Pick<Office, 'person'>>

function isOfficeLike (room: RoomAccessFields): boolean {
  return room.person !== undefined
}

/**
 * Access levels that require someone to admit or invite a person into a shared room.
 */
export function isApprovalAccess (access: RoomAccess | undefined): boolean {
  return access === RoomAccess.Knock || access === RoomAccess.InviteOnly
}

/**
 * Owners of a room: the assigned person for an office, the owners list for a shared room.
 */
export function getRoomOwners (room: RoomAccessFields): Array<Ref<Person>> {
  if (isOfficeLike(room)) {
    return room.person != null ? [room.person] : []
  }
  return room.owners ?? []
}

export function isRoomOwner (room: RoomAccessFields, person: Ref<Person> | undefined): boolean {
  if (person === undefined) return false
  return getRoomOwners(room).includes(person)
}

/**
 * Access the room returns to when everybody leaves it.
 */
export function getDefaultRoomAccess (room: RoomAccessFields): RoomAccess {
  if (isOfficeLike(room)) return RoomAccess.Knock
  return room.defaultAccess ?? RoomAccess.Open
}

/**
 * Whether entering a shared room requires an approval or an invitation.
 * A room without owners is public: nobody could admit people into it.
 */
export function requiresApproval (room: RoomAccessFields): boolean {
  return !isOfficeLike(room) && isApprovalAccess(room.access) && getRoomOwners(room).length > 0
}

/**
 * Access levels that can be selected for a room. Approval levels need at least one owner.
 */
export function getAvailableRoomAccess (room: RoomAccessFields): RoomAccess[] {
  if (isOfficeLike(room)) return [RoomAccess.Knock, RoomAccess.DND]
  if (getRoomOwners(room).length === 0) return [RoomAccess.Open, RoomAccess.DND]
  return [RoomAccess.Open, RoomAccess.Knock, RoomAccess.InviteOnly, RoomAccess.DND]
}

/**
 * Whether the person can change the current and default access of the room.
 * Offices are managed by their person, public rooms by anyone, rooms with owners by owners and maintainers.
 */
export function canManageRoomAccess (
  room: RoomAccessFields,
  person: Ref<Person> | undefined,
  isMaintainer: boolean
): boolean {
  if (isOfficeLike(room)) return person !== undefined && room.person === person
  if (getRoomOwners(room).length === 0) return true
  return isMaintainer || isRoomOwner(room, person)
}

/**
 * Whether the person can change the default access of a shared room. The default access persists,
 * so for a public room it is managed by maintainers, otherwise anyone could lock the room permanently.
 */
export function canManageRoomDefaultAccess (
  room: RoomAccessFields,
  person: Ref<Person> | undefined,
  isMaintainer: boolean
): boolean {
  if (isOfficeLike(room)) return false
  if (getRoomOwners(room).length === 0) return isMaintainer
  return isMaintainer || isRoomOwner(room, person)
}

/**
 * Whether the person can change owners of a shared room. Owners of a public room are assigned by maintainers.
 */
export function canManageRoomOwners (
  room: RoomAccessFields,
  person: Ref<Person> | undefined,
  isMaintainer: boolean
): boolean {
  if (isOfficeLike(room)) return false
  return isMaintainer || isRoomOwner(room, person)
}

/**
 * A shared room with an approval access, current or default, must have at least one owner.
 */
export function isValidRoomOwnership (room: RoomAccessFields): boolean {
  if (isOfficeLike(room)) return true
  if (!isApprovalAccess(room.access) && !isApprovalAccess(room.defaultAccess)) return true
  return getRoomOwners(room).length > 0
}

export function createDefaultRooms (
  employees: Ref<Employee>[],
  defaultTranscription: boolean = false,
  defaultRecording: boolean = false
): (Data<Room | Office> & { _id: Ref<Room> })[] {
  const res: (Data<Room | Office> & { _id: Ref<Room> })[] = []
  // create 12 offices
  for (let index = 0; index < 12; index++) {
    const _id = generateId<Office>()
    const office: Data<Office> & { _id: Ref<Office> } = {
      _id,
      name: '',
      type: RoomType.Video,
      access: RoomAccess.Knock,
      floor: love.ids.MainFloor,
      width: 2,
      height: 1,
      x: (index % 2) * 3,
      y: index - (index % 2),
      person: employees[index] ?? null,
      language: 'en',
      startWithTranscription: false,
      startWithRecording: false,
      description: null
    }
    res.push(office)
  }
  const allHands = generateId<Room>()

  res.push({
    _id: allHands,
    name: 'All hands',
    type: RoomType.Video,
    access: RoomAccess.Open,
    floor: love.ids.MainFloor,
    width: 9,
    height: 3,
    x: 6,
    y: 0,
    language: 'en',
    startWithTranscription: defaultTranscription,
    startWithRecording: defaultRecording,
    description: null
  })

  const meetingRoom1 = generateId<Room>()
  res.push({
    _id: meetingRoom1,
    name: 'Meeting Room 1',
    type: RoomType.Video,
    access: RoomAccess.Open,
    floor: love.ids.MainFloor,
    width: 4,
    height: 3,
    x: 6,
    y: 4,
    language: 'en',
    startWithTranscription: defaultTranscription,
    startWithRecording: defaultRecording,
    description: null
  })
  const meetingRoom2 = generateId<Room>()
  res.push({
    _id: meetingRoom2,
    name: 'Meeting Room 2',
    type: RoomType.Video,
    access: RoomAccess.Open,
    floor: love.ids.MainFloor,
    width: 4,
    height: 3,
    x: 11,
    y: 4,
    language: 'en',
    startWithTranscription: defaultTranscription,
    startWithRecording: defaultRecording,
    description: null
  })
  const voiceRoom1 = generateId<Room>()
  res.push({
    _id: voiceRoom1,
    name: 'Voice Room 1',
    type: RoomType.Audio,
    access: RoomAccess.Open,
    floor: love.ids.MainFloor,
    width: 4,
    height: 3,
    x: 6,
    y: 8,
    language: 'en',
    startWithTranscription: false,
    startWithRecording: false,
    description: null
  })
  const voiceRoom2 = generateId<Room>()
  res.push({
    _id: voiceRoom2,
    name: 'Voice Room 2',
    type: RoomType.Audio,
    access: RoomAccess.Open,
    floor: love.ids.MainFloor,
    width: 4,
    height: 3,
    x: 11,
    y: 8,
    language: 'en',
    startWithTranscription: false,
    startWithRecording: false,
    description: null
  })
  return res
}

const cropMaxWidth = (width: number): number => {
  return width > GRID_WIDTH ? GRID_WIDTH : width
}

export function getFreeSpace (rooms: Slot[], exclude?: Slot, completeExclusion?: boolean): boolean[][] {
  const sorted = [...rooms].sort((a, b) => a.y - b.y)
  const map: boolean[][] = [new Array(GRID_WIDTH).fill(true)]

  for (const room of sorted) {
    const excluded: boolean = exclude?._id === room._id
    for (
      let y = room.y === 0 ? 0 : excluded ? room.y : room.y - 1;
      y < room.y + room.height + (excluded ? 0 : 1);
      y++
    ) {
      if (map[y] === undefined) {
        map[y] = new Array(GRID_WIDTH).fill(true)
      }
      for (
        let x = room.x === 0 ? 0 : excluded ? room.x : room.x - 1;
        x <
        (room.x + room.width - 1 < GRID_WIDTH
          ? excluded
            ? cropMaxWidth(room.x + room.width)
            : cropMaxWidth(room.x + room.width + 1)
          : GRID_WIDTH - 1);
        x++
      ) {
        map[y][x] = completeExclusion === true && excluded
      }
    }
  }
  map.push(new Array(GRID_WIDTH).fill(true))

  return map
}

export function getFreePosition (
  rooms: Slot[],
  width: number,
  height: number
): {
  x: number
  y: number
} {
  const map: boolean[][] = getFreeSpace(rooms)

  for (let y = 0; y <= map.length; y++) {
    if (map[y] === undefined) {
      map[y] = new Array(GRID_WIDTH).fill(true)
    }
    for (let x = 0; x < map[y].length; x++) {
      if (map[y][x]) {
        let matched = true
        for (let yIndex = 0; yIndex < height; yIndex++) {
          if (map[y + yIndex] === undefined) {
            map[y + yIndex] = new Array(GRID_WIDTH).fill(true)
          }
          for (let xIndex = 0; xIndex < width; xIndex++) {
            if (!map[y + yIndex][x + xIndex]) {
              matched = false
              break
            }
          }
        }
        if (matched) {
          return {
            x,
            y
          }
        }
      }
    }
  }

  return {
    x: 0,
    y: 0
  }
}

export function checkIntersection (rooms: Slot[], width: number, height: number, x: number, y: number): boolean {
  for (const room of rooms) {
    if (x <= room.x + room.width && x + width >= room.x && y <= room.y + room.height && y + height >= room.y) {
      return true
    }
  }
  return false
}

export interface ScreenSource {
  id: string
  name: string
  thumbnailURL: string
  appIconURL: string
}

export function getFreeRoomPlace (
  room: Room,
  info: ParticipantInfo[],
  person: Ref<Person>,
  pref?: { x: number, y: number }
): { x: number, y: number } {
  let y = 0
  if (pref !== undefined) {
    if (isOffice(room) && room.person === person) {
      return { x: 0, y: 0 }
    }
    if (!info.some((it) => it.x === pref.x && it.y === pref.y)) {
      // Place is free, use it.
      return pref
    }
  }
  while (true) {
    for (let x = 0; x < room.width; x++) {
      if (info.find((p) => p.x === x && p.y === y) === undefined) {
        if (x === 0 && y === 0 && isOffice(room)) {
          if (room.person === person) {
            return { x: 0, y: 0 }
          }
        } else {
          return { x, y }
        }
      }
    }
    y++
  }
}
