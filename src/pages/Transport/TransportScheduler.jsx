import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { format, addDays, subDays, isWeekend, nextMonday, previousFriday } from 'date-fns'
import { es } from 'date-fns/locale'
import { NavArrowLeft, NavArrowRight, Refresh } from 'iconoir-react'
import {
  getTransportClients,
  filterClientsForShift,
  getArrangementForDate,
  saveTransportDay,
  findLastWeekdayArrangement,
  copyArrangementFromDate,
  buildDefaultFleet
} from '../../services/transport/transportService'
import { SHIFTS, DAY_NAMES, DAY_LABELS_ES } from '../../services/transport/transportConstants'
import TransportMap from './TransportMap'
import CarAssignmentPanel from './CarAssignmentPanel'
import Modal from '../../components/ui/Modal'
import Button from '../../components/ui/Button'

function getDateStr(date) {
  return format(date, 'yyyy-MM-dd')
}

function skipWeekend(date, direction) {
  const next = direction === 'next' ? addDays(date, 1) : subDays(date, 1)
  if (isWeekend(next)) {
    return direction === 'next' ? nextMonday(next) : previousFriday(next)
  }
  return next
}

function buildEmptyShifts() {
  return {
    morning_arrive: { cars: buildDefaultFleet(), unassigned: [] },
    morning_leave: { cars: buildDefaultFleet(), unassigned: [] },
    afternoon_arrive: { cars: buildDefaultFleet(), unassigned: [] },
    afternoon_leave: { cars: buildDefaultFleet(), unassigned: [] }
  }
}

export default function TransportScheduler() {
  const [currentDate, setCurrentDate] = useState(() => {
    const today = new Date()
    return isWeekend(today) ? nextMonday(today) : today
  })
  const [activeShift, setActiveShift] = useState('morning_arrive')
  const [shifts, setShifts] = useState(buildEmptyShifts)
  const [isDirty, setIsDirty] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [allClients, setAllClients] = useState([])
  const [lastWeekdayAvailable, setLastWeekdayAvailable] = useState(false)
  const [showRepeatConfirm, setShowRepeatConfirm] = useState(false)
  const [showUnsavedConfirm, setShowUnsavedConfirm] = useState(null)
  const [showSaveWarning, setShowSaveWarning] = useState(false)
  const [highlightedClient, setHighlightedClient] = useState(null)
  const [error, setError] = useState(null)
  const [toast, setToast] = useState(null)

  const dateStr = getDateStr(currentDate)
  const dayName = DAY_NAMES[currentDate.getDay()]
  const dayLabelEs = DAY_LABELS_ES[dayName] || dayName

  const clientsById = useMemo(() => {
    const map = new Map()
    allClients.forEach(c => map.set(c.id, c))
    return map
  }, [allClients])

  const shiftClients = useMemo(() => {
    return filterClientsForShift(allClients, activeShift, dayName)
  }, [allClients, activeShift, dayName])

  const totalDayClients = useMemo(() => {
    const ids = new Set()
    SHIFTS.forEach(s => {
      filterClientsForShift(allClients, s.id, dayName).forEach(c => ids.add(c.id))
    })
    return ids.size
  }, [allClients, dayName])

  const shiftCounts = useMemo(() => {
    const counts = {}
    SHIFTS.forEach(s => {
      counts[s.id] = filterClientsForShift(allClients, s.id, dayName).length
    })
    return counts
  }, [allClients, dayName])

  // ── Load data ─────────────────────────────────────────────────────────────

  const loadDay = useCallback(async (date) => {
    setLoading(true)
    setError(null)
    try {
      const dStr = getDateStr(date)
      const dName = DAY_NAMES[date.getDay()]

      const [clients, arrangement, lastWeekday] = await Promise.all([
        getTransportClients(),
        getArrangementForDate(dStr),
        findLastWeekdayArrangement(dStr)
      ])

      setAllClients(clients)
      setLastWeekdayAvailable(!!lastWeekday)

      if (arrangement) {
        const newShifts = {}
        for (const shift of SHIFTS) {
          const shiftClients = filterClientsForShift(clients, shift.id, dName)
          const shiftClientIds = new Set(shiftClients.map(c => c.id))
          const savedShift = arrangement.shifts[shift.id] || { cars: [] }

          const cars = savedShift.cars.map(car => ({
            ...car,
            memberIds: (car.memberIds || []).filter(id => shiftClientIds.has(id))
          }))

          const assignedIds = new Set(cars.flatMap(c => c.memberIds))
          const unassigned = shiftClients
            .filter(c => !assignedIds.has(c.id))
            .map(c => c.id)

          newShifts[shift.id] = { cars, unassigned }
        }
        setShifts(newShifts)
      } else {
        const newShifts = {}
        for (const shift of SHIFTS) {
          const eligible = filterClientsForShift(clients, shift.id, dName)
          newShifts[shift.id] = {
            cars: buildDefaultFleet(),
            unassigned: eligible.map(c => c.id)
          }
        }
        setShifts(newShifts)
      }

      setIsDirty(false)
    } catch (err) {
      console.error('Error loading transport day:', err)
      setError('Error al cargar los datos de transporte')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadDay(currentDate)
  }, [currentDate, loadDay])

  // ── Navigation ────────────────────────────────────────────────────────────

  function navigateDay(direction) {
    const target = skipWeekend(currentDate, direction)
    if (isDirty) {
      setShowUnsavedConfirm(target)
    } else {
      setCurrentDate(target)
    }
  }

  function confirmNavigate() {
    const target = showUnsavedConfirm
    setShowUnsavedConfirm(null)
    setIsDirty(false)
    setCurrentDate(target)
  }

  // ── Shift state change (ref to avoid stale closure during DnD) ─────────

  const activeShiftRef = useRef(activeShift)
  activeShiftRef.current = activeShift

  const handleShiftStateChange = useCallback((updater) => {
    setShifts(prev => {
      const activeKey = activeShiftRef.current
      const newShiftState = typeof updater === 'function'
        ? updater(prev[activeKey])
        : updater
      return { ...prev, [activeKey]: newShiftState }
    })
    setIsDirty(true)
  }, [])

  // ── Save ──────────────────────────────────────────────────────────────────

  async function handleSave() {
    const totalUnassigned = Object.values(shifts).reduce((sum, s) => sum + s.unassigned.length, 0)
    if (totalUnassigned > 0) {
      setShowSaveWarning(true)
      return
    }
    await doSave()
  }

  async function doSave() {
    setShowSaveWarning(false)
    setSaving(true)
    try {
      await saveTransportDay(dateStr, shifts)
      setIsDirty(false)
      setToast({ type: 'success', message: `Transporte del ${format(currentDate, "d 'de' MMMM", { locale: es })} guardado` })
      setTimeout(() => setToast(null), 3000)
    } catch (err) {
      console.error('Error saving transport day:', err)
      setToast({ type: 'error', message: 'Error al guardar. Intentá nuevamente.' })
      setTimeout(() => setToast(null), 5000)
    } finally {
      setSaving(false)
    }
  }

  // ── Repeat last weekday ───────────────────────────────────────────────────

  async function handleRepeatLastWeekday() {
    setShowRepeatConfirm(true)
  }

  async function confirmRepeat() {
    setShowRepeatConfirm(false)
    setLoading(true)
    try {
      const lastArrangement = await findLastWeekdayArrangement(dateStr)
      if (!lastArrangement) return

      const sourceData = await copyArrangementFromDate(lastArrangement.date)
      if (!sourceData) return

      const newShifts = {}
      for (const shift of SHIFTS) {
        const eligible = filterClientsForShift(allClients, shift.id, dayName)
        const eligibleIds = new Set(eligible.map(c => c.id))
        const savedShift = sourceData.shifts[shift.id] || { cars: [] }

        const cars = savedShift.cars.map(car => ({
          ...car,
          id: `temp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          memberIds: (car.memberIds || []).filter(id => eligibleIds.has(id))
        }))

        const assignedIds = new Set(cars.flatMap(c => c.memberIds))
        const unassigned = eligible.filter(c => !assignedIds.has(c.id)).map(c => c.id)

        newShifts[shift.id] = { cars, unassigned }
      }

      setShifts(newShifts)
      setIsDirty(true)
    } catch (err) {
      console.error('Error repeating arrangement:', err)
    } finally {
      setLoading(false)
    }
  }

  // ── Pin click → highlight ─────────────────────────────────────────────────

  function handlePinClick(clientId) {
    setHighlightedClient(clientId)
    setTimeout(() => setHighlightedClient(null), 2000)
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="bg-gray-50 min-h-screen -mt-8 -mx-4 sm:-mx-6 lg:-mx-8 flex flex-col" style={{ height: 'calc(100vh - 64px)' }}>
      {/* Toast notification */}
      {toast && (
        <div className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-lg shadow-lg text-sm font-medium ${
          toast.type === 'success' ? 'bg-green-50 text-green-800 border border-green-200' : 'bg-red-50 text-red-800 border border-red-200'
        }`}>
          {toast.message}
        </div>
      )}

      {/* Top Bar */}
      <div className="bg-white border-b border-gray-200 px-4 sm:px-6 lg:px-8 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigateDay('prev')}
            className="p-1.5 bg-indigo-50 text-indigo-600 rounded-lg hover:bg-indigo-100 transition-colors"
          >
            <NavArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-base font-bold text-gray-900 capitalize">
              {format(currentDate, "EEEE d 'de' MMMM, yyyy", { locale: es })}
            </h1>
            <p className="text-xs text-gray-500">
              {totalDayClients} asistente{totalDayClients !== 1 ? 's' : ''} con transporte
            </p>
          </div>
          <button
            onClick={() => navigateDay('next')}
            className="p-1.5 bg-indigo-50 text-indigo-600 rounded-lg hover:bg-indigo-100 transition-colors"
          >
            <NavArrowRight className="w-5 h-5" />
          </button>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={handleRepeatLastWeekday}
            disabled={!lastWeekdayAvailable || loading}
            title={lastWeekdayAvailable ? undefined : `No hay datos previos para ${dayLabelEs}`}
          >
            <Refresh className="w-4 h-4" />
            Repetir último {dayLabelEs}
          </Button>
          <Button
            size="sm"
            onClick={handleSave}
            loading={saving}
            disabled={loading}
          >
            Guardar día
          </Button>
        </div>
      </div>

      {/* Shift Tabs */}
      <div className="bg-white border-b border-gray-200 px-4 sm:px-6 lg:px-8 flex">
        {SHIFTS.map(shift => (
          <button
            key={shift.id}
            onClick={() => setActiveShift(shift.id)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              activeShift === shift.id
                ? 'border-indigo-500 text-indigo-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            {shift.label} · {shift.time}
            <span className={`ml-2 inline-flex items-center justify-center px-1.5 py-0.5 text-xs rounded-full ${
              activeShift === shift.id
                ? 'bg-indigo-100 text-indigo-600'
                : 'bg-gray-100 text-gray-500'
            }`}>
              {shiftCounts[shift.id] || 0}
            </span>
          </button>
        ))}
      </div>

      {/* Main content */}
      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
        </div>
      ) : error ? (
        <div className="flex-1 flex flex-col items-center justify-center text-gray-500 gap-3">
          <p className="text-sm">{error}</p>
          <Button variant="secondary" size="sm" onClick={() => { setError(null); loadDay(currentDate) }}>
            Reintentar
          </Button>
        </div>
      ) : shiftClients.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">
          No hay asistentes con transporte para este turno
        </div>
      ) : (
        <div className="flex-1 flex overflow-hidden">
          <TransportMap
            shiftClients={shiftClients}
            shiftState={shifts[activeShift]}
            onPinClick={handlePinClick}
            highlightedClient={highlightedClient}
          />
          <CarAssignmentPanel
            shiftState={shifts[activeShift]}
            onStateChange={handleShiftStateChange}
            clientsById={clientsById}
          />
        </div>
      )}

      {/* Unsaved changes modal */}
      <Modal isOpen={!!showUnsavedConfirm} onClose={() => setShowUnsavedConfirm(null)} title="Cambios sin guardar" size="sm">
        <p className="text-gray-600 mb-6">Tenés cambios sin guardar. ¿Querés descartarlos?</p>
        <div className="flex gap-3 justify-end">
          <Button variant="secondary" onClick={() => setShowUnsavedConfirm(null)}>Cancelar</Button>
          <Button variant="danger" onClick={confirmNavigate}>Descartar</Button>
        </div>
      </Modal>

      {/* Repeat confirm modal */}
      <Modal isOpen={showRepeatConfirm} onClose={() => setShowRepeatConfirm(false)} title="Repetir configuración" size="sm">
        <p className="text-gray-600 mb-6">
          Esto reemplazará la configuración actual de todos los turnos del día. ¿Continuar?
        </p>
        <div className="flex gap-3 justify-end">
          <Button variant="secondary" onClick={() => setShowRepeatConfirm(false)}>Cancelar</Button>
          <Button onClick={confirmRepeat}>Confirmar</Button>
        </div>
      </Modal>

      {/* Save with unassigned warning */}
      <Modal isOpen={showSaveWarning} onClose={() => setShowSaveWarning(false)} title="Asistentes sin asignar" size="sm">
        <p className="text-gray-600 mb-6">
          Hay asistentes sin asignar a un auto. ¿Guardar de todos modos?
        </p>
        <div className="flex gap-3 justify-end">
          <Button variant="secondary" onClick={() => setShowSaveWarning(false)}>Cancelar</Button>
          <Button onClick={doSave}>Guardar</Button>
        </div>
      </Modal>
    </div>
  )
}
