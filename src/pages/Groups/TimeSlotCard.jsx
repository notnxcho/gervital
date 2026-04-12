import { Trash } from 'iconoir-react'
import ActivityCard from './ActivityCard'

export default function TimeSlotCard({
  slot,
  clientsById,
  onRemoveClient,
  onUpdateSlot,
  onDeleteSlot,
  onAddActivity,
  onUpdateActivity,
  onDeleteActivity,
  readOnly,
  invalidDropSlotId,
  draggedClientId
}) {

  function isInvalidDropForActivity(activity) {
    if (!draggedClientId || invalidDropSlotId !== slot.id) return false
    return !activity.clientIds.includes(draggedClientId)
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 bg-gray-50 border-b border-gray-100">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          {readOnly ? (
            <>
              <span className="text-xs font-semibold text-gray-500 bg-gray-100 px-2 py-0.5 rounded flex-shrink-0">
                {slot.time?.slice(0, 5)}
              </span>
              <span className="text-sm font-semibold text-gray-700 truncate">{slot.name}</span>
            </>
          ) : (
            <>
              <input
                type="time"
                defaultValue={slot.time?.slice(0, 5)}
                onBlur={e => {
                  const val = e.target.value
                  if (val && val !== slot.time?.slice(0, 5)) onUpdateSlot(slot.id, { time: val })
                }}
                className="text-xs font-semibold text-gray-500 bg-gray-100 px-2 py-0.5 rounded w-[72px] flex-shrink-0 focus:outline-none focus:ring-1 focus:ring-indigo-400"
              />
              <input
                defaultValue={slot.name}
                onBlur={e => {
                  const val = e.target.value.trim()
                  if (val && val !== slot.name) onUpdateSlot(slot.id, { name: val })
                }}
                className="text-sm font-semibold text-gray-700 bg-transparent border-b border-transparent hover:border-gray-300 focus:border-indigo-400 focus:outline-none truncate flex-1"
              />
            </>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="text-xs text-gray-400">
            {slot.activities.length} {slot.activities.length === 1 ? 'actividad' : 'actividades'}
          </span>
          {!readOnly && (
            <>
              <button
                onClick={() => onAddActivity(slot.id)}
                className="text-xs text-gray-400 hover:text-indigo-600 transition-colors"
                title="Agregar actividad"
              >
                + Actividad
              </button>
              <button
                onClick={() => onDeleteSlot(slot.id)}
                className="p-1 text-gray-300 hover:text-red-500 transition-colors"
                title="Eliminar horario"
              >
                <Trash className="w-3.5 h-3.5" />
              </button>
            </>
          )}
        </div>
      </div>

      <div className="p-3 flex flex-col gap-2">
        {slot.activities.map(activity => (
          <ActivityCard
            key={activity.id}
            activity={activity}
            slotId={slot.id}
            clientsById={clientsById}
            onRemoveClient={onRemoveClient}
            onUpdateActivity={onUpdateActivity}
            onDeleteActivity={onDeleteActivity}
            readOnly={readOnly}
            isInvalidDrop={isInvalidDropForActivity(activity)}
          />
        ))}
        {slot.activities.length === 0 && (
          <p className="text-xs text-gray-400 text-center py-3">Sin actividades</p>
        )}
      </div>
    </div>
  )
}
