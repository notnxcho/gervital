import { useState, useEffect, useCallback, useRef } from 'react'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter
} from '@dnd-kit/core'
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Plus, Trash, EditPencil, Check, Refresh, Sparks } from 'iconoir-react'
import { getClients } from '../../services/api'
import {
  getGroupsForDate,
  saveShiftGroups,
  updateGroupName,
  deleteGroup,
  cleanupPastGroups
} from '../../services/groups/groupService'
import Modal from '../../components/ui/Modal'
import Button from '../../components/ui/Button'

// ── Constants ─────────────────────────────────────────────────────────────────

const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']

const COGNITIVE_LEVEL_COLORS = {
  A: 'bg-green-100 text-green-700 border-green-200',
  B: 'bg-blue-100 text-blue-700 border-blue-200',
  C: 'bg-amber-100 text-amber-700 border-amber-200',
  D: 'bg-red-100 text-red-700 border-red-200'
}

const COGNITIVE_LEVEL_ORDER = ['A', 'B', 'C', 'D']

function getTodayStr() {
  return new Date().toISOString().slice(0, 10)
}

function getTodayName() {
  return DAY_NAMES[new Date().getDay()]
}

// ── Debounce helper ───────────────────────────────────────────────────────────

function useDebounce(fn, delay) {
  const timer = useRef(null)
  const stable = useCallback(
    (...args) => {
      clearTimeout(timer.current)
      timer.current = setTimeout(() => fn(...args), delay)
    },
    [fn, delay]
  )
  return stable
}

// ── DragHandle ────────────────────────────────────────────────────────────────

function DragHandle({ listeners, attributes }) {
  return (
    <div
      {...listeners}
      {...attributes}
      className="cursor-grab active:cursor-grabbing p-1 text-gray-400 hover:text-gray-600 flex-shrink-0"
      title="Arrastrar"
    >
      {/* 6-dot grip: 2 cols × 3 rows */}
      <div className="grid grid-cols-2 gap-[4px]">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="w-[4px] h-[4px] rounded-full bg-current" />
        ))}
      </div>
    </div>
  )
}

// ── ClientCard ────────────────────────────────────────────────────────────────

function ClientCard({ client, editMode, sortableProps, isOverlay }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = sortableProps || {}

  const style = sortableProps
    ? {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging && !isOverlay ? 0.35 : 1,
        zIndex: isOverlay ? 999 : undefined
      }
    : {}

  const initials = `${client.firstName?.[0] || ''}${client.lastName?.[0] || ''}`

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-2 px-3 py-2 bg-white border border-gray-200 rounded-lg shadow-sm select-none ${
        isOverlay ? 'shadow-lg rotate-1 ring-2 ring-indigo-300' : ''
      }`}
    >
      {editMode && !isOverlay && (
        <DragHandle listeners={listeners} attributes={attributes} />
      )}

      {/* Avatar */}
      {client.avatarUrl ? (
        <img
          src={client.avatarUrl}
          alt={initials}
          className="w-7 h-7 rounded-full object-cover flex-shrink-0"
        />
      ) : (
        <div className="w-7 h-7 rounded-full bg-gray-200 flex items-center justify-center text-xs font-semibold text-gray-600 flex-shrink-0">
          {initials}
        </div>
      )}

      {/* Name */}
      <span className="text-sm text-gray-800 font-medium flex-1 truncate">
        {client.firstName} {client.lastName}
      </span>

      {/* Tier badge */}
      <span className={`px-1.5 py-0.5 text-xs font-semibold rounded border ${COGNITIVE_LEVEL_COLORS[client.cognitiveLevel] || 'bg-gray-100 text-gray-600'}`}>
        {client.cognitiveLevel}
      </span>
    </div>
  )
}

// ── SortableClientCard ────────────────────────────────────────────────────────

function SortableClientCard({ client, editMode }) {
  const sortable = useSortable({
    id: client.id,
    data: { type: 'client' },
    disabled: !editMode
  })
  return <ClientCard client={client} editMode={editMode} sortableProps={sortable} />
}

// ── GroupCard ─────────────────────────────────────────────────────────────────

function GroupCard({ group, members, editMode, onNameChange, onDelete, groupSortable }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = groupSortable

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1
  }

  const [localName, setLocalName] = useState(group.name)

  // Sync if parent changes group name externally (e.g. after auto-create)
  useEffect(() => {
    setLocalName(group.name)
  }, [group.name])

  const memberIds = members.map((c) => c.id)

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="bg-gray-50 border border-gray-200 rounded-xl overflow-hidden"
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2.5 bg-white border-b border-gray-200">
        {/* Group drag handle - only in edit mode */}
        {editMode && (
          <DragHandle listeners={listeners} attributes={attributes} />
        )}

        {/* Name */}
        {editMode ? (
          <input
            value={localName}
            onChange={(e) => setLocalName(e.target.value)}
            onBlur={() => {
              if (localName.trim() && localName !== group.name) {
                onNameChange(group.id, localName.trim())
              } else {
                setLocalName(group.name)
              }
            }}
            className="flex-1 text-sm font-semibold bg-transparent border-b border-dashed border-gray-400 focus:outline-none focus:border-indigo-500 text-gray-800"
          />
        ) : (
          <span className="flex-1 text-sm font-semibold text-gray-800">{group.name}</span>
        )}

        <span className="text-xs text-gray-400 font-medium">{members.length}</span>

        {/* Delete button - edit mode only */}
        {editMode && (
          <button
            onClick={() => onDelete(group)}
            className="p-1 text-gray-400 hover:text-red-500 rounded transition-colors"
            title="Eliminar grupo"
          >
            <Trash className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Members list */}
      <div className="p-2 flex flex-col gap-1.5 min-h-[48px]">
        <SortableContext items={memberIds} strategy={verticalListSortingStrategy}>
          {members.map((client) => (
            <SortableClientCard key={client.id} client={client} editMode={editMode} />
          ))}
        </SortableContext>
        {members.length === 0 && (
          <p className="text-xs text-gray-400 text-center py-2">Sin asistentes</p>
        )}
      </div>
    </div>
  )
}

// ── SortableGroupCard ─────────────────────────────────────────────────────────

function SortableGroupCard({ group, members, editMode, onNameChange, onDelete }) {
  const sortable = useSortable({
    id: group.id,
    data: { type: 'group' },
    disabled: !editMode
  })
  return (
    <GroupCard
      group={group}
      members={members}
      editMode={editMode}
      onNameChange={onNameChange}
      onDelete={onDelete}
      groupSortable={sortable}
    />
  )
}

// ── UnassignedArea ────────────────────────────────────────────────────────────

function UnassignedArea({ clients, editMode }) {
  const clientIds = clients.map((c) => c.id)

  return (
    <div className="bg-white border border-dashed border-gray-300 rounded-xl p-2">
      <p className="text-xs font-medium text-gray-400 mb-2 px-1">Sin grupo</p>
      <div className="flex flex-col gap-1.5 min-h-[40px]">
        <SortableContext items={clientIds} strategy={verticalListSortingStrategy}>
          {clients.map((client) => (
            <SortableClientCard key={client.id} client={client} editMode={editMode} />
          ))}
        </SortableContext>
        {clients.length === 0 && (
          <p className="text-xs text-gray-400 text-center py-2">Todos asignados</p>
        )}
      </div>
    </div>
  )
}

// ── ConfirmModal ──────────────────────────────────────────────────────────────

function ConfirmModal({ isOpen, message, onConfirm, onCancel }) {
  return (
    <Modal isOpen={isOpen} onClose={onCancel} title="Confirmar acción" size="sm">
      <p className="text-gray-600 mb-6">{message}</p>
      <div className="flex gap-3 justify-end">
        <Button variant="secondary" onClick={onCancel}>Cancelar</Button>
        <Button onClick={onConfirm}>Confirmar</Button>
      </div>
    </Modal>
  )
}

// ── ShiftColumn ───────────────────────────────────────────────────────────────

function ShiftColumn({
  shift,
  title,
  shiftClients,     // all clients for this shift (from plan)
  shiftState,       // { groups, unassigned }
  editMode,
  dateStr,
  onStateChange,    // (newShiftState) => void
  allClientsById    // Map<id, client> for lookups
}) {
  const [activeItem, setActiveItem] = useState(null)
  const [confirm, setConfirm] = useState(null) // { type: 'autoCreate' | 'deleteGroup', group? }
  const [saving, setSaving] = useState(false)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  )

  // ── debounced save ──────────────────────────────────────────────────────────
  const doSave = useCallback(
    async (nextState) => {
      setSaving(true)
      try {
        const groupsPayload = nextState.groups.map((g, i) => ({
          id: g.id,
          name: g.name,
          position: i,
          members: g.memberIds.map((clientId, j) => ({ clientId, position: j }))
        }))
        await saveShiftGroups(dateStr, shift, groupsPayload)
      } catch (err) {
        console.error('Error saving groups:', err)
      } finally {
        setSaving(false)
      }
    },
    [dateStr, shift]
  )

  const debouncedSave = useDebounce(doSave, 800)

  // ── helpers ─────────────────────────────────────────────────────────────────

  function getClientById(id) {
    return allClientsById.get(id)
  }

  function getMembersForGroup(group) {
    return (group.memberIds || []).map(getClientById).filter(Boolean)
  }

  // ── DnD handlers ────────────────────────────────────────────────────────────

  function findContainer(id) {
    // Returns 'unassigned' | groupId
    if (shiftState.unassigned.includes(id)) return 'unassigned'
    for (const g of shiftState.groups) {
      if (g.memberIds.includes(id)) return g.id
    }
    return null
  }

  function onDragStart({ active }) {
    const type = active.data.current?.type
    if (type === 'client') {
      setActiveItem({ type: 'client', client: getClientById(active.id) })
    } else if (type === 'group') {
      const group = shiftState.groups.find((g) => g.id === active.id)
      setActiveItem({ type: 'group', group })
    }
  }

  function onDragOver({ active, over }) {
    if (!over) return
    const activeType = active.data.current?.type
    if (activeType !== 'client') return // groups handled in onDragEnd

    const activeContainer = findContainer(active.id)

    // Determine target container
    let targetContainer
    const overType = over.data.current?.type

    if (overType === 'client') {
      targetContainer = findContainer(over.id)
    } else if (overType === 'group') {
      targetContainer = over.id
    } else if (over.id === 'unassigned') {
      targetContainer = 'unassigned'
    } else {
      // over is a group id directly (group drop zone)
      targetContainer = over.id
    }

    if (!targetContainer || activeContainer === targetContainer) return

    // Move client between containers optimistically
    onStateChange((prev) => {
      const next = JSON.parse(JSON.stringify(prev))

      // Remove from source
      if (activeContainer === 'unassigned') {
        next.unassigned = next.unassigned.filter((id) => id !== active.id)
      } else {
        const srcGroup = next.groups.find((g) => g.id === activeContainer)
        if (srcGroup) srcGroup.memberIds = srcGroup.memberIds.filter((id) => id !== active.id)
      }

      // Add to target
      if (targetContainer === 'unassigned') {
        next.unassigned.push(active.id)
      } else {
        const destGroup = next.groups.find((g) => g.id === targetContainer)
        if (destGroup) {
          // Insert at position of over item if over is a client in that group
          if (overType === 'client' && destGroup.memberIds.includes(over.id)) {
            const idx = destGroup.memberIds.indexOf(over.id)
            destGroup.memberIds.splice(idx, 0, active.id)
          } else {
            destGroup.memberIds.push(active.id)
          }
        }
      }

      return next
    })
  }

  function onDragEnd({ active, over }) {
    setActiveItem(null)
    if (!over) return

    const activeType = active.data.current?.type

    if (activeType === 'group') {
      // Reorder groups
      const oldIndex = shiftState.groups.findIndex((g) => g.id === active.id)
      const newIndex = shiftState.groups.findIndex((g) => g.id === over.id)
      if (oldIndex !== -1 && newIndex !== -1 && oldIndex !== newIndex) {
        const next = {
          ...shiftState,
          groups: arrayMove(shiftState.groups, oldIndex, newIndex)
        }
        onStateChange(() => next)
        debouncedSave(next)
      }
      return
    }

    if (activeType === 'client') {
      // Reorder within same container
      const container = findContainer(active.id)
      const overContainer = over.data.current?.type === 'client' ? findContainer(over.id) : container

      if (container && container === overContainer) {
        if (container === 'unassigned') {
          const oldIdx = shiftState.unassigned.indexOf(active.id)
          const newIdx = shiftState.unassigned.indexOf(over.id)
          if (oldIdx !== newIdx) {
            const next = {
              ...shiftState,
              unassigned: arrayMove(shiftState.unassigned, oldIdx, newIdx)
            }
            onStateChange(() => next)
            debouncedSave(next)
          }
        } else {
          const group = shiftState.groups.find((g) => g.id === container)
          if (group) {
            const oldIdx = group.memberIds.indexOf(active.id)
            const newIdx = group.memberIds.indexOf(over.id)
            if (oldIdx !== newIdx) {
              const newMemberIds = arrayMove(group.memberIds, oldIdx, newIdx)
              const next = {
                ...shiftState,
                groups: shiftState.groups.map((g) =>
                  g.id === container ? { ...g, memberIds: newMemberIds } : g
                )
              }
              onStateChange(() => next)
              debouncedSave(next)
            }
          }
        }
      } else {
        // Cross-container move already handled in onDragOver, just save
        debouncedSave(shiftState)
      }
    }
  }

  // ── Group operations ─────────────────────────────────────────────────────────

  function handleAddGroup() {
    const newGroup = {
      id: `temp-${Date.now()}`,
      name: `Grupo ${shiftState.groups.length + 1}`,
      position: shiftState.groups.length,
      memberIds: []
    }
    const next = { ...shiftState, groups: [...shiftState.groups, newGroup] }
    onStateChange(() => next)
    debouncedSave(next)
  }

  function handleNameChange(groupId, name) {
    const next = {
      ...shiftState,
      groups: shiftState.groups.map((g) => (g.id === groupId ? { ...g, name } : g))
    }
    onStateChange(() => next)
    // Immediate save for name changes (only if it's a persisted group)
    if (!groupId.startsWith('temp-')) {
      updateGroupName(groupId, name).catch(console.error)
    } else {
      debouncedSave(next)
    }
  }

  function handleDeleteGroup(group) {
    setConfirm({ type: 'deleteGroup', group })
  }

  async function confirmDeleteGroup() {
    const group = confirm.group
    setConfirm(null)

    // Return members to unassigned
    const next = {
      groups: shiftState.groups.filter((g) => g.id !== group.id),
      unassigned: [...shiftState.unassigned, ...(group.memberIds || [])]
    }
    onStateChange(() => next)

    // Delete from DB if persisted
    if (!group.id.startsWith('temp-')) {
      await deleteGroup(group.id).catch(console.error)
      // Save updated state (without deleted group)
      await doSave(next)
    } else {
      debouncedSave(next)
    }
  }

  function handleAutoCreate() {
    setConfirm({ type: 'autoCreate' })
  }

  async function confirmAutoCreate() {
    setConfirm(null)
    setSaving(true)

    // All clients in this shift
    const allClientIds = [
      ...shiftState.unassigned,
      ...shiftState.groups.flatMap((g) => g.memberIds)
    ]

    // Group by cognitive level, only present levels
    const byLevel = {}
    for (const clientId of allClientIds) {
      const client = getClientById(clientId)
      if (!client) continue
      const level = client.cognitiveLevel || 'A'
      if (!byLevel[level]) byLevel[level] = []
      byLevel[level].push(clientId)
    }

    const levelNames = { A: 'Nivel A', B: 'Nivel B', C: 'Nivel C', D: 'Nivel D' }
    const newGroups = COGNITIVE_LEVEL_ORDER.filter((l) => byLevel[l]).map((l, i) => ({
      id: `temp-${Date.now()}-${i}`,
      name: levelNames[l],
      position: i,
      memberIds: byLevel[l]
    }))

    const next = { groups: newGroups, unassigned: [] }
    onStateChange(() => next)

    try {
      const payload = newGroups.map((g, i) => ({
        name: g.name,
        position: i,
        members: g.memberIds.map((clientId, j) => ({ clientId, position: j }))
      }))
      await saveShiftGroups(dateStr, shift, payload)
      // Reload to get real UUIDs
      const fresh = await getGroupsForDate(dateStr)
      const freshShift = fresh[shift]
      onStateChange(() => ({
        groups: freshShift.map((g) => ({ ...g, memberIds: g.members.map((m) => m.clientId) })),
        unassigned: []
      }))
    } catch (err) {
      console.error('Error auto-creating groups:', err)
    } finally {
      setSaving(false)
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  const groupIds = shiftState.groups.map((g) => g.id)
  const unassignedClients = shiftState.unassigned.map(getClientById).filter(Boolean)

  return (
    <div className="flex-1 min-w-0">
      {/* Column header */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-base font-semibold text-gray-800">{title}</h2>
        <div className="flex items-center gap-2">
          {saving && (
            <span className="text-xs text-gray-400 animate-pulse">Guardando...</span>
          )}
          {editMode && (
            <>
              <button
                onClick={handleAutoCreate}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-lg transition-colors"
                title="Auto-crear grupos por nivel cognitivo"
              >
                <Sparks className="w-3.5 h-3.5" />
                Auto-crear
              </button>
              <button
                onClick={handleAddGroup}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                Grupo
              </button>
            </>
          )}
        </div>
      </div>

      {shiftClients.length === 0 ? (
        <div className="text-center py-12 text-gray-400 text-sm border border-dashed border-gray-200 rounded-xl">
          No hay asistentes programados para este turno
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={onDragStart}
          onDragOver={onDragOver}
          onDragEnd={onDragEnd}
        >
          <div className="flex flex-col gap-3">
            {/* Groups */}
            <SortableContext items={groupIds} strategy={verticalListSortingStrategy}>
              {shiftState.groups.map((group) => (
                <SortableGroupCard
                  key={group.id}
                  group={group}
                  members={getMembersForGroup(group)}
                  editMode={editMode}
                  onNameChange={handleNameChange}
                  onDelete={handleDeleteGroup}
                />
              ))}
            </SortableContext>

            {/* Unassigned */}
            <UnassignedArea clients={unassignedClients} editMode={editMode} />
          </div>

          {/* Drag overlay */}
          <DragOverlay dropAnimation={null}>
            {activeItem?.type === 'client' && activeItem.client && (
              <ClientCard
                client={activeItem.client}
                editMode={editMode}
                isOverlay
              />
            )}
            {activeItem?.type === 'group' && activeItem.group && (
              <div className="bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 shadow-lg ring-2 ring-indigo-300 opacity-90">
                <span className="text-sm font-semibold text-gray-800">{activeItem.group.name}</span>
              </div>
            )}
          </DragOverlay>
        </DndContext>
      )}

      {/* Confirm modal */}
      <ConfirmModal
        isOpen={!!confirm}
        message={
          confirm?.type === 'autoCreate'
            ? 'Esta acción sobreescribirá el tablero actual. ¿Continuar?'
            : `¿Eliminar el grupo "${confirm?.group?.name}"? Los asistentes volverán a "Sin grupo".`
        }
        onConfirm={confirm?.type === 'autoCreate' ? confirmAutoCreate : confirmDeleteGroup}
        onCancel={() => setConfirm(null)}
      />
    </div>
  )
}

// ── DailyGroups (main) ────────────────────────────────────────────────────────

export default function DailyGroups() {
  const dateStr = getTodayStr()
  const todayName = getTodayName()
  const isWeekend = todayName === 'saturday' || todayName === 'sunday'

  const [loading, setLoading] = useState(true)
  const [editMode, setEditMode] = useState(false)

  // allClientsById: Map<id, client>
  const [allClientsById] = useState(() => new Map())

  const [morningClients, setMorningClients] = useState([]) // clients who attend morning today
  const [afternoonClients, setAfternoonClients] = useState([]) // clients who attend afternoon today

  const [morningState, setMorningState] = useState({ groups: [], unassigned: [] })
  const [afternoonState, setAfternoonState] = useState({ groups: [], unassigned: [] })

  useEffect(() => {
    load()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function load() {
    setLoading(true)
    try {
      // Cleanup past days
      await cleanupPastGroups(dateStr).catch(() => {})

      // Load all clients and filter by today's attendance
      const allClients = await getClients()

      // Populate lookup map
      allClientsById.clear()
      allClients.forEach((c) => allClientsById.set(c.id, c))

      // Filter clients by shift for today
      const morning = allClients.filter(
        (c) =>
          c.plan?.assignedDays?.includes(todayName) &&
          (c.plan?.schedule === 'morning' || c.plan?.schedule === 'full_day')
      )
      const afternoon = allClients.filter(
        (c) =>
          c.plan?.assignedDays?.includes(todayName) &&
          (c.plan?.schedule === 'afternoon' || c.plan?.schedule === 'full_day')
      )

      setMorningClients(morning)
      setAfternoonClients(afternoon)

      // Load persisted groups
      const saved = await getGroupsForDate(dateStr)

      // Build state for each shift
      function buildShiftState(shiftGroups, shiftClientsList) {
        const assignedIds = new Set(shiftGroups.flatMap((g) => g.members.map((m) => m.clientId)))
        const unassigned = shiftClientsList.filter((c) => !assignedIds.has(c.id)).map((c) => c.id)
        const groups = shiftGroups.map((g) => ({
          ...g,
          memberIds: g.members.map((m) => m.clientId)
        }))
        return { groups, unassigned }
      }

      setMorningState(buildShiftState(saved.morning, morning))
      setAfternoonState(buildShiftState(saved.afternoon, afternoon))
    } catch (err) {
      console.error('Error loading daily groups:', err)
    } finally {
      setLoading(false)
    }
  }

  // Stable state change callbacks per shift
  const handleMorningChange = useCallback((updater) => {
    setMorningState((prev) => (typeof updater === 'function' ? updater(prev) : updater))
  }, [])

  const handleAfternoonChange = useCallback((updater) => {
    setAfternoonState((prev) => (typeof updater === 'function' ? updater(prev) : updater))
  }, [])

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="bg-gray-50 min-h-screen -mt-8 -mx-4 sm:-mx-6 lg:-mx-8 px-4 sm:px-6 lg:px-8 py-8">
      {/* Page header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Grupos del día</h1>
          <p className="text-sm text-gray-500 mt-0.5 capitalize">
            {new Date().toLocaleDateString('es-AR', {
              weekday: 'long',
              day: 'numeric',
              month: 'long'
            })}
          </p>
        </div>

        <button
          onClick={() => setEditMode((v) => !v)}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            editMode
              ? 'bg-indigo-600 text-white hover:bg-indigo-700'
              : 'bg-white border border-gray-200 text-gray-700 hover:bg-gray-50'
          }`}
        >
          {editMode ? (
            <>
              <Check className="w-4 h-4" />
              Listo
            </>
          ) : (
            <>
              <EditPencil className="w-4 h-4" />
              Editar
            </>
          )}
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
        </div>
      ) : isWeekend ? (
        <div className="text-center py-16 text-gray-400">
          <Refresh className="w-10 h-10 mx-auto mb-3 opacity-40" />
          <p className="text-base font-medium">No hay asistentes programados para hoy</p>
          <p className="text-sm mt-1">El club no opera los fines de semana</p>
        </div>
      ) : (
        <div className="flex gap-6">
          <ShiftColumn
            shift="morning"
            title="Turno Mañana"
            shiftClients={morningClients}
            shiftState={morningState}
            editMode={editMode}
            dateStr={dateStr}
            onStateChange={handleMorningChange}
            allClientsById={allClientsById}
          />

          {/* Divider */}
          <div className="w-px bg-gray-200 flex-shrink-0" />

          <ShiftColumn
            shift="afternoon"
            title="Turno Tarde"
            shiftClients={afternoonClients}
            shiftState={afternoonState}
            editMode={editMode}
            dateStr={dateStr}
            onStateChange={handleAfternoonChange}
            allClientsById={allClientsById}
          />
        </div>
      )}
    </div>
  )
}
