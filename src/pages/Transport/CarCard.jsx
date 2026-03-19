import { useState, useEffect } from 'react'
import { useDroppable } from '@dnd-kit/core'
import { SortableContext, rectSortingStrategy } from '@dnd-kit/sortable'
import { Trash, Minus, Plus } from 'iconoir-react'
import { SortableClientChip } from './ClientChip'

export default function CarCard({
  car,
  clients,       // Map<id, client>
  onNameChange,
  onSeatCountChange,
  onDelete
}) {
  const [editingName, setEditingName] = useState(false)
  const [localName, setLocalName] = useState(car.name)

  useEffect(() => {
    if (!editingName) setLocalName(car.name)
  }, [car.name, editingName])

  const { setNodeRef, isOver } = useDroppable({
    id: `car-${car.id}`,
    data: { type: 'car', carId: car.id }
  })

  const members = (car.memberIds || []).map(id => clients.get(id)).filter(Boolean)
  const isFull = members.length >= car.seatCount

  return (
    <div
      ref={setNodeRef}
      className={`border rounded-lg bg-white transition-colors ${
        isOver && !isFull ? 'border-indigo-300 bg-indigo-50/30' :
        isOver && isFull ? 'border-red-300 bg-red-50/30' : 'border-gray-200'
      }`}
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-100">
        <div
          className="w-2.5 h-2.5 rounded-full flex-shrink-0"
          style={{ backgroundColor: car.color }}
        />

        {editingName ? (
          <input
            value={localName}
            onChange={(e) => setLocalName(e.target.value)}
            onBlur={() => {
              setEditingName(false)
              if (localName.trim() && localName !== car.name) {
                onNameChange(car.id, localName.trim())
              } else {
                setLocalName(car.name)
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.target.blur()
              if (e.key === 'Escape') { setLocalName(car.name); setEditingName(false) }
            }}
            autoFocus
            className="flex-1 text-sm font-semibold bg-transparent border-b border-dashed border-gray-400 focus:outline-none focus:border-indigo-500 text-gray-800"
          />
        ) : (
          <span
            onClick={() => setEditingName(true)}
            className="flex-1 text-sm font-semibold text-gray-800 cursor-pointer hover:text-indigo-600 transition-colors"
            title="Click para editar nombre"
          >
            {car.name}
          </span>
        )}

        <div className="flex items-center gap-1">
          <button
            onClick={() => onSeatCountChange(car.id, Math.max(1, car.seatCount - 1))}
            className="p-0.5 text-gray-400 hover:text-gray-600 rounded transition-colors"
            disabled={car.seatCount <= 1}
          >
            <Minus className="w-3 h-3" />
          </button>
          <span className="text-xs text-gray-500 min-w-[4rem] text-center">
            {members.length}/{car.seatCount} asientos
          </span>
          <button
            onClick={() => onSeatCountChange(car.id, car.seatCount + 1)}
            className="p-0.5 text-gray-400 hover:text-gray-600 rounded transition-colors"
          >
            <Plus className="w-3 h-3" />
          </button>
        </div>

        <button
          onClick={() => onDelete(car.id)}
          className="p-1 text-gray-400 hover:text-red-500 rounded transition-colors"
          title="Eliminar auto"
        >
          <Trash className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Members */}
      <div className="p-2 min-h-[40px]">
        <SortableContext items={car.memberIds || []} strategy={rectSortingStrategy}>
          <div className="flex flex-wrap gap-1.5">
            {members.map(client => (
              <SortableClientChip
                key={client.id}
                client={client}
                color={car.color}
                noAddress={!client.latitude && !client.longitude}
              />
            ))}
          </div>
        </SortableContext>

        {members.length === 0 && (
          <div className="border border-dashed border-gray-200 rounded-md py-3 text-center text-xs text-gray-400">
            Arrastrá asistentes aquí
          </div>
        )}
      </div>
    </div>
  )
}
