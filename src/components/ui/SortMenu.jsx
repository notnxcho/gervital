import { useState, useEffect, useRef } from 'react'
import { SortDown, NavArrowDown, Check } from 'iconoir-react'

// Menú de ordenamiento con el mismo look que Filters: botón con label + panel flotante
export default function SortMenu({ value, onChange, options = [] }) {
  const [open, setOpen] = useState(false)
  const menuRef = useRef(null)

  // Cerrar al hacer clic fuera
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 px-4 h-11 bg-white border border-gray-200 rounded-xl text-gray-600 hover:border-gray-300 transition-colors"
      >
        <SortDown className="w-5 h-5" />
        <span className="font-medium">Ordenar</span>
        <NavArrowDown className={`w-4 h-4 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-56 bg-white border border-gray-100 rounded-2xl shadow-xl ring-1 ring-black/5 z-20 p-1.5">
          {options.map((option) => {
            const selected = option.value === value
            return (
              <button
                key={option.value}
                onClick={() => { onChange(option.value); setOpen(false) }}
                className={`
                  w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-sm text-left transition-colors
                  ${selected
                    ? 'bg-purple-50 text-purple-700 font-medium'
                    : 'text-gray-700 hover:bg-gray-50'}
                `}
              >
                {option.label}
                {selected && <Check className="w-4 h-4 shrink-0" />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
