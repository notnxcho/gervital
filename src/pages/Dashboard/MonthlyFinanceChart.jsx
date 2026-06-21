import { useState, useMemo, useEffect } from 'react'
import Card from '../../components/ui/Card'
import { formatCurrency, formatCompact } from '../../utils/format'
import { selectIncome, selectExpensesTotal, selectMargin } from '../../services/dashboard/financeSeries'

const MONTH_LABELS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
const RANGES = [{ id: 6, label: '6M' }, { id: 12, label: '12M' }, { id: 24, label: '24M' }]

// Income = emerald, expenses = slate (calm), margin trend = ink. Selected month
// pops while the rest stay muted — the focal-bar pattern from the references.
const COLORS = {
  asistencia: '#34d399',
  transporte: '#059669',
  gastos: '#cbd5e1',
  sueldos: '#94a3b8',
  margen: '#334155'
}

const SERIES_KEYS = [
  { key: 'asistencia', label: 'Asistencia', color: COLORS.asistencia },
  { key: 'transporte', label: 'Transporte', color: COLORS.transporte },
  { key: 'gastos', label: 'Gastos', color: COLORS.gastos },
  { key: 'sueldos', label: 'Sueldos', color: COLORS.sueldos },
  { key: 'margen', label: 'Margen', color: COLORS.margen }
]

function incomePart(row, part, withIva, basis) {
  const net = basis === 'cobrado'
    ? (part === 'asistencia' ? row.paidAttendanceNet : row.paidTransportNet)
    : (part === 'asistencia' ? row.attendanceNet : row.transportNet)
  const gross = basis === 'cobrado'
    ? (part === 'asistencia' ? row.paidAttendanceGross : row.paidTransportGross)
    : (part === 'asistencia' ? row.attendanceGross : row.transportGross)
  return withIva ? gross : net
}

// Smooth cubic path through points {x,y} (Catmull-Rom → bezier).
function smoothPath(pts) {
  if (!pts.length) return ''
  if (pts.length === 1) return `M ${pts[0].x} ${pts[0].y}`
  const d = [`M ${pts[0].x} ${pts[0].y}`]
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i === 0 ? 0 : i - 1]
    const p1 = pts[i]
    const p2 = pts[i + 1]
    const p3 = pts[i + 2 < pts.length ? i + 2 : i + 1]
    const cp1x = p1.x + (p2.x - p0.x) / 6
    const cp1y = p1.y + (p2.y - p0.y) / 6
    const cp2x = p2.x - (p3.x - p1.x) / 6
    const cp2y = p2.y - (p3.y - p1.y) / 6
    d.push(`C ${cp1x.toFixed(2)} ${cp1y.toFixed(2)} ${cp2x.toFixed(2)} ${cp2y.toFixed(2)} ${p2.x} ${p2.y}`)
  }
  return d.join(' ')
}

export default function MonthlyFinanceChart({ series, selected, onSelectMonth, onOptionsChange }) {
  const [range, setRange] = useState(12)
  const [basis, setBasis] = useState('previsto')
  const [withIva, setWithIva] = useState(false)
  const [active, setActive] = useState({ asistencia: true, transporte: true, gastos: true, sueldos: false, margen: true })
  const [hover, setHover] = useState(null) // hovered month index within `data`

  // Keep KPI row in sync with the income toggles.
  useEffect(() => {
    onOptionsChange?.({ basis, withIva })
  }, [basis, withIva, onOptionsChange])

  const opts = useMemo(() => ({ basis, withIva }), [basis, withIva])
  const data = useMemo(() => (series || []).slice(-range), [series, range])

  const maxVal = useMemo(() => {
    const vi = row =>
      (active.asistencia ? incomePart(row, 'asistencia', withIva, basis) : 0) +
      (active.transporte ? incomePart(row, 'transporte', withIva, basis) : 0)
    const ve = row =>
      (active.gastos ? row.expenses : 0) + (active.sueldos ? row.salaries : 0)
    let m = 1
    for (const row of data) m = Math.max(m, vi(row), ve(row))
    return m
  }, [data, basis, withIva, active])

  const H = 184
  const y = v => Math.max(0, (v / maxVal) * H)

  const toggleSeries = k => setActive(a => ({ ...a, [k]: !a[k] }))

  // Focal figure: margin of the selected month + delta vs the previous month in the full series.
  const focal = useMemo(() => {
    if (!selected) return null
    const idx = series.findIndex(r => r.year === selected.year && r.month === selected.month)
    if (idx < 0) return null
    const cur = series[idx]
    const prev = idx > 0 ? series[idx - 1] : null
    const margin = selectMargin(cur, opts)
    const delta = prev ? margin - selectMargin(prev, opts) : null
    return { margin, delta }
  }, [series, selected, opts])

  // Margin trend points (percentage x so the SVG scales with the flex layout).
  const marginPts = data.map((row, i) => ({
    x: data.length > 1 ? (i / (data.length - 1)) * 100 : 50,
    y: H - Math.min(H, Math.max(0, y(selectMargin(row, opts))))
  }))
  const marginD = smoothPath(marginPts)

  const yTicks = [maxVal, maxVal * 0.66, maxVal * 0.33, 0]
  const tipIndex = hover != null ? hover : data.findIndex(r => selected && r.year === selected.year && r.month === selected.month)
  const tipRow = tipIndex >= 0 ? data[tipIndex] : null

  return (
    <Card className="rounded-2xl border-gray-100 shadow-[0_1px_2px_rgba(16,24,40,0.04)] overflow-hidden">
      {/* header: title + focal figure */}
      <div className="flex items-start justify-between gap-4 px-6 pt-5">
        <div>
          <h2 className="text-[15px] font-bold text-gray-900">Ingresos vs Gastos</h2>
          <p className="text-xs text-gray-400 mt-0.5">
            últimos {range} meses · {withIva ? 'con IVA' : 'sin IVA'} · {basis === 'cobrado' ? 'cobrado' : 'previsto'}
          </p>
        </div>
        {focal && (
          <div className="text-right">
            <p className="text-[11px] text-gray-400 capitalize">Margen · {MONTH_LABELS[selected.month]}</p>
            <div className="flex items-center justify-end gap-2 mt-0.5">
              <span className={`text-2xl font-semibold tracking-tight tabular-nums ${focal.margin >= 0 ? 'text-gray-900' : 'text-rose-600'}`}>
                {formatCurrency(focal.margin)}
              </span>
              {focal.delta != null && (
                <span className={`text-[11px] font-semibold px-1.5 py-0.5 rounded-md ${focal.delta >= 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-600'}`}>
                  {focal.delta >= 0 ? '↑' : '↓'} {formatCompact(Math.abs(focal.delta))}
                </span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* controls */}
      <div className="flex items-center gap-2 flex-wrap px-6 pt-4">
        <Segmented options={RANGES} value={range} onChange={setRange} />
        <Segmented options={[{ id: 'previsto', label: 'Previsto' }, { id: 'cobrado', label: 'Cobrado' }]} value={basis} onChange={setBasis} />
        <Segmented options={[{ id: false, label: 'Sin IVA' }, { id: true, label: 'Con IVA' }]} value={withIva} onChange={setWithIva} />
      </div>

      {/* chart body */}
      <div className="px-6 pt-6 pb-3">
        <div className="flex gap-3">
          {/* y-axis labels */}
          <div className="flex flex-col justify-between pb-6 w-9 flex-shrink-0" style={{ height: H + 24 }}>
            {yTicks.map((tick, i) => (
              <span key={i} className="text-[10px] text-gray-300 leading-none text-right tabular-nums">
                {formatCompact(tick)}
              </span>
            ))}
          </div>

          {/* plot area */}
          <div className="flex-1 relative" style={{ height: H + 24 }}>
            {/* dashed gridlines */}
            <div className="absolute left-0 right-0" style={{ top: 0, height: H }}>
              {yTicks.map((_, i) => (
                <div
                  key={i}
                  className="absolute left-0 right-0 border-t border-dashed border-gray-100"
                  style={{ top: `${(i / (yTicks.length - 1)) * 100}%` }}
                />
              ))}
            </div>

            {/* margin trend line */}
            {active.margen && marginPts.length > 1 && (
              <svg
                className="absolute left-0 pointer-events-none"
                style={{ top: 0, width: '100%', height: H, overflow: 'visible' }}
                viewBox={`0 0 100 ${H}`}
                preserveAspectRatio="none"
              >
                <path d={marginD} fill="none" stroke={COLORS.margen} strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}

            {/* bars */}
            <div className="absolute left-0 right-0 flex items-end gap-2" style={{ top: 0, height: H }}>
              {data.map((row, i) => {
                const isSel = selected && row.year === selected.year && row.month === selected.month
                const isHover = hover === i
                const asis = active.asistencia ? incomePart(row, 'asistencia', withIva, basis) : 0
                const trans = active.transporte ? incomePart(row, 'transporte', withIva, basis) : 0
                const exp = active.gastos ? row.expenses : 0
                const sue = active.sueldos ? row.salaries : 0
                const opacity = isSel ? 1 : isHover ? 0.85 : 0.4
                return (
                  <button
                    key={`${row.year}-${row.month}`}
                    onClick={() => onSelectMonth?.({ year: row.year, month: row.month })}
                    onMouseEnter={() => setHover(i)}
                    onMouseLeave={() => setHover(null)}
                    className="flex-1 h-full flex items-end justify-center gap-1 group"
                  >
                    <div className="flex items-end gap-[3px]" style={{ opacity, transition: 'opacity 0.15s' }}>
                      {/* income: asistencia + transporte stacked */}
                      <div className="w-2.5 flex flex-col justify-end rounded-t-[3px] overflow-hidden">
                        <div style={{ height: y(trans), background: COLORS.transporte }} />
                        <div style={{ height: y(asis), background: COLORS.asistencia }} />
                      </div>
                      {/* expenses: gastos + sueldos stacked */}
                      <div className="w-2.5 flex flex-col justify-end rounded-t-[3px] overflow-hidden">
                        <div style={{ height: y(sue), background: COLORS.sueldos }} />
                        <div style={{ height: y(exp), background: COLORS.gastos }} />
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>

            {/* month labels */}
            <div className="absolute left-0 right-0 flex gap-2" style={{ top: H + 6 }}>
              {data.map((row) => {
                const isSel = selected && row.year === selected.year && row.month === selected.month
                return (
                  <span
                    key={`lbl-${row.year}-${row.month}`}
                    className={`flex-1 text-center text-[11px] ${isSel ? 'text-gray-900 font-semibold' : 'text-gray-400'}`}
                  >
                    {MONTH_LABELS[row.month]}
                  </span>
                )
              })}
            </div>

            {/* floating tooltip card */}
            {tipRow && (
              <div
                className="absolute z-10 pointer-events-none"
                style={{
                  left: `${((tipIndex + 0.5) / data.length) * 100}%`,
                  top: -4,
                  transform: `translateX(${tipIndex < data.length / 2 ? '-10%' : '-90%'})`
                }}
              >
                <div className="bg-white rounded-xl shadow-lg border border-gray-100 px-3 py-2 whitespace-nowrap">
                  <p className="text-[11px] font-semibold text-gray-900 capitalize mb-1">
                    {MONTH_LABELS[tipRow.month]} {tipRow.year}
                  </p>
                  <TipRow color={COLORS.asistencia} label="Ingreso" value={formatCurrency(selectIncome(tipRow, opts))} />
                  <TipRow color={COLORS.gastos} label="Gastos" value={formatCurrency(selectExpensesTotal(tipRow))} />
                  <TipRow color={COLORS.margen} label="Margen" value={formatCurrency(selectMargin(tipRow, opts))} />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* legend / series toggles */}
      <div className="flex gap-1.5 flex-wrap px-6 pb-5 pt-1">
        {SERIES_KEYS.map(s => (
          <button
            key={s.key}
            onClick={() => toggleSeries(s.key)}
            className={`inline-flex items-center gap-1.5 text-[11px] font-medium rounded-full px-2.5 py-1 transition-all ${
              active[s.key] ? 'bg-gray-50 text-gray-700' : 'text-gray-300'
            }`}
          >
            <span className="w-2 h-2 rounded-full" style={{ background: s.color, opacity: active[s.key] ? 1 : 0.4 }} />
            {s.label}
          </button>
        ))}
      </div>
    </Card>
  )
}

function TipRow({ color, label, value }) {
  return (
    <div className="flex items-center gap-2 text-[11px]">
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: color }} />
      <span className="text-gray-400 w-12">{label}</span>
      <span className="text-gray-900 font-semibold tabular-nums">{value}</span>
    </div>
  )
}

function Segmented({ options, value, onChange }) {
  return (
    <div className="inline-flex bg-gray-100 rounded-full p-0.5">
      {options.map(o => (
        <button
          key={String(o.id)}
          onClick={() => onChange(o.id)}
          className={`text-xs font-semibold px-3 py-1.5 rounded-full transition-colors ${
            String(value) === String(o.id) ? 'bg-white text-emerald-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
