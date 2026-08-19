<!--
// Copyright © 2025 Hardcore Engineering Inc.
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
  import { MasterTag, Tag } from '@hcengineering/card'
  import { Ref } from '@hcengineering/core'
  import { getClient } from '@hcengineering/presentation'
  import { Process, State, Step, Transition } from '@hcengineering/process'
  import { Button, ButtonIcon, getCurrentLocation, IconClose, Label, Modal, navigate } from '@hcengineering/ui'
  import ELK, { type ElkExtendedEdge, type ElkNode, type ElkPoint } from 'elkjs/lib/elk.bundled.js'
  import { createEventDispatcher } from 'svelte'
  import plugin from '../../plugin'
  import TriggerPresenter from './TriggerPresenter.svelte'

  interface ProcessRelation {
    from: Ref<Process>
    to: Ref<Process>
  }

  interface DiagramNode extends ElkNode {
    label: string
    virtual?: boolean
  }

  export let process: Process

  const client = getClient()
  const hierarchy = client.getHierarchy()
  const dispatch = createEventDispatcher()
  const elk = new ELK()
  const EDGE_LABEL_WIDTH = 420
  const EDGE_LABEL_HEIGHT = 52

  let activeView: 'states' | 'processes' = 'states'
  let diagramProcess = process
  let layout: ElkNode | undefined
  let layoutRequest = 0

  $: states = client.getModel().findAllSync(plugin.class.State, { process: diagramProcess._id })
  $: transitions = client.getModel().findAllSync(plugin.class.Transition, { process: diagramProcess._id })
  $: availableMasterTags = new Set<Ref<MasterTag | Tag>>([
    diagramProcess.masterTag,
    ...(hierarchy.getAncestors(diagramProcess.masterTag) as Array<Ref<MasterTag | Tag>>)
  ])
  $: relatedProcesses = client
    .getModel()
    .findAllSync(plugin.class.Process, {})
    .filter((candidate) => availableMasterTags.has(candidate.masterTag))
  $: relations = getRelations(relatedProcesses)
  $: void updateLayout(activeView, states, transitions, relatedProcesses, relations)
  $: diagramNodes = (layout?.children ?? []) as DiagramNode[]
  $: diagramEdges = layout?.edges ?? []
  $: diagramWidth = Math.max(640, (layout?.width ?? 0) + 80)
  $: diagramHeight = Math.max(280, (layout?.height ?? 0) + 80)

  function getRelations(processes: Process[]): ProcessRelation[] {
    const ids = new Set(processes.map((candidate) => candidate._id))
    const result = new Map<string, ProcessRelation>()

    for (const candidate of processes) {
      const candidateTransitions = client.getModel().findAllSync(plugin.class.Transition, { process: candidate._id })
      for (const transition of candidateTransitions) {
        for (const action of transition.actions as Array<Step<Process>>) {
          if (action.methodId !== plugin.method.RunSubProcess) continue
          const target = action.params._id as Ref<Process> | undefined
          if (target !== undefined && ids.has(target)) {
            result.set(`${candidate._id}:${target}`, { from: candidate._id, to: target })
          }
        }
      }
    }

    return [...result.values()]
  }

  async function updateLayout(
    view: 'states' | 'processes',
    currentStates: State[],
    currentTransitions: Transition[],
    currentProcesses: Process[],
    currentRelations: ProcessRelation[]
  ): Promise<void> {
    const request = ++layoutRequest
    const graph =
      view === 'states'
        ? createStateGraph(currentStates, currentTransitions)
        : createProcessGraph(currentProcesses, currentRelations)

    try {
      const nextLayout = await elk.layout(graph)
      if (request === layoutRequest) {
        layout = nextLayout
      }
    } catch {
      if (request === layoutRequest) {
        layout = undefined
      }
    }
  }

  function createStateGraph(currentStates: State[], currentTransitions: Transition[]): ElkNode {
    const startId = 'start'
    const children: DiagramNode[] = [
      { id: startId, label: '▶', virtual: true, width: 42, height: 42 },
      ...currentStates.map((state) => ({ id: state._id, label: state.title, width: 180, height: 64 }))
    ]

    return {
      id: 'states',
      layoutOptions: layoutOptions(),
      children,
      edges: currentTransitions.map((transition) => ({
        id: transition._id,
        sources: [transition.from ?? startId],
        targets: [transition.to]
      }))
    }
  }

  function createProcessGraph(processes: Process[], currentRelations: ProcessRelation[]): ElkNode {
    return {
      id: 'processes',
      layoutOptions: layoutOptions(),
      children: processes.map((candidate) => ({ id: candidate._id, label: candidate.name, width: 210, height: 56 })),
      edges: currentRelations.map((relation, index) => ({
        id: `${relation.from}:${relation.to}:${index}`,
        sources: [relation.from],
        targets: [relation.to]
      }))
    }
  }

  function layoutOptions(): Record<string, string> {
    return {
      'elk.algorithm': 'layered',
      'elk.direction': 'RIGHT',
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.layered.cycleBreaking.strategy': 'DEPTH_FIRST',
      'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
      'elk.layered.spacing.nodeNodeBetweenLayers': '480',
      'elk.spacing.nodeNode': '40',
      'elk.spacing.edgeNode': '60',
      'elk.spacing.componentComponent': '70',
      'elk.padding': '[top=30,left=30,bottom=30,right=30]'
    }
  }

  function edgePath(edge: ElkExtendedEdge): string {
    return (edge.sections ?? [])
      .map((section) => {
        const points = [section.startPoint, ...(section.bendPoints ?? []), section.endPoint]
        return points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ')
      })
      .join(' ')
  }

  function edgeLabelPosition(edge: ElkExtendedEdge): ElkPoint {
    const points = (edge.sections ?? []).flatMap((section) => [
      section.startPoint,
      ...(section.bendPoints ?? []),
      section.endPoint
    ])
    let start = points[0] ?? { x: 0, y: 0 }
    let end = start
    let longestSegment = 0

    for (let index = 1; index < points.length; index++) {
      const candidate = points[index]
      const previous = points[index - 1]
      const length = Math.hypot(candidate.x - previous.x, candidate.y - previous.y)
      if (length > longestSegment) {
        longestSegment = length
        start = previous
        end = candidate
      }
    }

    return { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 - 16 }
  }

  function transitionForEdge(edge: ElkExtendedEdge): Transition | undefined {
    return transitions.find((candidate) => candidate._id === edge.id)
  }

  function visibleLabel(label: string): string {
    return label.length > 24 ? `${label.slice(0, 23)}…` : label
  }

  function openTransition(edge: ElkExtendedEdge): void {
    const transition = transitions.find((candidate) => candidate._id === edge.id)
    if (transition === undefined) return
    const loc = getCurrentLocation()
    loc.path[5] = plugin.component.TransitionEditor
    loc.path[6] = transition._id
    navigate(loc, true)
    dispatch('close')
  }

  function selectProcess(id: string): void {
    const selectedProcess = relatedProcesses.find((candidate) => candidate._id === id)
    if (selectedProcess !== undefined) {
      diagramProcess = selectedProcess
      activeView = 'states'
    }
  }
</script>

<Modal type={'type-component'} scrollableContent={false} on:close>
  <svelte:fragment slot="beforeTitle">
    <ButtonIcon icon={IconClose} kind="tertiary" size="small" on:click={() => dispatch('close')} />
    <div class="hulyHeader-divider short no-line" />
  </svelte:fragment>
  <svelte:fragment slot="title"><Label label={plugin.string.ProcessDiagram} /></svelte:fragment>
  <div class="toolbar">
    <Button
      kind={activeView === 'states' ? 'primary' : 'secondary'}
      label={plugin.string.ProcessDiagram}
      on:click={() => {
        activeView = 'states'
      }}
    />
    <Button
      kind={activeView === 'processes' ? 'primary' : 'secondary'}
      label={plugin.string.ProcessMap}
      on:click={() => {
        activeView = 'processes'
      }}
    />
  </div>

  {#if activeView === 'states' && states.length === 0}
    <div class="empty"><Label label={plugin.string.NoTransitions} /></div>
  {:else if activeView === 'processes' && relatedProcesses.length === 0}
    <div class="empty"><Label label={plugin.string.NoProcessRelations} /></div>
  {:else}
    <div class="diagram-scroll">
      <svg
        class="diagram"
        width={diagramWidth}
        height={diagramHeight}
        viewBox={`0 0 ${diagramWidth} ${diagramHeight}`}
        aria-label="Process diagram"
      >
        <defs>
          <marker id="diagram-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
            <path d="M0,0 L8,4 L0,8 Z" fill="var(--theme-caption-color)" />
          </marker>
        </defs>
        <g transform="translate(40, 40)">
          {#each diagramEdges as edge}
            <!-- svelte-ignore a11y-click-events-have-key-events -->
            <path
              class:clickable={activeView === 'states'}
              class="edge"
              d={edgePath(edge)}
              marker-end="url(#diagram-arrow)"
              on:click={() => {
                if (activeView === 'states') openTransition(edge)
              }}
            />
            {#if activeView === 'states'}
              {@const transition = transitionForEdge(edge)}
              {@const labelPosition = edgeLabelPosition(edge)}
              {#if transition !== undefined}
                <foreignObject
                  x={labelPosition.x - EDGE_LABEL_WIDTH / 2}
                  y={labelPosition.y - EDGE_LABEL_HEIGHT / 2}
                  width={EDGE_LABEL_WIDTH}
                  height={EDGE_LABEL_HEIGHT}
                >
                  <div class="edge-label-wrap">
                    <button
                      class="edge-label"
                      on:click={() => {
                        openTransition(edge)
                      }}
                    >
                      <TriggerPresenter
                        value={transition.trigger}
                        process={diagramProcess}
                        params={transition.triggerParams}
                        withLabel
                      />
                    </button>
                  </div>
                </foreignObject>
              {/if}
            {/if}
          {/each}
          {#each diagramNodes as node}
            <!-- svelte-ignore a11y-click-events-have-key-events -->
            <g
              class="node"
              class:virtual={node.virtual}
              class:current={activeView === 'processes' && node.id === diagramProcess._id}
              class:clickable={activeView === 'processes'}
              transform={`translate(${node.x ?? 0}, ${node.y ?? 0})`}
              on:click={() => {
                if (activeView === 'processes') selectProcess(node.id)
              }}
            >
              <rect width={node.width} height={node.height} rx={node.virtual ? 21 : 10} />
              <text x={(node.width ?? 0) / 2} y={(node.height ?? 0) / 2 + 5} text-anchor="middle">
                {visibleLabel(node.label)}
              </text>
              <title>{node.label}</title>
            </g>
          {/each}
        </g>
      </svg>
    </div>
  {/if}
</Modal>

<style lang="scss">
  .toolbar {
    display: flex;
    gap: var(--spacing-2);
    padding: var(--spacing-1);
    margin-bottom: var(--spacing-2);
  }

  :global(.popup.fullsize .hulyModal-content) {
    padding: var(--spacing-2);
    box-sizing: border-box;
  }

  .diagram-scroll {
    overflow: auto;
    max-height: calc(100vh - 10rem);
    min-height: 18rem;
    border: 1px solid var(--theme-divider-color);
    border-radius: 0.5rem;
    background: var(--theme-popup-color);
  }

  .diagram {
    display: block;
    min-width: 48rem;
    min-height: 20rem;
  }

  .edge {
    fill: none;
    stroke: var(--theme-caption-color);
    stroke-width: 2;
  }

  .edge-label-wrap {
    display: flex;
    justify-content: center;
    width: 100%;
  }

  .edge-label {
    display: inline-flex;
    align-items: center;
    width: 100%;
    min-height: 2.5rem;
    padding: 0.25rem 0.5rem;
    color: var(--theme-dark-color);
    font: inherit;
    text-align: left;
    white-space: normal;
    cursor: pointer;
    background: var(--theme-popup-color);
    border: 1px solid var(--theme-divider-color);
    border-radius: 0.25rem;
  }

  .node rect {
    fill: var(--theme-button-default);
    stroke: var(--theme-caption-color);
    stroke-width: 1.5;
  }

  .node text {
    fill: var(--theme-dark-color);
    font-size: 14px;
    pointer-events: none;
  }

  .node.virtual rect {
    fill: var(--theme-accent-color);
  }

  .node.current rect {
    fill: var(--theme-accent-color);
    stroke: var(--theme-accent-color);
    stroke-width: 3;
  }

  .clickable {
    cursor: pointer;
  }

  .empty {
    padding: var(--spacing-6);
    color: var(--theme-caption-color);
    text-align: center;
  }
</style>
