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

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 <image>" >&2
  exit 1
fi

: "${SBOM_OUTPUT_DIR:?SBOM_OUTPUT_DIR must define the SBOM output directory}"

version=${DOCKER_VERSION:-$(git describe --tags --abbrev=0)}
image="$1:$version"
image_name="${1#*/}"
output_file="${SBOM_OUTPUT_DIR}/${image_name}.spdx.json"

mkdir -p "$SBOM_OUTPUT_DIR"
syft "$image" -o "spdx-json=$output_file"
