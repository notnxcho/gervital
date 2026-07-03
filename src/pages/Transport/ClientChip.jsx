import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { RefreshDouble } from 'iconoir-react'

const COLOR_SCHEMES = {
  '#ef4444': { bg: 'bg-red-50', border: 'border-red-200', text: 'text-red-800' },
  '#3b82f6': { bg: 'bg-blue-50', border: 'border-blue-200', text: 'text-blue-800' },
  '#22c55e': { bg: 'bg-green-50', border: 'border-green-200', text: 'text-green-800' },
  '#eab308': { bg: 'bg-yellow-50', border: 'border-yellow-200', text: 'text-yellow-800' },
  '#8b5cf6': { bg: 'bg-purple-50', border: 'border-purple-200', text: 'text-purple-800' },
  '#f97316': { bg: 'bg-orange-50', border: 'border-orange-200', text: 'text-orange-800' },
  '#ec4899': { bg: 'bg-pink-50', border: 'border-pink-200', text: 'text-pink-800' },
  '#06b6d4': { bg: 'bg-cyan-50', border: 'border-cyan-200', text: 'text-cyan-800' }
}

const UNASSIGNED_SCHEME = { bg: 'bg-gray-100', border: 'border-gray-200', text: 'text-gray-700' }

function ChipContent({ client, color, isOverlay, noAddress, isRecovery }) {
  const scheme = COLOR_SCHEMES[color] || UNASSIGNED_SCHEME

  return (
    <div
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-xs font-medium cursor-grab select-none transition-shadow
        ${scheme.bg} ${scheme.border} ${scheme.text}
        ${isOverlay ? 'shadow-lg ring-2 ring-indigo-300 rotate-1' : 'hover:shadow-sm'}`}
    >
      <span>{client.firstName} {client.lastName}</span>
      {isRecovery && (
        <RefreshDouble className="w-3.5 h-3.5 text-blue-500 flex-shrink-0" strokeWidth={2} title="Día de recupero" />
      )}
      {noAddress && (
        <span className="text-amber-500" title="Sin dirección">⚠</span>
      )}
    </div>
  )
}

// Read-only chip for an absent / vacationing client (not draggable)
const ABSENCE_CHIP = {
  absent: { cls: 'bg-red-50 border-red-200 text-red-700', label: 'falta' },
  vacation: { cls: 'bg-amber-50 border-amber-200 text-amber-700', label: 'vac.' }
}

export function AbsenceChip({ client, variant = 'absent' }) {
  const v = ABSENCE_CHIP[variant] || ABSENCE_CHIP.absent
  const tooltip = variant === 'vacation'
    ? 'Vacaciones'
    : client.isJustified ? 'Falta justificada' : 'Falta no justificada'

  return (
    <div
      title={tooltip}
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-xs font-medium select-none ${v.cls}`}
    >
      <span>{client.firstName} {client.lastName}</span>
      <span className="text-[9px] font-bold uppercase opacity-80">{v.label}</span>
    </div>
  )
}

export function SortableClientChip({ client, color, noAddress, isRecovery }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: client.id,
    data: { type: 'client' }
  })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.35 : 1
  }

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <ChipContent client={client} color={color} noAddress={noAddress} isRecovery={isRecovery} />
    </div>
  )
}

export function DragOverlayChip({ client, color }) {
  return <ChipContent client={client} color={color} isOverlay />
}

export default ChipContent
