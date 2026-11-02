<!--
//
// Copyright © 2026 TraceX SAS.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//
// See the License for the specific language governing permissions and
// limitations under the License.
//
-->
<script lang="ts">
  import { Label } from '@hcengineering/ui'
  import guest from '../plugin'
</script>

<div class="flex-center w-full h-full">
  <div class="antiPopup flex-center" data-id="public-link-revoked" style:padding="var(--spacing-4)">
    <h1><Label label={guest.string.LinkWasRevoked} /></h1>
  </div>
</div>
