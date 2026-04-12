import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors
} from '@dnd-kit/core'
import { format, addDays, subDays, isToday, differenceInCalendarDays, startOfDay } from 'date-fns'
import { es } from 'date-fns/locale/es'
import { NavArrowLeft, NavArrowRight, Calendar } from 'iconoir-react'
import { getClients } from '../../services/api'
import {
  getTimeSlotsForDate,
  createTimeSlot,
  updateTimeSlot,
  deleteTimeSlot,
  createActivity,
  updateActivity,
  deleteActivity,
  assignClientToActivity,
  removeClientFromActivity,
  cleanupOldGroups
} from '../../services/groups/groupService'
import TimeSlotCard from './TimeSlotCard'
import ClientPool from './ClientPool'
import { PoolClientChip } from './ClientChip'
import Button from '../../components/ui/Button'

// ── Constants ─────────────────────────────────────────────────────────────────

const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']

function dateToStr(d) {
  return format(d, 'yyyy-MM-dd')
}

// ── DailyGroups (main) ───────────────────────────────────────────────────────

export default function DailyGroups() {
  const today = useMemo(() => startOfDay(new Date()), [])
  const cleanupDone = useRef(false)

  const [selectedDate, setSelectedDate] = useState(today)
  const [activeShift, setActiveShift] = useState('morning')
  const [loading, setLoading] = useState(true)
  const [allClients, setAllClients] = useState([])
  const [timeSlots, setTimeSlots] = useState([])
  const [showTemplateModal, setShowTemplateModal] = useState(false)

  // DnD state
  const [draggedClient, setDraggedClient] = useState(null)
  const [invalidDropSlotId, setInvalidDropSlotId] = useState(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  )

  const readOnly = !isToday(selectedDate)
  const dateStr = dateToStr(selectedDate)
  const dayName = DAY_NAMES[selectedDate.getDay()]
  const isWeekend = dayName === 'saturday' || dayName === 'sunday'

  // ── Derived data ──────────────────────────────────────────────────────────

  const clientsById = useMemo(() => {
    const map = new Map()
    allClients.forEach(c => map.set(c.id, c))
    return map
  }, [allClients])

  const shiftClients = useMemo(() => {
    return allClients.filter(c =>
      c.plan?.assignedDays?.includes(dayName) &&
      (activeShift === 'morning'
        ? (c.plan?.schedule === 'morning' || c.plan?.schedule === 'full_day')
        : (c.plan?.schedule === 'afternoon' || c.plan?.schedule === 'full_day'))
    )
  }, [allClients, dayName, activeShift])

  // ── Navigation helpers ────────────────────────────────────────────────────

  const canGoBack = differenceInCalendarDays(today, selectedDate) < 14
  const canGoForward = !isToday(selectedDate)

  function goBack() {
    if (canGoBack) setSelectedDate(prev => subDays(prev, 1))
  }

  function goForward() {
    if (canGoForward) setSelectedDate(prev => addDays(prev, 1))
  }

  function goToday() {
    setSelectedDate(today)
  }

  // ── Data loading ──────────────────────────────────────────────────────────

  const loadSlots = useCallback(async (dStr, shift) => {
    setLoading(true)
    try {
      const slots = await getTimeSlotsForDate(dStr, shift)
      setTimeSlots(slots)
    } catch (err) {
      console.error('Error loading time slots:', err)
      setTimeSlots([])
    } finally {
      setLoading(false)
    }
  }, [])

  // Initial load: cleanup + load clients
  useEffect(() => {
    async function init() {
      if (!cleanupDone.current) {
        cleanupDone.current = true
        await cleanupOldGroups(dateToStr(today)).catch(() => {})
      }
      try {
        const clients = await getClients()
        setAllClients(clients)
      } catch (err) {
        console.error('Error loading clients:', err)
      }
    }
    init()
  }, [today])

  // Load slots when date or shift changes
  useEffect(() => {
    loadSlots(dateStr, activeShift)
  }, [dateStr, activeShift, loadSlots])

  // ── Slot CRUD handlers ────────────────────────────────────────────────────

  async function handleAddSlot() {
    try {
      const position = timeSlots.length
      const defaultTime = activeShift === 'morning' ? '09:00' : '15:00'
      await createTimeSlot(dateStr, activeShift, {
        name: `Horario ${position + 1}`,
        time: defaultTime,
        position
      })
      await loadSlots(dateStr, activeShift)
    } catch (err) {
      console.error('Error creating time slot:', err)
    }
  }

  async function handleUpdateSlot(slotId, fields) {
    try {
      await updateTimeSlot(slotId, fields)
      await loadSlots(dateStr, activeShift)
    } catch (err) {
      console.error('Error updating time slot:', err)
    }
  }

  async function handleDeleteSlot(slotId) {
    try {
      await deleteTimeSlot(slotId)
      await loadSlots(dateStr, activeShift)
    } catch (err) {
      console.error('Error deleting time slot:', err)
    }
  }

  // ── Activity CRUD handlers ────────────────────────────────────────────────

  async function handleAddActivity(slotId) {
    try {
      const slot = timeSlots.find(s => s.id === slotId)
      const position = slot ? slot.activities.length : 0
      await createActivity(slotId, {
        name: 'Nueva actividad',
        responsible: null,
        position
      })
      await loadSlots(dateStr, activeShift)
    } catch (err) {
      console.error('Error creating activity:', err)
    }
  }

  async function handleUpdateActivity(activityId, fields) {
    try {
      await updateActivity(activityId, fields)
      await loadSlots(dateStr, activeShift)
    } catch (err) {
      console.error('Error updating activity:', err)
    }
  }

  async function handleDeleteActivity(activityId) {
    try {
      await deleteActivity(activityId)
      await loadSlots(dateStr, activeShift)
    } catch (err) {
      console.error('Error deleting activity:', err)
    }
  }

  // ── Client assignment handlers ────────────────────────────────────────────

  async function handleRemoveClient(activityId, clientId) {
    try {
      await removeClientFromActivity(activityId, clientId)
      await loadSlots(dateStr, activeShift)
    } catch (err) {
      console.error('Error removing client:', err)
    }
  }

  // ── DnD handlers ──────────────────────────────────────────────────────────

  function handleDragStart({ active }) {
    const data = active.data.current
    if (data?.type === 'pool-client') {
      setDraggedClient(data.client)

      // Check if this client is already in any activity of any slot
      // If so, mark that slot as invalid for additional drops
      for (const slot of timeSlots) {
        for (const activity of slot.activities) {
          if (activity.clientIds.includes(data.client.id)) {
            setInvalidDropSlotId(slot.id)
            return
          }
        }
      }
      setInvalidDropSlotId(null)
    }
  }

  function handleDragEnd({ active, over }) {
    const client = draggedClient
    setDraggedClient(null)
    setInvalidDropSlotId(null)

    if (!over || !client) return

    const overData = over.data.current
    if (active.data.current?.type !== 'pool-client' || overData?.type !== 'activity') return

    const { activityId, slotId } = overData

    // Validate: client must not already be in another activity of the same time slot
    const targetSlot = timeSlots.find(s => s.id === slotId)
    if (targetSlot) {
      const alreadyInSlot = targetSlot.activities.some(a => a.clientIds.includes(client.id))
      if (alreadyInSlot) return
    }

    assignClientToActivity(activityId, client.id)
      .then(() => loadSlots(dateStr, activeShift))
      .catch(err => console.error('Error assigning client:', err))
  }

  // ── Render ────────────────────────────────────────────────────────────────

  const formattedDate = format(selectedDate, "EEEE d 'de' MMMM, yyyy", { locale: es })

  return (
    <div className="bg-gray-50 min-h-screen -mt-8 -mx-4 sm:-mx-6 lg:-mx-8 px-4 sm:px-6 lg:px-8 py-8">
      {/* Page header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Grupos del día</h1>
          <p className="text-sm text-gray-500 mt-0.5 capitalize">{formattedDate}</p>
        </div>
        <div className="flex items-center gap-3">
          {!readOnly && (
            <Button
              variant="secondary"
              onClick={() => setShowTemplateModal(true)}
            >
              Plantillas
            </Button>
          )}
        </div>
      </div>

      {/* Day navigation */}
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={goBack}
          disabled={!canGoBack}
          className="p-2 rounded-lg border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          title="Día anterior"
        >
          <NavArrowLeft className="w-4 h-4" />
        </button>
        <button
          onClick={goToday}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
            isToday(selectedDate)
              ? 'bg-indigo-600 text-white'
              : 'bg-white border border-gray-200 text-gray-700 hover:bg-gray-50'
          }`}
        >
          <Calendar className="w-4 h-4" />
          Hoy
        </button>
        <button
          onClick={goForward}
          disabled={!canGoForward}
          className="p-2 rounded-lg border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          title="Día siguiente"
        >
          <NavArrowRight className="w-4 h-4" />
        </button>
        {readOnly && (
          <span className="text-xs text-amber-600 bg-amber-50 border border-amber-200 px-2.5 py-1 rounded-lg font-medium">
            Solo lectura
          </span>
        )}
      </div>

      {/* Shift tabs */}
      <div className="flex gap-1 mb-6 bg-gray-100 rounded-lg p-1 w-fit">
        {[
          { key: 'morning', label: 'Mañana' },
          { key: 'afternoon', label: 'Tarde' }
        ].map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveShift(tab.key)}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              activeShift === tab.key
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Main content */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
        </div>
      ) : isWeekend ? (
        <div className="text-center py-16 text-gray-400">
          <Calendar className="w-10 h-10 mx-auto mb-3 opacity-40" />
          <p className="text-base font-medium">No hay asistentes programados para este día</p>
          <p className="text-sm mt-1">El club no opera los fines de semana</p>
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <div className="flex gap-0 min-h-[60vh]">
            {/* Time slots area */}
            <div className="flex-1 min-w-0 pr-0">
              {/* Add slot button (today only) */}
              {!readOnly && (
                <div className="mb-4">
                  <button
                    onClick={handleAddSlot}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 bg-white border border-gray-200 hover:bg-gray-50 rounded-lg transition-colors"
                  >
                    + Agregar horario
                  </button>
                </div>
              )}

              {timeSlots.length === 0 ? (
                <div className="text-center py-12 text-gray-400 text-sm border border-dashed border-gray-200 rounded-xl">
                  {readOnly
                    ? 'No hubo horarios programados para este día'
                    : 'No hay horarios. Agregá uno o aplicá una plantilla.'}
                </div>
              ) : (
                <div className="flex flex-col gap-4">
                  {timeSlots.map(slot => (
                    <TimeSlotCard
                      key={slot.id}
                      slot={slot}
                      clientsById={clientsById}
                      onRemoveClient={handleRemoveClient}
                      onUpdateSlot={handleUpdateSlot}
                      onDeleteSlot={handleDeleteSlot}
                      onAddActivity={handleAddActivity}
                      onUpdateActivity={handleUpdateActivity}
                      onDeleteActivity={handleDeleteActivity}
                      readOnly={readOnly}
                      invalidDropSlotId={invalidDropSlotId}
                      draggedClientId={draggedClient?.id || null}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* Client pool sidebar */}
            <ClientPool clients={shiftClients} />
          </div>

          {/* Drag overlay */}
          <DragOverlay dropAnimation={null}>
            {draggedClient && (
              <div className="opacity-90 pointer-events-none">
                <PoolClientChip client={draggedClient} />
              </div>
            )}
          </DragOverlay>
        </DndContext>
      )}

      {/* Template modal placeholder — will be implemented in Task 7 */}
      {/* {showTemplateModal && <TemplateModal ... />} */}
    </div>
  )
}
