import { useState, useEffect } from 'react'
import { NavArrowLeft, NavArrowRight, Bus } from 'iconoir-react'
import Modal from '../../components/ui/Modal'
import { Select } from '../../components/ui/Input'
import { formatCurrency } from '../../utils/format'
import { getPlanPricing, getPlanPriceSync, calculateMonthProration } from '../../services/pricing/pricingService'
import { getTransportPricing, getTransportPriceSync } from '../../services/pricing/transportPricingService'

// Días hábiles del club (mismo orden que la grilla de tarjetas de cliente)
const WEEK_DAYS = [
  { key: 'monday', label: 'L' },
  { key: 'tuesday', label: 'M' },
  { key: 'wednesday', label: 'M' },
  { key: 'thursday', label: 'J' },
  { key: 'friday', label: 'V' }
]

const DOW = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
const MONTH_NAMES_ES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

const SCHEDULE_OPTIONS = [
  { value: 'morning', label: 'Mañana' },
  { value: 'afternoon', label: 'Tarde' },
  { value: 'full_day', label: 'Día completo' }
]

const DISTANCE_OPTIONS = [
  { value: '', label: 'Seleccionar distancia...' },
  { value: '0_to_2km', label: '0 a 2 km' },
  { value: '2_to_5km', label: '2 a 5 km' },
  { value: '5_to_10km', label: '5 a 10 km' }
]

const todayISO = () => new Date().toISOString().split('T')[0]

// Agrupa los días hábiles del mes en semanas de 5 columnas (L-V), alineando la primera columna al lunes.
function buildWeeks(year, month) {
  const lastDay = new Date(year, month + 1, 0).getDate()
  const weeks = []
  let week = new Array(5).fill(null)
  for (let dnum = 1; dnum <= lastDay; dnum++) {
    const dow = new Date(year, month, dnum).getDay()
    if (dow === 0 || dow === 6) continue // omite fines de semana
    const col = dow - 1 // lunes=0 ... viernes=4
    if (col === 0 && week.some(Boolean)) {
      weeks.push(week)
      week = new Array(5).fill(null)
    }
    week[col] = dnum
  }
  if (week.some(Boolean)) weeks.push(week)
  return weeks
}

export default function PlanCalculatorModal({ isOpen, onClose }) {
  const [pricingData, setPricingData] = useState([])
  const [transportPricingData, setTransportPricingData] = useState([])
  const [loaded, setLoaded] = useState(false)

  const [assignedDays, setAssignedDays] = useState([])
  const [schedule, setSchedule] = useState('morning')
  const [startDate, setStartDate] = useState(todayISO())
  const [hasTransport, setHasTransport] = useState(false)
  const [distanceRange, setDistanceRange] = useState('')

  const start = new Date(`${startDate}T00:00:00`)
  const [viewYear, setViewYear] = useState(start.getFullYear())
  const [viewMonth, setViewMonth] = useState(start.getMonth())

  // Carga precios la primera vez que se abre
  useEffect(() => {
    if (!isOpen || loaded) return
    Promise.all([getPlanPricing(), getTransportPricing()])
      .then(([plans, transport]) => {
        setPricingData(plans)
        setTransportPricingData(transport)
        setLoaded(true)
      })
      .catch(err => console.error('Error cargando precios:', err))
  }, [isOpen, loaded])

  // El calendario sigue a la fecha de alta: al cambiarla, salta a ese mes
  useEffect(() => {
    const d = new Date(`${startDate}T00:00:00`)
    if (isNaN(d.getTime())) return
    setViewYear(d.getFullYear())
    setViewMonth(d.getMonth())
  }, [startDate])

  const toggleDay = (key) => {
    setAssignedDays(prev => prev.includes(key) ? prev.filter(d => d !== key) : [...prev, key])
  }

  const shiftMonth = (delta) => {
    const d = new Date(viewYear, viewMonth + delta, 1)
    setViewYear(d.getFullYear())
    setViewMonth(d.getMonth())
  }

  const frequency = assignedDays.length
  const planPrice = getPlanPriceSync(pricingData, frequency, schedule)
  const transportPrice = hasTransport && distanceRange
    ? getTransportPriceSync(transportPricingData, frequency, distanceRange)
    : { priceNet: 0, priceGross: 0 }
  const monthlyGross = planPrice.priceGross + transportPrice.priceGross

  const proration = calculateMonthProration({
    year: viewYear,
    month: viewMonth,
    startDate,
    assignedDays,
    frequency,
    monthlyAttendanceGross: planPrice.priceGross,
    monthlyTransportGross: transportPrice.priceGross
  })

  const weeks = buildWeeks(viewYear, viewMonth)
  const hasPlan = frequency > 0
  const transportMissingDistance = hasTransport && !distanceRange

  // Estado de cada celda del calendario según el plan y la fecha de alta
  const cellState = (dayNum) => {
    if (!dayNum) return 'empty'
    const d = new Date(viewYear, viewMonth, dayNum)
    const isAssigned = assignedDays.includes(DOW[d.getDay()])
    const isStart = d.getFullYear() === start.getFullYear() && d.getMonth() === start.getMonth() && d.getDate() === start.getDate()
    if (!isAssigned) return isStart ? 'start-off' : 'off'
    if (d < start) return isStart ? 'start' : 'before'
    return isStart ? 'start' : 'billable'
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Calculadora de plan" size="xl">
      <div className="grid gap-6 md:grid-cols-2">
        {/* Columna izquierda: inputs + montos */}
        <div className="space-y-5">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Días asignados</label>
            <div className="flex gap-2">
              {WEEK_DAYS.map((day, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => toggleDay(day.key)}
                  className={`flex-1 py-2 rounded-lg font-medium text-sm transition-colors ${
                    assignedDays.includes(day.key)
                      ? 'bg-indigo-600 text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  {day.label}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-xs text-gray-500">
              {frequency > 0 ? `${frequency}x por semana` : 'Seleccioná los días de asistencia'}
            </p>
          </div>

          <Select
            label="Turno"
            value={schedule}
            onChange={(e) => setSchedule(e.target.value)}
            options={SCHEDULE_OPTIONS}
          />

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Fecha de alta</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => e.target.value && setStartDate(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            />
            <p className="mt-1 text-xs text-gray-500">Primer día que asiste (y que se cobra).</p>
          </div>

          {/* Transporte */}
          <button
            type="button"
            role="switch"
            aria-checked={hasTransport}
            onClick={() => setHasTransport(v => !v)}
            className={`w-full text-left rounded-xl border p-3 transition-all ${
              hasTransport ? 'border-emerald-300 bg-emerald-50/60' : 'border-gray-200 bg-white hover:border-gray-300'
            }`}
          >
            <div className="flex items-center gap-3">
              <div className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg ${
                hasTransport ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-400'
              }`}>
                <Bus className="h-4 w-4" />
              </div>
              <span className="flex-1 text-sm font-medium text-gray-900">Transporte puerta a puerta</span>
              <span className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors ${
                hasTransport ? 'bg-emerald-500' : 'bg-gray-300'
              }`}>
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform ${
                  hasTransport ? 'translate-x-6' : 'translate-x-1'
                }`} />
              </span>
            </div>
          </button>
          {hasTransport && (
            <Select
              value={distanceRange}
              onChange={(e) => setDistanceRange(e.target.value)}
              options={DISTANCE_OPTIONS}
            />
          )}

          {/* Montos */}
          <div className="bg-indigo-50 rounded-lg p-4 space-y-2">
            {!hasPlan ? (
              <p className="text-sm text-indigo-700">Seleccioná al menos un día para calcular el plan.</p>
            ) : (
              <>
                <p className="text-sm text-indigo-700">Precio mensual estimado</p>
                <p className="text-2xl font-bold text-indigo-900">{formatCurrency(monthlyGross)}</p>
                <div className="text-xs text-indigo-700 space-y-0.5">
                  <p>Mensualidad: {formatCurrency(planPrice.priceGross)}</p>
                  {hasTransport && (
                    <p>Transporte: {transportPrice.priceGross > 0 ? formatCurrency(transportPrice.priceGross) : '— (definir distancia)'}</p>
                  )}
                </div>

                {proration && (
                  <div className="pt-2 mt-2 border-t border-indigo-200">
                    <p className="text-sm text-indigo-700 capitalize">
                      {proration.label}{proration.prorated ? ' · prorrateado' : ''}
                    </p>
                    <p className="text-xl font-bold text-indigo-900">{formatCurrency(proration.total)}</p>
                    <p className="text-xs text-indigo-600 mt-0.5">
                      {proration.billed} de {proration.daysPerMonth} días facturables
                      {hasTransport && transportPrice.priceGross > 0 && ` · transporte ${formatCurrency(proration.transport)}`}
                    </p>
                  </div>
                )}
              </>
            )}
            {transportMissingDistance && hasPlan && (
              <p className="text-xs text-amber-700">Definí la distancia para sumar el transporte.</p>
            )}
          </div>
        </div>

        {/* Columna derecha: calendario */}
        <div className="rounded-xl border border-gray-200 p-4">
          <div className="flex items-center justify-between mb-3">
            <button
              type="button"
              onClick={() => shiftMonth(-1)}
              className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 transition-colors"
              aria-label="Mes anterior"
            >
              <NavArrowLeft className="w-5 h-5" />
            </button>
            <span className="text-sm font-semibold text-gray-900 capitalize">
              {MONTH_NAMES_ES[viewMonth]} {viewYear}
            </span>
            <button
              type="button"
              onClick={() => shiftMonth(1)}
              className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 transition-colors"
              aria-label="Mes siguiente"
            >
              <NavArrowRight className="w-5 h-5" />
            </button>
          </div>

          <div className="grid grid-cols-5 gap-1.5 text-center text-xs font-medium text-gray-400 mb-1.5">
            {['L', 'M', 'M', 'J', 'V'].map((d, i) => <div key={i}>{d}</div>)}
          </div>
          <div className="space-y-1.5">
            {weeks.map((week, wi) => (
              <div key={wi} className="grid grid-cols-5 gap-1.5">
                {week.map((dayNum, ci) => {
                  const state = cellState(dayNum)
                  const base = 'flex items-center justify-center h-9 rounded-lg text-sm transition-colors'
                  const styles = {
                    empty: 'opacity-0',
                    off: 'text-gray-300',
                    'start-off': 'text-gray-400 ring-2 ring-indigo-400',
                    before: 'text-indigo-400 border border-dashed border-indigo-300',
                    billable: 'bg-indigo-600 text-white font-medium',
                    start: 'bg-indigo-600 text-white font-semibold ring-2 ring-indigo-400 ring-offset-1'
                  }
                  return (
                    <div key={ci} className={`${base} ${styles[state]}`}>
                      {dayNum || ''}
                    </div>
                  )
                })}
              </div>
            ))}
          </div>

          {/* Leyenda */}
          <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-gray-500">
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block w-3 h-3 rounded bg-indigo-600" /> Facturable
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block w-3 h-3 rounded border border-dashed border-indigo-300" /> Previo al alta
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block w-3 h-3 rounded ring-2 ring-indigo-400" /> Fecha de alta
            </span>
          </div>
        </div>
      </div>
    </Modal>
  )
}
