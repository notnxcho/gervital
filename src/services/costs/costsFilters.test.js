import { filterItems, groupByCategory, NONE_KEY } from './costsFilters'

const items = [
  { id: 1, text: 'Reparación heladera', cat: 'c1', sup: 's1', amount: 8500 },
  { id: 2, text: 'Verduras semana', cat: 'c2', sup: 's2', amount: 4000 },
  { id: 3, text: 'Detergente', cat: null, sup: null, amount: 3200 },
  { id: 4, text: 'Carne', cat: 'c2', sup: 's2', amount: 8500 }
]

const accessors = {
  getText: (i) => i.text,
  getCategoryId: (i) => i.cat,
  getSupplierId: (i) => i.sup,
  getAmount: (i) => i.amount
}

describe('filterItems', () => {
  test('empty filters is passthrough', () => {
    expect(filterItems(items, {}, accessors)).toHaveLength(4)
  })
  test('text filter is case-insensitive and matches substring', () => {
    const r = filterItems(items, { query: 'VERD' }, accessors)
    expect(r.map(i => i.id)).toEqual([2])
  })
  test('category filter matches by id', () => {
    const r = filterItems(items, { categoryId: 'c2' }, accessors)
    expect(r.map(i => i.id)).toEqual([2, 4])
  })
  test('category filter NONE_KEY matches null category', () => {
    const r = filterItems(items, { categoryId: NONE_KEY }, accessors)
    expect(r.map(i => i.id)).toEqual([3])
  })
  test('supplier filter NONE_KEY matches null supplier', () => {
    const r = filterItems(items, { supplierId: NONE_KEY }, accessors)
    expect(r.map(i => i.id)).toEqual([3])
  })
  test('amount range inclusive on both bounds', () => {
    const r = filterItems(items, { minAmount: 4000, maxAmount: 8500 }, accessors)
    expect(r.map(i => i.id)).toEqual([1, 2, 4])
  })
  test('only minAmount', () => {
    const r = filterItems(items, { minAmount: 5000 }, accessors)
    expect(r.map(i => i.id)).toEqual([1, 4])
  })
  test('filters combine with AND', () => {
    const r = filterItems(items, { categoryId: 'c2', minAmount: 5000 }, accessors)
    expect(r.map(i => i.id)).toEqual([4])
  })
  test('missing accessor is ignored (no amount accessor)', () => {
    const r = filterItems(items, { minAmount: 5000 }, { getText: (i) => i.text })
    expect(r).toHaveLength(4)
  })
  test('empty string / undefined filter values do not narrow', () => {
    const r = filterItems(items, { query: '', categoryId: '', minAmount: undefined }, accessors)
    expect(r).toHaveLength(4)
  })
})

describe('groupByCategory', () => {
  const catItems = [
    { id: 1, cat: 'c2', catName: 'Limpieza', amount: 3200 },
    { id: 2, cat: 'c1', catName: 'Alimentación', amount: 4000 },
    { id: 3, cat: null, catName: null, amount: 1000 },
    { id: 4, cat: 'c1', catName: 'Alimentación', amount: 8500 }
  ]
  const opts = {
    getKey: (i) => i.cat,
    getLabel: (i) => i.catName,
    getAmount: (i) => i.amount
  }
  test('groups sorted alphabetically by label with Sin categoría last', () => {
    const g = groupByCategory(catItems, opts)
    expect(g.map(x => x.label)).toEqual(['Alimentación', 'Limpieza', 'Sin categoría'])
  })
  test('subtotals sum per group', () => {
    const g = groupByCategory(catItems, opts)
    expect(g.find(x => x.label === 'Alimentación').subtotal).toBe(12500)
    expect(g.find(x => x.label === 'Sin categoría').subtotal).toBe(1000)
  })
  test('items land in the right group', () => {
    const g = groupByCategory(catItems, opts)
    expect(g.find(x => x.label === 'Alimentación').items.map(i => i.id)).toEqual([2, 4])
  })
  test('Sin categoría uses NONE_KEY as key', () => {
    const g = groupByCategory(catItems, opts)
    expect(g.find(x => x.label === 'Sin categoría').key).toBe(NONE_KEY)
  })
  test('without getAmount subtotal is 0', () => {
    const g = groupByCategory(catItems, { getKey: (i) => i.cat, getLabel: (i) => i.catName })
    expect(g[0].subtotal).toBe(0)
  })
})
