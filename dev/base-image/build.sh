#!/usr/bin/env bash
set -euo pipefail

# Default version if not set
VERSION=${VERSION:-"latest"}
# Default to no extra docker build flags if not set (e.g. --platform=...)
DOCKER_EXTRA=${DOCKER_EXTRA:-}

docker build -t tracexapp/base:${VERSION} -f base.Dockerfile ${DOCKER_EXTRA} .
docker build -t tracexapp/base-slim:${VERSION} -f slim.Dockerfile ${DOCKER_EXTRA} .
docker build -t tracexapp/rekoni-base:${VERSION} -f rekoni.Dockerfile ${DOCKER_EXTRA} .
docker build -t tracexapp/print-base:${VERSION} -f print.Dockerfile ${DOCKER_EXTRA} .
docker build -t tracexapp/front-base:${VERSION} -f front.Dockerfile ${DOCKER_EXTRA} .
docker build -t tracexapp/preview-base:${VERSION} -f preview.Dockerfile ${DOCKER_EXTRA} .