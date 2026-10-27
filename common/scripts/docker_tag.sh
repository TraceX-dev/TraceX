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

version=${DOCKER_VERSION:-$(git describe --tags --abbrev=0)}
rev_version=$(git rev-parse HEAD)

if [ "x$2" = "xstaging" ]
then
  a=( ${version//./ } )
  c=( ${a[2]//[^0-9]*/ } )
  c=$((c + 1))
  version="${a[0]}.${a[1]}.${c}-staging"
  echo "Tagging staging $1 with version ${version}"
  docker tag "$1:$rev_version" "$1:$version"
  for n in {1..25}; do
    docker push "$1:$version" && break

    if (( $n < 25 ))
    then
      echo 'Docker failed to push, wait 5 second'
      sleep 5
    else
      echo '25 push attempts failed, exiting with failure'
      exit 1
    fi
  done
else
  echo "Tagging release $1 with version ${version}"  
  docker tag "$1:$rev_version" "$1:$version"
  # docker tag "$1:$rev_version" "$1:latest"
  for n in {1..25}; do
    docker push "$1:$version" && break

    if (( $n < 25 ))
    then
      echo 'Docker failed to push, wait 5 second'
      sleep 5
    else
      echo '25 push attempts failed, exiting with failure'
      exit 1
    fi
  done
  # for n in {1..25}; do
  #   docker push "$1:latest" && break

  #   if (( $n < 25 ))
  #   then
  #     echo 'Docker failed to push, wait 5 second'
  #     sleep 5
  #   else
  #     echo '25 push attempts failed, exiting with failure'
  #     exit 1
  #   fi
  # done
fi
