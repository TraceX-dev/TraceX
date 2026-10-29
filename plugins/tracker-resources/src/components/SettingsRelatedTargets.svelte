<script lang="ts">
  import { Space } from '@hcengineering/core'
  import { Header, Breadcrumb } from '@hcengineering/ui'
  import tracker from '../plugin'
  import EditRelatedTargets from './EditRelatedTargets.svelte'

  export let value: Space | undefined
</script>

<div class="hulyComponent">
  <Header adaptive={'disabled'}>
    <Breadcrumb icon={tracker.icon.Relations} label={tracker.string.RelatedIssues} size={'large'} isCurrent />
  </Header>
  <EditRelatedTargets {value} />
</div>
