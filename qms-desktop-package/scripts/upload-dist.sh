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
# Uploads the desktop release prepared by copy-publish-artifacts.sh to the dist bucket.
#
# Usage: upload-dist.sh <folder> <bucket> <endpoint_url>
#
# Guarantees that a published update manifest always describes the binaries
# that are actually in the bucket:
#   * a version is immutable: if its manifest is already in the bucket the
#     upload is refused (bump the tag instead of rebuilding the same version -
#     every signed build produces a different file);
#   * binaries are uploaded with `aws s3 cp`, which always overwrites
#     (`aws s3 sync` skips same-sized files and can leave a manifest from
#     another build in place);
#   * manifests (*.yml) are uploaded last, only after the size of every binary
#     in the bucket has been verified.

set -euo pipefail

FOLDER="${1:?Expected folder with publish artifacts}"
BUCKET="${2:?Expected bucket}"
ENDPOINT="${3:?Expected endpoint url}"
ATTEMPTS=3

s3api () {
  aws s3api "$@" --endpoint-url "$ENDPOINT"
}

remote_size () {
  s3api head-object --bucket "$BUCKET" --key "$1" --query ContentLength --output text 2>/dev/null || true
}

local_size () {
  wc -c < "$1" | tr -d ' '
}

upload () {
  local file="$1" key
  key="$(basename "$file")"
  for i in $(seq 1 "$ATTEMPTS"); do
    if aws s3 cp --only-show-errors "$file" "s3://$BUCKET/$key" --endpoint-url "$ENDPOINT" \
      && [[ "$(remote_size "$key")" == "$(local_size "$file")" ]]; then
      echo "Uploaded $key ($(local_size "$file") bytes)"
      return 0
    fi
    echo "::warning::Upload of $key failed or size mismatch (attempt $i/$ATTEMPTS)"
    sleep 30
  done
  echo "::error::Failed to upload $key"
  exit 1
}

shopt -s nullglob
manifests=("$FOLDER"/*.yml)
binaries=()
for file in "$FOLDER"/*; do
  [[ "$file" == *.yml ]] || binaries+=("$file")
done
if (( ${#manifests[@]} == 0 || ${#binaries[@]} == 0 )); then
  echo "::error::Nothing to publish in $FOLDER" >&2
  exit 1
fi

# Every file referenced by a manifest must be part of this upload
for manifest in "${manifests[@]}"; do
  while read -r url; do
    if [[ ! -f "$FOLDER/$url" ]]; then
      echo "::error::$(basename "$manifest") references $url which is not in $FOLDER" >&2
      exit 1
    fi
  done < <(sed -nE "s/^[[:space:]]*(-[[:space:]]*)?url:[[:space:]]*[\"']?([^\"'[:space:]]+).*/\2/p" "$manifest")
done

for manifest in "${manifests[@]}"; do
  key="$(basename "$manifest")"
  if [[ -n "$(remote_size "$key")" ]]; then
    echo "::error::$key is already published. Versions are immutable: create a new tag instead of rebuilding this one." >&2
    exit 1
  fi
done

for file in "${binaries[@]}"; do
  upload "$file"
done
for manifest in "${manifests[@]}"; do
  upload "$manifest"
done
echo "Published ${#binaries[@]} binaries and ${#manifests[@]} manifests"
