import { useState, useEffect, useMemo } from 'react'
import Card from '../../../components/ui/Card'
import StatCard from '../charts/StatCard'
import MetricTabs from '../charts/MetricTabs'
import BreakdownBars from '../charts/BreakdownBars'
import TrendLine from '../charts/TrendLine'
import { getAttendanceStats } from '../../../services/dashboard/dashboardService'
import { monthKpis, breakdownByDimension, trendSeries } from '../../../services/dashboard/attendanceStats'
import { WINDOW_START, TODAY } from '../monthWindow'

const DIM_OPTIONS = [
  { value: 'frequency', label: 'Por plan' },
  { value: 'schedule', label: 'Por horario' },
  { value: 'cognitiveLevel', label: 'Por tier' }
]

const CAT_PALETTE = ['#4f46e5', '#0d9488', '#d97706', '#db2777', '#7c3aed']
const TIER_COLORS = { A: '#16a34a', B: '#2563eb', C: '#d97706', D: '#dc2626' }

const pctLabel = (rate) => (rate == null ? '—' : `${Math.round(rate * 100)}%`)

export default function AttendanceSection({ selected }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [dim, setDim] = useState('frequency')

  useEffect(() => {
    let alive = true
    setLoading(true)
    getAttendanceStats(WINDOW_START.getFullYear(), WINDOW_START.getMonth(), TODAY.getFullYear(), TODAY.getMonth())
      .then(data => { if (alive) setRows(data) })
      .catch(() => { if (alive) setRows([]) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [])

  const kpis = useMemo(() => monthKpis(rows, selected.year, selected.month), [rows, selected])

  const breakdown = useMemo(() => {
    const segs = breakdownByDimension(rows, selected.year, selected.month, dim)
    return segs.map((s, i) => ({
      label: s.label,
      value: s.rate == null ? 0 : Math.round(s.rate * 100),
      color: dim === 'cognitiveLevel' ? (TIER_COLORS[s.key] || '#94a3b8') : CAT_PALETTE[i % CAT_PALETTE.length]
    }))
  }, [rows, selected, dim])

  const trend = useMemo(() => {
    const series = trendSeries(rows, 12, selected.year, selected.month)
    return {
      points: series.map(p => (p.rate == null ? 0 : Math.round(p.rate * 100))),
      labels: series.map(p => p.label)
    }
  }, [rows, selected])

  if (loading) {
    return <div className="flex items-center justify-center py-32 text-gray-400 text-sm">Cargando asistencia…</div>
  }

  const totalAbsences = kpis.absentJustified + kpis.absentUnjustified

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          label="Tasa de asistencia"
          value={pctLabel(kpis.attendanceRate)}
          valueClass={kpis.attendanceRate == null ? 'text-gray-400'
            : kpis.attendanceRate >= 0.9 ? 'text-emerald-700'
            : kpis.attendanceRate >= 0.75 ? 'text-amber-600' : 'text-rose-600'}
          sub="asistidos / planificados"
        />
        <StatCard label="Ausencias injustificadas" value={String(kpis.absentUnjustified)} sub={`${totalAbsences} ausencias en total`} />
        <StatCard label="Ausencias justificadas" value={String(kpis.absentJustified)} sub="con o sin recupero" />
        <StatCard label="Recuperos usados" value={String(kpis.recovery)} valueClass="text-indigo-700" sub={`${kpis.vacation} días no cobrables`} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        <Card className="rounded-2xl border-gray-100 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
          <div className="px-5 pt-5 pb-4 flex items-start justify-between gap-3">
            <div>
              <h3 className="text-[15px] font-semibold text-gray-900">Tasa de asistencia por segmento</h3>
              <p className="text-xs text-gray-400 mt-0.5">Mismo mes, distintos cortes</p>
            </div>
            <MetricTabs options={DIM_OPTIONS} value={dim} onChange={setDim} />
          </div>
          <div className="px-5 pb-5">
            {breakdown.length === 0
              ? <p className="text-sm text-gray-400 py-8 text-center">Sin datos de asistencia para este mes.</p>
              : <BreakdownBars rows={breakdown} suffix="%" showPct={false} />}
          </div>
        </Card>

        <Card className="rounded-2xl border-gray-100 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
          <div className="px-5 pt-5 pb-4">
            <h3 className="text-[15px] font-semibold text-gray-900">Tendencia mensual</h3>
            <p className="text-xs text-gray-400 mt-0.5">Tasa de asistencia · últimos 12 meses</p>
          </div>
          <div className="px-5 pb-5">
            <TrendLine points={trend.points} labels={trend.labels} min={0} max={100} suffix="%" />
          </div>
        </Card>
      </div>
    </div>
  )
}
