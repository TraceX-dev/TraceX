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


# Supports minified mode for resource-constrained dev machines:
#   rush docker --minified   or   rush docker:min

MINIFIED=false
for arg in "$@"; do
  if [ "$arg" = "--minified" ]; then
    MINIFIED=true
    break
  fi
done

if [ "$MINIFIED" = true ]; then
  echo "Building minified docker images (excluding optional services)..."
  rush docker:build -p 20 \
    --to @hcengineering/pod-server \
    --to @hcengineering/pod-front \
    --to @tracex/pod-api \
    --to @hcengineering/prod \
    --to @hcengineering/pod-account \
    --to @hcengineering/pod-workspace \
    --to @hcengineering/pod-collaborator \
    --to @hcengineering/tool \
    --to @hcengineering/pod-analytics-collector \
    --to @hcengineering/rekoni-service \
    --to @hcengineering/pod-datalake \
    --to @hcengineering/pod-export \
    --to @hcengineering/pod-media \
    --to @hcengineering/pod-external
else
  rush docker:build -p 20 \
    --to @hcengineering/pod-server \
    --to @hcengineering/pod-front \
    --to @tracex/pod-api \
    --to @hcengineering/prod \
    --to @hcengineering/pod-account \
    --to @hcengineering/pod-marketplace \
    --to @hcengineering/pod-workspace \
    --to @hcengineering/pod-collaborator \
    --to @hcengineering/tool \
    --to @hcengineering/pod-print \
    --to @hcengineering/pod-sign \
    --to @hcengineering/pod-analytics-collector \
    --to @hcengineering/rekoni-service \
    --to @hcengineering/pod-ai-bot \
    --to @hcengineering/import-tool \
    --to @hcengineering/pod-stats \
    --to @hcengineering/pod-fulltext \
    --to @hcengineering/pod-love \
    --to @hcengineering/pod-mail \
    --to @hcengineering/pod-datalake \
    --to @hcengineering/pod-export \
    --to @hcengineering/pod-media \
    --to @hcengineering/pod-preview \
    --to @hcengineering/pod-link-preview \
    --to @hcengineering/pod-external \
    --to @hcengineering/pod-backup \
    --to @hcengineering/backup-api-pod \
    --to @hcengineering/pod-billing \
    --to @hcengineering/pod-process \
    --to @hcengineering/pod-rating \
    --to @hcengineering/pod-payment \
    --to @hcengineering/pod-worker \
    --to @hcengineering/pod-events-processor \
    --to @hcengineering/pod-mcp \
    --to @hcengineering/pod-openauth \
    --to @tracex/pod-qalico
fi
