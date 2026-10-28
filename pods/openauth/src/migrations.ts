//
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
//

/** Ordered schema migrations for the issuer's private PostgreSQL schema. */
export function getMigrations (): [string, string][] {
  return [getV1Migration()]
}

// Never modify an existing migration. Add a new migration when changing the schema.
function getV1Migration (): [string, string] {
  return [
    'openauth_db_v1_init',
    `
    CREATE TABLE IF NOT EXISTS openauth.storage (
      key TEXT PRIMARY KEY, prefixes TEXT[] NOT NULL, value TEXT NOT NULL, expires_on BIGINT
    );
    CREATE INDEX IF NOT EXISTS openauth_storage_prefixes ON openauth.storage USING GIN (prefixes);

    CREATE TABLE IF NOT EXISTS openauth.client (
      id TEXT PRIMARY KEY, data JSONB NOT NULL
    );

    CREATE TABLE IF NOT EXISTS openauth.connection (
      id TEXT PRIMARY KEY, account UUID NOT NULL, client_id TEXT NOT NULL,
      client_name TEXT NOT NULL, resource TEXT NOT NULL, account_token TEXT NOT NULL,
      created_on BIGINT NOT NULL, revoked_on BIGINT
    );
    CREATE INDEX IF NOT EXISTS openauth_connection_account ON openauth.connection (account);

    CREATE TABLE IF NOT EXISTS openauth.access_token (
      hash TEXT PRIMARY KEY, connection_id TEXT NOT NULL REFERENCES openauth.connection (id),
      expires_on BIGINT NOT NULL
    );
    `
  ]
}
