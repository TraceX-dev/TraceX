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

# End-to-end check: a workspace is created by the workspace service from the init script.
#
# Usage (from ws-tests, images must be built: rush docker):
#   ./init-data-test.sh
#
# Env:
#   INIT_SCRIPTS_PATH   checkout of hcengineering/init (cloned to ./init-scripts when not set)
#   INIT_SCRIPTS_BRANCH branch/tag to clone (default: main)
#   INIT_WORKSPACE      script name from script.yaml (default: tracex-init-v07)

set -euo pipefail
cd "$(dirname "$0")"

if [ -z "${INIT_SCRIPTS_PATH:-}" ]; then
  export INIT_SCRIPTS_PATH="$PWD/init-scripts"
  rm -rf "$INIT_SCRIPTS_PATH"
  git clone --quiet --single-branch --branch "${INIT_SCRIPTS_BRANCH:-main}" --depth 1 \
    https://github.com/hcengineering/init.git "$INIT_SCRIPTS_PATH"
fi
export INIT_WORKSPACE="${INIT_WORKSPACE:-tracex-init-v07}"

grep -Eq "^- name: ['\"]?${INIT_WORKSPACE}['\"]?\s*\$" "$INIT_SCRIPTS_PATH/script.yaml" || {
  echo "Init script '${INIT_WORKSPACE}' not found in ${INIT_SCRIPTS_PATH}/script.yaml"
  exit 1
}

COMPOSE="docker compose -p sanity -f docker-compose.yaml -f docker-compose.init.yaml"
$COMPOSE down --volumes
$COMPOSE up -d --force-recreate --renew-anon-volumes

./wait-elastic.sh 9201

echo "Creating user accounts..."
./tool.sh create-account user1 -f John -l Appleseed -p 1234

echo "Running init data test..."
if ! (
  cd api-tests
  node ../../common/scripts/install-run-rush.js validate --to @hcengineering/api-tests
  INIT_DATA_TEST=true node ../../common/scripts/install-run-rushx.js api-test --verbose initWorkspace
); then
  echo "Workspace service log (tail):"
  $COMPOSE logs --no-color --tail 200 workspace || true
  exit 1
fi
