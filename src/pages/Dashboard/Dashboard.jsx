import { useState, useEffect, useCallback, useMemo } from 'react'
import { format, subMonths, startOfMonth } from 'date-fns'
import { es } from 'date-fns/locale'
import Button from '../../components/ui/Button'
import Modal from '../../components/ui/Modal'
import MonthlyFinanceChart from './MonthlyFinanceChart'
import KpiRow from './KpiRow'
import PlaceholderCard from './PlaceholderCard'
import CollectionPanel from './CollectionPanel'
import { getDashboardFinanceSeries, getMonthInvoicePanel } from '../../services/dashboard/dashboardService'
import { deriveKpis } from '../../services/dashboard/financeSeries'
import { formatCurrency } from '../../utils/format'
import { emitInvoice, markMonthPaid } from '../../services/api'
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
  const [bulkRunning, setBulkRunning] = useState(false)
  const [bulkProgress, setBulkProgress] = useState({ done: 0, total: 0, failed: [] })

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
  const openBulk = (mode) => {
    setBulkMode(mode)
    setBulkOpen(true)
    setBulkProgress({ done: 0, total: 0, failed: [] })
    const candidates = panelRows.filter(r =>
      mode === 'pay' ? r.paymentStatus !== 'paid' : r.invoiceStatus !== 'invoiced'
    )
    const rows = candidates.map(r => {
      const status = (mode === 'emit' && !r.documentNumber) ? 'sin CI'
        : r.amount <= 0 ? 'monto 0'
        : 'listo'
      return { id: r.id, name: `${r.firstName} ${r.lastName}`, amount: r.amount, status, selected: status === 'listo' }
    })
    setBulkRows(rows)
  }
  const runBulk = async () => {
    const targets = bulkRows.filter(r => r.selected && r.status === 'listo')
    if (!targets.length) return
    setBulkRunning(true); setBulkProgress({ done: 0, total: targets.length, failed: [] })
    const failed = []
    for (let i = 0; i < targets.length; i++) {
      try {
        if (bulkMode === 'pay') await markMonthPaid(targets[i].id, selected.year, selected.month, targets[i].amount)
        else await emitInvoice(targets[i].id, selected.year, selected.month)
      }
      catch (e) { failed.push({ name: targets[i].name, error: e.message }) }
      setBulkProgress({ done: i + 1, total: targets.length, failed: [...failed] })
      if (i < targets.length - 1) await new Promise(res => setTimeout(res, 1100))
    }
    setBulkRunning(false); load(); loadPanel()
  }
  const selectedCount = bulkRows.filter(r => r.selected && r.status === 'listo').length
  const isPay = bulkMode === 'pay'

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
          <div className="grid grid-cols-1 xl:grid-cols-[1fr_360px] gap-6 items-stretch">
            {/* left: chart + KPIs + daily summaries */}
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

            {/* right: facturación & cobranza */}
            <CollectionPanel
              rows={panelRows}
              loading={panelLoading}
              kpis={kpis}
              monthLabel={monthLabel}
              onBulkAction={openBulk}
              canAct={hasAccess('billing')}
            />
          </div>
        )
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <PlaceholderCard title="Turnos de hoy" hint="Resumen de asistencia del día." minHeight={130} />
          <PlaceholderCard title="Transporte de hoy" hint="Resumen de viajes y autos del día." minHeight={130} />
        </div>
      )}

      {/* bulk action modal (emit invoices / mark paid) */}
      <Modal isOpen={bulkOpen} onClose={() => { if (!bulkRunning) setBulkOpen(false) }} title={`${isPay ? 'Marcar cobrado' : 'Facturar'} — ${monthLabel}`} size="xl">
        {(
          <div className="space-y-4">
            {bulkProgress.total > 0 && (
              <div className="text-sm text-gray-700">
                {isPay ? 'Cobradas' : 'Emitidas'} {bulkProgress.done}/{bulkProgress.total}
                {bulkProgress.failed.length > 0 && <span className="text-red-600"> · {bulkProgress.failed.length} fallidas</span>}
              </div>
            )}
            <div className="max-h-80 overflow-y-auto border border-gray-200 rounded-lg divide-y divide-gray-100">
              {bulkRows.length === 0 ? (
                <div className="px-3 py-6 text-center text-sm text-gray-400">No hay clientes</div>
              ) : bulkRows.map((r) => (
                <label key={r.id} className={`flex items-center gap-3 px-3 py-2 text-sm ${r.status === 'listo' ? 'cursor-pointer hover:bg-gray-50' : 'opacity-60'}`}>
                  <input type="checkbox" checked={r.selected} disabled={r.status !== 'listo' || bulkRunning}
                    onChange={(e) => setBulkRows(rows => rows.map(x => x.id === r.id ? { ...x, selected: e.target.checked } : x))} />
                  <span className="flex-1 text-gray-900">{r.name}</span>
                  <span className="text-gray-600">{formatCurrency(r.amount)}</span>
                  <span className={`text-xs px-2 py-0.5 rounded ${r.status === 'listo' ? 'bg-green-50 text-green-700' : r.status === 'sin CI' ? 'bg-red-50 text-red-700' : 'bg-gray-100 text-gray-500'}`}>{r.status}</span>
                </label>
              ))}
            </div>
            {bulkProgress.failed.length > 0 && (
              <div className="text-xs text-red-600 space-y-0.5 max-h-24 overflow-y-auto">
                {bulkProgress.failed.map((f, i) => <div key={i}>{f.name}: {f.error}</div>)}
              </div>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setBulkOpen(false)} disabled={bulkRunning}>Cerrar</Button>
              <Button onClick={runBulk} loading={bulkRunning} disabled={bulkRunning || selectedCount === 0}>
                {isPay ? 'Marcar cobradas' : 'Emitir seleccionadas'} ({selectedCount})
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
