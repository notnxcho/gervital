import { useState } from 'react'
import { NavArrowDown, NavArrowRight } from 'iconoir-react'
import { formatCurrency } from '../../utils/format'

// Collapsible category header wrapping already-rendered item cards.
export default function CategoryGroup({ label, count, subtotal, defaultOpen = true, children }) {
  const [open, setOpen] = useState(defaultOpen)
  const showSubtotal = subtotal != null

  return (
    <div className="mb-4">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
      >
        <div className="flex items-center gap-2 min-w-0">
          {open ? <NavArrowDown className="w-4 h-4 text-gray-500 shrink-0" /> : <NavArrowRight className="w-4 h-4 text-gray-500 shrink-0" />}
          <span className="font-medium text-gray-900 truncate">{label}</span>
          <span className="text-xs text-gray-500 shrink-0">({count})</span>
        </div>
        {showSubtotal && (
          <span className="text-sm font-semibold text-gray-700 shrink-0">{formatCurrency(subtotal)}</span>
        )}
      </button>
      {open && <div className="mt-3 space-y-3">{children}</div>}
    </div>
  )
}
