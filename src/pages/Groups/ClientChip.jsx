import { useDraggable } from '@dnd-kit/core'
import { Xmark, Check, RefreshDouble } from 'iconoir-react'

const COGNITIVE_LEVEL_COLORS = {
  A: 'bg-green-100 text-green-700',
  B: 'bg-blue-100 text-blue-700',
  C: 'bg-amber-100 text-amber-700',
  D: 'bg-red-100 text-red-700'
}

// Chip shown when "Mostrar faltas" is on (read-only, not draggable).
// Absence reasons are flattened: every absence reads as a plain "falta".
const ABSENCE_STYLE = { chip: 'bg-red-50 border-red-200', tag: 'bg-red-100 text-red-700', dot: 'bg-red-500', label: 'falta' }

function RecoveryBadge() {
  return (
    <span title="Día de recupero" className="flex-shrink-0 text-blue-500">
      <RefreshDouble className="w-3.5 h-3.5" strokeWidth={2} />
    </span>
  )
}

export function PoolClientChip({ client, assignedToAll, isRecovery }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `pool-${client.id}`,
    data: { type: 'pool-client', client }
  })

  const initials = `${client.firstName?.[0] || ''}${client.lastName?.[0] || ''}`

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={`flex items-center gap-2 px-3 py-2.5 bg-white border border-gray-200 rounded-lg cursor-grab active:cursor-grabbing select-none transition-opacity ${
        isDragging ? 'opacity-40' : ''
      }`}
    >
      {assignedToAll ? (
        <div
          className="w-6 h-6 rounded-full bg-green-500 flex items-center justify-center flex-shrink-0"
          title="Asignado a todos los horarios"
        >
          <Check className="w-3.5 h-3.5 text-white" strokeWidth={2.5} />
        </div>
      ) : client.avatarUrl ? (
        <img src={client.avatarUrl} alt={initials} className="w-6 h-6 rounded-full object-cover flex-shrink-0" />
      ) : (
        <div className="w-6 h-6 rounded-full bg-gray-200 flex items-center justify-center text-[10px] font-semibold text-gray-600 flex-shrink-0">
          {initials}
        </div>
      )}
      <span className="text-sm text-gray-800 font-medium flex-1 truncate">
        {client.firstName} {client.lastName}
      </span>
      {isRecovery && <RecoveryBadge />}
      <span className={`px-1.5 py-0.5 text-[10px] font-semibold rounded ${COGNITIVE_LEVEL_COLORS[client.cognitiveLevel] || 'bg-gray-100 text-gray-600'}`}>
        {client.cognitiveLevel}
      </span>
    </div>
  )
}

// Read-only chip for an absent client (not draggable)
export function AbsenceClientChip({ client }) {
  const v = ABSENCE_STYLE
  const tooltip = client.isJustified ? 'Falta justificada' : 'Falta no justificada'

  return (
    <div
      title={tooltip}
      className={`flex items-center gap-2 px-3 py-2 border rounded-lg select-none ${v.chip}`}
    >
      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${v.dot}`} />
      <span className="text-sm text-gray-700 font-medium flex-1 truncate">
        {client.firstName} {client.lastName}
      </span>
      <span className={`flex-shrink-0 px-1.5 py-0.5 text-[9px] font-bold uppercase rounded ${v.tag}`}>
        {v.label}
      </span>
    </div>
  )
}

export function AssignedClientChip({ client, onRemove, readOnly, isRecovery, activityId, slotId }) {
  const initials = `${client.firstName?.[0] || ''}${client.lastName?.[0] || ''}`

  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `assigned-${activityId}-${client.id}`,
    data: { type: 'assigned-client', client, sourceActivityId: activityId, sourceSlotId: slotId },
    disabled: readOnly
  })

  return (
    <div
      ref={setNodeRef}
      {...(!readOnly ? listeners : {})}
      {...(!readOnly ? attributes : {})}
      className={`group flex items-center gap-1.5 px-2.5 py-2 bg-white border border-gray-200 rounded-lg text-sm select-none ${
        readOnly ? '' : 'cursor-grab active:cursor-grabbing'
      } ${isDragging ? 'opacity-40' : ''}`}
    >
      {client.avatarUrl ? (
        <img src={client.avatarUrl} alt={initials} className="w-5 h-5 rounded-full object-cover flex-shrink-0" />
      ) : (
        <div className="w-5 h-5 rounded-full bg-gray-200 flex items-center justify-center text-[9px] font-semibold text-gray-600 flex-shrink-0">
          {initials}
        </div>
      )}
      <span className="text-gray-800 font-medium truncate">
        {client.firstName} {client.lastName?.[0]}.
      </span>
      {isRecovery && <RecoveryBadge />}
      <span className={`px-1 py-0.5 text-[9px] font-semibold rounded ${COGNITIVE_LEVEL_COLORS[client.cognitiveLevel] || 'bg-gray-100 text-gray-600'}`}>
        {client.cognitiveLevel}
      </span>
      {!readOnly && onRemove && (
        <button
          onPointerDown={e => e.stopPropagation()}
          onClick={onRemove}
          className="ml-auto opacity-0 group-hover:opacity-100 p-0.5 text-gray-400 hover:text-red-500 transition-opacity"
          title="Quitar"
        >
          <Xmark className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  )
}
