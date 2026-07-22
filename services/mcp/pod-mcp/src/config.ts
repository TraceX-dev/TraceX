//
// Copyright © 2026 TraceX.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//

export interface McpConfig {
  Port: number
  AccountsURL: string
  ServerSecret: string
  CollaboratorURL: string
  ServiceID: string
  AllowedOrigins: string[]
  WorkspaceClientCacheMs: number
}

function requiredEnv (name: string): string {
  const value = process.env[name]
  if (value === undefined || value === '') {
    throw new Error(`Missing required environment variable: ${name}`)
  }
  return value
}

function optionalEnv (name: string, defaultValue: string): string {
  return process.env[name] ?? defaultValue
}

function splitList (value: string): string[] {
  return value
    .split(',')
    .map((it) => it.trim())
    .filter((it) => it.length > 0)
}

function optionalNumberEnv (name: string, defaultValue: number): number {
  const value = Number.parseInt(optionalEnv(name, String(defaultValue)), 10)
  return Number.isFinite(value) ? value : defaultValue
}

const config: McpConfig = {
  Port: Number.parseInt(optionalEnv('PORT', '4020'), 10),
  AccountsURL: requiredEnv('ACCOUNTS_URL'),
  ServerSecret: optionalEnv('SERVER_SECRET', optionalEnv('SECRET', 'secret')),
  CollaboratorURL: requiredEnv('COLLABORATOR_URL'),
  ServiceID: optionalEnv('SERVICE_ID', 'tracex-mcp-service'),
  AllowedOrigins: splitList(optionalEnv('ALLOWED_ORIGINS', '')),
  WorkspaceClientCacheMs: optionalNumberEnv('WORKSPACE_CLIENT_CACHE_MS', 0)
}

export default config
