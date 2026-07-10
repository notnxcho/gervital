import { useState, useMemo, useRef, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { NavArrowRight, Percentage } from 'iconoir-react'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import Card from '../../components/ui/Card'
import SemiCircleGauge from './SemiCircleGauge'
import { formatCurrency, formatCompact } from '../../utils/format'
import { promoCashRow } from '../../services/promotions/promotionsView'

const DOMAINS = [
  { id: 'cobranza', label: 'Cobranza' },
  { id: 'facturacion', label: 'Facturación' }
]

// Vistas de solo lectura (histórico, sin acción masiva)
const READONLY_TABS = ['cobrados', 'emitidas']

const formatInvoiceDate = (d) => {
  if (!d) return '—'
  const s = String(d)
  // date-only ('YYYY-MM-DD') se parsea en local para no correrse un día por timezone
  const dt = s.length === 10 ? new Date(`${s}T00:00:00`) : new Date(s)
  return format(dt, "d MMM yyyy", { locale: es })
}

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

export default function CollectionPanel({ rows, loading, kpis, onBulkAction, canAct }) {
  const [domain, setDomain] = useState('cobranza')
  const [pending, setPending] = useState(true)
  // Dominio (Cobranza/Facturación) × estado (Pendientes/Hechas) → las 4 combinaciones
  const tab = domain === 'cobranza'
    ? (pending ? 'pagos' : 'cobrados')
    : (pending ? 'facturas' : 'emitidas')
  const doneLabel = domain === 'cobranza' ? 'Cobrados' : 'Emitidas'
  const navigate = useNavigate()

  const list = useMemo(() => {
    if (tab === 'emitidas') {
      return (rows || [])
        .filter(r => r.invoiceStatus === 'invoiced')
        .sort((a, b) => String(b.invoiceDate || b.invoicedAt || '').localeCompare(String(a.invoiceDate || a.invoicedAt || '')))
    }
    if (tab === 'cobrados') {
      return (rows || [])
        .filter(r => r.paymentStatus === 'paid')
        .sort((a, b) => String(b.paidDate || '').localeCompare(String(a.paidDate || '')))
    }
    const filtered = (rows || []).filter(r =>
      tab === 'pagos' ? r.paymentStatus !== 'paid' : r.invoiceStatus !== 'invoiced'
    )
    return filtered.sort((a, b) => b.amount - a.amount)
  }, [rows, tab])

  const rowAmount = (r) => (tab === 'emitidas' ? r.invoicedAmount : tab === 'cobrados' ? r.cashCollected : r.amount)
  const totalPending = list.reduce((s, r) => s + rowAmount(r), 0)

  // La difuminación inferior se apaga cuando el scroll llega al final (o no hay overflow),
  // así el último item queda legible.
  const listRef = useRef(null)
  const [atBottom, setAtBottom] = useState(true)
  const syncFade = useCallback(() => {
    const el = listRef.current
    if (!el) return
    setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight <= 1)
  }, [])
  useEffect(() => { syncFade() }, [syncFade, list, tab])

  const pct = kpis && kpis.ingresoPrevisto > 0 ? (kpis.cobrado / kpis.ingresoPrevisto) * 100 : 0

  return (
    <Card className="rounded-2xl border-gray-100 shadow-[0_1px_2px_rgba(16,24,40,0.04)] flex flex-col xl:h-full overflow-hidden">
      {/* header */}
      <div className="px-5 pt-5 pb-3 border-b border-gray-100">
        <div className="flex items-center justify-between">
          <h2 className="text-[15px] font-bold text-gray-900">Cobranza</h2>
          <button
            type="button"
            onClick={() => setPending(p => !p)}
            className="flex items-center gap-2"
            title="Alternar pendientes / hechas"
          >
            <span className={`text-[11px] font-semibold ${pending ? 'text-amber-600' : 'text-emerald-600'}`}>
              {pending ? 'Pendientes' : doneLabel}
            </span>
            <span className={`relative inline-flex h-4 w-7 items-center rounded-full transition-colors ${pending ? 'bg-gray-300' : 'bg-emerald-500'}`}>
              <span className={`inline-block h-3 w-3 transform rounded-full bg-white shadow transition-transform ${pending ? 'translate-x-0.5' : 'translate-x-3.5'}`} />
            </span>
          </button>
        </div>

        {/* segmented tabs */}
        <div className="mt-3 inline-flex w-full bg-gray-100 rounded-xl p-0.5">
          {DOMAINS.map(d => (
            <button
              key={d.id}
              onClick={() => setDomain(d.id)}
              className={`flex-1 text-xs font-semibold py-1.5 rounded-lg transition-colors ${
                domain === d.id ? 'bg-white text-emerald-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {d.label}
            </button>
          ))}
        </div>

        <div className="flex items-center justify-between mt-3">
          <span className="text-[11px] text-gray-400">
            {tab === 'emitidas'
              ? `${list.length} ${list.length === 1 ? 'factura' : 'facturas'}`
              : tab === 'cobrados'
                ? `${list.length} ${list.length === 1 ? 'cobro' : 'cobros'}`
                : `${list.length} ${list.length === 1 ? 'cliente' : 'clientes'}`}
          </span>
          <span className="text-xs font-semibold tabular-nums text-gray-700">
            {formatCurrency(totalPending)}
          </span>
        </div>
      </div>

      {/* list — on xl it scrolls inside the column and fades behind the footer;
          when stacked it grows naturally and the whole page scrolls */}
      <div
        ref={listRef}
        onScroll={syncFade}
        className={`xl:flex-1 xl:min-h-0 xl:overflow-y-auto scrollbar-thin divide-y divide-gray-50 ${atBottom ? '' : 'dashboard-list-fade'}`}
      >
        {loading ? (
          <div className="px-5 py-10 text-center text-sm text-gray-400">Cargando…</div>
        ) : list.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-5 py-12 text-center">
            <div className="w-10 h-10 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center mb-2 text-lg">✓</div>
            <p className="text-sm font-medium text-gray-600">
              {tab === 'emitidas' ? 'Sin facturas emitidas' : tab === 'cobrados' ? 'Sin cobros' : 'Todo al día'}
            </p>
            <p className="text-xs text-gray-400 mt-0.5">
              {tab === 'pagos'
                ? 'Sin pagos pendientes este mes'
                : tab === 'cobrados'
                  ? 'Ningún cobro registrado este mes'
                  : tab === 'facturas'
                    ? 'Todas las facturas emitidas'
                    : 'Ninguna factura emitida este mes'}
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
                <p className="text-sm font-medium text-gray-800 truncate flex items-center gap-1.5">
                  <span className="truncate">{r.firstName} {r.lastName}</span>
                  {r.isDeactivated && <span className="text-[10px] font-normal text-gray-400 flex-shrink-0">(baja)</span>}
                  {domain === 'cobranza' && r.promoTotal != null && (
                    <span
                      className="inline-flex items-center gap-0.5 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[11px] font-semibold text-emerald-700 flex-shrink-0"
                      title={`Promoción${r.promoPercent != null ? ' ' + r.promoPercent + '%' : ''} · mes ${r.promoIndex} de ${r.promoTotal}`}
                    >
                      <Percentage width={11} height={11} />
                      {r.promoIndex}/{r.promoTotal}
                    </span>
                  )}
                </p>
                <p className="text-[11px] text-gray-400">
                  {tab === 'pagos'
                    ? 'Pago pendiente'
                    : tab === 'cobrados'
                      ? `Cobrado · ${formatInvoiceDate(r.paidDate)}`
                      : tab === 'facturas'
                        ? 'Sin factura electrónica'
                        : `${r.invoiceNumber || 's/n'} · ${formatInvoiceDate(r.invoiceDate || r.invoicedAt)}`}
                </p>
              </div>
              {(() => {
                const promo = promoCashRow(r)
                if (tab === 'cobrados' && promo.struck) {
                  return (
                    <span className="flex items-center gap-1.5 tabular-nums flex-shrink-0">
                      <span className="text-xs text-gray-400 line-through opacity-60">{formatCurrency(promo.notional)}</span>
                      <span className="text-sm font-semibold text-gray-900">{formatCurrency(0)}</span>
                    </span>
                  )
                }
                return <span className="text-sm font-semibold tabular-nums text-gray-900">{formatCurrency(rowAmount(r))}</span>
              })()}
              <NavArrowRight className="w-4 h-4 text-gray-300 group-hover:text-gray-500 transition-colors flex-shrink-0" />
            </button>
          ))
        )}
      </div>

      {/* fixed footer: bulk CTA + gauge */}
      <div className="border-t border-gray-100 bg-gray-50/60 px-5 py-4 flex-shrink-0">
        {canAct && onBulkAction && !READONLY_TABS.includes(tab) && (
          <button
            type="button"
            onClick={() => onBulkAction(tab === 'pagos' ? 'pay' : 'emit')}
            disabled={list.length === 0}
            className="w-full mb-4 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {tab === 'pagos' ? 'Marcar cobrado' : 'Facturar el mes'}
          </button>
        )}
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
