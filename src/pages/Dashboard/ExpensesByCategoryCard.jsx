import Card from '../../components/ui/Card'
import BreakdownBars from './charts/BreakdownBars'
import { formatCurrency } from '../../utils/format'

// Gastos del mes por categoría (variables + fijos mensualizados + sueldos).
// Un solo tono para las barras: es un desglose, no una comparación semántica.
const BAR_COLOR = '#94a3b8'

export default function ExpensesByCategoryCard({ rows, monthLabel }) {
  const data = (rows || []).map(r => ({ ...r, color: BAR_COLOR }))
  const total = data.reduce((s, r) => s + r.value, 0)

  return (
    <Card className="rounded-2xl border-gray-100 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
      <div className="px-5 pt-5 pb-4 flex items-baseline justify-between gap-3">
        <h3 className="text-[15px] font-semibold text-gray-900">Gastos por categoría</h3>
        <span className="text-xs text-gray-400 capitalize shrink-0">{monthLabel} · {formatCurrency(total)}</span>
      </div>
      <div className="px-5 pb-5">
        {data.length === 0
          ? <p className="text-sm text-gray-400 py-8 text-center">No hay gastos registrados este mes.</p>
          : <BreakdownBars rows={data} money showPct />}
      </div>
    </Card>
  )
}
