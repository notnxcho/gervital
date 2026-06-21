import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { NavArrowRight } from 'iconoir-react'
import Card from '../../components/ui/Card'
import SemiCircleGauge from './SemiCircleGauge'
import { formatCurrency, formatCompact } from '../../services/dashboard/format'

const TABS = [
  { id: 'pagos', label: 'Pagos' },
  { id: 'facturas', label: 'Facturas' }
]

function Avatar({ firstName, lastName, avatarUrl }) {
  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt={`${firstName} ${lastName}`}
        className="w-9 h-9 rounded-full object-cover flex-shrink-0"
      />
    )
  }
  const initials = `${firstName?.[0] || ''}${lastName?.[0] || ''}`.toUpperCase()
  return (
    <div className="w-9 h-9 rounded-full bg-emerald-50 text-emerald-700 flex items-center justify-center text-xs font-semibold flex-shrink-0">
      {initials || '–'}
    </div>
  )
}

export default function CollectionPanel({ rows, loading, kpis, monthLabel }) {
  const [tab, setTab] = useState('pagos')
  const navigate = useNavigate()

  const list = useMemo(() => {
    const filtered = (rows || []).filter(r =>
      tab === 'pagos' ? r.paymentStatus !== 'paid' : r.invoiceStatus !== 'invoiced'
    )
    return filtered.sort((a, b) => b.amount - a.amount)
  }, [rows, tab])

  const totalPending = list.reduce((s, r) => s + r.amount, 0)

  const pct = kpis && kpis.ingresoPrevisto > 0 ? (kpis.cobrado / kpis.ingresoPrevisto) * 100 : 0

  return (
    <Card className="rounded-2xl border-gray-100 shadow-[0_1px_2px_rgba(16,24,40,0.04)] flex flex-col h-full overflow-hidden">
      {/* header */}
      <div className="px-5 pt-5 pb-3 border-b border-gray-100">
        <div className="flex items-baseline justify-between">
          <h2 className="text-[15px] font-bold text-gray-900">Cobranza</h2>
          <span className="text-[11px] text-gray-400 capitalize">{monthLabel}</span>
        </div>

        {/* segmented tabs */}
        <div className="mt-3 inline-flex w-full bg-gray-100 rounded-xl p-0.5">
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex-1 text-xs font-semibold py-1.5 rounded-lg transition-colors ${
                tab === t.id ? 'bg-white text-emerald-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {t.id === 'pagos' ? 'Pagos pendientes' : 'Facturas pendientes'}
            </button>
          ))}
        </div>

        <div className="flex items-center justify-between mt-3">
          <span className="text-[11px] text-gray-400">
            {list.length} {list.length === 1 ? 'cliente' : 'clientes'}
          </span>
          <span className="text-xs font-semibold tabular-nums text-gray-700">
            {formatCurrency(totalPending)}
          </span>
        </div>
      </div>

      {/* scrollable list */}
      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin divide-y divide-gray-50">
        {loading ? (
          <div className="px-5 py-10 text-center text-sm text-gray-400">Cargando…</div>
        ) : list.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-5 py-12 text-center">
            <div className="w-10 h-10 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center mb-2 text-lg">✓</div>
            <p className="text-sm font-medium text-gray-600">Todo al día</p>
            <p className="text-xs text-gray-400 mt-0.5">
              {tab === 'pagos' ? 'Sin pagos pendientes este mes' : 'Todas las facturas emitidas'}
            </p>
          </div>
        ) : (
          list.map(r => (
            <button
              key={r.id}
              onClick={() => navigate(`/clientes/${r.id}`)}
              className="w-full flex items-center gap-3 px-5 py-2.5 hover:bg-gray-50/80 transition-colors text-left group"
            >
              <Avatar firstName={r.firstName} lastName={r.lastName} avatarUrl={r.avatarUrl} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-800 truncate">
                  {r.firstName} {r.lastName}
                  {r.isDeactivated && <span className="ml-1.5 text-[10px] font-normal text-gray-400">(baja)</span>}
                </p>
                <p className="text-[11px] text-gray-400">
                  {tab === 'pagos' ? 'Pago pendiente' : 'Sin factura electrónica'}
                </p>
              </div>
              <span className="text-sm font-semibold tabular-nums text-gray-900">{formatCurrency(r.amount)}</span>
              <NavArrowRight className="w-4 h-4 text-gray-300 group-hover:text-gray-500 transition-colors flex-shrink-0" />
            </button>
          ))
        )}
      </div>

      {/* fixed gauge footer */}
      <div className="border-t border-gray-100 bg-gray-50/60 px-5 py-4 flex-shrink-0">
        <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400 text-center mb-1">
          Cobrado del mes
        </p>
        <SemiCircleGauge
          pct={pct}
          centerValue={`${pct.toFixed(0)}%`}
          centerLabel="del previsto"
          leftLabel="Cobrado"
          leftValue={formatCompact(kpis?.cobrado || 0)}
          rightLabel="Previsto"
          rightValue={formatCompact(kpis?.ingresoPrevisto || 0)}
        />
      </div>
    </Card>
  )
}
