// Uruguayan peso, no decimals. Uses es-UY grouping (1.284.000) with the $ symbol.
export function formatCurrency(amount) {
  return new Intl.NumberFormat('es-UY', {
    style: 'currency',
    currency: 'UYU',
    currencyDisplay: 'narrowSymbol',
    maximumFractionDigits: 0
  }).format(amount || 0)
}

// Compact axis/legend labels: 850 → "850", 500000 → "500k", 1200000 → "1,2M".
export function formatCompact(amount) {
  const n = Number(amount) || 0
  const abs = Math.abs(n)
  if (abs >= 1_000_000) {
    const v = (n / 1_000_000).toFixed(1).replace(/\.0$/, '').replace('.', ',')
    return `${v}M`
  }
  if (abs >= 1_000) {
    return `${Math.round(n / 1_000)}k`
  }
  return String(Math.round(n))
}
