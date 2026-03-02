import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { format, addMonths, subMonths, startOfMonth } from 'date-fns'
import { es } from 'date-fns/locale'
import { NavArrowLeft, NavArrowRight, WarningTriangle, Clock } from 'iconoir-react'
import Card, { CardHeader, CardContent } from '../../components/ui/Card'
import Button from '../../components/ui/Button'
import { getDashboardMetrics } from '../../services/dashboard/dashboardService'

function formatCurrency(amount) {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0
  }).format(amount)
}

function ProgressBar({ value, max, colorClass = 'bg-indigo-500' }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0
  return (
    <div className="w-full bg-gray-100 rounded-full h-2">
      <div
        className={`${colorClass} h-2 rounded-full transition-all`}
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}

function StatCard({ label, value, sub, colorClass = 'text-gray-900' }) {
  return (
    <Card className="flex-1 min-w-0">
      <CardContent className="py-5">
        <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1 truncate">{label}</p>
        <p className={`text-2xl font-bold ${colorClass} truncate`}>{value}</p>
        {sub && <p className="text-xs text-gray-400 mt-1 truncate">{sub}</p>}
      </CardContent>
    </Card>
  )
}

const TIER_COLORS = {
  A: 'bg-green-100 text-green-700',
  B: 'bg-blue-100 text-blue-700',
  C: 'bg-amber-100 text-amber-700',
  D: 'bg-red-100 text-red-700'
}

export default function Dashboard() {
  const navigate = useNavigate()
  // Start with current month (0-indexed)
  const [currentDate, setCurrentDate] = useState(() => startOfMonth(new Date()))
  const [metrics, setMetrics] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const year = currentDate.getFullYear()
  const month = currentDate.getMonth()

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await getDashboardMetrics(year, month)
      setMetrics(data)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [year, month])

  useEffect(() => {
    load()
  }, [load])

  const goBack = () => setCurrentDate(d => subMonths(d, 1))
  const goNext = () => setCurrentDate(d => addMonths(d, 1))

  const monthLabel = format(currentDate, 'MMMM yyyy', { locale: es })

  return (
    <div className="-mt-8 -mx-4 sm:-mx-6 lg:-mx-8 px-4 sm:px-6 lg:px-8 py-8 min-h-full bg-gray-50">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={goBack}>
            <NavArrowLeft className="w-4 h-4" />
          </Button>
          <span className="text-sm font-medium text-gray-700 capitalize w-36 text-center">
            {monthLabel}
          </span>
          <Button variant="secondary" size="sm" onClick={goNext}>
            <NavArrowRight className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          Error al cargar datos: {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-32 text-gray-400 text-sm">
          Cargando métricas...
        </div>
      ) : metrics && (
        <div className="space-y-6">

          {/* KPI row: 5 stat cards */}
          <div className="flex gap-4 flex-wrap">
            <StatCard
              label="Facturación del mes"
              value={formatCurrency(metrics.financial.totalBilling)}
              sub={`${metrics.financial.totalInvoicesCount} clientes`}
            />
            <StatCard
              label="Cobrado"
              value={formatCurrency(metrics.financial.totalCollected)}
              sub={`${metrics.financial.paidCount} pagados`}
              colorClass="text-green-700"
            />
            <StatCard
              label="Gastos del mes"
              value={formatCurrency(metrics.financial.totalExpenses)}
              colorClass="text-red-700"
            />
            <StatCard
              label="Margen estimado"
              value={formatCurrency(metrics.financial.margin)}
              colorClass={metrics.financial.margin >= 0 ? 'text-green-700' : 'text-red-700'}
              sub="Cobrado − Gastos"
            />
            <StatCard
              label="Tasa de cobro"
              value={`${metrics.financial.collectionRate.toFixed(0)}%`}
              sub="Cobrado / Facturación"
              colorClass={
                metrics.financial.collectionRate >= 80
                  ? 'text-green-700'
                  : metrics.financial.collectionRate >= 50
                  ? 'text-amber-700'
                  : 'text-red-700'
              }
            />
          </div>

          {/* Financial performance section */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

            {/* Estado de cobros */}
            <Card>
              <CardHeader>
                <h2 className="text-sm font-semibold text-gray-800">Estado de cobros</h2>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Paid */}
                <div>
                  <div className="flex justify-between text-xs text-gray-600 mb-1">
                    <span>Cobrados</span>
                    <span className="font-medium text-green-700">
                      {metrics.financial.paidCount} / {metrics.financial.totalInvoicesCount}
                    </span>
                  </div>
                  <ProgressBar
                    value={metrics.financial.paidCount}
                    max={metrics.financial.totalInvoicesCount}
                    colorClass="bg-green-500"
                  />
                </div>

                {/* Pending payment */}
                <div>
                  <div className="flex justify-between text-xs text-gray-600 mb-1">
                    <span>Pendientes de pago</span>
                    <span className="font-medium text-amber-700">
                      {metrics.financial.pendingPaymentCount}
                    </span>
                  </div>
                  <ProgressBar
                    value={metrics.financial.pendingPaymentCount}
                    max={metrics.financial.totalInvoicesCount}
                    colorClass="bg-amber-400"
                  />
                </div>

                {/* Overdue */}
                <div>
                  <div className="flex justify-between text-xs text-gray-600 mb-1">
                    <span>Vencidas</span>
                    <span className="font-medium text-red-700">
                      {metrics.financial.overdueCount}
                    </span>
                  </div>
                  <ProgressBar
                    value={metrics.financial.overdueCount}
                    max={metrics.financial.totalInvoicesCount}
                    colorClass="bg-red-500"
                  />
                </div>

                {/* Collection rate big bar */}
                <div className="pt-2 border-t border-gray-100">
                  <div className="flex justify-between text-xs text-gray-600 mb-1">
                    <span className="font-medium">Tasa de cobro</span>
                    <span className="font-bold text-indigo-700">
                      {metrics.financial.collectionRate.toFixed(1)}%
                    </span>
                  </div>
                  <ProgressBar
                    value={metrics.financial.collectionRate}
                    max={100}
                    colorClass="bg-indigo-500"
                  />
                </div>
              </CardContent>
            </Card>

            {/* Alertas accionables */}
            <Card>
              <CardHeader>
                <h2 className="text-sm font-semibold text-gray-800">Alertas</h2>
              </CardHeader>
              <CardContent className="space-y-3">
                {metrics.financial.overdueCount > 0 && (
                  <div className="flex items-start gap-3 p-3 bg-red-50 rounded-lg">
                    <WarningTriangle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-red-800">
                        {metrics.financial.overdueCount} factura{metrics.financial.overdueCount !== 1 ? 's' : ''} vencida{metrics.financial.overdueCount !== 1 ? 's' : ''}
                      </p>
                      <p className="text-xs text-red-600 mt-0.5">Cobro pendiente y fuera de plazo</p>
                    </div>
                    <button
                      onClick={() => navigate('/clientes')}
                      className="ml-auto text-xs text-red-700 underline whitespace-nowrap"
                    >
                      Ver clientes
                    </button>
                  </div>
                )}

                {metrics.financial.notInvoicedCount > 0 && (
                  <div className="flex items-start gap-3 p-3 bg-amber-50 rounded-lg">
                    <Clock className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-amber-800">
                        {metrics.financial.notInvoicedCount} sin factura electrónica
                      </p>
                      <p className="text-xs text-amber-600 mt-0.5">Aún no se emitió la factura</p>
                    </div>
                    <button
                      onClick={() => navigate('/clientes')}
                      className="ml-auto text-xs text-amber-700 underline whitespace-nowrap"
                    >
                      Ver clientes
                    </button>
                  </div>
                )}

                {metrics.financial.overdueCount === 0 && metrics.financial.notInvoicedCount === 0 && (
                  <div className="flex items-center gap-2 p-3 bg-green-50 rounded-lg">
                    <span className="text-green-600 text-sm font-medium">Sin alertas para este mes</span>
                  </div>
                )}

                {/* Summary row */}
                <div className="pt-2 border-t border-gray-100 grid grid-cols-2 gap-3">
                  <div className="text-center p-2 bg-gray-50 rounded-lg">
                    <p className="text-lg font-bold text-gray-900">{formatCurrency(metrics.financial.totalCollected)}</p>
                    <p className="text-xs text-gray-500">cobrado</p>
                  </div>
                  <div className="text-center p-2 bg-gray-50 rounded-lg">
                    <p className="text-lg font-bold text-gray-900">
                      {formatCurrency(metrics.financial.totalBilling - metrics.financial.totalCollected)}
                    </p>
                    <p className="text-xs text-gray-500">pendiente</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Operational performance section */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

            {/* Distribución de clientes */}
            <Card>
              <CardHeader>
                <h2 className="text-sm font-semibold text-gray-800">
                  Clientes — {metrics.clients.total} activos
                </h2>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Tier distribution */}
                <div>
                  <p className="text-xs text-gray-500 mb-2">Por nivel cognitivo</p>
                  <div className="flex gap-2 flex-wrap">
                    {['A', 'B', 'C', 'D'].map(tier => (
                      <div key={tier} className={`px-3 py-1.5 rounded-lg ${TIER_COLORS[tier]}`}>
                        <span className="text-xs font-medium">{tier}: </span>
                        <span className="text-sm font-bold">{metrics.clients.byTier[tier]}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Frequency distribution */}
                <div>
                  <p className="text-xs text-gray-500 mb-2">Por frecuencia semanal</p>
                  <div className="space-y-1.5">
                    {[4, 3, 2, 1].map(freq => (
                      <div key={freq} className="flex items-center gap-2">
                        <span className="text-xs text-gray-600 w-6">{freq}x</span>
                        <div className="flex-1">
                          <ProgressBar
                            value={metrics.clients.byFrequency[freq]}
                            max={metrics.clients.total}
                            colorClass="bg-indigo-400"
                          />
                        </div>
                        <span className="text-xs font-medium text-gray-700 w-4 text-right">
                          {metrics.clients.byFrequency[freq]}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Transport & recovery */}
                <div className="grid grid-cols-2 gap-3 pt-2 border-t border-gray-100">
                  <div>
                    <p className="text-xs text-gray-500 mb-1">Con transporte</p>
                    <p className="text-lg font-bold text-gray-900">
                      {metrics.clients.withTransport}
                      <span className="text-xs font-normal text-gray-500 ml-1">
                        ({metrics.clients.transportPct.toFixed(0)}%)
                      </span>
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 mb-1">Pool de recupero</p>
                    <p className="text-lg font-bold text-gray-900">
                      {metrics.clients.totalRecoveryDays}
                      <span className="text-xs font-normal text-gray-500 ml-1">días</span>
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Asistencia */}
            <Card>
              <CardHeader>
                <h2 className="text-sm font-semibold text-gray-800">Asistencia del mes</h2>
              </CardHeader>
              <CardContent className="space-y-4">
                {metrics.attendance.total === 0 ? (
                  <p className="text-sm text-gray-400 py-4 text-center">
                    Sin registros de asistencia para este mes
                  </p>
                ) : (
                  <>
                    {/* Attendance rate big display */}
                    <div className="flex items-end gap-3">
                      <p className="text-4xl font-bold text-gray-900">
                        {metrics.attendance.attendanceRate.toFixed(0)}%
                      </p>
                      <p className="text-sm text-gray-500 mb-1">tasa de asistencia</p>
                    </div>
                    <ProgressBar
                      value={metrics.attendance.attendanceRate}
                      max={100}
                      colorClass={
                        metrics.attendance.attendanceRate >= 80
                          ? 'bg-green-500'
                          : metrics.attendance.attendanceRate >= 60
                          ? 'bg-amber-400'
                          : 'bg-red-500'
                      }
                    />

                    {/* Breakdown */}
                    <div className="grid grid-cols-3 gap-3 pt-2 border-t border-gray-100">
                      <div className="text-center">
                        <p className="text-xl font-bold text-green-700">
                          {metrics.attendance.attended}
                        </p>
                        <p className="text-xs text-gray-500">asistencias</p>
                      </div>
                      <div className="text-center">
                        <p className="text-xl font-bold text-amber-700">
                          {metrics.attendance.justifiedAbsences}
                        </p>
                        <p className="text-xs text-gray-500">faltas just.</p>
                      </div>
                      <div className="text-center">
                        <p className="text-xl font-bold text-red-700">
                          {metrics.attendance.unjustifiedAbsences}
                        </p>
                        <p className="text-xs text-gray-500">faltas injust.</p>
                      </div>
                    </div>

                    <p className="text-xs text-gray-400">
                      Total registros: {metrics.attendance.total}
                    </p>
                  </>
                )}
              </CardContent>
            </Card>
          </div>

        </div>
      )}
    </div>
  )
}
