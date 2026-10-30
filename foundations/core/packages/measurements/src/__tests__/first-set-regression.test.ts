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

import {
  childMetrics,
  metricsAggregate,
  metricsToJson,
  metricsToString,
  metricsToRows,
  newMetrics,
  updateMeasure,
  EMPTY_PARAMS,
  MeasureMetricsContext,
  type Metrics
} from '../index'

describe('metrics correctness regressions', () => {
  it('uses the child operation count in JSON labels', () => {
    const root = newMetrics()
    const child = childMetrics(root, 'request')
    child.operations = 2
    child.value = 10
    expect(Object.keys(metricsToJson(root))).toContain('request 10 2 5')
  })

  it.each(['constructor', 'toString', '__proto__'])(
    'preserves reserved name %s through recording and collection',
    (name) => {
      const root: Metrics = JSON.parse(JSON.stringify(newMetrics()))
      const child = childMetrics(root, name)
      expect(child).toEqual(newMetrics())
      const ctx = new MeasureMetricsContext('request', {}, {}, child)
      ctx.newChild(name, { [name]: name }).end(7)
      const collected = metricsAggregate(root, 5).measurements[name].measurements[name]
      expect(collected.operations).toBe(1)
      expect(collected.params[name][name]).toMatchObject({ operations: 1, value: 7 })
      expect(collected.namedParams[name]).toBe(name)
      const restored: Metrics = JSON.parse(JSON.stringify(root))
      expect(metricsAggregate(restored).measurements[name].measurements[name].params[name][name].value).toBe(7)
      expect(Object.prototype.hasOwnProperty.call(root.measurements, name)).toBe(true)
      expect(Object.prototype.hasOwnProperty.call(collected.params, name)).toBe(true)
    }
  )

  it('prints all parameter groups without dropping entries', () => {
    const root = newMetrics()
    root.params = {
      method: { GET: { operations: 2, value: 10 } },
      status: { OK: { operations: 1, value: 3 } }
    }
    const text = metricsToString(root, 'test', 20)
    expect(text).toContain('method=GET')
    expect(text).toContain('avg 5 total: 10 ops: 2')
    expect(text).toContain('status=OK')
    expect(text).toContain('avg 3 total: 3 ops: 1')
  })
})

describe('collection and allocation regressions', () => {
  function numericChildren (): Metrics {
    const root = newMetrics()
    for (const [name, value] of [
      ['1', 10],
      ['42', 100],
      ['named', 50]
    ] as const) {
      const child = childMetrics(root, name)
      child.value = value
      child.operations = 1
    }
    return root
  }

  it('ranks branches by their aggregated values before limiting at every depth', () => {
    const root = newMetrics()
    const branch = childMetrics(root, 'branch')
    branch.value = 1
    childMetrics(branch, 'small').value = 2
    const nested = childMetrics(branch, 'nested')
    nested.value = 0
    childMetrics(nested, 'leaf').value = 100
    childMetrics(root, 'leaf').value = 50
    const collected = metricsAggregate(root, 1)
    expect(Object.keys(collected.measurements)).toEqual(['branch'])
    expect(Object.keys(collected.measurements.branch.measurements)).toEqual(['nested'])
    expect(collected.measurements.branch.value).toBe(102)
    expect(collected.value).toBe(152)
    expect(branch.value).toBe(1)
  })

  it('selects the largest numeric child names before applying the object key order', () => {
    const collected = metricsAggregate(numericChildren(), 2)
    expect(Object.keys(collected.measurements)).toEqual(['42', 'named'])
    expect(collected.value).toBe(160)
  })

  it('prints numeric child names in descending value order', () => {
    const root = numericChildren()
    expect(
      metricsToRows(root)
        .filter((row) => row[0] === 1)
        .map((row) => row[1])
    ).toEqual(['42', 'named', '1'])
    const text = metricsToString(root, 'root', 20)
    expect(text.indexOf('42-')).toBeLessThan(text.indexOf('named-'))
    expect(text.indexOf('named-')).toBeLessThan(text.indexOf('1-'))
    expect(Object.keys(metricsToJson(root)).filter((key) => !key.startsWith('$'))).toEqual([
      '42 100 1 ',
      'named 50 1 ',
      '1 10 1 '
    ])
  })

  it('does not retain children with a zero limit and still includes their total', () => {
    const collected = metricsAggregate(numericChildren(), 0)
    expect(collected.measurements).toEqual({})
    expect(collected.value).toBe(160)
  })

  it('skips secondary parameters on a deleted gauge while updating the leaf and callback', () => {
    const metrics = newMetrics()
    const params = {
      primary: 'value',
      get secondary () {
        return 'detail'
      }
    }
    updateMeasure(metrics, performance.now(), params, EMPTY_PARAMS, undefined, 7, true)
    const removed = metrics.params.primary.value
    const previousResults = JSON.stringify(removed.topResult)
    const secondary = jest.spyOn(params, 'secondary', 'get')
    const endOp = jest.fn()
    updateMeasure(metrics, performance.now(), params, EMPTY_PARAMS, endOp, 0, true)
    expect(metrics.params.primary).toEqual({})
    expect(JSON.stringify(removed.topResult)).toBe(previousResults)
    expect(secondary).not.toHaveBeenCalled()
    expect(metrics.operations).toBe(0)
    expect(endOp).toHaveBeenCalledTimes(1)
  })
})
