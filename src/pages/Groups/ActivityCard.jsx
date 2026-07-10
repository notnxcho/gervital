import { useDroppable } from '@dnd-kit/core'
import { Trash, User } from 'iconoir-react'
import { AssignedClientChip } from './ClientChip'

export default function ActivityCard({
  activity,
  slotId,
  clientsById,
  onRemoveClient,
  onUpdateActivity,
  onDeleteActivity,
  readOnly,
  isInvalidDrop,
  recoveryIds
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `activity-${activity.id}`,
    data: { type: 'activity', activityId: activity.id, slotId }
  })

  const dropHighlight = isOver
    ? isInvalidDrop
      ? 'border-red-400 bg-red-50'
      : 'border-indigo-400 bg-indigo-50'
    : 'border-gray-200 bg-gray-50'

  const assignedClients = activity.clientIds
    .map(id => clientsById.get(id))
    .filter(Boolean)

  return (
    <div
      ref={setNodeRef}
      className={`border border-dashed rounded-lg p-3 min-h-[56px] transition-colors ${dropHighlight}`}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          {readOnly ? (
            <span className="text-sm font-semibold text-gray-700 truncate">{activity.name}</span>
          ) : (
            <input
              defaultValue={activity.name}
              onBlur={e => {
                const val = e.target.value.trim()
                if (val && val !== activity.name) onUpdateActivity(activity.id, { name: val })
              }}
              className="text-sm font-semibold text-gray-700 bg-transparent border-b border-transparent hover:border-gray-300 focus:border-indigo-400 focus:outline-none truncate flex-1"
            />
          )}
          {assignedClients.length > 0 && (
            <span className="flex-shrink-0 inline-flex items-center gap-1 text-sm font-semibold text-gray-700 bg-gray-100 px-2.5 py-1 rounded-full tabular-nums">
              <User className="w-4 h-4 text-gray-500" />
              {assignedClients.length}
            </span>
          )}
          {readOnly ? (
            activity.responsible && (
              <span className="flex-shrink-0 text-sm font-semibold text-gray-900 bg-white border border-gray-300 px-2.5 py-1 rounded-lg">
                {activity.responsible}
              </span>
            )
          ) : (
            <input
              defaultValue={activity.responsible || ''}
              placeholder="Referente"
              onBlur={e => {
                const val = e.target.value.trim()
                if (val !== (activity.responsible || '')) onUpdateActivity(activity.id, { responsible: val || null })
              }}
              className="text-sm font-semibold text-gray-900 bg-white border border-gray-300 rounded-lg px-2.5 py-1 w-36 flex-shrink-0 focus:outline-none focus:border-indigo-400 placeholder:font-normal placeholder:text-gray-400"
            />
          )}
        </div>
        {!readOnly && (
          <button
            onClick={() => onDeleteActivity(activity.id)}
            className="p-1 text-gray-300 hover:text-red-500 transition-colors flex-shrink-0"
            title="Eliminar actividad"
          >
            <Trash className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {assignedClients.map(client => (
          <AssignedClientChip
            key={client.id}
            client={client}
            readOnly={readOnly}
            onRemove={() => onRemoveClient(activity.id, client.id)}
            isRecovery={recoveryIds?.has(client.id)}
            activityId={activity.id}
            slotId={slotId}
          />
        ))}
        {assignedClients.length === 0 && (
          <p className="text-xs text-gray-400 py-1">Arrastrá asistentes aquí</p>
        )}
      </div>
    </div>
  )
}
