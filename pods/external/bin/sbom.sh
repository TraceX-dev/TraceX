#!/usr/bin/env bash

#
# Copyright © 2026 TraceX SAS.
#
# Licensed under the PolyForm Shield License 1.0.0 (the "License");
# you may not use this file except in compliance with the License. You may
# obtain a copy of the License at https://polyformproject.org/licenses/shield/1.0.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
#
# See the License for the specific language governing permissions and
# limitations under the License.

set -euo pipefail

script_dir=$(cd "$(dirname "$0")" && pwd)

while IFS= read -r file; do
  service=$(awk '!/^[[:space:]]*($|#)/ { print $1; exit }' "$file")

  if [[ -n "$service" ]]; then
    "$script_dir/../../../common/scripts/docker_sbom.sh" "tracexapp/$service"
  fi
done < <(find "$script_dir/../services.d" -type f -name '*.service' ! -name '-*' | sort)
