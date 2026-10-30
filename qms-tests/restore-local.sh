
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

export SERVER_SECRET=secret

# Restore workspace contents in PostgreSQL/Elasticsearch
./tool-local.sh backup-restore ./sanity-ws-qms sanity-ws-qms --upgrade

# Re-assign user to workspace.
./tool-local.sh assign-workspace user1 sanity-ws-qms
./tool-local.sh assign-workspace user2 sanity-ws-qms
./tool-local.sh assign-workspace user3 sanity-ws-qms
./tool-local.sh assign-workspace user4 sanity-ws-qms
./tool-local.sh assign-workspace user_qara sanity-ws-qms

./tool-local.sh set-user-role user1 sanity-ws-qms OWNER
./tool-local.sh set-user-role user2 sanity-ws-qms OWNER

./tool-local.sh configure sanity-ws-qms --enable=*
./tool-local.sh configure sanity-ws-qms --list
