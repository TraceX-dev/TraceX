import { parseParticipantMetadata } from './utils'
/**
  Copyright © 2026 Intabia Fusion.

  Licensed under the Eclipse Public License, Version 2.0 (the "License");
  you may not use this file except in compliance with the License. You may
  obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0

  Unless required by applicable law or agreed to in writing, software
  distributed under the License is distributed on an "AS IS" BASIS,
  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.

  See the License for the specific language governing permissions and
  limitations under the License.
*/

import { MeasureContext, Ref, WorkspaceUuid } from '@hcengineering/core'
import { Person } from '@hcengineering/contact'
import { MeetingMinutes, ParticipantInfo, parseRoomName } from '@hcengineering/love'
import { RoomServiceClient, ParticipantInfo as LiveKitParticipant, Room } from 'livekit-server-sdk'
import { WorkspaceClient } from './workspaceClient'

/**
 * Configuration for the polling service
 */
export interface PollingConfig {
  /** Polling interval in milliseconds */
  intervalMs: number
  /** LiveKit project key used in room metadata */
  projectKey: string
}

/**
 * Tracks the state of a LiveKit room for reconciliation
 */
interface RoomState {
  roomName: string
  workspace: WorkspaceUuid
  meetingId: Ref<MeetingMinutes>
  participants: Map<string, LiveKitParticipant>
  lastUpdated: number
}

/**
 * LiveKit Polling Service
 *
 * Periodically polls LiveKit to reconcile state with the platform database.
 * This ensures consistency when webhooks are missed or delayed.
 *
 * Features:
 * - Reconciles ParticipantInfo with actual LiveKit participants
 * - Reconciles participants and fixes missed events
 * - Detects and handles missed participant_joined/left events
 */
export class LiveKitPollingService {
  private readonly ctx: MeasureContext
  private readonly roomClient: RoomServiceClient
  private readonly config: PollingConfig
  private intervalHandle: NodeJS.Timeout | null = null
  private isRunning = false
  private readonly roomStates = new Map<string, RoomState>()

  private readonly workspacesToCheck = new Set<WorkspaceUuid>()
  // Last successful unfinished-meetings check per workspace. Transactions do not re-trigger the check
  // until RECHECK_INTERVAL_MS has passed: it is a safety net (after a restart, or for meetings whose room
  // disappeared before it was ever seen by polling), not something that has to follow every transaction.
  private readonly lastCheckTime = new Map<WorkspaceUuid, number>()
  // Failed checks waiting for a retry with exponential backoff
  private readonly pendingRetries = new Map<WorkspaceUuid, { attempts: number, notBefore: number }>()
  private isPolling = false
  private cycleCount = 0
  private readonly lastCleanupTime = new Map<WorkspaceUuid, number>()
  private static readonly CLEANUP_INTERVAL_MS = 60 * 60 * 1000 // 1 hour
  private static readonly RECHECK_INTERVAL_MS = 60 * 60 * 1000 // 1 hour
  private static readonly RETRY_BASE_MS = 30 * 1000
  private static readonly RETRY_MAX_MS = 10 * 60 * 1000
  private static readonly MAX_CHECK_ATTEMPTS = 10
  // Log a heartbeat at info level every N cycles (the rest is debug)
  private static readonly HEARTBEAT_EVERY_CYCLES = 20

  constructor (ctx: MeasureContext, roomClient: RoomServiceClient, config: PollingConfig) {
    this.ctx = ctx
    this.roomClient = roomClient
    this.config = config
  }

  addWorkspaceToCheck (workspace: WorkspaceUuid): void {
    // A failed check is already scheduled with its own backoff
    if (this.pendingRetries.has(workspace)) return
    const last = this.lastCheckTime.get(workspace)
    if (last !== undefined && Date.now() - last < LiveKitPollingService.RECHECK_INTERVAL_MS) return
    this.workspacesToCheck.add(workspace)
  }

  private scheduleRetry (workspace: WorkspaceUuid): void {
    const attempts = (this.pendingRetries.get(workspace)?.attempts ?? 0) + 1
    if (attempts >= LiveKitPollingService.MAX_CHECK_ATTEMPTS) {
      // Give up for now; the next transaction in this workspace starts over
      this.pendingRetries.delete(workspace)
      this.ctx.warn('[PollingService] Giving up checking unfinished meetings', { workspace, attempts })
      return
    }
    const delay = Math.min(
      LiveKitPollingService.RETRY_BASE_MS * 2 ** (attempts - 1),
      LiveKitPollingService.RETRY_MAX_MS
    )
    this.pendingRetries.set(workspace, { attempts, notBefore: Date.now() + delay })
  }

  private takeDueRetries (now: number): WorkspaceUuid[] {
    const due: WorkspaceUuid[] = []
    for (const [workspace, retry] of this.pendingRetries) {
      if (retry.notBefore <= now) due.push(workspace)
    }
    return due
  }

  /**
   * Check if cleanup should be run for a workspace (at most once per hour)
   */
  private shouldRunCleanup (workspace: WorkspaceUuid): boolean {
    const lastCleanup = this.lastCleanupTime.get(workspace)
    const now = Date.now()
    if (lastCleanup === undefined || now - lastCleanup >= LiveKitPollingService.CLEANUP_INTERVAL_MS) {
      this.lastCleanupTime.set(workspace, now)
      return true
    }
    return false
  }

  /**
   * Start the polling service
   */
  start (): void {
    if (this.isRunning) {
      this.ctx.warn('[PollingService] Already running, ignoring start()')
      return
    }

    this.isRunning = true
    this.ctx.info('[PollingService] Starting polling service', {
      intervalMs: this.config.intervalMs,
      projectKey: this.config.projectKey
    })

    // Run immediately on start
    void this.poll()

    // Schedule periodic polling
    this.intervalHandle = setInterval(() => {
      void this.poll()
    }, this.config.intervalMs)
  }

  /**
   * Stop the polling service
   */
  stop (): void {
    if (!this.isRunning) {
      return
    }

    this.isRunning = false
    if (this.intervalHandle !== null) {
      clearInterval(this.intervalHandle)
      this.intervalHandle = null
    }
    this.ctx.info('[PollingService] Stopped polling service')
  }

  private async getOurRooms (): Promise<Room[]> {
    // Get all active rooms from LiveKit
    const rooms = await this.roomClient.listRooms()

    // Filter rooms that belong to our project
    return rooms.filter((room) => {
      try {
        const metadata = room.metadata !== undefined && room.metadata !== '' ? JSON.parse(room.metadata) : {}
        return metadata.projectKey === this.config.projectKey
      } catch {
        return false
      }
    })
  }

  /**
   * Main polling loop - fetches all rooms and reconciles state
   */
  private async poll (): Promise<void> {
    if (!this.isRunning || this.isPolling) return
    this.isPolling = true

    try {
      if (this.cycleCount++ % LiveKitPollingService.HEARTBEAT_EVERY_CYCLES === 0) {
        this.ctx.info('[PollingService] Starting poll cycle', { cycle: this.cycleCount })
      } else {
        this.ctx.debug('[PollingService] Starting poll cycle')
      }

      const ourRooms = await this.getOurRooms()

      // Process each room
      for (const room of ourRooms) {
        try {
          await this.processRoom(room)
        } catch (err: any) {
          this.ctx.error('[PollingService] Error processing room', {
            roomName: room.name,
            error: err?.message ?? String(err)
          })
        }
      }

      // We need to check workspaces added to check for un finished meetings.
      const wtc = Array.from(new Set([...this.workspacesToCheck, ...this.takeDueRetries(Date.now())]))
      this.workspacesToCheck.clear()
      for (const workspace of wtc) {
        let ok = false
        let wsClient: WorkspaceClient | undefined
        try {
          wsClient = await WorkspaceClient.create(workspace, this.ctx)
          ok = await wsClient.checkUnfinishedMeetings(
            ourRooms
              .map((it) => parseRoomName(it.name))
              .filter((it) => it?.workspace === workspace)
              .map((it) => it?.meetingId)
              .filter((it) => it != null)
          )
        } catch (err: any) {
          this.ctx.error('[PollingService] Error checking unfinished meetings', {
            workspace,
            error: err?.message ?? String(err)
          })
        }

        if (!ok || wsClient === undefined) {
          this.scheduleRetry(workspace)
          continue
        }
        this.pendingRetries.delete(workspace)
        this.lastCheckTime.set(workspace, Date.now())

        // Also clean up orphaned ParticipantInfo entries for finished meetings (at most once per hour).
        // A cleanup failure does not require repeating the meetings check.
        try {
          if (this.shouldRunCleanup(workspace)) {
            await wsClient.cleanupOrphanedParticipantInfos()
          }
        } catch (err: any) {
          this.ctx.error('[PollingService] Error cleaning up orphaned ParticipantInfo', {
            workspace,
            error: err?.message ?? String(err)
          })
        }
      }

      // Clean up state for rooms that no longer exist
      await this.cleanupStaleRoomStates(ourRooms)
    } catch (err: any) {
      this.ctx.error('[PollingService] Error during poll', {
        error: err?.message ?? String(err)
      })
    } finally {
      this.isPolling = false
    }
  }

  /**
   * Process a single room - reconcile participants and pending joins
   */
  private async processRoom (room: Room): Promise<void> {
    const roomName = room.name
    if (roomName === undefined || roomName === '') return

    // Parse room name to extract workspace and meeting ID
    const parsed = parseRoomName(roomName)
    if (parsed === undefined) {
      this.ctx.warn('[PollingService] Could not parse room name', { roomName })
      return
    }

    const { workspace, meetingId } = parsed

    // Get participants from LiveKit
    const participants = await this.roomClient.listParticipants(roomName)

    // Get previous state (if any)
    const previousState = this.roomStates.get(roomName)
    const previousParticipants = previousState?.participants ?? new Map()

    // Build current participant map (exclude agents) for join/leave detection
    const currentParticipants = new Map<string, LiveKitParticipant>()
    // Build all participants map (including agents) for database reconciliation
    const allParticipants = new Map<string, LiveKitParticipant>()
    for (const p of participants) {
      if (p.identity !== undefined && p.identity !== '') {
        allParticipants.set(p.identity, p)
        // Skip agent participants (AI bots) for join/leave detection only
        if (p.permission?.agent !== true && p.kind !== 4) {
          currentParticipants.set(p.identity, p)
        }
      }
    }

    // Update state
    this.roomStates.set(roomName, {
      roomName,
      workspace,
      meetingId,
      participants: currentParticipants,
      lastUpdated: Date.now()
    })

    // Reconcile with database (compare DB state with LiveKit state, not just in-memory cache)
    // Use allParticipants (including agents) to avoid removing AI bot ParticipantInfo entries
    // Fetch ParticipantInfo once and share it between both reconciliation steps
    let dbParticipants: ParticipantInfo[]
    try {
      const wsClient = await WorkspaceClient.create(workspace, this.ctx)
      dbParticipants = await wsClient.findParticipantInfosByMeeting(meetingId)
    } catch (err: any) {
      this.ctx.error('[PollingService] Error loading ParticipantInfo', {
        workspace,
        meetingId,
        error: err?.message ?? String(err)
      })
      return
    }

    // Pass on only the entries that survived the cleanup, so the join detection below does not see removed ones
    const remainingParticipants = await this.reconcileParticipantsWithDatabase(
      workspace,
      meetingId,
      allParticipants,
      dbParticipants
    )

    // Also reconcile in-memory cache for detecting joins (backwards compatibility)
    await this.reconcileParticipants(
      workspace,
      meetingId,
      previousParticipants,
      currentParticipants,
      remainingParticipants
    )
  }

  /**
   * Reconcile database ParticipantInfo with actual LiveKit participants.
   * Removes ParticipantInfo entries for participants not present in LiveKit.
   * This handles cases where webhooks were missed and in-memory cache was lost (e.g., service restart).
   *
   * Note: allParticipants should include ALL participants (including agents/bots)
   * to avoid incorrectly removing ParticipantInfo for AI bots.
   */
  private async reconcileParticipantsWithDatabase (
    workspace: WorkspaceUuid,
    meetingId: Ref<MeetingMinutes>,
    allParticipants: Map<string, LiveKitParticipant>,
    dbParticipants: ParticipantInfo[]
  ): Promise<ParticipantInfo[]> {
    const removed = new Set<string>()
    try {
      const wsClient = await WorkspaceClient.create(workspace, this.ctx)

      // Build set of identities currently in LiveKit (including agents)
      const liveKitIdentities = new Set(allParticipants.keys())

      // Find ParticipantInfo entries not present in LiveKit and remove them
      for (const dbParticipant of dbParticipants) {
        // Check if this participant's person is in LiveKit
        const personId = dbParticipant.person
        if (personId !== undefined && personId !== null) {
          const identityStr = personId as string
          if (!liveKitIdentities.has(identityStr)) {
            this.ctx.info('[PollingService] Removing stale ParticipantInfo (not in LiveKit)', {
              workspace,
              meetingId,
              participantInfoId: dbParticipant._id,
              person: personId,
              name: dbParticipant.name
            })
            await wsClient.removeParticipantInfoById(dbParticipant._id)
            removed.add(dbParticipant._id)
          }
        }
      }
    } catch (err: any) {
      this.ctx.error('[PollingService] Error reconciling participants with database', {
        workspace,
        meetingId,
        error: err?.message ?? String(err)
      })
    }
    return dbParticipants.filter((it) => !removed.has(it._id))
  }

  /**
   * Reconcile in-memory cache state with LiveKit state (for detecting new joins)
   */
  private async reconcileParticipants (
    workspace: WorkspaceUuid,
    meetingId: Ref<MeetingMinutes>,
    previousParticipants: Map<string, LiveKitParticipant>,
    currentParticipants: Map<string, LiveKitParticipant>,
    existingParticipantInfos: ParticipantInfo[]
  ): Promise<void> {
    try {
      const wsClient = await WorkspaceClient.create(workspace, this.ctx)

      // Existing ParticipantInfo (preloaded once per room) avoids false positives in detection.
      // We collect both person refs (person field) and stored display names to catch cases
      // where a ParticipantInfo already exists but the in-memory `previousParticipants` cache was stale.
      const existingPersonIds = new Set(existingParticipantInfos.map((it) => String(it.person)))
      const existingNames = new Set(existingParticipantInfos.map((it) => (it.name ?? '').toString()))

      // Find participants who joined (in current but not in previous)
      for (const [identity, participant] of currentParticipants) {
        if (participant?.kind !== 0) {
          continue // Skip agents
        }
        if (!previousParticipants.has(identity)) {
          // If ParticipantInfo already exists in DB (by person id or by recorded name), skip the missed-join handling.
          const nameStr = participant.name ?? participant.identity ?? ''
          const alreadyExistsByIdentity = existingPersonIds.has(identity)
          const alreadyExistsByName = existingNames.has(nameStr)

          if (alreadyExistsByIdentity || alreadyExistsByName) {
            this.ctx.info('[PollingService] Skipping missed participant_joined (ParticipantInfo exists in DB)', {
              workspace,
              meetingId,
              identity,
              name: participant.name
            })
            continue
          }

          this.ctx.info('[PollingService] Detected missed participant_joined', {
            workspace,
            meetingId,
            identity,
            name: participant.name
          })

          // Try to resolve person from identity (may be undefined for guest identities)
          const personRef = await wsClient.findPersonRefById(identity as Ref<Person>)

          // Double-check: maybe personRef maps to an existing ParticipantInfo even if identity wasn't in existingPersonIds earlier.
          if (personRef != null && existingPersonIds.has(String(personRef))) {
            this.ctx.info(
              '[PollingService] Skipping missed participant_joined (participant resolved to existing PersonRef)',
              {
                workspace,
                meetingId,
                identity,
                personRef,
                name: participant.name
              }
            )
            continue
          }

          if (personRef !== undefined) {
            // Upsert ParticipantInfo
            await wsClient.upsertParticipantFromLiveKit(
              personRef,
              participant.name ?? participant.identity ?? 'Unknown',
              null,
              meetingId,
              participant.sid,
              parseParticipantMetadata(participant.metadata)
            )
          }
        }
      }

      // Find participants who left (in previous but not in current)
      for (const [identity, participant] of previousParticipants) {
        if (participant?.kind !== 0) {
          continue // Skip agents
        }
        if (!currentParticipants.has(identity)) {
          this.ctx.info('[PollingService] Detected missed participant_left', {
            workspace,
            meetingId,
            identity,
            name: participant.name
          })

          // Try to resolve person from identity
          const personRef = await wsClient.findPersonRefById(identity as Ref<Person>)

          // Remove ParticipantInfo
          if (personRef !== undefined) {
            await wsClient.removeParticipantFromLiveKit(meetingId, personRef, participant.sid)
          }
        }
      }
    } catch (err: any) {
      this.ctx.error('[PollingService] Error reconciling participants', {
        workspace,
        meetingId,
        error: err?.message ?? String(err)
      })
    }
  }

  /**
   * Clean up state for rooms that no longer exist in LiveKit
   */
  private async cleanupStaleRoomStates (activeRooms: Room[]): Promise<void> {
    const activeRoomNames = new Set(activeRooms.map((r) => r.name).filter(Boolean))

    for (const [roomName, state] of this.roomStates) {
      if (!activeRoomNames.has(roomName)) {
        this.ctx.info('[PollingService] Room no longer exists, cleaning up state', {
          roomName,
          workspace: state.workspace,
          meetingId: state.meetingId
        })

        // Room ended - ensure meeting is marked as finished and pending joins are cleaned up
        try {
          const wsClient = await WorkspaceClient.create(state.workspace, this.ctx)
          await wsClient.finishMeeting(state.meetingId, Date.now())
        } catch (err: any) {
          this.ctx.error('[PollingService] Error finishing meeting for closed room', {
            roomName,
            error: err?.message ?? String(err)
          })
        }

        this.roomStates.delete(roomName)
      }
    }
  }
}
