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
//

import mermaid from 'mermaid'
import { renderMermaidSvg } from '../mermaid'

jest.mock('mermaid', () => ({
  __esModule: true,
  default: { initialize: jest.fn(), render: jest.fn() }
}))

const initialize = jest.mocked(mermaid.initialize)
const render = jest.mocked(mermaid.render)

describe('Mermaid SVG renderer', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    render.mockReset()
  })

  it('renders diagrams with unique IDs and strict security by default', async () => {
    render.mockResolvedValue({ svg: '<svg>diagram</svg>', diagramType: 'flowchart-v2' })

    expect(await renderMermaidSvg('graph TD\nA-->B', 'default')).toBe('<svg>diagram</svg>')
    await renderMermaidSvg('graph TD\nC-->D', 'default')

    expect(initialize).toHaveBeenCalledWith(expect.objectContaining({
      securityLevel: 'strict', startOnLoad: false, suppressErrorRendering: true
    }))
    expect(render.mock.calls[0][0]).not.toBe(render.mock.calls[1][0])
    expect(render.mock.calls[0][1]).toBe('graph TD\nA-->B')
  })

  it('keeps initialization and rendering together when themes differ', async () => {
    let finishFirst: (value: { svg: string, diagramType: string }) => void = () => {}
    const firstRender = new Promise<{ svg: string, diagramType: string }>((resolve) => {
      finishFirst = resolve
    })
    let notifyStarted: () => void = () => {}
    const started = new Promise<void>((resolve) => { notifyStarted = resolve })
    render.mockImplementationOnce(async () => {
      notifyStarted()
      return await firstRender
    }).mockResolvedValueOnce({ svg: '<svg>dark</svg>', diagramType: 'flowchart-v2' })

    const first = renderMermaidSvg('graph TD\nA-->B', 'default')
    const second = renderMermaidSvg('graph TD\nC-->D', 'dark', 'antiscript')
    await started

    expect(initialize).toHaveBeenCalledTimes(1)
    finishFirst({ svg: '<svg>light</svg>', diagramType: 'flowchart-v2' })
    expect(await Promise.all([first, second])).toEqual(['<svg>light</svg>', '<svg>dark</svg>'])
    expect(initialize).toHaveBeenLastCalledWith(expect.objectContaining({
      theme: 'dark', securityLevel: 'antiscript'
    }))
  })

  it('continues rendering other diagrams after invalid input', async () => {
    const error = new Error('Invalid diagram')
    render.mockRejectedValueOnce(error)
      .mockResolvedValueOnce({ svg: '<svg>valid</svg>', diagramType: 'flowchart-v2' })

    const invalid = renderMermaidSvg('invalid', 'default')
    const valid = renderMermaidSvg('graph TD\nA-->B', 'default')

    await expect(invalid).rejects.toThrow(error)
    await expect(valid).resolves.toBe('<svg>valid</svg>')
  })
})
