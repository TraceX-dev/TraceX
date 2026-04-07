#!/usr/bin/env bash

# Default version if not set
VERSION=${VERSION:-"latest"}

docker build -t tracex/base:${VERSION} -f base.Dockerfile ${DOCKER_EXTRA} .
docker build -t tracex/base-slim:${VERSION} -f slim.Dockerfile ${DOCKER_EXTRA} .
docker build -t tracex/rekoni-base:${VERSION} -f rekoni.Dockerfile ${DOCKER_EXTRA} .
docker build -t tracex/print-base:${VERSION} -f print.Dockerfile ${DOCKER_EXTRA} .
docker build -t tracex/front-base:${VERSION} -f front.Dockerfile ${DOCKER_EXTRA} .
docker build -t tracex/preview-base:${VERSION} -f preview.Dockerfile ${DOCKER_EXTRA} .