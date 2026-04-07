#!/usr/bin/env bash

# Default version if not set
VERSION=${VERSION:-"latest"}

docker push tracex/base:${VERSION}
docker push tracex/base-slim:${VERSION}
docker push tracex/rekoni-base:${VERSION}
docker push tracex/print-base:${VERSION}
docker push tracex/front-base:${VERSION}
docker push tracex/preview-base:${VERSION}
