import StatCard from './charts/StatCard'
import { formatCurrency, formatCompact } from '../../utils/format'

// Pill direccional a partir de un delta en $. `invert` invierte la semántica de color
// (Gastos: subir es malo). Muestra % cuando se conoce el valor previo.
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

function Group({ label, children }) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-2">{label}</p>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">{children}</div>
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

// KPIs financieros del mes, agrupados: Resultado (P&L) y Cobranza/costos.
// `kpis` = deriveKpis(); `extra` = extendedFinanceKpis().
export default function FinanceKpis({ kpis, extra }) {
  if (!kpis) return <Skeleton />

  const collectionPct = kpis.ingresoPrevisto > 0 ? Math.round((kpis.cobrado / kpis.ingresoPrevisto) * 100) : 0
  const laborPct = extra?.laborPct
  const pending = extra?.pendingCollection ?? 0

  return (
    <div className="flex flex-col gap-5">
      <Group label="Resultado del mes">
        <StatCard
          label="Ingreso previsto"
          value={formatCurrency(kpis.ingresoPrevisto)}
          pill={<DeltaPill current={kpis.ingresoPrevisto} delta={kpis.deltas.ingresoPrevisto} />}
          sub="vs mes anterior"
        />
        <StatCard label="Cobrado" value={formatCurrency(kpis.cobrado)} valueClass="text-emerald-700" sub={`${collectionPct}% del previsto`} />
        <StatCard
          label="Gastos"
          value={formatCurrency(kpis.gastos)}
          valueClass="text-rose-600"
          pill={<DeltaPill current={kpis.gastos} delta={kpis.deltas.gastos} invert />}
          sub="vs mes anterior"
        />
        <StatCard
          label="Margen"
          value={formatCurrency(kpis.margen)}
          valueClass={kpis.margen >= 0 ? 'text-emerald-700' : 'text-rose-600'}
          sub={extra?.marginPct != null ? `${extra.marginPct.toFixed(0)}% del ingreso` : 'Ingreso − Gastos'}
        />
      </Group>

      <Group label="Cobranza y costos">
        <StatCard
          label="Tasa de cobro"
          value={`${kpis.tasaCobro.toFixed(0)}%`}
          valueClass={kpis.tasaCobro >= 80 ? 'text-emerald-700' : kpis.tasaCobro >= 50 ? 'text-amber-600' : 'text-rose-600'}
          sub="cobrado / previsto"
        />
        <StatCard
          label="Pendiente de cobro"
          value={formatCurrency(pending)}
          valueClass={pending > 0 ? 'text-rose-600' : 'text-emerald-700'}
          sub="previsto − cobrado"
        />
        <StatCard
          label="Costo laboral"
          value={laborPct == null ? '—' : `${laborPct.toFixed(0)}%`}
          valueClass={laborPct == null ? 'text-gray-400' : laborPct <= 40 ? 'text-emerald-700' : laborPct <= 60 ? 'text-amber-600' : 'text-rose-600'}
          sub="sueldos / ingreso"
        />
        <StatCard label="IVA a remitir" value={formatCurrency(extra?.ivaToRemit ?? 0)} sub="bruto − neto" />
      </Group>
    </div>
  )
}
