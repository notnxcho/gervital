import { useDroppable } from '@dnd-kit/core'
import ChurnCard from './ChurnCard'

// Droppable pipeline stage. data shape: { type: 'churn-column', stage }.
// `horizontal`: render as a full-width intake band (cards wrap in a row) instead of a column.
export default function ChurnColumn({ stage, label, color, cards, onCardClick, reasonsByKey, horizontal = false }) {
  const { setNodeRef, isOver } = useDroppable({
    id: `column-${stage}`,
    data: { type: 'churn-column', stage }
  })

  return (
    <div className={horizontal ? 'w-full' : 'flex flex-col w-[230px] flex-shrink-0'}>
      {/* Stage header */}
      <div className="flex items-center gap-2 px-1 mb-3">
        <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: color }} />
        <span className="text-sm font-semibold text-gray-800">{label}</span>
        <span className="text-xs text-gray-400 tabular-nums">{cards.length}</span>
      </div>

      {/* Body (droppable) */}
      <div
        ref={setNodeRef}
        className={`gap-2.5 p-2 rounded-2xl transition-colors ${
          horizontal ? 'flex flex-row flex-wrap' : 'flex-1 flex flex-col min-h-[60vh]'
        } ${isOver ? 'bg-indigo-50 ring-2 ring-indigo-200' : 'bg-gray-100/60'}`}
      >
        {cards.length === 0 ? (
          !horizontal && (
            <div className="flex-1 flex items-center justify-center text-[12px] text-gray-300 py-8">
              Sin clientes
            </div>
          )
        ) : (
          cards.map(card =>
            horizontal ? (
              <div key={card.clientId} className="w-[220px]">
                <ChurnCard card={card} onClick={onCardClick} reasonsByKey={reasonsByKey} />
              </div>
            ) : (
              <ChurnCard key={card.clientId} card={card} onClick={onCardClick} reasonsByKey={reasonsByKey} />
            )
          )
        )}
      </div>
    </div>
  )
}
