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

set -eo pipefail

image=${1:?Usage: docker_build.sh IMAGE}

version=${DOCKER_VERSION:-$(git rev-parse HEAD)}

# Check for cleanup flag from environment
cleanup=false
if [ "$DOCKER_BUILD_CLEANUP" = "true" ]; then
  cleanup=true
fi

echo "Building version: $version" 

read -r -a extra_args <<< "${DOCKER_EXTRA:-}"
docker build -t "$image" -t "$image:$version" "${extra_args[@]}" .

if [ "$cleanup" = true ]; then
  echo "Cleaning up build artifacts..."

  if [ -d "bundle" ]; then
    echo "  Removing bundle/"
    rm -rf bundle
  fi

  if [ -d "dist" ]; then
    echo "  Removing dist/"
    rm -rf dist
  fi

  if [ -d ".rush" ]; then
    echo "  Removing .rush/"
    rm -rf .rush
  fi

  echo "  Size after cleanup: $(du -sh . 2>/dev/null | cut -f1)"
fi
