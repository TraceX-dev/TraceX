import { WorkspaceUuid } from '@hcengineering/core'

export interface BillingStats {
  liveKitStats: LiveKitStats
  datalakeStats: DatalakeStats
  aiStats: AiStats
}

export interface DatalakeStats {
  count: number
  size: number
}

export interface LiveKitStats {
  sessions: LiveKitSessionsStats[]
  egress: LiveKitEgressStats[]
}

export interface LiveKitSessionsStats {
  day: string
  bandwidth: number
  minutes: number
}

export interface LiveKitEgressStats {
  day: string
  minutes: number
}

export interface LiveKitSessionData {
  workspace: string
  room: string
  sessionId: string
  sessionStart: string
  sessionEnd: string
  bandwidth: number
  minutes: number
}

export interface LiveKitEgressData {
  workspace: string
  room: string
  egressId: string
  egressStart: string
  egressEnd: string
  duration: number
}

export interface AiTranscriptStats {
  totalDurationSeconds: number
}

export interface AiTokensStats {
  reason: string
  totalTokens: number
  inputTokens: number
  outputTokens: number
}

export interface AiStats {
  transcript: AiTranscriptStats
  tokens: AiTokensStats[]
}

export interface AiTranscriptData {
  workspace: WorkspaceUuid
  day: string
  lastRequestId: string
  lastStartTime: string
  durationSeconds: number
  usd: number
}

export interface AiTokensData {
  workspace: WorkspaceUuid
  reason: string
  inputTokens: number
  outputTokens: number
  date: string
}
