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

set -euo pipefail

TARGET_FOLDER="${1:?Expected target folder}"
VARIANT="${2:?Expected desktop variant}"
SOURCE_FOLDER=deploy

case "$VARIANT" in
  prod) PREFIX=tracex; CHANNEL=tracex; ARTIFACT_PREFIX=TraceX ;;
  staging) PREFIX=tracex-staging; CHANNEL=tracex-staging; ARTIFACT_PREFIX=TraceX-Staging ;;
  *) echo "Unknown desktop variant: $VARIANT" >&2; exit 1 ;;
esac

VERSION="$(node ../common/scripts/show_tag.js | tr -d '"')"
if [[ ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Invalid desktop version: $VERSION" >&2
  exit 1
fi

if [[ -e "$TARGET_FOLDER" ]]; then
  echo "Target folder already exists: $TARGET_FOLDER" >&2
  exit 1
fi
mkdir -p "$TARGET_FOLDER"
shopt -s nullglob
artifacts=()
for artifact in "$SOURCE_FOLDER"/"$ARTIFACT_PREFIX"-*; do
  if [[ "$VARIANT" == prod && "$artifact" == "$SOURCE_FOLDER"/TraceX-Staging-* ]]; then
    continue
  fi
  case "$artifact" in
    *.blockmap|*.dmg|*.zip|*.AppImage|*.deb|*.exe) artifacts+=("$artifact") ;;
  esac
done
if (( ${#artifacts[@]} == 0 )); then
  echo "No desktop artifacts found in $SOURCE_FOLDER" >&2
  exit 1
fi
cp "${artifacts[@]}" "$TARGET_FOLDER/"

for suffix in '' '-mac' '-linux'; do
  source_manifest="$SOURCE_FOLDER/$CHANNEL$suffix.yml"
  if [[ ! -f "$source_manifest" ]]; then
    echo "Missing update manifest: $source_manifest" >&2
    exit 1
  fi
  cp "$source_manifest" "$TARGET_FOLDER/$PREFIX-$VERSION$suffix.yml"
done
