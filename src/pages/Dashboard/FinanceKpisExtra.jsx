import StatCard from './charts/StatCard'
import { formatCurrency } from '../../utils/format'

// Fila de indicadores financieros adicionales del mes seleccionado.
// `data` viene de extendedFinanceKpis().
export default function FinanceKpisExtra({ data }) {
  if (!data) return null
  const { marginPct, laborPct, pendingCollection, attendanceRevenue, attendanceShare, ivaToRemit, arr } = data

  return (
    <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
      <StatCard
        label="Margen %"
        value={marginPct == null ? '—' : `${marginPct.toFixed(1)}%`}
        valueClass={marginPct == null ? 'text-gray-400' : marginPct >= 0 ? 'text-emerald-700' : 'text-rose-600'}
        sub="margen / ingreso"
      />
      <StatCard
        label="Costo laboral %"
        value={laborPct == null ? '—' : `${laborPct.toFixed(0)}%`}
        valueClass={laborPct == null ? 'text-gray-400' : laborPct <= 40 ? 'text-emerald-700' : laborPct <= 60 ? 'text-amber-600' : 'text-rose-600'}
        sub="sueldos / ingreso"
      />
      <StatCard
        label="Pendiente de cobro"
        value={formatCurrency(pendingCollection)}
        valueClass={pendingCollection > 0 ? 'text-rose-600' : 'text-emerald-700'}
        sub="previsto − cobrado"
      />
      <StatCard
        label="Ingreso asistencia"
        value={formatCurrency(attendanceRevenue)}
        valueClass="text-emerald-700"
        sub={`${attendanceShare.toFixed(0)}% del ingreso`}
      />
      <StatCard
        label="IVA a remitir"
        value={formatCurrency(ivaToRemit)}
        sub="bruto − neto"
      />
      <StatCard
        label="Ingreso anualizado"
        value={formatCurrency(arr)}
        sub="MRR × 12 · neto"
      />
    </div>
  )
}
