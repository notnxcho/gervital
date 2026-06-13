import { useState, useMemo, useEffect } from 'react'
import Card from '../../components/ui/Card'
import { formatCurrency, formatCompact } from '../../services/dashboard/format'
import { selectIncome, selectExpensesTotal, selectMargin } from '../../services/dashboard/financeSeries'

const MONTH_LABELS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
const RANGES = [{ id: 6, label: '6M' }, { id: 12, label: '12M' }, { id: 24, label: '24M' }]

const SERIES_KEYS = [
  { key: 'asistencia', label: 'Asistencia', color: '#34d399' },
  { key: 'transporte', label: 'Transporte', color: '#10b981' },
  { key: 'gastos', label: 'Gastos', color: '#f87171' },
  { key: 'sueldos', label: 'Sueldos', color: '#a78bfa' },
  { key: 'margen', label: 'Margen', color: '#6366f1' }
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

export default function MonthlyFinanceChart({ series, selected, onSelectMonth, onOptionsChange }) {
  const [range, setRange] = useState(12)
  const [basis, setBasis] = useState('previsto')
  const [withIva, setWithIva] = useState(false)
  const [type, setType] = useState('bars')
  const [active, setActive] = useState({ asistencia: true, transporte: true, gastos: true, sueldos: false, margen: true })

  // Keep KPI row in sync with the income toggles.
  useEffect(() => {
    onOptionsChange?.({ basis, withIva })
  }, [basis, withIva, onOptionsChange])

  const opts = { basis, withIva }
  const data = useMemo(() => (series || []).slice(-range), [series, range])

  const visibleIncome = row =>
    (active.asistencia ? incomePart(row, 'asistencia', withIva, basis) : 0) +
    (active.transporte ? incomePart(row, 'transporte', withIva, basis) : 0)

  const visibleExpense = row =>
    (active.gastos ? row.expenses : 0) +
    (active.sueldos ? row.salaries : 0)

  const maxVal = useMemo(() => {
    let m = 1
    for (const row of data) {
      m = Math.max(m, visibleIncome(row), visibleExpense(row))
    }
    return m
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, basis, withIva, active])

  const H = 170 // chart body px
  const y = v => Math.max(2, (v / maxVal) * H)

  const toggleSeries = k => setActive(a => ({ ...a, [k]: !a[k] }))

  // Margin line points for SVG overlay — percentage-based x so it scales with flex layout.
  const marginPts = data.map((row, i) => {
    const x = (i + 0.5) / data.length * 100
    const marginVal = selectMargin(row, opts)
    // Clamp negative margin to bottom of chart area.
    const yy = H - Math.max(0, y(marginVal))
    return `${x},${yy}`
  }).join(' ')

  // Y-axis ticks: 0, 50%, 100% of maxVal.
  const yTicks = [maxVal, maxVal / 2, 0]

  return (
    <Card>
      {/* header + controls */}
      <div className="flex items-start justify-between gap-4 flex-wrap px-6 pt-5">
        <div>
          <h2 className="text-base font-bold text-gray-900">Ingresos vs Gastos</h2>
          <p className="text-xs text-gray-400 mt-0.5">
            últimos {range} meses · pesos uruguayos · {withIva ? 'con IVA' : 'sin IVA'}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Segmented options={RANGES.map(r => ({ id: r.id, label: r.label }))} value={range} onChange={setRange} />
          <Segmented options={[{ id: 'previsto', label: 'Previsto' }, { id: 'cobrado', label: 'Cobrado' }]} value={basis} onChange={setBasis} />
          <Segmented options={[{ id: false, label: 'Sin IVA' }, { id: true, label: 'Con IVA' }]} value={withIva} onChange={setWithIva} />
          <Segmented options={[{ id: 'bars', label: 'Barras' }, { id: 'lines', label: 'Líneas' }]} value={type} onChange={setType} />
        </div>
      </div>

      {/* series chips */}
      <div className="flex gap-2 flex-wrap px-6 pt-3">
        {SERIES_KEYS.map(s => (
          <button
            key={s.key}
            onClick={() => toggleSeries(s.key)}
            className={`inline-flex items-center gap-2 text-xs font-semibold rounded-full border px-3 py-1.5 transition-opacity ${active[s.key] ? 'opacity-100' : 'opacity-40'} border-gray-100 bg-gray-50 text-gray-700`}
          >
            <span className="w-2.5 h-2.5 rounded-sm" style={{ background: s.color }} />
            {s.label}
          </button>
        ))}
      </div>

      {/* chart body */}
      <div className="relative px-6 pt-6 pb-4">
        <div className="flex gap-3">
          {/* y-axis tick labels */}
          <div className="flex flex-col justify-between pb-6" style={{ height: H + 24 }}>
            {yTicks.map(tick => (
              <span key={tick} className="text-[10px] text-gray-300 leading-none text-right w-8">
                {formatCompact(tick)}
              </span>
            ))}
          </div>

          {/* bars + margin overlay */}
          <div className="flex-1 relative" style={{ height: H + 24 }}>
            {/* margin line overlay (shown in both modes when active) */}
            {active.margen && (
              <svg
                className="absolute inset-0 pointer-events-none"
                style={{ width: '100%', height: H }}
                viewBox="0 0 100 170"
                preserveAspectRatio="none"
              >
                <polyline
                  points={marginPts}
                  fill="none"
                  stroke="#6366f1"
                  strokeWidth="1.5"
                  vectorEffect="non-scaling-stroke"
                />
              </svg>
            )}

            {/* column bars (hidden in lines mode) */}
            <div
              className="flex items-end gap-3 relative"
              style={{ height: H + 24, opacity: type === 'lines' ? 0 : 1, transition: 'opacity 0.2s' }}
            >
              {data.map((row) => {
                const isSel = selected && row.year === selected.year && row.month === selected.month
                const asis = active.asistencia ? incomePart(row, 'asistencia', withIva, basis) : 0
                const trans = active.transporte ? incomePart(row, 'transporte', withIva, basis) : 0
                const exp = active.gastos ? row.expenses : 0
                const sue = active.sueldos ? row.salaries : 0
                return (
                  <button
                    key={`${row.year}-${row.month}`}
                    onClick={() => onSelectMonth?.({ year: row.year, month: row.month })}
                    className="flex-1 flex flex-col items-center gap-1.5 group"
                    style={type === 'lines' ? { pointerEvents: 'none' } : undefined}
                    title={`${MONTH_LABELS[row.month]} ${row.year}\nIngreso: ${formatCurrency(selectIncome(row, opts))}\nGastos: ${formatCurrency(selectExpensesTotal(row))}\nMargen: ${formatCurrency(selectMargin(row, opts))}`}
                  >
                    <div className="flex items-end gap-1" style={{ height: H }}>
                      {/* income bar: stacked asistencia + transporte */}
                      <div className="w-3.5 flex flex-col justify-end">
                        <div style={{ height: y(trans), background: '#10b981' }} className="rounded-t-sm" />
                        <div style={{ height: y(asis), background: '#34d399' }} />
                      </div>
                      {/* expense bar: stacked gastos + sueldos */}
                      <div className="w-3.5 flex flex-col justify-end">
                        <div style={{ height: y(sue), background: '#a78bfa' }} className="rounded-t-sm" />
                        <div style={{ height: y(exp), background: '#f87171' }} />
                      </div>
                    </div>
                    <span className={`text-[11px] ${isSel ? 'text-indigo-600 font-bold' : 'text-gray-400'}`}>
                      {MONTH_LABELS[row.month]}
                    </span>
                  </button>
                )
              })}
            </div>

            {/* lines mode: show only month labels + margin dot markers */}
            {type === 'lines' && (
              <div className="absolute bottom-0 left-0 right-0 flex items-end gap-3" style={{ height: H + 24 }}>
                {data.map((row) => {
                  const isSel = selected && row.year === selected.year && row.month === selected.month
                  return (
                    <button
                      key={`line-${row.year}-${row.month}`}
                      onClick={() => onSelectMonth?.({ year: row.year, month: row.month })}
                      className="flex-1 flex flex-col items-center gap-1.5"
                      title={`${MONTH_LABELS[row.month]} ${row.year}\nIngreso: ${formatCurrency(selectIncome(row, opts))}\nGastos: ${formatCurrency(selectExpensesTotal(row))}\nMargen: ${formatCurrency(selectMargin(row, opts))}`}
                    >
                      <div style={{ height: H }} />
                      <span className={`text-[11px] ${isSel ? 'text-indigo-600 font-bold' : 'text-gray-400'}`}>
                        {MONTH_LABELS[row.month]}
                      </span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        <p className="text-[11px] text-gray-400 mt-2">
          Clic en un mes para verlo en los KPIs. IVA aplica a ingresos; los gastos se muestran como registrados.
        </p>
      </div>
    </Card>
  )
}

function Segmented({ options, value, onChange }) {
  return (
    <div className="inline-flex bg-gray-100 rounded-lg p-0.5">
      {options.map(o => (
        <button
          key={String(o.id)}
          onClick={() => onChange(o.id)}
          className={`text-xs font-semibold px-3 py-1.5 rounded-md transition-colors ${String(value) === String(o.id) ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-500'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
