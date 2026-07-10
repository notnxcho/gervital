import { useState, useEffect, useMemo } from 'react'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import Card from '../../../components/ui/Card'
import { formatCurrency } from '../../../utils/format'
import { getPromotions } from '../../../services/promotions/promotionService'
import { classifyPromotions, promoKpis, promoOrdinal } from '../../../services/promotions/promotionsView'

const monthLabel = (year, month) => format(new Date(year, month, 1), 'MMM yyyy', { locale: es })
const rangeLabel = (p) => `${monthLabel(p.startYear, p.startMonth)} – ${monthLabel(p.endYear, p.endMonth)}`

function Kpi({ label, value }) {
  return (
    <Card className="rounded-2xl border-gray-100 p-4">
      <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400">{label}</p>
      <p className="mt-1 text-xl font-bold text-gray-900 tabular-nums">{value}</p>
    </Card>
  )
}

function PromoRow({ p, refYear, refMonth }) {
  const ref = promoOrdinal(refYear, refMonth)
  const start = promoOrdinal(p.startYear, p.startMonth)
  const end = promoOrdinal(p.endYear, p.endMonth)
  const total = end - start + 1
  const index = Math.min(Math.max(ref - start + 1, 1), total)
  const within = ref >= start && ref <= end
  const initials = `${p.firstName?.[0] || ''}${p.lastName?.[0] || ''}`.toUpperCase()
  return (
    <div className="flex items-center gap-3 px-4 py-2.5 border-b border-gray-50 last:border-0">
      <div className="w-8 h-8 rounded-full bg-emerald-50 text-emerald-700 flex items-center justify-center text-xs font-semibold flex-shrink-0">
        {initials || '–'}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-800 truncate">{p.firstName} {p.lastName}</p>
        <p className="text-[11px] text-gray-400 capitalize">{rangeLabel(p)} · {p.discountPercent}% dto</p>
      </div>
      {within && (
        <span className="text-[11px] font-semibold text-emerald-700 bg-emerald-50 rounded-full px-2 py-0.5 tabular-nums flex-shrink-0">
          {index}/{total}
        </span>
      )}
      <span className="text-sm font-semibold tabular-nums text-gray-900 flex-shrink-0">{formatCurrency(p.paidAmount)}</span>
    </div>
  )
}

function PromoList({ title, promos, refYear, refMonth, empty }) {
  return (
    <Card className="rounded-2xl border-gray-100 overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
        <h3 className="text-sm font-bold text-gray-900">{title}</h3>
        <span className="text-[11px] text-gray-400">{promos.length}</span>
      </div>
      {promos.length === 0 ? (
        <div className="px-4 py-8 text-center text-sm text-gray-400">{empty}</div>
      ) : (
        promos.map(p => <PromoRow key={p.id} p={p} refYear={refYear} refMonth={refMonth} />)
      )}
    </Card>
  )
}

export default function PromotionsSection({ selected }) {
  const [promos, setPromos] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let alive = true
    setLoading(true)
    getPromotions()
      .then(rows => { if (alive) { setPromos(rows); setError(null) } })
      .catch(err => { if (alive) setError(err.message) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [])

  const { active, upcoming, historical } = useMemo(
    () => classifyPromotions(promos, selected.year, selected.month),
    [promos, selected]
  )
  const kpis = useMemo(
    () => promoKpis(promos, selected.year, selected.month),
    [promos, selected]
  )

  if (error) {
    return <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">Error: {error}</div>
  }
  if (loading) {
    return <div className="flex items-center justify-center py-32 text-gray-400 text-sm">Cargando promociones…</div>
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Kpi label="Promos activas" value={kpis.activeCount} />
        <Kpi label="Prepago del mes" value={formatCurrency(kpis.prepaidCashInPeriod)} />
        <Kpi label="Descuento otorgado" value={formatCurrency(kpis.totalDiscountGranted)} />
        <Kpi label="Próximas a vencer" value={kpis.upcomingCount} />
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 items-start">
        <PromoList title="Activas" promos={active} refYear={selected.year} refMonth={selected.month} empty="Sin promos activas este mes" />
        <PromoList title="Próximas a vencer" promos={upcoming} refYear={selected.year} refMonth={selected.month} empty="Ninguna por vencer" />
      </div>
      <PromoList title="Historial" promos={historical} refYear={selected.year} refMonth={selected.month} empty="Sin promos finalizadas" />
    </div>
  )
}
