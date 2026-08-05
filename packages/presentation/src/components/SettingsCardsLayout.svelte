<!--
//
// Copyright © 2026 TraceX SAS.
//
// Licensed under the PolyForm Shield License 1.0.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://polyformproject.org/licenses/shield/1.0.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//
// See the License for the specific language governing permissions and
// limitations under the License.
-->
<script lang="ts">
  export let columns: 1 | 2 = 1
</script>

<div class="settings-cards-layout" class:two-columns={columns === 2}>
  <slot />
</div>

<style lang="scss">
  .settings-cards-layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    align-items: start;
    gap: 1.25rem;
    width: 100%;
    max-width: 36rem;
    margin: 0 auto;
  }

  .settings-cards-layout.two-columns {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    max-width: 64rem;
  }

  @media (max-width: 64rem) {
    .settings-cards-layout.two-columns {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
