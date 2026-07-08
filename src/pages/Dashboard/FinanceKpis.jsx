import StatCard from './charts/StatCard'
import { formatCurrency, formatCompact } from '../../utils/format'

// Pill direccional a partir de un delta en $. `invert` invierte la semántica de color
// (Gastos: subir es malo). Único lugar con color en los KPIs (señal, no decoración).
function DeltaPill({ current, delta, invert = false }) {
  if (delta == null) return null
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

// Métrica secundaria: label + valor en una línea, discreta (sin card propia).
function MiniStat({ label, value }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-[12px] text-gray-500">{label}</span>
      <span className="text-[14px] font-semibold text-gray-900 tabular-nums">{value}</span>
    </div>
  )
}

function Skeleton() {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {[0, 1, 2, 3].map(i => (
        <div key={i} className="rounded-2xl border border-gray-100 bg-white px-4 py-4">
          <div className="h-3 w-20 bg-gray-100 rounded mb-3" />
          <div className="h-6 w-24 bg-gray-100 rounded" />
        </div>
      ))}
    </div>
  )
}

// KPIs financieros del mes con jerarquía: Resultado (P&L, primario) + una tira
// secundaria de apoyo. Valores en neutro; color reservado a los deltas y al margen
// negativo. `kpis` = deriveKpis(); `extra` = extendedFinanceKpis().
export default function FinanceKpis({ kpis, extra }) {
  if (!kpis) return <Skeleton />

  const collectionPct = kpis.ingresoPrevisto > 0 ? Math.round((kpis.cobrado / kpis.ingresoPrevisto) * 100) : 0
  const laborPct = extra?.laborPct

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          label="Ingreso previsto"
          value={formatCurrency(kpis.ingresoPrevisto)}
          pill={<DeltaPill current={kpis.ingresoPrevisto} delta={kpis.deltas.ingresoPrevisto} />}
          sub="vs mes anterior"
        />
        <StatCard label="Cobrado" value={formatCurrency(kpis.cobrado)} sub={`${collectionPct}% del previsto`} />
        <StatCard
          label="Gastos"
          value={formatCurrency(kpis.gastos)}
          pill={<DeltaPill current={kpis.gastos} delta={kpis.deltas.gastos} invert />}
          sub="mensualizado · vs mes anterior"
        />
        <StatCard
          label="Margen"
          value={formatCurrency(kpis.margen)}
          valueClass={kpis.margen < 0 ? 'text-rose-600' : 'text-gray-900'}
          sub={extra?.marginPct != null ? `mensualizado · ${extra.marginPct.toFixed(0)}% del ingreso` : 'mensualizado · Ingreso − Gastos'}
        />
      </div>

      {/* tira secundaria de apoyo — discreta, sin competir con el P&L */}
      <div className="flex flex-wrap items-center gap-x-8 gap-y-2 rounded-2xl border border-gray-100 bg-white px-5 py-3">
        <MiniStat label="Pendiente de cobro" value={formatCurrency(extra?.pendingCollection ?? 0)} />
        <MiniStat label="Costo laboral" value={laborPct == null ? '—' : `${laborPct.toFixed(0)}%`} />
        <MiniStat label="IVA a remitir" value={formatCurrency(extra?.ivaToRemit ?? 0)} />
      </div>
    </div>
  )
}
