import { useState, useEffect, useCallback, useMemo } from 'react'
import { format, subMonths, startOfMonth } from 'date-fns'
import { es } from 'date-fns/locale'
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
        <span className="text-sm font-medium text-gray-500 capitalize">{monthLabel}</span>
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
