import { useState, useEffect } from 'react'
import { NavArrowDown, NavArrowRight } from 'iconoir-react'
import { formatCurrency } from '../../utils/format'

const STORAGE_PREFIX = 'gervital.costs.categoryOpen.'

// Read persisted open/closed preference for this group (falls back to defaultOpen).
function readStoredOpen(storageKey, defaultOpen) {
  if (!storageKey) return defaultOpen
  try {
    const stored = localStorage.getItem(STORAGE_PREFIX + storageKey)
    if (stored === null) return defaultOpen
    return stored === '1'
  } catch {
    return defaultOpen
  }
}

// Collapsible category header wrapping already-rendered item cards.
// When `storageKey` is provided, the open/closed state persists to localStorage.
export default function CategoryGroup({ label, count, subtotal, defaultOpen = true, storageKey, children }) {
  const [open, setOpen] = useState(() => readStoredOpen(storageKey, defaultOpen))
  const showSubtotal = subtotal != null

  useEffect(() => {
    if (!storageKey) return
    try {
      localStorage.setItem(STORAGE_PREFIX + storageKey, open ? '1' : '0')
    } catch {
      // Ignore storage errors (e.g. private mode, quota)
    }
  }, [storageKey, open])

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
