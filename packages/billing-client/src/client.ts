import { concatLink, type MeasureContext, WorkspaceUuid } from '@hcengineering/core'
import { BillingError, NetworkError } from './error'
import {
  AiTokensData,
  AiTranscriptData,
  BillingStats,
  DatalakeStats,
  LiveKitEgressData,
  LiveKitEgressStats,
  LiveKitSessionData,
  LiveKitSessionsStats,
  LiveKitStats
} from './types'

export interface BillingClient {
  getBillingStats: (workspace: WorkspaceUuid) => Promise<BillingStats>
  getDatalakeStats: (workspace: WorkspaceUuid) => Promise<DatalakeStats>
  getLiveKitStats: (workspace: WorkspaceUuid) => Promise<LiveKitStats>
  getLiveKitSessionsStats: (workspace: WorkspaceUuid) => Promise<LiveKitSessionsStats[]>
  getLiveKitEgressStats: (workspace: WorkspaceUuid) => Promise<LiveKitEgressStats[]>
  postLiveKitSessions: (sessions: LiveKitSessionData[]) => Promise<void>
  postLiveKitEgress: (egress: LiveKitEgressData[]) => Promise<void>
  getAiTranscriptLastData: () => Promise<AiTranscriptData | undefined>
  postAiTranscriptData: (data: AiTranscriptData[]) => Promise<void>
  postAiTokensData: (data: AiTokensData[]) => Promise<void>
}

/** @public */
export function getClient (billingUrl?: string, token?: string): BillingClient {
  if (billingUrl === undefined || billingUrl == null || billingUrl === '') {
    throw new Error('Billing url not specified')
  }
  if (token === undefined || token == null || token === '') {
    throw new Error('Token not specified')
  }

  return new HttpBillingClient(billingUrl, token)
}

export class HttpBillingClient implements BillingClient {
  private readonly headers: Record<string, string>

  constructor (
    private readonly endpoint: string,
    token: string
  ) {
    this.headers = {
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/json'
    }
  }

  async getBillingStats (workspace: WorkspaceUuid): Promise<BillingStats> {
    const path = `/api/v1/${workspace}/stats`
    const url = new URL(concatLink(this.endpoint, path))
    const response = await fetchSafe(url, { headers: { ...this.headers } })
    return (await response.json()) as BillingStats
  }

  async getDatalakeStats (workspace: WorkspaceUuid): Promise<DatalakeStats> {
    const path = `/api/v1/${workspace}/datalake/stats`
    const url = new URL(concatLink(this.endpoint, path))
    const response = await fetchSafe(url, { headers: { ...this.headers } })
    return (await response.json()) as DatalakeStats
  }

  async getLiveKitStats (workspace: WorkspaceUuid): Promise<LiveKitStats> {
    const path = `/api/v1/${workspace}/livekit/stats`
    const url = new URL(concatLink(this.endpoint, path))
    const response = await fetchSafe(url, { headers: { ...this.headers } })
    return (await response.json()) as LiveKitStats
  }

  async getLiveKitSessionsStats (workspace: WorkspaceUuid): Promise<LiveKitSessionsStats[]> {
    const path = `/api/v1/${workspace}/livekit/sessions`
    const url = new URL(concatLink(this.endpoint, path))
    const response = await fetchSafe(url, { headers: { ...this.headers } })
    return (await response.json()) as LiveKitSessionsStats[]
  }

  async getLiveKitEgressStats (workspace: WorkspaceUuid): Promise<LiveKitEgressStats[]> {
    const path = `/api/v1/${workspace}/livekit/egress`
    const url = new URL(concatLink(this.endpoint, path))
    const response = await fetchSafe(url, { headers: { ...this.headers } })
    return (await response.json()) as LiveKitEgressStats[]
  }

  async postLiveKitSessions (sessions: LiveKitSessionData[]): Promise<void> {
    const path = '/api/v1/livekit/sessions'
    const url = new URL(concatLink(this.endpoint, path))
    const body = JSON.stringify(sessions)
    await fetchSafe(url, { method: 'POST', headers: { ...this.headers }, body })
  }

  async postLiveKitEgress (egress: LiveKitEgressData[]): Promise<void> {
    const path = '/api/v1/livekit/egress'
    const url = new URL(concatLink(this.endpoint, path))
    const body = JSON.stringify(egress)
    await fetchSafe(url, { method: 'POST', headers: { ...this.headers }, body })
  }

  async getAiTranscriptLastData (): Promise<AiTranscriptData | undefined> {
    const path = '/api/v1/ai/transcript/last'
    const url = new URL(concatLink(this.endpoint, path))
    const response = await fetchSafe(url, { headers: { ...this.headers } })
    return (await response.json()) as AiTranscriptData | undefined
  }

  async postAiTranscriptData (data: AiTranscriptData[]): Promise<void> {
    const path = '/api/v1/ai/transcript'
    const url = new URL(concatLink(this.endpoint, path))
    const body = JSON.stringify(data)

    await fetchSafe(url, { method: 'POST', headers: { ...this.headers }, body })
  }

  async postAiTokensData (data: AiTokensData[]): Promise<void> {
    const path = '/api/v1/ai/tokens'
    const url = new URL(concatLink(this.endpoint, path))
    const body = JSON.stringify(data)

    await fetchSafe(url, { method: 'POST', headers: { ...this.headers }, body })
  }
}

export class LogBillingClient implements BillingClient {
  constructor (private readonly ctx: MeasureContext) {}

  async getBillingStats (workspace: WorkspaceUuid): Promise<BillingStats> {
    this.ctx.info('getBillingStats', { workspace })
    return {
      liveKitStats: { sessions: [], egress: [] },
      datalakeStats: { count: 0, size: 0 },
      aiStats: { transcript: { totalDurationSeconds: 0 }, tokens: [] }
    }
  }

  async getDatalakeStats (workspace: WorkspaceUuid): Promise<DatalakeStats> {
    this.ctx.info('getDatalakeStats', { workspace })
    return { count: 0, size: 0 }
  }

  async getLiveKitStats (workspace: WorkspaceUuid): Promise<LiveKitStats> {
    this.ctx.info('getLiveKitStats', { workspace })
    return { sessions: [], egress: [] }
  }

  async getLiveKitSessionsStats (workspace: WorkspaceUuid): Promise<LiveKitSessionsStats[]> {
    this.ctx.info('getLiveKitSessionsStats', { workspace })
    return []
  }

  async getLiveKitEgressStats (workspace: WorkspaceUuid): Promise<LiveKitEgressStats[]> {
    this.ctx.info('getLiveKitEgressStats', { workspace })
    return []
  }

  async postLiveKitSessions (sessions: LiveKitSessionData[]): Promise<void> {
    this.ctx.info('postLiveKitSessions', { count: sessions.length })
  }

  async postLiveKitEgress (egress: LiveKitEgressData[]): Promise<void> {
    this.ctx.info('postLiveKitEgress', { count: egress.length })
  }

  async getAiTranscriptLastData (): Promise<AiTranscriptData | undefined> {
    this.ctx.info('getAiTranscriptLastData')
    return undefined
  }

  async postAiTranscriptData (data: AiTranscriptData[]): Promise<void> {
    for (const item of data) {
      this.ctx.info('postAiTranscriptData', {
        workspace: item.workspace,
        day: item.day,
        durationSeconds: item.durationSeconds,
        usd: item.usd
      })
    }
  }

  async postAiTokensData (data: AiTokensData[]): Promise<void> {
    for (const item of data) {
      this.ctx.info('postAiTokensData', {
        workspace: item.workspace,
        reason: item.reason,
        inputTokens: item.inputTokens,
        outputTokens: item.outputTokens,
        date: item.date
      })
    }
  }
}

async function fetchSafe (url: string | URL, init?: RequestInit): Promise<Response> {
  let response
  try {
    response = await fetch(url, init)
  } catch (err: any) {
    throw new NetworkError(`Network error ${err}`)
  }

  if (!response.ok) {
    const text = await response.text()
    throw new BillingError(text)
  }

  return response
}
