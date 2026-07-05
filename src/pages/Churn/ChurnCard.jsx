import { useDraggable } from '@dnd-kit/core'
import { formatCurrency } from '../../utils/format'
import { REASON_CONFIG, TIER_HEX, planSubtitle } from './churnConstants'

// Small colored badge for the deactivation reason.
function ReasonBadge({ reason }) {
  const cfg = REASON_CONFIG[reason] || REASON_CONFIG.other
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold"
      style={{ background: `${cfg.color}1a`, color: cfg.color }}
    >
      {cfg.label}
    </span>
  )
}

// Draggable churn card. `overlay` renders the same visual without the drag hooks
// (used inside DragOverlay). data shape: { type: 'churn-card', clientId, stage }.
export default function ChurnCard({ card, onClick, overlay = false }) {
  const draggable = useDraggable({
    id: `churn-${card.clientId}`,
    data: { type: 'churn-card', clientId: card.clientId, stage: card.stage },
    disabled: overlay
  })

  const { attributes, listeners, setNodeRef, isDragging } = draggable
  const initials = `${card.firstName?.[0] || ''}${card.lastName?.[0] || ''}`
  const tierColor = TIER_HEX[card.cognitiveLevel] || '#94a3b8'
  const subtitle = planSubtitle(card)

  return (
    <div
      ref={overlay ? undefined : setNodeRef}
      {...(overlay ? {} : listeners)}
      {...(overlay ? {} : attributes)}
      onClick={(e) => {
        // Ignore clicks fired right after a drag
        if (isDragging) return
        onClick?.(card)
      }}
      className={`bg-white rounded-2xl border border-gray-100 shadow-[0_1px_2px_rgba(16,24,40,0.04)] p-3 select-none cursor-grab active:cursor-grabbing transition-shadow hover:shadow-md ${
        isDragging ? 'opacity-40' : ''
      } ${overlay ? 'shadow-lg rotate-1' : ''}`}
    >
      {/* Header: avatar + name */}
      <div className="flex items-center gap-2.5 mb-2">
        <div
          className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-semibold text-white flex-shrink-0"
          style={{ background: tierColor }}
        >
          {initials}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-gray-900 truncate">
            {card.firstName} {card.lastName}
          </p>
          {subtitle && <p className="text-[11px] text-gray-400 truncate">{subtitle}</p>}
        </div>
      </div>

      {/* Reason badge */}
      <div className="mb-2.5">
        <ReasonBadge reason={card.reason} />
      </div>

      {/* Footer: days since + MRR lost */}
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-gray-400">
          {card.daysSince != null ? `hace ${card.daysSince} días` : '—'}
        </span>
        <span className="text-[12px] font-semibold text-rose-600 tabular-nums">
          {card.mrrSnapshot != null ? `−${formatCurrency(card.mrrSnapshot)}` : '—'}
        </span>
      </div>
    </div>
  )
}
