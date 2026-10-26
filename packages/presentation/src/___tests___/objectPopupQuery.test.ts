import type { Doc, Ref } from '@hcengineering/core'
import { buildObjectPopupQuery } from '../components/objectPopupQuery'

const id = (s: string): Ref<Doc> => s as Ref<Doc>

describe('buildObjectPopupQuery', () => {
  const base = { searchField: 'name', ignoreObjects: [] as Ref<Doc>[] }

  it('field mode uses $like on searchField', () => {
    const q = buildObjectPopupQuery({ ...base, searchMode: 'field', search: 'abc' })
    expect(q).toEqual({ name: { $like: '%abc%' }, _id: { $nin: [] } })
  })

  it('does not drop docQuery excluded ids or ignored objects', () => {
    const q = buildObjectPopupQuery({
      ...base,
      searchMode: 'fulltext',
      search: 'x',
      ignoreObjects: [id('a')],
      docQuery: { isLatest: true, _id: { $nin: [id('b')] } }
    })
    expect(q).toEqual({ isLatest: true, $search: 'x', _id: { $nin: [id('a'), id('b')] } })
  })

  it('spotlight without search does not restrict ids', () => {
    const q: any = buildObjectPopupQuery({ ...base, searchMode: 'spotlight', search: '' })
    expect(q._id.$in).toBeUndefined()
  })

  it('spotlight keeps docQuery exclusions and restricts to found ids', () => {
    const q: any = buildObjectPopupQuery({
      ...base,
      searchMode: 'spotlight',
      search: 'dc-4',
      spotlightIds: [id('1'), id('2')],
      docQuery: { _id: { $nin: [id('2')] } }
    })
    expect(q._id.$in).toEqual([id('1'), id('2')])
    expect(q._id.$nin).toEqual([id('2')])
  })

  it('spotlight intersects with docQuery $in', () => {
    const q: any = buildObjectPopupQuery({
      ...base,
      searchMode: 'spotlight',
      search: 'x',
      spotlightIds: [id('1'), id('2')],
      docQuery: { _id: { $in: [id('2'), id('3')] } }
    })
    expect(q._id.$in).toEqual([id('2')])
  })

  it('spotlight with no results or pending results gives empty list, not full list', () => {
    const none: any = buildObjectPopupQuery({ ...base, searchMode: 'spotlight', search: 'zzz', spotlightIds: [] })
    const pending: any = buildObjectPopupQuery({ ...base, searchMode: 'spotlight', search: 'zzz' })
    expect(none._id.$in).toEqual([])
    expect(pending._id.$in).toEqual([])
  })
})
