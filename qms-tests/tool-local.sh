
#!/bin/bash
#
# Copyright © 2026 TraceX SAS.
#
# Licensed under the Eclipse Public License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License. You may
# obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
#
# See the License for the specific language governing permissions and
# limitations under the License.
#

export STORAGE_CONFIG="datalake|http://localhost:4030"
export DB_URL=postgresql://postgres:postgres@localhost:5432/postgres
export ACCOUNT_DB_URL=postgresql://postgres:postgres@localhost:5432/postgres
export ACCOUNTS_URL=http://localhost:3000
export TRANSACTOR_URL=ws://localhost:3333
export SERVER_SECRET=secret
export QUEUE_CONFIG=tracex.local:19092

# Restore workspace contents in PostgreSQL/Elasticsearch
node ../dev/tool/bundle/bundle.js "$@"
