import { formatCurrency } from '../../../utils/format'

// Horizontal bars ranked by value, each showing the formatted value plus its
// share of the total. Rows sort descending; bar width is relative to the max.
export default function BreakdownBars({ rows, money = false, suffix = '', showPct = true }) {
  const sorted = [...(rows || [])].sort((a, b) => b.value - a.value)
  const max = sorted.reduce((m, r) => Math.max(m, r.value), 0) || 1
  const total = sorted.reduce((s, r) => s + r.value, 0) || 1

  const fmt = v => (money ? formatCurrency(v) : `${v}${suffix}`)

  return (
    <div className="flex flex-col" style={{ gap: 13 }}>
      {sorted.map((row, i) => {
        const pct = (row.value / total) * 100
        const width = (row.value / max) * 100
        return (
          <div key={`${row.label}-${i}`}>
            <div className="flex items-center justify-between gap-3 mb-1">
              <div className="flex items-center gap-2 min-w-0">
                <span className="w-2 h-2 rounded-sm flex-shrink-0" style={{ background: row.color }} />
                <span className="text-[13px] text-gray-700 truncate">{row.label}</span>
              </div>
              <div className="flex items-baseline gap-1.5 flex-shrink-0">
                <span className="text-[13px] font-semibold text-gray-900 tabular-nums">{fmt(row.value)}</span>
                {showPct && <span className="text-[11px] text-gray-400 tabular-nums">{pct.toFixed(0)}% del total</span>}
              </div>
            </div>
            <div className="bg-gray-100 h-2 rounded-full overflow-hidden">
              <div className="h-full rounded-full" style={{ width: `${width}%`, background: row.color }} />
            </div>
          </div>
        )
      })}
    </div>
  )
}
