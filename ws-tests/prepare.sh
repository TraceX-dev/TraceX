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



# Check if docker-compose.override.yml exists
if [ -f "docker-compose.override.yml" ]; then
    echo "Using docker-compose.override.yml"
    docker compose -p sanity -f docker-compose.yaml -f docker-compose.override.yml kill
    docker compose -p sanity -f docker-compose.yaml -f docker-compose.override.yml down --volumes
    docker compose -p sanity -f docker-compose.yaml -f docker-compose.override.yml up -d --force-recreate --renew-anon-volumes
else
    docker compose -p sanity kill
    docker compose -p sanity down --volumes
    docker compose -p sanity up -d --force-recreate --renew-anon-volumes
fi
docker_exit=$?
if [ ${docker_exit} -eq 0 ]; then
    echo "Container started successfully"
else
    echo "Container started with errors"
    exit ${docker_exit}
fi

if [ "x$DO_CLEAN" == 'xtrue' ]; then
    echo 'Do docker Clean'
    docker system prune -a -f
fi

./wait-elastic.sh 9201

echo "Creating user accounts..."
./tool.sh create-account admin -f Super -l Admin -p 1234
./tool.sh create-account user1 -f John -l Appleseed -p 1234
./tool.sh create-account user2 -f Kainin -l Dirak -p 1234

echo "Creating workspace api-tests..."
./tool.sh create-workspace api-tests email:user1

echo "Creating workspace api-tests-cr..."
./tool.sh create-workspace api-tests-cr email:user1 --region 'europe'

echo "Assigning user1 to workspaces..."
./tool.sh assign-workspace user1 api-tests
./tool.sh assign-workspace user1 api-tests-cr

rm -rf ./sanity/.auth
