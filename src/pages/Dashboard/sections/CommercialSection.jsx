import { useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight } from 'iconoir-react'
import Card from '../../../components/ui/Card'
import StatCard from '../charts/StatCard'
import MetricTabs from '../charts/MetricTabs'
import BreakdownBars from '../charts/BreakdownBars'
import DonutChart from '../charts/DonutChart'
import GroupedBars from '../charts/GroupedBars'
import { getClients } from '../../../services/clients/clientService'
import { getPlanPricing } from '../../../services/pricing/pricingService'
import { getBillingBreakdown } from '../../../services/dashboard/dashboardService'
import { baseComposition, mrrTotal, flowSeries, churnKpis, bajasByReason } from '../../../services/dashboard/commercialStats'
import { formatCurrency } from '../../../utils/format'

const DIM_OPTIONS = [
  { value: 'frequency', label: 'Plan' },
  { value: 'schedule', label: 'Horario' },
  { value: 'cognitiveLevel', label: 'Tier' }
]

const CAT_PALETTE = ['#4f46e5', '#0d9488', '#d97706', '#db2777', '#7c3aed']
const TIER_COLORS = { A: '#16a34a', B: '#2563eb', C: '#d97706', D: '#dc2626' }
const SCHEDULE_LABELS = { morning: 'Mañana', afternoon: 'Tarde', full_day: 'Día completo' }

const dimLabel = (dim, key) => {
  if (dim === 'frequency') return `${key}× semana`
  if (dim === 'schedule') return SCHEDULE_LABELS[key] || key
  return `Tier ${key}`
}
const dimColor = (dim, key, i) => (dim === 'cognitiveLevel' ? (TIER_COLORS[key] || '#94a3b8') : CAT_PALETTE[i % CAT_PALETTE.length])

// Aporte a la facturación por dimensión: pivotea las filas por cliente sumando el
// total bruto (asistencia + transporte) del segmento elegido.
function billingMix(rows, dim) {
  const map = new Map()
  for (const r of rows) {
    const key = r[dim]
    if (key == null) continue
    const total = (r.attendanceGross || 0) + (r.transportGross || 0)
    map.set(key, (map.get(key) || 0) + total)
  }
  return [...map.entries()]
    .map(([key, value], i) => ({ label: dimLabel(dim, key), value, color: dimColor(dim, key, i) }))
    .sort((a, b) => b.value - a.value)
}

export default function CommercialSection({ selected }) {
  const [clients, setClients] = useState([])
  const [pricing, setPricing] = useState([])
  const [billing, setBilling] = useState([])
  const [loading, setLoading] = useState(true)
  const [compDim, setCompDim] = useState('frequency')
  const [mixDim, setMixDim] = useState('frequency')

  useEffect(() => {
    let alive = true
    Promise.all([getClients({ includeDeleted: true }), getPlanPricing()])
      // Charity clients are excluded from all commercial metrics (MRR, altas/bajas, base).
      .then(([cs, pr]) => { if (alive) { setClients(cs.filter(c => !c.isCharity)); setPricing(pr) } })
      .catch(() => { if (alive) { setClients([]); setPricing([]) } })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [])

  useEffect(() => {
    let alive = true
    getBillingBreakdown(selected.year, selected.month)
      .then(rows => { if (alive) setBilling(rows) })
      .catch(() => { if (alive) setBilling([]) })
    return () => { alive = false }
  }, [selected])

  const kpis = useMemo(() => churnKpis(clients, selected.year, selected.month, pricing), [clients, selected, pricing])
  const mrr = useMemo(() => mrrTotal(clients, pricing), [clients, pricing])
  const composition = useMemo(() => baseComposition(clients, compDim), [clients, compDim])
  const mix = useMemo(() => billingMix(billing, mixDim), [billing, mixDim])
  const flow = useMemo(() => {
    const s = flowSeries(clients, 12, selected.year, selected.month)
    return s.map(p => ({ label: p.label, a: p.altas, b: p.bajas }))
  }, [clients, selected])
  const reasons = useMemo(() => {
    const from = new Date(selected.year, selected.month - 11, 1)
    return bajasByReason(clients, from.getFullYear(), from.getMonth(), selected.year, selected.month)
      .map(r => ({ label: r.label, value: r.value, color: r.color }))
  }, [clients, selected])

  const compTotal = composition.reduce((s, r) => s + r.value, 0)

  if (loading) {
    return <div className="flex items-center justify-center py-32 text-gray-400 text-sm">Cargando datos comerciales…</div>
  }

  return (
    <div className="flex flex-col gap-6">
      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
        <StatCard label="Clientes activos" value={String(kpis.activeCount)} sub={`+${kpis.altas} altas · −${kpis.bajas} bajas`} />
        <StatCard label="MRR (previsto)" value={formatCurrency(mrr)} valueClass="text-emerald-700" sub="ingreso recurrente mensual" />
        <StatCard label="MRR ganado" value={`+${formatCurrency(kpis.mrrGained)}`} valueClass="text-emerald-700" sub={`${kpis.altas} altas del mes`} />
        <StatCard label="MRR perdido" value={`−${formatCurrency(kpis.mrrLost)}`} valueClass="text-rose-600" sub={`${kpis.bajas} bajas del mes`} />
        <StatCard
          label="Churn mensual"
          value={`${kpis.churnRate.toFixed(1)}%`}
          valueClass={kpis.churnRate <= 2 ? 'text-emerald-700' : kpis.churnRate <= 5 ? 'text-amber-600' : 'text-rose-600'}
          sub="bajas / base inicial"
        />
        <StatCard label="Permanencia media" value={`${Math.round(kpis.avgTenureMonths)} m`} sub="meses por cliente" />
      </div>

      {/* composición + mix */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        <Card className="rounded-2xl border-gray-100 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
          <div className="px-5 pt-5 pb-4 flex items-start justify-between gap-3">
            <div>
              <h3 className="text-[15px] font-semibold text-gray-900">Composición de la base</h3>
              <p className="text-xs text-gray-400 mt-0.5">{compTotal} clientes activos</p>
            </div>
            <MetricTabs options={DIM_OPTIONS} value={compDim} onChange={setCompDim} />
          </div>
          <div className="px-5 pb-5 flex flex-wrap items-center gap-6">
            <div className="w-[170px] shrink-0"><DonutChart rows={composition} centerLabel="clientes" /></div>
            <div className="flex flex-col gap-2 min-w-0">
              {composition.map(r => (
                <div key={r.key} className="flex items-center gap-2 text-[13px] text-gray-700">
                  <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: r.color }} />
                  {r.label}
                  <span className="text-gray-400">{r.value} · {compTotal ? Math.round(r.value / compTotal * 100) : 0}%</span>
                </div>
              ))}
            </div>
          </div>
        </Card>

        <Card className="rounded-2xl border-gray-100 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
          <div className="px-5 pt-5 pb-4 flex items-start justify-between gap-3">
            <div>
              <h3 className="text-[15px] font-semibold text-gray-900">Aporte a la facturación</h3>
              <p className="text-xs text-gray-400 mt-0.5">Qué segmentos facturan más</p>
            </div>
            <MetricTabs options={DIM_OPTIONS} value={mixDim} onChange={setMixDim} />
          </div>
          <div className="px-5 pb-5">
            {mix.length === 0
              ? <p className="text-sm text-gray-400 py-8 text-center">Sin facturación para este mes.</p>
              : <BreakdownBars rows={mix} money showPct />}
          </div>
        </Card>
      </div>

      {/* altas/bajas + motivos */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        <Card className="rounded-2xl border-gray-100 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
          <div className="px-5 pt-5 pb-4">
            <h3 className="text-[15px] font-semibold text-gray-900">Altas vs Bajas</h3>
            <p className="text-xs text-gray-400 mt-0.5">Movimiento de clientes · últimos 12 meses</p>
          </div>
          <div className="px-5 pb-5">
            <GroupedBars data={flow} aColor="#4f46e5" bColor="#e11d48" />
            <div className="flex flex-wrap gap-4 mt-3">
              <span className="flex items-center gap-2 text-[12.5px] text-gray-600"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: '#4f46e5' }} />Altas</span>
              <span className="flex items-center gap-2 text-[12.5px] text-gray-600"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: '#e11d48' }} />Bajas</span>
            </div>
          </div>
        </Card>

        <Card className="rounded-2xl border-gray-100 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
          <div className="px-5 pt-5 pb-4">
            <h3 className="text-[15px] font-semibold text-gray-900">Bajas por motivo</h3>
            <p className="text-xs text-gray-400 mt-0.5">Últimos 12 meses</p>
          </div>
          <div className="px-5 pb-5">
            {reasons.length === 0
              ? <p className="text-sm text-gray-400 py-8 text-center">Sin bajas en el período.</p>
              : <BreakdownBars rows={reasons} showPct />}
            <div className="mt-5 flex items-center gap-3 rounded-xl border border-indigo-100 bg-indigo-50 px-4 py-3">
              <span className="text-[12.5px] text-indigo-800">Gestioná la recuperación de cada baja en el módulo dedicado.</span>
              <Link to="/bajas" className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-[12.5px] font-semibold text-white hover:bg-indigo-700 whitespace-nowrap">
                Ver seguimiento <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
          </div>
        </Card>
      </div>
    </div>
  )
}
