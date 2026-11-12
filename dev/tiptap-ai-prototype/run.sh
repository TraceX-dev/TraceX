#!/usr/bin/env bash
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

set -euo pipefail
prototype_dir="$(cd "$(dirname "$0")" && pwd)"
prototype_node=""
for candidate in "$(command -v node || true)" "${NVM_DIR:-$HOME/.nvm}"/versions/node/v24.*/bin/node "${NVM_DIR:-$HOME/.nvm}"/versions/node/v22.*/bin/node "${NVM_DIR:-$HOME/.nvm}"/versions/node/v20.*/bin/node; do
  if [[ ! -x "$candidate" ]]; then continue; fi
  major="$("$candidate" -p "process.versions.node.split('.')[0]")"
  if (( major >= 20 && major < 25 )); then
    prototype_node="$candidate"
    break
  fi
done
if [[ -z "$prototype_node" ]]; then
  echo "Node >=20 <25 is required. Activate a supported Node version and rerun." >&2
  exit 1
fi
if [[ "${1:-}" == "--check-ops" ]]; then
  shift
  exec "$prototype_node" "$prototype_dir/check-ops.cjs" "$@"
fi
if [[ "${1:-}" == "--compare-identities" ]]; then
  shift
  exec "$prototype_node" "$prototype_dir/compare-identities.cjs" "$@"
fi
if ! "$prototype_node" -e '
  const fs = require("node:fs")
  const path = require("node:path")
  const root = process.argv[1]
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"))
  try {
    for (const [name, version] of Object.entries(manifest.dependencies)) {
      if (!name.startsWith("@tiptap/")) continue
      const installed = JSON.parse(fs.readFileSync(path.join(root, "node_modules", name, "package.json"), "utf8"))
      if (installed.version !== version) process.exit(1)
    }
  } catch { process.exit(1) }
' "$prototype_dir"; then
  prototype_npm="$(dirname "$prototype_node")/../lib/node_modules/npm/bin/npm-cli.js"
  "$prototype_node" "$prototype_npm" ci --prefix "$prototype_dir" --ignore-scripts --no-audit --no-fund --workspaces=false --fetch-retries=0 --cache "$prototype_dir/.runtime/npm-cache"
fi
exec "$prototype_node" "$prototype_dir/run.cjs" "$@"
