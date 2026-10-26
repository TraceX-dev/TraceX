import type { Class, Doc, Ref } from '@hcengineering/core'
import { isSpotlightSearchableClass } from '../spotlightSupport'

const c = (s: string): Ref<Class<Doc>> => s as Ref<Class<Doc>>

describe('isSpotlightSearchableClass', () => {
  const hierarchy = { isDerived: (a: Ref<Class<Doc>>, b: Ref<Class<Doc>>) => a === b || a === c('card.sub') }

  it('matches the exact class', () => {
    const cats = [{ context: ['search', 'spotlight'], classToSearch: c('card.card'), includeChilds: false }] as any
    expect(isSpotlightSearchableClass(hierarchy as any, cats, c('card.card'))).toEqual(true)
  })

  it('matches descendants only when includeChilds is set', () => {
    const withChilds = [{ context: ['spotlight'], classToSearch: c('card.card'), includeChilds: true }] as any
    const without = [{ context: ['spotlight'], classToSearch: c('card.card') }] as any
    expect(isSpotlightSearchableClass(hierarchy as any, withChilds, c('card.sub'))).toEqual(true)
    expect(isSpotlightSearchableClass(hierarchy as any, without, c('card.sub'))).toEqual(false)
  })

  it('ignores categories without the spotlight context', () => {
    const cats = [{ context: ['search', 'mention'], classToSearch: c('card.card'), includeChilds: true }] as any
    expect(isSpotlightSearchableClass(hierarchy as any, cats, c('card.card'))).toEqual(false)
  })

  it('is false for unrelated classes', () => {
    const cats = [{ context: ['spotlight'], classToSearch: c('card.card'), includeChilds: true }] as any
    expect(isSpotlightSearchableClass(hierarchy as any, cats, c('other.class'))).toEqual(false)
  })
})
