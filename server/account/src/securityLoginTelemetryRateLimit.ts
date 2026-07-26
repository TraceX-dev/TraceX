//
// Copyright © TraceX SAS 2026
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//

import platform, { PlatformError, Severity, Status } from '@hcengineering/platform'

const buckets = new Map<string, number[]>()

function parsePositiveInt (raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === '') return fallback
  const n = parseInt(raw.trim(), 10)
  return Number.isFinite(n) && n > 0 ? Math.min(n, 10_000) : fallback
}

/**
 * In-process sliding-window rate limiter (per account + RPC name).
 * Multi-instance deployments only get per-process limits unless replaced with shared storage.
 */
export function assertSecurityLoginTelemetryRateLimit (
  accountKey: string,
  rpcName: string,
  envVar: string,
  fallbackRpm: number
): void {
  const maxPerMinute = parsePositiveInt(process.env[envVar], fallbackRpm)
  const key = `${accountKey}:${rpcName}`
  const now = Date.now()
  const windowMs = 60_000
  let stamps = buckets.get(key) ?? []
  stamps = stamps.filter((t) => now - t < windowMs)
  if (stamps.length >= maxPerMinute) {
    throw new PlatformError(new Status(Severity.ERROR, platform.status.BadRequest, {}))
  }
  stamps.push(now)
  buckets.set(key, stamps)
}
