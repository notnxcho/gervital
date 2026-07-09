import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors
} from '@dnd-kit/core'
import { format, addDays, subDays, isToday, differenceInCalendarDays, startOfDay, startOfWeek } from 'date-fns'
import { es } from 'date-fns/locale/es'
import { NavArrowLeft, NavArrowRight, Calendar } from 'iconoir-react'
import { getClients, getAttendanceForDate, getAttendanceForDateRange } from '../../services/api'
import { classifyDay, buildDayRoster, indexAttendanceByClientId, RECOVERY_STATUS } from '../../services/attendance/dayRoster'
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
import {
  saveReferenceGroup,
  applyReferenceGroup,
  getReferenceGroupInfo
} from '../../services/groups/referenceGroupService'
import TimeSlotCard from './TimeSlotCard'
import ClientPool from './ClientPool'
import { PoolClientChip } from './ClientChip'
import TemplateModal from './TemplateModal'
import GroupsWeekTable from './GroupsWeekTable'
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
  // Temp ids for optimistic inserts, reconciled with the server id on success
  const tempIdRef = useRef(0)
  const nextTempId = () => `temp-${++tempIdRef.current}`

  const [selectedDate, setSelectedDate] = useState(today)
  const [activeShift, setActiveShift] = useState('morning')
  const [loading, setLoading] = useState(true)
  const [allClients, setAllClients] = useState([])
  const [attendanceByClientId, setAttendanceByClientId] = useState(new Map())
  const [weekAttendanceByDate, setWeekAttendanceByDate] = useState(new Map())
  const [timeSlots, setTimeSlots] = useState([])
  const [showTemplateModal, setShowTemplateModal] = useState(false)
  const [showWeek, setShowWeek] = useState(false)
  const [referenceInfo, setReferenceInfo] = useState({ exists: false, updatedAt: null })
  const [refBusy, setRefBusy] = useState(false)

  // DnD state
  const [draggedClient, setDraggedClient] = useState(null)
  const [invalidDropSlotIds, setInvalidDropSlotIds] = useState(new Set())

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  )

  // Editable si el día es hoy o futuro; solo lectura si ya pasó
  const readOnly = differenceInCalendarDays(today, selectedDate) > 0
  const dateStr = dateToStr(selectedDate)
  const dayName = DAY_NAMES[selectedDate.getDay()]
  const isWeekend = dayName === 'saturday' || dayName === 'sunday'

  // Mon–Fri dates of the selected date's week (for the weekly review)
  const weekDates = useMemo(() => {
    const monday = startOfWeek(selectedDate, { weekStartsOn: 1 })
    const keys = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday']
    return keys.reduce((acc, k, i) => ({ ...acc, [k]: dateToStr(addDays(monday, i)) }), {})
  }, [selectedDate])

  // ── Derived data ──────────────────────────────────────────────────────────

  const clientsById = useMemo(() => {
    const map = new Map()
    allClients.forEach(c => map.set(c.id, c))
    return map
  }, [allClients])

  const dayClassified = useMemo(() => {
    const matchesShift = c => activeShift === 'morning'
      ? (c.plan?.schedule === 'morning' || c.plan?.schedule === 'full_day')
      : (c.plan?.schedule === 'afternoon' || c.plan?.schedule === 'full_day')
    return classifyDay({ clients: allClients, dayName, matchesShift, attendanceByClientId })
  }, [allClients, dayName, activeShift, attendanceByClientId])

  const shiftClients = dayClassified.present

  // Meal counts: global to the day, independent of the active shift tab.
  // Desayuno = mañana + día completo · Almuerzo = solo día completo · Merienda = tarde + día completo.
  const mealCounts = useMemo(() => {
    const countFor = (matchesShift) =>
      buildDayRoster({ clients: allClients, dayName, matchesShift, attendanceByClientId }).length
    return {
      breakfast: countFor(c => c.plan?.schedule === 'morning' || c.plan?.schedule === 'full_day'),
      lunch: countFor(c => c.plan?.schedule === 'full_day'),
      snack: countFor(c => c.plan?.schedule === 'afternoon' || c.plan?.schedule === 'full_day')
    }
  }, [allClients, dayName, attendanceByClientId])

  const recoveryIds = useMemo(() => {
    const ids = new Set()
    attendanceByClientId.forEach((rec, id) => { if (rec.status === RECOVERY_STATUS) ids.add(id) })
    return ids
  }, [attendanceByClientId])

  // Clients assigned to every time slot of the active shift
  const clientsInAllSlots = useMemo(() => {
    const result = new Set()
    if (timeSlots.length === 0) return result
    const slotSets = timeSlots.map(slot => {
      const ids = new Set()
      slot.activities.forEach(a => a.clientIds.forEach(id => ids.add(id)))
      return ids
    })
    for (const id of slotSets[0]) {
      if (slotSets.every(s => s.has(id))) result.add(id)
    }
    return result
  }, [timeSlots])

  // ── Navigation helpers ────────────────────────────────────────────────────

  const canGoBack = differenceInCalendarDays(today, selectedDate) < 14
  const canGoForward = differenceInCalendarDays(selectedDate, today) < 14

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

  const loadSlots = useCallback(async (dStr, shift, { silent = false } = {}) => {
    if (!silent) setLoading(true)
    try {
      const slots = await getTimeSlotsForDate(dStr, shift)
      setTimeSlots(slots)
    } catch (err) {
      console.error('Error loading time slots:', err)
      if (!silent) setTimeSlots([])
    } finally {
      if (!silent) setLoading(false)
    }
  }, [])

  // Reference-group info for the current (weekday, shift)
  useEffect(() => {
    if (isWeekend) { setReferenceInfo({ exists: false, updatedAt: null }); return }
    let alive = true
    getReferenceGroupInfo(dayName, activeShift)
      .then(info => { if (alive) setReferenceInfo(info) })
      .catch(() => { if (alive) setReferenceInfo({ exists: false, updatedAt: null }) })
    return () => { alive = false }
  }, [dayName, activeShift, isWeekend])

  const handleSaveReference = async () => {
    if (referenceInfo.exists && !window.confirm('Ya existe un grupo de referencia para este día y turno. ¿Sobrescribir con la configuración actual?')) return
    setRefBusy(true)
    try {
      await saveReferenceGroup(dateStr, activeShift, dayName)
      const info = await getReferenceGroupInfo(dayName, activeShift)
      setReferenceInfo(info)
    } catch (e) {
      alert('Error al guardar el grupo de referencia: ' + e.message)
    } finally {
      setRefBusy(false)
    }
  }

  const handleApplyReference = async () => {
    if (!referenceInfo.exists) return
    if (timeSlots.length > 0 && !window.confirm('Esto reemplaza todos los grupos y asignaciones de hoy con el grupo de referencia. ¿Continuar?')) return
    setRefBusy(true)
    try {
      const presentIds = shiftClients.map(c => c.id)
      await applyReferenceGroup(dayName, activeShift, dateStr, presentIds)
      await loadSlots(dateStr, activeShift, { silent: true })
    } catch (e) {
      alert('Error al aplicar el grupo de referencia: ' + e.message)
    } finally {
      setRefBusy(false)
    }
  }

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

  // Load actual attendance for the selected date (to reflect absences/recoveries)
  useEffect(() => {
    let cancelled = false
    getAttendanceForDate(dateStr)
      .then(records => { if (!cancelled) setAttendanceByClientId(indexAttendanceByClientId(records)) })
      .catch(err => {
        console.error('Error loading attendance:', err)
        if (!cancelled) setAttendanceByClientId(new Map())
      })
    return () => { cancelled = true }
  }, [dateStr])

  // Load the week's attendance when the weekly review is open (indexed by date → clientId)
  useEffect(() => {
    if (!showWeek) return
    let cancelled = false
    getAttendanceForDateRange(weekDates.monday, weekDates.friday)
      .then(records => {
        if (cancelled) return
        const byDate = new Map()
        for (const r of records) {
          if (!byDate.has(r.date)) byDate.set(r.date, new Map())
          byDate.get(r.date).set(r.clientId, r)
        }
        setWeekAttendanceByDate(byDate)
      })
      .catch(err => {
        console.error('Error loading week attendance:', err)
        if (!cancelled) setWeekAttendanceByDate(new Map())
      })
    return () => { cancelled = true }
  }, [showWeek, weekDates])

  // Load slots when date or shift changes
  useEffect(() => {
    loadSlots(dateStr, activeShift)
  }, [dateStr, activeShift, loadSlots])

  // ── Slot CRUD handlers ────────────────────────────────────────────────────

  async function handleAddSlot() {
    const position = timeSlots.length
    const defaultTime = activeShift === 'morning' ? '09:00' : '15:00'
    const name = `Horario ${position + 1}`
    const tempId = nextTempId()
    const snapshot = timeSlots
    // Optimistic: mostramos el horario al instante, reconciliamos el id real al volver
    setTimeSlots(prev => [...prev, { id: tempId, date: dateStr, shift: activeShift, name, time: defaultTime, position, activities: [] }])
    try {
      const realId = await createTimeSlot(dateStr, activeShift, { name, time: defaultTime, position })
      setTimeSlots(prev => prev.map(s => s.id === tempId ? { ...s, id: realId } : s))
    } catch (err) {
      console.error('Error creating time slot:', err)
      setTimeSlots(snapshot)
    }
  }

  async function handleUpdateSlot(slotId, fields) {
    const snapshot = timeSlots
    setTimeSlots(prev => prev.map(s => s.id === slotId ? { ...s, ...fields } : s))
    try {
      await updateTimeSlot(slotId, fields)
    } catch (err) {
      console.error('Error updating time slot:', err)
      setTimeSlots(snapshot)
    }
  }

  async function handleDeleteSlot(slotId) {
    const snapshot = timeSlots
    setTimeSlots(prev => prev.filter(s => s.id !== slotId))
    try {
      await deleteTimeSlot(slotId)
    } catch (err) {
      console.error('Error deleting time slot:', err)
      setTimeSlots(snapshot)
    }
  }

  // ── Activity CRUD handlers ────────────────────────────────────────────────

  async function handleAddActivity(slotId) {
    const slot = timeSlots.find(s => s.id === slotId)
    const position = slot ? slot.activities.length : 0
    const name = 'Nueva actividad'
    const tempId = nextTempId()
    const snapshot = timeSlots
    setTimeSlots(prev => prev.map(s =>
      s.id !== slotId ? s : { ...s, activities: [...s.activities, { id: tempId, name, responsible: null, position, clientIds: [] }] }
    ))
    try {
      const realId = await createActivity(slotId, { name, responsible: null, position })
      setTimeSlots(prev => prev.map(s =>
        s.id !== slotId ? s : { ...s, activities: s.activities.map(a => a.id === tempId ? { ...a, id: realId } : a) }
      ))
    } catch (err) {
      console.error('Error creating activity:', err)
      setTimeSlots(snapshot)
    }
  }

  async function handleUpdateActivity(activityId, fields) {
    const snapshot = timeSlots
    setTimeSlots(prev => prev.map(s => ({
      ...s,
      activities: s.activities.map(a => a.id === activityId ? { ...a, ...fields } : a)
    })))
    try {
      await updateActivity(activityId, fields)
    } catch (err) {
      console.error('Error updating activity:', err)
      setTimeSlots(snapshot)
    }
  }

  async function handleDeleteActivity(activityId) {
    const snapshot = timeSlots
    setTimeSlots(prev => prev.map(s => ({
      ...s,
      activities: s.activities.filter(a => a.id !== activityId)
    })))
    try {
      await deleteActivity(activityId)
    } catch (err) {
      console.error('Error deleting activity:', err)
      setTimeSlots(snapshot)
    }
  }

  // ── Client assignment handlers ────────────────────────────────────────────

  async function handleRemoveClient(activityId, clientId) {
    // Optimistic: drop the chip immediately, restore snapshot if the delete fails
    const snapshot = timeSlots
    setTimeSlots(prev => prev.map(slot => ({
      ...slot,
      activities: slot.activities.map(a =>
        a.id !== activityId ? a : { ...a, clientIds: a.clientIds.filter(id => id !== clientId) }
      )
    })))
    try {
      await removeClientFromActivity(activityId, clientId)
    } catch (err) {
      console.error('Error removing client:', err)
      setTimeSlots(snapshot)
    }
  }

  // ── DnD handlers ──────────────────────────────────────────────────────────

  function handleDragStart({ active }) {
    const data = active.data.current
    if (data?.type !== 'pool-client' && data?.type !== 'assigned-client') return

    setDraggedClient(data.client)

    // Slots where this client already has an assignment are invalid drop targets
    // (a client can only be in one activity per time slot). When moving an existing
    // assignment, the source slot stays valid — we vacate the source activity first.
    const ids = new Set()
    for (const slot of timeSlots) {
      if (data.type === 'assigned-client' && slot.id === data.sourceSlotId) continue
      for (const activity of slot.activities) {
        if (activity.clientIds.includes(data.client.id)) {
          ids.add(slot.id)
          break
        }
      }
    }
    setInvalidDropSlotIds(ids)
  }

  function handleDragEnd({ active, over }) {
    const client = draggedClient
    const activeType = active.data.current?.type
    setDraggedClient(null)
    setInvalidDropSlotIds(new Set())

    if (!over || !client) return

    const overData = over.data.current
    if (overData?.type !== 'activity') return

    const { activityId, slotId } = overData

    if (activeType === 'assigned-client') {
      const { sourceActivityId } = active.data.current
      if (sourceActivityId === activityId) return // dropped back on the same activity

      // Validate: client must not already be in another activity of the target slot
      const targetSlot = timeSlots.find(s => s.id === slotId)
      if (targetSlot) {
        const alreadyInSlot = targetSlot.activities.some(a =>
          a.id !== sourceActivityId && a.clientIds.includes(client.id)
        )
        if (alreadyInSlot) return
      }

      // Optimistic move: remove from source activity, add to target
      const snapshot = timeSlots
      setTimeSlots(prev => prev.map(slot => ({
        ...slot,
        activities: slot.activities.map(a => {
          if (a.id === sourceActivityId) return { ...a, clientIds: a.clientIds.filter(id => id !== client.id) }
          if (a.id === activityId) return { ...a, clientIds: [...a.clientIds, client.id] }
          return a
        })
      })))

      // Vaciar el origen ANTES de asignar el destino: el trigger
      // enforce_one_activity_per_slot rechaza el insert si el cliente sigue
      // asignado a otra actividad del mismo horario (por eso no van en paralelo)
      removeClientFromActivity(sourceActivityId, client.id)
        .then(() => assignClientToActivity(activityId, client.id))
        .catch(err => {
          console.error('Error moving client:', err)
          setTimeSlots(snapshot)
        })
      return
    }

    if (activeType !== 'pool-client') return

    // Validate: client must not already be in another activity of the same time slot
    const targetSlot = timeSlots.find(s => s.id === slotId)
    if (targetSlot) {
      const alreadyInSlot = targetSlot.activities.some(a => a.clientIds.includes(client.id))
      if (alreadyInSlot) return
    }

    // Optimistic: show the chip immediately, roll back if the insert fails
    setTimeSlots(prev => prev.map(slot =>
      slot.id !== slotId ? slot : {
        ...slot,
        activities: slot.activities.map(a =>
          a.id !== activityId ? a : { ...a, clientIds: [...a.clientIds, client.id] }
        )
      }
    ))

    assignClientToActivity(activityId, client.id)
      .catch(err => {
        console.error('Error assigning client:', err)
        setTimeSlots(prev => prev.map(slot =>
          slot.id !== slotId ? slot : {
            ...slot,
            activities: slot.activities.map(a =>
              a.id !== activityId ? a : { ...a, clientIds: a.clientIds.filter(id => id !== client.id) }
            )
          }
        ))
      })
  }

  // ── Render ────────────────────────────────────────────────────────────────

  const formattedDate = format(selectedDate, "EEEE d 'de' MMMM, yyyy", { locale: es })

  // Toolbar arriba de la columna de horarios: switch de turno (izq) + agregar horario (der)
  const shiftToolbar = (
    <div className="flex items-center justify-between gap-3 mb-4">
      <div className="flex gap-1 bg-gray-100 rounded-lg p-1 w-fit">
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
      {!readOnly && !isWeekend && (
        <button
          onClick={handleAddSlot}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 bg-white border border-gray-200 hover:bg-gray-50 rounded-lg transition-colors"
        >
          + Agregar horario
        </button>
      )}
    </div>
  )

  return (
    <div className="bg-gray-50 min-h-screen -mt-8 -mx-4 sm:-mx-6 lg:-mx-8 px-4 sm:px-6 lg:px-8 py-8">
      {/* Page header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">Grupos del día</h1>
            <p className="text-sm text-gray-500 mt-0.5 capitalize">{formattedDate}</p>
          </div>
          <Button
            variant="secondary"
            onClick={() => setShowWeek(true)}
          >
            <Calendar className="w-4 h-4" />
            Ver semana
          </Button>
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
          {!readOnly && !isWeekend && (
            <>
              <Button
                variant="secondary"
                onClick={handleSaveReference}
                disabled={refBusy}
                title={referenceInfo.updatedAt ? `Última actualización: ${format(new Date(referenceInfo.updatedAt), "d MMM yyyy HH:mm", { locale: es })}` : 'Sin referencia guardada'}
              >
                Guardar grupo de referencia
              </Button>
              <Button
                variant="secondary"
                onClick={handleApplyReference}
                disabled={refBusy || !referenceInfo.exists}
              >
                Aplicar grupo de referencia
              </Button>
            </>
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
        {/* Meal counts: global to the day, en un solo container con divisores */}
        {!isWeekend && (
          <div className="flex items-center ml-2 bg-white border border-gray-200 rounded-lg divide-x divide-gray-200">
            <MealCountBadge label="Desayuno" count={mealCounts.breakfast} />
            <MealCountBadge label="Almuerzo" count={mealCounts.lunch} />
            <MealCountBadge label="Merienda" count={mealCounts.snack} />
          </div>
        )}
      </div>

      {/* Main content */}
      {isWeekend ? (
        <>
          {shiftToolbar}
          <div className="text-center py-16 text-gray-400">
            <Calendar className="w-10 h-10 mx-auto mb-3 opacity-40" />
            <p className="text-base font-medium">No hay asistentes programados para este día</p>
            <p className="text-sm mt-1">El club no opera los fines de semana</p>
          </div>
        </>
      ) : (
        <DndContext
          sensors={sensors}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <div className="flex gap-0 min-h-[60vh]">
            {/* Time slots area: toolbar arriba + contenido */}
            <div className="flex-1 min-w-0 pr-0">
              {shiftToolbar}
              {loading ? (
                <div className="flex items-center justify-center py-16">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
                </div>
              ) : timeSlots.length === 0 ? (
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
                      invalidDropSlotIds={invalidDropSlotIds}
                      draggedClientId={draggedClient?.id || null}
                      recoveryIds={recoveryIds}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* Client pool sidebar (sube al tope, en línea con la toolbar) */}
            <ClientPool
              clients={shiftClients}
              clientsInAllSlots={clientsInAllSlots}
              recoveryIds={recoveryIds}
              absentClients={dayClassified.absent}
              vacationClients={dayClassified.vacation}
            />
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

      {/* Template modal */}
      <TemplateModal
        isOpen={showTemplateModal}
        onClose={() => setShowTemplateModal(false)}
        activeShift={activeShift}
        dateStr={dateStr}
        hasExistingData={timeSlots.length > 0}
        onApplied={() => loadSlots(dateStr, activeShift, { silent: true })}
      />

      <GroupsWeekTable
        isOpen={showWeek}
        onClose={() => setShowWeek(false)}
        clients={allClients}
        weekDates={weekDates}
        attendanceByDate={weekAttendanceByDate}
      />
    </div>
  )
}

// Compact counter for one of the day's meals (just the number, not the roster).
function MealCountBadge({ label, count }) {
  return (
    <div className="flex items-center gap-2 px-3 py-2">
      <span className="text-sm text-gray-500">{label}</span>
      <span className="text-base font-semibold text-gray-900 tabular-nums">{count}</span>
    </div>
  )
}
