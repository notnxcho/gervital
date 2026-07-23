import { useState, useEffect } from 'react'
import { RefreshDouble } from 'iconoir-react'
import Modal from '../../components/ui/Modal'
import Button from '../../components/ui/Button'
import { Select } from '../../components/ui/Input'
import { getClientPlanVersions } from '../../services/api'
import { FREQUENCY_OPTIONS, SCHEDULE_OPTIONS, DAYS_OPTIONS, DISTANCE_OPTIONS } from './planOptions'

// Fecha local de hoy en YYYY-MM-DD (sin líos de timezone del toISOString)
const todayStr = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Día siguiente a un YYYY-MM-DD (mínimo permitido: el reintegro va después de la baja)
const nextDayStr = (dateStr) => {
  if (!dateStr) return undefined
  const [y, m, d] = dateStr.split('-').map(Number)
  const dt = new Date(y, m - 1, d + 1)
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
}

// Versión de plan vigente a la fecha de baja (última con effectiveFrom <= mes de la baja)
const planAtDate = (versions, dateStr) => {
  if (!versions?.length) return null
  const monthStart = dateStr ? `${dateStr.slice(0, 7)}-01` : todayStr()
  const eligible = versions.filter(v => v.effectiveFrom <= monthStart)
  const pool = eligible.length ? eligible : versions
  return pool.reduce((a, b) => (a.effectiveFrom >= b.effectiveFrom ? a : b))
}

export default function ReactivateClientModal({ isOpen, onClose, client, onConfirm, loading }) {
  const bajaDate = client?.deactivationDate || null

  const [reactivationDate, setReactivationDate] = useState(todayStr())
  const [frequency, setFrequency] = useState('1')
  const [schedule, setSchedule] = useState('morning')
  const [assignedDays, setAssignedDays] = useState([])
  const [hasTransport, setHasTransport] = useState(false)
  const [distanceRange, setDistanceRange] = useState('')
  const [loadingPlan, setLoadingPlan] = useState(false)

  useEffect(() => {
    if (!isOpen || !client?.id) return
    setReactivationDate(todayStr())
    setLoadingPlan(true)
    getClientPlanVersions(client.id)
      .then(versions => {
        const plan = planAtDate(versions, bajaDate)
        if (plan) {
          setFrequency(String(plan.frequency))
          setSchedule(plan.schedule)
          setAssignedDays(plan.assignedDays || [])
          setHasTransport(!!plan.hasTransport)
          setDistanceRange(plan.distanceRange || '')
        }
      })
      .catch(() => {})
      .finally(() => setLoadingPlan(false))
  }, [isOpen, client?.id, bajaDate])

  const toggleDay = (day) => {
    setAssignedDays(prev => prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day])
  }

  const freqNum = parseInt(frequency, 10)
  const daysMatch = assignedDays.length === freqNum
  const transportOk = !hasTransport || !!distanceRange
  const dateOk = !!reactivationDate && (!bajaDate || reactivationDate > bajaDate)
  const canConfirm = dateOk && daysMatch && transportOk && !loading && !loadingPlan

  const isRetroactive = reactivationDate < todayStr()
  const isScheduled = reactivationDate > todayStr()

  const handleConfirm = () => {
    if (!canConfirm) return
    onConfirm({
      reactivationDate,
      plan: {
        frequency: freqNum,
        schedule,
        hasTransport,
        assignedDays,
        distanceRange: hasTransport ? (distanceRange || null) : null
      }
    })
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Reintegrar cliente">
      <div className="flex items-start gap-3 mb-4">
        <div className="p-2 bg-emerald-100 rounded-full shrink-0">
          <RefreshDouble className="w-5 h-5 text-emerald-600" />
        </div>
        <div>
          <p className="text-gray-900 font-medium">
            {client?.firstName} {client?.lastName}
          </p>
          <p className="text-sm text-gray-500">
            Elegí la fecha de reintegro y confirmá el plan con el que vuelve.
          </p>
        </div>
      </div>

      <label className="block text-sm font-medium text-gray-700 mb-1">Fecha de reintegro</label>
      <input
        type="date"
        value={reactivationDate}
        onChange={e => setReactivationDate(e.target.value)}
        min={nextDayStr(bajaDate)}
        className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
      />
      <p className="text-xs text-gray-500 mt-1 mb-4">
        Desde esta fecha (inclusive) el cliente vuelve a asistir y se cobra. Los días entre la baja y el reintegro no se cobran.
        {isRetroactive && <span className="text-amber-600"> Reintegro retroactivo.</span>}
        {isScheduled && <span className="text-blue-600"> Reintegro programado a futuro.</span>}
      </p>

      <div className="border-t border-gray-100 pt-4">
        <p className="text-sm font-medium text-gray-700 mb-3">Plan de asistencia</p>
        <div className="grid grid-cols-2 gap-4 mb-4">
          <Select
            label="Frecuencia"
            value={frequency}
            onChange={e => { setFrequency(e.target.value); setAssignedDays([]) }}
            options={FREQUENCY_OPTIONS}
          />
          <Select
            label="Horario"
            value={schedule}
            onChange={e => setSchedule(e.target.value)}
            options={SCHEDULE_OPTIONS}
          />
        </div>

        <label className="block text-sm font-medium text-gray-700 mb-2">
          Días asignados (seleccioná {frequency})
        </label>
        <div className="flex flex-wrap gap-2 mb-1">
          {DAYS_OPTIONS.map(day => (
            <button
              key={day.value}
              type="button"
              onClick={() => toggleDay(day.value)}
              className={`px-3 py-2 rounded-lg font-medium text-sm transition-colors ${
                assignedDays.includes(day.value)
                  ? 'bg-emerald-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {day.label}
            </button>
          ))}
        </div>
        {!daysMatch && (
          <p className="mt-1 mb-3 text-xs text-red-600">Seleccioná exactamente {frequency} día(s).</p>
        )}

        <button
          type="button"
          role="switch"
          aria-checked={hasTransport}
          onClick={() => setHasTransport(v => !v)}
          className={`mt-3 w-full text-left rounded-xl border p-3 transition-colors ${
            hasTransport ? 'border-emerald-300 bg-emerald-50/60' : 'border-gray-200 bg-white hover:bg-gray-50'
          }`}
        >
          <span className="text-sm font-medium text-gray-800">Incluye transporte</span>
        </button>

        {hasTransport && (
          <div className="mt-3">
            <Select
              label="Rango de distancia"
              value={distanceRange}
              onChange={e => setDistanceRange(e.target.value)}
              options={[{ value: '', label: 'Seleccionar…' }, ...DISTANCE_OPTIONS]}
            />
          </div>
        )}
      </div>

      <div className="flex gap-3 justify-end mt-6">
        <Button variant="secondary" onClick={onClose} disabled={loading}>
          Cancelar
        </Button>
        <Button
          variant="success"
          onClick={handleConfirm}
          loading={loading}
          disabled={!canConfirm}
        >
          Confirmar reintegro
        </Button>
      </div>
    </Modal>
  )
}
