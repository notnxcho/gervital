export const NONE_KEY = '__none__'

const normKey = (raw) => (raw == null || raw === '' ? NONE_KEY : String(raw))

// Filter a list of items by query/category/supplier/amount-range.
// Empty/undefined filter values do not narrow. Missing accessors are skipped.
export function filterItems(items, filters = {}, accessors = {}) {
  const { query, categoryId, supplierId, minAmount, maxAmount } = filters
  const { getText, getCategoryId, getSupplierId, getAmount } = accessors
  const q = query ? query.trim().toLowerCase() : ''

  return items.filter(item => {
    if (q && getText) {
      const text = (getText(item) || '').toLowerCase()
      if (!text.includes(q)) return false
    }
    if (categoryId && getCategoryId) {
      if (normKey(getCategoryId(item)) !== String(categoryId)) return false
    }
    if (supplierId && getSupplierId) {
      if (normKey(getSupplierId(item)) !== String(supplierId)) return false
    }
    if (getAmount) {
      const amount = Number(getAmount(item))
      if (minAmount !== '' && minAmount != null && amount < Number(minAmount)) return false
      if (maxAmount !== '' && maxAmount != null && amount > Number(maxAmount)) return false
    }
    return true
  })
}

// Group items by category into ordered buckets with subtotals.
// Alphabetical by label; the NONE_KEY ("Sin categoría") bucket is always last.
export function groupByCategory(items, { getKey, getLabel, getAmount } = {}) {
  const map = new Map()

  for (const item of items) {
    const key = normKey(getKey ? getKey(item) : null)
    const label = key === NONE_KEY ? 'Sin categoría' : (getLabel ? getLabel(item) : '') || 'Sin categoría'
    if (!map.has(key)) map.set(key, { key, label, items: [], subtotal: 0 })
    const group = map.get(key)
    group.items.push(item)
    if (getAmount) group.subtotal += Number(getAmount(item)) || 0
  }

  return Array.from(map.values()).sort((a, b) => {
    if (a.key === NONE_KEY) return 1
    if (b.key === NONE_KEY) return -1
    return a.label.localeCompare(b.label, 'es')
  })
}
