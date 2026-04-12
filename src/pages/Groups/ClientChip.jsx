import { useDraggable } from '@dnd-kit/core'
import { Xmark } from 'iconoir-react'

const COGNITIVE_LEVEL_COLORS = {
  A: 'bg-green-100 text-green-700',
  B: 'bg-blue-100 text-blue-700',
  C: 'bg-amber-100 text-amber-700',
  D: 'bg-red-100 text-red-700'
}

export function PoolClientChip({ client }) {
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
      {client.avatarUrl ? (
        <img src={client.avatarUrl} alt={initials} className="w-6 h-6 rounded-full object-cover flex-shrink-0" />
      ) : (
        <div className="w-6 h-6 rounded-full bg-gray-200 flex items-center justify-center text-[10px] font-semibold text-gray-600 flex-shrink-0">
          {initials}
        </div>
      )}
      <span className="text-sm text-gray-800 font-medium flex-1 truncate">
        {client.firstName} {client.lastName}
      </span>
      <span className={`px-1.5 py-0.5 text-[10px] font-semibold rounded ${COGNITIVE_LEVEL_COLORS[client.cognitiveLevel] || 'bg-gray-100 text-gray-600'}`}>
        {client.cognitiveLevel}
      </span>
    </div>
  )
}

export function AssignedClientChip({ client, onRemove, readOnly }) {
  const initials = `${client.firstName?.[0] || ''}${client.lastName?.[0] || ''}`

  return (
    <div className="group flex items-center gap-1.5 px-2.5 py-2 bg-white border border-gray-200 rounded-lg text-sm">
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
      <span className={`px-1 py-0.5 text-[9px] font-semibold rounded ${COGNITIVE_LEVEL_COLORS[client.cognitiveLevel] || 'bg-gray-100 text-gray-600'}`}>
        {client.cognitiveLevel}
      </span>
      {!readOnly && onRemove && (
        <button
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
