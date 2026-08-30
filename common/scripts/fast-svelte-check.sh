#!/usr/bin/env bash
set -euo pipefail

BASE_BRANCH=develop

while [[ "$#" -gt 0 ]]; do
  case "$1" in
    --branch)
      BASE_BRANCH="$2"
      shift
      ;;
  esac
  shift
done

mapfile -t changed_files < <(git diff "origin/$BASE_BRANCH" --name-only --diff-filter=ACMR)

if [[ "${#changed_files[@]}" -eq 0 ]]; then
  echo "No changed files relative to origin/$BASE_BRANCH."
  exit 0
fi

mapfile -t package_roots < <(rush list -p --json | grep '"path"' | cut -f 2 -d ':' | cut -f 2 -d '"')
declare -A changed_roots=()

for file in "${changed_files[@]}"; do
  for root in "${package_roots[@]}"; do
    if [[ "$file" == "$root"/* ]]; then
      changed_roots["$root"]=1
      break
    fi
  done
done

if [[ "${#changed_roots[@]}" -eq 0 ]]; then
  echo "No changed Rush packages detected."
  exit 0
fi

for root in "${!changed_roots[@]}"; do
  if ! node -e "const { resolve } = require('node:path'); const { scripts = {} } = require(resolve(process.argv[1])); process.exit((scripts['svelte-check'] ?? scripts['_phase:svelte-check']) ? 0 : 1)" "$root/package.json"; then
    echo "Skipping $root: no svelte-check script."
    continue
  fi

  echo -e "\033[0;34mProcessing \033[0;31m$root\033[0m"
  (
    cd "$root"
    rushx svelte-check
  )
done
