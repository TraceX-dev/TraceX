#!/usr/bin/env bash
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

export MODEL_VERSION=$(node ../common/scripts/show_version.js)
export MINIO_ACCESS_KEY=minioadmin
export MINIO_SECRET_KEY=minioadmin
export MINIO_ENDPOINT=tracex.local:9002
export ACCOUNTS_URL=http://tracex.local:3003
export REGION_INFO="|America;europe|"
export TRANSACTOR_URL="ws://tracex.local:3334;ws://tracex.local:3334,ws://tracex.local:3335;ws://tracex.local:3335;europe"
export ACCOUNT_DB_URL=postgresql://postgres:postgres@tracex.local:5433/postgres
export ELASTIC_URL=http://tracex.local:9201
export SERVER_SECRET=secret
export DB_URL=postgresql://postgres:postgres@tracex.local:5433/postgres
export QUEUE_CONFIG=tracex.local:19093

# Check if local bundle.js exists and use it if available
BUNDLE_PATH="../dev/tool/bundle/bundle.js"
if [ -f "./bundle.js" ]; then
  BUNDLE_PATH="./bundle.js"
fi

node ${TOOL_OPTIONS} --max-old-space-size=8096 "$BUNDLE_PATH" "$@"
