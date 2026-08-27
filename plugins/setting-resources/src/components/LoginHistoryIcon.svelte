<!--
// Copyright © TraceX SAS 2026
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
-->
<script lang="ts">
  export let fill: string = 'currentColor'
  export let size: 'small' | 'medium' | 'large' = 'small'
</script>

<svg class="svg-{size}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" {fill} aria-hidden="true">
  <path
    d="M13 3a9 9 0 0 0-9 9H1l3.89 3.89.07.14L9 12H6c0-3.87 3.13-7 7-7s7 3.13 7 7-3.13 7-7 7c-1.93 0-3.68-.79-4.94-2.06l-1.42 1.42A8.954 8.954 0 0 0 13 21a9 9 0 0 0 0-18Z"
  />
  <path d="M12 8v5l4.28 2.54.72-1.21-3.5-2.08V8h-1.5Z" />
</svg>
