import { formatCurrency, formatCompact } from './format'

// NOTE: Intl.NumberFormat('es-UY') emits a non-breaking space (U+00A0) between
// the $ symbol and the digits — expected strings below use that exact character.
describe('formatCurrency', () => {
  test('formats UYU with no decimals', () => {
    expect(formatCurrency(1284000)).toBe('$ 1.284.000')
  })
  test('handles zero', () => {
    expect(formatCurrency(0)).toBe('$ 0')
  })
})

describe('formatCompact', () => {
  test('renders thousands with k', () => {
    expect(formatCompact(500000)).toBe('500k')
  })
  test('renders millions with M and one decimal', () => {
    expect(formatCompact(1200000)).toBe('1,2M')
  })
  test('small numbers unchanged', () => {
    expect(formatCompact(0)).toBe('0')
    expect(formatCompact(850)).toBe('850')
  })
})
