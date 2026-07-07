import { useState, useEffect, useCallback, useMemo } from 'react'
import { format, subMonths } from 'date-fns'
import { es } from 'date-fns/locale'
import MonthlyFinanceChart from '../MonthlyFinanceChart'
import PlaceholderCard from '../PlaceholderCard'
import CollectionPanel from '../CollectionPanel'
import BulkInvoiceModal from '../BulkInvoiceModal'
import BreakevenCard from '../BreakevenCard'
import FinanceKpis from '../FinanceKpis'
import RevenueLinesCard from '../RevenueLinesCard'
import ExpensesByCategoryCard from '../ExpensesByCategoryCard'
import { getDashboardFinanceSeries, getMonthInvoicePanel } from '../../../services/dashboard/dashboardService'
import { deriveKpis, breakevenAnalysis, lineRevenueKpis, extendedFinanceKpis, expensesByCategory } from '../../../services/dashboard/financeSeries'
import { getClients } from '../../../services/clients/clientService'
import { getExpensesByMonth } from '../../../services/expenses/expenseService'
import { getFixedExpenses } from '../../../services/expenses/fixedExpenseService'
import { activeClientsInMonth, transportClientsInMonth } from '../../../services/dashboard/commercialStats'
import { useAuth } from '../../../context/AuthContext'
import { RANGE_MONTHS, TODAY } from '../monthWindow'

// Command center financiero: chart ingresos/gastos + KPIs + panel de cobranza.
// El mes seleccionado lo controla el shell del Dashboard (compartido entre pestañas);
// un clic en una barra del chart lo mueve vía onSelectMonth.
export default function FinanceSection({ selected, onSelectMonth }) {
  const { hasAccess } = useAuth()

  const [series, setSeries] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [kpiOpts, setKpiOpts] = useState({ basis: 'previsto', withIva: false })

  const [panelRows, setPanelRows] = useState([])
  const [panelLoading, setPanelLoading] = useState(true)

  // Clientes (incl. bajas) para el conteo de activos por mes del análisis de equilibrio.
  const [clients, setClients] = useState([])
  // Gastos: fijos (plantillas, una vez) y variables del mes seleccionado.
  const [fixedTemplates, setFixedTemplates] = useState([])
  const [monthExpenses, setMonthExpenses] = useState([])

  const [bulkOpen, setBulkOpen] = useState(false)
  const [bulkMode, setBulkMode] = useState('emit')
  const [bulkRows, setBulkRows] = useState([])

  const load = useCallback(async () => {
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
  }, [])

  useEffect(() => { load() }, [load])

  const loadPanel = useCallback(async () => {
    setPanelLoading(true)
    try {
      const rows = await getMonthInvoicePanel(selected.year, selected.month)
      setPanelRows(rows)
    } catch (_) {
      setPanelRows([])
    } finally {
      setPanelLoading(false)
    }
  }, [selected])

  useEffect(() => { loadPanel() }, [loadPanel])

  useEffect(() => {
    let alive = true
    getClients({ includeDeleted: true })
      // Charity clients don't count toward ARPU/breakeven client counts.
      .then(cs => { if (alive) setClients(cs.filter(c => !c.isCharity)) })
      .catch(() => { if (alive) setClients([]) })
    getFixedExpenses()
      .then(fs => { if (alive) setFixedTemplates(fs) })
      .catch(() => { if (alive) setFixedTemplates([]) })
    return () => { alive = false }
  }, [])

  useEffect(() => {
    let alive = true
    getExpensesByMonth(selected.year, selected.month)
      .then(rows => { if (alive) setMonthExpenses(rows) })
      .catch(() => { if (alive) setMonthExpenses([]) })
    return () => { alive = false }
  }, [selected])

  const kpis = useMemo(
    () => deriveKpis(series, selected.year, selected.month, kpiOpts),
    [series, selected, kpiOpts]
  )

  const selectedRow = useMemo(
    () => series.find(r => r.year === selected.year && r.month === selected.month) || null,
    [series, selected]
  )
  const activeClients = useMemo(
    () => activeClientsInMonth(clients, selected.year, selected.month),
    [clients, selected]
  )

  const breakeven = useMemo(
    () => (selectedRow ? breakevenAnalysis(selectedRow, activeClients) : null),
    [selectedRow, activeClients]
  )

  const attendanceLine = useMemo(
    () => (selectedRow ? lineRevenueKpis(selectedRow, 'attendance', activeClients, kpiOpts) : null),
    [selectedRow, activeClients, kpiOpts]
  )
  const transportLine = useMemo(
    () => (selectedRow ? lineRevenueKpis(selectedRow, 'transport', transportClientsInMonth(clients, selected.year, selected.month), kpiOpts) : null),
    [selectedRow, clients, selected, kpiOpts]
  )

  const extraKpis = useMemo(
    () => extendedFinanceKpis(selectedRow, kpis, kpiOpts),
    [selectedRow, kpis, kpiOpts]
  )

  const expenseCategories = useMemo(
    () => expensesByCategory(
      { variableRows: monthExpenses, fixedTemplates, salaries: selectedRow?.salaries || 0 },
      selected.year, selected.month
    ),
    [monthExpenses, fixedTemplates, selectedRow, selected]
  )

  const monthLabel = format(new Date(selected.year, selected.month, 1), 'MMMM yyyy', { locale: es })

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

  if (error) {
    return (
      <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
        Error al cargar datos: {error}
      </div>
    )
  }

  if (loading) {
    return <div className="flex items-center justify-center py-32 text-gray-400 text-sm">Cargando métricas…</div>
  }

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[1fr_360px] gap-6 items-start">
      <div className="flex flex-col gap-6 min-w-0">
        <MonthlyFinanceChart
          series={series}
          selected={selected}
          onSelectMonth={onSelectMonth}
          onOptionsChange={setKpiOpts}
        />
        <FinanceKpis kpis={kpis} extra={extraKpis} />
        <RevenueLinesCard
          attendance={attendanceLine}
          transport={transportLine}
          arr={extraKpis?.arr}
          monthLabel={monthLabel}
          withIva={kpiOpts.withIva}
        />
        <ExpensesByCategoryCard rows={expenseCategories} monthLabel={monthLabel} />
        <BreakevenCard analysis={breakeven} monthLabel={monthLabel} />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <PlaceholderCard title="Turnos de hoy" hint="Resumen de asistencia del día." minHeight={130} />
          <PlaceholderCard title="Transporte de hoy" hint="Resumen de viajes y autos del día." minHeight={130} />
        </div>
      </div>

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
