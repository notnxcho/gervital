import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { format, subMonths, startOfMonth } from 'date-fns'
import { es } from 'date-fns/locale'
import { NavArrowLeft, NavArrowRight } from 'iconoir-react'
import MonthlyFinanceChart from './MonthlyFinanceChart'
import KpiRow from './KpiRow'
import PlaceholderCard from './PlaceholderCard'
import CollectionPanel from './CollectionPanel'
import BulkInvoiceModal from './BulkInvoiceModal'
import { getDashboardFinanceSeries, getMonthInvoicePanel } from '../../services/dashboard/dashboardService'
import { deriveKpis } from '../../services/dashboard/financeSeries'
import { useAuth } from '../../context/AuthContext'

const RANGE_MONTHS = 24 // fetch window: last 24 months ending today; the chart scrolls within it
const TODAY = startOfMonth(new Date())
const WINDOW_START = subMonths(TODAY, RANGE_MONTHS - 1) // earliest month with data in the series

// Navegación de mes en el header: chevrons (secuencial) + chip clickeable que abre
// un selector de mes/año. Solo mueve el mes seleccionado dentro de la ventana de datos.
const inWindow = (y, m) => {
  const d = new Date(y, m, 1)
  return d >= WINDOW_START && d <= TODAY
}

function MonthNavigator({ selected, onChange }) {
  const [open, setOpen] = useState(false)
  const [viewYear, setViewYear] = useState(selected.year)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const current = new Date(selected.year, selected.month, 1)
  const atMin = current <= WINDOW_START
  const atMax = current >= TODAY
  const shift = (delta) => {
    const d = new Date(selected.year, selected.month + delta, 1)
    const clamped = d < WINDOW_START ? WINDOW_START : d > TODAY ? TODAY : d
    onChange({ year: clamped.getFullYear(), month: clamped.getMonth() })
  }

  const toggle = () => { setViewYear(selected.year); setOpen(o => !o) }
  const pick = (m) => {
    if (!inWindow(viewYear, m)) return
    onChange({ year: viewYear, month: m })
    setOpen(false)
  }

  const minYear = WINDOW_START.getFullYear()
  const maxYear = TODAY.getFullYear()
  const label = format(current, 'MMMM yyyy', { locale: es })
  const chevronCls = 'flex items-center justify-center w-8 h-8 rounded-lg text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent'

  return (
    <div className="flex items-center gap-1" ref={ref}>
      <button type="button" onClick={() => shift(-1)} disabled={atMin} title="Mes anterior" className={chevronCls}>
        <NavArrowLeft className="w-5 h-5" />
      </button>

      <div className="relative">
        <button
          type="button"
          onClick={toggle}
          title="Elegir mes"
          className="flex items-center rounded-lg px-3 py-1.5 text-sm font-semibold text-gray-700 capitalize transition-colors hover:bg-gray-100"
        >
          {label}
        </button>

        {open && (
          <div className="absolute right-0 mt-2 z-20 w-64 rounded-xl border border-gray-100 bg-white p-3 shadow-lg">
            {/* año */}
            <div className="flex items-center justify-between mb-2">
              <button type="button" onClick={() => setViewYear(y => y - 1)} disabled={viewYear <= minYear} className={chevronCls}>
                <NavArrowLeft className="w-5 h-5" />
              </button>
              <span className="text-sm font-bold text-gray-800 tabular-nums">{viewYear}</span>
              <button type="button" onClick={() => setViewYear(y => y + 1)} disabled={viewYear >= maxYear} className={chevronCls}>
                <NavArrowRight className="w-5 h-5" />
              </button>
            </div>
            {/* meses */}
            <div className="grid grid-cols-3 gap-1">
              {Array.from({ length: 12 }, (_, m) => {
                const enabled = inWindow(viewYear, m)
                const isSel = selected.year === viewYear && selected.month === m
                return (
                  <button
                    key={m}
                    type="button"
                    onClick={() => pick(m)}
                    disabled={!enabled}
                    className={`px-2 py-1.5 text-xs font-medium rounded-lg capitalize transition-colors ${
                      isSel ? 'bg-emerald-600 text-white'
                        : enabled ? 'text-gray-700 hover:bg-gray-100'
                        : 'text-gray-300 cursor-not-allowed'
                    }`}
                  >
                    {format(new Date(viewYear, m, 1), 'LLL', { locale: es })}
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </div>

      <button type="button" onClick={() => shift(1)} disabled={atMax} title="Mes siguiente" className={chevronCls}>
        <NavArrowRight className="w-5 h-5" />
      </button>
    </div>
  )
}

export default function Dashboard() {
  const { hasAccess } = useAuth()
  const showFinancials = hasAccess('dashboard_financials')

  const [selected, setSelected] = useState(() => ({ year: TODAY.getFullYear(), month: TODAY.getMonth() }))
  const [series, setSeries] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [kpiOpts, setKpiOpts] = useState({ basis: 'previsto', withIva: false })

  // Collection panel rows for the selected month (per-client, separate from the series).
  const [panelRows, setPanelRows] = useState([])
  const [panelLoading, setPanelLoading] = useState(true)

  // Bulk monthly action (emit invoices / mark paid) — triggered from the collection panel.
  const [bulkOpen, setBulkOpen] = useState(false)
  const [bulkMode, setBulkMode] = useState('emit') // 'emit' | 'pay'
  const [bulkRows, setBulkRows] = useState([])

  const load = useCallback(async () => {
    if (!showFinancials) { setLoading(false); return }
    setLoading(true); setError(null)
    try {
      const fromDate = subMonths(TODAY, RANGE_MONTHS - 1)
      const data = await getDashboardFinanceSeries(
        fromDate.getFullYear(), fromDate.getMonth(), TODAY.getFullYear(), TODAY.getMonth()
      )
      setSeries(data)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [showFinancials])

  useEffect(() => { load() }, [load])

  // Collection panel rows track the selected month (a bar click updates them too).
  const loadPanel = useCallback(async () => {
    if (!showFinancials) { setPanelLoading(false); return }
    setPanelLoading(true)
    try {
      const rows = await getMonthInvoicePanel(selected.year, selected.month)
      setPanelRows(rows)
    } catch (_) {
      setPanelRows([])
    } finally {
      setPanelLoading(false)
    }
  }, [selected, showFinancials])

  useEffect(() => { loadPanel() }, [loadPanel])

  const kpis = useMemo(
    () => deriveKpis(series, selected.year, selected.month, kpiOpts),
    [series, selected, kpiOpts]
  )

  const currentDate = new Date(selected.year, selected.month, 1)
  const monthLabel = format(currentDate, 'MMMM yyyy', { locale: es })

  // --- bulk action (emit invoices / mark paid) ---
  // Rows are built from the collection panel data (live amounts already loaded), so no extra fetch.
  // Eligibility is computed here; the modal owns the run (settings, live status, retries).
  const openBulk = (mode) => {
    const candidates = panelRows.filter(r =>
      mode === 'pay' ? r.paymentStatus !== 'paid' : r.invoiceStatus !== 'invoiced'
    )
    const rows = candidates.map(r => {
      const eligibility = (mode === 'emit' && !r.documentNumber) ? 'sin CI'
        : r.amount <= 0 ? 'monto 0'
        : 'listo'
      return { id: r.id, name: `${r.firstName} ${r.lastName}`, transferResponsible: r.transferResponsible, amount: r.amount, eligibility }
    })
    setBulkMode(mode)
    setBulkRows(rows)
    setBulkOpen(true)
  }
  const onBulkComplete = useCallback(() => { load(); loadPanel() }, [load, loadPanel])

  return (
    <div className="-mt-8 -mx-4 sm:-mx-6 lg:-mx-8 px-4 sm:px-6 lg:px-8 py-8 min-h-full bg-gray-50">
      {/* header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        {showFinancials && <MonthNavigator selected={selected} onChange={setSelected} />}
      </div>

      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          Error al cargar datos: {error}
        </div>
      )}

      {showFinancials ? (
        loading ? (
          <div className="flex items-center justify-center py-32 text-gray-400 text-sm">Cargando métricas…</div>
        ) : (
          <div className="grid grid-cols-1 xl:grid-cols-[1fr_360px] gap-6 items-start">
            {/* left: chart + KPIs + daily summaries — scrolls with the page normally */}
            <div className="flex flex-col gap-6 min-w-0">
              <MonthlyFinanceChart
                series={series}
                selected={selected}
                onSelectMonth={setSelected}
                onOptionsChange={setKpiOpts}
              />
              <KpiRow kpis={kpis} />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <PlaceholderCard title="Turnos de hoy" hint="Resumen de asistencia del día." minHeight={130} />
                <PlaceholderCard title="Transporte de hoy" hint="Resumen de viajes y autos del día." minHeight={130} />
              </div>
            </div>

            {/* right: facturación & cobranza — sticky, fills the viewport height while the page scrolls */}
            <div className="xl:sticky xl:top-6 xl:h-[calc(100vh-3rem)]">
              <CollectionPanel
                rows={panelRows}
                loading={panelLoading}
                kpis={kpis}
                monthLabel={monthLabel}
                onBulkAction={openBulk}
                canAct={hasAccess('billing')}
              />
            </div>
          </div>
        )
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <PlaceholderCard title="Turnos de hoy" hint="Resumen de asistencia del día." minHeight={130} />
          <PlaceholderCard title="Transporte de hoy" hint="Resumen de viajes y autos del día." minHeight={130} />
        </div>
      )}

      {/* bulk action modal (emit invoices / mark paid) */}
      <BulkInvoiceModal
        isOpen={bulkOpen}
        onClose={() => setBulkOpen(false)}
        mode={bulkMode}
        rows={bulkRows}
        year={selected.year}
        month={selected.month}
        monthLabel={monthLabel}
        onComplete={onBulkComplete}
      />
    </div>
  )
}
