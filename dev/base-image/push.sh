#!/usr/bin/env bash

# Default version if not set
VERSION=${VERSION:-"latest"}

docker push tracexapp/base:${VERSION}
docker push tracexapp/base-slim:${VERSION}
docker push tracexapp/rekoni-base:${VERSION}
docker push tracexapp/print-base:${VERSION}
docker push tracexapp/front-base:${VERSION}
docker push tracexapp/preview-base:${VERSION}
