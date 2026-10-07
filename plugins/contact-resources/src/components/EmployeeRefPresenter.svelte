<script lang="ts">
  import { Employee, type PeopleScopeInput } from '@hcengineering/contact'
  import { AnyAttribute, Doc, Ref, Space } from '@hcengineering/core'
  import { ButtonKind, IconSize } from '@hcengineering/ui'
  import { PersonLabelTooltip } from '..'
  import EmployeeAttributePresenter from './EmployeeAttributePresenter.svelte'

  export let value: Ref<Employee> | Ref<Employee>[] | null | undefined
  export let kind: ButtonKind = 'link'
  export let tooltipLabels: PersonLabelTooltip | undefined = undefined
  export let onChange: ((value: Ref<Employee>) => void) | undefined = undefined
  export let colorInherit: boolean = false
  export let accent: boolean = false
  export let inline: boolean = false
  export let shouldShowName: boolean = true
  export let avatarSize: IconSize = kind === 'regular' ? 'small' : 'card'
  export let readonly = false
  export let attribute: AnyAttribute | undefined = undefined
  export let space: Ref<Space> | undefined = undefined
  // Guests are offered only people of this scope (by default: the edited object), see `PeopleScopeInput`
  export let peopleScope: PeopleScopeInput = undefined
  export let object: Doc | undefined = undefined
</script>

{#if Array.isArray(value)}
  <div class="inline-content">
    {#each value as employee}
      <EmployeeAttributePresenter
        value={employee}
        {kind}
        {tooltipLabels}
        {onChange}
        {inline}
        {colorInherit}
        {accent}
        {shouldShowName}
        {avatarSize}
        {readonly}
        {attribute}
        {space}
        {peopleScope}
        {object}
        on:accent-color
      />
    {/each}
  </div>
{:else}
  <EmployeeAttributePresenter
    {value}
    {kind}
    {tooltipLabels}
    {onChange}
    {inline}
    {colorInherit}
    {accent}
    {shouldShowName}
    {avatarSize}
    {readonly}
    {attribute}
    {space}
    {peopleScope}
    {object}
    on:accent-color
  />
{/if}

<style lang="scss">
  .inline-content {
    display: inline-flex;
    align-items: center;
    flex-wrap: wrap;
    min-width: 0;
    gap: 0.5rem;
  }
</style>
