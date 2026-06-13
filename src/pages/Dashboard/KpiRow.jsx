import Card, { CardContent } from '../../components/ui/Card'
import { formatCurrency } from '../../services/dashboard/format'

function Delta({ value }) {
  if (value == null) return <p className="text-xs text-gray-400 mt-1">sin mes anterior</p>
  const up = value >= 0
  return (
    <p className={`text-xs font-semibold mt-1 ${up ? 'text-green-600' : 'text-red-600'}`}>
      {up ? '▲' : '▼'} {formatCurrency(Math.abs(value))} vs mes ant.
    </p>
  )
}

function Kpi({ label, value, colorClass = 'text-gray-900', children }) {
  return (
    <Card className="flex-1 min-w-0">
      <CardContent className="py-5">
        <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1 truncate">{label}</p>
        <p className={`text-2xl font-bold ${colorClass} truncate`}>{value}</p>
        {children}
      </CardContent>
    </Card>
  )
}

export default function KpiRow({ kpis }) {
  if (!kpis) {
    return (
      <div className="flex gap-4 flex-wrap">
        {[0, 1, 2, 3, 4].map(i => (
          <Card key={i} className="flex-1 min-w-0">
            <CardContent className="py-5">
              <div className="h-3 w-24 bg-gray-100 rounded mb-3" />
              <div className="h-6 w-28 bg-gray-100 rounded" />
            </CardContent>
          </Card>
        ))}
      </div>
    )
  }

  const collectionPct = kpis.ingresoPrevisto > 0
    ? Math.round((kpis.cobrado / kpis.ingresoPrevisto) * 100)
    : 0

  return (
    <div className="flex gap-4 flex-wrap">
      <Kpi label="Ingreso previsto" value={formatCurrency(kpis.ingresoPrevisto)}>
        <Delta value={kpis.deltas.ingresoPrevisto} />
      </Kpi>
      <Kpi label="Cobrado" value={formatCurrency(kpis.cobrado)} colorClass="text-green-700">
        <p className="text-xs text-gray-400 mt-1">{collectionPct}% del previsto</p>
      </Kpi>
      <Kpi label="Gastos" value={formatCurrency(kpis.gastos)} colorClass="text-red-700">
        <Delta value={kpis.deltas.gastos} />
      </Kpi>
      <Kpi
        label="Margen"
        value={formatCurrency(kpis.margen)}
        colorClass={kpis.margen >= 0 ? 'text-green-700' : 'text-red-700'}
      >
        <p className="text-xs text-gray-400 mt-1">Ingreso − Gastos</p>
      </Kpi>
      <Kpi
        label="Tasa de cobro"
        value={`${kpis.tasaCobro.toFixed(0)}%`}
        colorClass={kpis.tasaCobro >= 80 ? 'text-green-700' : kpis.tasaCobro >= 50 ? 'text-amber-700' : 'text-red-700'}
      >
        <p className="text-xs text-gray-400 mt-1">Cobrado / Previsto</p>
      </Kpi>
    </div>
  )
}
