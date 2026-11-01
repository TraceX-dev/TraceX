<!--
// Copyright © 2020 Anticrm Platform Contributors.
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
-->
<script lang="ts">
  import { getResourceP } from '@hcengineering/platform'
  import { deepEqual } from 'fast-equals'
  import { onDestroy, SvelteComponent, tick } from 'svelte'
  import { getRenderContext } from '../render-context'
  import type { AnyComponent, AnySvelteComponent } from '../types'
  import ErrorPresenter from './ErrorPresenter.svelte'
  import Loading from './Loading.svelte'
  import ErrorBoundary from './internal/ErrorBoundary'
  import { clone } from '@hcengineering/core'

  // Reference to rendered component instance
  export let innerRef: SvelteComponent | undefined = undefined
  export let is: AnyComponent | AnySvelteComponent
  export let props = {}
  export let shrink: boolean = false
  export let showLoading = true
  export let inline: boolean = false
  export let disabled: boolean = false

  let _is: AnyComponent | AnySvelteComponent = is

  // See https://github.com/sveltejs/svelte/issues/4068
  // When passing undefined prop value, then Svelte uses default value only first time when
  // component is instantiated. On the next update the value will be set to undefined.
  // Here we filter out undefined values from props on updates to ensure we don't overwrite them.
  const filterDefaultUndefined = (pnew: any, pold: any): any =>
    pnew != null
      ? Object.fromEntries(
          Object.entries(clone(pnew, undefined, undefined, 10)).filter(
            ([k, v]) => v !== undefined || pold?.[k] !== undefined
          )
        )
      : pnew

  let _props: any = filterDefaultUndefined(props, props)
  let previousInputProps: Record<string, unknown> = { ...props }

  $: if (!deepEqual(_is, is)) {
    _is = is
  }
  $: {
    const p = filterDefaultUndefined(props, _props)
    // Fresh document references must reach editors even when their stored content is unchanged.
    const hasFreshDocument = Object.entries(props ?? {}).some(
      ([key, value]) =>
        value !== previousInputProps[key] &&
        value !== null &&
        typeof value === 'object' &&
        '_id' in value &&
        '_class' in value
    )
    if (!deepEqual(_props, p) || hasFreshDocument) {
      _props = p
    }
    previousInputProps = { ...props }
  }

  let Ctor: any
  let loading = false
  let error: any
  let counter = 0
  const rendering = getRenderContext()
  let finish = (): void => {}
  let reportedError: unknown
  $: if (error != null && error !== reportedError) {
    reportedError = error
    rendering?.fail(error)
    finish()
  }

  onDestroy(() => {
    counter++
    finish()
  })

  async function mounted (current: number): Promise<void> {
    await tick()
    if (current === counter) finish()
  }

  function updateComponent (_is: AnyComponent | AnySvelteComponent): void {
    const current = ++counter
    finish()
    finish = rendering?.registerResource() ?? (() => {})
    error = undefined
    if (_is == null) {
      Ctor = undefined
      error = new Error('is not defined')
      return
    }
    if (typeof _is === 'string') {
      const component = getResourceP<any>(_is)
      if (component instanceof Promise) {
        loading = true
        Ctor = undefined
        void component
          .then((res) => {
            if (current === counter) {
              Ctor = res
              _props = filterDefaultUndefined(props, props)
              loading = false
              void mounted(current).catch((error) => {
                rendering?.fail(error)
              })
            }
          })
          .catch((err) => {
            if (current === counter) {
              error = err
              loading = false
            }
          })
        return
      } else {
        loading = false
        Ctor = component
        _props = filterDefaultUndefined(props, props)
      }
    } else {
      Ctor = _is
      _props = filterDefaultUndefined(props, props)
    }
    void mounted(current).catch((error) => {
      rendering?.fail(error)
    })
  }

  function renderComponent (component: AnyComponent | AnySvelteComponent): void {
    try {
      updateComponent(component)
    } catch (cause) {
      error = cause
      loading = false
    }
  }
  $: renderComponent(_is)
</script>

{#if _is != null}
  {#if loading}
    {#if showLoading}
      <Loading {shrink} />
    {/if}
  {:else if Ctor != null}
    <ErrorBoundary bind:error>
      {#if $$slots.default !== undefined}
        <svelte:component
          this={Ctor}
          bind:this={innerRef}
          {..._props}
          {inline}
          {disabled}
          on:change
          on:close
          on:open
          on:click
          on:delete
          on:action
          on:valid
          on:validate
          on:submit
          on:select
          on:loaded
        >
          <slot />
        </svelte:component>
      {:else}
        <svelte:component
          this={Ctor}
          bind:this={innerRef}
          {..._props}
          {inline}
          {disabled}
          on:change
          on:close
          on:open
          on:click
          on:delete
          on:action
          on:valid
          on:validate
          on:submit
          on:select
          on:loaded
        />
      {/if}
    </ErrorBoundary>
  {/if}
{/if}
{#if error != null}
  <pre style="max-height: 140px; overflow: auto;">
    <ErrorPresenter {error} />
  </pre>
{/if}
