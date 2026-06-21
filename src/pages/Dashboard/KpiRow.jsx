import Card from '../../components/ui/Card'
import { formatCurrency, formatCompact } from '../../utils/format'

// Directional pill from a currency delta. `invert` flips the color semantics
// (used for Gastos, where a rise is bad). Shows % when the prior value is known.
function DeltaPill({ current, delta, invert = false }) {
  if (delta == null) return <span className="text-[11px] text-gray-300">—</span>
  const up = delta >= 0
  const good = invert ? !up : up
  const prev = current - delta
  const pct = prev > 0 ? (delta / prev) * 100 : null
  const text = pct != null
    ? `${up ? '+' : '−'}${Math.abs(pct).toFixed(0)}%`
    : `${up ? '+' : '−'}${formatCompact(Math.abs(delta))}`
  return (
    <span className={`inline-flex items-center gap-0.5 text-[11px] font-semibold px-1.5 py-0.5 rounded-md ${good ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-600'}`}>
      {up ? '↑' : '↓'} {text}
    </span>
  )
}

function Kpi({ label, value, valueClass = 'text-gray-900', pill, sub }) {
  return (
    <Card className="rounded-2xl border-gray-100 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
      <div className="px-4 py-4">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[13px] font-medium text-gray-500 truncate">{label}</p>
          {pill}
        </div>
        <p className={`text-[22px] leading-tight font-semibold tracking-tight tabular-nums mt-1.5 truncate ${valueClass}`}>
          {value}
        </p>
        {sub && <p className="text-[11px] text-gray-400 mt-1">{sub}</p>}
      </div>
    </Card>
  )
}

export default function KpiRow({ kpis }) {
  if (!kpis) {
    return (
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        {[0, 1, 2, 3, 4].map(i => (
          <Card key={i} className="rounded-2xl border-gray-100">
            <div className="px-4 py-4">
              <div className="h-3 w-24 bg-gray-100 rounded mb-3" />
              <div className="h-6 w-28 bg-gray-100 rounded" />
            </div>
          </Card>
        ))}
      </div>
    )
  }

  const collectionPct = kpis.ingresoPrevisto > 0
    ? Math.round((kpis.cobrado / kpis.ingresoPrevisto) * 100)
    : 0

  return (
    <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
      <Kpi
        label="Ingreso previsto"
        value={formatCurrency(kpis.ingresoPrevisto)}
        pill={<DeltaPill current={kpis.ingresoPrevisto} delta={kpis.deltas.ingresoPrevisto} />}
        sub="vs mes anterior"
      />
      <Kpi
        label="Cobrado"
        value={formatCurrency(kpis.cobrado)}
        valueClass="text-emerald-700"
        sub={`${collectionPct}% del previsto`}
      />
      <Kpi
        label="Gastos"
        value={formatCurrency(kpis.gastos)}
        valueClass="text-rose-600"
        pill={<DeltaPill current={kpis.gastos} delta={kpis.deltas.gastos} invert />}
        sub="vs mes anterior"
      />
      <Kpi
        label="Margen"
        value={formatCurrency(kpis.margen)}
        valueClass={kpis.margen >= 0 ? 'text-emerald-700' : 'text-rose-600'}
        sub="Ingreso − Gastos"
      />
      <Kpi
        label="Tasa de cobro"
        value={`${kpis.tasaCobro.toFixed(0)}%`}
        valueClass={kpis.tasaCobro >= 80 ? 'text-emerald-700' : kpis.tasaCobro >= 50 ? 'text-amber-600' : 'text-rose-600'}
        sub="Cobrado / Previsto"
      />
    </div>
  )
}
